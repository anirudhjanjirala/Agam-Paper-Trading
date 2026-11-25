-- Agam Paper Trading Platform: Multi-Tenant PostgreSQL Schema (001)
-- Enforces strict per-user isolation via user_id foreign keys and indexes.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    base_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    theme_preference VARCHAR(16) NOT NULL DEFAULT 'light',
    is_guest BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(10) NOT NULL,
    balance DOUBLE PRECISION NOT NULL DEFAULT 100000.0,
    equity DOUBLE PRECISION NOT NULL DEFAULT 100000.0,
    margin_used DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    CONSTRAINT uq_wallet_user_currency UNIQUE (user_id, currency)
);
CREATE INDEX IF NOT EXISTS ix_wallets_user_id ON wallets(user_id);

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL DEFAULT '',
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    side VARCHAR(8) NOT NULL,
    order_mode VARCHAR(16) NOT NULL DEFAULT 'MARKET',
    status VARCHAR(16) NOT NULL DEFAULT 'FILLED',
    price DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    limit_price DOUBLE PRECISION NULL,
    qty INTEGER NOT NULL,
    charges DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    stop_loss DOUBLE PRECISION NULL,
    take_profit DOUBLE PRECISION NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    filled_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS ix_orders_user_status ON orders(user_id, status);

CREATE TABLE IF NOT EXISTS positions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL DEFAULT '',
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    side VARCHAR(8) NOT NULL DEFAULT 'BUY',
    qty INTEGER NOT NULL DEFAULT 0,
    avg_entry_price DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    current_price DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    unrealized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    stop_loss DOUBLE PRECISION NULL,
    take_profit DOUBLE PRECISION NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_position_user_symbol UNIQUE (user_id, symbol)
);
CREATE INDEX IF NOT EXISTS ix_positions_user_id ON positions(user_id);

CREATE TABLE IF NOT EXISTS chart_layouts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    layout_name VARCHAR(64) NOT NULL DEFAULT 'default',
    symbol VARCHAR(32) NOT NULL DEFAULT 'RELIANCE.NS',
    grid_type VARCHAR(16) NOT NULL DEFAULT '1x1',
    json_drawing_state TEXT NOT NULL DEFAULT '[]',
    active_indicators TEXT NOT NULL DEFAULT '[{"fn":"ema","period":20}]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_layout_user_name UNIQUE (user_id, layout_name)
);
CREATE INDEX IF NOT EXISTS ix_chart_layouts_user_id ON chart_layouts(user_id);

CREATE TABLE IF NOT EXISTS user_watchlists (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL DEFAULT 'Primary',
    symbols_json TEXT NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_watchlist_user_name UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS ix_user_watchlists_user_id ON user_watchlists(user_id);

CREATE TABLE IF NOT EXISTS user_alerts (
    id VARCHAR(48) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(32) NOT NULL,
    condition VARCHAR(24) NOT NULL,
    target_value DOUBLE PRECISION NOT NULL,
    note VARCHAR(255) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    triggered_count INTEGER NOT NULL DEFAULT 0,
    triggered_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_alerts_user_symbol ON user_alerts(user_id, symbol);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens(user_id);
