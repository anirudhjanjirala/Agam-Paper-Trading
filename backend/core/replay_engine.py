from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class ReplaySession:
    session_id: str
    symbol: str
    interval: str
    currency: str
    bars: List[dict]
    cursor: int  # index of last revealed bar (inclusive)
    replay_cash: float
    initial_cash: float
    position_qty: int = 0
    avg_entry_price: float = 0.0
    realized_pnl: float = 0.0
    trades: List[dict] = field(default_factory=list)

    def current_bar(self) -> Optional[dict]:
        if 0 <= self.cursor < len(self.bars):
            return self.bars[self.cursor]
        return None

    def unrealized_pnl(self) -> float:
        cur = self.current_bar()
        if not cur or self.position_qty == 0:
            return 0.0
        return round((cur["close"] - self.avg_entry_price) * self.position_qty, 2)

    def snapshot(self) -> dict:
        cur = self.current_bar()
        return {
            "session_id": self.session_id,
            "symbol": self.symbol,
            "interval": self.interval,
            "currency": self.currency,
            "total_bars": len(self.bars),
            "cursor": self.cursor,
            "has_next": self.cursor < (len(self.bars) - 1),
            "has_prev": self.cursor > 10,
            "visible_bars": self.bars[: self.cursor + 1],
            "current_price": cur["close"] if cur else 0.0,
            "current_time": cur["time"] if cur else "",
            "isolated_wallet": {
                "cash": round(self.replay_cash, 2),
                "initial_cash": self.initial_cash,
                "position_qty": self.position_qty,
                "avg_entry_price": round(self.avg_entry_price, 2),
                "realized_pnl": round(self.realized_pnl, 2),
                "unrealized_pnl": self.unrealized_pnl(),
                "total_equity": round(self.replay_cash + (self.position_qty * (cur["close"] if cur else 0.0)), 2),
                "trades": self.trades[:20],
            },
        }


class IsolatedReplayEngine:
    """
    Bar Replay Simulation Engine:
    Strictly isolated from live paper wallets and live positions.
    """

    def __init__(self) -> None:
        self._sessions: Dict[str, ReplaySession] = {}

    def start_session(
        self,
        symbol: str,
        interval: str,
        currency: str,
        bars: List[dict],
        start_ratio: float = 0.5,
        initial_cash: float = 100000.0,
    ) -> ReplaySession:
        sid = f"rep-{int(time.time() * 1000)}"
        start_idx = max(10, min(len(bars) - 1, int(len(bars) * start_ratio)))
        sess = ReplaySession(
            session_id=sid,
            symbol=symbol,
            interval=interval,
            currency=currency,
            bars=bars,
            cursor=start_idx,
            replay_cash=initial_cash,
            initial_cash=initial_cash,
        )
        self._sessions[sid] = sess
        return sess

    def step(self, session_id: str, delta: int = 1) -> ReplaySession:
        sess = self._sessions.get(session_id)
        if not sess:
            raise KeyError("Replay session not found")
        sess.cursor = max(10, min(len(sess.bars) - 1, sess.cursor + delta))
        return sess

    def place_isolated_trade(self, session_id: str, side: str, qty: int) -> ReplaySession:
        sess = self._sessions.get(session_id)
        if not sess:
            raise KeyError("Replay session not found")
        cur = sess.current_bar()
        if not cur or qty <= 0:
            raise ValueError("Invalid replay bar or quantity")

        px = float(cur["close"])
        if side.upper() == "BUY":
            cost = px * qty
            if sess.replay_cash < cost:
                raise ValueError(f"Insufficient isolated replay cash ({sess.replay_cash:.2f} < {cost:.2f})")
            sess.replay_cash -= cost
            new_qty = sess.position_qty + qty
            if sess.position_qty >= 0:
                sess.avg_entry_price = ((sess.avg_entry_price * sess.position_qty) + cost) / new_qty
            sess.position_qty = new_qty
        elif side.upper() == "SELL":
            if sess.position_qty < qty:
                raise ValueError("Insufficient replay position to sell")
            pnl = (px - sess.avg_entry_price) * qty
            sess.realized_pnl += pnl
            sess.replay_cash += px * qty
            sess.position_qty -= qty
            if sess.position_qty == 0:
                sess.avg_entry_price = 0.0
        else:
            raise ValueError("Side must be BUY or SELL")

        sess.trades.insert(0, {
            "side": side.upper(),
            "qty": qty,
            "price": px,
            "bar_time": cur["time"],
        })
        return sess

    def get_session(self, session_id: str) -> Optional[ReplaySession]:
        return self._sessions.get(session_id)
