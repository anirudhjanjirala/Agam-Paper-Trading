from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from core.models import (
    ActivityLogModel,
    ChartLayoutModel,
    ClosedTradeModel,
    OrderModel,
    PositionModel,
    TradeIdeaModel,
    UserAlertModel,
    UserModel,
    UserWatchlistModel,
    WalletModel,
)
from core.paper_wallets import DEFAULT_WALLETS
from core.tax_brokerage import (
    ChargeBreakdown,
    calculate_order_charges,
    estimate_capital_gains_tax_rate,
    infer_country_and_sub,
)

SUPPORTED_COUNTRIES = ("IND", "USA", "CANADA", "CHINA", "EU")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fmt_utc_time(dt: Optional[datetime]) -> str:
    if not dt:
        return _utcnow().strftime("%H:%M:%S UTC")
    return dt.strftime("%H:%M:%S UTC")


def _fmt_utc_iso(dt: Optional[datetime]) -> str:
    if not dt:
        return _utcnow().isoformat()
    return dt.isoformat()


def _safe_json_loads(raw: Optional[str], fallback: object) -> object:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


class TenantPortfolioService:
    """
    SQLAlchemy 2.0 multi-tenant paper trading service with:
    - Country-isolated statutory taxes & brokerage calculation
    - Delivery (CNC) vs Intraday (MIS) vs Futures/Options products
    - Automated Stop-Loss (SL), Take-Profit (TP), and Trailing Stop-Loss (TSL)
    - Realized Closed Trades ledger & per-country analytics/tax summaries
    """

    @staticmethod
    def _ensure_wallets(
        db: Session,
        user_id: str,
        extra_currency: Optional[str] = None,
    ) -> Dict[str, WalletModel]:
        rows = db.scalars(select(WalletModel).where(WalletModel.user_id == user_id)).all()
        by_curr = {w.currency: w for w in rows}
        created = False
        targets = dict(DEFAULT_WALLETS)
        if extra_currency and extra_currency not in targets:
            targets[extra_currency] = 100000.0
        for curr, default_amt in targets.items():
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
    def _recompute_margin_used(cls, db: Session, user_id: str, wallets_map: Dict[str, WalletModel]) -> None:
        pos_rows = db.scalars(select(PositionModel).where(PositionModel.user_id == user_id)).all()
        margin_by_curr: Dict[str, float] = {c: 0.0 for c in wallets_map}
        for p in pos_rows:
            mb = float(p.margin_blocked or (p.avg_entry_price * p.qty / max(1.0, p.leverage or 1.0)))
            margin_by_curr[p.currency] = round(margin_by_curr.get(p.currency, 0.0) + mb, 2)
        for c, w in wallets_map.items():
            w.margin_used = round(margin_by_curr.get(c, 0.0), 2)

    @classmethod
    def _record_rejected_order(
        cls,
        db: Session,
        user_id: str,
        symbol: str,
        name: str,
        country: str,
        exchange: str,
        currency: str,
        side: str,
        mode: str,
        product_type: str,
        broker_plan: str,
        quantity: int,
        price: float,
        limit_price: Optional[float],
        stop_loss: Optional[float],
        take_profit: Optional[float],
        trailing_sl: Optional[float],
        reason: str,
    ) -> None:
        try:
            row = OrderModel(
                id=f"rej-{uuid.uuid4().hex[:8]}",
                user_id=user_id,
                symbol=symbol,
                name=name,
                country=country,
                exchange=exchange,
                currency=currency,
                side=side,
                order_mode=mode,
                product_type=product_type,
                broker_plan=broker_plan,
                status="REJECTED",
                price=round(float(price), 4),
                limit_price=round(float(limit_price), 4) if limit_price else None,
                qty=quantity,
                gross_amount=round(float(price) * quantity, 2),
                charges=0.0,
                stop_loss=stop_loss,
                take_profit=take_profit,
                trailing_sl=trailing_sl,
                reject_reason=reason[:250],
            )
            db.add(row)
            db.commit()
        except Exception:
            db.rollback()

    @classmethod
    def _serialize_order(cls, o: OrderModel) -> dict:
        tb = _safe_json_loads(o.tax_breakdown_json, {})
        line_items = tb.get("line_items", []) if isinstance(tb, dict) else []
        tax_notes = tb.get("tax_notes", []) if isinstance(tb, dict) else []
        return {
            "id": o.id,
            "symbol": o.symbol,
            "name": o.name,
            "country": o.country or infer_country_and_sub(o.symbol, None, o.exchange, o.currency)[0],
            "exchange": o.exchange or "",
            "currency": o.currency,
            "type": o.side,
            "order_type": o.side,
            "order_mode": o.order_mode,
            "product_type": o.product_type or "DELIVERY",
            "broker_plan": o.broker_plan or "DISCOUNT",
            "quantity": o.qty,
            "price": round(float(o.price), 4),
            "limit_price": round(float(o.limit_price), 4) if o.limit_price is not None else None,
            "gross_amount": round(float(o.gross_amount or (o.price * o.qty)), 2),
            "charges": round(float(o.charges or 0.0), 2),
            "brokerage": round(float(o.brokerage or 0.0), 2),
            "stt_or_ftt": round(float(o.stt_or_ftt or 0.0), 2),
            "stamp_duty": round(float(o.stamp_duty or 0.0), 2),
            "exchange_fee": round(float(o.exchange_fee or 0.0), 2),
            "regulator_fee": round(float(o.regulator_fee or 0.0), 2),
            "gst_vat": round(float(o.gst_vat or 0.0), 2),
            "dp_or_clearing_fee": round(float(o.dp_or_clearing_fee or 0.0), 2),
            "realized_pnl": round(float(o.realized_pnl or 0.0), 2),
            "net_pnl": round(float(o.net_pnl or 0.0), 2),
            "stop_loss": o.stop_loss,
            "take_profit": o.take_profit,
            "trailing_sl": o.trailing_sl,
            "reject_reason": o.reject_reason or "",
            "notes": o.notes or "",
            "line_items": line_items,
            "tax_notes": tax_notes,
            "status": "EXECUTED" if o.status == "FILLED" else o.status,
            "timestamp": _fmt_utc_time(o.filled_at or o.created_at),
            "created_at": _fmt_utc_time(o.created_at),
            "filled_at_iso": _fmt_utc_iso(o.filled_at or o.created_at),
        }

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
            .order_by(desc(OrderModel.filled_at), desc(OrderModel.created_at))
            .limit(120)
        ).all()
        rejected_rows = db.scalars(
            select(OrderModel)
            .where(OrderModel.user_id == user_id, OrderModel.status.in_(["CANCELLED", "REJECTED"]))
            .order_by(desc(OrderModel.created_at))
            .limit(60)
        ).all()
        closed_rows = db.scalars(
            select(ClosedTradeModel)
            .where(ClosedTradeModel.user_id == user_id)
            .order_by(desc(ClosedTradeModel.closed_at))
            .limit(120)
        ).all()

        total_pnl = 0.0
        pos_list: List[dict] = []
        equity_by_curr: Dict[str, float] = {c: float(w.balance) for c, w in wallets_map.items()}
        margin_by_curr: Dict[str, float] = {c: 0.0 for c in wallets_map}
        unrealized_by_curr: Dict[str, float] = {c: 0.0 for c in wallets_map}

        for pos in positions_rows:
            q = price_map.get(pos.symbol)
            cur_px = float(q["price"]) if q and q.get("price", 0) > 0 else float(pos.current_price or pos.avg_entry_price)
            pos_cur_px = round(cur_px, 4)
            country = pos.country or infer_country_and_sub(pos.symbol, None, pos.exchange, pos.currency)[0]
            prod = pos.product_type or "DELIVERY"
            lev = max(1.0, float(pos.leverage or 1.0))
            mb = float(pos.margin_blocked or (pos.avg_entry_price * pos.qty / lev))

            if pos.side == "BUY":
                gross_pnl = (cur_px - pos.avg_entry_price) * pos.qty
            else:
                gross_pnl = (pos.avg_entry_price - cur_px) * pos.qty

            pct = (gross_pnl / mb) * 100.0 if mb > 0 else 0.0

            exit_side = "SELL" if pos.side == "BUY" else "BUY"
            est_exit_bd = calculate_order_charges(
                symbol=pos.symbol,
                quantity=pos.qty,
                price=cur_px,
                side=exit_side,
                product_type=prod,
                region=country,
                exchange=pos.exchange,
                currency=pos.currency,
            )
            entry_chg = float(pos.entry_charges or 0.0)
            net_pnl = gross_pnl - entry_chg - est_exit_bd.total_charges

            total_pnl += gross_pnl
            equity_by_curr[pos.currency] = equity_by_curr.get(pos.currency, 0.0) + mb + gross_pnl
            margin_by_curr[pos.currency] = margin_by_curr.get(pos.currency, 0.0) + mb
            unrealized_by_curr[pos.currency] = unrealized_by_curr.get(pos.currency, 0.0) + gross_pnl

            pos_list.append({
                "id": pos.id,
                "symbol": pos.symbol,
                "name": pos.name,
                "country": country,
                "exchange": pos.exchange or est_exit_bd.exchange,
                "product_type": prod,
                "leverage": lev,
                "margin_blocked": round(mb, 2),
                "quantity": pos.qty,
                "avg_price": round(float(pos.avg_entry_price), 4),
                "current_price": pos_cur_px,
                "currency": pos.currency,
                "order_type": pos.side,
                "stop_loss": pos.stop_loss,
                "take_profit": pos.take_profit,
                "trailing_sl": pos.trailing_sl,
                "highest_price": pos.highest_price,
                "lowest_price": pos.lowest_price,
                "entry_charges": round(entry_chg, 2),
                "est_exit_charges": round(est_exit_bd.total_charges, 2),
                "pnl": round(gross_pnl, 2),
                "net_pnl": round(net_pnl, 2),
                "pnl_percent": round(pct, 2),
                "realized_pnl": round(float(pos.realized_pnl or 0.0), 2),
                "opened_at": _fmt_utc_iso(pos.opened_at),
            })

        # Zero-latency read path: never mutate ORM state or commit DB inside get_snapshot()

        # Build country-separated tax & brokerage ledger + performance analytics
        tax_by_country: Dict[str, dict] = {}
        analytics_by_country: Dict[str, dict] = {}
        country_currency = {
            "IND": "INR",
            "USA": "USD",
            "CANADA": "CAD",
            "CHINA": "CNY",
            "EU": "EUR",
        }
        for c in SUPPORTED_COUNTRIES:
            tax_by_country[c] = {
                "country": c,
                "currency": country_currency[c],
                "orders_count": 0,
                "turnover": 0.0,
                "brokerage": 0.0,
                "stt_or_ftt": 0.0,
                "stamp_duty": 0.0,
                "exchange_fee": 0.0,
                "regulator_fee": 0.0,
                "gst_vat": 0.0,
                "dp_or_clearing_fee": 0.0,
                "total_charges": 0.0,
                "gross_realized_pnl": 0.0,
                "net_realized_pnl": 0.0,
                "est_cap_gains_tax": 0.0,
                "net_after_tax_pnl": 0.0,
            }
            analytics_by_country[c] = {
                "country": c,
                "currency": country_currency[c],
                "closed_count": 0,
                "wins": 0,
                "losses": 0,
                "win_rate_pct": 0.0,
                "gross_pnl": 0.0,
                "total_charges": 0.0,
                "net_pnl": 0.0,
                "avg_win": 0.0,
                "avg_loss": 0.0,
                "best_trade": 0.0,
                "worst_trade": 0.0,
                "profit_factor": 0.0,
                "_win_sum": 0.0,
                "_loss_sum": 0.0,
            }

        all_filled_for_tax = db.scalars(
            select(OrderModel).where(OrderModel.user_id == user_id, OrderModel.status == "FILLED")
        ).all()
        for o in all_filled_for_tax:
            c = o.country or infer_country_and_sub(o.symbol, None, o.exchange, o.currency)[0]
            if c not in tax_by_country:
                c = "USA"
            bucket = tax_by_country[c]
            bucket["orders_count"] += 1
            bucket["turnover"] = round(bucket["turnover"] + float(o.gross_amount or (o.price * o.qty)), 2)
            bucket["brokerage"] = round(bucket["brokerage"] + float(o.brokerage or 0.0), 2)
            bucket["stt_or_ftt"] = round(bucket["stt_or_ftt"] + float(o.stt_or_ftt or 0.0), 2)
            bucket["stamp_duty"] = round(bucket["stamp_duty"] + float(o.stamp_duty or 0.0), 2)
            bucket["exchange_fee"] = round(bucket["exchange_fee"] + float(o.exchange_fee or 0.0), 2)
            bucket["regulator_fee"] = round(bucket["regulator_fee"] + float(o.regulator_fee or 0.0), 2)
            bucket["gst_vat"] = round(bucket["gst_vat"] + float(o.gst_vat or 0.0), 2)
            bucket["dp_or_clearing_fee"] = round(bucket["dp_or_clearing_fee"] + float(o.dp_or_clearing_fee or 0.0), 2)
            bucket["total_charges"] = round(bucket["total_charges"] + float(o.charges or 0.0), 2)

        all_closed_for_stats = db.scalars(
            select(ClosedTradeModel).where(ClosedTradeModel.user_id == user_id)
        ).all()
        for ct in all_closed_for_stats:
            c = ct.country if ct.country in tax_by_country else "USA"
            tb = tax_by_country[c]
            tb["gross_realized_pnl"] = round(tb["gross_realized_pnl"] + float(ct.gross_pnl), 2)
            tb["net_realized_pnl"] = round(tb["net_realized_pnl"] + float(ct.net_pnl), 2)
            tb["est_cap_gains_tax"] = round(tb["est_cap_gains_tax"] + float(ct.est_tax), 2)
            tb["net_after_tax_pnl"] = round(tb["net_realized_pnl"] - tb["est_cap_gains_tax"], 2)

            ab = analytics_by_country[c]
            ab["closed_count"] += 1
            npnl = float(ct.net_pnl)
            ab["gross_pnl"] = round(ab["gross_pnl"] + float(ct.gross_pnl), 2)
            ab["total_charges"] = round(ab["total_charges"] + float(ct.total_charges), 2)
            ab["net_pnl"] = round(ab["net_pnl"] + npnl, 2)
            if npnl >= 0:
                ab["wins"] += 1
                ab["_win_sum"] += npnl
                ab["best_trade"] = round(max(ab["best_trade"], npnl), 2)
            else:
                ab["losses"] += 1
                ab["_loss_sum"] += abs(npnl)
                ab["worst_trade"] = round(min(ab["worst_trade"], npnl), 2)

        for c, ab in analytics_by_country.items():
            cnt = ab["closed_count"]
            ab["win_rate_pct"] = round((ab["wins"] / cnt) * 100.0, 1) if cnt > 0 else 0.0
            ab["avg_win"] = round(ab["_win_sum"] / ab["wins"], 2) if ab["wins"] > 0 else 0.0
            ab["avg_loss"] = round(-ab["_loss_sum"] / ab["losses"], 2) if ab["losses"] > 0 else 0.0
            ab["profit_factor"] = round(ab["_win_sum"] / ab["_loss_sum"], 2) if ab["_loss_sum"] > 0 else (99.0 if ab["_win_sum"] > 0 else 0.0)
            ab.pop("_win_sum", None)
            ab.pop("_loss_sum", None)

        curr_to_country = {
            "INR": "IND",
            "USD": "USA",
            "CAD": "CANADA",
            "CNY": "CHINA",
            "EUR": "EU",
            "GBP": "EU",
            "GBp": "EU",
        }
        wallet_details = {}
        capital_health = {}
        for c, w in wallets_map.items():
            bal = round(float(w.balance), 2)
            eq = round(equity_by_curr.get(c, bal), 2)
            mu = round(margin_by_curr.get(c, 0.0), 2)
            upnl = round(unrealized_by_curr.get(c, 0.0), 2)
            wallet_details[c] = {
                "currency": c,
                "balance": bal,
                "equity": eq,
                "margin_used": mu,
                "unrealized_pnl": upnl,
            }
            start_cap = float(DEFAULT_WALLETS.get(c, 100000.0))
            cash_pct = round((bal / start_cap) * 100.0, 2) if start_cap > 0 else 100.0
            equity_pct = round((eq / start_cap) * 100.0, 2) if start_cap > 0 else 100.0
            drawdown_pct = round(max(0.0, 100.0 - equity_pct), 2)
            if eq <= 0 or bal < start_cap * 0.05:
                h_status = "EXHAUSTED"
                h_msg = (
                    f"{c} capital exhausted ({cash_pct:.1f}% free cash left). "
                    "Resets are permanently disabled — square off losing positions or manage remaining margin strictly."
                )
            elif eq < start_cap * 0.15 or bal < start_cap * 0.15:
                h_status = "CRITICAL"
                h_msg = (
                    f"CRITICAL {c} drawdown: {equity_pct:.1f}% equity / {cash_pct:.1f}% free cash remaining "
                    "(fixed non-resettable capital). Reduce position size & tighten stop-losses."
                )
            elif eq < start_cap * 0.30 or bal < start_cap * 0.30:
                h_status = "WARNING"
                h_msg = (
                    f"Low {c} capital warning: {equity_pct:.1f}% equity / {cash_pct:.1f}% cash remaining "
                    f"of fixed {start_cap:,.0f} allocation (no resets allowed)."
                )
            else:
                h_status = "HEALTHY"
                h_msg = ""
            capital_health[c] = {
                "currency": c,
                "country": curr_to_country.get(c, "USA"),
                "starting_capital": round(start_cap, 2),
                "balance": bal,
                "equity": eq,
                "cash_pct": cash_pct,
                "equity_pct": equity_pct,
                "drawdown_pct": drawdown_pct,
                "status": h_status,
                "warning_message": h_msg,
            }

        return {
            "user_id": user_id,
            "wallets": {c: round(float(w.balance), 2) for c, w in wallets_map.items()},
            "wallet_details": wallet_details,
            "capital_health": capital_health,
            "positions": pos_list,
            "pending_orders": [cls._serialize_order(o) for o in pending_rows],
            "orders_history": [cls._serialize_order(o) for o in filled_rows],
            "rejected_orders": [cls._serialize_order(o) for o in rejected_rows],
            "closed_trades": [
                {
                    "id": ct.id,
                    "symbol": ct.symbol,
                    "name": ct.name,
                    "country": ct.country,
                    "exchange": ct.exchange,
                    "currency": ct.currency,
                    "product_type": ct.product_type,
                    "side": ct.side,
                    "quantity": ct.qty,
                    "entry_price": round(float(ct.entry_price), 4),
                    "exit_price": round(float(ct.exit_price), 4),
                    "gross_pnl": round(float(ct.gross_pnl), 2),
                    "entry_charges": round(float(ct.entry_charges), 2),
                    "exit_charges": round(float(ct.exit_charges), 2),
                    "total_charges": round(float(ct.total_charges), 2),
                    "net_pnl": round(float(ct.net_pnl), 2),
                    "est_tax": round(float(ct.est_tax), 2),
                    "pnl_percent": round(float(ct.pnl_percent), 2),
                    "journal_note": ct.journal_note or "",
                    "opened_at": _fmt_utc_iso(ct.opened_at),
                    "closed_at": _fmt_utc_iso(ct.closed_at),
                    "closed_time": _fmt_utc_time(ct.closed_at),
                }
                for ct in closed_rows
            ],
            "tax_summary_by_country": tax_by_country,
            "analytics_by_country": analytics_by_country,
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
        trailing_sl: Optional[float] = None,
        product_type: str = "DELIVERY",
        broker_plan: str = "DISCOUNT",
        country: Optional[str] = None,
        exchange: Optional[str] = None,
        category: str = "stocks",
        notes: str = "",
    ) -> dict:
        side = order_type.upper().strip()
        mode = order_mode.upper().strip()
        prod = (product_type or "DELIVERY").upper().strip()
        if prod not in ("DELIVERY", "INTRADAY", "FUTURES", "OPTIONS"):
            prod = "DELIVERY"
        plan = (broker_plan or "DISCOUNT").upper().strip()
        if plan not in ("DISCOUNT", "PRO"):
            plan = "DISCOUNT"
        resolved_country, _, resolved_exch = infer_country_and_sub(symbol, country, exchange, currency)

        if quantity <= 0:
            raise ValueError("Quantity must be greater than zero.")
        if live_price <= 0:
            raise ValueError(f"Live market price unavailable for {symbol}.")
        if trailing_sl is not None and trailing_sl <= 0:
            raise ValueError("Trailing Stop-Loss distance must be positive.")

        if mode in ("LIMIT", "STOP") and limit_price is not None:
            if limit_price <= 0:
                raise ValueError("Trigger / Limit price must be greater than zero.")
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
                    country=resolved_country,
                    exchange=resolved_exch,
                    currency=currency,
                    side=side,
                    order_mode=mode,
                    product_type=prod,
                    broker_plan=plan,
                    status="PENDING",
                    price=0.0,
                    limit_price=round(float(limit_price), 4),
                    qty=quantity,
                    gross_amount=round(float(limit_price) * quantity, 2),
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    trailing_sl=trailing_sl,
                    notes=notes[:250],
                )
                db.add(pending)
                db.commit()
                return {
                    "status": "PENDING",
                    "message": f"{mode.title()} {side} ({prod}) queued for {quantity} {symbol} @ {currency} {limit_price:.2f}",
                    "order": cls._serialize_order(pending),
                }

        try:
            return cls._execute_fill(
                db=db,
                user_id=user_id,
                symbol=symbol,
                name=name,
                currency=currency,
                quantity=quantity,
                side=side,
                exec_price=live_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                trailing_sl=trailing_sl,
                product_type=prod,
                broker_plan=plan,
                order_mode=mode,
                country=resolved_country,
                exchange=resolved_exch,
                category=category,
                notes=notes,
            )
        except ValueError as err:
            cls._record_rejected_order(
                db=db,
                user_id=user_id,
                symbol=symbol,
                name=name,
                country=resolved_country,
                exchange=resolved_exch,
                currency=currency,
                side=side,
                mode=mode,
                product_type=prod,
                broker_plan=plan,
                quantity=quantity,
                price=live_price,
                limit_price=limit_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                trailing_sl=trailing_sl,
                reason=str(err),
            )
            raise

    @classmethod
    def _apply_tax_fields(cls, order_row: OrderModel, bd: ChargeBreakdown) -> None:
        order_row.gross_amount = bd.notional
        order_row.charges = bd.total_charges
        order_row.brokerage = bd.brokerage
        order_row.stt_or_ftt = bd.stt_or_ftt
        order_row.stamp_duty = bd.stamp_duty
        order_row.exchange_fee = bd.exchange_fee
        order_row.regulator_fee = bd.regulator_fee
        order_row.gst_vat = bd.gst_vat
        order_row.dp_or_clearing_fee = bd.dp_or_clearing_fee
        order_row.tax_breakdown_json = json.dumps({
            "line_items": bd.line_items,
            "tax_notes": bd.tax_notes,
            "effective_rate_pct": bd.effective_rate_pct,
            "breakeven_delta": bd.breakeven_delta,
            "leverage": bd.leverage,
            "margin_required": bd.margin_required,
            "sub_jurisdiction": bd.sub_jurisdiction,
        })

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
        trailing_sl: Optional[float] = None,
        product_type: str = "DELIVERY",
        broker_plan: str = "DISCOUNT",
        order_mode: str = "MARKET",
        country: Optional[str] = None,
        exchange: Optional[str] = None,
        category: str = "stocks",
        notes: str = "",
        existing_order: Optional[OrderModel] = None,
    ) -> dict:
        resolved_country, _, resolved_exch = infer_country_and_sub(symbol, country, exchange, currency)
        prod = (product_type or "DELIVERY").upper().strip()
        plan = (broker_plan or "DISCOUNT").upper().strip()

        wallets_map = cls._ensure_wallets(db, user_id, extra_currency=currency)
        wallet = wallets_map[currency]
        balance = float(wallet.balance)

        existing = db.scalar(
            select(PositionModel).where(
                PositionModel.user_id == user_id,
                PositionModel.symbol == symbol,
                PositionModel.product_type == prod,
            )
        )

        # Compute authentic country-specific charges for the full execution leg
        bd_total = calculate_order_charges(
            symbol=symbol,
            quantity=quantity,
            price=exec_price,
            side=side,
            product_type=prod,
            broker_plan=plan,
            region=resolved_country,
            exchange=resolved_exch,
            currency=currency,
            category=category,
        )
        lev = bd_total.leverage

        msg = ""
        realized_gross_total = 0.0
        realized_net_total = 0.0

        if side == "BUY":
            if existing and existing.side == "SHORT":
                cover_qty = min(quantity, existing.qty)
                bd_cover = (
                    bd_total
                    if cover_qty == quantity
                    else calculate_order_charges(
                        symbol=symbol,
                        quantity=cover_qty,
                        price=exec_price,
                        side="BUY",
                        product_type=prod,
                        broker_plan=plan,
                        region=resolved_country,
                        exchange=resolved_exch,
                        currency=currency,
                        category=category,
                    )
                )
                ratio = cover_qty / existing.qty if existing.qty > 0 else 1.0
                released_margin = float(existing.margin_blocked or (existing.avg_entry_price * existing.qty / lev)) * ratio
                entry_chg_share = float(existing.entry_charges or 0.0) * ratio

                gross_pnl = (existing.avg_entry_price - exec_price) * cover_qty
                net_pnl = gross_pnl - entry_chg_share - bd_cover.total_charges
                tax_rate, _ = estimate_capital_gains_tax_rate(resolved_country, prod)
                est_tax = round(max(0.0, net_pnl) * tax_rate, 2)

                balance = round(balance + released_margin + gross_pnl - bd_cover.total_charges, 2)
                wallet.balance = balance

                total_chg_rt = round(entry_chg_share + bd_cover.total_charges, 2)
                pnl_pct = round((net_pnl / released_margin) * 100.0, 2) if released_margin > 0 else 0.0
                db.add(
                    ClosedTradeModel(
                        id=f"cls-{uuid.uuid4().hex[:8]}",
                        user_id=user_id,
                        symbol=symbol,
                        name=name,
                        country=resolved_country,
                        exchange=resolved_exch,
                        currency=currency,
                        product_type=prod,
                        side="SHORT",
                        qty=cover_qty,
                        entry_price=round(float(existing.avg_entry_price), 4),
                        exit_price=round(exec_price, 4),
                        gross_pnl=round(gross_pnl, 2),
                        entry_charges=round(entry_chg_share, 2),
                        exit_charges=round(bd_cover.total_charges, 2),
                        total_charges=total_chg_rt,
                        net_pnl=round(net_pnl, 2),
                        est_tax=est_tax,
                        pnl_percent=pnl_pct,
                        journal_note=notes[:490],
                        opened_at=existing.opened_at or _utcnow(),
                        closed_at=_utcnow(),
                    )
                )

                realized_gross_total += gross_pnl
                realized_net_total += net_pnl

                existing.qty -= cover_qty
                existing.margin_blocked = max(0.0, round(float(existing.margin_blocked or 0.0) - released_margin, 2))
                existing.entry_charges = max(0.0, round(float(existing.entry_charges or 0.0) - entry_chg_share, 2))
                existing.realized_pnl = round(float(existing.realized_pnl or 0.0) + net_pnl, 2)
                if existing.qty <= 0:
                    db.delete(existing)
                    db.flush()
                    existing = None
                msg = f"Covered {cover_qty} SHORT {symbol} ({prod}) @ {currency} {exec_price:.2f}"
                rem_qty = quantity - cover_qty
            else:
                rem_qty = quantity

            if rem_qty > 0:
                bd_rem = (
                    bd_total
                    if rem_qty == quantity
                    else calculate_order_charges(
                        symbol=symbol,
                        quantity=rem_qty,
                        price=exec_price,
                        side="BUY",
                        product_type=prod,
                        broker_plan=plan,
                        region=resolved_country,
                        exchange=resolved_exch,
                        currency=currency,
                        category=category,
                    )
                )
                rem_notional = exec_price * rem_qty
                req_margin = bd_rem.margin_required
                total_cost = req_margin + bd_rem.total_charges
                if balance < total_cost:
                    raise ValueError(
                        f"Insufficient {currency} balance! Need {total_cost:,.2f} (Margin {req_margin:,.2f} + Charges {bd_rem.total_charges:,.2f}), have {balance:,.2f}"
                    )
                wallet.balance = round(balance - total_cost, 2)
                init_sl = stop_loss
                if trailing_sl and init_sl is None:
                    init_sl = round(exec_price - trailing_sl, 4)

                if existing and existing.side == "BUY":
                    new_qty = existing.qty + rem_qty
                    existing.avg_entry_price = round(
                        ((existing.avg_entry_price * existing.qty) + rem_notional) / new_qty, 4
                    )
                    existing.qty = new_qty
                    existing.current_price = round(exec_price, 4)
                    existing.margin_blocked = round(float(existing.margin_blocked or 0.0) + req_margin, 2)
                    existing.entry_charges = round(float(existing.entry_charges or 0.0) + bd_rem.total_charges, 2)
                    existing.highest_price = max(float(existing.highest_price or exec_price), exec_price)
                    if init_sl is not None:
                        existing.stop_loss = init_sl
                    if take_profit is not None:
                        existing.take_profit = take_profit
                    if trailing_sl is not None:
                        existing.trailing_sl = trailing_sl
                else:
                    db.add(
                        PositionModel(
                            id=f"pos-{uuid.uuid4().hex[:8]}",
                            user_id=user_id,
                            symbol=symbol,
                            name=name,
                            country=resolved_country,
                            exchange=resolved_exch,
                            currency=currency,
                            side="BUY",
                            product_type=prod,
                            leverage=lev,
                            margin_blocked=round(req_margin, 2),
                            entry_charges=round(bd_rem.total_charges, 2),
                            qty=rem_qty,
                            avg_entry_price=round(exec_price, 4),
                            current_price=round(exec_price, 4),
                            stop_loss=init_sl,
                            take_profit=take_profit,
                            trailing_sl=trailing_sl,
                            highest_price=round(exec_price, 4),
                            lowest_price=round(exec_price, 4),
                            opened_at=_utcnow(),
                        )
                    )
                buy_msg = f"Bought {rem_qty} {symbol} ({prod}) @ {currency} {exec_price:.2f} | Fees: {currency} {bd_rem.total_charges:.2f}"
                msg = f"{msg} + {buy_msg}" if msg else buy_msg

        elif side == "SELL":
            if existing and existing.side == "BUY":
                sell_qty = min(quantity, existing.qty)
                bd_sell = (
                    bd_total
                    if sell_qty == quantity
                    else calculate_order_charges(
                        symbol=symbol,
                        quantity=sell_qty,
                        price=exec_price,
                        side="SELL",
                        product_type=prod,
                        broker_plan=plan,
                        region=resolved_country,
                        exchange=resolved_exch,
                        currency=currency,
                        category=category,
                    )
                )
                ratio = sell_qty / existing.qty if existing.qty > 0 else 1.0
                released_margin = float(existing.margin_blocked or (existing.avg_entry_price * existing.qty / lev)) * ratio
                entry_chg_share = float(existing.entry_charges or 0.0) * ratio

                gross_pnl = (exec_price - existing.avg_entry_price) * sell_qty
                net_pnl = gross_pnl - entry_chg_share - bd_sell.total_charges
                tax_rate, _ = estimate_capital_gains_tax_rate(resolved_country, prod)
                est_tax = round(max(0.0, net_pnl) * tax_rate, 2)

                balance = round(balance + released_margin + gross_pnl - bd_sell.total_charges, 2)
                wallet.balance = balance

                total_chg_rt = round(entry_chg_share + bd_sell.total_charges, 2)
                pnl_pct = round((net_pnl / released_margin) * 100.0, 2) if released_margin > 0 else 0.0
                db.add(
                    ClosedTradeModel(
                        id=f"cls-{uuid.uuid4().hex[:8]}",
                        user_id=user_id,
                        symbol=symbol,
                        name=name,
                        country=resolved_country,
                        exchange=resolved_exch,
                        currency=currency,
                        product_type=prod,
                        side="LONG",
                        qty=sell_qty,
                        entry_price=round(float(existing.avg_entry_price), 4),
                        exit_price=round(exec_price, 4),
                        gross_pnl=round(gross_pnl, 2),
                        entry_charges=round(entry_chg_share, 2),
                        exit_charges=round(bd_sell.total_charges, 2),
                        total_charges=total_chg_rt,
                        net_pnl=round(net_pnl, 2),
                        est_tax=est_tax,
                        pnl_percent=pnl_pct,
                        journal_note=notes[:490],
                        opened_at=existing.opened_at or _utcnow(),
                        closed_at=_utcnow(),
                    )
                )

                realized_gross_total += gross_pnl
                realized_net_total += net_pnl

                existing.qty -= sell_qty
                existing.margin_blocked = max(0.0, round(float(existing.margin_blocked or 0.0) - released_margin, 2))
                existing.entry_charges = max(0.0, round(float(existing.entry_charges or 0.0) - entry_chg_share, 2))
                existing.realized_pnl = round(float(existing.realized_pnl or 0.0) + net_pnl, 2)
                if existing.qty <= 0:
                    db.delete(existing)
                    db.flush()
                    existing = None
                msg = f"Sold {sell_qty} {symbol} ({prod}) @ {currency} {exec_price:.2f} | Net P&L: {net_pnl:+.2f}"
                rem_qty = quantity - sell_qty
            else:
                rem_qty = quantity

            if rem_qty > 0:
                bd_rem = (
                    bd_total
                    if rem_qty == quantity
                    else calculate_order_charges(
                        symbol=symbol,
                        quantity=rem_qty,
                        price=exec_price,
                        side="SELL",
                        product_type=prod,
                        broker_plan=plan,
                        region=resolved_country,
                        exchange=resolved_exch,
                        currency=currency,
                        category=category,
                    )
                )
                rem_notional = exec_price * rem_qty
                req_margin = bd_rem.margin_required
                margin_req = req_margin + bd_rem.total_charges
                if balance < margin_req:
                    raise ValueError(
                        f"Insufficient {currency} margin for SHORT! Need {margin_req:,.2f} (Margin {req_margin:,.2f} + Charges {bd_rem.total_charges:,.2f}), have {balance:,.2f}"
                    )
                wallet.balance = round(balance - margin_req, 2)
                init_sl = stop_loss
                if trailing_sl and init_sl is None:
                    init_sl = round(exec_price + trailing_sl, 4)

                if existing and existing.side == "SHORT":
                    new_qty = existing.qty + rem_qty
                    existing.avg_entry_price = round(
                        ((existing.avg_entry_price * existing.qty) + rem_notional) / new_qty, 4
                    )
                    existing.qty = new_qty
                    existing.current_price = round(exec_price, 4)
                    existing.margin_blocked = round(float(existing.margin_blocked or 0.0) + req_margin, 2)
                    existing.entry_charges = round(float(existing.entry_charges or 0.0) + bd_rem.total_charges, 2)
                    existing.lowest_price = min(float(existing.lowest_price or exec_price), exec_price)
                    if init_sl is not None:
                        existing.stop_loss = init_sl
                    if take_profit is not None:
                        existing.take_profit = take_profit
                    if trailing_sl is not None:
                        existing.trailing_sl = trailing_sl
                else:
                    db.add(
                        PositionModel(
                            id=f"pos-{uuid.uuid4().hex[:8]}",
                            user_id=user_id,
                            symbol=symbol,
                            name=name,
                            country=resolved_country,
                            exchange=resolved_exch,
                            currency=currency,
                            side="SHORT",
                            product_type=prod,
                            leverage=lev,
                            margin_blocked=round(req_margin, 2),
                            entry_charges=round(bd_rem.total_charges, 2),
                            qty=rem_qty,
                            avg_entry_price=round(exec_price, 4),
                            current_price=round(exec_price, 4),
                            stop_loss=init_sl,
                            take_profit=take_profit,
                            trailing_sl=trailing_sl,
                            highest_price=round(exec_price, 4),
                            lowest_price=round(exec_price, 4),
                            opened_at=_utcnow(),
                        )
                    )
                short_msg = f"Shorted {rem_qty} {symbol} ({prod}) @ {currency} {exec_price:.2f} | Fees: {currency} {bd_rem.total_charges:.2f}"
                msg = f"{msg} + {short_msg}" if msg else short_msg
        else:
            raise ValueError("order_type must be BUY or SELL")

        if existing_order is not None:
            order_row = existing_order
            order_row.status = "FILLED"
            order_row.price = round(exec_price, 4)
            order_row.realized_pnl = round(realized_gross_total, 2)
            order_row.net_pnl = round(realized_net_total, 2)
            order_row.filled_at = _utcnow()
            cls._apply_tax_fields(order_row, bd_total)
        else:
            order_row = OrderModel(
                id=f"ord-{uuid.uuid4().hex[:8]}",
                user_id=user_id,
                symbol=symbol,
                name=name,
                country=resolved_country,
                exchange=resolved_exch,
                currency=currency,
                side=side,
                order_mode=order_mode,
                product_type=prod,
                broker_plan=plan,
                status="FILLED",
                price=round(exec_price, 4),
                qty=quantity,
                realized_pnl=round(realized_gross_total, 2),
                net_pnl=round(realized_net_total, 2),
                stop_loss=stop_loss,
                take_profit=take_profit,
                trailing_sl=trailing_sl,
                notes=notes[:250],
                filled_at=_utcnow(),
            )
            cls._apply_tax_fields(order_row, bd_total)
            db.add(order_row)

        cls._recompute_margin_used(db, user_id, wallets_map)
        db.commit()
        return {
            "status": "SUCCESS",
            "message": msg,
            "order_id": order_row.id,
            "charges_breakdown": bd_total.to_dict(),
        }

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
    def modify_pending_order(
        cls,
        db: Session,
        user_id: str,
        order_id: str,
        limit_price: Optional[float] = None,
        quantity: Optional[int] = None,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
    ) -> dict:
        row = db.scalar(
            select(OrderModel).where(
                OrderModel.id == order_id,
                OrderModel.user_id == user_id,
                OrderModel.status == "PENDING",
            )
        )
        if not row:
            raise ValueError("Pending order not found")
        if limit_price is not None:
            if limit_price <= 0:
                raise ValueError("Limit price must be positive")
            row.limit_price = round(float(limit_price), 4)
        if quantity is not None:
            if quantity <= 0:
                raise ValueError("Quantity must be positive")
            row.qty = int(quantity)
        if stop_loss is not None:
            row.stop_loss = float(stop_loss) if stop_loss > 0 else None
        if take_profit is not None:
            row.take_profit = float(take_profit) if take_profit > 0 else None
        row.gross_amount = round(float(row.limit_price or row.price) * row.qty, 2)
        db.commit()
        return {"status": "MODIFIED", "order": cls._serialize_order(row)}

    @classmethod
    def update_position_risk(
        cls,
        db: Session,
        user_id: str,
        position_id: str,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        trailing_sl: Optional[float] = None,
    ) -> dict:
        pos = db.scalar(
            select(PositionModel).where(PositionModel.id == position_id, PositionModel.user_id == user_id)
        )
        if not pos:
            raise ValueError("Position not found")
        pos.stop_loss = float(stop_loss) if (stop_loss is not None and stop_loss > 0) else None
        pos.take_profit = float(take_profit) if (take_profit is not None and take_profit > 0) else None
        if trailing_sl is not None and trailing_sl > 0:
            pos.trailing_sl = float(trailing_sl)
            cur = float(pos.current_price or pos.avg_entry_price)
            if pos.side == "BUY":
                pos.highest_price = max(float(pos.highest_price or cur), cur)
                if pos.stop_loss is None:
                    pos.stop_loss = round(pos.highest_price - pos.trailing_sl, 4)
            else:
                pos.lowest_price = min(float(pos.lowest_price or cur), cur)
                if pos.stop_loss is None:
                    pos.stop_loss = round(pos.lowest_price + pos.trailing_sl, 4)
        else:
            pos.trailing_sl = None
        db.commit()
        return {
            "status": "UPDATED",
            "id": pos.id,
            "symbol": pos.symbol,
            "stop_loss": pos.stop_loss,
            "take_profit": pos.take_profit,
            "trailing_sl": pos.trailing_sl,
        }

    @classmethod
    def square_off_all(
        cls,
        db: Session,
        user_id: str,
        price_map: Dict[str, dict],
        country: Optional[str] = None,
    ) -> dict:
        query = select(PositionModel).where(PositionModel.user_id == user_id)
        if country and country.upper() != "ALL":
            query = query.where(PositionModel.country == country.upper())
        pos_rows = db.scalars(query).all()
        closed_count = 0
        for pos in pos_rows:
            q = price_map.get(pos.symbol)
            px = float(q["price"]) if q and q.get("price", 0) > 0 else float(pos.current_price or pos.avg_entry_price)
            if px <= 0:
                continue
            exit_side = "SELL" if pos.side == "BUY" else "BUY"
            cls._execute_fill(
                db=db,
                user_id=user_id,
                symbol=pos.symbol,
                name=pos.name,
                currency=pos.currency,
                quantity=pos.qty,
                side=exit_side,
                exec_price=px,
                product_type=pos.product_type or "DELIVERY",
                order_mode="MARKET",
                country=pos.country,
                exchange=pos.exchange,
                notes="Square Off All",
            )
            closed_count += 1
        return {"status": "SUCCESS", "closed_count": closed_count, "message": f"Squared off {closed_count} position(s)."}

    @classmethod
    def reset_user_portfolio(cls, db: Session, user_id: str, country: Optional[str] = None) -> None:
        raise PermissionError(
            "Wallet reset is permanently disabled. Fixed starting capital discipline is enforced on this terminal."
        )

    @classmethod
    def evaluate_all_pending_and_stops(cls, db: Session, price_map: Dict[str, dict]) -> List[dict]:
        """Evaluates pending Limit/Stop orders, Trailing SL ratchets, and active SL/TP triggers safely per user_id."""
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
                        db=db,
                        user_id=pnd.user_id,
                        symbol=pnd.symbol,
                        name=pnd.name,
                        currency=pnd.currency,
                        quantity=pnd.qty,
                        side=pnd.side,
                        exec_price=px,
                        stop_loss=pnd.stop_loss,
                        take_profit=pnd.take_profit,
                        trailing_sl=pnd.trailing_sl,
                        product_type=pnd.product_type or "DELIVERY",
                        broker_plan=pnd.broker_plan or "DISCOUNT",
                        order_mode=pnd.order_mode or "LIMIT",
                        country=pnd.country,
                        exchange=pnd.exchange,
                        notes=pnd.notes or f"{pnd.order_mode} Triggered",
                        existing_order=pnd,
                    )
                    events.append({"user_id": pnd.user_id, "type": "ORDER_FILL", **res})
                except Exception as exc:
                    db.rollback()
                    try:
                        pnd_ref = db.get(OrderModel, pnd.id)
                        if pnd_ref and pnd_ref.status == "PENDING":
                            pnd_ref.status = "REJECTED"
                            pnd_ref.reject_reason = str(exc)[:250]
                            db.commit()
                    except Exception:
                        db.rollback()

        pos_rows = db.scalars(
            select(PositionModel).where(
                (PositionModel.stop_loss.is_not(None))
                | (PositionModel.take_profit.is_not(None))
                | (PositionModel.trailing_sl.is_not(None))
            )
        ).all()
        for pos in pos_rows:
            q = price_map.get(pos.symbol)
            if not q or q.get("price", 0) <= 0:
                continue
            px = float(q["price"])
            try:
                # Ratchet Trailing Stop-Loss dynamically
                if pos.trailing_sl is not None and pos.trailing_sl > 0:
                    if pos.side == "BUY":
                        hi = max(float(pos.highest_price or pos.avg_entry_price), px)
                        if pos.highest_price != hi:
                            pos.highest_price = round(hi, 4)
                        trail_sl = round(hi - pos.trailing_sl, 4)
                        if pos.stop_loss is None or trail_sl > pos.stop_loss:
                            pos.stop_loss = trail_sl
                            db.commit()
                    else:
                        lo = min(float(pos.lowest_price or pos.avg_entry_price), px)
                        if pos.lowest_price != lo:
                            pos.lowest_price = round(lo, 4)
                        trail_sl = round(lo + pos.trailing_sl, 4)
                        if pos.stop_loss is None or trail_sl < pos.stop_loss:
                            pos.stop_loss = trail_sl
                            db.commit()

                sl, tp = pos.stop_loss, pos.take_profit
                if pos.side == "BUY" and ((sl is not None and px <= sl) or (tp is not None and px >= tp)):
                    reason = "Take-Profit Target Hit" if (tp is not None and px >= tp) else "Stop-Loss Triggered"
                    res = cls._execute_fill(
                        db=db,
                        user_id=pos.user_id,
                        symbol=pos.symbol,
                        name=pos.name,
                        currency=pos.currency,
                        quantity=pos.qty,
                        side="SELL",
                        exec_price=px,
                        product_type=pos.product_type or "DELIVERY",
                        order_mode="MARKET",
                        country=pos.country,
                        exchange=pos.exchange,
                        notes=reason,
                    )
                    events.append({"user_id": pos.user_id, "type": "ORDER_FILL", **res})
                elif pos.side == "SHORT" and ((sl is not None and px >= sl) or (tp is not None and px <= tp)):
                    reason = "Take-Profit Target Hit" if (tp is not None and px <= tp) else "Stop-Loss Triggered"
                    res = cls._execute_fill(
                        db=db,
                        user_id=pos.user_id,
                        symbol=pos.symbol,
                        name=pos.name,
                        currency=pos.currency,
                        quantity=pos.qty,
                        side="BUY",
                        exec_price=px,
                        product_type=pos.product_type or "DELIVERY",
                        order_mode="MARKET",
                        country=pos.country,
                        exchange=pos.exchange,
                        notes=reason,
                    )
                    events.append({"user_id": pos.user_id, "type": "ORDER_FILL", **res})
            except Exception:
                db.rollback()
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


