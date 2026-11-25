import asyncio
import csv
import gc
import html
import io
import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.alert_engine import ConditionType, NonExpiringAlertEngine
from core.auth import (
    REFRESH_COOKIE_NAME,
    clear_session_cookies,
    create_user_account,
    decode_access_token,
    get_optional_user,
    get_or_provision_workspace_user,
    issue_session_tokens,
    rotate_refresh_token,
    verify_password,
)
from core.database import SessionLocal, get_db, init_db
from core.fundamentals import get_asset_events, get_asset_financials, get_asset_overview
from core.models import OrderModel, UserAlertModel, UserModel
from core.paper_wallets import DEFAULT_WALLETS, REGION_DEFAULT_CURRENCY
from core.quant_engine import (
    INDICATOR_CATALOG,
    compute_chained_indicator,
    compute_expected_move,
    compute_tpo_profile,
    compute_volume_footprint,
    compute_volume_profile,
    detect_patterns,
)
from core.replay_engine import IsolatedReplayEngine
from core.screener_engine import ScreenerQuery, run_columnar_scan
from core.tenant_store import (
    TenantPortfolioService,
    delete_user_alert,
    get_user_layout,
    get_user_watchlists,
    list_user_alerts,
    save_user_layout,
    upsert_user_watchlist,
)
from core.tick_aggregator import Tick, TickAggregator
from core.universe_loader import GlobalUniverseStore
from core.ws_hub import RealtimeWebSocketHub
from engine.google_finance import GoogleFinanceEngine
from engine.google_news import GoogleNewsEngine

app = FastAPI(title="Agam Institutional Multi-Tenant Paper Trading API", version="5.0.0")

_extra_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        *_extra_origins,
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------
# CORE ENGINE SINGLETONS (Zero yfinance — Google Finance & RSS)
# -------------------------------------------------------------
GF_ENGINE = GoogleFinanceEngine(quote_ttl=4, history_ttl=3600)
NEWS_ENGINE = GoogleNewsEngine(cache_ttl_sec=30)
UNIVERSE = GlobalUniverseStore()
TICK_AGGREGATOR = TickAggregator(max_bars=500)
ALERTS = NonExpiringAlertEngine(cooldown_sec=60)
REPLAY = IsolatedReplayEngine()
WS_HUB = RealtimeWebSocketHub()
ALERT_USER_MAP: Dict[str, str] = {}
MAIN_EVENT_LOOP: Optional[asyncio.AbstractEventLoop] = None

LIVE_PRICES: Dict[str, dict] = {}
PRICE_LOCK = threading.RLock()
LAST_MARKET_SYNC: Optional[str] = None

PRIORITY_LIVE_SYMBOLS = [
    # IND (NSE, BSE, Indices, Commodity & Bond ETFs, FX)
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "TMPV.NS", "TMCV.NS",
    "ICICIBANK.NS", "SBIN.NS", "BHARTIARTL.NS", "RELIANCE.BO", "TCS.BO",
    "^NSEI", "^BSESN", "^NSEBANK", "NIFTYBEES.NS", "GOLDBEES.NS", "SILVERBEES.NS",
    "LIQUIDBEES.NS", "LTGILTBEES.NS", "USDINR=X", "EURINR=X",
    # USA (Stocks, ETFs, Futures, Bonds, FX)
    "AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META",
    "SPY", "QQQ", "^GSPC", "^IXIC", "^DJI", "^VIX",
    "ES=F", "NQ=F", "GC=F", "SI=F", "CL=F", "NG=F",
    "^TNX", "^TYX", "^FVX", "TLT", "LQD", "HYG", "USDJPY=X",
    # CANADA
    "SHOP.TO", "RY.TO", "ENB.TO", "^GSPTSE", "XIU.TO", "XEG.TO", "XGD.TO",
    "XBB.TO", "ZAG.TO", "USDCAD=X",
    # CHINA
    "000001.SS", "399001.SZ", "600519.SS", "601318.SS", "300750.SZ",
    "510300.SS", "510050.SS", "159915.SZ", "511010.SS", "511260.SS", "518880.SS", "USDCNY=X",
    # EU & UK
    "ASML.AS", "SAP.DE", "MC.PA", "SHEL.L", "AZN.L", "HSBA.L",
    "CSPX.L", "EXS1.DE", "IGLN.L",
    "^GDAXI", "^FTSE", "^FCHI", "IGLT.L", "EUNH.DE", "EURUSD=X", "GBPUSD=X",
]


def _compute_quick_rsi(candles: List[dict], period: int = 14) -> float:
    if len(candles) < period + 1:
        return 50.0
    closes = [float(c["close"]) for c in candles[-(period + 5):]]
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(0.0, d))
        losses.append(max(0.0, -d))
    avg_g = sum(gains[-period:]) / period
    avg_l = sum(losses[-period:]) / period
    if avg_l == 0:
        return 100.0 if avg_g > 0 else 50.0
    rs = avg_g / avg_l
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def get_market_sessions() -> dict:
    now_utc = datetime.now(timezone.utc)

    def is_open(tz_name: str, open_h: int, open_m: int, close_h: int, close_m: int) -> dict:
        local = now_utc.astimezone(ZoneInfo(tz_name))
        is_weekday = local.weekday() < 5
        cur_mins = local.hour * 60 + local.minute
        active = is_weekday and ((open_h * 60 + open_m) <= cur_mins <= (close_h * 60 + close_m))
        return {"open": active, "local_time": local.strftime("%H:%M %Z"), "status": "OPEN" if active else "CLOSED"}

    return {
        "IND": is_open("Asia/Kolkata", 9, 15, 15, 30),
        "USA": is_open("America/New_York", 9, 30, 16, 0),
        "CANADA": is_open("America/Toronto", 9, 30, 16, 0),
        "CHINA": is_open("Asia/Shanghai", 9, 30, 15, 0),
        "EU": is_open("Europe/London", 8, 0, 16, 30),
    }


def _sync_one_symbol(sym: str) -> Optional[dict]:
    meta = UNIVERSE.get_by_symbol(sym)
    exch_hint = meta.get("exchange") if meta else None
    bundle = GF_ENGINE.fetch_bundle_sync(sym, exchange_hint=exch_hint)
    if bundle:
        q = dict(bundle["quote"])
        q["rsi_14"] = _compute_quick_rsi(bundle.get("candles_1d") or [])
        return q
    q = GF_ENGINE.fetch_quote_with_fallback(sym, exchange_hint=exch_hint)
    if not q:
        return None
    q["rsi_14"] = meta.get("rsi_14", 50.0) if meta else 50.0
    return q


