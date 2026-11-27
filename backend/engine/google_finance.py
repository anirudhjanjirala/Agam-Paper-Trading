from __future__ import annotations

import asyncio
import json
import math
import random
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
]

INDEX_MAP: Dict[str, str] = {
    "^NSEI": "NIFTY_50:INDEXNSE",
    "^BSESN": "SENSEX:INDEXBOM",
    "^NSEBANK": "NIFTY_BANK:INDEXNSE",
    "^GSPC": ".INX:INDEXSP",
    "^IXIC": ".IXIC:INDEXNASDAQ",
    "^DJI": ".DJI:INDEXDJX",
    "^VIX": "VIX:INDEXCBOE",
    "^GSPTSE": "OSPTX:INDEXTSI",
    "^GDAXI": "DAX:INDEXDB",
    "^FTSE": "UKX:INDEXFTSE",
    "^FCHI": "PX1:INDEXEURO",
    "000001.SS": "000001:SHA",
    "399001.SZ": "399001:SHE",
}

BSE_SCRIP_MAP: Dict[str, str] = {
    "RELIANCE.BO": "500325:BOM",
    "TCS.BO": "532540:BOM",
    "HDFCBANK.BO": "500180:BOM",
    "INFY.BO": "500209:BOM",
    "ICICIBANK.BO": "532174:BOM",
    "SBIN.BO": "500112:BOM",
}

SUFFIX_TO_GF_EXCHANGE: Dict[str, str] = {
    ".NS": "NSE",
    ".BO": "BOM",
    ".TO": "TSE",
    ".V": "CVE",
    ".SS": "SHA",
    ".SZ": "SHE",
    ".DE": "ETR",
    ".PA": "EPA",
    ".AS": "AMS",
    ".BR": "EBR",
    ".MI": "BIT",
    ".L": "LON",
}


def to_google_finance_ticker(symbol: str, exchange_hint: Optional[str] = None) -> List[str]:
    """Converts internal symbol notation into ordered candidate Google Finance tickers."""
    sym = symbol.strip().upper()
    if sym in INDEX_MAP:
        return [INDEX_MAP[sym]]
    if sym in BSE_SCRIP_MAP:
        return [BSE_SCRIP_MAP[sym]]
    if sym.endswith("=X") and len(sym) >= 8:
        base = sym[:-2]
        return [f"{base[:3]}-{base[3:6]}"]
    if sym.endswith("=F") or sym.startswith("^"):
        return []  # Futures / Yields route cleanly to public exchange chart fallback

    for suffix, gf_exch in SUFFIX_TO_GF_EXCHANGE.items():
        if sym.endswith(suffix.upper()):
            core = sym[: -len(suffix)]
            if suffix.upper() == ".BO":
                return [f"{core}:BOM", f"{core}:NSE"]
            return [f"{core}:{gf_exch}"]

    # US equities / ETFs
    hint = (exchange_hint or "").upper()
    if hint in ("NYSE", "NYSE ARCA"):
        return [f"{sym}:NYSE" if hint == "NYSE" else f"{sym}:NYSEARCA", f"{sym}:NASDAQ", f"{sym}:NYSEAMERICAN"]
    if hint == "AMEX":
        return [f"{sym}:NYSEAMERICAN", f"{sym}:NYSE", f"{sym}:NASDAQ"]
    return [f"{sym}:NASDAQ", f"{sym}:NYSE", f"{sym}:NYSEARCA"]