def _ensure_seed_trade_ideas(db: Session, price_map: Dict[str, dict]) -> None:
    existing = db.scalar(select(TradeIdeaModel.id).limit(1))
    if existing:
        return
    # Ensure a system community user exists for initial feed ideas
    sys_user = db.scalar(select(UserModel).where(UserModel.email == "community@agam.local"))
    if not sys_user:
        sys_user = UserModel(
            id=str(uuid.uuid4()),
            email="community@agam.local",
            hashed_password="!",
            role="community",
            base_currency="INR",
            is_guest=False,
        )
        db.add(sys_user)
        db.flush()

    def _px(sym: str, fallback: float) -> float:
        q = price_map.get(sym)
        return round(float(q["price"]), 2) if q and q.get("price", 0) > 0 else fallback

    seeds = [
        ("RELIANCE.NS", "Reliance Industries Ltd", "IND", "INR", "BULLISH", "INTRADAY", _px("RELIANCE.NS", 1380.0), 1.03, 0.985, "15m", "Breakout above VWAP + strong refining volume support. Targeting 3% intraday swing.", "Arjun Mehta"),
        ("TCS.NS", "Tata Consultancy Services", "IND", "INR", "BULLISH", "DELIVERY", _px("TCS.NS", 3850.0), 1.06, 0.97, "1D", "Accumulating near 20-EMA support ahead of quarterly IT deal wins.", "Priya Nair"),
        ("NVDA", "NVIDIA Corporation", "USA", "USD", "BULLISH", "INTRADAY", _px("NVDA", 142.0), 1.045, 0.975, "1h", "Momentum continuation above prior session high with strong AI server demand.", "Marcus Vance"),
        ("AAPL", "Apple Inc", "USA", "USD", "BEARISH", "INTRADAY", _px("AAPL", 235.0), 0.97, 1.015, "15m", "Rejection at upper Bollinger Band with bearish RSI divergence.", "Elena Rostova"),
        ("SHOP.TO", "Shopify Inc", "CANADA", "CAD", "BULLISH", "DELIVERY", _px("SHOP.TO", 148.0), 1.07, 0.96, "1D", "TSX tech leader holding higher lows with expanding gross margins.", "Liam O'Connor"),
        ("600519.SS", "Kweichow Moutai", "CHINA", "CNY", "BULLISH", "DELIVERY", _px("600519.SS", 1520.0), 1.05, 0.97, "1D", "SSE consumer staple rebound from multi-week value area low.", "Wei Chen"),
        ("ASML.AS", "ASML Holding N.V.", "EU", "EUR", "BULLISH", "DELIVERY", _px("ASML.AS", 710.0), 1.06, 0.97, "1D", "Euronext lithography leader bouncing off 50-DMA demand zone.", "Lukas Weber"),
    ]
    for sym, nm, ctry, curr, dirn, prod, px, tgt_m, sl_m, tf, thesis, author in seeds:
        db.add(
            TradeIdeaModel(
                id=f"idea-{uuid.uuid4().hex[:8]}",
                user_id=sys_user.id,
                author_name=author,
                symbol=sym,
                name=nm,
                country=ctry,
                currency=curr,
                direction=dirn,
                product_type=prod,
                entry_price=px,
                target_price=round(px * tgt_m, 2),
                stop_loss=round(px * sl_m, 2),
                timeframe=tf,
                thesis=thesis,
                likes_count=12,
            )
        )
    db.commit()


