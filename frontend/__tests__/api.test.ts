import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ApiError, api, __internals } from "@/lib/api";

const realFetch = globalThis.fetch;

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (call: CapturedCall) => Response): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = normaliseHeaders(init?.headers);
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: CapturedCall = { url, method, headers, body };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return calls;
}

function normaliseHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    return Object.fromEntries(h.map(([k, v]) => [k.toLowerCase(), v]));
  }
  return Object.fromEntries(
    Object.entries(h as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses same-origin relative paths", async () => {
    const calls = mockFetch(() => jsonResponse({ cash_balance: 0, positions: [], total_value: 0, realized_pnl: 0 }));
    await api.getPortfolio();
    expect(calls[0].url).toBe("/api/portfolio");
  });

  it("attaches a request_id to /api/portfolio/trade by default", async () => {
    const calls = mockFetch(() =>
      jsonResponse({
        id: "t1",
        ticker: "AAPL",
        side: "buy",
        quantity: 10,
        price: 191.2,
        cost_basis: 191.2,
        executed_at: "2026-05-08T12:00:00Z",
        cash_balance: 8088,
        position_quantity: 10,
      }),
    );

    await api.trade({ ticker: "aapl", quantity: 10, side: "buy" });
    const body = calls[0].body as { ticker: string; request_id?: string };
    expect(body.ticker).toBe("AAPL");
    expect(typeof body.request_id).toBe("string");
    expect(body.request_id?.length).toBeGreaterThan(8);
    expect(calls[0].headers["content-type"]).toBe("application/json");
  });

  it("respects an explicit request_id and skips when idempotent=false", async () => {
    const calls = mockFetch(() =>
      jsonResponse({
        id: "t1",
        ticker: "AAPL",
        side: "buy",
        quantity: 1,
        price: 1,
        cost_basis: 1,
        executed_at: "2026-05-08T12:00:00Z",
        cash_balance: 0,
        position_quantity: 0,
      }),
    );

    await api.trade({ ticker: "AAPL", quantity: 1, side: "buy", request_id: "fixed-id" });
    expect((calls[0].body as { request_id: string }).request_id).toBe("fixed-id");

    calls.length = 0;
    await api.trade({ ticker: "AAPL", quantity: 1, side: "buy" }, { idempotent: false });
    expect((calls[0].body as { request_id?: string }).request_id).toBeUndefined();
  });

  it("encodes ?range= for /api/portfolio/history", async () => {
    const calls = mockFetch(() => jsonResponse({ range: "1w", snapshots: [] }));
    await api.getHistory("1w");
    expect(calls[0].url).toBe("/api/portfolio/history?range=1w");
  });

  it("DELETEs /api/watchlist/{ticker} with 204 No Content", async () => {
    const calls = mockFetch(() => new Response(null, { status: 204 }));
    await expect(api.removeFromWatchlist("aapl")).resolves.toBeUndefined();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("/api/watchlist/AAPL");
  });

  it("throws ApiError carrying code + message on 4xx", async () => {
    mockFetch(() => jsonResponse({ error: "insufficient_cash", message: "Need $500 more" }, 400));
    await expect(
      api.trade({ ticker: "AAPL", quantity: 1000, side: "buy" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "insufficient_cash",
      message: "Need $500 more",
    });
  });

  it("falls back to a synthetic envelope when the server doesn't send one", async () => {
    mockFetch(() => new Response("Internal", { status: 500 }));
    const err = await api.getPortfolio().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("unknown_error");
    expect((err as ApiError).status).toBe(500);
  });

  it("uuid() generates RFC4122-shaped strings", () => {
    const id = __internals.uuid();
    // 8-4-4-4-12 hex with v4 marker in third group
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
