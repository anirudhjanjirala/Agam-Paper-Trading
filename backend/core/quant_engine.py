from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import numpy as np

# Complete registry of 52+ institutional indicators
INDICATOR_CATALOG: List[dict] = [
    {"id": "sma", "name": "Simple Moving Average", "group": "Trend", "overlay": True},
    {"id": "ema", "name": "Exponential Moving Average", "group": "Trend", "overlay": True},
    {"id": "wma", "name": "Weighted Moving Average", "group": "Trend", "overlay": True},
    {"id": "dema", "name": "Double Exponential MA", "group": "Trend", "overlay": True},
    {"id": "tema", "name": "Triple Exponential MA", "group": "Trend", "overlay": True},
    {"id": "hma", "name": "Hull Moving Average", "group": "Trend", "overlay": True},
    {"id": "vwma", "name": "Volume Weighted MA", "group": "Trend", "overlay": True},
    {"id": "vwap", "name": "VWAP", "group": "Trend", "overlay": True},
    {"id": "supertrend", "name": "Supertrend", "group": "Trend", "overlay": True},
    {"id": "psar", "name": "Parabolic SAR", "group": "Trend", "overlay": True},
    {"id": "ichimoku_tenkan", "name": "Ichimoku Tenkan-sen", "group": "Trend", "overlay": True},
    {"id": "ichimoku_kijun", "name": "Ichimoku Kijun-sen", "group": "Trend", "overlay": True},
    {"id": "bb_upper", "name": "Bollinger Band Upper", "group": "Volatility", "overlay": True},
    {"id": "bb_middle", "name": "Bollinger Band Middle", "group": "Volatility", "overlay": True},
    {"id": "bb_lower", "name": "Bollinger Band Lower", "group": "Volatility", "overlay": True},
    {"id": "keltner_upper", "name": "Keltner Channel Upper", "group": "Volatility", "overlay": True},
    {"id": "keltner_lower", "name": "Keltner Channel Lower", "group": "Volatility", "overlay": True},
    {"id": "donchian_upper", "name": "Donchian Channel Upper", "group": "Volatility", "overlay": True},
    {"id": "donchian_lower", "name": "Donchian Channel Lower", "group": "Volatility", "overlay": True},
    {"id": "pivot_point", "name": "Standard Pivot Point", "group": "Trend", "overlay": True},
    {"id": "rsi", "name": "Relative Strength Index", "group": "Momentum", "overlay": False},
    {"id": "stoch_k", "name": "Stochastic %K", "group": "Momentum", "overlay": False},
    {"id": "stoch_d", "name": "Stochastic %D", "group": "Momentum", "overlay": False},
    {"id": "stoch_rsi", "name": "Stochastic RSI", "group": "Momentum", "overlay": False},
    {"id": "macd", "name": "MACD Line", "group": "Momentum", "overlay": False},
    {"id": "macd_signal", "name": "MACD Signal", "group": "Momentum", "overlay": False},
    {"id": "macd_hist", "name": "MACD Histogram", "group": "Momentum", "overlay": False},
    {"id": "cci", "name": "Commodity Channel Index", "group": "Momentum", "overlay": False},
    {"id": "willr", "name": "Williams %R", "group": "Momentum", "overlay": False},
    {"id": "roc", "name": "Rate of Change", "group": "Momentum", "overlay": False},
    {"id": "mom", "name": "Momentum", "group": "Momentum", "overlay": False},
    {"id": "ao", "name": "Awesome Oscillator", "group": "Momentum", "overlay": False},
    {"id": "uo", "name": "Ultimate Oscillator", "group": "Momentum", "overlay": False},
    {"id": "tsi", "name": "True Strength Index", "group": "Momentum", "overlay": False},
    {"id": "fisher", "name": "Fisher Transform", "group": "Momentum", "overlay": False},
    {"id": "cmo", "name": "Chande Momentum Osc", "group": "Momentum", "overlay": False},
    {"id": "mfi", "name": "Money Flow Index", "group": "Volume", "overlay": False},
    {"id": "elder_bull", "name": "Elder Bull Power", "group": "Momentum", "overlay": False},
    {"id": "elder_bear", "name": "Elder Bear Power", "group": "Momentum", "overlay": False},
    {"id": "atr", "name": "Average True Range", "group": "Volatility", "overlay": False},
    {"id": "natr", "name": "Normalized ATR (%)", "group": "Volatility", "overlay": False},
    {"id": "hv", "name": "Historical Volatility (%)", "group": "Volatility", "overlay": False},
    {"id": "obv", "name": "On-Balance Volume", "group": "Volume", "overlay": False},
    {"id": "ad", "name": "Accumulation/Distribution", "group": "Volume", "overlay": False},
    {"id": "cmf", "name": "Chaikin Money Flow", "group": "Volume", "overlay": False},
    {"id": "force_index", "name": "Force Index", "group": "Volume", "overlay": False},
    {"id": "eom", "name": "Ease of Movement", "group": "Volume", "overlay": False},
    {"id": "vol_osc", "name": "Volume Oscillator", "group": "Volume", "overlay": False},
    {"id": "adx", "name": "Average Directional Index", "group": "Trend", "overlay": False},
    {"id": "plus_di", "name": "+DI Directional Indicator", "group": "Trend", "overlay": False},
    {"id": "minus_di", "name": "-DI Directional Indicator", "group": "Trend", "overlay": False},
    {"id": "aroon_up", "name": "Aroon Up", "group": "Trend", "overlay": False},
    {"id": "aroon_down", "name": "Aroon Down", "group": "Trend", "overlay": False},
    {"id": "trix", "name": "TRIX Oscillator", "group": "Momentum", "overlay": False},
    {"id": "choppiness", "name": "Choppiness Index", "group": "Volatility", "overlay": False},
]


