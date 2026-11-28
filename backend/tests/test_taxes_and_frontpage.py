from __future__ import annotations

import os
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

# Isolate ALL test writes into a temporary SQLite database before importing backend modules
_TMP_DB = tempfile.NamedTemporaryFile(prefix="agam_qa_isolated_", suffix=".db", delete=False)
_TMP_DB_PATH = _TMP_DB.name
_TMP_DB.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB_PATH}"

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

import main  # noqa: E402
from core.database import SessionLocal, engine, init_db  # noqa: E402
from core.models import WalletModel  # noqa: E402
from core.tax_brokerage import RATE_SYNC, calculate_order_charges  # noqa: E402
from core.tenant_store import TenantPortfolioService  # noqa: E402


def _seed_test_prices() -> None:
    with main.PRICE_LOCK:
        main.LIVE_PRICES["RELIANCE.NS"] = {
            "symbol": "RELIANCE.NS", "name": "Reliance Industries Ltd", "exchange": "NSE",
            "currency": "INR", "price": 1400.0, "prev_close": 1390.0,
            "change": 10.0, "change_percent": 0.72, "volume": 5000000, "timestamp": "10:15:00 UTC",
        }
        main.LIVE_PRICES["AAPL"] = {
            "symbol": "AAPL", "name": "Apple Inc", "exchange": "NASDAQ",
            "currency": "USD", "price": 230.0, "prev_close": 228.0,
            "change": 2.0, "change_percent": 0.88, "volume": 40000000, "timestamp": "10:15:00 UTC",
        }


