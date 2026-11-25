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
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="user", nullable=False)
    base_currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    theme_preference: Mapped[str] = mapped_column(String(16), default="light", nullable=False)
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    wallets: Mapped[list["WalletModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    orders: Mapped[list["OrderModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    positions: Mapped[list["PositionModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
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
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # BUY / SELL
    order_mode: Mapped[str] = mapped_column(String(16), default="MARKET", nullable=False)  # MARKET / LIMIT / STOP
    status: Mapped[str] = mapped_column(String(16), default="FILLED", nullable=False)  # PENDING / FILLED / CANCELLED
    price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    limit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    charges: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["UserModel"] = relationship(back_populates="orders")


class PositionModel(Base):
    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_position_user_symbol"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    side: Mapped[str] = mapped_column(String(8), default="BUY", nullable=False)  # BUY / SHORT
    qty: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_entry_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    current_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    unrealized_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    user: Mapped["UserModel"] = relationship(back_populates="positions")


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