def sync_batch_quotes(symbols: List[str]) -> None:
    """Concurrently pulls live quotes from Google Finance + public exchange fallbacks."""
    global LAST_MARKET_SYNC
    if not symbols:
        return

    now_ms = int(time.time() * 1000)
    updates: Dict[str, dict] = {}
    fired_alerts: List[dict] = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        for res in pool.map(_sync_one_symbol, symbols):
            if res and res.get("price", 0) > 0:
                sym = res["symbol"]
                updates[sym] = res
                TICK_AGGREGATOR.ingest_tick(
                    Tick(symbol=sym, price=res["price"], size=max(1, res.get("volume", 1000) // 1000), ts_ms=now_ms, bid=res.get("bid"), ask=res.get("ask")),
                    intervals=["1s", "5s", "1m", "10T", "1R"],
                )
                for ev in ALERTS.evaluate_tick(sym, res["price"], res.get("rsi_14", 50.0)):
                    ev["user_id"] = ALERT_USER_MAP.get(ev.get("rule_id", ""), "")
                    fired_alerts.append(ev)

    if updates:
        with PRICE_LOCK:
            LIVE_PRICES.update(updates)
        UNIVERSE.update_quotes(updates)

        with SessionLocal() as db:
            fill_events = TenantPortfolioService.evaluate_all_pending_and_stops(db, LIVE_PRICES)
            for ev in fired_alerts:
                uid = ev.get("user_id")
                row = db.get(UserAlertModel, ev.get("rule_id")) if ev.get("rule_id") else None
                if row:
                    row.triggered_count += 1
                    row.triggered_at = datetime.now(timezone.utc)
                    uid = row.user_id
                if uid:
                    WS_HUB.schedule_user_event(MAIN_EVENT_LOOP, uid, {"type": "ALERT_TRIGGERED", "alert": ev})
            if fired_alerts:
                db.commit()

            for fe in fill_events:
                uid = fe.get("user_id")
                if uid:
                    WS_HUB.schedule_user_event(MAIN_EVENT_LOOP, uid, fe)

        if MAIN_EVENT_LOOP and MAIN_EVENT_LOOP.is_running():
            for sym, q in updates.items():
                if sym in WS_HUB.market_sockets:
                    asyncio.run_coroutine_threadsafe(
                        WS_HUB.publish_market_tick(sym, {"type": "TICK", **q}),
                        MAIN_EVENT_LOOP,
                    )

        LAST_MARKET_SYNC = datetime.now(timezone.utc).isoformat()


UNIVERSE_READY = threading.Event()
_BG_STARTED = False


def _starter_record(sym: str) -> dict:
    cat = "stocks"
    exch = "NASDAQ"
    reg = "USA"
    curr = "USD"
    if sym.endswith("=X"):
        cat, exch = "forex", "FOREX"
        if "INR" in sym:
            reg, curr = "IND", "INR"
        elif "CAD" in sym:
            reg, curr = "CANADA", "CAD"
        elif "CNY" in sym:
            reg, curr = "CHINA", "CNY"
        elif "JPY" in sym:
            reg, curr = "USA", "USD"
        else:
            reg, curr = "EU", "USD"
    elif sym.endswith("=F"):
        reg, exch, cat, curr = "USA", "CME", "commodities", "USD"
    elif sym.startswith("^"):
        cat = "bonds" if sym in ("^TNX", "^TYX", "^FVX") else "indices"
        if sym in ("^NSEI", "^BSESN", "^NSEBANK"):
            reg, exch, curr = "IND", ("BSE" if "BSE" in sym else "NSE"), "INR"
        elif sym == "^GSPTSE":
            reg, exch, curr = "CANADA", "TSX", "CAD"
        elif sym in ("^GDAXI", "^FTSE", "^FCHI"):
            reg, exch, curr = "EU", ("LSE" if sym == "^FTSE" else "EU"), ("GBP" if sym == "^FTSE" else "EUR")
        else:
            reg, exch, curr = "USA", ("US Treasury" if cat == "bonds" else "INDEX"), "USD"
    elif sym.endswith((".NS", ".BO")):
        reg, exch, curr = "IND", ("NSE" if sym.endswith(".NS") else "BSE"), "INR"
        if sym in ("GOLDBEES.NS", "SILVERBEES.NS"):
            cat = "commodities"
        elif sym in ("LIQUIDBEES.NS", "LTGILTBEES.NS"):
            cat = "bonds"
        elif "BEES" in sym:
            cat = "etfs"
    elif sym.endswith(".TO"):
        reg, exch, curr = "CANADA", "TSX", "CAD"
        if sym.startswith(("XBB", "ZAG")):
            cat = "bonds"
        elif sym in ("XEG.TO", "XGD.TO"):
            cat = "commodities"
        elif sym in ("XIU.TO",):
            cat = "etfs"
    elif sym.endswith((".SS", ".SZ")):
        reg, exch, curr = "CHINA", ("SSE" if sym.endswith(".SS") else "SZSE"), "CNY"
        if sym in ("518880.SS",):
            cat = "commodities"
        elif sym.startswith("511"):
            cat = "bonds"
        elif sym.startswith(("510", "159")) or sym in ("000001.SS", "399001.SZ"):
            cat = "indices" if sym in ("000001.SS", "399001.SZ") else "etfs"
    elif sym.endswith((".L", ".DE", ".AS", ".PA")):
        reg = "EU"
        exch = "LSE" if sym.endswith(".L") else "XETRA" if sym.endswith(".DE") else "Euronext"
        curr = "USD" if sym in ("CSPX.L", "IGLN.L") else ("GBp" if sym.endswith(".L") else "EUR")
        if sym in ("IGLN.L",):
            cat = "commodities"
        elif sym.startswith(("IGLT", "EUNH")):
            cat = "bonds"
        elif sym in ("CSPX.L", "EXS1.DE"):
            cat = "etfs"
    elif sym in ("TLT", "LQD", "HYG"):
        reg, exch, cat, curr = "USA", "NYSE", "bonds", "USD"
    elif sym in ("SPY", "QQQ"):
        reg, exch, cat, curr = "USA", "NASDAQ", "etfs", "USD"

    return {
        "symbol": sym,
        "name": sym,
        "region": reg,
        "exchange": exch,
        "category": cat,
        "currency": curr,
        "isin": "",
        "price": 0.0,
        "prev_close": 0.0,
        "change": 0.0,
        "change_percent": 0.0,
        "volume": 0,
        "rsi_14": 50.0,
        "as_of": "",
    }


def _startup_ingest_and_sync_loop():
    print("Ingesting live global security universe (IND, USA, CANADA, CHINA, EU) in background...")
    try:
        UNIVERSE.ingest_all_regions_parallel()
        gc.collect()
        print("Universe ingested:", UNIVERSE.stats)
    except Exception as exc:
        print("Universe ingest warning:", exc)
    finally:
        UNIVERSE_READY.set()

    while True:
        try:
            sync_batch_quotes(PRIORITY_LIVE_SYMBOLS)
        except Exception as exc:
            print("Quote sync loop warning:", exc)
        time.sleep(15)


# Seed instant starter instruments (<1ms) so HTTP requests succeed immediately on boot
UNIVERSE._upsert_records([_starter_record(s) for s in PRIORITY_LIVE_SYMBOLS])


def _load_persisted_alerts_to_zset() -> None:
    try:
        with SessionLocal() as db:
            rows = db.scalars(select(UserAlertModel).where(UserAlertModel.is_active.is_(True))).all()
            for r in rows:
                ALERT_USER_MAP[r.id] = r.user_id
                ALERTS.add_rule(r.symbol, r.condition, r.target_value, r.note, rule_id=r.id)  # type: ignore[arg-type]
    except Exception as exc:
        print("Alert preload warning:", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _BG_STARTED, MAIN_EVENT_LOOP
    MAIN_EVENT_LOOP = asyncio.get_running_loop()
    init_db()
    _load_persisted_alerts_to_zset()
    if not _BG_STARTED:
        _BG_STARTED = True
        threading.Thread(target=_startup_ingest_and_sync_loop, daemon=True).start()
    yield


app.router.lifespan_context = lifespan

# -------------------------------------------------------------
# LIVE IPOs, MACRO & EXPIRIES (Public Exchange Endpoints)
# -------------------------------------------------------------
IPO_CACHE: Dict[str, object] = {"timestamp": 0.0, "data": []}
MACRO_CACHE: Dict[str, object] = {"timestamp": 0.0, "data": None}
EXPIRY_CACHE: Dict[str, dict] = {}


def fetch_live_ipos() -> List[dict]:
    now = time.time()
    if IPO_CACHE["data"] and (now - float(IPO_CACHE["timestamp"])) < 600:
        return IPO_CACHE["data"]  # type: ignore

    ipos: List[dict] = []
    try:
        with httpx.Client(
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=8,
            follow_redirects=True,
        ) as client:
            client.get("https://www.nseindia.com")
            for ep, default_status in [
                ("https://www.nseindia.com/api/ipo-current-issue", "Active / Open"),
                ("https://www.nseindia.com/api/all-upcoming-issues?category=ipo", "Upcoming"),
            ]:
                r = client.get(ep)
                if r.status_code == 200:
                    items = r.json()
                    if isinstance(items, list):
                        for idx, row in enumerate(items[:12]):
                            sym = row.get("symbol") or f"NSE-IPO-{idx}"
                            size_raw = row.get("issueSize") or ""
                            size_fmt = f"{int(size_raw):,} Shares" if str(size_raw).isdigit() else str(size_raw)
                            sub = row.get("noOfTime") or "Live Bidding"
                            if sub and sub != "Live Bidding" and not str(sub).endswith("x"):
                                sub = f"{sub}x"
                            ipos.append({
                                "id": f"in-{sym}-{idx}",
                                "company": row.get("companyName", sym),
                                "symbol": f"{sym}.NS",
                                "country": "IND",
                                "price_band": row.get("issuePrice") or "TBA",
                                "issue_size": size_fmt or "TBA",
                                "open_date": row.get("issueStartDate") or "TBA",
                                "close_date": row.get("issueEndDate") or "TBA",
                                "listing_date": row.get("issueEndDate") or "TBA",
                                "status": row.get("status") or default_status,
                                "segment": row.get("series") or row.get("segment") or "Equity",
                                "subscription": sub,
                            })
    except Exception:
        pass

    try:
        r_nas = httpx.get("https://api.nasdaq.com/api/ipo/calendar", headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
        if r_nas.status_code == 200:
            nas_data = r_nas.json().get("data", {})
            for bucket, status_label in [("priced", "Priced / Listed"), ("filed", "Filed / Upcoming")]:
                rows = (nas_data.get(bucket) or {}).get("rows") or []
                for idx, row in enumerate(rows[:10]):
                    sym = row.get("proposedTickerSymbol") or "TBA"
                    price = row.get("proposedSharePrice")
                    ipos.append({
                        "id": f"us-{bucket}-{sym}-{idx}",
                        "company": row.get("companyName", sym),
                        "symbol": sym,
                        "country": "USA",
                        "price_band": f"${price}" if price else "TBA",
                        "issue_size": row.get("dollarValueOfSharesOffered") or "TBA",
                        "open_date": row.get("filedDate") or row.get("pricedDate") or "TBA",
                        "close_date": row.get("pricedDate") or "TBA",
                        "listing_date": row.get("pricedDate") or "Upcoming",
                        "status": row.get("dealStatus") or status_label,
                        "segment": row.get("proposedExchange") or "NASDAQ",
                        "subscription": "Live Filing",
                    })
    except Exception:
        pass

    if ipos:
        IPO_CACHE["data"] = ipos
        IPO_CACHE["timestamp"] = now
    return ipos


def _parse_fred_csv(series_id: str) -> List[tuple]:
    r = httpx.get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}", timeout=8)
    rows = []
    if r.status_code == 200:
        for line in r.text.strip().splitlines():
            parts = line.split(",")
            if len(parts) == 2 and parts[0][:4].isdigit() and parts[1].strip() not in ("", "."):
                try:
                    rows.append((parts[0], float(parts[1])))
                except ValueError:
                    continue
    return rows


def fetch_live_macro() -> dict:
    now = time.time()
    if MACRO_CACHE["data"] and (now - float(MACRO_CACHE["timestamp"])) < 900:
        return MACRO_CACHE["data"]  # type: ignore

    inflation_list, interest_rates, econ_events = [], [], []
    for label, sid, country in [
        ("Federal Reserve (USA)", "FEDFUNDS", "USA"),
        ("US 10-Yr Treasury Yield", "DGS10", "USA"),
    ]:
        try:
            rows = _parse_fred_csv(sid)
            if rows:
                d, v = rows[-1]
                interest_rates.append({"central_bank": label, "rate": f"{v:.2f}%", "as_of": d, "country": country})
        except Exception:
            pass

    for c_name, c_code, sid, target in [
        ("United States", "USA", "CPIAUCSL", "2.0%"),
        ("Eurozone", "EU", "CP0000EZ19M086NEST", "2.0%"),
    ]:
        try:
            rows = _parse_fred_csv(sid)
            if len(rows) >= 13:
                d_last, v_last = rows[-1]
                y, m, day = d_last.split("-")
                prev_map = dict(rows)
                prev_key = f"{int(y)-1}-{m}-{day}"
                v_prev = prev_map[prev_key] if prev_key in prev_map else rows[-12][1]
                yoy = ((v_last - v_prev) / v_prev) * 100
                inflation_list.append({
                    "country": c_name, "country_code": c_code, "metric": "CPI Inflation (YoY)",
                    "rate": f"{yoy:.2f}%", "target": target, "as_of": d_last, "status": "Live FRED Data",
                })
        except Exception:
            pass

    today_utc = datetime.now(timezone.utc).date()
    for offset in [0, -1, -2, 1]:
        d_str = (today_utc + timedelta(days=offset)).strftime("%Y-%m-%d")
        try:
            r = httpx.get(
                f"https://api.nasdaq.com/api/calendar/economicevents?date={d_str}",
                headers={"User-Agent": "Mozilla/5.0"}, timeout=6,
            )
            if r.status_code == 200:
                for row in (r.json().get("data", {}).get("rows") or []):
                    ev = html.unescape(row.get("eventName") or "").replace("\xa0", " ").strip()
                    if ev:
                        def _clean_cell(val: object, default: str) -> str:
                            cleaned = html.unescape(str(val or "")).replace("\xa0", " ").strip()
                            return cleaned if cleaned else default

                        econ_events.append({
                            "date": d_str,
                            "time_gmt": _clean_cell(row.get("gmt"), ""),
                            "country": _clean_cell(row.get("country"), "Global"),
                            "event": ev,
                            "actual": _clean_cell(row.get("actual"), "Pending"),
                            "consensus": _clean_cell(row.get("consensus"), "—"),
                            "previous": _clean_cell(row.get("previous"), "—"),
                        })
        except Exception:
            continue

    res = {
        "inflation": inflation_list,
        "interest_rates": interest_rates,
        "economic_calendar": econ_events[:40],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    MACRO_CACHE["data"] = res
    MACRO_CACHE["timestamp"] = now
    return res


def fetch_live_expiries(symbol: str) -> dict:
    now = time.time()
    if symbol in EXPIRY_CACHE and (now - EXPIRY_CACHE[symbol]["ts"]) < 600:
        return EXPIRY_CACHE[symbol]["data"]
    expiries: List[str] = []
    source = "Exchange Live"

    if symbol.endswith(".NS") or symbol in ["^NSEI", "^NSEBANK"]:
        nse_sym = "NIFTY" if symbol == "^NSEI" else "BANKNIFTY" if symbol == "^NSEBANK" else symbol.replace(".NS", "")
        try:
            with httpx.Client(headers={"User-Agent": "Mozilla/5.0"}, timeout=8, follow_redirects=True) as c:
                c.get("https://www.nseindia.com")
                r = c.get(f"https://www.nseindia.com/api/option-chain-contract-info?symbol={nse_sym}")
                if r.status_code == 200:
                    expiries = r.json().get("expiryDates", [])[:8]
                    source = "NSE India F&O Live"
        except Exception:
            pass
    elif "." not in symbol and not symbol.startswith("^") and "=" not in symbol:
        try:
            r = httpx.get(
                f"https://api.nasdaq.com/api/quote/{symbol}/option-chain?assetclass=stocks&limit=80",
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=8,
            )
            if r.status_code == 200:
                rows = (r.json().get("data") or {}).get("table", {}).get("rows") or []
                seen_exp = []
                for row in rows:
                    ex = (row.get("expirygroup") or row.get("expiryDate") or "").strip()
                    if ex and ex not in seen_exp:
                        seen_exp.append(ex)
                expiries = seen_exp[:8]
                source = "NASDAQ OPRA Live"
        except Exception:
            pass

    data = {"symbol": symbol, "expiries": expiries, "source": source}
    EXPIRY_CACHE[symbol] = {"ts": now, "data": data}
    return data


def _load_candles(symbol: str, interval: str = "1d", period: str = "1mo") -> List[dict]:
    if interval.endswith(("s", "T", "R")):
        agg = TICK_AGGREGATOR.get_bars(symbol, interval, include_footprint=True)
        if agg and len(agg) >= 5:
            return agg
        # Before enough live ticks accumulate, bootstrap cleanly with 1m / 5m intraday Google Finance bars
        for iv_fb, per_fb in (("1m", "1d"), ("5m", "5d"), ("1d", "1mo")):
            res_fb = GF_ENGINE.fetch_public_chart_sync(symbol, interval=iv_fb, period=per_fb)
            bars_fb = res_fb.get("candles") or []
            if bars_fb:
                return bars_fb

    res = GF_ENGINE.fetch_public_chart_sync(symbol, interval=interval, period=period)
    candles = res.get("candles") or []
    if not candles:
        # Fallback to Google Finance embedded 5m/1d bars
        for iv_fb, per_fb in (("1d", "1mo"), ("1d", "3mo"), ("5m", "5d")):
            res2 = GF_ENGINE.fetch_public_chart_sync(symbol, interval=iv_fb, period=per_fb)
            candles = res2.get("candles") or []
            if candles:
                break

    if not candles:
        # Reference bar synthesis for exchange-only fixed-income / G-Sec instruments with live price
        with PRICE_LOCK:
            q = LIVE_PRICES.get(symbol)
        meta = UNIVERSE.get_by_symbol(symbol)
        px = float((q or meta or {}).get("price") or 0.0)
        if px > 0:
            pc = float((q or meta or {}).get("prev_close") or px)
            today_dt = datetime.now(timezone.utc).date()
            prev_dt = today_dt - timedelta(days=1)
            candles = [
                {"time": prev_dt.strftime("%Y-%m-%d"), "open": pc, "high": pc, "low": pc, "close": pc, "volume": 0},
                {"time": today_dt.strftime("%Y-%m-%d"), "open": pc, "high": max(pc, px), "low": min(pc, px), "close": px, "volume": int((q or meta or {}).get("volume") or 0)},
            ]

    if not candles:
        raise HTTPException(status_code=404, detail=f"No historical market data available for {symbol}")
    return candles


def _to_heikin_ashi(bars: List[dict]) -> List[dict]:
    if not bars:
        return []
    ha = []
    prev_open = (bars[0]["open"] + bars[0]["close"]) * 0.5
    prev_close = (bars[0]["open"] + bars[0]["high"] + bars[0]["low"] + bars[0]["close"]) * 0.25
    for i, b in enumerate(bars):
        ha_close = (b["open"] + b["high"] + b["low"] + b["close"]) * 0.25
        ha_open = prev_open if i == 0 else (prev_open + prev_close) * 0.5
        ha_high = max(b["high"], ha_open, ha_close)
        ha_low = min(b["low"], ha_open, ha_close)
        ha.append({
            "time": b["time"],
            "open": round(ha_open, 4 if ha_open < 10 else 2),
            "high": round(ha_high, 4 if ha_high < 10 else 2),
            "low": round(ha_low, 4 if ha_low < 10 else 2),
            "close": round(ha_close, 4 if ha_close < 10 else 2),
            "volume": b.get("volume", 0),
        })
        prev_open, prev_close = ha_open, ha_close
    return ha


def _to_renko(bars: List[dict]) -> List[dict]:
    if not bars:
        return []
    closes = [b["close"] for b in bars]
    rng = max(closes) - min(closes)
    brick = max(0.05, round(rng / 35.0, 2))
    bricks: List[dict] = []
    cur_level = closes[0]
    for b in bars:
        c = b["close"]
        while c >= cur_level + brick:
            nxt = cur_level + brick
            bricks.append({"time": b["time"], "open": round(cur_level, 2), "high": round(nxt, 2), "low": round(cur_level, 2), "close": round(nxt, 2), "volume": b.get("volume", 0)})
            cur_level = nxt
        while c <= cur_level - brick:
            nxt = cur_level - brick
            bricks.append({"time": b["time"], "open": round(cur_level, 2), "high": round(cur_level, 2), "low": round(nxt, 2), "close": round(nxt, 2), "volume": b.get("volume", 0)})
            cur_level = nxt
    if not bricks:
        return bars[-20:]
    trimmed = bricks[-len(bars):]
    ts_pool = [b["time"] for b in bars[-len(trimmed):]]
    return [{**bk, "time": ts_pool[i]} for i, bk in enumerate(trimmed)]


# -------------------------------------------------------------
# REST API ENDPOINTS
# -------------------------------------------------------------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "data_engine": "Google Finance + Google News RSS (Zero yfinance)",
        "universe_stats": UNIVERSE.stats,
        "live_priced_tickers": len(LIVE_PRICES),
        "last_market_sync": LAST_MARKET_SYNC,
        "sessions": get_market_sessions(),
        "alert_engine": ALERTS.backend_mode,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/sessions")
def sessions():
    return get_market_sessions()


@app.get("/api/universe/stats")
def universe_stats():
    return {
        "stats": UNIVERSE.stats,
        "last_ingested_at": UNIVERSE.last_ingested_at,
        "regions": ["IND", "USA", "CANADA", "CHINA", "EU"],
        "currencies": REGION_DEFAULT_CURRENCY,
    }


@app.get("/api/universe/list")
def universe_list(region: Optional[str] = "ALL", category: Optional[str] = "all", offset: int = 0, limit: int = 60):
    return UNIVERSE.list_instruments(region=region, category=category, offset=offset, limit=min(limit, 500))


@app.get("/api/assets")
def get_assets(country: Optional[str] = None, category: Optional[str] = None, limit: int = 40):
    region_map = {"IN": "IND", "US": "USA", "CA": "CANADA", "CN": "CHINA"}
    region = region_map.get(country or "", country)
    listing = UNIVERSE.list_instruments(region=region, category=category, offset=0, limit=limit)
    return listing["items"]


@app.get("/api/search")
def search_stocks(q: str = Query(..., min_length=1), region: Optional[str] = "ALL", category: Optional[str] = "all"):
    local_hits = UNIVERSE.search(q, region=region, category=category, limit=25)
    if len(local_hits) >= 8:
        return local_hits

    try:
        r = httpx.get(
            f"https://query2.finance.yahoo.com/v1/finance/search?q={q}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=6.0,
        )
        if r.status_code == 200:
            seen = {x["symbol"] for x in local_hits}
            for item in (r.json().get("quotes") or [])[:10]:
                sym = item.get("symbol")
                if not sym or sym in seen:
                    continue
                seen.add(sym)
                reg = (
                    "IND" if sym.endswith((".NS", ".BO"))
                    else "CANADA" if sym.endswith((".TO", ".V"))
                    else "CHINA" if sym.endswith((".SS", ".SZ"))
                    else "EU" if sym.endswith((".L", ".DE", ".PA", ".AS", ".BR", ".MI"))
                    else "USA"
                )
                curr = "GBp" if sym.endswith(".L") else REGION_DEFAULT_CURRENCY.get(reg, "USD")
                local_hits.append({
                    "symbol": sym,
                    "name": item.get("shortname") or item.get("longname") or sym,
                    "region": reg,
                    "exchange": item.get("exchDisp") or item.get("exchange") or "MKT",
                    "category": "etfs" if item.get("quoteType") == "ETF" else "indices" if item.get("quoteType") == "INDEX" else "stocks",
                    "currency": curr,
                    "price": 0.0,
                    "change_percent": 0.0,
                })
    except Exception:
        pass
    return local_hits[:30]


@app.get("/api/quote/{symbol}")
def get_quote(symbol: str):
    meta = UNIVERSE.get_by_symbol(symbol)
    if not meta:
        reg = (
            "IND" if symbol.endswith((".NS", ".BO"))
            else "CANADA" if symbol.endswith((".TO", ".V"))
            else "CHINA" if symbol.endswith((".SS", ".SZ"))
            else "EU" if symbol.endswith((".L", ".DE", ".PA", ".AS", ".BR", ".MI"))
            else "USA"
        )
        curr = "GBp" if symbol.endswith(".L") else REGION_DEFAULT_CURRENCY.get(reg, "USD")
        meta = {"symbol": symbol, "name": symbol, "region": reg, "exchange": "Market", "category": "stocks", "currency": curr, "isin": ""}
        UNIVERSE._upsert_records([{**meta, "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": ""}])

    with PRICE_LOCK:
        quote = LIVE_PRICES.get(symbol)
    if not quote or quote.get("price", 0) <= 0:
        quote = GF_ENGINE.fetch_quote_with_fallback(symbol, exchange_hint=meta.get("exchange"))
        if not quote and float(meta.get("price") or 0) > 0:
            quote = {
                "symbol": symbol,
                "name": meta.get("name", symbol),
                "exchange": meta.get("exchange", "Exchange"),
                "currency": meta.get("currency", "USD"),
                "price": float(meta["price"]),
                "prev_close": float(meta.get("prev_close") or meta["price"]),
                "change": float(meta.get("change") or 0.0),
                "change_percent": float(meta.get("change_percent") or 0.0),
                "volume": int(meta.get("volume") or 0),
                "as_of": meta.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "timestamp": int(time.time()),
                "source": "Exchange Master Feed",
            }
        if quote:
            with PRICE_LOCK:
                LIVE_PRICES[symbol] = quote
            UNIVERSE.update_quotes({symbol: quote})

    if not quote:
        raise HTTPException(status_code=404, detail=f"Live Google Finance / exchange quote unavailable for {symbol}")

    px = float(quote.get("price") or 0.0)
    spread = round(max(0.01, px * 0.0002), 4 if px < 10 else 2)
    return {
        **meta,
        **quote,
        "bid": quote.get("bid", round(px - spread, 4 if px < 10 else 2)),
        "ask": quote.get("ask", round(px + spread, 4 if px < 10 else 2)),
        "country": meta.get("region", "USA"),
    }


def _dedupe_asc_bars(bars: list[dict]) -> list[dict]:
    by_time: dict[str, tuple[float | str, dict]] = {}
    for b in bars:
        t = b.get("time")
        if t is None:
            continue
        sort_key: float | str = float(t) if isinstance(t, (int, float)) else str(t)
        by_time[str(t)] = (sort_key, b)
    return [pair[1] for pair in sorted(by_time.values(), key=lambda x: (0, x[0]) if isinstance(x[0], float) else (1, x[0]))]


@app.get("/api/history/{symbol}")
def get_history(symbol: str, interval: str = "1d", period: str = "1mo", style: str = "candles"):
    bars = _dedupe_asc_bars(_load_candles(symbol, interval=interval, period=period))
    if style == "heikin_ashi":
        return _dedupe_asc_bars(_to_heikin_ashi(bars))
    if style == "renko":
        return _dedupe_asc_bars(_to_renko(bars))
    return bars


@app.get("/api/ticks/{symbol}")
def get_custom_bars(symbol: str, interval: str = "5s"):
    return TICK_AGGREGATOR.get_bars(symbol, interval, include_footprint=True)


# -------------------------------------------------------------
# LIVE GOOGLE NEWS STREAMING ENDPOINT
# -------------------------------------------------------------
@app.get("/api/news/{symbol}")
async def get_symbol_news(symbol: str, limit: int = 20):
    meta = UNIVERSE.get_by_symbol(symbol)
    company_name = meta.get("name") if meta else symbol
    region = meta.get("region") if meta else (
        "IND" if symbol.endswith((".NS", ".BO"))
        else "CANADA" if symbol.endswith((".TO", ".V"))
        else "CHINA" if symbol.endswith((".SS", ".SZ"))
        else "EU" if symbol.endswith((".L", ".DE", ".PA", ".AS", ".BR", ".MI"))
        else "USA"
    )
    articles = await NEWS_ENGINE.fetch_symbol_news(symbol, company_name=company_name, region=region, limit=min(limit, 25))
    return {"symbol": symbol, "region": region, "count": len(articles), "articles": articles}


# -------------------------------------------------------------
# SYMBOL OVERVIEW, FUNDAMENTALS & EVENTS (Google Finance 24h Cached)
# -------------------------------------------------------------
@app.get("/api/asset/{symbol}/overview")
def asset_overview(symbol: str):
    meta = UNIVERSE.get_by_symbol(symbol)
    with PRICE_LOCK:
        q = LIVE_PRICES.get(symbol)
    if not q or q.get("price", 0) <= 0:
        q = GF_ENGINE.fetch_quote_with_fallback(symbol, exchange_hint=meta.get("exchange") if meta else None)
    return get_asset_overview(GF_ENGINE, symbol, universe_meta=meta, live_quote=q)


@app.get("/api/asset/{symbol}/financials")
def asset_financials(symbol: str, period: str = "annual"):
    meta = UNIVERSE.get_by_symbol(symbol)
    return get_asset_financials(GF_ENGINE, symbol, period=period, exchange_hint=meta.get("exchange") if meta else None)


@app.get("/api/asset/{symbol}/events")
def asset_events(symbol: str):
    meta = UNIVERSE.get_by_symbol(symbol)
    return get_asset_events(GF_ENGINE, symbol, exchange_hint=meta.get("exchange") if meta else None)


# -------------------------------------------------------------
# QUANT INDICATORS (55+), CHAINED CALCULATIONS & ORDER FLOW SUITE
# -------------------------------------------------------------
@app.get("/api/indicators/catalog")
def get_indicator_catalog():
    return {"total": len(INDICATOR_CATALOG), "indicators": INDICATOR_CATALOG}


class IndicatorChainRequest(BaseModel):
    symbol: str
    interval: str = "1d"
    period: str = "3mo"
    chain: List[dict]


@app.post("/api/indicators/compute")
def compute_indicators_endpoint(req: IndicatorChainRequest):
    bars = _load_candles(req.symbol, interval=req.interval, period=req.period)
    series = compute_chained_indicator(bars, req.chain)
    patterns = detect_patterns(bars)
    expected_move = compute_expected_move(bars, horizon_bars=10)
    return {"symbol": req.symbol, "chain": req.chain, "series": series, "patterns": patterns, "expected_move": expected_move}


@app.get("/api/orderflow/{symbol}")
def get_order_flow(symbol: str, interval: str = "15m", period: str = "5d"):
    bars = _load_candles(symbol, interval=interval, period=period)
    return {
        "symbol": symbol,
        "interval": interval,
        "volume_profile": compute_volume_profile(bars, num_bins=24),
        "tpo_profile": compute_tpo_profile(bars, num_bins=20),
        "footprint": compute_volume_footprint(bars, levels_per_bar=6),
    }


@app.post("/api/screener/scan")
def screener_scan(query: ScreenerQuery):
    return run_columnar_scan(UNIVERSE, query)


class AlertCreateRequest(BaseModel):
    symbol: str
    condition: ConditionType
    threshold: float
    note: str = ""


# -------------------------------------------------------------
# MULTI-TENANT JWT AUTHENTICATION & USER PREFERENCES
# -------------------------------------------------------------
class AuthCredentials(BaseModel):
    email: str
    password: str
    base_currency: str = "USD"
    theme_preference: str = "light"


class PreferencesPatch(BaseModel):
    base_currency: Optional[str] = None
    theme_preference: Optional[str] = None


def _user_payload(user: UserModel, access_token: Optional[str] = None) -> dict:
    data = {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "base_currency": user.base_currency,
        "theme_preference": user.theme_preference,
        "is_guest": user.is_guest,
    }
    if access_token:
        data["access_token"] = access_token
    return data


@app.post("/api/auth/register")
def register_user(req: AuthCredentials, request: Request, response: Response, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    if "@" not in email or len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Valid email and password (min 6 chars) required.")
    if db.scalar(select(UserModel).where(UserModel.email == email)):
        raise HTTPException(status_code=409, detail="Email is already registered.")
    user = create_user_account(
        db,
        email=email,
        password=req.password,
        base_currency=req.base_currency,
        theme_preference=req.theme_preference,
        is_guest=False,
    )
    tokens = issue_session_tokens(db, user, request, response)
    return _user_payload(user, tokens["access_token"])


@app.post("/api/auth/login")
def login_user(req: AuthCredentials, request: Request, response: Response, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    user = db.scalar(select(UserModel).where(UserModel.email == email))
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    tokens = issue_session_tokens(db, user, request, response)
    return _user_payload(user, tokens["access_token"])


@app.post("/api/auth/refresh")
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    rotated = rotate_refresh_token(db, raw, request, response)
    if not rotated:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user, access_tok = rotated
    return _user_payload(user, access_tok)


@app.post("/api/auth/logout")
def logout_user(request: Request, response: Response, db: Session = Depends(get_db)):
    clear_session_cookies(request, response)
    guest = create_user_account(
        db,
        email=f"guest-{uuid.uuid4().hex[:10]}@agam.local",
        password=uuid.uuid4().hex,
        is_guest=True,
    )
    tokens = issue_session_tokens(db, guest, request, response)
    return {"status": "LOGGED_OUT", "user": _user_payload(guest, tokens["access_token"])}


@app.get("/api/auth/me")
def get_me(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    existing = get_optional_user(request, db)
    tok = None if existing else issue_session_tokens(db, current_user, request, response)["access_token"]
    return _user_payload(current_user, tok)


@app.patch("/api/auth/preferences")
def update_preferences(
    patch: PreferencesPatch,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    if patch.base_currency:
        current_user.base_currency = patch.base_currency
    if patch.theme_preference in ("light", "dark"):
        current_user.theme_preference = patch.theme_preference
    db.commit()
    return _user_payload(current_user)


# -------------------------------------------------------------
# MULTI-TENANT ALERTS (WHERE user_id = current_user.id)
# -------------------------------------------------------------
@app.get("/api/alerts")
def get_alerts(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    return list_user_alerts(db, current_user.id, ALERTS.backend_mode, ALERTS.triggered_log)


@app.post("/api/alerts")
def create_alert(
    req: AlertCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    rule_id = f"alr-{uuid.uuid4().hex[:10]}"
    row = UserAlertModel(
        id=rule_id,
        user_id=current_user.id,
        symbol=req.symbol.upper(),
        condition=req.condition,
        target_value=float(req.threshold),
        note=req.note,
        is_active=True,
    )
    db.add(row)
    db.commit()
    ALERT_USER_MAP[rule_id] = current_user.id
    rule = ALERTS.add_rule(row.symbol, req.condition, req.threshold, req.note, rule_id=rule_id)
    return {"status": "CREATED", "rule": rule}


@app.delete("/api/alerts/{rule_id}")
def delete_alert(
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    if not delete_user_alert(db, current_user.id, rule_id):
        raise HTTPException(status_code=404, detail="Alert rule not found")
    ALERT_USER_MAP.pop(rule_id, None)
    ALERTS.delete_rule(rule_id)
    return {"status": "DELETED", "rule_id": rule_id}


# -------------------------------------------------------------
# CLOUD-SYNCED CHART LAYOUTS, DRAWINGS & WATCHLISTS
# -------------------------------------------------------------
class LayoutSaveRequest(BaseModel):
    layout_name: str = "default"
    symbol: str = "RELIANCE.NS"
    grid_type: str = "1x1"
    drawings: list = []
    active_indicators: list = []


class WatchlistSaveRequest(BaseModel):
    name: str = "Primary"
    symbols: List[str] = []


@app.get("/api/user/layouts")
def fetch_layout(
    layout_name: str = "default",
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    return get_user_layout(db, current_user.id, layout_name)


@app.put("/api/user/layouts")
def store_layout(
    req: LayoutSaveRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    return save_user_layout(
        db,
        current_user.id,
        req.layout_name,
        req.symbol,
        req.grid_type,
        req.drawings,
        req.active_indicators,
    )


@app.get("/api/user/watchlists")
def fetch_watchlists(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    return get_user_watchlists(db, current_user.id)


@app.put("/api/user/watchlists")
def store_watchlist(
    req: WatchlistSaveRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    return upsert_user_watchlist(db, current_user.id, req.name, req.symbols)


# -------------------------------------------------------------
# EXPORT CAPABILITIES (Trade History & OHLCV CSV)
# -------------------------------------------------------------
@app.get("/api/export/trades.csv")
def export_trades_csv(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    orders = db.scalars(
        select(OrderModel).where(OrderModel.user_id == current_user.id).order_by(OrderModel.created_at.desc())
    ).all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["OrderID", "Symbol", "Side", "Mode", "Status", "Qty", "Price", "Currency", "Charges", "Timestamp"])
    for o in orders:
        writer.writerow([o.id, o.symbol, o.side, o.order_mode, o.status, o.qty, o.price or o.limit_price, o.currency, o.charges, o.created_at.isoformat()])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=agam_trade_history.csv"},
    )


@app.get("/api/export/history/{symbol}.csv")
def export_history_csv(symbol: str, interval: str = "1d", period: str = "3mo"):
    bars = _dedupe_asc_bars(_load_candles(symbol, interval=interval, period=period))
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Time", "Open", "High", "Low", "Close", "Volume"])
    for b in bars:
        writer.writerow([b["time"], b["open"], b["high"], b["low"], b["close"], b.get("volume", 0)])
    buf.seek(0)
    safe_sym = symbol.replace("^", "").replace("/", "_")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={safe_sym}_{interval}_{period}.csv"},
    )


class ReplayStartRequest(BaseModel):
    symbol: str
    interval: str = "1d"
    period: str = "6mo"
    start_ratio: float = 0.5
    initial_cash: float = 100000.0


class ReplayTradeRequest(BaseModel):
    side: str
    quantity: int


@app.post("/api/replay/start")
def start_replay(req: ReplayStartRequest):
    bars = _load_candles(req.symbol, interval=req.interval, period=req.period)
    meta = UNIVERSE.get_by_symbol(req.symbol)
    curr = meta["currency"] if meta else "USD"
    replay_cash = req.initial_cash if req.initial_cash != 100000.0 else DEFAULT_WALLETS.get(curr, 100000.0)
    return REPLAY.start_session(req.symbol, req.interval, curr, bars, req.start_ratio, replay_cash).snapshot()


@app.post("/api/replay/{session_id}/step")
def step_replay(session_id: str, delta: int = 1):
    try:
        return REPLAY.step(session_id, delta).snapshot()
    except KeyError:
        raise HTTPException(status_code=404, detail="Replay session not found")


@app.post("/api/replay/{session_id}/trade")
def trade_replay(session_id: str, req: ReplayTradeRequest):
    try:
        return REPLAY.place_isolated_trade(session_id, req.side, req.quantity).snapshot()
    except KeyError:
        raise HTTPException(status_code=404, detail="Replay session not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/replay/{session_id}")
def get_replay(session_id: str):
    sess = REPLAY.get_session(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Replay session not found")
    return sess.snapshot()


@app.get("/api/ipos")
def get_ipos(country: Optional[str] = None):
    all_ipos = fetch_live_ipos()
    region_map = {"IN": "IND", "US": "USA"}
    target = region_map.get(country or "", country)
    if target and target != "ALL":
        filtered = [ipo for ipo in all_ipos if ipo["country"] == target]
        return filtered if filtered else all_ipos
    return all_ipos


@app.get("/api/macro")
def get_macro():
    return fetch_live_macro()


@app.get("/api/expiries/{symbol}")
def get_expiries(symbol: str):
    return fetch_live_expiries(symbol)


@app.get("/api/portfolio")
def get_portfolio(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    return TenantPortfolioService.get_snapshot(db, current_user.id, LIVE_PRICES)


class OrderRequest(BaseModel):
    symbol: str
    quantity: int
    order_type: str
    order_mode: str
    price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


@app.post("/api/orders/place")
def place_order(
    order: OrderRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    meta = UNIVERSE.get_by_symbol(order.symbol)
    curr = meta["currency"] if meta else "USD"
    name = meta["name"] if meta else order.symbol

    with PRICE_LOCK:
        quote = LIVE_PRICES.get(order.symbol)
    if not quote or quote.get("price", 0) <= 0:
        quote = GF_ENGINE.fetch_quote_with_fallback(order.symbol, exchange_hint=meta.get("exchange") if meta else None)
    if not quote:
        raise HTTPException(status_code=404, detail=f"Live quote unavailable for {order.symbol}")

    try:
        res = TenantPortfolioService.place_order(
            db=db,
            user_id=current_user.id,
            symbol=order.symbol,
            name=name,
            currency=curr,
            quantity=order.quantity,
            order_type=order.order_type,
            order_mode=order.order_mode,
            live_price=float(quote["price"]),
            limit_price=order.price,
            stop_loss=order.stop_loss,
            take_profit=order.take_profit,
        )
        WS_HUB.schedule_user_event(MAIN_EVENT_LOOP, current_user.id, {"type": "PORTFOLIO_UPDATE", **res})
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/orders/{order_id}")
def cancel_pending_order(
    order_id: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    if not TenantPortfolioService.cancel_pending_order(db, current_user.id, order_id):
        raise HTTPException(status_code=404, detail="Pending order not found")
    return {"status": "CANCELLED", "order_id": order_id}


@app.post("/api/portfolio/reset")
def reset_portfolio(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_or_provision_workspace_user),
):
    TenantPortfolioService.reset_user_portfolio(db, current_user.id)
    WS_HUB.schedule_user_event(MAIN_EVENT_LOOP, current_user.id, {"type": "PORTFOLIO_RESET"})
    return {"status": "SUCCESS", "message": "Virtual multi-currency wallets & positions reset!"}


# -------------------------------------------------------------
# REAL-TIME WEBSOCKETS (/ws/live, /ws/market/{symbol}, /ws/user/{user_id})
# -------------------------------------------------------------
@app.websocket("/ws/market/{symbol}")
async def websocket_market_symbol(websocket: WebSocket, symbol: str):
    await WS_HUB.connect_market(symbol, websocket)
    try:
        while True:
            with PRICE_LOCK:
                quote = LIVE_PRICES.get(symbol)
            if quote:
                await websocket.send_json({"type": "TICK", **quote})
            await asyncio.sleep(1.5)
    except (WebSocketDisconnect, Exception):
        WS_HUB.disconnect_market(symbol, websocket)


@app.websocket("/ws/user/{user_id}")
async def websocket_user_stream(websocket: WebSocket, user_id: str):
    token = websocket.cookies.get("agam_access") or websocket.query_params.get("token")
    payload = decode_access_token(token) if token else None
    if payload and payload.get("sub") != user_id:
        await websocket.close(code=1008)
        return
    await WS_HUB.connect_user(user_id, websocket)
    try:
        while True:
            await asyncio.sleep(20)
            await websocket.send_json({"type": "PING", "user_id": user_id})
    except (WebSocketDisconnect, Exception):
        WS_HUB.disconnect_user(user_id, websocket)


@app.websocket("/ws/live")
async def websocket_live_feed(websocket: WebSocket):
    await websocket.accept()
    primary_symbol = "RELIANCE.NS"
    last_news_poll = 0.0
    try:
        while True:
            try:
                while True:
                    msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                    data = json.loads(msg)
                    if "symbol" in data and data["symbol"]:
                        primary_symbol = data["symbol"]
            except asyncio.TimeoutError:
                pass

            with PRICE_LOCK:
                quote = LIVE_PRICES.get(primary_symbol)
                all_prices = {
                    k: {"price": v["price"], "change": v["change"], "change_percent": v["change_percent"]}
                    for k, v in LIVE_PRICES.items()
                }

            if quote:
                await websocket.send_json({
                    "type": "TICK",
                    "symbol": primary_symbol,
                    "price": quote["price"],
                    "change": quote["change"],
                    "change_percent": quote["change_percent"],
                    "as_of": quote.get("as_of", ""),
                    "timestamp": quote["timestamp"],
                    "all_prices": all_prices,
                })

            now = time.time()
            if (now - last_news_poll) >= 30.0:
                last_news_poll = now
                meta = UNIVERSE.get_by_symbol(primary_symbol)
                fresh_news = await NEWS_ENGINE.poll_new_headlines(
                    primary_symbol,
                    company_name=meta.get("name") if meta else primary_symbol,
                    region=meta.get("region") if meta else "USA",
                )
                for art in fresh_news[:3]:
                    await websocket.send_json({
                        "type": "NEWS_ALERT",
                        "symbol": primary_symbol,
                        "article": art,
                    })

            await asyncio.sleep(1.5)
    except (WebSocketDisconnect, Exception):
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