class GoogleFinanceEngine:
    """
    Zero-cost Google Finance scraping & parsing engine using httpx + embedded AF_initDataCallback
    JSON extraction, rotating browser headers, public exchange fallbacks (zero yfinance),
    and dual-tier TTL caches (4s quotes, 1h historical charts).
    """

    def __init__(self, quote_ttl: int = 4, history_ttl: int = 3600) -> None:
        self.quote_ttl = quote_ttl
        self.history_ttl = history_ttl
        self._bundle_cache: Dict[str, tuple[float, dict]] = {}
        self._history_cache: Dict[str, tuple[float, List[dict]]] = {}
        self._yahoo_lock = threading.Lock()
        self._yahoo_cooldown_until: float = 0.0
        self._yahoo_client: Optional[httpx.Client] = None
        self._yahoo_cookie_ready: bool = False
        self._http_lock = threading.Lock()
        self._http_client: Optional[httpx.Client] = None

    def _get_http_client(self) -> httpx.Client:
        with self._http_lock:
            if self._http_client is None or self._http_client.is_closed:
                self._http_client = httpx.Client(
                    timeout=8.0,
                    follow_redirects=True,
                    limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
                )
            return self._http_client

    def _headers(self) -> dict:
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": "SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LyaBg",
        }

    def _extract_callbacks(self, html: str) -> Dict[str, Any]:
        matches = re.findall(
            r"AF_initDataCallback\(\{key:\s*'(ds:\d+)'[^}]*?data:(\[[\s\S]*?\])\s*,\s*sideChannel:",
            html,
        )
        parsed: Dict[str, Any] = {}
        for k, raw in matches:
            try:
                parsed[k] = json.loads(raw)
            except Exception:
                continue
        return parsed

    def _parse_bundle(self, symbol: str, gf_ticker: str, cbs: Dict[str, Any]) -> Optional[dict]:
        quote_data: Optional[dict] = None
        profile_data: dict = {}
        candles_1m: List[dict] = []
        candles_5m: List[dict] = []
        candles_1d: List[dict] = []
        financials_raw: List[dict] = []
        financials_annual: List[dict] = []
        eps_raw: List[dict] = []

        for _, obj in cbs.items():
            if not isinstance(obj, list) or not obj:
                continue

            # 1) Primary Quote & Key Metrics block (arr[6] == price, arr[13] == ticker:exch or FX)
            try:
                if isinstance(obj[0], list) and obj[0] and isinstance(obj[0][0], list):
                    arr = obj[0][0]
                    if len(arr) >= 16 and isinstance(arr[6], (int, float)) and isinstance(arr[14], str) and isinstance(arr[15], (int, float)):
                        px = float(arr[6])
                        pc = float(arr[15]) if arr[15] else px
                        chg = float(arr[8]) if isinstance(arr[8], (int, float)) else (px - pc)
                        pct = float(arr[10]) if isinstance(arr[10], (int, float)) else 0.0
                        spread = round(max(0.01, px * 0.0002), 4 if px < 10 else 2)
                        curr = arr[12] if isinstance(arr[12], str) else ("PERCENT" if symbol.startswith("^TNX") else "USD")
                        quote_data = {
                            "symbol": symbol,
                            "gf_ticker": gf_ticker,
                            "name": arr[14],
                            "exchange": gf_ticker.split(":")[1] if ":" in gf_ticker else "FX",
                            "currency": "GBp" if curr == "GBX" else curr,
                            "price": round(px, 4 if px < 10 else 2),
                            "prev_close": round(pc, 4 if pc < 10 else 2),
                            "open": round(float(arr[2]), 4 if px < 10 else 2) if isinstance(arr[2], (int, float)) else px,
                            "day_low": round(float(arr[4]), 4 if px < 10 else 2) if isinstance(arr[4], (int, float)) and arr[4] > 0 else px,
                            "day_high": round(float(arr[5]), 4 if px < 10 else 2) if isinstance(arr[5], (int, float)) and arr[5] > 0 else px,
                            "change": round(chg, 4 if px < 10 else 2),
                            "change_percent": round(pct, 2),
                            "market_cap": float(arr[16]) if len(arr) > 16 and isinstance(arr[16], (int, float)) and arr[16] > 0 else None,
                            "volume": int(arr[17]) if len(arr) > 17 and isinstance(arr[17], (int, float)) else 0,
                            "sector": arr[18] if len(arr) > 18 and isinstance(arr[18], str) else None,
                            "bid": round(px - spread, 4 if px < 10 else 2),
                            "ask": round(px + spread, 4 if px < 10 else 2),
                            "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                            "timestamp": int(time.time()),
                            "source": "Google Finance",
                        }
            except Exception:
                pass

            # 2) Company Profile Block (bio, HQ, CEO, employees, 52W range, PE, div yield, shares)
            try:
                if isinstance(obj[0], list) and obj[0] and isinstance(obj[0][0], list):
                    p = obj[0][0]
                    if len(p) > 25 and isinstance(p[2], str) and isinstance(p[3], list) and isinstance(p[12], (int, float)):
                        hq = ", ".join(str(x) for x in p[3][:3] if x)
                        founded = f"{p[4][0]}-{p[4][1]:02d}-{p[4][2]:02d}" if isinstance(p[4], list) and len(p[4]) >= 3 else None
                        profile_data = {
                            "summary": p[2],
                            "headquarters": hq or None,
                            "ipo_date": founded,
                            "ceo": p[5] if isinstance(p[5], str) else None,
                            "employees": int(p[6]) if isinstance(p[6], (int, float)) else None,
                            "market_cap": float(p[7]) if isinstance(p[7], (int, float)) else None,
                            "week_52_high": float(p[12]) if isinstance(p[12], (int, float)) else None,
                            "week_52_low": float(p[13]) if isinstance(p[13], (int, float)) else None,
                            "trailing_pe": float(p[16]) if isinstance(p[16], (int, float)) else None,
                            "dividend_yield": float(p[17]) if isinstance(p[17], (int, float)) else None,
                            "shares_outstanding": float(p[21]) if isinstance(p[21], (int, float)) else None,
                            "website": p[30] if len(p) > 30 and isinstance(p[30], str) else None,
                            "sector": p[70] if len(p) > 70 and isinstance(p[70], str) else None,
                            "industry": p[77] if len(p) > 77 and isinstance(p[77], str) else None,
                        }
            except Exception:
                pass

            # 3) OHLCV & Point Series (Equities, Indices, and FX across ds:9..ds:14)
            try:
                if isinstance(obj[0], list) and obj[0] and isinstance(obj[0][0], list) and len(obj[0][0]) >= 4:
                    inner = obj[0][0][3]
                    if isinstance(inner, list) and inner and isinstance(inner[0], list):
                        series_group = inner[0]
                        if len(series_group) >= 3 and isinstance(series_group[2], list):
                            raw_bars = series_group[2]
                            if raw_bars and isinstance(raw_bars[0], list) and len(raw_bars[0]) >= 5 and isinstance(raw_bars[0][4], str):
                                parsed_bars = []
                                is_daily_ohlc = len(raw_bars) <= 35
                                for b in raw_bars:
                                    iso_s = b[4]
                                    ts = int(datetime.fromisoformat(iso_s).timestamp())
                                    parsed_bars.append({
                                        "time": iso_s[:10] if is_daily_ohlc else ts,
                                        "open": round(float(b[0]), 4 if float(b[0]) < 10 else 2),
                                        "close": round(float(b[1]), 4 if float(b[1]) < 10 else 2),
                                        "high": round(float(b[2]), 4 if float(b[2]) < 10 else 2),
                                        "low": round(float(b[3]), 4 if float(b[3]) < 10 else 2),
                                        "volume": int(b[5]) if len(b) > 5 and isinstance(b[5], (int, float)) else 0,
                                    })
                                if parsed_bars:
                                    if len(parsed_bars) >= 40:
                                        candles_5m = parsed_bars
                                    elif len(parsed_bars) >= len(candles_1d):
                                        candles_1d = parsed_bars

                        # Point series: [[year, mon, day, hr, min, ..., [offset_sec]], [val, ...], vol]
                        if len(series_group) >= 2 and isinstance(series_group[1], list):
                            raw_pts = series_group[1]
                            if raw_pts and isinstance(raw_pts[0], list) and len(raw_pts[0]) >= 2 and isinstance(raw_pts[0][0], list):
                                pts_parsed = []
                                prev_val: Optional[float] = None
                                distinct_days = set()
                                last_ts = 0
                                for idx_pt, pt in enumerate(raw_pts):
                                    dt_arr, px_arr = pt[0], pt[1]
                                    if not (isinstance(dt_arr, list) and len(dt_arr) >= 3 and isinstance(px_arr, list) and isinstance(px_arr[0], (int, float))):
                                        continue
                                    offset_sec = 0
                                    if len(dt_arr) > 7 and isinstance(dt_arr[7], list) and dt_arr[7] and isinstance(dt_arr[7][0], (int, float)):
                                        offset_sec = int(dt_arr[7][0])
                                    tz = timezone(timedelta(seconds=offset_sec))
                                    hr = int(dt_arr[3]) if dt_arr[3] is not None else 0
                                    mn = int(dt_arr[4]) if dt_arr[4] is not None else (idx_pt % 60 if len(raw_pts) > 40 else 0)
                                    dt_obj = datetime(int(dt_arr[0]), int(dt_arr[1]), int(dt_arr[2]), hr, mn, tzinfo=tz)
                                    ts_val = int(dt_obj.timestamp())
                                    if ts_val <= last_ts and len(raw_pts) > 40:
                                        ts_val = last_ts + 60
                                    last_ts = ts_val
                                    val = float(px_arr[0])
                                    dec = 4 if val < 10 else 2
                                    v_r = round(val, dec)
                                    o_r = round(prev_val, dec) if prev_val is not None else v_r
                                    h_r = max(o_r, v_r)
                                    l_r = min(o_r, v_r)
                                    prev_val = val
                                    vol_v = int(pt[2]) if len(pt) > 2 and isinstance(pt[2], (int, float)) else 0
                                    day_s = f"{int(dt_arr[0]):04d}-{int(dt_arr[1]):02d}-{int(dt_arr[2]):02d}"
                                    distinct_days.add(day_s)
                                    pts_parsed.append({
                                        "day": day_s,
                                        "time": ts_val,
                                        "open": o_r,
                                        "high": h_r,
                                        "low": l_r,
                                        "close": v_r,
                                        "volume": vol_v,
                                    })

                                if pts_parsed:
                                    if len(raw_pts) <= 45 and len(distinct_days) >= 3 and not candles_1d:
                                        daily_pts = []
                                        seen_d = set()
                                        for p_row in pts_parsed:
                                            if p_row["day"] in seen_d:
                                                continue
                                            seen_d.add(p_row["day"])
                                            daily_pts.append({
                                                "time": p_row["day"],
                                                "open": p_row["open"],
                                                "high": p_row["high"],
                                                "low": p_row["low"],
                                                "close": p_row["close"],
                                                "volume": p_row["volume"],
                                            })
                                        candles_1d = daily_pts
                                    elif len(pts_parsed) > len(candles_1m):
                                        candles_1m = [
                                            {k: v for k, v in p_row.items() if k != "day"}
                                            for p_row in pts_parsed
                                        ]
            except Exception:
                pass

            # 4) Financial Statements Block (Quarterly + Annual Revenue, Net Income, EPS, Margin, Cash, FCF)
            try:
                if isinstance(obj[0], list) and obj[0] and isinstance(obj[0][0], list):
                    for blk in obj[0][0]:
                        if not (
                            isinstance(blk, list)
                            and blk
                            and isinstance(blk[0], list)
                            and len(blk[0]) >= 2
                            and isinstance(blk[0][0], int)
                            and blk[0][0] >= 1995
                        ):
                            continue
                        for row in blk[:16]:
                            is_qtr = len(row) >= 3 and isinstance(row[1], int) and isinstance(row[2], list)
                            is_ann = len(row) >= 2 and isinstance(row[1], list)
                            if not (is_qtr or is_ann):
                                continue
                            yr = row[0]
                            qtr = row[1] if is_qtr else 0
                            vals = row[2] if is_qtr else row[1]
                            if not isinstance(vals, list) or len(vals) < 18:
                                continue
                            rev = vals[0]
                            if not isinstance(rev, (int, float)):
                                continue
                            ni = vals[1]
                            eps = vals[2]
                            margin = vals[3]
                            op_inc = vals[4] if len(vals) > 4 else None
                            cash = vals[7] if len(vals) > 7 else None
                            fcf = vals[31] if len(vals) > 31 else None
                            debt = vals[24] if len(vals) > 24 else None
                            dt_l = vals[17] if len(vals) > 17 and isinstance(vals[17], list) else [yr, (qtr or 4) * 3, 28]
                            gm_pct = vals[18] if len(vals) > 18 and isinstance(vals[18], (int, float)) else None
                            period_lbl = f"{dt_l[0]}-{dt_l[1]:02d}" if is_qtr else str(yr)
                            parsed_row = {
                                "period": period_lbl,
                                "year": yr,
                                "quarter": qtr,
                                "revenue": float(rev),
                                "net_income": float(ni) if isinstance(ni, (int, float)) else 0.0,
                                "operating_income": float(op_inc) if isinstance(op_inc, (int, float)) else 0.0,
                                "gross_margin_pct": float(gm_pct) if gm_pct is not None else None,
                                "net_margin_pct": round(float(margin), 2) if isinstance(margin, (int, float)) else 0.0,
                                "eps": float(eps) if isinstance(eps, (int, float)) else None,
                                "cash": float(cash) if isinstance(cash, (int, float)) else 0.0,
                                "free_cash_flow": float(fcf) if isinstance(fcf, (int, float)) else 0.0,
                                "total_debt": float(debt) if isinstance(debt, (int, float)) else 0.0,
                            }
                            if is_qtr:
                                financials_raw.append(parsed_row)
                            else:
                                financials_annual.append(parsed_row)
            except Exception:
                pass

            # 5) EPS Estimates & Reported Actuals Block
            try:
                if isinstance(obj[0], list) and obj[0] and isinstance(obj[0][0], list):
                    row0 = obj[0][0]
                    if len(row0) >= 10 and isinstance(row0[3], int) and isinstance(row0[9], list):
                        for item in obj[0][:10]:
                            if not isinstance(item, list) or len(item) < 10 or not isinstance(item[9], list):
                                continue
                            m = item[9]
                            dt_arr = m[17] if len(m) > 17 and isinstance(m[17], list) else None
                            act = m[9] if len(m) > 9 and isinstance(m[9], (int, float)) else (m[2] if len(m) > 2 and isinstance(m[2], (int, float)) else None)
                            est = m[10] if len(m) > 10 and isinstance(m[10], (int, float)) else None
                            if not dt_arr and len(m) > 0 and isinstance(m[0], dict):
                                dt_arr = m[0].get("18")
                                est = m[0].get("11")
                                act = None
                            if dt_arr and len(dt_arr) >= 3:
                                dt_s = f"{dt_arr[0]}-{dt_arr[1]:02d}-{dt_arr[2]:02d}"
                                surp = round(((act - est) / abs(est)) * 100.0, 2) if (act is not None and est is not None and est != 0) else None
                                eps_raw.append({
                                    "date": dt_s,
                                    "estimate": round(float(est), 3) if est is not None else None,
                                    "actual": round(float(act), 3) if act is not None else None,
                                    "surprise_pct": surp,
                                    "is_upcoming": act is None,
                                })
            except Exception:
                pass

        if not quote_data:
            return None

        return {
            "quote": {**quote_data, **{k: v for k, v in profile_data.items() if k in ("market_cap", "week_52_high", "week_52_low", "trailing_pe", "dividend_yield") and v is not None}},
            "profile": profile_data,
            "candles_1m": candles_1m,
            "candles_5m": candles_5m,
            "candles_1d": candles_1d,
            "financials": financials_raw,
            "financials_annual": financials_annual,
            "eps": sorted(eps_raw, key=lambda x: x["date"]),
        }

    def fetch_bundle_sync(self, symbol: str, exchange_hint: Optional[str] = None) -> Optional[dict]:
        now = time.time()
        cached = self._bundle_cache.get(symbol)
        if cached and (now - cached[0]) < self.quote_ttl:
            return cached[1]

        client = self._get_http_client()
        candidates = to_google_finance_ticker(symbol, exchange_hint=exchange_hint)
        for gf_ticker in candidates:
            try:
                r = client.get(
                    f"https://www.google.com/finance/quote/{gf_ticker}",
                    headers=self._headers(),
                )
                if r.status_code != 200:
                    continue
                cbs = self._extract_callbacks(r.text)
                bundle = self._parse_bundle(symbol, gf_ticker, cbs)
                if bundle:
                    self._bundle_cache[symbol] = (now, bundle)
                    return bundle
            except Exception:
                continue
        return None

    async def fetch_bundle_async(self, symbol: str, exchange_hint: Optional[str] = None) -> Optional[dict]:
        now = time.time()
        cached = self._bundle_cache.get(symbol)
        if cached and (now - cached[0]) < self.quote_ttl:
            return cached[1]

        candidates = to_google_finance_ticker(symbol, exchange_hint=exchange_hint)
        async with httpx.AsyncClient(headers=self._headers(), timeout=8.0, follow_redirects=True) as client:
            for gf_ticker in candidates:
                try:
                    r = await client.get(f"https://www.google.com/finance/quote/{gf_ticker}")
                    if r.status_code != 200:
                        continue
                    cbs = self._extract_callbacks(r.text)
                    bundle = self._parse_bundle(symbol, gf_ticker, cbs)
                    if bundle:
                        self._bundle_cache[symbol] = (now, bundle)
                        return bundle
                except Exception:
                    continue
        return None

    # -------------------------------------------------------------
    # RESAMPLING & MULTI-SOURCE PUBLIC EXCHANGE CHART PIPELINE
    # -------------------------------------------------------------
    def _resample_intraday(self, bars: List[dict], step_sec: int) -> List[dict]:
        if not bars or step_sec <= 60:
            return bars
        buckets: Dict[int, dict] = {}
        for b in bars:
            t = b["time"]
            if not isinstance(t, (int, float)):
                continue
            b_ts = (int(t) // step_sec) * step_sec
            cur = buckets.get(b_ts)
            if not cur:
                buckets[b_ts] = {
                    "time": b_ts,
                    "open": b["open"],
                    "high": b["high"],
                    "low": b["low"],
                    "close": b["close"],
                    "volume": b.get("volume", 0),
                }
            else:
                cur["high"] = max(cur["high"], b["high"])
                cur["low"] = min(cur["low"], b["low"])
                cur["close"] = b["close"]
                cur["volume"] += b.get("volume", 0)
        return [buckets[k] for k in sorted(buckets.keys())]

    def _resample_daily(self, bars: List[dict], interval: str) -> List[dict]:
        if not bars or interval not in ("1wk", "1mo"):
            return bars
        buckets: Dict[str, dict] = {}
        for b in bars:
            t_str = str(b["time"])[:10]
            try:
                dt = datetime.strptime(t_str, "%Y-%m-%d")
            except ValueError:
                continue
            if interval == "1wk":
                wk_start = dt - timedelta(days=dt.weekday())
                key = wk_start.strftime("%Y-%m-%d")
            else:
                key = f"{dt.year:04d}-{dt.month:02d}-01"
            cur = buckets.get(key)
            if not cur:
                buckets[key] = {
                    "time": key,
                    "open": b["open"],
                    "high": b["high"],
                    "low": b["low"],
                    "close": b["close"],
                    "volume": b.get("volume", 0),
                }
            else:
                cur["high"] = max(cur["high"], b["high"])
                cur["low"] = min(cur["low"], b["low"])
                cur["close"] = b["close"]
                cur["volume"] += b.get("volume", 0)
        return [buckets[k] for k in sorted(buckets.keys())]

    def _fetch_nasdaq_history_sync(self, symbol: str, interval: str, period: str) -> List[dict]:
        if "." in symbol or "=" in symbol or symbol.startswith("^"):
            return []
        days_map = {"1mo": 35, "3mo": 95, "6mo": 185, "1y": 370, "2y": 735, "5y": 1830, "max": 20000}
        now_dt = datetime.now(timezone.utc).date()
        if period.lower() == "ytd":
            from_dt = datetime(now_dt.year, 1, 1, tzinfo=timezone.utc).date()
        else:
            from_dt = now_dt - timedelta(days=days_map.get(period.lower(), 120))
        from_s = from_dt.strftime("%Y-%m-%d")
        to_s = now_dt.strftime("%Y-%m-%d")

        def _num(raw: Any) -> float:
            s = str(raw or "").replace("$", "").replace(",", "").strip()
            try:
                return float(s)
            except ValueError:
                return 0.0

        client = self._get_http_client()
        for asset_cls in ("stocks", "etf"):
            try:
                url = (
                    f"https://api.nasdaq.com/api/quote/{symbol}/historical"
                    f"?assetclass={asset_cls}&fromdate={from_s}&limit=99999&todate={to_s}"
                )
                r = client.get(url, headers={"User-Agent": random.choice(USER_AGENTS)})
                if r.status_code != 200:
                    continue
                rows = ((r.json().get("data") or {}).get("tradesTable") or {}).get("rows") or []
                if not rows:
                    continue
                bars = []
                for row in rows:
                    d_raw = (row.get("date") or "").strip()
                    try:
                        dt_iso = datetime.strptime(d_raw, "%m/%d/%Y").strftime("%Y-%m-%d")
                    except ValueError:
                        continue
                    c_v = _num(row.get("close"))
                    o_v = _num(row.get("open")) or c_v
                    h_v = _num(row.get("high")) or max(o_v, c_v)
                    l_v = _num(row.get("low")) or min(o_v, c_v)
                    if c_v <= 0:
                        continue
                    dec = 4 if c_v < 10 else 2
                    bars.append({
                        "time": dt_iso,
                        "open": round(o_v, dec),
                        "high": round(h_v, dec),
                        "low": round(l_v, dec),
                        "close": round(c_v, dec),
                        "volume": int(_num(row.get("volume"))),
                    })
                if bars:
                    bars.sort(key=lambda x: x["time"])
                    return self._resample_daily(bars, interval) if interval in ("1wk", "1mo") else bars
            except Exception:
                continue
        return []

    def _get_yahoo_client(self) -> httpx.Client:
        with self._yahoo_lock:
            if self._yahoo_client is None:
                self._yahoo_client = httpx.Client(
                    headers={"User-Agent": USER_AGENTS[0], "Accept": "application/json"},
                    timeout=8.0,
                    follow_redirects=True,
                )
            if not self._yahoo_cookie_ready:
                try:
                    self._yahoo_client.get("https://fc.yahoo.com", timeout=4.0)
                except Exception:
                    pass
                self._yahoo_cookie_ready = True
            return self._yahoo_client

    def _fetch_yahoo_chart_sync(
        self,
        symbol: str,
        interval: str,
        rng: str,
        include_events: bool,
    ) -> Optional[dict]:
        if time.time() < self._yahoo_cooldown_until:
            return None

        ev_param = "&events=div,split" if include_events else ""
        client = self._get_yahoo_client()
        now_ts = int(time.time())
        if rng == "max" and interval in ("1d", "1wk", "1mo"):
            span_qs = f"period1=0&period2={now_ts}"
        elif rng in ("5y", "2y") and interval == "1d":
            days_back = 1830 if rng == "5y" else 732
            span_qs = f"period1={max(0, now_ts - days_back * 86400)}&period2={now_ts}"
        else:
            span_qs = f"range={rng}"

        for host in ("query2.finance.yahoo.com", "query1.finance.yahoo.com"):
            url = f"https://{host}/v8/finance/chart/{symbol}?{span_qs}&interval={interval}{ev_param}"
            try:
                r = client.get(url)
                if r.status_code == 429:
                    self._yahoo_cooldown_until = time.time() + 10.0
                    continue
                if r.status_code == 200:
                    return r.json()
            except Exception:
                continue
        return None

    def fetch_public_chart_sync(
        self,
        symbol: str,
        interval: str = "1d",
        period: str = "1mo",
        include_events: bool = False,
    ) -> dict:
        cache_key = f"chart:{symbol}:{interval}:{period}:{include_events}"
        now = time.time()
        if not include_events:
            c = self._history_cache.get(cache_key)
            if c and (now - c[0]) < self.history_ttl:
                return {"candles": c[1], "meta": {}, "events": []}

        # 1) Google Finance embedded series first (0 rate limits) for intraday / 1D / 5D / 1M
        bundle: Optional[dict] = None
        if not include_events and (period in ("1d", "5d", "1mo") or interval in ("1m", "5m", "15m", "1h")):
            bundle = self.fetch_bundle_sync(symbol)
            if bundle:
                if interval == "1m" and bundle["candles_1m"]:
                    self._history_cache[cache_key] = (now, bundle["candles_1m"])
                    return {"candles": bundle["candles_1m"], "meta": bundle["quote"], "events": []}
                if interval == "5m" and bundle["candles_5m"]:
                    self._history_cache[cache_key] = (now, bundle["candles_5m"])
                    return {"candles": bundle["candles_5m"], "meta": bundle["quote"], "events": []}
                if interval == "15m" and bundle["candles_5m"]:
                    rs = self._resample_intraday(bundle["candles_5m"], 900)
                    self._history_cache[cache_key] = (now, rs)
                    return {"candles": rs, "meta": bundle["quote"], "events": []}
                if interval == "1h" and (bundle["candles_5m"] or bundle["candles_1m"]):
                    base_bars = bundle["candles_5m"] or bundle["candles_1m"]
                    rs = self._resample_intraday(base_bars, 3600)
                    self._history_cache[cache_key] = (now, rs)
                    return {"candles": rs, "meta": bundle["quote"], "events": []}
                if interval == "1d" and bundle["candles_1d"]:
                    self._history_cache[cache_key] = (now, bundle["candles_1d"])
                    return {"candles": bundle["candles_1d"], "meta": bundle["quote"], "events": []}

        # 2) For shorter daily/weekly periods (< 5Y), Nasdaq Historical API has zero rate limits for US tickers;
        #    for 5Y / MAX (full listing start history), query full exchange span first (period1=0..now).
        if not include_events and interval in ("1d", "1wk", "1mo") and period.lower() not in ("5y", "max"):
            nas_bars = self._fetch_nasdaq_history_sync(symbol, interval, period)
            if nas_bars:
                self._history_cache[cache_key] = (now, nas_bars)
                return {"candles": nas_bars, "meta": {}, "events": []}

        # 3) Public exchange chart feed (supports full listing-start history via period1=0..now)
        rng_map = {"1d": "1d", "5d": "5d", "1mo": "1mo", "3mo": "3mo", "6mo": "6mo", "ytd": "ytd", "1y": "1y", "2y": "2y", "5y": "5y", "max": "max"}
        rng = rng_map.get(period.lower(), "3mo")
        payload = self._fetch_yahoo_chart_sync(symbol, interval, rng, include_events)
        result_list = ((payload or {}).get("chart") or {}).get("result") or []
        if not result_list and symbol.upper().endswith(".BO") and not include_events:
            payload = self._fetch_yahoo_chart_sync(symbol[:-3] + ".NS", interval, rng, include_events)
            result_list = ((payload or {}).get("chart") or {}).get("result") or []
        if not result_list and not include_events and interval in ("1d", "1wk", "1mo") and period.lower() in ("5y", "max"):
            nas_bars = self._fetch_nasdaq_history_sync(symbol, interval, period)
            if nas_bars:
                self._history_cache[cache_key] = (now, nas_bars)
                return {"candles": nas_bars, "meta": {}, "events": []}

        if not result_list:
            # 4) Graceful fallback to Google Finance embedded daily/intraday bars instead of returning empty
            if not include_events:
                if bundle is None:
                    bundle = self.fetch_bundle_sync(symbol)
                if bundle:
                    fb: List[dict] = []
                    if interval in ("1m", "5m", "15m", "1h"):
                        fb = bundle["candles_5m"] or bundle["candles_1m"] or bundle["candles_1d"]
                        if interval == "15m" and bundle["candles_5m"]:
                            fb = self._resample_intraday(bundle["candles_5m"], 900)
                        elif interval == "1h" and (bundle["candles_5m"] or bundle["candles_1m"]):
                            fb = self._resample_intraday(bundle["candles_5m"] or bundle["candles_1m"], 3600)
                    else:
                        fb = bundle["candles_1d"] or []
                        if interval in ("1wk", "1mo") and fb:
                            fb = self._resample_daily(fb, interval)
                    if fb:
                        self._history_cache[cache_key] = (now, fb)
                        return {"candles": fb, "meta": bundle["quote"], "events": []}
            return {"candles": [], "meta": {}, "events": []}

        res = result_list[0]
        meta = res.get("meta") or {}
        ts_list = res.get("timestamp") or []
        q_ind = (res.get("indicators") or {}).get("quote") or [{}]
        q0 = q_ind[0] if q_ind else {}
        opens, highs, lows, closes, vols = (
            q0.get("open") or [],
            q0.get("high") or [],
            q0.get("low") or [],
            q0.get("close") or [],
            q0.get("volume") or [],
        )

        is_intraday = interval in ("1m", "2m", "5m", "15m", "30m", "60m", "1h")
        seen = set()
        candles = []
        for i, ts in enumerate(ts_list):
            if i >= len(closes) or closes[i] is None or opens[i] is None or highs[i] is None or lows[i] is None:
                continue
            t_val = int(ts) if is_intraday else datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            if t_val in seen:
                continue
            seen.add(t_val)
            c_v = float(closes[i])
            dec = 4 if c_v < 10 else 2
            candles.append({
                "time": t_val,
                "open": round(float(opens[i]), dec),
                "high": round(float(highs[i]), dec),
                "low": round(float(lows[i]), dec),
                "close": round(c_v, dec),
                "volume": int(vols[i]) if i < len(vols) and vols[i] is not None else 0,
            })

        candles.sort(key=lambda x: x["time"])
        if candles and not include_events:
            self._history_cache[cache_key] = (now, candles)

        events: List[dict] = []
        ev_obj = res.get("events") or {}
        for ts_str, dv in (ev_obj.get("dividends") or {}).items():
            dt_s = datetime.fromtimestamp(int(ts_str), tz=timezone.utc).strftime("%Y-%m-%d")
            events.append({"time": dt_s, "type": "D", "label": "Dividend", "detail": f"Dividend: {round(float(dv.get('amount', 0)), 4)}"})
        for ts_str, sp in (ev_obj.get("splits") or {}).items():
            dt_s = datetime.fromtimestamp(int(ts_str), tz=timezone.utc).strftime("%Y-%m-%d")
            events.append({"time": dt_s, "type": "S", "label": "Split", "detail": f"Split: {sp.get('splitRatio', '')}"})

        return {"candles": candles, "meta": meta, "events": events}

    def fetch_quote_with_fallback(self, symbol: str, exchange_hint: Optional[str] = None) -> Optional[dict]:
        """Primary: Google Finance live scrape. Fallback: public exchange chart/quote endpoint."""
        bundle = self.fetch_bundle_sync(symbol, exchange_hint=exchange_hint)
        if bundle:
            return bundle["quote"]

        res = self.fetch_public_chart_sync(symbol, interval="1d", period="5d")
        candles = res.get("candles") or []
        meta = res.get("meta") or {}
        if not candles and not meta.get("regularMarketPrice"):
            res = self.fetch_public_chart_sync(symbol, interval="1d", period="1mo")
            candles = res.get("candles") or []
            meta = res.get("meta") or {}
        if not candles and not meta.get("regularMarketPrice") and symbol.upper().endswith(".BO"):
            ns_sym = symbol[:-3] + ".NS"
            res = self.fetch_public_chart_sync(ns_sym, interval="1d", period="1mo")
            candles = res.get("candles") or []
            meta = res.get("meta") or {}
        if not candles and not meta.get("regularMarketPrice"):
            return None

        px = float(meta.get("regularMarketPrice") or candles[-1]["close"])
        pc = float(meta.get("chartPreviousClose") or (candles[-2]["close"] if len(candles) >= 2 else px))
        chg = round(px - pc, 4 if px < 10 else 2)
        pct = round((chg / pc) * 100.0, 2) if pc else 0.0
        spread = round(max(0.01, px * 0.0002), 4 if px < 10 else 2)
        return {
            "symbol": symbol,
            "name": meta.get("shortName") or meta.get("longName") or symbol,
            "exchange": meta.get("exchangeName") or exchange_hint or "Exchange",
            "currency": meta.get("currency") or "USD",
            "price": round(px, 4 if px < 10 else 2),
            "prev_close": round(pc, 4 if pc < 10 else 2),
            "open": candles[-1]["open"] if candles else px,
            "day_high": float(meta.get("regularMarketDayHigh") or (candles[-1]["high"] if candles else px)),
            "day_low": float(meta.get("regularMarketDayLow") or (candles[-1]["low"] if candles else px)),
            "change": chg,
            "change_percent": pct,
            "volume": int(meta.get("regularMarketVolume") or (candles[-1]["volume"] if candles else 0)),
            "bid": round(px - spread, 4 if px < 10 else 2),
            "ask": round(px + spread, 4 if px < 10 else 2),
            "as_of": str(candles[-1]["time"]) if candles else datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "timestamp": int(time.time()),
            "source": "Public Exchange Fallback",
        }
