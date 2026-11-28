from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional


def _replay_px_decimals(px: float) -> int:
    ap = abs(float(px or 0.0))
    if ap <= 0:
        return 2
    if ap < 0.0001:
        return 8
    if ap < 0.01:
        return 6
    if ap < 10.0:
        return 5
    if ap < 500.0:
        return 3
    return 2


def _replay_r_qty(qty: float) -> float:
    q = round(float(qty or 0.0), 8)
    if abs(q - round(q)) < 1e-8:
        return float(round(q))
    return q


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
    fx_scale: float = 1.0
    position_qty: float = 0.0  # >0 Long, <0 Short
    avg_entry_price: float = 0.0
    realized_pnl: float = 0.0
    peak_equity: float = 0.0
    max_drawdown_pct: float = 0.0
    wins: int = 0
    losses: int = 0
    trades: List[dict] = field(default_factory=list)

    def current_bar(self) -> Optional[dict]:
        if 0 <= self.cursor < len(self.bars):
            return self.bars[self.cursor]
        return None

    def unrealized_pnl(self) -> float:
        cur = self.current_bar()
        if not cur or abs(self.position_qty) < 1e-8:
            return 0.0
        px = float(cur["close"])
        if self.position_qty > 0:
            return round((px - self.avg_entry_price) * self.position_qty * self.fx_scale, 2)
        return round((self.avg_entry_price - px) * abs(self.position_qty) * self.fx_scale, 2)

    def update_drawdown(self) -> None:
        cur = self.current_bar()
        px = float(cur["close"]) if cur else 0.0
        margin_locked = abs(self.position_qty) * self.avg_entry_price * self.fx_scale
        eq = self.replay_cash + margin_locked + self.unrealized_pnl()
        if self.peak_equity <= 0:
            self.peak_equity = max(self.initial_cash, eq)
        else:
            self.peak_equity = max(self.peak_equity, eq)
        if self.peak_equity > 0:
            dd = ((self.peak_equity - eq) / self.peak_equity) * 100.0
            self.max_drawdown_pct = round(max(self.max_drawdown_pct, max(0.0, dd)), 2)

    def snapshot(self) -> dict:
        cur = self.current_bar()
        self.update_drawdown()
        cur_px = float(cur["close"]) if cur else 0.0
        px_dec = _replay_px_decimals(cur_px or self.avg_entry_price)
        unreal = self.unrealized_pnl()
        margin_locked = abs(self.position_qty) * self.avg_entry_price * self.fx_scale
        total_eq = round(self.replay_cash + margin_locked + unreal, 2)
        closed_total = self.wins + self.losses
        win_rate = round((self.wins / closed_total) * 100.0, 1) if closed_total > 0 else 0.0
        ret_pct = round(((total_eq - self.initial_cash) / self.initial_cash) * 100.0, 2) if self.initial_cash > 0 else 0.0
        return {
            "session_id": self.session_id,
            "symbol": self.symbol,
            "interval": self.interval,
            "currency": self.currency,
            "fx_scale": self.fx_scale,
            "total_bars": len(self.bars),
            "cursor": self.cursor,
            "has_next": self.cursor < (len(self.bars) - 1),
            "has_prev": self.cursor > 10,
            "visible_bars": self.bars[: self.cursor + 1],
            "current_price": round(cur_px, px_dec),
            "current_time": cur["time"] if cur else "",
            "isolated_wallet": {
                "cash": round(self.replay_cash, 2),
                "initial_cash": self.initial_cash,
                "position_qty": _replay_r_qty(self.position_qty),
                "avg_entry_price": round(self.avg_entry_price, px_dec),
                "realized_pnl": round(self.realized_pnl, 2),
                "unrealized_pnl": unreal,
                "total_equity": total_eq,
                "return_pct": ret_pct,
                "max_drawdown_pct": self.max_drawdown_pct,
                "win_rate_pct": win_rate,
                "closed_trades": closed_total,
                "trades": self.trades[:30],
            },
        }


