from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

Side = Literal["BUY", "SELL"]


@dataclass
class Tick:
    symbol: str
    price: float
    size: float
    ts_ms: int
    bid: Optional[float] = None
    ask: Optional[float] = None


@dataclass
class AggregatedBar:
    symbol: str
    interval: str
    time: int  # Unix seconds for Lightweight Charts
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    buy_volume: float = 0.0
    sell_volume: float = 0.0
    tick_count: int = 0
    # Price-level Bid x Ask footprint inside this bar
    footprint: Dict[float, Dict[str, float]] = field(default_factory=dict)

    def to_dict(self, include_footprint: bool = False) -> dict:
        out = {
            "time": self.time,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": round(self.volume, 4),
            "buy_volume": round(self.buy_volume, 4),
            "sell_volume": round(self.sell_volume, 4),
            "delta": round(self.buy_volume - self.sell_volume, 4),
            "tick_count": self.tick_count,
        }
        if include_footprint:
            levels = []
            for lvl in sorted(self.footprint.keys()):
                cell = self.footprint[lvl]
                b = cell["bid"]
                a = cell["ask"]
                imbalance = "ASK_IMB" if (b > 0 and a >= b * 3) else ("BID_IMB" if (a > 0 and b >= a * 3) else "NONE")
                levels.append({
                    "price": lvl,
                    "bid_vol": round(b, 4),
                    "ask_vol": round(a, 4),
                    "delta": round(a - b, 4),
                    "total_vol": round(a + b, 4),
                    "imbalance": imbalance,
                })
            out["footprint"] = levels
        return out


class LeeReadyClassifier:
    """
    Standard Lee-Ready (1991) trade direction classifier:
    1) Quote Test against Bid/Ask midpoint when available.
    2) Tick Test fallback (uptick/zero-uptick vs downtick/zero-downtick).
    """

    def __init__(self) -> None:
        self._last_price: Dict[str, float] = {}
        self._last_side: Dict[str, Side] = {}

    def classify(self, tick: Tick) -> Side:
        sym = tick.symbol
        prev_p = self._last_price.get(sym)
        prev_side = self._last_side.get(sym, "BUY")

        side: Side
        if tick.bid is not None and tick.ask is not None and tick.ask > tick.bid:
            mid = (tick.bid + tick.ask) * 0.5
            if tick.price > mid:
                side = "BUY"
            elif tick.price < mid:
                side = "SELL"
            else:
                # Midpoint trade -> fall back to Tick Rule
                if prev_p is not None and tick.price > prev_p:
                    side = "BUY"
                elif prev_p is not None and tick.price < prev_p:
                    side = "SELL"
                else:
                    side = prev_side
        else:
            if prev_p is not None and tick.price > prev_p:
                side = "BUY"
            elif prev_p is not None and tick.price < prev_p:
                side = "SELL"
            else:
                side = prev_side

        self._last_price[sym] = tick.price
        self._last_side[sym] = side
        return side


def _parse_time_seconds(interval: str) -> Optional[int]:
    unit = interval[-1]
    try:
        val = int(interval[:-1])
    except ValueError:
        return None
    if unit == "s":
        return val
    if unit == "m":
        return val * 60
    if unit == "h":
        return val * 3600
    if unit == "d":
        return val * 86400
    return None


def _price_bucket(price: float) -> float:
    ap = abs(float(price or 0.0))
    if ap <= 0:
        return 0.0
    if ap < 0.001:
        step = max(ap * 0.002, 1e-8)
        dec = 8
    elif ap < 0.05:
        step = 0.00005
        dec = 6
    elif ap < 5.0:
        step = 0.0005
        dec = 5
    elif ap < 50.0:
        step = 0.02
        dec = 3
    elif ap < 500.0:
        step = 0.25
        dec = 3
    elif ap < 5000.0:
        step = 2.0
        dec = 2
    else:
        step = 10.0
        dec = 2
    return round(round(price / step) * step, dec)