def test_country_and_asset_class_tax_and_brokerage() -> None:
    # 1. India NSE Delivery Stocks vs ETF vs G-Sec Bond vs Forex vs MCX Commodities
    in_buy = calculate_order_charges("RELIANCE.NS", 10, 1400.0, "BUY", "DELIVERY", "DISCOUNT", category="stocks")
    assert in_buy.country == "IND"
    assert in_buy.brokerage == 0.0
    assert in_buy.stt_or_ftt == 14.0
    assert in_buy.stamp_duty == 2.1
    assert in_buy.dp_or_clearing_fee == 0.0

    in_sell = calculate_order_charges("RELIANCE.NS", 10, 1450.0, "SELL", "DELIVERY", "DISCOUNT", category="stocks")
    assert in_sell.stt_or_ftt == 14.5
    assert in_sell.dp_or_clearing_fee == 15.93

    in_etf_sell = calculate_order_charges("NIFTYBEES.NS", 100, 250.0, "SELL", "DELIVERY", "DISCOUNT", category="etfs")
    assert in_etf_sell.stt_or_ftt == 0.25  # 0.001% ETF sell STT

    in_bond_sell = calculate_order_charges("718GS2033.NS", 100, 102.0, "SELL", "DELIVERY", "DISCOUNT", exchange="NSE-DEBT", category="bonds")
    assert in_bond_sell.stt_or_ftt == 0.0
    assert in_bond_sell.dp_or_clearing_fee == 0.0

    in_fx_buy = calculate_order_charges("USDINR=X", 1000, 84.5, "BUY", "INTRADAY", "DISCOUNT", exchange="NSE-FX", category="forex")
    assert in_fx_buy.stt_or_ftt == 0.0
    assert in_fx_buy.leverage == 5.0

    in_mcx_sell = calculate_order_charges("CRUDEOIL", 1, 60000.0, "SELL", "FUTURES", "DISCOUNT", region="IND", exchange="MCX", category="commodities")
    assert in_mcx_sell.stt_or_ftt == 6.0  # 0.01% MCX CTT
    assert in_mcx_sell.brokerage == 20.0

    in_mis = calculate_order_charges("RELIANCE.NS", 100, 1400.0, "SELL", "INTRADAY", "DISCOUNT", category="stocks")
    assert in_mis.leverage == 5.0
    assert in_mis.margin_required == 28000.0
    assert in_mis.brokerage == 20.0
    assert in_mis.stt_or_ftt == 35.0

    # 2. USA: Stocks vs Options vs CME Futures vs Forex vs Bonds
    us_sell = calculate_order_charges("AAPL", 100, 250.0, "SELL", "DELIVERY", "DISCOUNT", category="stocks")
    assert us_sell.country == "USA"
    assert us_sell.brokerage == 0.0
    taf_rate, _ = RATE_SYNC.effective_us_finra_taf_rate(date(2026, 11, 27))
    assert taf_rate == 0.0
    assert us_sell.regulator_fee == 0.52

    us_opt = calculate_order_charges("AAPL", 2, 12.5, "BUY", "OPTIONS", "DISCOUNT", category="stocks")
    assert us_opt.brokerage == 1.30  # $0.65 x 2 contracts
    assert us_opt.exchange_fee == 0.04  # OCC $0.02 x 2
    assert us_opt.regulator_fee >= 0.06  # ORF $0.029 x 2

    us_fut = calculate_order_charges("GC=F", 2, 2650.0, "BUY", "FUTURES", "DISCOUNT", category="commodities")
    assert us_fut.brokerage == 2.50
    assert us_fut.exchange_fee == 2.76
    assert us_fut.regulator_fee == 0.04

    us_fx = calculate_order_charges("EURUSD=X", 10000, 1.08, "BUY", "DELIVERY", "DISCOUNT", category="forex")
    assert us_fx.regulator_fee == 0.0 and us_fx.dp_or_clearing_fee == 0.0

    # 3. Canada TSX & China SSE/SZSE (Stocks 0.05% stamp vs ETFs 0% stamp)
    ca_buy = calculate_order_charges("SHOP.TO", 10, 140.0, "BUY", "DELIVERY", "DISCOUNT", category="stocks")
    assert ca_buy.country == "CANADA" and ca_buy.brokerage == 4.95 and ca_buy.gst_vat == 0.25

    cn_stock_sell = calculate_order_charges("600519.SS", 100, 1500.0, "SELL", "DELIVERY", "DISCOUNT", category="stocks")
    cn_etf_sell = calculate_order_charges("510300.SS", 1000, 4.0, "SELL", "DELIVERY", "DISCOUNT", category="etfs")
    assert cn_stock_sell.stamp_duty == 75.0
    assert cn_etf_sell.stamp_duty == 0.0

    # 4. Europe & UK sub-jurisdictions (Stocks vs ETFs exemptions)
    uk_buy = calculate_order_charges("SHEL.L", 100, 2600.0, "BUY", "DELIVERY", "DISCOUNT", category="stocks")
    uk_etf = calculate_order_charges("CSPX.L", 10, 600.0, "BUY", "DELIVERY", "DISCOUNT", currency="GBP", category="etfs")
    fr_buy = calculate_order_charges("MC.PA", 10, 620.0, "BUY", "DELIVERY", "DISCOUNT", category="stocks")
    fr_etf = calculate_order_charges("CAC.PA", 10, 100.0, "BUY", "DELIVERY", "DISCOUNT", category="etfs")
    be_stock = calculate_order_charges("ABI.BR", 10, 60.0, "BUY", "DELIVERY", "DISCOUNT", category="stocks")
    be_etf = calculate_order_charges("ETFB.BR", 10, 100.0, "BUY", "DELIVERY", "DISCOUNT", category="etfs")
    assert uk_buy.sub_jurisdiction == "UK_LSE" and uk_buy.stt_or_ftt == 1300.0
    assert uk_etf.stt_or_ftt == 0.0
    assert fr_buy.sub_jurisdiction == "FR_EURONEXT" and fr_buy.stt_or_ftt == 24.8
    assert fr_etf.stt_or_ftt == 0.0
    assert be_stock.stt_or_ftt == 2.1 and be_etf.stt_or_ftt == 1.2


