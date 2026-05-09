"""Deterministic mock LLM (PLAN.md §9 LLM Mock Mode).

Used when LLM_MOCK=true. Implements the six-row regex dispatch table.
Patterns are evaluated in order; first match wins.

Spec §6 update: the watchlist concept was removed. The `watch` / `unwatch`
branches still emit a `watchlist_changes` action so the executor's rejection
path is exercised end-to-end, but the message text honestly tells the user
that watchlist actions are disabled.

| pattern                                       | response                                                |
| --------------------------------------------- | ------------------------------------------------------- |
| ^\\s*$ OR ^(hi|hello|hey)\\b                  | greeting                                                |
| \\bbuy\\s+(\\d+(?:\\.\\d+)?)\\s+([A-Z]{1,5})\\b | trade buy                                              |
| \\bsell\\s+(\\d+(?:\\.\\d+)?)\\s+([A-Z]{1,5})\\b | trade sell                                             |
| \\bwatch\\s+([A-Z]{1,5})\\b                   | watchlist add (executor rejects with watchlist_disabled) |
| \\b(unwatch|remove)\\s+([A-Z]{1,5})\\b        | watchlist remove (executor rejects with watchlist_disabled) |
| anything else                                 | "Mock response: I received '{user_message}'."           |
"""

from __future__ import annotations

import re

from .schemas import LLMResponse, TradeRequest, WatchlistChange

_GREETING = re.compile(r"^\s*$|^(hi|hello|hey)\b", re.IGNORECASE)
_BUY = re.compile(r"\bbuy\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})\b", re.IGNORECASE)
_SELL = re.compile(r"\bsell\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})\b", re.IGNORECASE)
_WATCH = re.compile(r"\bwatch\s+([A-Z]{1,5})\b", re.IGNORECASE)
_UNWATCH = re.compile(r"\b(?:unwatch|remove)\s+([A-Z]{1,5})\b", re.IGNORECASE)


def mock_llm(user_message: str) -> LLMResponse:
    """Return a deterministic LLMResponse for the given user message.

    Patterns are evaluated in the order listed in PLAN.md §9 — the first
    matching pattern wins, otherwise we fall through to the generic response.
    """
    text = user_message if isinstance(user_message, str) else ""

    if _GREETING.search(text):
        return LLMResponse(
            message="Hi, I'm FinAlly. Ask me about your portfolio.",
            trades=[],
            watchlist_changes=[],
        )

    m = _BUY.search(text)
    if m:
        qty = float(m.group(1))
        ticker = m.group(2).upper()
        return LLMResponse(
            message=f"Buying {_fmt_qty(qty)} {ticker}.",
            trades=[TradeRequest(ticker=ticker, side="buy", quantity=qty)],
            watchlist_changes=[],
        )

    m = _SELL.search(text)
    if m:
        qty = float(m.group(1))
        ticker = m.group(2).upper()
        return LLMResponse(
            message=f"Selling {_fmt_qty(qty)} {ticker}.",
            trades=[TradeRequest(ticker=ticker, side="sell", quantity=qty)],
            watchlist_changes=[],
        )

    m = _WATCH.search(text)
    if m:
        ticker = m.group(1).upper()
        return LLMResponse(
            message="Watchlist actions are disabled now that all sectors stream by default.",
            trades=[],
            watchlist_changes=[WatchlistChange(ticker=ticker, action="add")],
        )

    m = _UNWATCH.search(text)
    if m:
        ticker = m.group(1).upper()
        return LLMResponse(
            message="Watchlist actions are disabled now that all sectors stream by default.",
            trades=[],
            watchlist_changes=[WatchlistChange(ticker=ticker, action="remove")],
        )

    return LLMResponse(
        message=f"Mock response: I received '{text}'.",
        trades=[],
        watchlist_changes=[],
    )


def _fmt_qty(qty: float) -> str:
    """Render a quantity without a trailing '.0' for whole numbers."""
    if qty.is_integer():
        return str(int(qty))
    return f"{qty:g}"
