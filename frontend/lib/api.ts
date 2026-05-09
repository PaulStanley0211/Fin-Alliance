/**
 * Typed fetch client for FinAlly's REST API.
 *
 * All paths are same-origin relative — the FastAPI app serves both the API
 * and the static Next.js export from the same port. Never hard-code a host.
 */

import type {
  ApiErrorBody,
  ChatRequestBody,
  ChatStreamCallbacks,
  ChatStreamDone,
  HealthResponse,
  HistoryRange,
  HistoryResponse,
  PortfolioResponse,
  SectorsResponse,
  TickerHistoryRange,
  TickerHistoryResponse,
  TradeRequestBody,
  TradeResponse,
} from "./types";

/**
 * Thrown for any non-2xx response. Carries the parsed error envelope when
 * the server provided one, plus the raw status code.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error;
  }
}

interface FetchOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = opts;

  const init: RequestInit = {
    method,
    signal,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(path, init);

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    const envelope = isErrorEnvelope(parsed)
      ? parsed
      : { error: "unknown_error", message: text || res.statusText };
    throw new ApiError(res.status, envelope);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isErrorEnvelope(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/**
 * Parse a single SSE event block (`event: NAME\ndata: JSON`) and route the
 * payload to the right callback. Unknown event types and unparseable data
 * are silently ignored — the chat panel doesn't need to crash on a stray
 * heartbeat or proxy-injected comment line.
 */
function dispatchSseBlock(block: string, cb: ChatStreamCallbacks): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
    // ":"-prefixed comment lines (heartbeats) and anything else are ignored.
  }
  if (dataLines.length === 0) return;
  const dataStr = dataLines.join("\n");
  let payload: unknown;
  try {
    payload = JSON.parse(dataStr);
  } catch {
    return;
  }
  if (typeof payload !== "object" || payload === null) return;

  switch (eventName) {
    case "delta": {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) {
        cb.onDelta?.(text);
      }
      return;
    }
    case "done":
      cb.onDone?.(payload as ChatStreamDone);
      return;
    case "error": {
      const message =
        typeof (payload as { message?: unknown }).message === "string"
          ? ((payload as { message: string }).message)
          : "The assistant call failed.";
      const error =
        typeof (payload as { error?: unknown }).error === "string"
          ? ((payload as { error: string }).error)
          : "llm_call_failed";
      cb.onError?.(error, message);
      return;
    }
    default:
      return;
  }
}

/**
 * crypto.randomUUID() is available everywhere we ship (modern browsers + Node 18+).
 * If for some reason it isn't, fall back to a v4-shaped string.
 */
function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // RFC4122 v4 fallback — sufficient for idempotency keys, not security.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---- Portfolio ------------------------------------------------------------

export const api = {
  /** GET /api/portfolio — current cash, positions, total value, realized P&L. */
  getPortfolio(signal?: AbortSignal): Promise<PortfolioResponse> {
    return request<PortfolioResponse>("/api/portfolio", { signal });
  },

  /**
   * POST /api/portfolio/trade — execute a market order.
   *
   * Always attaches a `request_id` so the call is idempotent: refreshing or
   * retrying after a flaky network won't double-execute. Callers can pass an
   * explicit `request_id` (LLM-initiated trades skip it per §8); otherwise
   * one is generated per call.
   */
  trade(
    body: TradeRequestBody,
    opts: { signal?: AbortSignal; idempotent?: boolean } = {},
  ): Promise<TradeResponse> {
    const { signal, idempotent = true } = opts;
    const finalBody: TradeRequestBody = {
      ...body,
      ticker: body.ticker.toUpperCase(),
      request_id: body.request_id ?? (idempotent ? uuid() : undefined),
    };
    return request<TradeResponse>("/api/portfolio/trade", {
      method: "POST",
      body: finalBody,
      signal,
    });
  },

  /** GET /api/portfolio/history — snapshots for the P&L chart. */
  getHistory(
    range: HistoryRange = "1d",
    signal?: AbortSignal,
  ): Promise<HistoryResponse> {
    const qs = new URLSearchParams({ range });
    return request<HistoryResponse>(`/api/portfolio/history?${qs.toString()}`, {
      signal,
    });
  },

  // ---- Sectors -----------------------------------------------------------

  getSectors(signal?: AbortSignal): Promise<SectorsResponse> {
    return request<SectorsResponse>("/api/sectors", { signal });
  },

  // ---- Per-ticker price history ------------------------------------------

  getTickerHistory(
    ticker: string,
    range: TickerHistoryRange = "1d",
    signal?: AbortSignal,
  ): Promise<TickerHistoryResponse> {
    const qs = new URLSearchParams({ range });
    return request<TickerHistoryResponse>(
      `/api/history/${ticker.toUpperCase()}?${qs.toString()}`,
      { signal },
    );
  },

  // ---- Chat --------------------------------------------------------------

  /**
   * POST /api/chat as a server-sent-events stream.
   *
   * The server emits three event types: `delta` (incremental reply text),
   * `done` (final action envelope), and `error` (fallback path). We parse
   * the byte stream and dispatch to the callbacks the caller supplied.
   *
   * Resolves when the stream closes cleanly (after `done` or `error`).
   * Rejects with an ApiError if the initial HTTP call returns a non-2xx
   * response (e.g. validation 400). Network/abort errors propagate as the
   * native fetch error so the caller can branch on `signal.aborted`.
   */
  async chatStream(
    body: ChatRequestBody,
    callbacks: ChatStreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const parsed = safeJson(text);
      const envelope = isErrorEnvelope(parsed)
        ? parsed
        : { error: "unknown_error", message: text || res.statusText };
      throw new ApiError(res.status, envelope);
    }

    if (!res.body) {
      throw new ApiError(500, {
        error: "no_stream",
        message: "Streaming not supported by this response.",
      });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Emit each complete `event:\ndata:\n\n` block we can parse out.
        let sepIdx = buffer.indexOf("\n\n");
        while (sepIdx >= 0) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          dispatchSseBlock(block, callbacks);
          sepIdx = buffer.indexOf("\n\n");
        }
      }
      // Drain any trailing event without a blank-line terminator (rare).
      const tail = buffer.trim();
      if (tail) dispatchSseBlock(tail, callbacks);
    } finally {
      reader.releaseLock();
    }
  },

  // ---- Health ------------------------------------------------------------

  getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    return request<HealthResponse>("/api/health", { signal });
  },
};

// Exposed for tests
export const __internals = { uuid, isErrorEnvelope };