def list_trade_ideas(db: Session, price_map: Dict[str, dict], country: Optional[str] = None) -> List[dict]:
    _ensure_seed_trade_ideas(db, price_map)
    q = select(TradeIdeaModel).order_by(desc(TradeIdeaModel.created_at)).limit(50)
    if country and country.upper() != "ALL":
        q = select(TradeIdeaModel).where(TradeIdeaModel.country == country.upper()).order_by(desc(TradeIdeaModel.created_at)).limit(50)
    rows = db.scalars(q).all()
    out = []
    for r in rows:
        live = price_map.get(r.symbol)
        cur_px = float(live["price"]) if live and live.get("price", 0) > 0 else float(r.entry_price or 0.0)
        chg_from_entry = 0.0
        if r.entry_price > 0 and cur_px > 0:
            raw_pct = ((cur_px - r.entry_price) / r.entry_price) * 100.0
            chg_from_entry = round(raw_pct if r.direction == "BULLISH" else -raw_pct, 2)
        out.append({
            "id": r.id,
            "author_name": r.author_name,
            "symbol": r.symbol,
            "name": r.name,
            "country": r.country,
            "currency": r.currency,
            "direction": r.direction,
            "product_type": r.product_type,
            "entry_price": round(float(r.entry_price), 2),
            "current_price": round(cur_px, 2),
            "change_since_idea_pct": chg_from_entry,
            "target_price": r.target_price,
            "stop_loss": r.stop_loss,
            "timeframe": r.timeframe,
            "thesis": r.thesis,
            "likes_count": r.likes_count,
            "created_at": _fmt_utc_iso(r.created_at),
            "created_time": _fmt_utc_time(r.created_at),
        })
    return out


