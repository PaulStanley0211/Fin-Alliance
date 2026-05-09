"""Pydantic schemas for LLM I/O.

Two layers:

1. **LLM structured output** — what the model returns: `LLMResponse` containing
   `message`, `trades[]`, and `watchlist_changes[]`. This is what we pass to
   LiteLLM as `response_format` so we get JSON-schema-validated output back.

2. **Wire envelope** — what `/api/chat` returns to the frontend (and what gets
   persisted in `chat_messages.actions`): `ChatResponseEnvelope` containing the
   *outcomes* of each action (`status`, `price`, `error`). See PLAN.md §9.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---- LLM structured output ----------------------------------------------- #


class TradeRequest(BaseModel):
    """A trade the LLM wants to execute. Validated against portfolio at execution."""

    model_config = ConfigDict(extra="ignore")

    ticker: str = Field(description="Ticker symbol, e.g. 'AAPL'.")
    side: Literal["buy", "sell"] = Field(description="Order side.")
    quantity: float = Field(gt=0, description="Number of shares (fractional allowed).")

    @field_validator("ticker", mode="before")
    @classmethod
    def _normalise_ticker(cls, v: object) -> str:
        if not isinstance(v, str):
            raise ValueError("ticker must be a string")
        return v.strip().upper()


class WatchlistChange(BaseModel):
    """A watchlist add/remove the LLM wants to execute."""

    model_config = ConfigDict(extra="ignore")

    ticker: str = Field(description="Ticker symbol, e.g. 'PYPL'.")
    action: Literal["add", "remove"] = Field(description="Watchlist operation.")

    @field_validator("ticker", mode="before")
    @classmethod
    def _normalise_ticker(cls, v: object) -> str:
        if not isinstance(v, str):
            raise ValueError("ticker must be a string")
        return v.strip().upper()


class LLMResponse(BaseModel):
    """Structured output schema the LLM is asked to produce.

    `message` is required; the action arrays default to empty so the LLM may
    omit them entirely on pure-analysis turns.
    """

    model_config = ConfigDict(extra="ignore")

    message: str = Field(description="Conversational reply to show the user.")
    trades: list[TradeRequest] = Field(
        default_factory=list,
        description="Trades to auto-execute. Empty unless the user explicitly asked.",
    )
    watchlist_changes: list[WatchlistChange] = Field(
        default_factory=list,
        description="Watchlist add/remove operations to apply.",
    )


# ---- Wire envelope (PLAN.md §9) ------------------------------------------ #

ActionStatus = Literal["executed", "rejected"]
ExecutionError = Literal[
    "insufficient_cash",
    "insufficient_shares",
    "ticker_unsupported",
    "watchlist_full",
    "watchlist_disabled",
    "price_unavailable",
    "invalid_quantity",
    "duplicate_request",
    "invalid_request",
    "internal_error",
]


class ExecutedTrade(BaseModel):
    """Result of attempting one LLM-emitted trade."""

    ticker: str
    side: Literal["buy", "sell"]
    quantity: float
    status: ActionStatus
    price: float | None = None
    error: ExecutionError | None = None


class ExecutedWatchlistChange(BaseModel):
    """Result of attempting one LLM-emitted watchlist change."""

    ticker: str
    action: Literal["add", "remove"]
    status: ActionStatus
    error: ExecutionError | None = None


class ChatResponseEnvelope(BaseModel):
    """The exact shape returned by `POST /api/chat` and stored in
    `chat_messages.actions` (minus the top-level `error`).

    `error` is non-null only when the LLM call itself failed (network, parse).
    In that case `message` is a fallback string and the action arrays are empty.
    """

    message: str
    executed_trades: list[ExecutedTrade] = Field(default_factory=list)
    executed_watchlist_changes: list[ExecutedWatchlistChange] = Field(default_factory=list)
    error: str | None = None


# ---- Portfolio context for the system prompt ----------------------------- #


class PortfolioPosition(BaseModel):
    """One position with live pricing — fed into the system prompt."""

    ticker: str
    quantity: float
    avg_cost: float
    current_price: float
    unrealized_pnl: float
    unrealized_pnl_percent: float


class WatchlistEntry(BaseModel):
    """One watchlist row with the latest streamed price."""

    ticker: str
    current_price: float | None = None


class PortfolioContext(BaseModel):
    """Snapshot of the user's portfolio state used to ground the LLM."""

    cash_balance: float
    positions: list[PortfolioPosition] = Field(default_factory=list)
    watchlist: list[WatchlistEntry] = Field(default_factory=list)
    total_value: float
