from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid_str() -> str:
    return str(uuid.uuid4())


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), default="Trader", nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="owner", nullable=False)
    base_currency: Mapped[str] = mapped_column(String(10), default="INR", nullable=False)
    theme_preference: Mapped[str] = mapped_column(String(16), default="light", nullable=False)
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    accepted_risk_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    wallets: Mapped[list["WalletModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    orders: Mapped[list["OrderModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    positions: Mapped[list["PositionModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    closed_trades: Mapped[list["ClosedTradeModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    activity_logs: Mapped[list["ActivityLogModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    layouts: Mapped[list["ChartLayoutModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    watchlists: Mapped[list["UserWatchlistModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    alerts: Mapped[list["UserAlertModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class WalletModel(Base):
    __tablename__ = "wallets"
    __table_args__ = (UniqueConstraint("user_id", "currency", name="uq_wallet_user_currency"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False)
    balance: Mapped[float] = mapped_column(Float, default=100000.0, nullable=False)
    equity: Mapped[float] = mapped_column(Float, default=100000.0, nullable=False)
    margin_used: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="wallets")


class OrderModel(Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_user_status", "user_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    country: Mapped[str] = mapped_column(String(16), default="USA", nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # BUY / SELL
    order_mode: Mapped[str] = mapped_column(String(16), default="MARKET", nullable=False)  # MARKET / LIMIT / STOP
    product_type: Mapped[str] = mapped_column(String(16), default="DELIVERY", nullable=False)  # DELIVERY / INTRADAY / FUTURES / OPTIONS
    broker_plan: Mapped[str] = mapped_column(String(16), default="DISCOUNT", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="FILLED", nullable=False)  # PENDING / FILLED / CANCELLED / REJECTED
    price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    limit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    gross_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    charges: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    brokerage: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stt_or_ftt: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stamp_duty: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    exchange_fee: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    regulator_fee: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    gst_vat: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    dp_or_clearing_fee: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    tax_breakdown_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    net_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    trailing_sl: Mapped[float | None] = mapped_column(Float, nullable=True)
    reject_reason: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    notes: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["UserModel"] = relationship(back_populates="orders")


class PositionModel(Base):
    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("user_id", "symbol", "product_type", name="uq_position_user_symbol_prod"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    country: Mapped[str] = mapped_column(String(16), default="USA", nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    side: Mapped[str] = mapped_column(String(8), default="BUY", nullable=False)  # BUY / SHORT
    product_type: Mapped[str] = mapped_column(String(16), default="DELIVERY", nullable=False)
    leverage: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    margin_blocked: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    entry_charges: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    qty: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_entry_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    current_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    unrealized_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    trailing_sl: Mapped[float | None] = mapped_column(Float, nullable=True)
    highest_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    lowest_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="positions")


class ClosedTradeModel(Base):
    __tablename__ = "closed_trades"
    __table_args__ = (Index("ix_closed_trades_user_country", "user_id", "country"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    country: Mapped[str] = mapped_column(String(16), default="USA", nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    product_type: Mapped[str] = mapped_column(String(16), default="DELIVERY", nullable=False)
    side: Mapped[str] = mapped_column(String(8), default="LONG", nullable=False)  # LONG / SHORT
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    exit_price: Mapped[float] = mapped_column(Float, nullable=False)
    gross_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    entry_charges: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    exit_charges: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_charges: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    net_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    est_tax: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    pnl_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    journal_note: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="closed_trades")


class TradeIdeaModel(Base):
    __tablename__ = "trade_ideas"
    __table_args__ = (Index("ix_trade_ideas_country_created", "country", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    author_name: Mapped[str] = mapped_column(String(80), default="Trader", nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    country: Mapped[str] = mapped_column(String(16), default="IND", nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="INR", nullable=False)
    direction: Mapped[str] = mapped_column(String(12), default="BULLISH", nullable=False)  # BULLISH / BEARISH
    product_type: Mapped[str] = mapped_column(String(16), default="INTRADAY", nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    target_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    timeframe: Mapped[str] = mapped_column(String(16), default="1D", nullable=False)
    thesis: Mapped[str] = mapped_column(Text, default="", nullable=False)
    likes_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class ChartLayoutModel(Base):
    __tablename__ = "chart_layouts"
    __table_args__ = (UniqueConstraint("user_id", "layout_name", name="uq_layout_user_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    layout_name: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), default="RELIANCE.NS", nullable=False)
    grid_type: Mapped[str] = mapped_column(String(16), default="1x1", nullable=False)
    json_drawing_state: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    active_indicators: Mapped[str] = mapped_column(Text, default='[{"fn":"ema","period":20}]', nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="layouts")


class UserWatchlistModel(Base):
    __tablename__ = "user_watchlists"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_watchlist_user_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), default="Primary", nullable=False)
    symbols_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="watchlists")


class UserAlertModel(Base):
    __tablename__ = "user_alerts"
    __table_args__ = (Index("ix_alerts_user_symbol", "user_id", "symbol"),)

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    condition: Mapped[str] = mapped_column(String(24), nullable=False)
    target_value: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    triggered_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="alerts")


class RefreshTokenModel(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class ActivityLogModel(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (Index("ix_activity_user_created", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(24), default="TRADE", nullable=False)  # AUTH, TRADE, RISK, WATCHLIST, SETTINGS
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    details: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="activity_logs")
