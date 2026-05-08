import { describe, it, expect, beforeEach } from "vitest";
import { createStore } from "@/lib/sse";
import { __internals as historyInternals } from "@/lib/history";

class FakeEventSource {
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  emit(payload: string) {
    this.onmessage?.(new MessageEvent("message", { data: payload }));
  }
  close() {
    this.readyState = 2;
  }
}

describe("history store", () => {
  let now = 0;
  beforeEach(() => {
    now = 1_000_000;
    historyInternals.store.detachStore();
    historyInternals.store.reset();
  });

  function makeStore() {
    let last: FakeEventSource | null = null;
    const Ctor = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        last = this;
      }
    } as unknown as typeof EventSource;
    const sse = createStore({ now: () => now, EventSourceCtor: Ctor });
    sse.start();
    last!.open();
    return { sse, es: () => last! };
  }

  it("accumulates one point per fresh tick", () => {
    const { sse, es } = makeStore();
    historyInternals.store.attachTo(sse);

    now = 1_000_100;
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100) }));
    now = 1_000_600;
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 102) }));
    now = 1_001_100;
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 101) }));

    expect(historyInternals.store.get("AAPL")).toEqual([100, 102, 101]);
  });

  it("ignores duplicate snapshots that re-share the same received_at", () => {
    const { sse, es } = makeStore();
    historyInternals.store.attachTo(sse);

    now = 1_000_100;
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100) }));
    // Same ts → store would re-publish; history must skip
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100) }));

    expect(historyInternals.store.get("AAPL")).toEqual([100]);
  });

  it("caps each ticker at MAX_POINTS", () => {
    const { sse, es } = makeStore();
    historyInternals.store.attachTo(sse);
    const max = historyInternals.MAX_POINTS;

    for (let i = 0; i < max + 25; i++) {
      now = 1_000_000 + i * 100;
      es().emit(JSON.stringify({ AAPL: tick("AAPL", i) }));
    }

    const buf = historyInternals.store.get("AAPL");
    expect(buf.length).toBe(max);
    // The cap drops the oldest entries, so the buffer should start at 25.
    expect(buf[0]).toBe(25);
    expect(buf[buf.length - 1]).toBe(max + 24);
  });

  it("returns empty for tickers we've never seen", () => {
    expect(historyInternals.store.get("ZZZZ")).toEqual([]);
  });
});

function tick(ticker: string, price: number) {
  return {
    ticker,
    price,
    previous_price: price - 1,
    timestamp: 1_700_000_000 + price,
    change: 1,
    change_percent: 1,
    direction: "up" as const,
  };
}
