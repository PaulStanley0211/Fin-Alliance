"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError, api } from "@/lib/api";
import { usePortfolio } from "@/lib/portfolio";
import { useWatchlist } from "@/lib/watchlist";
import type {
  ChatResponseEnvelope,
  ExecutedTrade,
  ExecutedWatchlistChange,
} from "@/lib/types";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
  actions?: {
    trades: ExecutedTrade[];
    watchlist_changes: ExecutedWatchlistChange[];
  };
  error?: string | null;
}

const ERROR_LABELS: Record<string, string> = {
  insufficient_cash: "insufficient cash",
  insufficient_shares: "insufficient shares",
  ticker_unsupported: "ticker not supported",
  watchlist_full: "watchlist full",
  invalid_quantity: "invalid quantity",
  internal_error: "internal error",
};

/**
 * AI Copilot chat panel.
 *
 * - Submit on Enter (Shift+Enter for newline) or via the Send button.
 * - Send button uses the secondary purple accent (#753991) per §10.
 * - While the request is in flight: input + button disabled, loading dot shown.
 * - Each assistant message renders the §9 envelope inline: trades and
 *   watchlist changes appear as small receipts (executed = green check
 *   with price; rejected = red x with translated error code).
 * - On a successful response, refresh portfolio + watchlist so the rest of
 *   the workstation reflects auto-executed actions.
 */
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portfolio = usePortfolio();
  const watchlist = useWatchlist();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the bottom when a new message lands.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    setPending(true);
    setError(null);

    try {
      const envelope: ChatResponseEnvelope = await api.chat({ message: text });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: envelope.message,
          actions: {
            trades: envelope.executed_trades,
            watchlist_changes: envelope.executed_watchlist_changes,
          },
          error: envelope.error,
        },
      ]);
      // If the LLM auto-executed anything, the rest of the app should reflect it.
      const didAct =
        envelope.executed_trades.length > 0 ||
        envelope.executed_watchlist_changes.length > 0;
      if (didAct) {
        await Promise.all([portfolio.refresh(), watchlist.refresh()]);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry — that didn't work. Please try again.",
          error: msg,
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = (e.target as HTMLTextAreaElement).form;
      form?.requestSubmit();
    }
  }

  return (
    <div
      className="panel flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="chat-panel"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft bg-bg-2/40">
        <div className="flex items-center gap-2">
          <span className="eyebrow text-secondary-glow">Copilot</span>
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-3">
            · FinAlly
          </span>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="relative flex-1 overflow-y-auto"
        data-testid="chat-scroller"
      >
        {messages.length === 0 && !pending ? (
          <EmptyState />
        ) : (
          <ul role="list" className="px-3 py-3 flex flex-col gap-3">
            {messages.map((m, i) => (
              <ChatBubble
                key={i}
                index={i}
                roleIndex={roleIndexFor(messages, i)}
                message={m}
              />
            ))}
            {pending ? <LoadingBubble /> : null}
          </ul>
        )}
      </div>

      {error ? (
        <div
          className="px-3 py-1.5 border-t border-down/40 bg-down/10 font-mono text-2xs text-down"
          role="alert"
          data-testid="chat-error"
        >
          {error}
        </div>
      ) : null}

      <form
        onSubmit={submit}
        className="border-t border-line-soft p-2 flex items-end gap-2 bg-bg-2/40"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask FinAlly anything…"
          className="input flex-1 resize-none !py-2 min-h-[2.25rem] max-h-32"
          rows={1}
          aria-label="Chat input"
          data-testid="chat-input"
          disabled={pending}
        />
        <button
          type="submit"
          className="btn-submit shrink-0"
          data-testid="chat-send"
          disabled={pending || draft.trim().length === 0}
          aria-busy={pending}
        >
          {pending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function ChatBubble({
  index,
  roleIndex,
  message,
}: {
  index: number;
  roleIndex: number;
  message: ChatMessage;
}) {
  const isUser = message.role === "user";
  // Both the flat and role-scoped testids live in the same `data-testid`
  // attribute, space-separated. Playwright matches on the attribute value;
  // the integration-tester suite uses `[data-testid~="…"]` so either token
  // resolves the same DOM node (per their contract).
  const flatId = `chat-message-${index}`;
  const roleId = `chat-message-${message.role}-${roleIndex}`;

  return (
    <li
      className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}
      data-testid={`${flatId} ${roleId}`}
      data-role={message.role}
    >
      <div
        className={`px-3 py-2 rounded-panel max-w-[95%] font-mono text-xs leading-relaxed whitespace-pre-wrap break-words border ${
          isUser
            ? "bg-primary/10 border-primary/30 text-ink-0"
            : "bg-bg-2 border-line text-ink-0"
        }`}
      >
        {message.content}
      </div>

      {message.actions &&
      (message.actions.trades.length > 0 ||
        message.actions.watchlist_changes.length > 0) ? (
        <div className="flex flex-col gap-1 max-w-[95%] w-full">
          {message.actions.trades.map((t, i) => (
            <TradeReceipt key={`t-${i}`} trade={t} />
          ))}
          {message.actions.watchlist_changes.map((w, i) => (
            <WatchlistReceipt key={`w-${i}`} change={w} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function TradeReceipt({ trade }: { trade: ExecutedTrade }) {
  const ok = trade.status === "executed";
  return (
    <div
      data-testid={`chat-action-trade-${trade.ticker}`}
      data-status={trade.status}
      className={`flex items-center gap-2 px-2 py-1 rounded-sharp font-mono text-2xs border ${
        ok
          ? "border-up/30 bg-up/10 text-up"
          : "border-down/30 bg-down/10 text-down"
      }`}
    >
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span>
      <span className="uppercase tracking-eyebrow font-medium">{trade.side}</span>
      <span className="tabular">{formatQty(trade.quantity)}</span>
      <span className="font-medium">{trade.ticker}</span>
      {ok && trade.price !== null ? (
        <span className="tabular text-ink-1">@ ${trade.price.toFixed(2)}</span>
      ) : null}
      {!ok && trade.error ? (
        <span className="text-ink-1 ml-auto">
          {ERROR_LABELS[trade.error] ?? trade.error}
        </span>
      ) : null}
    </div>
  );
}

function WatchlistReceipt({ change }: { change: ExecutedWatchlistChange }) {
  const ok = change.status === "executed";
  return (
    <div
      data-testid={`chat-action-watchlist-${change.ticker}`}
      data-status={change.status}
      className={`flex items-center gap-2 px-2 py-1 rounded-sharp font-mono text-2xs border ${
        ok
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-down/30 bg-down/10 text-down"
      }`}
    >
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span>
      <span className="uppercase tracking-eyebrow">{change.action}</span>
      <span className="font-medium">{change.ticker}</span>
      <span className="ml-auto text-ink-3">watchlist</span>
      {!ok && change.error ? (
        <span className="text-ink-1 ml-2">
          {ERROR_LABELS[change.error] ?? change.error}
        </span>
      ) : null}
    </div>
  );
}

function LoadingBubble() {
  return (
    <li
      className="flex items-start"
      data-testid="chat-loading"
      aria-live="polite"
      aria-label="Assistant is typing"
    >
      <div className="px-3 py-2 rounded-panel bg-bg-2 border border-line">
        <span className="inline-flex gap-1 items-center font-mono text-xs text-ink-2">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
      </div>
    </li>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-secondary-glow animate-pulse-dot"
      style={{ animationDelay: delay }}
    />
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-2">
      <p className="font-display text-lg text-ink-0 leading-snug">
        Ask FinAlly anything about your portfolio.
      </p>
      <p className="font-mono text-xs text-ink-2 max-w-[28ch]">
        Try <span className="text-accent">&ldquo;buy 10 NVDA&rdquo;</span> or{" "}
        <span className="text-accent">&ldquo;is my portfolio risky?&rdquo;</span>
      </p>
    </div>
  );
}

function roleIndexFor(messages: ChatMessage[], idx: number): number {
  let n = 0;
  for (let i = 0; i < idx; i++) {
    if (messages[i].role === messages[idx].role) n++;
  }
  return n;
}

function formatQty(q: number): string {
  return Number.isInteger(q) ? q.toString() : q.toFixed(4).replace(/\.?0+$/, "");
}
