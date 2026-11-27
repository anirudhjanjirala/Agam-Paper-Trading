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


if __name__ == "__main__":
    try:
        test_country_and_asset_class_tax_and_brokerage()
        test_middleware_multi_user_profiles_no_reset_and_trading()
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
