from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

from engine.google_finance import GoogleFinanceEngine


class FundamentalsCache:
    """24-hour Redis cache with transparent in-memory TTL fallback."""

    def __init__(self, ttl_sec: int = 86400) -> None:
        self.ttl_sec = ttl_sec
        self._mem: Dict[str, tuple[float, dict]] = {}
        self.redis_client = None
        try:
            import redis
            client = redis.Redis.from_url(
                os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0"),
                socket_connect_timeout=0.3,
                decode_responses=True,
            )
            client.ping()
            self.redis_client = client
        except Exception:
            self.redis_client = None

    def get(self, key: str) -> Optional[dict]:
        if self.redis_client:
            try:
                raw = self.redis_client.get(key)
                if raw:
                    return json.loads(raw)
            except Exception:
                pass
        item = self._mem.get(key)
        if item and (time.time() - item[0]) < self.ttl_sec:
            return item[1]
        return None

    def set(self, key: str, value: dict) -> None:
        if self.redis_client:
            try:
                self.redis_client.setex(key, self.ttl_sec, json.dumps(value))
            except Exception:
                pass
        self._mem[key] = (time.time(), value)


FUND_CACHE = FundamentalsCache(ttl_sec=86400)


def _parse_candle_dt(raw_time: object) -> Optional[datetime]:
    if isinstance(raw_time, (int, float)):
        return datetime.fromtimestamp(float(raw_time), tz=timezone.utc).replace(tzinfo=None)
    s = str(raw_time)[:10]
    if s.isdigit():
        return datetime.fromtimestamp(float(s), tz=timezone.utc).replace(tzinfo=None)
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None


def _compute_rolling_returns(candles: List[dict]) -> tuple[Dict[str, Optional[float]], List[dict], Optional[float]]:
    returns: Dict[str, Optional[float]] = {
        "1D": None, "5D": None, "1M": None, "3M": None, "6M": None,
        "YTD": None, "1Y": None, "5Y": None, "10Y": None, "ALL": None,
    }
    if not candles:
        return returns, [], None

    last_px = float(candles[-1]["close"])
    last_dt = _parse_candle_dt(candles[-1]["time"])
    last_year = last_dt.year if last_dt else datetime.now(timezone.utc).year
    prev_close = float(candles[-2]["close"]) if len(candles) >= 2 else last_px

    sparkline = [
        {"time": c["time"] if isinstance(c["time"], (int, float)) else str(c["time"])[:10], "value": float(c["close"])}
        for c in candles[-30:]
    ]
    returns["1D"] = round(((last_px - prev_close) / prev_close) * 100.0, 2) if prev_close else None

    if not last_dt:
        return returns, sparkline, prev_close

    def ret_for_days(days_ago: int) -> Optional[float]:
        target_ts = last_dt.timestamp() - days_ago * 86400
        base = None
        for c in candles:
            dt = _parse_candle_dt(c["time"])
            if not dt:
                continue
            if dt.timestamp() <= target_ts:
                base = float(c["close"])
            else:
                break
        return round(((last_px - base) / base) * 100.0, 2) if base and base > 0 else None

    # YTD
    ytd_base = next(
        (float(c["close"]) for c in candles if (dt := _parse_candle_dt(c["time"])) and dt.year == last_year),
        None,
    )
    returns["YTD"] = round(((last_px - ytd_base) / ytd_base) * 100.0, 2) if ytd_base else None
    returns["5D"] = ret_for_days(7)
    returns["1M"] = ret_for_days(30)
    returns["3M"] = ret_for_days(90)
    returns["6M"] = ret_for_days(180)
    returns["1Y"] = ret_for_days(365)
    returns["5Y"] = ret_for_days(365 * 5)
    returns["10Y"] = ret_for_days(365 * 10)
    first_px = float(candles[0]["close"])
    returns["ALL"] = round(((last_px - first_px) / first_px) * 100.0, 2) if first_px > 0 else None

    return returns, sparkline, prev_close