def create_trade_idea(
    db: Session,
    user: UserModel,
    symbol: str,
    name: str,
    country: str,
    currency: str,
    direction: str,
    product_type: str,
    entry_price: float,
    target_price: Optional[float],
    stop_loss: Optional[float],
    timeframe: str,
    thesis: str,
) -> dict:
    author = (user.display_name or "").strip() or user.email.split("@")[0]
    row = TradeIdeaModel(
        id=f"idea-{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        author_name=author,
        symbol=symbol,
        name=name,
        country=country,
        currency=currency,
        direction=direction.upper(),
        product_type=product_type.upper(),
        entry_price=round(float(entry_price), 4),
        target_price=round(float(target_price), 4) if target_price else None,
        stop_loss=round(float(stop_loss), 4) if stop_loss else None,
        timeframe=timeframe or "1D",
        thesis=thesis.strip()[:1000],
        likes_count=1,
    )
    db.add(row)
    db.commit()
    return {
        "id": row.id,
        "author_name": row.author_name,
        "symbol": row.symbol,
        "name": row.name,
        "country": row.country,
        "currency": row.currency,
        "direction": row.direction,
        "product_type": row.product_type,
        "entry_price": row.entry_price,
        "current_price": row.entry_price,
        "change_since_idea_pct": 0.0,
        "target_price": row.target_price,
        "stop_loss": row.stop_loss,
        "timeframe": row.timeframe,
        "thesis": row.thesis,
        "likes_count": row.likes_count,
        "created_at": _fmt_utc_iso(row.created_at),
        "created_time": _fmt_utc_time(row.created_at),
    }


