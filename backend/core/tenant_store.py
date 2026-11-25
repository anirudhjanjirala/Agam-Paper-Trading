from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from core.models import (
    ChartLayoutModel,
    OrderModel,
    PositionModel,
    UserAlertModel,
    UserWatchlistModel,
    WalletModel,
)
from core.paper_wallets import DEFAULT_WALLETS


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fmt_utc_time(dt: Optional[datetime]) -> str:
    if not dt:
        return _utcnow().strftime("%H:%M:%S UTC")
    return dt.strftime("%H:%M:%S UTC")


class TenantPortfolioService:
    """
    SQLAlchemy 2.0 multi-tenant paper trading service.
    Every query strictly filters by WHERE user_id = current_user.id.
    """

    @staticmethod
    def _ensure_wallets(db: Session, user_id: str) -> Dict[str, WalletModel]:
        rows = db.scalars(select(WalletModel).where(WalletModel.user_id == user_id)).all()
        by_curr = {w.currency: w for w in rows}
        created = False
        for curr, default_amt in DEFAULT_WALLETS.items():
            if curr not in by_curr:
                w = WalletModel(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    currency=curr,
                    balance=float(default_amt),
                    equity=float(default_amt),
                    margin_used=0.0,
                )
                db.add(w)
                by_curr[curr] = w
                created = True
        if created:
            db.commit()
        return by_curr

    @classmethod
    def get_snapshot(cls, db: Session, user_id: str, price_map: Dict[str, dict]) -> dict:
        wallets_map = cls._ensure_wallets(db, user_id)
        positions_rows = db.scalars(
            select(PositionModel).where(PositionModel.user_id == user_id)
        ).all()
        pending_rows = db.scalars(
            select(OrderModel)
            .where(OrderModel.user_id == user_id, OrderModel.status == "PENDING")
            .order_by(desc(OrderModel.created_at))
        ).all()
        filled_rows = db.scalars(
            select(OrderModel)
            .where(OrderModel.user_id == user_id, OrderModel.status == "FILLED")
            .order_by(desc(OrderModel.filled_at))
            .limit(40)
        ).all()

        total_pnl = 0.0
        pos_list: List[dict] = []
        equity_by_curr: Dict[str, float] = {c: w.balance for c, w in wallets_map.items()}

        for pos in positions_rows:
            q = price_map.get(pos.symbol)
            cur_px = float(q["price"]) if q and q.get("price", 0) > 0 else pos.current_price
            pos.current_price = round(cur_px, 4)
            if pos.side == "BUY":
                pnl = (cur_px - pos.avg_entry_price) * pos.qty
                pct = ((cur_px - pos.avg_entry_price) / pos.avg_entry_price) * 100 if pos.avg_entry_price else 0.0
                equity_by_curr[pos.currency] = equity_by_curr.get(pos.currency, 0.0) + cur_px * pos.qty
            else:
                pnl = (pos.avg_entry_price - cur_px) * pos.qty
                pct = ((pos.avg_entry_price - cur_px) / pos.avg_entry_price) * 100 if pos.avg_entry_price else 0.0
                equity_by_curr[pos.currency] = equity_by_curr.get(pos.currency, 0.0) + pos.avg_entry_price * pos.qty + pnl

            pos.unrealized_pnl = round(pnl, 2)
            total_pnl += pnl
            pos_list.append({
                "id": pos.id,
                "symbol": pos.symbol,
                "name": pos.name,
                "quantity": pos.qty,
                "avg_price": pos.avg_entry_price,
                "current_price": pos.current_price,
                "currency": pos.currency,
                "order_type": pos.side,
                "stop_loss": pos.stop_loss,
                "take_profit": pos.take_profit,
                "pnl": round(pnl, 2),
                "pnl_percent": round(pct, 2),
            })

        for curr, w in wallets_map.items():
            w.equity = round(equity_by_curr.get(curr, w.balance), 2)
        db.commit()

        return {
            "user_id": user_id,
            "wallets": {c: round(w.balance, 2) for c, w in wallets_map.items()},
            "positions": pos_list,
            "pending_orders": [
                {
                    "id": o.id,
                    "symbol": o.symbol,
                    "name": o.name,
                    "currency": o.currency,
                    "quantity": o.qty,
                    "order_type": o.side,
                    "limit_price": round(float(o.limit_price or o.price), 4),
                    "created_at": _fmt_utc_time(o.created_at),
                }
                for o in pending_rows
            ],
            "orders_history": [
                {
                    "id": o.id,
                    "symbol": o.symbol,
                    "type": o.side,
                    "quantity": o.qty,
                    "price": round(float(o.price), 4),
                    "currency": o.currency,
                    "charges": o.charges,
                    "status": "EXECUTED",
                    "timestamp": _fmt_utc_time(o.filled_at or o.created_at),
                }
                for o in filled_rows
            ],
            "total_unrealized_pnl": round(total_pnl, 2),
        }

    @classmethod
    def place_order(
        cls,
        db: Session,
        user_id: str,
        symbol: str,
        name: str,
        currency: str,
        quantity: int,
        order_type: str,
        order_mode: str,
        live_price: float,
        limit_price: Optional[float] = None,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
    ) -> dict:
        if quantity <= 0:
            raise ValueError("Quantity must be greater than zero.")
        if live_price <= 0:
            raise ValueError(f"Live market price unavailable for {symbol}.")

        side = order_type.upper()
        mode = order_mode.upper()

        if mode in ("LIMIT", "STOP") and limit_price is not None:
            should_fill_now = (
                (side == "BUY" and live_price <= limit_price) or (side == "SELL" and live_price >= limit_price)
                if mode == "LIMIT"
                else (side == "BUY" and live_price >= limit_price) or (side == "SELL" and live_price <= limit_price)
            )
            if not should_fill_now:
                pending = OrderModel(
                    id=f"pnd-{uuid.uuid4().hex[:8]}",
                    user_id=user_id,
                    symbol=symbol,
                    name=name,
                    currency=currency,
                    side=side,
                    order_mode=mode,
                    status="PENDING",
                    price=0.0,
                    limit_price=round(float(limit_price), 4),
                    qty=quantity,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                )
                db.add(pending)
                db.commit()
                return {
                    "status": "PENDING",
                    "message": f"{mode.title()} {side} queued for {quantity} {symbol} @ {currency} {limit_price:.2f}",
                    "order": {
                        "id": pending.id,
                        "symbol": symbol,
                        "order_type": side,
                        "limit_price": pending.limit_price,
                        "quantity": quantity,
                    },
                }

        return cls._execute_fill(db, user_id, symbol, name, currency, quantity, side, live_price, stop_loss, take_profit)

    @classmethod
    def _execute_fill(
        cls,
        db: Session,
        user_id: str,
        symbol: str,
        name: str,
        currency: str,
        quantity: int,
        side: str,
        exec_price: float,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
    ) -> dict:
        wallets_map = cls._ensure_wallets(db, user_id)
        wallet = wallets_map[currency]
        balance = float(wallet.balance)
        notional = exec_price * quantity
        charges = round(notional * 0.001, 2)

        existing = db.scalar(
            select(PositionModel).where(PositionModel.user_id == user_id, PositionModel.symbol == symbol)
        )
        msg = ""

        if side == "BUY":
            if existing and existing.side == "SHORT":
                cover_qty = min(quantity, existing.qty)
                cover_charges = round((exec_price * cover_qty) * 0.001, 2)
                pnl = (existing.avg_entry_price - exec_price) * cover_qty - cover_charges
                balance = round(balance + (existing.avg_entry_price * cover_qty) + pnl, 2)
                wallet.balance = balance
                wallet.margin_used = max(0.0, round(wallet.margin_used - existing.avg_entry_price * cover_qty, 2))
                existing.qty -= cover_qty
                existing.realized_pnl = round(existing.realized_pnl + pnl, 2)
                if existing.qty <= 0:
                    db.delete(existing)
                    db.flush()
                    existing = None
                msg = f"Covered {cover_qty} SHORT {symbol} @ {currency} {exec_price:.2f}"
                rem_qty = quantity - cover_qty
            else:
                rem_qty = quantity

            if rem_qty > 0:
                rem_notional = exec_price * rem_qty
                rem_charges = round(rem_notional * 0.001, 2)
                total_cost = rem_notional + rem_charges
                if balance < total_cost:
                    raise ValueError(f"Insufficient {currency} balance! Need {total_cost:.2f}, have {balance:.2f}")
                wallet.balance = round(balance - total_cost, 2)
                if existing and existing.side == "BUY":
                    new_qty = existing.qty + rem_qty
                    existing.avg_entry_price = round(
                        ((existing.avg_entry_price * existing.qty) + rem_notional) / new_qty, 4
                    )
                    existing.qty = new_qty
                    existing.current_price = round(exec_price, 4)
                    if stop_loss is not None:
                        existing.stop_loss = stop_loss
                    if take_profit is not None:
                        existing.take_profit = take_profit
                else:
                    db.add(
                        PositionModel(
                            id=f"pos-{uuid.uuid4().hex[:8]}",
                            user_id=user_id,
                            symbol=symbol,
                            name=name,
                            currency=currency,
                            side="BUY",
                            qty=rem_qty,
                            avg_entry_price=round(exec_price, 4),
                            current_price=round(exec_price, 4),
                            stop_loss=stop_loss,
                            take_profit=take_profit,
                        )
                    )
                buy_msg = f"Bought {rem_qty} {symbol} @ {currency} {exec_price:.2f}"
                msg = f"{msg} + {buy_msg}" if msg else buy_msg

        elif side == "SELL":
            if existing and existing.side == "BUY":
                sell_qty = min(quantity, existing.qty)
                sell_charges = round((exec_price * sell_qty) * 0.001, 2)
                revenue = (exec_price * sell_qty) - sell_charges
                balance = round(balance + revenue, 2)
                wallet.balance = balance
                existing.qty -= sell_qty
                if existing.qty <= 0:
                    db.delete(existing)
                    db.flush()
                    existing = None
                msg = f"Sold {sell_qty} {symbol} @ {currency} {exec_price:.2f}"
                rem_qty = quantity - sell_qty
            else:
                rem_qty = quantity

            if rem_qty > 0:
                rem_notional = exec_price * rem_qty
                rem_charges = round(rem_notional * 0.001, 2)
                margin_req = rem_notional + rem_charges
                if balance < margin_req:
                    raise ValueError(f"Insufficient {currency} margin for SHORT! Need {margin_req:.2f}, have {balance:.2f}")
                wallet.balance = round(balance - margin_req, 2)
                wallet.margin_used = round(wallet.margin_used + rem_notional, 2)
                if existing and existing.side == "SHORT":
                    new_qty = existing.qty + rem_qty
                    existing.avg_entry_price = round(
                        ((existing.avg_entry_price * existing.qty) + rem_notional) / new_qty, 4
                    )
                    existing.qty = new_qty
                    existing.current_price = round(exec_price, 4)
                    if stop_loss is not None:
                        existing.stop_loss = stop_loss
                    if take_profit is not None:
                        existing.take_profit = take_profit
                else:
                    db.add(
                        PositionModel(
                            id=f"pos-{uuid.uuid4().hex[:8]}",
                            user_id=user_id,
                            symbol=symbol,
                            name=name,
                            currency=currency,
                            side="SHORT",
                            qty=rem_qty,
                            avg_entry_price=round(exec_price, 4),
                            current_price=round(exec_price, 4),
                            stop_loss=stop_loss,
                            take_profit=take_profit,
                        )
                    )
                short_msg = f"Shorted {rem_qty} {symbol} @ {currency} {exec_price:.2f}"
                msg = f"{msg} + {short_msg}" if msg else short_msg
        else:
            raise ValueError("order_type must be BUY or SELL")

        order_row = OrderModel(
            id=f"ord-{uuid.uuid4().hex[:8]}",
            user_id=user_id,
            symbol=symbol,
            name=name,
            currency=currency,
            side=side,
            order_mode="MARKET",
            status="FILLED",
            price=round(exec_price, 4),
            qty=quantity,
            charges=charges,
            filled_at=_utcnow(),
        )
        db.add(order_row)
        db.commit()
        return {"status": "SUCCESS", "message": msg, "order_id": order_row.id}

    @classmethod
    def cancel_pending_order(cls, db: Session, user_id: str, order_id: str) -> bool:
        row = db.scalar(
            select(OrderModel).where(
                OrderModel.id == order_id,
                OrderModel.user_id == user_id,
                OrderModel.status == "PENDING",
            )
        )
        if not row:
            return False
        row.status = "CANCELLED"
        db.commit()
        return True

    @classmethod
    def reset_user_portfolio(cls, db: Session, user_id: str) -> None:
        db.execute(delete(PositionModel).where(PositionModel.user_id == user_id))
        db.execute(delete(OrderModel).where(OrderModel.user_id == user_id))
        wallets_map = cls._ensure_wallets(db, user_id)
        for curr, w in wallets_map.items():
            default_amt = float(DEFAULT_WALLETS.get(curr, 100000.0))
            w.balance = default_amt
            w.equity = default_amt
            w.margin_used = 0.0
        db.commit()

    @classmethod
    def evaluate_all_pending_and_stops(cls, db: Session, price_map: Dict[str, dict]) -> List[dict]:
        """Evaluates pending Limit/Stop orders & active SL/TP targets safely per user_id."""
        events: List[dict] = []
        pending_rows = db.scalars(select(OrderModel).where(OrderModel.status == "PENDING")).all()
        for pnd in pending_rows:
            q = price_map.get(pnd.symbol)
            if not q or q.get("price", 0) <= 0:
                continue
            px = float(q["price"])
            lp = float(pnd.limit_price or 0.0)
            if lp <= 0:
                continue
            triggered = (
                (pnd.side == "BUY" and px <= lp) or (pnd.side == "SELL" and px >= lp)
                if pnd.order_mode == "LIMIT"
                else (pnd.side == "BUY" and px >= lp) or (pnd.side == "SELL" and px <= lp)
            )
            if triggered:
                try:
                    res = cls._execute_fill(
                        db, pnd.user_id, pnd.symbol, pnd.name, pnd.currency,
                        pnd.qty, pnd.side, px, pnd.stop_loss, pnd.take_profit,
                    )
                    pnd.status = "FILLED"
                    pnd.filled_at = _utcnow()
                    db.commit()
                    events.append({"user_id": pnd.user_id, "type": "ORDER_FILL", **res})
                except Exception:
                    db.rollback()

        pos_rows = db.scalars(
            select(PositionModel).where(
                (PositionModel.stop_loss.is_not(None)) | (PositionModel.take_profit.is_not(None))
            )
        ).all()
        for pos in pos_rows:
            q = price_map.get(pos.symbol)
            if not q or q.get("price", 0) <= 0:
                continue
            px = float(q["price"])
            sl, tp = pos.stop_loss, pos.take_profit
            if pos.side == "BUY" and ((sl is not None and px <= sl) or (tp is not None and px >= tp)):
                res = cls._execute_fill(db, pos.user_id, pos.symbol, pos.name, pos.currency, pos.qty, "SELL", px)
                events.append({"user_id": pos.user_id, "type": "ORDER_FILL", **res})
            elif pos.side == "SHORT" and ((sl is not None and px >= sl) or (tp is not None and px <= tp)):
                res = cls._execute_fill(db, pos.user_id, pos.symbol, pos.name, pos.currency, pos.qty, "BUY", px)
                events.append({"user_id": pos.user_id, "type": "ORDER_FILL", **res})
        return events


