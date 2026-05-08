"""System prompt builder + message assembly for the FinAlly LLM.

The prompt grounds the model with the user's live portfolio state and
encodes the §9 "explicit intent" rule that prevents enthusiastic auto-trading.
"""

from __future__ import annotations

from typing import Iterable

from .schemas import PortfolioContext

# Keep the conversation window bounded (PLAN.md §9 step 2).
HISTORY_LIMIT = 20


SYSTEM_PROMPT_TEMPLATE = """You are FinAlly, an AI trading assistant integrated into a virtual trading workstation.

Your responsibilities:
- Analyze the user's portfolio composition, risk concentration, and P&L.
- Suggest trades with reasoning. ONLY emit a trade in `trades[]` when the user
  has explicitly stated an intent to buy or sell (with ticker and quantity) OR
  has explicitly agreed to a specific suggestion in this turn.
  Casual questions ("is my portfolio risky?", "what do you think of NVDA?")
  must return analysis only with an empty `trades` array.
- Manage the watchlist proactively: add/remove suggestions are lower-stakes
  than trades and may be made in response to clear contextual signals
  (e.g. "I'm curious about X").
- Be concise and data-driven.
- Always respond with valid JSON matching the required schema.

The user has $10,000 of *simulated* cash. Trades are market orders, instant fill,
no fees. Trades you emit auto-execute without confirmation.

If a requested trade would fail validation (insufficient cash, insufficient
shares, unsupported ticker), still emit it — the system will surface the
rejection to the user.

=== CURRENT PORTFOLIO ===
Cash balance: ${cash:.2f}
Total portfolio value: ${total:.2f}

Positions ({n_positions}):
{positions_block}

Watchlist ({n_watchlist}):
{watchlist_block}
=== END PORTFOLIO ===

Respond with JSON of shape:
{{"message": "...", "trades": [{{"ticker": "AAPL", "side": "buy", "quantity": 10}}], "watchlist_changes": [{{"ticker": "PYPL", "action": "add"}}]}}

Both `trades` and `watchlist_changes` may be empty arrays."""


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


def _format_watchlist(ctx: PortfolioContext) -> str:
    if not ctx.watchlist:
        return "  (none)"
    lines = []
    for w in ctx.watchlist:
        price = f"${w.current_price:.2f}" if w.current_price is not None else "—"
        lines.append(f"  {w.ticker}: {price}")
    return "\n".join(lines)


def build_system_prompt(ctx: PortfolioContext) -> str:
    """Render the system prompt with the user's current portfolio state."""
    return SYSTEM_PROMPT_TEMPLATE.format(
        cash=ctx.cash_balance,
        total=ctx.total_value,
        n_positions=len(ctx.positions),
        positions_block=_format_positions(ctx),
        n_watchlist=len(ctx.watchlist),
        watchlist_block=_format_watchlist(ctx),
    )


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
) -> list[dict[str, str]]:
    """Assemble the message list for LiteLLM.

    Order: system prompt, last `HISTORY_LIMIT` messages from the conversation
    history (oldest first), then the new user message.

    `history` may contain more than `HISTORY_LIMIT` items; we trim to the most
    recent. Each item must have `role` ('user' or 'assistant') and `content`.
    """
    history_list = _coerce_history(history)
    if len(history_list) > HISTORY_LIMIT:
        history_list = history_list[-HISTORY_LIMIT:]

    messages: list[dict[str, str]] = [
        {"role": "system", "content": build_system_prompt(ctx)},
    ]
    messages.extend(history_list)
    messages.append({"role": "user", "content": new_user_message})
    return messages