def get_asset_overview(
    gf: GoogleFinanceEngine,
    symbol: str,
    universe_meta: Optional[dict] = None,
    live_quote: Optional[dict] = None,
) -> dict:
    cache_key = f"agam:gf:overview:v3:{symbol}"
    cached = FUND_CACHE.get(cache_key)

    if not cached:
        exch_hint = (universe_meta or {}).get("exchange")
        bundle = gf.fetch_bundle_sync(symbol, exchange_hint=exch_hint)
        quote_b = bundle["quote"] if bundle else (live_quote or {})
        prof = bundle["profile"] if bundle else {}

        chart_max = gf.fetch_public_chart_sync(symbol, interval="1d", period="max")
        candles = chart_max.get("candles") or []
        if not candles and bundle and bundle.get("candles_1d"):
            candles = bundle["candles_1d"]

        returns, sparkline, prev_ref = _compute_rolling_returns(candles)
        yr_candles = candles[-365:] if len(candles) > 10 else candles
        computed_52w_hi = max((float(c["high"]) for c in yr_candles), default=None) if yr_candles else None
        computed_52w_lo = min((float(c["low"]) for c in yr_candles), default=None) if yr_candles else None
        cat_l = str((universe_meta or {}).get("category") or "").lower()
        default_sector = (
            "Digital Assets (24/7)" if cat_l == "crypto"
            else "Foreign Exchange (24/5)" if cat_l == "forex"
            else "Commodities & Futures" if cat_l == "commodities"
            else "Fixed Income & Yields" if cat_l == "bonds"
            else "Multi-Asset"
        )

        cached = {
            "symbol": symbol,
            "name": quote_b.get("name") or (universe_meta or {}).get("name") or symbol,
            "exchange": quote_b.get("exchange") or exch_hint or "Exchange",
            "region": (universe_meta or {}).get("region") or "USA",
            "currency": quote_b.get("currency") or (universe_meta or {}).get("currency") or "USD",
            "sector": prof.get("sector") or quote_b.get("sector") or default_sector,
            "industry": prof.get("industry") or (universe_meta or {}).get("category", "Equity").title(),
            "ceo": prof.get("ceo"),
            "ceo_title": "Chief Executive Officer" if prof.get("ceo") else None,
            "website": prof.get("website"),
            "headquarters": prof.get("headquarters"),
            "employees": prof.get("employees"),
            "ipo_date": prof.get("ipo_date"),
            "isin": (universe_meta or {}).get("isin") or None,
            "summary": prof.get("summary") or "",
            "market_cap": prof.get("market_cap") or quote_b.get("market_cap"),
            "trailing_pe": prof.get("trailing_pe"),
            "forward_pe": None,
            "dividend_yield": prof.get("dividend_yield"),
            "beta": None,
            "week_52_high": prof.get("week_52_high") or computed_52w_hi,
            "week_52_low": prof.get("week_52_low") or computed_52w_lo,
            "shares_outstanding": prof.get("shares_outstanding"),
            "volume": quote_b.get("volume") or prof.get("volume"),
            "returns": returns,
            "sparkline": sparkline,
            "prev_close_ref": prev_ref,
            "source": "Google Finance",
            "cached_at": datetime.now(timezone.utc).isoformat(),
        }
        FUND_CACHE.set(cache_key, cached)

    res = dict(cached)
    if live_quote:
        res["price"] = live_quote.get("price")
        res["prev_close"] = live_quote.get("prev_close")
        res["change"] = live_quote.get("change")
        res["volume"] = live_quote.get("volume") or res.get("volume")
        res["change_percent"] = live_quote.get("change_percent")
        res["as_of"] = live_quote.get("as_of")
    return res