def get_user_layout(db: Session, user_id: str, layout_name: str = "default") -> dict:
    row = db.scalar(
        select(ChartLayoutModel).where(
            ChartLayoutModel.user_id == user_id,
            ChartLayoutModel.layout_name == layout_name,
        )
    )
    if not row:
        return {
            "layout_name": layout_name,
            "symbol": "RELIANCE.NS",
            "grid_type": "1x1",
            "drawings": [],
            "active_indicators": [{"fn": "ema", "period": 20}],
        }
    return {
        "layout_name": row.layout_name,
        "symbol": row.symbol,
        "grid_type": row.grid_type,
        "drawings": json.loads(row.json_drawing_state or "[]"),
        "active_indicators": json.loads(row.active_indicators or "[]"),
    }


def save_user_layout(
    db: Session,
    user_id: str,
    layout_name: str,
    symbol: str,
    grid_type: str,
    drawings: list,
    active_indicators: list,
) -> dict:
    row = db.scalar(
        select(ChartLayoutModel).where(
            ChartLayoutModel.user_id == user_id,
            ChartLayoutModel.layout_name == layout_name,
        )
    )
    if not row:
        row = ChartLayoutModel(
            id=str(uuid.uuid4()),
            user_id=user_id,
            layout_name=layout_name,
        )
        db.add(row)
    row.symbol = symbol
    row.grid_type = grid_type
    row.json_drawing_state = json.dumps(drawings)
    row.active_indicators = json.dumps(active_indicators)
    db.commit()
    return {
        "status": "SAVED",
        "layout_name": row.layout_name,
        "symbol": row.symbol,
        "grid_type": row.grid_type,
    }