class TickAggregator:
    """
    Sub-second tick aggregator converting raw market ticks into:
    - Time bars: '1s', '5s', '15s', '1m', '5m', '15m', '1h', '1d'
    - Tick bars: '10T', '50T', '100T', etc.
    - Range bars: '0.5R', '1R', '5R', etc.
    Maintains real-time Lee-Ready Bid x Ask footprint inside each bar.
    """

    def __init__(self, max_bars: int = 500) -> None:
        self.max_bars = max_bars
        self.classifier = LeeReadyClassifier()
        # (symbol, interval) -> list of AggregatedBar
        self._bars: Dict[tuple[str, str], List[AggregatedBar]] = defaultdict(list)

    def ingest_tick(self, tick: Tick, intervals: List[str]) -> Dict[str, AggregatedBar]:
        side = self.classifier.classify(tick)
        bucket_px = _price_bucket(tick.price)
        updated: Dict[str, AggregatedBar] = {}

        for iv in intervals:
            key = (tick.symbol, iv)
            bars = self._bars[key]

            if iv.endswith("T"):
                # Tick-based bar (e.g. 10T = 10 ticks per candle)
                tick_limit = max(1, int(iv[:-1]))
                bar_ts = int(tick.ts_ms // 1000)
                if not bars or bars[-1].tick_count >= tick_limit:
                    # Ensure strictly increasing timestamps for Lightweight Charts
                    if bars and bar_ts <= bars[-1].time:
                        bar_ts = bars[-1].time + 1
                    bars.append(
                        AggregatedBar(
                            symbol=tick.symbol,
                            interval=iv,
                            time=bar_ts,
                            open=tick.price,
                            high=tick.price,
                            low=tick.price,
                            close=tick.price,
                        )
                    )
            elif iv.endswith("R"):
                # Range bar (e.g. 1.0R = new bar when High - Low > 1.0)
                range_limit = max(1e-8, float(iv[:-1]))
                bar_ts = int(tick.ts_ms // 1000)
                if not bars:
                    bars.append(
                        AggregatedBar(
                            symbol=tick.symbol,
                            interval=iv,
                            time=bar_ts,
                            open=tick.price,
                            high=tick.price,
                            low=tick.price,
                            close=tick.price,
                        )
                    )
                else:
                    cur = bars[-1]
                    proj_high = max(cur.high, tick.price)
                    proj_low = min(cur.low, tick.price)
                    if (proj_high - proj_low) > range_limit:
                        if bar_ts <= cur.time:
                            bar_ts = cur.time + 1
                        bars.append(
                            AggregatedBar(
                                symbol=tick.symbol,
                                interval=iv,
                                time=bar_ts,
                                open=tick.price,
                                high=tick.price,
                                low=tick.price,
                                close=tick.price,
                            )
                        )
            else:
                # Time-based bar (1s, 5s, 1m, etc.)
                sec = _parse_time_seconds(iv) or 60
                bucket_ts = int((tick.ts_ms // 1000) // sec * sec)
                if not bars or bars[-1].time != bucket_ts:
                    if bars and bucket_ts < bars[-1].time:
                        bucket_ts = bars[-1].time
                    if not bars or bars[-1].time != bucket_ts:
                        bars.append(
                            AggregatedBar(
                                symbol=tick.symbol,
                                interval=iv,
                                time=bucket_ts,
                                open=tick.price,
                                high=tick.price,
                                low=tick.price,
                                close=tick.price,
                            )
                        )

            cur_bar = bars[-1]
            cur_bar.high = max(cur_bar.high, tick.price)
            cur_bar.low = min(cur_bar.low, tick.price)
            cur_bar.close = tick.price
            cur_bar.volume += tick.size
            cur_bar.tick_count += 1
            if side == "BUY":
                cur_bar.buy_volume += tick.size
            else:
                cur_bar.sell_volume += tick.size

            if bucket_px not in cur_bar.footprint:
                cur_bar.footprint[bucket_px] = {"bid": 0, "ask": 0}
            if side == "BUY":
                cur_bar.footprint[bucket_px]["ask"] += tick.size
            else:
                cur_bar.footprint[bucket_px]["bid"] += tick.size

            if len(bars) > self.max_bars:
                del bars[: len(bars) - self.max_bars]

            updated[iv] = cur_bar

        return updated

    def get_bars(self, symbol: str, interval: str, include_footprint: bool = False) -> List[dict]:
        return [b.to_dict(include_footprint=include_footprint) for b in self._bars.get((symbol, interval), [])]