def like_trade_idea(db: Session, idea_id: str) -> Optional[dict]:
    row = db.get(TradeIdeaModel, idea_id)
    if not row:
        return None
    row.likes_count += 1
    db.commit()
    return {"id": row.id, "likes_count": row.likes_count}


def log_activity(
    db: Session,
    user_id: str,
    category: str,
    action: str,
    symbol: str = "",
    details: str = "",
    commit: bool = True,
) -> dict:
    row = ActivityLogModel(
        id=f"act-{uuid.uuid4().hex[:10]}",
        user_id=user_id,
        category=(category or "SYSTEM").upper()[:32],
        action=(action or "EVENT").upper()[:64],
        symbol=(symbol or "")[:32],
        details=(details or "")[:1000],
    )
    db.add(row)
    if commit:
        db.commit()
    return {
        "id": row.id,
        "category": row.category,
        "action": row.action,
        "symbol": row.symbol,
        "details": row.details,
        "created_at": _fmt_utc_iso(row.created_at),
        "time_str": _fmt_utc_time(row.created_at),
    }


def get_activity_logs(db: Session, user_id: str, limit: int = 120) -> List[dict]:
    rows = db.scalars(
        select(ActivityLogModel)
        .where(ActivityLogModel.user_id == user_id)
        .order_by(desc(ActivityLogModel.created_at))
        .limit(max(1, min(limit, 500)))
    ).all()
    return [
        {
            "id": r.id,
            "category": r.category,
            "action": r.action,
            "symbol": r.symbol,
            "details": r.details,
            "created_at": _fmt_utc_iso(r.created_at),
            "time_str": _fmt_utc_time(r.created_at),
        }
        for r in rows
    ]