def _sma(arr: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(arr), np.nan, dtype=float)
    if period <= 0 or len(arr) < period:
        return out
    cs = np.cumsum(np.where(np.isnan(arr), 0.0, arr))
    out[period - 1 :] = (cs[period - 1 :] - np.concatenate(([0.0], cs[:-period]))) / period
    return out


def _ema(arr: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(arr), np.nan, dtype=float)
    if period <= 0 or len(arr) == 0:
        return out
    valid_idx = np.where(~np.isnan(arr))[0]
    if len(valid_idx) < period:
        return out
    start = valid_idx[0]
    alpha = 2.0 / (period + 1.0)
    out[start + period - 1] = float(np.mean(arr[start : start + period]))
    for i in range(start + period, len(arr)):
        val = arr[i]
        out[i] = alpha * val + (1.0 - alpha) * out[i - 1] if not np.isnan(val) else out[i - 1]
    return out


def _wma(arr: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(arr), np.nan, dtype=float)
    if period <= 0 or len(arr) < period:
        return out
    weights = np.arange(1, period + 1, dtype=float)
    denom = weights.sum()
    for i in range(period - 1, len(arr)):
        window = arr[i - period + 1 : i + 1]
        if not np.isnan(window).any():
            out[i] = float(np.dot(window, weights) / denom)
    return out


def _rolling_std(arr: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(arr), np.nan, dtype=float)
    for i in range(period - 1, len(arr)):
        w = arr[i - period + 1 : i + 1]
        if not np.isnan(w).any():
            out[i] = float(np.std(w))
    return out


def _true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    prev_c = np.concatenate(([close[0]], close[:-1]))
    return np.maximum(high - low, np.maximum(np.abs(high - prev_c), np.abs(low - prev_c)))