def get_asset_financials(
    gf: GoogleFinanceEngine,
    symbol: str,
    period: str = "annual",
    exchange_hint: Optional[str] = None,
) -> dict:
    p_norm = "quarterly" if period.lower().startswith("q") else "annual"
    cache_key = f"agam:gf:financials:v2:{symbol}:{p_norm}"
    cached = FUND_CACHE.get(cache_key)
    if cached:
        return cached

    bundle = gf.fetch_bundle_sync(symbol, exchange_hint=exchange_hint)
    raw_fin = sorted((bundle or {}).get("financials") or [], key=lambda x: (x["year"], x["quarter"]))
    raw_ann = sorted((bundle or {}).get("financials_annual") or [], key=lambda x: x["year"])
    eps_points = (bundle or {}).get("eps") or []

    performance: List[dict] = []
    debt_coverage: List[dict] = []
    waterfall: List[dict] = []

    if p_norm == "annual" and raw_ann:
        agg_rows = raw_ann[-5:]
    elif raw_fin:
        if p_norm == "annual":
            # Fallback aggregation from quarterly Google Finance blocks by fiscal year
            by_year: Dict[int, List[dict]] = {}
            for row in raw_fin:
                by_year.setdefault(row["year"], []).append(row)
            agg_rows = []
            for yr in sorted(by_year.keys())[-5:]:
                grp = by_year[yr]
                rev = sum(r["revenue"] for r in grp)
                ni = sum(r["net_income"] for r in grp)
                op_inc = sum(r["operating_income"] for r in grp)
                fcf = sum(r["free_cash_flow"] for r in grp)
                last_r = grp[-1]
                margin = round((ni / rev) * 100.0, 2) if rev else 0.0
                gms = [r["gross_margin_pct"] for r in grp if r.get("gross_margin_pct") is not None]
                avg_gm = sum(gms) / len(gms) if gms else None
                agg_rows.append({
                    "period": str(yr),
                    "revenue": rev,
                    "net_income": ni,
                    "operating_income": op_inc,
                    "gross_margin_pct": avg_gm,
                    "net_margin_pct": margin,
                    "total_debt": last_r["total_debt"],
                    "free_cash_flow": fcf,
                    "cash": last_r["cash"],
                })
        else:
            agg_rows = raw_fin[-6:]
    else:
        agg_rows = []

    if agg_rows:

        for r in agg_rows:
            performance.append({
                "period": r["period"],
                "revenue": r["revenue"],
                "net_income": r["net_income"],
                "net_margin_pct": r["net_margin_pct"],
            })
            debt_coverage.append({
                "period": r["period"],
                "total_debt": r["total_debt"],
                "free_cash_flow": r["free_cash_flow"],
                "cash": r["cash"],
            })

        # Waterfall bridge using latest period + Google Finance Gross Margin %
        lat = agg_rows[-1]
        rev = lat["revenue"]
        op_inc = lat["operating_income"]
        ni = lat["net_income"]
        gm_pct = lat.get("gross_margin_pct")
        if gm_pct is not None and rev > 0:
            gp = round(rev * (gm_pct / 100.0), 2)
            cogs = round(max(0.0, rev - gp), 2)
            opex = round(max(0.0, gp - op_inc), 2)
        else:
            total_op_cost = max(0.0, rev - op_inc)
            cogs = round(total_op_cost * 0.6, 2)
            opex = round(total_op_cost - cogs, 2)
            gp = rev - cogs
        non_op_tax = ni - op_inc
        if rev > 0:
            waterfall = [
                {"step": "Total Revenue", "value": rev, "start": 0.0, "end": rev, "kind": "total"},
                {"step": "COGS", "value": -cogs, "start": gp, "end": rev, "kind": "negative"},
                {"step": "Gross Profit", "value": gp, "start": 0.0, "end": gp, "kind": "subtotal"},
                {"step": "Operating Exp", "value": -opex, "start": op_inc, "end": gp, "kind": "negative"},
                {"step": "Operating Inc", "value": op_inc, "start": 0.0, "end": op_inc, "kind": "subtotal"},
                {"step": "Non-Op / Taxes", "value": non_op_tax, "start": min(op_inc, ni), "end": max(op_inc, ni), "kind": "positive" if non_op_tax >= 0 else "negative"},
                {"step": "Net Income", "value": ni, "start": 0.0, "end": ni, "kind": "final"},
            ]

    res = {
        "symbol": symbol,
        "period": p_norm,
        "performance": performance,
        "waterfall": waterfall,
        "debt_coverage": debt_coverage,
        "eps": eps_points,
        "source": "Google Finance",
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }
    FUND_CACHE.set(cache_key, res)
    return res


def get_asset_events(gf: GoogleFinanceEngine, symbol: str, exchange_hint: Optional[str] = None) -> dict:
    cache_key = f"agam:gf:events:{symbol}"
    cached = FUND_CACHE.get(cache_key)
    if cached:
        return cached

    markers: List[dict] = []

    # Earnings from Google Finance
    bundle = gf.fetch_bundle_sync(symbol, exchange_hint=exchange_hint)
    for ep in (bundle or {}).get("eps") or []:
        detail = f"EPS Act: {ep['actual']} vs Est: {ep['estimate']}" if ep["actual"] is not None else f"Upcoming EPS Est: {ep['estimate']}"
        markers.append({"time": ep["date"], "type": "E", "label": "Earnings", "detail": detail})

    # Dividends & Splits from public chart events fallback (zero yfinance)
    chart_ev = gf.fetch_public_chart_sync(symbol, interval="1d", period="5y", include_events=True)
    markers.extend(chart_ev.get("events") or [])
    markers.sort(key=lambda m: m["time"])

    out = {"symbol": symbol, "markers": markers}
    FUND_CACHE.set(cache_key, out)
    return out