def test_middleware_multi_user_profiles_no_reset_and_trading() -> None:
    init_db()
    main._BG_STARTED = True
    with TestClient(main.app) as client:
        _seed_test_prices()

        # 1. Middleware security headers, telemetry & auth gates
        health = client.get("/api/health")
        assert health.status_code == 200
        assert "X-Process-Time-Ms" in health.headers
        assert float(health.headers["X-Process-Time-Ms"]) < 500.0
        assert health.headers.get("X-Content-Type-Options") == "nosniff"
        assert health.headers.get("X-Frame-Options") == "SAMEORIGIN"
        assert health.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"

        for protected_path in ("/api/auth/me", "/api/portfolio", "/api/activity", "/api/alerts"):
            assert client.get(protected_path).status_code == 401

        ws_rejected = False
        try:
            with client.websocket_connect("/ws/user/fake-user-id") as ws:
                ws.receive_text()
        except Exception:
            ws_rejected = True
        assert ws_rejected

        st0 = client.get("/api/auth/status").json()
        assert st0["initialized"] is False and st0["multi_profile_mode"] is True

        # 2. Register User 1 (disclaimer required) & User 2 (multi-user PC support)
        u1_email = "owner@agam.pc"
        u2_email = "partner@agam.pc"
        assert client.post("/api/auth/register", json={
            "email": u1_email, "password": "StrongPassword1", "display_name": "Anirudh",
            "base_currency": "INR", "accepted_disclaimer": False,
        }).status_code == 400

        reg1 = client.post("/api/auth/register", json={
            "email": u1_email, "password": "StrongPassword1", "display_name": "Anirudh",
            "base_currency": "INR", "accepted_disclaimer": True,
        })
        assert reg1.status_code == 200
        u1_id = reg1.json()["id"]
        assert reg1.json()["role"] == "owner"

        # Register User 2 on the same PC (must succeed & isolate from User 1!)
        reg2 = client.post("/api/auth/register", json={
            "email": u2_email, "password": "PartnerPassword2", "display_name": "Partner",
            "base_currency": "USD", "accepted_disclaimer": True,
        })
        assert reg2.status_code == 200, reg2.text
        assert reg2.json()["role"] == "trader"

        st2 = client.get("/api/auth/status").json()
        assert st2["profile_count"] == 2
        assert len(st2["profiles"]) == 2

        # Wrong password cannot remove another user profile
        assert client.post("/api/auth/delete-account", json={"email": u2_email, "password": "WrongPassword"}).status_code == 401
        # Delete User 2 cleanly using User 2's password
        del2 = client.post("/api/auth/delete-account", json={"email": u2_email, "password": "PartnerPassword2"})
        assert del2.status_code == 200 and del2.json()["status"] == "DELETED"
        assert client.get("/api/auth/status").json()["profile_count"] == 1

        # Brute-force rate limit (429) on bad attempts + Switch back to User 1
        assert client.get("/api/portfolio").status_code == 401
        for _ in range(10):
            assert client.post("/api/auth/login", json={"email": "bruteforce@agam.test", "password": "WrongPassword"}).status_code == 401
        assert client.post("/api/auth/login", json={"email": "bruteforce@agam.test", "password": "WrongPassword"}).status_code == 429

        assert client.post("/api/auth/login", json={"email": u1_email, "password": "StrongPassword1"}).status_code == 200

        # 3. Wallet reset MUST still be blocked (HTTP 403)
        assert client.post("/api/portfolio/reset", json={"country": "ALL"}).status_code == 403
        try:
            with SessionLocal() as db:
                TenantPortfolioService.reset_user_portfolio(db, u1_id)
            raise AssertionError("Expected PermissionError on direct reset")
        except PermissionError:
            pass

        # 4. Orders, TSL, pending modification, low-capital warnings & activity log
        o1 = client.post("/api/orders/place", json={
            "symbol": "RELIANCE.NS", "quantity": 20, "order_type": "BUY",
            "order_mode": "MARKET", "product_type": "INTRADAY", "trailing_sl": 15.0,
        })
        assert o1.status_code == 200 and o1.json()["charges_breakdown"]["leverage"] == 5.0

        p1 = client.post("/api/orders/place", json={
            "symbol": "AAPL", "quantity": 5, "order_type": "BUY",
            "order_mode": "LIMIT", "product_type": "DELIVERY", "price": 220.0,
        })
        assert p1.status_code == 200
        pnd_id = p1.json()["order"]["id"]
        assert client.patch(f"/api/orders/{pnd_id}", json={"limit_price": 225.0, "quantity": 4}).status_code == 200

        with main.PRICE_LOCK:
            main.LIVE_PRICES["AAPL"]["price"] = 224.0
            main.LIVE_PRICES["RELIANCE.NS"]["price"] = 1440.0
        with SessionLocal() as db:
            TenantPortfolioService.evaluate_all_pending_and_stops(db, main.LIVE_PRICES)

        t0 = time.perf_counter()
        pf_res = client.get("/api/portfolio")
        assert pf_res.status_code == 200 and (time.perf_counter() - t0) * 1000.0 < 250.0
        pf = pf_res.json()
        assert len(pf["orders_history"]) == 2
        assert next(p for p in pf["positions"] if p["symbol"] == "RELIANCE.NS")["stop_loss"] == 1425.0

        # Spend down USD cash to trigger low-capital warning
        assert client.post("/api/orders/place", json={
            "symbol": "AAPL", "quantity": 360, "order_type": "BUY",
            "order_mode": "MARKET", "product_type": "DELIVERY",
        }).status_code == 200
        pf_warn = client.get("/api/portfolio").json()
        assert pf_warn["capital_health"]["USD"]["status"] in ("WARNING", "CRITICAL", "EXHAUSTED")
        assert pf_warn["capital_health"]["USD"]["cash_pct"] < 30.0

        with SessionLocal() as db:
            w_cad = db.scalar(select(WalletModel).where(WalletModel.user_id == u1_id, WalletModel.currency == "CAD"))
            assert w_cad is not None
            w_cad.balance = 4000.0
            db.commit()
        assert client.get("/api/portfolio").json()["capital_health"]["CAD"]["status"] == "EXHAUSTED"

        # Rejected order, Square-off India, Layout, Alert, Feed & Audit Log check
        assert client.post("/api/orders/place", json={
            "symbol": "RELIANCE.NS", "quantity": 999999, "order_type": "BUY",
            "order_mode": "MARKET", "product_type": "DELIVERY",
        }).status_code == 400
        assert client.post("/api/positions/square-off-all", json={"country": "IND"}).json()["closed_count"] == 1

        assert client.put("/api/user/layouts", json={
            "layout_name": "default", "symbol": "AAPL", "grid_type": "1x1", "drawings": [{"id": "d1"}], "active_indicators": [],
        }).status_code == 200
        assert client.post("/api/alerts", json={"symbol": "AAPL", "condition": "PRICE_ABOVE", "threshold": 250.0, "note": "Breakout"}).status_code == 200
        assert client.post("/api/feed/ideas", json={
            "symbol": "RELIANCE.NS", "direction": "BULLISH", "product_type": "INTRADAY", "thesis": "VWAP breakout",
        }).status_code == 200

        actions_seen = {a["action"] for a in client.get("/api/activity?limit=100").json()["logs"]}
        for expected in ("SIGNUP", "LOGIN", "BLOCKED_RESET_ATTEMPT", "ORDER_SUCCESS", "ORDER_PENDING", "ORDER_REJECTED", "SQUARE_OFF_ALL", "SAVE_LAYOUT", "CREATE_ALERT", "PUBLISH_IDEA"):
            assert expected in actions_seen, f"Missing activity audit log action: {expected}"


