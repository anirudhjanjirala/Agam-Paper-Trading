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
    ".SW": "SWX",
}

CRYPTO_QUOTES = ("-USD", "-USDT", "-EUR", "-GBP", "-BTC", "-ETH")


def is_crypto_symbol(symbol: str) -> bool:
    s = (symbol or "").strip().upper()
    return any(s.endswith(q) for q in CRYPTO_QUOTES)


def is_forex_symbol(symbol: str) -> bool:
    return (symbol or "").strip().upper().endswith("=X")


def smart_price_decimals(px: float, is_fx: bool = False) -> int:
    ap = abs(float(px or 0.0))
    if ap <= 0:
        return 2
    if ap < 0.0001:
        return 8
    if ap < 0.01:
        return 6
    if is_fx:
        return 3 if ap >= 50.0 else 5
    if ap < 10.0:
        return 4
    return 2


def to_binance_pair(symbol: str) -> Optional[str]:
    s = (symbol or "").strip().upper()
    if s.endswith("-USD"):
        return f"{s[:-4]}USDT"
    if s.endswith("-USDT"):
        return f"{s[:-5]}USDT"
    if s.endswith(("-EUR", "-BTC", "-ETH")):
        return s.replace("-", "")
    return None


def to_google_finance_ticker(symbol: str, exchange_hint: Optional[str] = None) -> List[str]:
    """Converts internal symbol notation into ordered candidate Google Finance tickers."""
    sym = symbol.strip().upper()
    if sym in INDEX_MAP:
        return [INDEX_MAP[sym]]
    if sym in BSE_SCRIP_MAP:
        return [BSE_SCRIP_MAP[sym]]
    if is_crypto_symbol(sym):
        return [sym[:-1] if sym.endswith("-USDT") else sym]
    if sym.endswith("=X") and len(sym) >= 8:
        base = sym[:-2]
        return [f"{base[:3]}-{base[3:6]}"]
    if sym.endswith("=F") or sym.startswith("^") or sym == "DX-Y.NYB":
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
        self._fx_lock = threading.Lock()
        self._fx_usd_rates: Dict[str, float] = {}
        self._fx_rates_ts: float = 0.0
        self._fx_refreshing: bool = False
        self._crypto_lock = threading.Lock()
        self._crypto_tickers: Dict[str, dict] = {}
        self._crypto_ts: float = 0.0

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
                        is_fx = is_forex_symbol(symbol)
                        dec = smart_price_decimals(px, is_fx=is_fx)
                        spread = round(max(10 ** (-dec), px * (0.00012 if is_fx else 0.00025)), dec)
                        curr = arr[12] if isinstance(arr[12], str) else ("PERCENT" if symbol.startswith("^TNX") else "USD")
                        quote_data = {
                            "symbol": symbol,
                            "gf_ticker": gf_ticker,
                            "name": arr[14],
                            "exchange": "BINANCE" if is_crypto_symbol(symbol) else (gf_ticker.split(":")[1] if ":" in gf_ticker else "FX"),
                            "currency": "GBp" if curr == "GBX" else curr,
                            "price": round(px, dec),
                            "prev_close": round(pc, dec),
                            "open": round(float(arr[2]), dec) if isinstance(arr[2], (int, float)) else round(px, dec),
                            "day_low": round(float(arr[4]), dec) if isinstance(arr[4], (int, float)) and arr[4] > 0 else round(px, dec),
                            "day_high": round(float(arr[5]), dec) if isinstance(arr[5], (int, float)) and arr[5] > 0 else round(px, dec),
                            "change": round(chg, dec),
                            "change_percent": round(pct, 2),
                            "market_cap": float(arr[16]) if len(arr) > 16 and isinstance(arr[16], (int, float)) and arr[16] > 0 else None,
                            "volume": int(arr[17]) if len(arr) > 17 and isinstance(arr[17], (int, float)) else 0,
                            "sector": arr[18] if len(arr) > 18 and isinstance(arr[18], str) else None,
                            "bid": round(px - spread, dec),
                            "ask": round(px + spread, dec),
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
                                    c_b = float(b[1])
                                    dec_b = smart_price_decimals(c_b, is_fx=is_forex_symbol(symbol))
                                    parsed_bars.append({
                                        "time": iso_s[:10] if is_daily_ohlc else ts,
                                        "open": round(float(b[0]), dec_b),
                                        "close": round(c_b, dec_b),
                                        "high": round(float(b[2]), dec_b),
                                        "low": round(float(b[3]), dec_b),
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
                                    dec = smart_price_decimals(val, is_fx=is_forex_symbol(symbol))
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

    def _refresh_fx_usd_rates_sync(self) -> Dict[str, float]:
        try:
            r = self._get_http_client().get("https://api.frankfurter.dev/v1/latest?base=USD", timeout=6.0)
            if r.status_code == 200:
                rates = (r.json() or {}).get("rates") or {}
                parsed = {"USD": 1.0, **{str(k).upper(): float(v) for k, v in rates.items() if isinstance(v, (int, float)) and v > 0}}
                with self._fx_lock:
                    self._fx_usd_rates = parsed
                    self._fx_rates_ts = time.time()
                    self._fx_refreshing = False
                return dict(parsed)
        except Exception:
            pass
        with self._fx_lock:
            self._fx_refreshing = False
            return dict(self._fx_usd_rates)

    def get_fx_usd_rates(self, blocking: bool = False) -> Dict[str, float]:
        """Returns 1 USD -> {CURR: rate} dictionary (non-blocking async refresh when stale)."""
        fallback = {"USD": 1.0, "EUR": 0.94, "GBP": 0.79, "JPY": 152.0, "CHF": 0.88, "CAD": 1.40, "AUD": 1.53, "NZD": 1.69, "INR": 84.5, "CNY": 7.25}
        now = time.time()
        should_refresh = False
        with self._fx_lock:
            if self._fx_usd_rates and (now - self._fx_rates_ts) < 60.0:
                return dict(self._fx_usd_rates)
            if blocking:
                self._fx_refreshing = True
                should_refresh = True
            elif not self._fx_refreshing:
                self._fx_refreshing = True
                should_refresh = True
                cached = dict(self._fx_usd_rates) if self._fx_usd_rates else fallback
            else:
                cached = dict(self._fx_usd_rates) if self._fx_usd_rates else fallback
        if blocking and should_refresh:
            res = self._refresh_fx_usd_rates_sync()
            return res or fallback
        if should_refresh:
            threading.Thread(target=self._refresh_fx_usd_rates_sync, daemon=True).start()
        return cached

    def fx_rate(self, base_curr: str, quote_curr: str) -> Optional[float]:
        rates = self.get_fx_usd_rates()
        b, q = base_curr.upper().strip(), quote_curr.upper().strip()
        if b in rates and q in rates and rates[b] > 0:
            return rates[q] / rates[b]
        return None

    def fetch_crypto_batch_sync(self) -> Dict[str, dict]:
        """Fetches live 24hr stats for all Binance USDT & EUR spot pairs in one zero-cost call."""
        now = time.time()
        with self._crypto_lock:
            if self._crypto_tickers and (now - self._crypto_ts) < 10.0:
                return dict(self._crypto_tickers)
        out: Dict[str, dict] = {}
        try:
            r = self._get_http_client().get("https://api.binance.com/api/v3/ticker/24hr", timeout=10.0)
            if r.status_code == 200:
                now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
                now_ts = int(now)
                for row in r.json():
                    bsym = str(row.get("symbol") or "").upper()
                    px = float(row.get("lastPrice") or 0.0)
                    if px <= 0:
                        continue
                    norm_sym: Optional[str] = None
                    curr = "USD"
                    if bsym.endswith("USDT"):
                        norm_sym = f"{bsym[:-4]}-USD"
                    elif bsym.endswith("EUR"):
                        norm_sym = f"{bsym[:-3]}-EUR"
                        curr = "EUR"
                    elif bsym in ("ETHBTC", "SOLBTC", "BNBBTC", "XRPBTC", "ADABTC", "DOGEBTC", "LTCBTC", "LINKBTC"):
                        norm_sym = f"{bsym[:-3]}-BTC"
                        curr = "USD"
                    if not norm_sym:
                        continue
                    dec = smart_price_decimals(px, is_fx=False)
                    pc = float(row.get("prevClosePrice") or px)
                    chg = float(row.get("priceChange") or (px - pc))
                    pct = float(row.get("priceChangePercent") or 0.0)
                    bid = float(row.get("bidPrice") or 0.0) or round(px * 0.9998, dec)
                    ask = float(row.get("askPrice") or 0.0) or round(px * 1.0002, dec)
                    qvol = int(float(row.get("quoteVolume") or row.get("volume") or 0.0))
                    out[norm_sym] = {
                        "symbol": norm_sym,
                        "name": norm_sym.split("-")[0],
                        "exchange": "BINANCE",
                        "currency": curr,
                        "price": round(px, dec),
                        "prev_close": round(pc, dec),
                        "open": round(float(row.get("openPrice") or pc), dec),
                        "day_high": round(float(row.get("highPrice") or px), dec),
                        "day_low": round(float(row.get("lowPrice") or px), dec),
                        "change": round(chg, dec),
                        "change_percent": round(pct, 2),
                        "volume": qvol,
                        "bid": round(bid, dec),
                        "ask": round(ask, dec),
                        "as_of": now_iso,
                        "timestamp": now_ts,
                        "source": "Binance Spot Feed",
                    }
                with self._crypto_lock:
                    self._crypto_tickers = out
                    self._crypto_ts = now
        except Exception:
            with self._crypto_lock:
                out = dict(self._crypto_tickers)
        return out

    def fetch_forex_quote_sync(self, symbol: str) -> Optional[dict]:
        s = symbol.strip().upper()
        if not s.endswith("=X") or len(s) < 8:
            return None
        base, quote_c = s[:-2][:3], s[:-2][3:6]
        px = self.fx_rate(base, quote_c)
        if not px or px <= 0:
            return None
        dec = smart_price_decimals(px, is_fx=True)
        # Typical realistic FX interbank spread (Majors ~0.8 pip, JPY/Minors ~1.8 pip, Exotics wider)
        pip = 0.01 if quote_c == "JPY" or px >= 50 else 0.0001
        majors = {"EURUSD=X", "GBPUSD=X", "USDJPY=X", "USDCHF=X", "USDCAD=X", "AUDUSD=X", "NZDUSD=X"}
        half_spread = pip * (0.45 if s in majors else 0.95)
        return {
            "symbol": s,
            "name": f"{base}/{quote_c} FX",
            "exchange": "FOREX",
            "currency": "INR" if quote_c == "INR" else ("CAD" if s == "USDCAD=X" else ("CNY" if s == "USDCNY=X" else "USD")),
            "price": round(px, dec),
            "prev_close": round(px, dec),
            "open": round(px, dec),
            "day_high": round(px + half_spread * 2, dec),
            "day_low": round(px - half_spread * 2, dec),
            "change": 0.0,
            "change_percent": 0.0,
            "volume": 1000000,
            "bid": round(px - half_spread, dec),
            "ask": round(px + half_spread, dec),
            "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "timestamp": int(time.time()),
            "source": "ECB / Frankfurter FX Cross",
        }

    def _fetch_binance_klines_sync(self, symbol: str, interval: str, period: str) -> List[dict]:
        pair = to_binance_pair(symbol)
        if not pair:
            return []
        iv_map = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "1w", "1mo": "1M"}
        b_iv = iv_map.get(interval, "1d")
        is_intraday = interval in ("1m", "5m", "15m", "1h", "4h")
        client = self._get_http_client()
        try:
            url = f"https://api.binance.com/api/v3/klines?symbol={pair}&interval={b_iv}&limit=1000"
            r = client.get(url, timeout=8.0)
            if r.status_code != 200:
                return []
            raw = r.json()
            if not isinstance(raw, list) or not raw:
                return []
            # If period == max on 1d, pull older chunk back another 1000 days so users see ~5.5+ yrs history
            if period.lower() == "max" and b_iv == "1d" and len(raw) >= 950:
                first_open_ms = int(raw[0][0])
                r_old = client.get(
                    f"https://api.binance.com/api/v3/klines?symbol={pair}&interval=1d&endTime={first_open_ms - 1}&limit=1000",
                    timeout=8.0,
                )
                if r_old.status_code == 200 and isinstance(r_old.json(), list):
                    raw = r_old.json() + raw

            candles: List[dict] = []
            seen = set()
            for row in raw:
                ts_sec = int(row[0] // 1000)
                t_val: Any = ts_sec if is_intraday else datetime.fromtimestamp(ts_sec, tz=timezone.utc).strftime("%Y-%m-%d")
                if t_val in seen:
                    continue
                seen.add(t_val)
                o, h, l, c, vol = float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[7] or row[5] or 0)
                dec = smart_price_decimals(c, is_fx=False)
                candles.append({
                    "time": t_val,
                    "open": round(o, dec),
                    "high": round(h, dec),
                    "low": round(l, dec),
                    "close": round(c, dec),
                    "volume": int(vol),
                })
            return candles
        except Exception:
            return []

    def _fetch_frankfurter_fx_history(self, symbol: str, interval: str, period: str) -> List[dict]:
        s = symbol.strip().upper()
        if not s.endswith("=X") or len(s) < 8:
            return []
        base, quote_c = s[:-2][:3], s[:-2][3:6]
        if base == quote_c:
            return []
        days_map = {"1d": 7, "5d": 14, "1mo": 35, "3mo": 95, "6mo": 185, "ytd": 365, "1y": 370, "2y": 735, "5y": 1830, "max": 3650}
        now_dt = datetime.now(timezone.utc).date()
        start_dt = now_dt - timedelta(days=days_map.get(period.lower(), 365))
        try:
            url = f"https://api.frankfurter.dev/v1/{start_dt.strftime('%Y-%m-%d')}..{now_dt.strftime('%Y-%m-%d')}?base={base}&symbols={quote_c}"
            r = self._get_http_client().get(url, timeout=8.0)
            if r.status_code != 200:
                return []
            rates = (r.json() or {}).get("rates") or {}
            bars: List[dict] = []
            prev_val: Optional[float] = None
            for d_str in sorted(rates.keys()):
                val = (rates[d_str] or {}).get(quote_c)
                if not isinstance(val, (int, float)) or val <= 0:
                    continue
                dec = smart_price_decimals(val, is_fx=True)
                o = round(prev_val if prev_val is not None else val, dec)
                c = round(float(val), dec)
                prev_val = float(val)
                bars.append({"time": d_str, "open": o, "high": max(o, c), "low": min(o, c), "close": c, "volume": 0})
            return self._resample_daily(bars, interval) if interval in ("1wk", "1mo") else bars
        except Exception:
            return []

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
            if c and (now - c[0]) < (30 if is_crypto_symbol(symbol) else self.history_ttl):
                return {"candles": c[1], "meta": {}, "events": []}

        # 0) Crypto fast-path: Binance Public Klines (exact 1m/5m/15m/1h/4h/1d/1w/1M, 0 rate limit)
        if not include_events and is_crypto_symbol(symbol):
            bin_bars = self._fetch_binance_klines_sync(symbol, interval, period)
            if bin_bars:
                self._history_cache[cache_key] = (now, bin_bars)
                return {"candles": bin_bars, "meta": {"currency": "EUR" if symbol.upper().endswith("-EUR") else "USD", "exchangeName": "BINANCE"}, "events": []}

        # 1) Google Finance embedded series first (0 rate limits) for intraday / 1D / 5D / 1M
        bundle: Optional[dict] = None
        if not include_events and (period in ("1d", "5d", "1mo") or interval in ("1m", "5m", "15m", "1h", "4h")):
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
                if interval == "4h" and (bundle["candles_5m"] or bundle["candles_1m"]):
                    base_bars = bundle["candles_5m"] or bundle["candles_1m"]
                    rs = self._resample_intraday(base_bars, 14400)
                    if len(rs) >= 2:
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
        fetch_iv = "1h" if interval == "4h" else interval
        fetch_rng = "1mo" if interval == "4h" else rng
        payload = self._fetch_yahoo_chart_sync(symbol, fetch_iv, fetch_rng, include_events)
        result_list = ((payload or {}).get("chart") or {}).get("result") or []
        if not result_list and symbol.upper().endswith(".BO") and not include_events:
            payload = self._fetch_yahoo_chart_sync(symbol[:-3] + ".NS", fetch_iv, fetch_rng, include_events)
            result_list = ((payload or {}).get("chart") or {}).get("result") or []
        if not result_list and not include_events and interval in ("1d", "1wk", "1mo") and period.lower() in ("5y", "max"):
            nas_bars = self._fetch_nasdaq_history_sync(symbol, interval, period)
            if nas_bars:
                self._history_cache[cache_key] = (now, nas_bars)
                return {"candles": nas_bars, "meta": {}, "events": []}

        if not result_list:
            # 4) Forex ECB Frankfurter historical fallback
            if not include_events and is_forex_symbol(symbol):
                fx_bars = self._fetch_frankfurter_fx_history(symbol, interval, period)
                if fx_bars:
                    self._history_cache[cache_key] = (now, fx_bars)
                    return {"candles": fx_bars, "meta": {"exchangeName": "FOREX", "currency": "USD"}, "events": []}

            # 5) Graceful fallback to Google Finance embedded daily/intraday bars instead of returning empty
            if not include_events:
                if bundle is None:
                    bundle = self.fetch_bundle_sync(symbol)
                if bundle:
                    fb: List[dict] = []
                    if interval in ("1m", "5m", "15m", "1h", "4h"):
                        fb = bundle["candles_5m"] or bundle["candles_1m"] or bundle["candles_1d"]
                        if interval == "15m" and bundle["candles_5m"]:
                            fb = self._resample_intraday(bundle["candles_5m"], 900)
                        elif interval == "1h" and (bundle["candles_5m"] or bundle["candles_1m"]):
                            fb = self._resample_intraday(bundle["candles_5m"] or bundle["candles_1m"], 3600)
                        elif interval == "4h" and (bundle["candles_5m"] or bundle["candles_1m"]):
                            fb = self._resample_intraday(bundle["candles_5m"] or bundle["candles_1m"], 14400)
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

        is_intraday = interval in ("1m", "2m", "5m", "15m", "30m", "60m", "1h", "4h")
        is_fx = is_forex_symbol(symbol)
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
            dec = smart_price_decimals(c_v, is_fx=is_fx)
            candles.append({
                "time": t_val,
                "open": round(float(opens[i]), dec),
                "high": round(float(highs[i]), dec),
                "low": round(float(lows[i]), dec),
                "close": round(c_v, dec),
                "volume": int(vols[i]) if i < len(vols) and vols[i] is not None else 0,
            })

        candles.sort(key=lambda x: x["time"])
        if interval == "4h" and candles:
            candles = self._resample_intraday(candles, 14400)
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
        """Primary: Binance (Crypto) / Google Finance live scrape. Fallback: Frankfurter (FX) / public exchange chart endpoint."""
        if is_crypto_symbol(symbol):
            crypto_map = self.fetch_crypto_batch_sync()
            if symbol.upper() in crypto_map:
                return crypto_map[symbol.upper()]

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
            if is_forex_symbol(symbol):
                return self.fetch_forex_quote_sync(symbol)
            return None

        px = float(meta.get("regularMarketPrice") or candles[-1]["close"])
        pc = float(meta.get("chartPreviousClose") or (candles[-2]["close"] if len(candles) >= 2 else px))
        is_fx = is_forex_symbol(symbol)
        dec = smart_price_decimals(px, is_fx=is_fx)
        chg = round(px - pc, dec)
        pct = round((chg / pc) * 100.0, 2) if pc else 0.0
        spread = round(max(10 ** (-dec), px * (0.00012 if is_fx else 0.00025)), dec)
        return {
            "symbol": symbol,
            "name": meta.get("shortName") or meta.get("longName") or symbol,
            "exchange": meta.get("exchangeName") or exchange_hint or "Exchange",
            "currency": meta.get("currency") or "USD",
            "price": round(px, dec),
            "prev_close": round(pc, dec),
            "open": candles[-1]["open"] if candles else round(px, dec),
            "day_high": float(meta.get("regularMarketDayHigh") or (candles[-1]["high"] if candles else px)),
            "day_low": float(meta.get("regularMarketDayLow") or (candles[-1]["low"] if candles else px)),
            "change": chg,
            "change_percent": pct,
            "volume": int(meta.get("regularMarketVolume") or (candles[-1]["volume"] if candles else 0)),
            "bid": round(px - spread, dec),
            "ask": round(px + spread, dec),
            "as_of": str(candles[-1]["time"]) if candles else datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "timestamp": int(time.time()),
            "source": "Public Exchange Fallback",
        }
