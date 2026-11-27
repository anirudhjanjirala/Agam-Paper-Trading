from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def resolve_database_url() -> str:
    raw = os.environ.get("DATABASE_URL", "").strip()
    if raw:
        if raw.startswith("postgres://"):
            return raw.replace("postgres://", "postgresql+psycopg://", 1)
        if raw.startswith("postgresql://") and "+psycopg" not in raw:
            return raw.replace("postgresql://", "postgresql+psycopg://", 1)
        return raw
    return "sqlite:///./agam_platform.db"


DATABASE_URL = resolve_database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False, "timeout": 15},
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _configure_sqlite_perf(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA cache_size=-32000")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=1800,
        future=True,
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    pass


def _migrate_existing_schema() -> None:
    """Safely adds new columns / composite position uniqueness on existing SQLite or PostgreSQL DBs."""
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())

    user_cols = {
        "display_name": "VARCHAR(120) NOT NULL DEFAULT 'Trader'",
        "accepted_risk_at": "DATETIME NULL",
        "last_login_at": "DATETIME NULL",
    }

    order_cols = {
        "country": "VARCHAR(16) NOT NULL DEFAULT 'USA'",
        "exchange": "VARCHAR(32) NOT NULL DEFAULT ''",
        "product_type": "VARCHAR(16) NOT NULL DEFAULT 'DELIVERY'",
        "broker_plan": "VARCHAR(16) NOT NULL DEFAULT 'DISCOUNT'",
        "gross_amount": "FLOAT NOT NULL DEFAULT 0.0",
        "brokerage": "FLOAT NOT NULL DEFAULT 0.0",
        "stt_or_ftt": "FLOAT NOT NULL DEFAULT 0.0",
        "stamp_duty": "FLOAT NOT NULL DEFAULT 0.0",
        "exchange_fee": "FLOAT NOT NULL DEFAULT 0.0",
        "regulator_fee": "FLOAT NOT NULL DEFAULT 0.0",
        "gst_vat": "FLOAT NOT NULL DEFAULT 0.0",
        "dp_or_clearing_fee": "FLOAT NOT NULL DEFAULT 0.0",
        "tax_breakdown_json": "TEXT NOT NULL DEFAULT '{}'",
        "realized_pnl": "FLOAT NOT NULL DEFAULT 0.0",
        "net_pnl": "FLOAT NOT NULL DEFAULT 0.0",
        "trailing_sl": "FLOAT NULL",
        "reject_reason": "VARCHAR(255) NOT NULL DEFAULT ''",
        "notes": "VARCHAR(255) NOT NULL DEFAULT ''",
    }

    pos_cols = {
        "country": "VARCHAR(16) NOT NULL DEFAULT 'USA'",
        "exchange": "VARCHAR(32) NOT NULL DEFAULT ''",
        "product_type": "VARCHAR(16) NOT NULL DEFAULT 'DELIVERY'",
        "leverage": "FLOAT NOT NULL DEFAULT 1.0",
        "margin_blocked": "FLOAT NOT NULL DEFAULT 0.0",
        "entry_charges": "FLOAT NOT NULL DEFAULT 0.0",
        "trailing_sl": "FLOAT NULL",
        "highest_price": "FLOAT NULL",
        "lowest_price": "FLOAT NULL",
        "opened_at": "DATETIME NULL",
    }

    with engine.begin() as conn:
        if "users" in existing_tables:
            curr_cols = {c["name"] for c in insp.get_columns("users")}
            for col_name, ddl in user_cols.items():
                if col_name not in curr_cols:
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {ddl}"))

        if "orders" in existing_tables:
            curr_cols = {c["name"] for c in insp.get_columns("orders")}
            for col_name, ddl in order_cols.items():
                if col_name not in curr_cols:
                    conn.execute(text(f"ALTER TABLE orders ADD COLUMN {col_name} {ddl}"))

        if "positions" in existing_tables:
            curr_cols = {c["name"] for c in insp.get_columns("positions")}
            needs_pos_rebuild = IS_SQLITE and ("product_type" not in curr_cols)
            for col_name, ddl in pos_cols.items():
                if col_name not in curr_cols:
                    conn.execute(text(f"ALTER TABLE positions ADD COLUMN {col_name} {ddl}"))

            if needs_pos_rebuild:
                conn.execute(text("PRAGMA foreign_keys=OFF"))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS positions_new (
                        id VARCHAR(36) PRIMARY KEY,
                        user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        symbol VARCHAR(32) NOT NULL,
                        name VARCHAR(160) NOT NULL DEFAULT '',
                        country VARCHAR(16) NOT NULL DEFAULT 'USA',
                        exchange VARCHAR(32) NOT NULL DEFAULT '',
                        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                        side VARCHAR(8) NOT NULL DEFAULT 'BUY',
                        product_type VARCHAR(16) NOT NULL DEFAULT 'DELIVERY',
                        leverage FLOAT NOT NULL DEFAULT 1.0,
                        margin_blocked FLOAT NOT NULL DEFAULT 0.0,
                        entry_charges FLOAT NOT NULL DEFAULT 0.0,
                        qty INTEGER NOT NULL DEFAULT 0,
                        avg_entry_price FLOAT NOT NULL DEFAULT 0.0,
                        current_price FLOAT NOT NULL DEFAULT 0.0,
                        unrealized_pnl FLOAT NOT NULL DEFAULT 0.0,
                        realized_pnl FLOAT NOT NULL DEFAULT 0.0,
                        stop_loss FLOAT NULL,
                        take_profit FLOAT NULL,
                        trailing_sl FLOAT NULL,
                        highest_price FLOAT NULL,
                        lowest_price FLOAT NULL,
                        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT uq_position_user_symbol_prod UNIQUE (user_id, symbol, product_type)
                    )
                """))
                conn.execute(text("""
                    INSERT INTO positions_new (
                        id, user_id, symbol, name, country, exchange, currency, side, product_type,
                        leverage, margin_blocked, entry_charges, qty, avg_entry_price, current_price,
                        unrealized_pnl, realized_pnl, stop_loss, take_profit, trailing_sl,
                        highest_price, lowest_price, opened_at, updated_at
                    )
                    SELECT
                        id, user_id, symbol, name,
                        CASE
                            WHEN symbol LIKE '%.NS' OR symbol LIKE '%.BO' THEN 'IND'
                            WHEN symbol LIKE '%.TO' OR symbol LIKE '%.V' THEN 'CANADA'
                            WHEN symbol LIKE '%.SS' OR symbol LIKE '%.SZ' THEN 'CHINA'
                            WHEN symbol LIKE '%.L' OR symbol LIKE '%.DE' OR symbol LIKE '%.PA' OR symbol LIKE '%.AS' OR symbol LIKE '%.MI' THEN 'EU'
                            ELSE 'USA'
                        END,
                        exchange, currency, side, 'DELIVERY',
                        1.0, avg_entry_price * qty, 0.0, qty, avg_entry_price, current_price,
                        unrealized_pnl, realized_pnl, stop_loss, take_profit, trailing_sl,
                        avg_entry_price, avg_entry_price, COALESCE(updated_at, CURRENT_TIMESTAMP), COALESCE(updated_at, CURRENT_TIMESTAMP)
                    FROM positions
                """))
                conn.execute(text("DROP TABLE positions"))
                conn.execute(text("ALTER TABLE positions_new RENAME TO positions"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_positions_user_id ON positions(user_id)"))
                conn.execute(text("PRAGMA foreign_keys=ON"))
            elif not IS_SQLITE:
                conn.execute(text("ALTER TABLE positions DROP CONSTRAINT IF EXISTS uq_position_user_symbol"))
                conn.execute(text("""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_position_user_symbol_prod') THEN
                            ALTER TABLE positions ADD CONSTRAINT uq_position_user_symbol_prod UNIQUE (user_id, symbol, product_type);
                        END IF;
                    END $$;
                """))


def init_db() -> None:
    from core import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_existing_schema()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