def test_crypto_and_forex_complete_market():
    """Verify Crypto & Forex fee models, USD FX settlement, precision, screener, sessions, and fractional HTTP orders."""
    import uuid
    from core.tax_brokerage import (
        calculate_order_charges,
        compute_fx_quote_to_settle,
        infer_country_and_sub,
    )
    from core.screener_engine import ScreenerQuery, run_columnar_scan
    from engine.google_finance import is_forex_symbol, smart_price_decimals
    from main import UNIVERSE, app, app

    # 1. Precision & classification helpers
    assert smart_price_decimals(0.0000185, is_forex_symbol("SHIB-USD")) == 8
    assert smart_price_decimals(1.08543, is_forex_symbol("EURUSD=X")) == 5
    assert smart_price_decimals(150.123, is_forex_symbol("USDJPY=X")) == 3
    assert smart_price_decimals(92450.25, is_forex_symbol("BTC-USD")) == 2

    c_country, c_sub, c_exch = infer_country_and_sub("BTC-USD", region="CRYPTO", exchange="BINANCE", currency="USD")
    assert c_country == "CRYPTO" and c_sub == "CRYPTO_EXCHANGE" and c_exch == "BINANCE", (c_country, c_sub, c_exch)
    f_country, f_sub, f_exch = infer_country_and_sub("USDJPY=X", region="FOREX", exchange="FX", currency="USD")
    assert f_country == "FOREX" and f_sub == "FX_OTC" and f_exch == "FX", (f_country, f_sub, f_exch)
    eu_fx_c, eu_fx_s, _ = infer_country_and_sub("EURUSD=X", region="EU", exchange="FOREX", currency="USD")
    assert eu_fx_c == "FOREX" and eu_fx_s == "FX_OTC", (eu_fx_c, eu_fx_s)
    us_fx_c, us_fx_s, _ = infer_country_and_sub("USDJPY=X", region="USA", exchange="FOREX", currency="USD")
    assert us_fx_c == "FOREX" and us_fx_s == "FX_OTC", (us_fx_c, us_fx_s)

    # 2. FX Quote -> Settlement conversion
    jpy_scale = compute_fx_quote_to_settle("USDJPY=X", "USD", 150.0, {"JPY": 150.0})
    assert abs(jpy_scale - (1.0 / 150.0)) < 1e-6, f"Unexpected USDJPY scale: {jpy_scale}"
    assert abs(compute_fx_quote_to_settle("EURUSD=X", "USD", 1.085, {}) - 1.0) < 1e-6

    # 3. Micro-cap Crypto breakeven precision & Spot/Perp fees
    shib_bd = calculate_order_charges(
        symbol="SHIB-USD",
        quantity=5_000_000,
        price=0.0000185,
        side="BUY",
        product_type="DELIVERY",
        broker_plan="DISCOUNT",
        region="CRYPTO",
        exchange="BINANCE",
        currency="USD",
        category="crypto",
    )
    assert shib_bd.currency == "USD"
    assert shib_bd.breakeven_delta > 0 and shib_bd.breakeven_delta < 0.0000185

    btc_perp_bd = calculate_order_charges(
        symbol="BTC-USD",
        quantity=0.5,
        price=90000.0,
        side="BUY",
        product_type="FUTURES",
        broker_plan="PRO",
        region="CRYPTO",
        exchange="BINANCE",
        currency="USD",
        category="crypto",
    )
    assert abs(btc_perp_bd.leverage - 20.0) < 1e-6
    assert abs(btc_perp_bd.margin_required - 2250.0) < 1.0

    # 4. Forex notional conversion in USD (10,000 USDJPY @ 150 -> $10k notional, $500 20x margin, NOT 1.5M JPY)
    fx_bd = calculate_order_charges(
        symbol="USDJPY=X",
        quantity=10_000,
        price=150.0,
        side="BUY",
        product_type="INTRADAY",
        broker_plan="DISCOUNT",
        region="FOREX",
        exchange="FX",
        currency="USD",
        category="forex",
        fx_quote_to_settle=jpy_scale,
    )
    assert fx_bd.currency == "USD"
    assert abs(fx_bd.notional - 10_000.0) < 1.0, f"FX notional should be ~$10,000 USD, got {fx_bd.notional}"
    assert abs(fx_bd.margin_required - 500.0) < 1.0, f"FX 20x margin should be ~$500 USD, got {fx_bd.margin_required}"
    assert fx_bd.total_charges == 0.0

    fx_pro = calculate_order_charges(
        symbol="USDJPY=X",
        quantity=10_000,
        price=150.0,
        side="BUY",
        product_type="INTRADAY",
        broker_plan="PRO",
        region="FOREX",
        exchange="FX",
        currency="USD",
        category="forex",
        fx_quote_to_settle=jpy_scale,
    )
    assert 0.30 <= fx_pro.total_charges <= 1.0, f"Unexpected FX PRO USD charges: {fx_pro.total_charges}"

    # 5. FastAPI endpoints, screener & fractional Crypto + Forex margin order execution
    with TestClient(app) as client:
        # Ensure BTC-USD & USDJPY=X exist deterministically in UNIVERSE even if offline
        seed_if_missing = []
        if not UNIVERSE.get_by_symbol("BTC-USD"):
            seed_if_missing.append({
                "symbol": "BTC-USD", "name": "Bitcoin / USD", "region": "CRYPTO",
                "exchange": "BINANCE", "category": "crypto", "currency": "USD",
                "isin": "CRYPTO_MAJOR", "price": 88000.0, "prev_close": 86000.0,
                "change": 2000.0, "change_percent": 2.33, "volume": 2_000_000_000.0,
                "rsi_14": 58.0, "as_of": "2026-11-28 00:00",
            })
        usdjpy_meta = UNIVERSE.get_by_symbol("USDJPY=X")
        if not usdjpy_meta or usdjpy_meta.get("region") != "FOREX":
            seed_if_missing.append({
                "symbol": "USDJPY=X", "name": "USD / JPY", "region": "FOREX",
                "exchange": "FOREX", "category": "forex", "currency": "USD",
                "isin": "FX_MAJOR", "price": 150.0, "prev_close": 149.5,
                "change": 0.5, "change_percent": 0.33, "volume": 10_000_000.0,
                "rsi_14": 52.0, "as_of": "2026-11-28 00:00",
            })
        if seed_if_missing:
            UNIVERSE._upsert_records(seed_if_missing)

        crypto_hits = run_columnar_scan(UNIVERSE, ScreenerQuery(region="CRYPTO", category="crypto", only_priced=False, limit=20))["results"]
        assert any(r["symbol"] == "BTC-USD" for r in crypto_hits)
        forex_hits = run_columnar_scan(UNIVERSE, ScreenerQuery(region="FOREX", category="forex", only_priced=False, limit=20))["results"]
        assert any(r["symbol"] == "USDJPY=X" for r in forex_hits)

        sess = client.get("/api/sessions").json()
        assert "CRYPTO" in sess and sess["CRYPTO"]["open"] is True and sess["CRYPTO"]["status"] == "24/7 LIVE"
        assert "FOREX" in sess

        rates = client.get("/api/charges/schedules").json()
        assert "CRYPTO" in rates["countries"] and "FOREX" in rates["countries"]

        prev = client.post("/api/charges/preview", json={
            "symbol": "BTC-USD", "quantity": 0.025, "price": 88000.0,
            "order_type": "BUY", "product_type": "DELIVERY", "broker_plan": "DISCOUNT", "category": "crypto",
        })
        assert prev.status_code == 200 and prev.json()["currency"] == "USD"

        email = f"cryptofx_{uuid.uuid4().hex[:8]}@example.com"
        su = client.post("/api/auth/register", json={
            "display_name": "CryptoFX Pro", "email": email, "password": "StrongPassword123!", "accepted_disclaimer": True,
        })
        assert su.status_code in (200, 201), su.text

        # Place fractional 0.025 BTC BUY
        b_res = client.post("/api/orders/place", json={
            "symbol": "BTC-USD", "quantity": 0.025, "order_type": "BUY",
            "order_mode": "MARKET", "product_type": "DELIVERY", "price": 88000.0,
        })
        assert b_res.status_code == 200, b_res.text

        # Partial sell 0.01 BTC
        s_res = client.post("/api/orders/place", json={
            "symbol": "BTC-USD", "quantity": 0.01, "order_type": "SELL",
            "order_mode": "MARKET", "product_type": "DELIVERY", "price": 90000.0,
        })
        assert s_res.status_code == 200, s_res.text

        port = client.get("/api/portfolio").json()
        btc_pos = [p for p in port["positions"] if p["symbol"] == "BTC-USD"]
        assert len(btc_pos) == 1 and abs(btc_pos[0]["quantity"] - 0.015) < 1e-6, btc_pos

        # Test FOREX mini lot (10000 USDJPY=X @ 20x INTRADAY) + square off all
        fx_res = client.post("/api/orders/place", json={
            "symbol": "USDJPY=X", "quantity": 10000, "order_type": "BUY",
            "order_mode": "MARKET", "product_type": "INTRADAY", "price": 150.0,
        })
        assert fx_res.status_code == 200, fx_res.text
        sq = client.post("/api/positions/square-off-all", json={})
        assert sq.status_code == 200 and sq.json()["closed_count"] >= 2


