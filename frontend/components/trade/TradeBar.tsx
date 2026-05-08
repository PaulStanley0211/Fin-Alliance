"use client";

import { useRef, useState, type FormEvent } from "react";

import { ApiError, api } from "@/lib/api";
import { usePortfolio } from "@/lib/portfolio";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";
import { useWatchlist } from "@/lib/watchlist";
import type { TradeSide } from "@/lib/types";

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const ERROR_MESSAGES: Record<string, string> = {
  insufficient_cash: "Not enough cash to buy that quantity.",
  insufficient_shares: "You don't own that many shares to sell.",
  ticker_unsupported: "Unknown ticker. Set MASSIVE_API_KEY for full coverage.",
  watchlist_full: "Watchlist is full (max 25).",
  invalid_request: "Invalid trade input.",
  duplicate_request: "Duplicate trade ignored.",
  price_unavailable: "Price unavailable. Try again in a moment.",
};

/**
 * Compact market-order trade bar. One ticker input, one quantity input,
 * Buy + Sell buttons. After a successful trade we refresh portfolio +
 * watchlist (a buy may auto-add a new ticker per §8).
 *
 * Idempotency (PLAN.md §8):
 *
 * 1. **Synchronous in-flight guard** — `inFlightRef.current` is set
 *    *before* the await point. React's `useState` updates asynchronously,
 *    so two click handlers firing in the same task can both clear the
 *    pending check before either has caused a re-render. The ref's
 *    `.current` updates synchronously and closes that race.
 *
 * 2. **Stable request_id per attempt** — we hold the UUID in a ref and
 *    only regenerate it after the server confirms the trade (or rejects
 *    it). Any double-fire that *did* slip past guard 1 (e.g. concurrent
 *    Buy then Sell from a buggy callsite) would still share a
 *    request_id, so the server's `(user_id, request_id)` dedup catches
 *    the duplicate. Defense in depth.
 *
 * The button's `disabled` attribute remains as a UX hint; the two ref
 * guards are the actual correctness story.
 */
export function TradeBar() {
  const portfolio = usePortfolio();
  const watchlist = useWatchlist();
  const sse = useSseState();
  const [selected] = useSelectedTicker();

  const [ticker, setTicker] = useState("");
  const [qty, setQty] = useState("");
  const [pending, setPending] = useState<TradeSide | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Synchronous guards — see component docblock for the why.
  const inFlightRef = useRef(false);
  const pendingRequestIdRef = useRef<string | null>(null);

  const effectiveTicker = (ticker || selected || "").toUpperCase().trim();
  const numericQty = Number(qty);
  const isQtyValid = qty.length > 0 && Number.isFinite(numericQty) && numericQty > 0;
  const canSubmit = effectiveTicker.length >= 1 && isQtyValid && pending === null;

  const livePrice = effectiveTicker ? sse.prices[effectiveTicker]?.price : undefined;
  const estimateCost = livePrice && isQtyValid ? livePrice * numericQty : null;

  async function submit(side: TradeSide, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The ref check is what stops the rapid-double-click from firing two
    // requests; `canSubmit` is the React-state mirror that drives the
    // disabled UI but updates asynchronously.
    if (inFlightRef.current || !canSubmit) return;
    inFlightRef.current = true;

    // Stable request_id: generate once on the first attempt, reuse for any
    // racing retry, regenerate after success/failure.
    if (pendingRequestIdRef.current === null) {
      pendingRequestIdRef.current = uuid();
    }
    const requestId = pendingRequestIdRef.current;

    setPending(side);
    setError(null);
    setConfirmation(null);
    try {
      const res = await api.trade({
        ticker: effectiveTicker,
        quantity: numericQty,
        side,
        request_id: requestId,
      });
      setConfirmation(
        `${side === "buy" ? "Bought" : "Sold"} ${formatQty(res.quantity)} ${res.ticker} @ $${res.price.toFixed(2)}`,
      );
      setQty("");
      // Refresh portfolio + watchlist (a buy may auto-add a new ticker).
      await Promise.all([portfolio.refresh(), watchlist.refresh()]);
    } catch (e) {
      if (e instanceof ApiError) {
        setError({
          code: e.code,
          message: ERROR_MESSAGES[e.code] ?? e.message,
        });
      } else {
        setError({ code: "unknown_error", message: (e as Error).message });
      }
    } finally {
      // Clear *both* guards together so the next user gesture is a fresh
      // attempt with a fresh request_id.
      pendingRequestIdRef.current = null;
      inFlightRef.current = false;
      setPending(null);
    }
  }

  return (
    <div
      className="panel relative flex flex-col overflow-hidden"
      data-testid="trade-bar"
    >
      <form
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line-soft bg-bg-2/40"
      >
        <span className="eyebrow text-secondary-glow shrink-0">Trade</span>

        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          value={ticker}
          placeholder={selected ?? "TICKER"}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          className="input !py-1.5 w-28 uppercase tracking-terminal"
          aria-label="Ticker symbol"
          data-testid="trade-ticker"
          maxLength={10}
          list="watchlist-tickers"
        />
        <datalist id="watchlist-tickers">
          {watchlist.tickers.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={qty}
          placeholder="Qty"
          onChange={(e) => setQty(e.target.value)}
          className="input !py-1.5 w-28 tabular"
          aria-label="Quantity (fractional shares allowed)"
          data-testid="trade-quantity"
        />

        {estimateCost !== null ? (
          <span className="font-mono text-2xs text-ink-2 tracking-terminal">
            ≈ <span className="text-ink-0 tabular">${estimateCost.toFixed(2)}</span>
            <span className="text-ink-3 ml-1">@ ${livePrice?.toFixed(2)}</span>
          </span>
        ) : (
          <span className="font-mono text-2xs text-ink-3">market order</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="submit"
            onClick={(e) => submit("buy", e as unknown as FormEvent<HTMLFormElement>)}
            disabled={!canSubmit}
            data-testid="trade-buy"
            className="btn-buy"
            aria-busy={pending === "buy"}
          >
            {pending === "buy" ? "Buying…" : "Buy"}
          </button>
          <button
            type="submit"
            onClick={(e) => submit("sell", e as unknown as FormEvent<HTMLFormElement>)}
            disabled={!canSubmit}
            data-testid="trade-sell"
            className="btn-sell"
            aria-busy={pending === "sell"}
          >
            {pending === "sell" ? "Selling…" : "Sell"}
          </button>
        </div>
      </form>

      {error ? (
        <div
          className="px-3 py-1.5 border-b border-down/40 bg-down/10 font-mono text-2xs text-down flex items-center justify-between"
          role="alert"
          data-testid="trade-error"
          data-code={error.code}
        >
          <span>{error.message}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-down/70 hover:text-down ml-3"
          >
            ×
          </button>
        </div>
      ) : null}
      {confirmation ? (
        <div
          className="px-3 py-1.5 border-b border-up/40 bg-up/5 font-mono text-2xs text-up"
          role="status"
          data-testid="trade-confirmation"
        >
          {confirmation}
        </div>
      ) : null}
    </div>
  );
}

function formatQty(q: number): string {
  return Number.isInteger(q) ? q.toString() : q.toFixed(4).replace(/\.?0+$/, "");
}
