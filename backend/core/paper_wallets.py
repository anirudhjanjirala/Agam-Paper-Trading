from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


DEFAULT_WALLETS: Dict[str, float] = {
    "INR": 1000000.00,   # India ₹10,00,000
    "USD": 100000.00,    # USA $100,000
    "CAD": 100000.00,    # Canada C$100,000
    "CNY": 500000.00,    # China ¥500,000
    "EUR": 100000.00,    # Europe €100,000
    "GBP": 100000.00,    # UK £100,000
    "GBp": 10000000.00,  # UK LSE pence
}

REGION_DEFAULT_CURRENCY: Dict[str, str] = {
    "IND": "INR",
    "USA": "USD",
    "CANADA": "CAD",
    "CHINA": "CNY",
    "EU": "EUR",
}


class PaperTradingEngine:
    """
    Multi-Currency Paper Execution & Wallet Engine with SQLite persistence.
    Supports:
    - INR, USD, CAD, CNY, EUR (+ GBP/GBp)
    - Market & Pending Limit Orders
    - Long & Short positions
    - Automated Stop-Loss (SL) & Take-Profit (TP) evaluation on live ticks
    """

    def __init__(self, db_path: str) -> None:
        self._lock = threading.RLock()
        self.db_path = db_path
        self.wallets: Dict[str, float] = dict(DEFAULT_WALLETS)
        self.positions: List[dict] = []
        self.pending_orders: List[dict] = []
        self.orders_history: List[dict] = []
        self._init_db()

    def _init_db(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT)")
            row = conn.execute("SELECT value FROM state WHERE key = 'portfolio'").fetchone()
            if row:
                saved = json.loads(row[0])
                self.wallets = {**DEFAULT_WALLETS, **saved.get("wallets", {})}
                self.positions = saved.get("positions", [])
                self.pending_orders = saved.get("pending_orders", [])
                self.orders_history = saved.get("orders_history", [])
            else:
                self._save_db()

    def _save_db(self) -> None:
        payload = json.dumps({
            "wallets": self.wallets,
            "positions": self.positions,
            "pending_orders": self.pending_orders,
            "orders_history": self.orders_history[:100],
        })
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT OR REPLACE INTO state (key, value) VALUES ('portfolio', ?)", (payload,))
            conn.commit()

    def place_order(
        self,
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

        with self._lock:
            # Queue pending LIMIT order if target price hasn't been reached yet
            if mode == "LIMIT" and limit_price is not None:
                should_fill_now = (side == "BUY" and live_price <= limit_price) or (side == "SELL" and live_price >= limit_price)
                if not should_fill_now:
                    pending = {
                        "id": f"pnd-{uuid.uuid4().hex[:8]}",
                        "symbol": symbol,
                        "name": name,
                        "currency": currency,
                        "quantity": quantity,
                        "order_type": side,
                        "limit_price": round(float(limit_price), 4),
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "status": "PENDING_LIMIT",
                        "created_at": datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
                    }
                    self.pending_orders.insert(0, pending)
                    self._save_db()
                    return {"status": "PENDING", "message": f"Limit {side} queued for {quantity} {symbol} @ {currency} {limit_price:.2f}", "order": pending}

            return self._execute_fill(symbol, name, currency, quantity, side, live_price, stop_loss, take_profit)

    def cancel_pending_order(self, order_id: str) -> bool:
        with self._lock:
            before = len(self.pending_orders)
            self.pending_orders = [p for p in self.pending_orders if p.get("id") != order_id]
            if len(self.pending_orders) < before:
                self._save_db()
                return True
            return False

    def _execute_fill(
        self,
        symbol: str,
        name: str,
        currency: str,
        quantity: int,
        side: str,
        exec_price: float,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
    ) -> dict:
        balance = self.wallets.get(currency, 100000.0)
        notional = exec_price * quantity
        charges = round(notional * 0.001, 2)  # 0.10% simulated statutory fees

        existing = next((p for p in self.positions if p["symbol"] == symbol), None)
        msg = ""

        if side == "BUY":
            if existing and existing["order_type"] == "SHORT":
                cover_qty = min(quantity, existing["quantity"])
                cover_charges = round((exec_price * cover_qty) * 0.001, 2)
                pnl = (existing["avg_price"] - exec_price) * cover_qty - cover_charges
                balance = round(balance + (existing["avg_price"] * cover_qty) + pnl, 2)
                self.wallets[currency] = balance
                existing["quantity"] -= cover_qty
                if existing["quantity"] <= 0:
                    self.positions.remove(existing)
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
                self.wallets[currency] = round(balance - total_cost, 2)
                if existing and existing["order_type"] == "BUY":
                    new_qty = existing["quantity"] + rem_qty
                    existing["avg_price"] = round(((existing["avg_price"] * existing["quantity"]) + rem_notional) / new_qty, 4)
                    existing["quantity"] = new_qty
                    existing["current_price"] = round(exec_price, 4)
                    if stop_loss is not None:
                        existing["stop_loss"] = stop_loss
                    if take_profit is not None:
                        existing["take_profit"] = take_profit
                else:
                    self.positions.append({
                        "id": f"pos-{uuid.uuid4().hex[:8]}",
                        "symbol": symbol,
                        "name": name,
                        "quantity": rem_qty,
                        "avg_price": round(exec_price, 4),
                        "current_price": round(exec_price, 4),
                        "currency": currency,
                        "order_type": "BUY",
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "pnl": 0.0,
                        "pnl_percent": 0.0,
                    })
                buy_msg = f"Bought {rem_qty} {symbol} @ {currency} {exec_price:.2f}"
                msg = f"{msg} + {buy_msg}" if msg else buy_msg

        elif side == "SELL":
            if existing and existing["order_type"] == "BUY":
                sell_qty = min(quantity, existing["quantity"])
                sell_charges = round((exec_price * sell_qty) * 0.001, 2)
                revenue = (exec_price * sell_qty) - sell_charges
                balance = round(balance + revenue, 2)
                self.wallets[currency] = balance
                existing["quantity"] -= sell_qty
                if existing["quantity"] <= 0:
                    self.positions.remove(existing)
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
                self.wallets[currency] = round(balance - margin_req, 2)
                if existing and existing["order_type"] == "SHORT":
                    new_qty = existing["quantity"] + rem_qty
                    existing["avg_price"] = round(((existing["avg_price"] * existing["quantity"]) + rem_notional) / new_qty, 4)
                    existing["quantity"] = new_qty
                    existing["current_price"] = round(exec_price, 4)
                    if stop_loss is not None:
                        existing["stop_loss"] = stop_loss
                    if take_profit is not None:
                        existing["take_profit"] = take_profit
                else:
                    self.positions.append({
                        "id": f"pos-{uuid.uuid4().hex[:8]}",
                        "symbol": symbol,
                        "name": name,
                        "quantity": rem_qty,
                        "avg_price": round(exec_price, 4),
                        "current_price": round(exec_price, 4),
                        "currency": currency,
                        "order_type": "SHORT",
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "pnl": 0.0,
                        "pnl_percent": 0.0,
                    })
                short_msg = f"Shorted {rem_qty} {symbol} @ {currency} {exec_price:.2f}"
                msg = f"{msg} + {short_msg}" if msg else short_msg
        else:
            raise ValueError("order_type must be BUY or SELL")

        self.orders_history.insert(0, {
            "id": f"ord-{uuid.uuid4().hex[:8]}",
            "symbol": symbol,
            "type": side,
            "quantity": quantity,
            "price": round(exec_price, 4),
            "currency": currency,
            "charges": charges,
            "status": "EXECUTED",
            "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
        })
        self._save_db()
        return {"status": "SUCCESS", "message": msg}

    def evaluate_live_triggers(self, price_map: Dict[str, dict]) -> None:
        """Checks pending Limit Orders and active SL/TP targets on live market updates."""
        with self._lock:
            changed = False
            # 1) Pending Limit Orders
            remaining_pending = []
            for pnd in self.pending_orders:
                q = price_map.get(pnd["symbol"])
                if not q or q.get("price", 0) <= 0:
                    remaining_pending.append(pnd)
                    continue
                px = float(q["price"])
                lp = float(pnd["limit_price"])
                if (pnd["order_type"] == "BUY" and px <= lp) or (pnd["order_type"] == "SELL" and px >= lp):
                    try:
                        self._execute_fill(
                            pnd["symbol"], pnd["name"], pnd["currency"],
                            pnd["quantity"], pnd["order_type"], px,
                            pnd.get("stop_loss"), pnd.get("take_profit")
                        )
                        changed = True
                    except Exception:
                        remaining_pending.append(pnd)
                else:
                    remaining_pending.append(pnd)
            self.pending_orders = remaining_pending

            # 2) Stop-Loss & Take-Profit auto-close
            for pos in list(self.positions):
                q = price_map.get(pos["symbol"])
                if not q or q.get("price", 0) <= 0:
                    continue
                px = float(q["price"])
                sl = pos.get("stop_loss")
                tp = pos.get("take_profit")
                if pos["order_type"] == "BUY":
                    if (sl is not None and px <= sl) or (tp is not None and px >= tp):
                        self._execute_fill(pos["symbol"], pos["name"], pos["currency"], pos["quantity"], "SELL", px)
                        changed = True
                elif pos["order_type"] == "SHORT":
                    if (sl is not None and px >= sl) or (tp is not None and px <= tp):
                        self._execute_fill(pos["symbol"], pos["name"], pos["currency"], pos["quantity"], "BUY", px)
                        changed = True

            if changed:
                self._save_db()

    def get_snapshot(self, price_map: Dict[str, dict]) -> dict:
        with self._lock:
            total_pnl = 0.0
            for pos in self.positions:
                q = price_map.get(pos["symbol"])
                cur_px = float(q["price"]) if q and q.get("price", 0) > 0 else pos["current_price"]
                pos["current_price"] = round(cur_px, 4)
                if pos["order_type"] == "BUY":
                    pnl = (cur_px - pos["avg_price"]) * pos["quantity"]
                    pct = ((cur_px - pos["avg_price"]) / pos["avg_price"]) * 100 if pos["avg_price"] else 0.0
                else:
                    pnl = (pos["avg_price"] - cur_px) * pos["quantity"]
                    pct = ((pos["avg_price"] - cur_px) / pos["avg_price"]) * 100 if pos["avg_price"] else 0.0
                pos["pnl"] = round(pnl, 2)
                pos["pnl_percent"] = round(pct, 2)
                total_pnl += pnl

            return {
                "wallets": self.wallets,
                "positions": self.positions,
                "pending_orders": self.pending_orders,
                "orders_history": self.orders_history[:30],
                "total_unrealized_pnl": round(total_pnl, 2),
            }

    def reset(self) -> None:
        with self._lock:
            self.wallets = dict(DEFAULT_WALLETS)
            self.positions = []
            self.pending_orders = []
            self.orders_history = []
            self._save_db()