def get_user_watchlists(db: Session, user_id: str) -> List[dict]:
    rows = db.scalars(select(UserWatchlistModel).where(UserWatchlistModel.user_id == user_id)).all()
    return [
        {"id": w.id, "name": w.name, "symbols": json.loads(w.symbols_json or "[]")}
        for w in rows
    ]


def upsert_user_watchlist(db: Session, user_id: str, name: str, symbols: List[str]) -> dict:
    row = db.scalar(
        select(UserWatchlistModel).where(
            UserWatchlistModel.user_id == user_id,
            UserWatchlistModel.name == name,
        )
    )
    if not row:
        row = UserWatchlistModel(id=str(uuid.uuid4()), user_id=user_id, name=name)
        db.add(row)
    row.symbols_json = json.dumps(symbols[:200])
    db.commit()
    return {"id": row.id, "name": row.name, "symbols": symbols[:200]}


def list_user_alerts(db: Session, user_id: str, backend_mode: str, recent_triggers: List[dict]) -> dict:
    rows = db.scalars(
        select(UserAlertModel)
        .where(UserAlertModel.user_id == user_id, UserAlertModel.is_active.is_(True))
        .order_by(desc(UserAlertModel.created_at))
    ).all()
    user_triggers = [t for t in recent_triggers if t.get("user_id") == user_id][:30]
    return {
        "backend_mode": backend_mode,
        "total_rules": len(rows),
        "rules": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "condition": r.condition,
                "threshold": r.target_value,
                "note": r.note,
                "non_expiring": True,
                "triggered_count": r.triggered_count,
                "last_triggered_at": r.triggered_at.isoformat() if r.triggered_at else None,
            }
            for r in rows
        ],
        "recent_triggers": user_triggers,
    }


def delete_user_alert(db: Session, user_id: str, rule_id: str) -> bool:
    row = db.scalar(
        select(UserAlertModel).where(UserAlertModel.id == rule_id, UserAlertModel.user_id == user_id)
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
