"""Pydantic request/response models for the REST API.

All response shapes are stable contracts — frontend, tests, and the LLM
chat envelope all consume them. Field order, names, and nullability matter.

Error responses follow a single envelope: `{"error": "<code>", "message":
"<human>"}`. Codes used: ticker_unsupported, watchlist_full, insufficient_cash,
insufficient_shares, duplicate_request, invalid_request.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class ErrorEnvelope(BaseModel):
    error: str
    message: str


# --------------------------------------------------------------------------
# Portfolio
# --------------------------------------------------------------------------


class Position(BaseModel):
    ticker: str
    quantity: float
    avg_cost: float
    current_price: float | None
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_percent: float


class PortfolioResponse(BaseModel):
    cash_balance: float
    positions: list[Position]
    total_value: float
    realized_pnl: float


TradeSide = Literal["buy", "sell"]


class TradeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    ticker: str = Field(..., min_length=1, max_length=10)
    quantity: float = Field(..., gt=0)
    side: TradeSide
    request_id: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("ticker")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


class TradeResponse(BaseModel):
    """Outcome of an executed (or deduped) trade.

    `cash_balance` and `position_quantity` reflect post-trade state so the
    frontend can refresh without an extra round-trip.
    """

    id: str
    ticker: str
    side: TradeSide
    quantity: float
    price: float
    cost_basis: float | None
    executed_at: str
    cash_balance: float
    position_quantity: float


class HistorySnapshot(BaseModel):
    total_value: float
    recorded_at: str


class HistoryResponse(BaseModel):
    range: Literal["1h", "1d", "1w", "1m", "all"]
    snapshots: list[HistorySnapshot]


# --------------------------------------------------------------------------
# Watchlist
# --------------------------------------------------------------------------


class WatchlistEntry(BaseModel):
    ticker: str
    price: float | None
    previous_price: float | None
    direction: Literal["up", "down", "flat"] | None
    timestamp: float | None


class WatchlistResponse(BaseModel):
    tickers: list[WatchlistEntry]


class WatchlistAddRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    ticker: str = Field(..., min_length=1, max_length=10)

    @field_validator("ticker")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


# --------------------------------------------------------------------------
# Sectors
# --------------------------------------------------------------------------


class SectorEntry(BaseModel):
    id: str
    label: str
    tickers: list[str]


class SectorsResponse(BaseModel):
    version: str
    sectors: list[SectorEntry]


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------


class HealthResponse(BaseModel):
    status: Literal["ok", "error"]
    db: Literal["ready", "error"]
    market_data: Literal["running", "warming", "closed", "error"]
