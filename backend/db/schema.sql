-- FinAlly schema. See planning/PLAN.md §7.
-- All tables include user_id (UUID TEXT) to support multi-user. The legacy
-- "default" user_id is preserved as orphan data on existing databases for
-- backward compatibility but new accounts get fresh UUIDs.
-- UUIDs as TEXT, timestamps as ISO UTC TEXT.

-- Auth: a row per registered account. Created on POST /api/auth/signup.
-- The `id` here is what the rest of the schema uses as `user_id`.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS users_profile (
    id TEXT PRIMARY KEY,
    cash_balance REAL NOT NULL DEFAULT 10000.0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    ticker TEXT NOT NULL,
    quantity REAL NOT NULL,
    avg_cost REAL NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, ticker)
);

CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    ticker TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    cost_basis REAL,
    request_id TEXT,
    executed_at TEXT NOT NULL,
    UNIQUE (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    total_value REAL NOT NULL,
    recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    actions TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_user_executed
    ON trades (user_id, executed_at);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_recorded
    ON portfolio_snapshots (user_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_chat_user_created
    ON chat_messages (user_id, created_at);