def test_advanced_institutional_features():
    """Verify micro-cap/FX quant precision, Bar Replay shorting & fractions, Backtester, Technicals, Ladder, Position Reverse & Risk Matrix."""
    import uuid
    from core.quant_engine import (
        compute_expected_move,
        compute_technical_scorecard,
        compute_tpo_profile,
        compute_volume_footprint,
        compute_volume_profile,
        run_strategy_backtest,
    )
    from core.replay_engine import IsolatedReplayEngine
    from core.tick_aggregator import Tick, TickAggregator, _price_bucket
    from main import UNIVERSE, app

    # 1. Micro-cap Crypto & FX precision across Quant & TickAggregator
    shib_bars = [
        {
            "time": f"2026-10-{i + 1:02d}",
            "open": 0.000018 + i * 1e-7,
            "high": 0.0000188 + i * 1e-7,
            "low": 0.0000175 + i * 1e-7,
            "close": 0.0000184 + i * 1e-7,
            "volume": 1_000_000 + i * 50_000,
        }
        for i in range(40)
    ]
    vp = compute_volume_profile(shib_bars)
    assert 0.0 < vp["poc"] < 0.0001, vp
    tpo = compute_tpo_profile(shib_bars)
    assert 0.0 < tpo["tpo_poc"] < 0.0001, tpo
    fp = compute_volume_footprint(shib_bars)
    assert 0.0 < fp[-1]["levels"][0]["price"] < 0.0001, fp[-1]
    em = compute_expected_move(shib_bars)
    assert 0.0 < em["upper_1sd"] < 0.0001, em

    assert _price_bucket(0.0000185) > 0.0
    assert abs(_price_bucket(1.09542) - 1.0955) < 0.001

    ta = TickAggregator()
    out_ticks = ta.ingest_tick(Tick(symbol="BTC-USD", price=60000.0, size=0.025, ts_ms=1_700_000_000_000), ["1m"])
    assert abs(out_ticks["1m"].volume - 0.025) < 1e-6

    # 2. Technical Scorecard + Pivot Points + Vectorized Strategy Backtester
    trend_bars = [
        {
            "time": f"2026-09-{i + 1:02d}",
            "open": 100.0 + i * 0.6,
            "high": 102.0 + i * 0.65,
            "low": 99.0 + i * 0.55,
            "close": 101.0 + i * 0.62,
            "volume": 50000 + i * 1000,
        }
        for i in range(60)
    ]
    sc = compute_technical_scorecard(trend_bars)
    assert sc["rating"] in ("BUY", "STRONG BUY", "NEUTRAL", "SELL", "STRONG SELL")
    assert sc["pivots"]["classic"]["R1"] > sc["pivots"]["classic"]["P"] > sc["pivots"]["classic"]["S1"]

    for strat in ("ema_cross", "supertrend", "rsi_reversion", "macd_momentum", "bb_breakout"):
        bt = run_strategy_backtest(trend_bars, strategy=strat, initial_capital=100000.0, fee_bps=5.0)
        assert "total_return_pct" in bt and bt["bars_tested"] == 60
        assert len(bt["equity_curve"]) == 60

    # 3. Replay Engine: Fractional BTC + SHORT selling + Cover + FX scaling
    re_eng = IsolatedReplayEngine()
    sess = re_eng.start_session("EURUSD=X", "1d", "USD", [
        {"time": f"2026-11-{i + 1:02d}", "open": 1.09, "high": 1.10, "low": 1.08, "close": 1.09 + (i * 0.0005)}
        for i in range(25)
    ], start_ratio=0.6, initial_cash=100000.0, fx_scale=1.0)
    snap = re_eng.place_isolated_trade(sess.session_id, "SELL", 10000.0).snapshot()
    assert snap["isolated_wallet"]["position_qty"] == -10000.0
    assert 1.0 < snap["isolated_wallet"]["avg_entry_price"] < 1.2
    re_eng.step(sess.session_id, 2)
    snap2 = re_eng.place_isolated_trade(sess.session_id, "BUY", 10000.0).snapshot()
    assert snap2["isolated_wallet"]["position_qty"] == 0.0
    assert snap2["isolated_wallet"]["closed_trades"] == 1

    # 4. Live HTTP endpoints: Ladder Orders, Pending FX Modify scaling, Position Flip, Risk Analytics, Technicals, Backtest
    with TestClient(app) as client:
        # Ensure starter BTC-USD / USDJPY=X present in case offline
        if not UNIVERSE.get_by_symbol("BTC-USD"):
            UNIVERSE._upsert_records([{
                "symbol": "BTC-USD", "name": "Bitcoin / USD", "region": "CRYPTO",
                "exchange": "BINANCE", "category": "crypto", "currency": "USD",
                "isin": "CRYPTO_MAJOR", "price": 88000.0, "prev_close": 86000.0,
                "change": 2000.0, "change_percent": 2.33, "volume": 2_000_000_000.0,
                "rsi_14": 58.0, "as_of": "2026-11-28 00:00",
            }])

        email = f"inst_{uuid.uuid4().hex[:8]}@example.com"
        su = client.post("/api/auth/register", json={
            "display_name": "Quant Desk", "email": email, "password": "StrongPassword123!", "accepted_disclaimer": True,
        })
        assert su.status_code in (200, 201), su.text

        # Scaled Limit Ladder Order on USDJPY=X (4 staggered rungs) + FX modify check
        lad = client.post("/api/orders/ladder", json={
            "symbol": "USDJPY=X", "total_quantity": 20000, "order_type": "BUY",
            "product_type": "INTRADAY", "price_start": 140.0, "price_end": 134.0, "rungs": 4,
        })
        assert lad.status_code == 200 and lad.json()["rungs_placed"] == 4, lad.text

        port1 = client.get("/api/portfolio").json()
        pend = [o for o in port1["pending_orders"] if o["symbol"] == "USDJPY=X"]
        assert len(pend) == 4
        mod = client.patch(f"/api/orders/{pend[0]['id']}", json={"limit_price": 139.0, "quantity": 5000})
        assert mod.status_code == 200
        # Scaled USD notional (~$5000, not 695,000 JPY!)
        assert mod.json()["order"]["gross_amount"] < 10000.0, mod.json()["order"]

        # Place BUY on BTC-USD then Flip -> SHORT atomically
        buy_btc = client.post("/api/orders/place", json={
            "symbol": "BTC-USD", "quantity": 0.02, "order_type": "BUY",
            "order_mode": "MARKET", "product_type": "INTRADAY", "stop_loss": 80000.0,
        })
        assert buy_btc.status_code == 200, buy_btc.text
        pos_id = client.get("/api/portfolio").json()["positions"][0]["id"]

        ra = client.get("/api/portfolio/risk-analytics")
        assert ra.status_code == 200 and "portfolio_heat_pct" in ra.json() and ra.json()["total_equity_usd"] > 0

        flip = client.post(f"/api/positions/{pos_id}/reverse")
        assert flip.status_code == 200 and flip.json()["new_side"] == "SELL", flip.text
        port2 = client.get("/api/portfolio").json()
        assert len(port2["positions"]) == 1 and port2["positions"][0]["order_type"] == "SHORT"

        tech = client.get("/api/asset/BTC-USD/technicals?interval=1d&period=3mo")
        assert tech.status_code == 200 and "pivots" in tech.json() and "mtf" in tech.json()

        bt_api = client.post("/api/backtest", json={"symbol": "BTC-USD", "strategy": "supertrend", "interval": "1d", "period": "6mo"})
        assert bt_api.status_code == 200 and "sharpe_ratio" in bt_api.json()

        client.post("/api/positions/square-off-all", json={})


if __name__ == "__main__":
    try:
        test_country_and_asset_class_tax_and_brokerage()
        test_middleware_multi_user_profiles_no_reset_and_trading()
        test_crypto_and_forex_complete_market()
        test_advanced_institutional_features()
        print("ALL QA TESTS PASSED!")
    finally:
        try:
            engine.dispose()
        except Exception:
            pass
        for suffix in ("", "-wal", "-shm"):
            p = f"{_TMP_DB_PATH}{suffix}"
            if os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass
