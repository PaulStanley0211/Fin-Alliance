"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { usePortfolio } from "@/lib/portfolio";
import { useSelectedTicker } from "@/lib/selection";
import { useSseState } from "@/lib/sse";
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
  ticker_unsupported: "Unknown ticker. Set a real-data API key for full coverage.",
  invalid_request: "Invalid trade input.",
  duplicate_request: "Duplicate trade ignored.",
  price_unavailable: "Price unavailable. Try again in a moment.",
};

const MIN_QTY = 1;

/**
 * Vertical trade bar pinned below the chat panel.
 *
 * Layout reads top-to-bottom:
 *   1. Selected ticker label + live price
 *   2. Quantity row: − / [N] / +  (integer stepper, also typeable)
 *   3. Buy / Sell row: equal-width buttons
 *
 * Selected ticker comes from `useSelectedTicker()` — there is no longer a
 * ticker input here. The watchlist row click is the entry gesture.
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
 *    it). Any double-fire that *did* slip past guard 1 would still share
 *    a request_id, so the server's `(user_id, request_id)` dedup catches
 *    the duplicate.
 */
export function TradeBar() {
  const portfolio = usePortfolio();
  const sse = useSseState();
  const [selected] = useSelectedTicker();

  const [qty, setQty] = useState<number>(MIN_QTY);
  const [pending, setPending] = useState<TradeSide | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Synchronous guards — see component docblock for the why.
  const inFlightRef = useRef(false);
  const pendingRequestIdRef = useRef<string | null>(null);

  // Reset the qty + transient banners when the user picks a new ticker.
  useEffect(() => {
    setQty(MIN_QTY);
    setError(null);
    setConfirmation(null);
  }, [selected]);

  const ticker = selected ?? null;
  const livePrice = ticker ? sse.prices[ticker]?.price : undefined;
  const estimateCost = livePrice && qty > 0 ? livePrice * qty : null;
  const canSubmit = ticker !== null && qty >= MIN_QTY && pending === null;

  function bumpQty(delta: number): void {
    setQty((q) => {
      const next = Math.max(MIN_QTY, Math.floor(q + delta));
      return Number.isFinite(next) ? next : MIN_QTY;
    });
  }

  function handleQtyInput(raw: string): void {
    if (raw.trim() === "") {
      // Allow the field to be momentarily empty during edit; clamp on blur.
      setQty(MIN_QTY);
      return;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    setQty(Math.max(MIN_QTY, n));
  }

  async function submit(side: TradeSide): Promise<void> {
    if (inFlightRef.current || !canSubmit || ticker === null) return;
    inFlightRef.current = true;

    if (pendingRequestIdRef.current === null) {
      pendingRequestIdRef.current = uuid();
    }
    const requestId = pendingRequestIdRef.current;

    setPending(side);
    setError(null);
    setConfirmation(null);
    try {
      const res = await api.trade({
        ticker,
        quantity: qty,
        side,
        request_id: requestId,
      });
      setConfirmation(
        `${side === "buy" ? "Bought" : "Sold"} ${formatQty(res.quantity)} ${res.ticker} @ $${res.price.toFixed(2)}`,
      );
      await portfolio.refresh();
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
      <div className="px-3 py-2 border-b border-line-soft bg-bg-2/40 flex items-center justify-between">
        <span className="eyebrow text-secondary-glow">Trade</span>
        <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
          market order
        </span>
      </div>

      {ticker === null ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3 px-3 py-3">
          {/* Row 1: ticker + live price */}
          <div className="flex items-baseline justify-between">
            <span
              className="font-mono text-base font-medium tracking-terminal text-ink-0"
              data-testid="trade-ticker"
            >
              {ticker}
            </span>
            <span className="font-mono text-sm tabular text-ink-1">
              {livePrice !== undefined ? (
                <>
                  <span className="text-ink-3 mr-0.5">$</span>
                  {livePrice.toFixed(2)}
                </>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </span>
          </div>

          {/* Row 2: quantity stepper */}
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-2">
              Quantity
            </span>
            <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => bumpQty(-1)}
                disabled={qty <= MIN_QTY || pending !== null}
                aria-label="Decrease quantity"
                data-testid="trade-qty-minus"
                className="font-mono text-base text-ink-1 border border-line-soft hover:border-line-strong hover:text-ink-0 bg-bg-2/60 rounded-sharp transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={MIN_QTY}
                step={1}
                value={qty}
                onChange={(e) => handleQtyInput(e.target.value)}
                onBlur={() => {
                  if (!Number.isFinite(qty) || qty < MIN_QTY) setQty(MIN_QTY);
                }}
                aria-label="Quantity"
                data-testid="trade-qty"
                disabled={pending !== null}
                className="input !py-1.5 text-center tabular text-base"
              />
              <button
                type="button"
                onClick={() => bumpQty(1)}
                disabled={pending !== null}
                aria-label="Increase quantity"
                data-testid="trade-qty-plus"
                className="font-mono text-base text-ink-1 border border-line-soft hover:border-line-strong hover:text-ink-0 bg-bg-2/60 rounded-sharp transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
            <span className="font-mono text-2xs tabular text-ink-3 h-3">
              {estimateCost !== null ? (
                <>
                  ≈{" "}
                  <span className="text-ink-1">${estimateCost.toFixed(2)}</span>
                </>
              ) : (
                ""
              )}
            </span>
          </div>

          {/* Row 3: Buy / Sell */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void submit("buy")}
              disabled={!canSubmit}
              data-testid="trade-buy"
              className="btn-buy py-2 text-sm"
              aria-busy={pending === "buy"}
            >
              {pending === "buy" ? "Buying…" : "Buy"}
            </button>
            <button
              type="button"
              onClick={() => void submit("sell")}
              disabled={!canSubmit}
              data-testid="trade-sell"
              className="btn-sell py-2 text-sm"
              aria-busy={pending === "sell"}
            >
              {pending === "sell" ? "Selling…" : "Sell"}
            </button>
          </div>
        </div>
      )}

      {error ? (
        <div
          className="px-3 py-1.5 border-t border-down/40 bg-down/10 font-mono text-2xs text-down flex items-center justify-between"
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
          className="px-3 py-1.5 border-t border-up/40 bg-up/5 font-mono text-2xs text-up"
          role="status"
          data-testid="trade-confirmation"
        >
          {confirmation}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="px-4 py-6 text-center"
      data-testid="trade-empty-state"
    >
      <p className="font-display italic text-ink-1">
        Select a ticker from the watchlist to trade
      </p>
    </div>
  );
}

function formatQty(q: number): string {
  return Number.isInteger(q) ? q.toString() : q.toFixed(4).replace(/\.?0+$/, "");
}
