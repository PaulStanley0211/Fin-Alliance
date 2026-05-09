"""System prompt builder + message assembly for the FinAlly LLM.

Two-block system prompt:

1. **Static instructions** — role, rules, response format. Marked with
   ``cache_control={"type":"ephemeral"}`` so Anthropic re-uses the cached
   prefix on every follow-up turn within the 5-min TTL window.
2. **Dynamic portfolio block** — cash, total, positions. Re-rendered each
   turn from live state, so it sits *after* the cache breakpoint.

Concision is enforced via the system prompt and a bounded ``max_tokens`` on
the request side (see ``client.py``).
"""

from __future__ import annotations

from typing import Iterable

from .schemas import PortfolioContext

# Keep the conversation window bounded (PLAN.md §9 step 2).
HISTORY_LIMIT = 20


STATIC_INSTRUCTIONS = """You are FinAlly, an AI trading assistant inside a virtual workstation.

Style:
- Be brief. Default to 2-3 sentences. Use short bullets only when comparing 3+ items.
- Lead with the answer; data after.

Trading rules (auto-execution — there is no confirmation step):
- Only emit a trade in `trades[]` when the user has explicitly stated intent to buy or sell with a ticker and quantity, OR has explicitly agreed to a specific suggestion in this turn.
- Casual or analytical questions ("is my portfolio risky?", "thoughts on NVDA?") return analysis only, with `trades` empty.
- If a trade would fail validation, still emit it — the system surfaces the rejection.

Watchlist:
- All sector tickers stream live by default; there is no user-managed watchlist. Always return `watchlist_changes` as `[]`. If the user asks to add or remove from a watchlist, briefly explain it's no longer needed.

Cash is $10,000 simulated. Trades are instant-fill market orders, no fees.

Always respond with valid JSON: `{"message": "...", "trades": [...], "watchlist_changes": []}`."""


PORTFOLIO_BLOCK_TEMPLATE = """=== CURRENT PORTFOLIO ===
Cash balance: ${cash:.2f}
Total portfolio value: ${total:.2f}

Positions ({n_positions}):
{positions_block}
=== END PORTFOLIO ==="""


def _format_positions(ctx: PortfolioContext) -> str:
    if not ctx.positions:
        return "  (none)"
    lines = []
    for p in ctx.positions:
        lines.append(
            f"  {p.ticker}: {p.quantity:g} sh @ avg ${p.avg_cost:.2f} | "
            f"now ${p.current_price:.2f} | "
            f"unrealized P&L ${p.unrealized_pnl:+.2f} ({p.unrealized_pnl_percent:+.2f}%)"
        )
    return "\n".join(lines)


def build_portfolio_block(ctx: PortfolioContext) -> str:
    """Render the dynamic portfolio block. Recomputed every turn."""
    return PORTFOLIO_BLOCK_TEMPLATE.format(
        cash=ctx.cash_balance,
        total=ctx.total_value,
        n_positions=len(ctx.positions),
        positions_block=_format_positions(ctx),
    )


def build_system_prompt(ctx: PortfolioContext) -> str:
    """Render system prompt as a single string (used by tests / debug logs).

    Production code should use ``build_messages`` directly so the static
    instructions can be marked for prompt caching.
    """
    return f"{STATIC_INSTRUCTIONS}\n\n{build_portfolio_block(ctx)}"


def _coerce_history(history: Iterable[object]) -> list[dict[str, str]]:
    """Convert repo rows / dicts into LiteLLM-compatible {role, content} dicts.

    Accepts dicts (with at least `role` and `content`) or objects with those
    attributes. Skips anything malformed rather than crashing the chat path.
    """
    out: list[dict[str, str]] = []
    for item in history:
        if isinstance(item, dict):
            role = item.get("role")
            content = item.get("content")
        else:
            role = getattr(item, "role", None)
            content = getattr(item, "content", None)
        if role not in ("user", "assistant"):
            continue
        if not isinstance(content, str):
            continue
        out.append({"role": role, "content": content})
    return out


def build_messages(
    ctx: PortfolioContext,
    history: Iterable[object],
    new_user_message: str,
) -> list[dict]:
    """Assemble the message list for LiteLLM.

    The system message is split into two content blocks: the static
    instructions (with ``cache_control`` so Anthropic re-uses the cached
    prefix across turns) and the dynamic portfolio block (recomputed each
    turn). History is trimmed to the most recent ``HISTORY_LIMIT`` entries.
    """
    history_list = _coerce_history(history)
    if len(history_list) > HISTORY_LIMIT:
        history_list = history_list[-HISTORY_LIMIT:]

    messages: list[dict] = [
        {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": STATIC_INSTRUCTIONS,
                    "cache_control": {"type": "ephemeral"},
                },
                {
                    "type": "text",
                    "text": build_portfolio_block(ctx),
                },
            ],
        }
    ]
    messages.extend(history_list)
    messages.append({"role": "user", "content": new_user_message})
    return messages