class IsolatedReplayEngine:
    """
    Bar Replay Simulation Engine:
    Strictly isolated from live paper wallets and live positions; supports Long, Short & Fractional qty.
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
        fx_scale: float = 1.0,
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
            fx_scale=max(1e-8, float(fx_scale or 1.0)),
            peak_equity=initial_cash,
        )
        self._sessions[sid] = sess
        return sess

    def step(self, session_id: str, delta: int = 1) -> ReplaySession:
        sess = self._sessions.get(session_id)
        if not sess:
            raise KeyError("Replay session not found")
        sess.cursor = max(10, min(len(sess.bars) - 1, sess.cursor + delta))
        sess.update_drawdown()
        return sess

    def place_isolated_trade(self, session_id: str, side: str, qty: float) -> ReplaySession:
        sess = self._sessions.get(session_id)
        if not sess:
            raise KeyError("Replay session not found")
        cur = sess.current_bar()
        q = float(qty or 0.0)
        if not cur or q <= 1e-8:
            raise ValueError("Invalid replay bar or quantity")

        px = float(cur["close"])
        side_u = side.upper().strip()
        scale = sess.fx_scale

        if side_u == "BUY":
            if sess.position_qty < -1e-8:
                cover_qty = min(q, abs(sess.position_qty))
                pnl = (sess.avg_entry_price - px) * cover_qty * scale
                sess.realized_pnl += pnl
                if pnl >= 0:
                    sess.wins += 1
                else:
                    sess.losses += 1
                released = sess.avg_entry_price * cover_qty * scale
                sess.replay_cash += released + pnl
                sess.position_qty = _replay_r_qty(sess.position_qty + cover_qty)
                if abs(sess.position_qty) < 1e-8:
                    sess.position_qty = 0.0
                    sess.avg_entry_price = 0.0
                rem_qty = _replay_r_qty(q - cover_qty)
            else:
                rem_qty = q

            if rem_qty > 1e-8:
                cost = px * rem_qty * scale
                if sess.replay_cash + 1e-6 < cost:
                    raise ValueError(f"Insufficient isolated replay cash ({sess.replay_cash:.2f} < {cost:.2f})")
                sess.replay_cash -= cost
                new_qty = _replay_r_qty(sess.position_qty + rem_qty)
                sess.avg_entry_price = ((sess.avg_entry_price * sess.position_qty) + (px * rem_qty)) / new_qty
                sess.position_qty = new_qty

        elif side_u == "SELL":
            if sess.position_qty > 1e-8:
                close_qty = min(q, sess.position_qty)
                pnl = (px - sess.avg_entry_price) * close_qty * scale
                sess.realized_pnl += pnl
                if pnl >= 0:
                    sess.wins += 1
                else:
                    sess.losses += 1
                released = sess.avg_entry_price * close_qty * scale
                sess.replay_cash += released + pnl
                sess.position_qty = _replay_r_qty(sess.position_qty - close_qty)
                if abs(sess.position_qty) < 1e-8:
                    sess.position_qty = 0.0
                    sess.avg_entry_price = 0.0
                rem_qty = _replay_r_qty(q - close_qty)
            else:
                rem_qty = q

            if rem_qty > 1e-8:
                margin = px * rem_qty * scale
                if sess.replay_cash + 1e-6 < margin:
                    raise ValueError(f"Insufficient isolated replay cash for short margin ({sess.replay_cash:.2f} < {margin:.2f})")
                sess.replay_cash -= margin
                cur_short = abs(sess.position_qty)
                new_short = _replay_r_qty(cur_short + rem_qty)
                sess.avg_entry_price = ((sess.avg_entry_price * cur_short) + (px * rem_qty)) / new_short
                sess.position_qty = -new_short
        else:
            raise ValueError("Side must be BUY or SELL")

        sess.update_drawdown()
        sess.trades.insert(0, {
            "side": side_u,
            "qty": _replay_r_qty(q),
            "price": round(px, _replay_px_decimals(px)),
            "bar_time": cur["time"],
        })
        return sess

    def get_session(self, session_id: str) -> Optional[ReplaySession]:
        return self._sessions.get(session_id)
