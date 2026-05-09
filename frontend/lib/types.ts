/**
 * Wire types — mirrors backend/app/api/schemas.py and backend/app/llm/schemas.py.
 *
 * Keep these in lock-step with the Pydantic models. When the backend changes a
 * shape, change it here too — both sides are part of the same contract.
 */

// ---- Errors --------------------------------------------------------------

export type ApiErrorCode =
  | "ticker_unsupported"
  | "watchlist_full"
  | "insufficient_cash"
  | "insufficient_shares"
  | "duplicate_request"
  | "invalid_request"
  | "price_unavailable"
  | string; // tolerate unknown future codes

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
}

// ---- Portfolio -----------------------------------------------------------

export type TradeSide = "buy" | "sell";
export type Direction = "up" | "down" | "flat";
export type MarketStatus = "open" | "closed" | "warming";
export type HistoryRange = "1h" | "1d" | "1w" | "1m" | "all";

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number | null;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
}

export interface PortfolioResponse {
  cash_balance: number;
  positions: Position[];
  total_value: number;
  realized_pnl: number;
}

export interface TradeRequestBody {
  ticker: string;
  quantity: number;
  side: TradeSide;
  request_id?: string;
}

export interface TradeResponse {
  id: string;
  ticker: string;
  side: TradeSide;
  quantity: number;
  price: number;
  cost_basis: number | null;
  executed_at: string;
  cash_balance: number;
  position_quantity: number;
}

export interface HistorySnapshot {
  total_value: number;
  recorded_at: string;
}

export interface HistoryResponse {
  range: HistoryRange;
  snapshots: HistorySnapshot[];
}

// ---- Watchlist -----------------------------------------------------------

export interface WatchlistEntry {
  ticker: string;
  price: number | null;
  previous_price: number | null;
  direction: Direction | null;
  timestamp: number | null;
}

export interface WatchlistResponse {
  tickers: WatchlistEntry[];
}

// ---- Sectors -------------------------------------------------------------

export interface Sector {
  id: string;
  label: string;
  tickers: string[];
}

export interface SectorsResponse {
  version: string;
  sectors: Sector[];
}

// ---- Per-ticker price history --------------------------------------------

export type TickerHistoryRange = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

export interface TickerHistoryResponse {
  ticker: string;
  range: TickerHistoryRange;
  /** [unix_seconds, close_price] tuples, oldest first. */
  points: Array<[number, number]>;
}

// ---- Stream (SSE) --------------------------------------------------------

/**
 * One ticker's payload inside an SSE `data:` event.
 * The whole event is `Record<ticker, StreamPriceUpdate>`.
 */
export interface StreamPriceUpdate {
  ticker: string;
  price: number;
  previous_price: number;
  timestamp: number;
  change: number;
  change_percent: number;
  direction: Direction;
  /**
   * `market_status` is documented in PLAN.md §6 but is not yet emitted by the
   * server (known gap, backend-engineer to patch later). Treat as optional
   * and infer "open" when absent for now.
   */
  market_status?: MarketStatus;
}

// ---- Chat ----------------------------------------------------------------

export type ActionStatus = "executed" | "rejected";

export type ExecutionError =
  | "insufficient_cash"
  | "insufficient_shares"
  | "ticker_unsupported"
  | "watchlist_full"
  | "watchlist_disabled"
  | "invalid_quantity"
  | "internal_error";

export interface ExecutedTrade {
  ticker: string;
  side: TradeSide;
  quantity: number;
  status: ActionStatus;
  price: number | null;
  error: ExecutionError | null;
}

export interface ExecutedWatchlistChange {
  ticker: string;
  action: "add" | "remove";
  status: ActionStatus;
  error: ExecutionError | null;
}

export interface ChatResponseEnvelope {
  message: string;
  executed_trades: ExecutedTrade[];
  executed_watchlist_changes: ExecutedWatchlistChange[];
  error: string | null;
}

export interface ChatRequestBody {
  message: string;
}

// ---- Streaming chat ------------------------------------------------------

/**
 * Final SSE `done` payload emitted at the end of a successful chat turn.
 * Mirrors the §9 envelope minus `message` (which is reconstructed from the
 * stream of `delta` events on the client side).
 */
export interface ChatStreamDone {
  executed_trades: ExecutedTrade[];
  executed_watchlist_changes: ExecutedWatchlistChange[];
  error: string | null;
}

/**
 * Callbacks the chat UI passes into `api.chatStream`. Each is optional so
 * tests / utilities can opt into only the events they care about.
 */
export interface ChatStreamCallbacks {
  onDelta?: (text: string) => void;
  onDone?: (envelope: ChatStreamDone) => void;
  onError?: (error: string, message: string) => void;
}

// ---- Health --------------------------------------------------------------

export interface HealthResponse {
  status: "ok" | "error";
  db: "ready" | "error";
  market_data: "running" | "warming" | "error";
}

// ---- Auth ----------------------------------------------------------------

export interface AuthUserView {
  id: string;
  username: string;
}

export interface AuthCredentialsBody {
  username: string;
  password: string;
}
