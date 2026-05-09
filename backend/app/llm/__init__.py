"""LLM integration for FinAlly.

Public API:
    LLMResponse         - Pydantic model for the structured LLM output
    TradeRequest        - Pydantic model for an LLM-emitted trade
    WatchlistChange     - Pydantic model for an LLM-emitted watchlist change
    ExecutedTrade       - Per-action result (status + price + error) for the wire envelope
    ExecutedWatchlistChange - Per-action result for the wire envelope
    ChatResponseEnvelope - Top-level wire response (PLAN.md §9)
    PortfolioContext    - Snapshot passed into the system prompt
    build_system_prompt - Constructs the system prompt with portfolio context
    build_messages      - Assembles system + history + new-user messages for the LLM
    stream_llm          - Async generator yielding (delta, payload) for SSE chat
    mock_llm            - Deterministic regex dispatch for E2E (PLAN.md §9 table)
    LLMCallError        - Raised when the LLM call/parse fails (caller falls back)
    DEFAULT_MODEL       - "anthropic/claude-haiku-4-5"
"""

from .client import DEFAULT_MODEL, LLMCallError, stream_llm
from .context import build_portfolio_context
from .executor import execute_actions
from .mock import mock_llm
from .prompt import build_messages, build_system_prompt
from .schemas import (
    ChatResponseEnvelope,
    ExecutedTrade,
    ExecutedWatchlistChange,
    LLMResponse,
    PortfolioContext,
    PortfolioPosition,
    TradeRequest,
    WatchlistChange,
    WatchlistEntry,
)

__all__ = [
    "DEFAULT_MODEL",
    "ChatResponseEnvelope",
    "ExecutedTrade",
    "ExecutedWatchlistChange",
    "LLMCallError",
    "LLMResponse",
    "PortfolioContext",
    "PortfolioPosition",
    "TradeRequest",
    "WatchlistChange",
    "WatchlistEntry",
    "build_messages",
    "build_portfolio_context",
    "build_system_prompt",
    "execute_actions",
    "mock_llm",
    "stream_llm",
]