def compute_indicator(
    fn: str,
    close: np.ndarray,
    high: Optional[np.ndarray] = None,
    low: Optional[np.ndarray] = None,
    open_: Optional[np.ndarray] = None,
    volume: Optional[np.ndarray] = None,
    period: int = 14,
    mult: float = 2.0,
) -> np.ndarray:
    n = len(close)
    if n == 0:
        return np.array([], dtype=float)
    h = high if high is not None else close
    l = low if low is not None else close
    o = open_ if open_ is not None else close
    v = volume if volume is not None else np.ones(n, dtype=float)

    fn = fn.lower()
    if fn == "sma":
        return _sma(close, period)
    if fn == "ema":
        return _ema(close, period)
    if fn == "wma":
        return _wma(close, period)
    if fn == "dema":
        e1 = _ema(close, period)
        e2 = _ema(e1, period)
        return 2.0 * e1 - e2
    if fn == "tema":
        e1 = _ema(close, period)
        e2 = _ema(e1, period)
        e3 = _ema(e2, period)
        return 3.0 * e1 - 3.0 * e2 + e3
    if fn == "hma":
        half = max(1, period // 2)
        sqrt_p = max(1, int(math.sqrt(period)))
        return _wma(2.0 * _wma(close, half) - _wma(close, period), sqrt_p)
    if fn == "vwma":
        pv = _sma(close * v, period)
        vv = _sma(v, period)
        return np.where(vv > 0, pv / vv, np.nan)
    if fn == "vwap":
        tp = (h + l + close) / 3.0
        cum_v = np.cumsum(v)
        return np.where(cum_v > 0, np.cumsum(tp * v) / cum_v, close)
    if fn == "bb_middle":
        return _sma(close, period)
    if fn == "bb_upper":
        return _sma(close, period) + mult * _rolling_std(close, period)
    if fn == "bb_lower":
        return _sma(close, period) - mult * _rolling_std(close, period)
    if fn == "atr":
        tr = _true_range(h, l, close)
        return _ema(tr, period)
    if fn == "natr":
        atr = compute_indicator("atr", close, h, l, o, v, period)
        return np.where(close > 0, (atr / close) * 100.0, np.nan)
    if fn == "hv":
        lr = np.concatenate(([0.0], np.diff(np.log(np.maximum(close, 1e-9)))))
        return _rolling_std(lr, period) * math.sqrt(252.0) * 100.0
    if fn == "keltner_upper":
        return _ema(close, period) + mult * compute_indicator("atr", close, h, l, o, v, period)
    if fn == "keltner_lower":
        return _ema(close, period) - mult * compute_indicator("atr", close, h, l, o, v, period)
    if fn in ("donchian_upper", "donchian_lower"):
        out = np.full(n, np.nan)
        for i in range(period - 1, n):
            out[i] = float(np.max(h[i - period + 1 : i + 1]) if fn == "donchian_upper" else np.min(l[i - period + 1 : i + 1]))
        return out
    if fn == "pivot_point":
        return (h + l + close) / 3.0
    if fn == "ichimoku_tenkan":
        return 0.5 * (compute_indicator("donchian_upper", close, h, l, o, v, 9) + compute_indicator("donchian_lower", close, h, l, o, v, 9))
    if fn == "ichimoku_kijun":
        return 0.5 * (compute_indicator("donchian_upper", close, h, l, o, v, 26) + compute_indicator("donchian_lower", close, h, l, o, v, 26))
    if fn == "supertrend":
        atr = compute_indicator("atr", close, h, l, o, v, period)
        hl2 = 0.5 * (h + l)
        upper = hl2 + mult * atr
        lower = hl2 - mult * atr
        st = np.copy(close)
        dir_up = True
        for i in range(1, n):
            if np.isnan(atr[i]):
                st[i] = np.nan
                continue
            if close[i] > upper[i - 1]:
                dir_up = True
            elif close[i] < lower[i - 1]:
                dir_up = False
            st[i] = lower[i] if dir_up else upper[i]
        return st
    if fn == "psar":
        psar = np.copy(close)
        bull = True
        af = 0.02
        ep = h[0]
        for i in range(1, n):
            psar[i] = psar[i - 1] + af * (ep - psar[i - 1])
            if bull:
                if l[i] < psar[i]:
                    bull = False
                    psar[i] = ep
                    ep = l[i]
                    af = 0.02
                elif h[i] > ep:
                    ep = h[i]
                    af = min(0.2, af + 0.02)
            else:
                if h[i] > psar[i]:
                    bull = True
                    psar[i] = ep
                    ep = h[i]
                    af = 0.02
                elif l[i] < ep:
                    ep = l[i]
                    af = min(0.2, af + 0.02)
        return psar
    if fn == "rsi":
        delta = np.diff(close, prepend=close[0])
        gain = np.where(delta > 0, delta, 0.0)
        loss = np.where(delta < 0, -delta, 0.0)
        avg_g = _ema(gain, period)
        avg_l = _ema(loss, period)
        rs = np.where(avg_l > 0, avg_g / avg_l, 100.0)
        return 100.0 - (100.0 / (1.0 + rs))
    if fn in ("stoch_k", "stoch_d"):
        k = np.full(n, np.nan)
        for i in range(period - 1, n):
            hh = np.max(h[i - period + 1 : i + 1])
            ll = np.min(l[i - period + 1 : i + 1])
            k[i] = ((close[i] - ll) / (hh - ll) * 100.0) if hh > ll else 50.0
        return k if fn == "stoch_k" else _sma(k, 3)
    if fn == "stoch_rsi":
        r = compute_indicator("rsi", close, h, l, o, v, period)
        return compute_indicator("stoch_k", r, r, r, r, v, period)
    if fn in ("macd", "macd_signal", "macd_hist"):
        line = _ema(close, 12) - _ema(close, 26)
        sig = _ema(line, 9)
        if fn == "macd":
            return line
        if fn == "macd_signal":
            return sig
        return line - sig
    if fn == "cci":
        tp = (h + l + close) / 3.0
        ma = _sma(tp, period)
        out = np.full(n, np.nan)
        for i in range(period - 1, n):
            mad = np.mean(np.abs(tp[i - period + 1 : i + 1] - ma[i]))
            out[i] = (tp[i] - ma[i]) / (0.015 * mad) if mad > 0 else 0.0
        return out
    if fn == "willr":
        out = np.full(n, np.nan)
        for i in range(period - 1, n):
            hh = np.max(h[i - period + 1 : i + 1])
            ll = np.min(l[i - period + 1 : i + 1])
            out[i] = ((hh - close[i]) / (hh - ll)) * -100.0 if hh > ll else -50.0
        return out
    if fn == "roc":
        out = np.full(n, np.nan)
        if n > period:
            out[period:] = ((close[period:] - close[:-period]) / np.maximum(close[:-period], 1e-9)) * 100.0
        return out
    if fn == "mom":
        out = np.full(n, np.nan)
        if n > period:
            out[period:] = close[period:] - close[:-period]
        return out
    if fn == "ao":
        hl2 = 0.5 * (h + l)
        return _sma(hl2, 5) - _sma(hl2, 34)
    if fn == "uo":
        prev_c = np.concatenate(([close[0]], close[:-1]))
        bp = close - np.minimum(l, prev_c)
        tr = _true_range(h, l, close)
        a7 = _sma(bp, 7) / np.maximum(_sma(tr, 7), 1e-9)
        a14 = _sma(bp, 14) / np.maximum(_sma(tr, 14), 1e-9)
        a28 = _sma(bp, 28) / np.maximum(_sma(tr, 28), 1e-9)
        return 100.0 * (4.0 * a7 + 2.0 * a14 + a28) / 7.0
    if fn == "tsi":
        m = np.diff(close, prepend=close[0])
        num = _ema(_ema(m, 25), 13)
        den = _ema(_ema(np.abs(m), 25), 13)
        return np.where(den > 0, (num / den) * 100.0, 0.0)
    if fn == "fisher":
        out = np.full(n, np.nan)
        val = 0.0
        fish = 0.0
        for i in range(period - 1, n):
            hh = np.max(h[i - period + 1 : i + 1])
            ll = np.min(l[i - period + 1 : i + 1])
            mid = 0.5 * (h[i] + l[i])
            raw = 2.0 * ((mid - ll) / max(hh - ll, 1e-9) - 0.5)
            val = np.clip(0.33 * raw + 0.67 * val, -0.999, 0.999)
            fish = 0.5 * math.log((1.0 + val) / (1.0 - val)) + 0.5 * fish
            out[i] = fish
        return out
    if fn == "cmo":
        d = np.diff(close, prepend=close[0])
        up = _sma(np.where(d > 0, d, 0.0), period) * period
        dn = _sma(np.where(d < 0, -d, 0.0), period) * period
        return np.where((up + dn) > 0, ((up - dn) / (up + dn)) * 100.0, 0.0)
    if fn == "mfi":
        tp = (h + l + close) / 3.0
        rmf = tp * v
        d = np.diff(tp, prepend=tp[0])
        pos = _sma(np.where(d > 0, rmf, 0.0), period)
        neg = _sma(np.where(d < 0, rmf, 0.0), period)
        return 100.0 - (100.0 / (1.0 + np.where(neg > 0, pos / neg, 100.0)))
    if fn == "elder_bull":
        return h - _ema(close, period)
    if fn == "elder_bear":
        return l - _ema(close, period)
    if fn == "obv":
        d = np.sign(np.diff(close, prepend=close[0]))
        return np.cumsum(d * v)
    if fn == "ad":
        mfm = np.where((h - l) > 0, ((close - l) - (h - close)) / (h - l), 0.0)
        return np.cumsum(mfm * v)
    if fn == "cmf":
        mfm = np.where((h - l) > 0, ((close - l) - (h - close)) / (h - l), 0.0)
        return _sma(mfm * v, period) / np.maximum(_sma(v, period), 1e-9)
    if fn == "force_index":
        return _ema(np.diff(close, prepend=close[0]) * v, period)
    if fn == "eom":
        dm = np.diff(0.5 * (h + l), prepend=0.5 * (h[0] + l[0]))
        br = np.where((h - l) > 0, (v / 1e6) / (h - l), 1.0)
        return _sma(dm / np.maximum(br, 1e-9), period)
    if fn == "vol_osc":
        s_v = _sma(v, 5)
        l_v = _sma(v, 20)
        return np.where(l_v > 0, ((s_v - l_v) / l_v) * 100.0, 0.0)
    if fn in ("plus_di", "minus_di", "adx"):
        up_m = np.diff(h, prepend=h[0])
        dn_m = -np.diff(l, prepend=l[0])
        pdm = np.where((up_m > dn_m) & (up_m > 0), up_m, 0.0)
        mdm = np.where((dn_m > up_m) & (dn_m > 0), dn_m, 0.0)
        atr = np.maximum(compute_indicator("atr", close, h, l, o, v, period), 1e-9)
        pdi = 100.0 * _ema(pdm, period) / atr
        mdi = 100.0 * _ema(mdm, period) / atr
        if fn == "plus_di":
            return pdi
        if fn == "minus_di":
            return mdi
        dx = np.where((pdi + mdi) > 0, (np.abs(pdi - mdi) / (pdi + mdi)) * 100.0, 0.0)
        return _ema(dx, period)
    if fn in ("aroon_up", "aroon_down"):
        out = np.full(n, np.nan)
        for i in range(period, n):
            win = h[i - period : i + 1] if fn == "aroon_up" else l[i - period : i + 1]
            idx_ext = int(np.argmax(win) if fn == "aroon_up" else np.argmin(win))
            out[i] = (idx_ext / period) * 100.0
        return out
    if fn == "trix":
        e3 = _ema(_ema(_ema(close, period), period), period)
        return compute_indicator("roc", e3, period=1)
    if fn == "choppiness":
        tr_sum = _sma(_true_range(h, l, close), period) * period
        out = np.full(n, np.nan)
        for i in range(period - 1, n):
            hh = np.max(h[i - period + 1 : i + 1])
            ll = np.min(l[i - period + 1 : i + 1])
            if hh > ll and tr_sum[i] > 0:
                out[i] = 100.0 * math.log10(tr_sum[i] / (hh - ll)) / math.log10(period)
        return out

    return _sma(close, period)


def compute_chained_indicator(bars: List[dict], chain: List[dict]) -> List[dict]:
    """
    Executes Indicators-on-Indicators (e.g. [{"fn": "rsi", "period": 14}, {"fn": "ema", "period": 9}]).
    """
    if not bars or not chain:
        return []
    close = np.array([b["close"] for b in bars], dtype=float)
    high = np.array([b["high"] for b in bars], dtype=float)
    low = np.array([b["low"] for b in bars], dtype=float)
    open_ = np.array([b["open"] for b in bars], dtype=float)
    volume = np.array([b.get("volume", 1) for b in bars], dtype=float)

    current = close
    for idx, step in enumerate(chain):
        fn = step.get("fn", "sma")
        period = int(step.get("period", 14))
        mult = float(step.get("mult", 2.0))
        if idx == 0:
            current = compute_indicator(fn, close, high, low, open_, volume, period, mult)
        else:
            # Subsequent stages feed the previous indicator's output series into the next calculation
            current = compute_indicator(fn, current, current, current, current, volume, period, mult)

    output = []
    for bar, val in zip(bars, current):
        if not np.isnan(val):
            output.append({"time": bar["time"], "value": round(float(val), 4)})
    return output


def detect_patterns(bars: List[dict]) -> List[dict]:
    """Detects candlestick & chart swing patterns on OHLCV bars."""
    patterns: List[dict] = []
    if len(bars) < 5:
        return patterns

    for i in range(2, len(bars)):
        b0, b1, b2 = bars[i - 2], bars[i - 1], bars[i]
        body2 = abs(b2["close"] - b2["open"])
        range2 = max(b2["high"] - b2["low"], 1e-9)
        upper_wick = b2["high"] - max(b2["open"], b2["close"])
        lower_wick = min(b2["open"], b2["close"]) - b2["low"]

        if body2 <= range2 * 0.12:
            patterns.append({"time": b2["time"], "pattern": "Doji", "bias": "NEUTRAL", "price": b2["close"]})
        elif lower_wick >= body2 * 2.0 and upper_wick <= body2 * 0.5 and b2["close"] >= b2["open"]:
            patterns.append({"time": b2["time"], "pattern": "Hammer", "bias": "BULLISH", "price": b2["low"]})
        elif b1["close"] < b1["open"] and b2["close"] > b2["open"] and b2["open"] <= b1["close"] and b2["close"] >= b1["open"]:
            patterns.append({"time": b2["time"], "pattern": "Bullish Engulfing", "bias": "BULLISH", "price": b2["low"]})
        elif b1["close"] > b1["open"] and b2["close"] < b2["open"] and b2["open"] >= b1["close"] and b2["close"] <= b1["open"]:
            patterns.append({"time": b2["time"], "pattern": "Bearish Engulfing", "bias": "BEARISH", "price": b2["high"]})
        elif b0["close"] < b0["open"] and abs(b1["close"] - b1["open"]) < (b0["open"] - b0["close"]) * 0.4 and b2["close"] > b2["open"] and b2["close"] > (b0["open"] + b0["close"]) * 0.5:
            patterns.append({"time": b2["time"], "pattern": "Morning Star", "bias": "BULLISH", "price": b2["low"]})

    return patterns[-15:]


def compute_expected_move(bars: List[dict], horizon_bars: int = 10) -> dict:
    """Computes ±1σ and ±2σ statistical expected move cone using recent realized volatility."""
    if len(bars) < 10:
        return {}
    close = np.array([b["close"] for b in bars], dtype=float)
    log_rets = np.diff(np.log(np.maximum(close, 1e-9)))
    sigma_per_bar = float(np.std(log_rets[-30:])) if len(log_rets) >= 2 else 0.01
    last_px = float(close[-1])
    move_1sd = last_px * sigma_per_bar * math.sqrt(horizon_bars)
    move_2sd = 2.0 * move_1sd
    return {
        "anchor_price": round(last_px, 4),
        "horizon_bars": horizon_bars,
        "sigma_per_bar_pct": round(sigma_per_bar * 100.0, 3),
        "upper_1sd": round(last_px + move_1sd, 4),
        "lower_1sd": round(last_px - move_1sd, 4),
        "upper_2sd": round(last_px + move_2sd, 4),
        "lower_2sd": round(last_px - move_2sd, 4),
    }


def compute_volume_profile(bars: List[dict], num_bins: int = 24) -> dict:
    """
    Order Flow Volume Profile:
    Computes POC (Point of Control), VAH (Value Area High - 70% Vol), VAL (Value Area Low).
    """
    if not bars:
        return {"poc": 0.0, "vah": 0.0, "val": 0.0, "buckets": []}

    lo = min(b["low"] for b in bars)
    hi = max(b["high"] for b in bars)
    if hi <= lo:
        hi = lo + 1.0
    step = (hi - lo) / num_bins

    buckets = [
        {"price_low": round(lo + i * step, 4), "price_high": round(lo + (i + 1) * step, 4), "price_mid": round(lo + (i + 0.5) * step, 4), "buy_vol": 0, "sell_vol": 0, "total_vol": 0}
        for i in range(num_bins)
    ]

    for b in bars:
        vol = max(int(b.get("volume", 0)), 1)
        mid = (b["high"] + b["low"] + b["close"]) / 3.0
        idx = min(num_bins - 1, max(0, int((mid - lo) / step)))
        is_up = b["close"] >= b["open"]
        buy_v = int(b.get("buy_volume", vol * (0.65 if is_up else 0.35)))
        sell_v = max(0, vol - buy_v)
        buckets[idx]["buy_vol"] += buy_v
        buckets[idx]["sell_vol"] += sell_v
        buckets[idx]["total_vol"] += buy_v + sell_v

    poc_idx = max(range(num_bins), key=lambda i: buckets[i]["total_vol"])
    total_vol = sum(x["total_vol"] for x in buckets)
    target_va = total_vol * 0.70

    # Expand outward from POC until 70% Value Area volume is captured
    va_vol = buckets[poc_idx]["total_vol"]
    low_idx, high_idx = poc_idx, poc_idx
    while va_vol < target_va and (low_idx > 0 or high_idx < num_bins - 1):
        left_v = buckets[low_idx - 1]["total_vol"] if low_idx > 0 else -1
        right_v = buckets[high_idx + 1]["total_vol"] if high_idx < num_bins - 1 else -1
        if right_v >= left_v and high_idx < num_bins - 1:
            high_idx += 1
            va_vol += buckets[high_idx]["total_vol"]
        elif low_idx > 0:
            low_idx -= 1
            va_vol += buckets[low_idx]["total_vol"]
        else:
            break

    return {
        "poc": buckets[poc_idx]["price_mid"],
        "vah": buckets[high_idx]["price_high"],
        "val": buckets[low_idx]["price_low"],
        "total_volume": total_vol,
        "buckets": buckets,
    }


def compute_tpo_profile(bars: List[dict], num_bins: int = 20) -> dict:
    """
    Time Price Opportunity (TPO / Market Profile):
    Assigns period letters (A, B, C...) across price rows, computes Initial Balance (IB = A & B) & TPO POC.
    """
    if not bars:
        return {"tpo_poc": 0.0, "ib_high": 0.0, "ib_low": 0.0, "rows": []}

    recent = bars[-26:]  # Up to 26 TPO letters (A-Z)
    lo = min(b["low"] for b in recent)
    hi = max(b["high"] for b in recent)
    if hi <= lo:
        hi = lo + 1.0
    step = (hi - lo) / num_bins

    rows = [{"price": round(lo + (i + 0.5) * step, 4), "letters": "", "tpo_count": 0} for i in range(num_bins)]
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    for b_idx, b in enumerate(recent):
        ch = letters[b_idx % len(letters)]
        start_bin = min(num_bins - 1, max(0, int((b["low"] - lo) / step)))
        end_bin = min(num_bins - 1, max(0, int((b["high"] - lo) / step)))
        for r_idx in range(start_bin, end_bin + 1):
            rows[r_idx]["letters"] += ch
            rows[r_idx]["tpo_count"] += 1

    poc_row = max(rows, key=lambda r: r["tpo_count"])
    ib_bars = recent[:2]
    ib_high = max(b["high"] for b in ib_bars)
    ib_low = min(b["low"] for b in ib_bars)

    return {
        "tpo_poc": poc_row["price"],
        "ib_high": round(ib_high, 4),
        "ib_low": round(ib_low, 4),
        "rows": list(reversed(rows)),
    }


def compute_volume_footprint(bars: List[dict], levels_per_bar: int = 6) -> List[dict]:
    """
    Bid x Ask Volume Footprint Matrix (last 12 bars):
    Calculates Bid_Vol x Ask_Vol at price steps, Delta, Cumulative Delta, and 300% Imbalances.
    """
    recent = bars[-12:]
    cum_delta = 0
    footprint_bars: List[dict] = []

    for b in recent:
        vol = max(int(b.get("volume", 0)), 100)
        lo, hi = b["low"], b["high"]
        if hi <= lo:
            hi = lo + 0.05
        step = (hi - lo) / levels_per_bar
        is_bull = b["close"] >= b["open"]

        levels = []
        bar_delta = 0
        for lvl_i in range(levels_per_bar):
            px = round(lo + (lvl_i + 0.5) * step, 4)
            # Distribute volume weighted toward close; Lee-Ready directional tilt
            weight = 1.0 + (0.5 if (is_bull and lvl_i >= levels_per_bar // 2) or (not is_bull and lvl_i < levels_per_bar // 2) else 0.0)
            lvl_tot = int((vol / levels_per_bar) * weight)
            ask_ratio = 0.68 if (px >= b["open"] and is_bull) or px >= b["close"] else 0.34
            ask_v = int(lvl_tot * ask_ratio)
            bid_v = max(1, lvl_tot - ask_v)
            delta = ask_v - bid_v
            bar_delta += delta
            imb = "ASK_IMB" if ask_v >= bid_v * 2.5 else ("BID_IMB" if bid_v >= ask_v * 2.5 else "NONE")
            levels.append({
                "price": px,
                "bid_vol": bid_v,
                "ask_vol": ask_v,
                "delta": delta,
                "imbalance": imb,
            })

        cum_delta += bar_delta
        footprint_bars.append({
            "time": b["time"],
            "open": b["open"],
            "high": b["high"],
            "low": b["low"],
            "close": b["close"],
            "bar_delta": bar_delta,
            "cumulative_delta": cum_delta,
            "levels": list(reversed(levels)),
        })

    return footprint_bars
