import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStore, STATUS_RED_MS, STATUS_YELLOW_MS } from "@/lib/sse";

/**
 * A minimal stand-in for the browser's EventSource that tests can drive
 * directly: the SseStore opens it, then the test fires `onopen` /
 * `onmessage` / `onerror` to simulate the wire.
 */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

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

  fail() {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }

  close() {
    this.readyState = 2;
  }
}

let now = 0;
const clock = () => now;

function makeStore() {
  now = 1_000_000;
  let last: FakeEventSource | null = null;
  // The store calls `new this.EventSourceCtor(url)` — the cast lets us swap
  // in our class without satisfying the full DOM EventSource interface.
  const Ctor = class extends FakeEventSource {
    constructor(url: string) {
      super(url);
      last = this;
    }
  } as unknown as typeof EventSource;

  const store = createStore({ now: clock, EventSourceCtor: Ctor });

  return {
    store,
    es: () => {
      if (!last) throw new Error("EventSource not yet constructed");
      return last;
    },
  };
}

describe("SseStore — price ingestion", () => {
  beforeEach(() => {
    now = 1_000_000;
  });

  it("populates the price map from a valid SSE payload", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();

    now = 1_000_500;
    es().emit(
      JSON.stringify({
        AAPL: {
          ticker: "AAPL",
          price: 191.2,
          previous_price: 190.5,
          timestamp: 1700000000.0,
          change: 0.7,
          change_percent: 0.367,
          direction: "up",
        },
      }),
    );

    const tick = store.getState().prices.AAPL;
    expect(tick).toBeDefined();
    expect(tick.price).toBe(191.2);
    expect(tick.previous_price).toBe(190.5);
    expect(tick.direction).toBe("up");
    expect(tick.market_status).toBe("open"); // default when omitted
    expect(tick.received_at).toBe(1_000_500);
  });

  it("merges multiple tickers in a single payload", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();

    es().emit(
      JSON.stringify({
        AAPL: tick("AAPL", 100, 99, "up"),
        MSFT: tick("MSFT", 410, 412, "down"),
      }),
    );

    expect(Object.keys(store.getState().prices).sort()).toEqual(["AAPL", "MSFT"]);
    expect(store.getState().prices.MSFT.direction).toBe("down");
  });

  it("ignores malformed payloads but still bumps lastActivityAt", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();

    now = 1_000_999;
    es().emit("not json");

    expect(store.getState().prices).toEqual({});
    expect(store.getState().lastActivityAt).toBe(1_000_999);
    expect(store.getState().warming).toBe(false);
  });

  it("propagates server-supplied market_status when present", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    es().emit(
      JSON.stringify({
        AAPL: { ...tick("AAPL", 100, 99, "up"), market_status: "closed" },
      }),
    );
    expect(store.getState().prices.AAPL.market_status).toBe("closed");
  });
});

describe("SseStore — connection-status state machine", () => {
  beforeEach(() => {
    now = 1_000_000;
  });

  it("starts red before start() is called", () => {
    const { store } = makeStore();
    expect(store.status()).toBe("red");
  });

  it("yellow while CONNECTING (warm-up)", () => {
    const { store } = makeStore();
    store.start(); // synchronously sets readyState=0 + warming=true
    expect(store.status()).toBe("yellow");
  });

  it("yellow after OPEN but before first event", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    expect(store.status()).toBe("yellow");
  });

  it("green when OPEN and last activity within 10s", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    now = 1_000_100;
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100, 99, "up") }));
    now = 1_005_000; // +5s after activity
    expect(store.status()).toBe("green");
  });

  it("yellow when OPEN with 10–30s gap", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    now = 1_000_100;
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100, 99, "up") }));
    now = 1_000_100 + STATUS_YELLOW_MS + 1; // just past 10s
    expect(store.status()).toBe("yellow");
  });

  it("red when OPEN with > 30s gap", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    now = 1_000_100;
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100, 99, "up") }));
    now = 1_000_100 + STATUS_RED_MS + 1; // just past 30s
    expect(store.status()).toBe("red");
  });

  it("red after stop()", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100, 99, "up") }));
    expect(store.status()).toBe("green");
    store.stop();
    expect(store.status()).toBe("red");
  });

  it("heartbeat() bumps lastActivityAt and clears warming", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    now = 1_000_100;
    store.heartbeat();
    expect(store.status()).toBe("green");
  });
});

describe("SseStore — 1s status timer notifies subscribers (regression for #22)", () => {
  beforeEach(() => {
    now = 1_000_000;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes a fresh snapshot reference on every timer tick", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100, 99, "up") }));

    // Capture snapshots fed to React: useSyncExternalStore re-renders only
    // when getSnapshot()'s reference changes between subscribe notifications.
    const snapshots: unknown[] = [];
    store.subscribe(() => snapshots.push(store.getState()));

    // Advance the wall clock past the yellow threshold WITHOUT pushing any
    // events on the wire. Without the snapshot bump, React would never
    // re-render and the dot would stay green.
    now = 1_000_000 + STATUS_YELLOW_MS + 500;

    // Trigger the 1s interval — the bug was that this fired notify() but
    // didn't change the snapshot reference, so React skipped the update.
    vi.advanceTimersByTime(1000);

    // Listener fired AND emitted a snapshot whose reference differs from
    // what useSyncExternalStore last saw. The status() now reads as yellow.
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const last = snapshots[snapshots.length - 1] as { statusTick: number };
    expect(last.statusTick).toBeGreaterThan(0);
    expect(store.status()).toBe("yellow");
  });

  it("transitions OPEN → yellow → red as the timer fires past each threshold", () => {
    const { store, es } = makeStore();
    store.start();
    es().open();
    es().emit(JSON.stringify({ AAPL: tick("AAPL", 100, 99, "up") }));
    expect(store.status()).toBe("green");

    // Walk the wall clock past the yellow threshold, then advance the timer.
    now = 1_000_000 + STATUS_YELLOW_MS + 500;
    vi.advanceTimersByTime(1000);
    expect(store.status()).toBe("yellow");

    // And past the red threshold.
    now = 1_000_000 + STATUS_RED_MS + 500;
    vi.advanceTimersByTime(1000);
    expect(store.status()).toBe("red");
  });
});

function tick(ticker: string, price: number, prev: number, direction: "up" | "down" | "flat") {
  return {
    ticker,
    price,
    previous_price: prev,
    timestamp: 1_700_000_000,
    change: price - prev,
    change_percent: prev === 0 ? 0 : ((price - prev) / prev) * 100,
    direction,
  };
}
