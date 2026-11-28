from __future__ import annotations

import re
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from typing import Dict, List, Optional

import httpx


@dataclass
class ChargeBreakdown:
    country: str
    sub_jurisdiction: str
    exchange: str
    currency: str
    side: str
    product_type: str  # DELIVERY, INTRADAY, FUTURES, OPTIONS
    broker_plan: str   # DISCOUNT, PRO
    category: str
    quantity: float
    price: float
    notional: float
    margin_required: float
    leverage: float
    brokerage: float = 0.0
    stt_or_ftt: float = 0.0          # India STT, UK SDRT, France/Italy/Belgium FTT
    stamp_duty: float = 0.0          # India Stamp Duty, China Stamp Duty
    exchange_fee: float = 0.0        # NSE/BSE/TSX/SSE/SZSE/XETRA/Euronext
    regulator_fee: float = 0.0       # SEBI, SEC Sec 31, FINRA TAF, CIRO, CSRC, PTM
    gst_vat: float = 0.0             # India 18% GST, Canada 5% GST
    dp_or_clearing_fee: float = 0.0  # India DP Charge, China Transfer Fee, US CAT/Clearing
    total_charges: float = 0.0
    net_cash_impact: float = 0.0     # Total debit on BUY, or net proceeds on SELL
    effective_rate_pct: float = 0.0
    breakeven_delta: float = 0.0     # Min favorable price move per share to cover round-trip charges
    tax_notes: List[str] = field(default_factory=list)
    line_items: List[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def compute_fx_quote_to_settle(
    symbol: str,
    settlement_currency: str,
    live_price: float = 0.0,
    usd_rates: Optional[Dict[str, float]] = None,
) -> float:
    """
    Converts notional from the FX pair's quote currency into the wallet settlement currency.
    Example: USDJPY=X @ 150.25 settled in USD -> 1 USD / 150.25 JPY = 0.0066556.
    Example: EURGBP=X @ 0.8350 settled in USD -> (1 / usd_rates['GBP']).
    Example: EURUSD=X or USDINR=X (settled in INR) -> 1.0.
    """
    s = (symbol or "").upper().strip()
    if not s.endswith("=X") or len(s) < 8:
        return 1.0
    base, quote_c = s[:-2][:3], s[:-2][3:6]
    settle = (settlement_currency or "USD").upper().strip()
    if quote_c == settle:
        return 1.0
    rates = usd_rates or {"USD": 1.0, "EUR": 0.94, "GBP": 0.79, "JPY": 152.0, "CHF": 0.88, "CAD": 1.40, "AUD": 1.53, "NZD": 1.69, "INR": 84.5, "CNY": 7.25}
    if base == settle and live_price > 0:
        return 1.0 / live_price
    if quote_c in rates and settle in rates and rates[quote_c] > 0:
        return rates[settle] / rates[quote_c]
    return 1.0


def infer_country_and_sub(
    symbol: str,
    region: Optional[str] = None,
    exchange: Optional[str] = None,
    currency: Optional[str] = None,
) -> tuple[str, str, str]:
    """Determines normalized (country, sub_jurisdiction, exchange) for tax routing."""
    sym = (symbol or "").upper().strip()
    exch = (exchange or "").upper().strip()
    reg = (region or "").upper().strip()

    if sym.endswith(("-USD", "-USDT", "-EUR", "-GBP", "-BTC", "-ETH")) or reg == "CRYPTO" or exch in ("BINANCE", "COINBASE", "COINGECKO", "KRAKEN"):
        return "CRYPTO", "CRYPTO_EXCHANGE", exch or "BINANCE"
    if sym.endswith(".NS") or sym.endswith("-FO.NS") or sym in ("^NSEI", "^NSEBANK") or "INR" in sym:
        sub = "IND_FX" if sym.endswith("=X") else ("IND_FO" if "-FO." in sym else "IND_NSE")
        return "IND", sub, exch or ("NSE-FX" if sym.endswith("=X") else ("NSE-FO" if "-FO." in sym else "NSE"))
    if sym == "DX-Y.NYB" or reg == "FOREX" or exch in ("FOREX", "FX", "FX_OTC") or (sym.endswith("=X") and reg != "IND" and exch != "NSE-FX"):
        return "FOREX", "FX_OTC", exch or ("ICE" if sym == "DX-Y.NYB" else "FOREX")
    if exch.startswith("MCX") or sym.endswith(".MCX"):
        return "IND", "IND_MCX", exch or "MCX"
    if sym.endswith(".BO") or sym == "^BSESN":
        return "IND", "IND_BSE", exch or "BSE"
    if sym.endswith((".TO", ".V")) or sym == "^GSPTSE" or "CAD" in sym or reg == "CANADA":
        return "CANADA", "CAN_TSX", exch or ("TSXV" if sym.endswith(".V") else "TSX")
    if sym.endswith((".SS", ".SZ")) or "CNY" in sym or reg == "CHINA":
        return "CHINA", ("CHN_SSE" if sym.endswith(".SS") else "CHN_SZSE"), exch or ("SSE" if sym.endswith(".SS") else "SZSE")
    if sym.endswith(".L") or sym == "^FTSE":
        return "EU", "UK_LSE", exch or "LSE"
    if sym.endswith(".PA") or sym == "^FCHI":
        return "EU", "FR_EURONEXT", exch or "Euronext Paris"
    if sym.endswith(".MI"):
        return "EU", "IT_BORSA", exch or "Borsa Italiana"
    if sym.endswith(".DE") or sym == "^GDAXI":
        return "EU", "DE_XETRA", exch or "XETRA"
    if sym.endswith(".AS"):
        return "EU", "NL_EURONEXT", exch or "Euronext Amsterdam"
    if sym.endswith(".BR"):
        return "EU", "BE_EURONEXT", exch or "Euronext Brussels"
    if sym.endswith(".SW") or sym == "^SSMI":
        return "EU", "CH_SIX", exch or "SIX"

    if reg in ("IND", "IN"):
        return "IND", "IND_NSE", exch or "NSE"
    if reg == "EU":
        if currency in ("GBP", "GBp"):
            return "EU", "UK_LSE", exch or "LSE"
        return "EU", "DE_XETRA", exch or "XETRA"
    if reg in ("CANADA", "CA"):
        return "CANADA", "CAN_TSX", exch or "TSX"
    if reg in ("CHINA", "CN"):
        return "CHINA", "CHN_SSE", exch or "SSE"

    if currency == "INR":
        return "IND", "IND_NSE", exch or "NSE"
    if currency == "CAD":
        return "CANADA", "CAN_TSX", exch or "TSX"
    if currency == "CNY":
        return "CHINA", "CHN_SSE", exch or "SSE"
    if currency in ("GBP", "GBp"):
        return "EU", "UK_LSE", exch or "LSE"
    if currency == "EUR":
        return "EU", "DE_XETRA", exch or "XETRA"

    return "USA", "US_EQUITY", exch or "NASDAQ"


class LiveRegulatoryRateSync:
    """
    Maintains live-synced + statutory 2025/2026 regulatory rates per jurisdiction.
    Attempts non-blocking background refresh against official public regulatory pages
    (SEC Section 31 / FINRA TAF notices) while guaranteeing deterministic fallback.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.last_synced_at: Optional[str] = None
        self.last_sync_ts: float = 0.0
        self.live_sources: Dict[str, str] = {
            "IND": "SEBI / NSE / BSE / Indian Stamp Act (2025-2026 Schedule)",
            "USA": "SEC Section 31 FY26 ($20.60/M) + FINRA TAF Schedule",
            "CANADA": "TSX Maker-Taker / CIRO / CRA Schedule",
            "CHINA": "SAT 0.05% Stamp Duty / CSDC / SSE & SZSE Schedule",
            "EU": "UK SDRT (0.5%) / France FTT (0.4%) / Italy FTT (0.1%) / XETRA",
            "CRYPTO": "Global Spot & Perp Fee Schedule (0.10% Taker / 0.04% VIP Maker)",
            "FOREX": "Interbank Spot / ECN ($3.50/lot) / CFTC / ESMA 20x Margin",
        }
        # Verified FY26 official rates (SEC Sec 31 effective Apr 4, 2026 = $20.60/M)
        self.us_sec_rate_per_million: float = 20.60
        self.us_finra_taf_per_share: float = 0.000195
        self.us_finra_taf_cap: float = 9.79
        self.sync_status: str = "VERIFIED_STATUTORY_2026"

    def refresh_async_if_stale(self) -> None:
        if (time.time() - self.last_sync_ts) < 3600:
            return
        threading.Thread(target=self._refresh_sync, daemon=True).start()

    def _refresh_sync(self) -> None:
        with self._lock:
            if (time.time() - self.last_sync_ts) < 3600:
                return
            self.last_sync_ts = time.time()

        try:
            with httpx.Client(headers={"User-Agent": "AgamPaperTrading/5.0"}, timeout=6.0, follow_redirects=True) as client:
                r = client.get("https://www.sec.gov/divisions/marketreg/sec31info.htm")
                if r.status_code == 200:
                    m = re.search(r"\$([0-9]+(?:\.[0-9]+)?)\s*per\s*million", r.text, re.IGNORECASE)
                    if m:
                        rate = float(m.group(1))
                        if 0.0 <= rate <= 100.0:
                            with self._lock:
                                self.us_sec_rate_per_million = rate
                                self.sync_status = "LIVE_SYNCED"
        except Exception:
            pass

        with self._lock:
            self.last_synced_at = datetime.now(timezone.utc).isoformat()

    def effective_us_finra_taf_rate(self, on_date: Optional[date] = None) -> tuple[float, str]:
        d = on_date or datetime.now(timezone.utc).date()
        # FINRA Q4 2026 Temporary TAF Fee Holiday (Oct 1, 2026 - Dec 31, 2026)
        if date(2026, 10, 1) <= d <= date(2026, 12, 31):
            return 0.0, "Q4 2026 Fee Holiday ($0.00)"
        return self.us_finra_taf_per_share, f"${self.us_finra_taf_per_share:.6f}/sh (max ${self.us_finra_taf_cap:.2f})"

    def get_all_schedules(self) -> dict:
        self.refresh_async_if_stale()
        taf_rate, taf_note = self.effective_us_finra_taf_rate()
        with self._lock:
            sec_rate = self.us_sec_rate_per_million
            status = self.sync_status
            synced_at = self.last_synced_at

        return {
            "sync_status": status,
            "last_synced_at": synced_at or datetime.now(timezone.utc).isoformat(),
            "countries": {
                "IND": {
                    "name": "India (NSE / BSE / F&O)",
                    "currency": "INR",
                    "symbol": "₹",
                    "intraday_leverage": 5.0,
                    "source": self.live_sources["IND"],
                    "rules": {
                        "DELIVERY": {
                            "brokerage": "₹0 (Discount) / 0.25% (Pro)",
                            "stt": "0.10% Buy & Sell (Stocks); 0.001% Sell (ETFs)",
                            "stamp_duty": "0.015% Buy only",
                            "exchange_txn": "0.00297% (NSE) / 0.00375% (BSE) + 0.0001% IPFT",
                            "sebi_fee": "0.0001% (₹10/Cr)",
                            "gst": "18% on (Brokerage + Exchange + SEBI)",
                            "dp_charge": "₹15.93 (₹13.50 + 18% GST) on Delivery Sell",
                            "est_cap_gains_tax": "20% STCG (<12M) / 12.5% LTCG (>₹1.25L)",
                        },
                        "INTRADAY": {
                            "brokerage": "min(₹20, 0.03%) per order",
                            "stt": "0.025% Sell only",
                            "stamp_duty": "0.003% Buy only",
                            "exchange_txn": "0.00297% (NSE) / 0.00375% (BSE) + 0.0001% IPFT",
                            "sebi_fee": "0.0001% (₹10/Cr)",
                            "gst": "18% on (Brokerage + Exchange + SEBI)",
                            "dp_charge": "₹0",
                            "est_cap_gains_tax": "Speculative Business Income (Est. 30% slab)",
                        },
                        "FUTURES": {
                            "brokerage": "₹20 flat per order",
                            "stt": "0.05% Sell only",
                            "stamp_duty": "0.002% Buy only",
                            "exchange_txn": "0.00173% (NSE F&O)",
                            "sebi_fee": "0.0001%",
                            "gst": "18% on (Brokerage + Exchange + SEBI)",
                        },
                        "OPTIONS": {
                            "brokerage": "₹20 flat per order",
                            "stt": "0.15% Sell premium",
                            "stamp_duty": "0.003% Buy only",
                            "exchange_txn": "0.03503% on premium",
                            "sebi_fee": "0.0001%",
                            "gst": "18% on (Brokerage + Exchange + SEBI)",
                        },
                        "COMMODITIES_AND_FX_BONDS": {
                            "commodities_mcx": "0.01% CTT Sell (Futures) / 0.05% Options; 0% STT on Gold/Silver ETFs",
                            "forex_nse_fx": "0% STT; 0.0001% Buy Stamp; 0.00035% NSE FX Txn",
                            "bonds_gsec": "0% STT; 0.0001% Debt Stamp; 0% DP on Sovereign G-Secs",
                        },
                    },
                },
                "USA": {
                    "name": "United States (NASDAQ / NYSE / CME)",
                    "currency": "USD",
                    "symbol": "$",
                    "intraday_leverage": 4.0,
                    "source": self.live_sources["USA"],
                    "rules": {
                        "DELIVERY": {
                            "brokerage": "$0.00 (Zero-Comm) / $0.005/sh min $1 (Pro)",
                            "sec_section_31": f"${sec_rate:.2f} per $1M on Sell (Stocks/ETFs)",
                            "finra_taf": f"{taf_note} on Sell (effective rate: ${taf_rate:.6f}/sh)",
                            "cat_clearing": "$0.000035/sh CAT + Clearing",
                            "est_cap_gains_tax": "22% Est. Short-Term Capital Gains (<1Y)",
                        },
                        "INTRADAY": {
                            "brokerage": "$0.00 (Zero-Comm) / $0.005/sh min $1 (Pro)",
                            "sec_section_31": f"${sec_rate:.2f} per $1M on Sell",
                            "finra_taf": f"{taf_note} on Sell",
                            "cat_clearing": "$0.000035/sh CAT + Clearing",
                            "leverage": "4x Reg-T Pattern Day Margin",
                        },
                        "OPTIONS_FUTURES_FX": {
                            "options": "$0.65/contract + OCC $0.02 + ORF $0.029 + SEC/FINRA on Sell",
                            "futures_cme": "$1.25/contract + CME $1.38 + NFA $0.02/contract",
                            "forex_bonds": "0% SEC Sec 31 & 0% FINRA TAF on FX & Treasuries",
                        },
                    },
                },
                "CANADA": {
                    "name": "Canada (TSX / TSXV)",
                    "currency": "CAD",
                    "symbol": "C$",
                    "intraday_leverage": 3.0,
                    "source": self.live_sources["CANADA"],
                    "rules": {
                        "DELIVERY": {
                            "brokerage": "$4.95–$9.95 ($0.01/sh) or $0 (Pro/Zero plan)",
                            "exchange_ecn": "$0.0027/sh TSX liquidity fee",
                            "ciro_fee": "0.001% CIRO regulatory levy",
                            "gst_hst": "5% GST on Brokerage",
                            "est_cap_gains_tax": "50% inclusion (~15% eff. CRA cap gains)",
                        },
                    },
                },
                "CHINA": {
                    "name": "China (Shanghai SSE / Shenzhen SZSE)",
                    "currency": "CNY",
                    "symbol": "¥",
                    "intraday_leverage": 2.0,
                    "source": self.live_sources["CHINA"],
                    "rules": {
                        "DELIVERY": {
                            "brokerage": "0.025% (min ¥5.00)",
                            "stamp_duty": "0.05% Sell only (Stocks; 0% ETFs)",
                            "transfer_fee": "0.001% ChinaClear Buy & Sell",
                            "handling_fee": "0.00341% SSE/SZSE Buy & Sell",
                            "csrc_fee": "0.002% CSRC Regulatory Fee Buy & Sell",
                            "est_cap_gains_tax": "0% (Exempt on A-shares)",
                        },
                    },
                },
                "EU": {
                    "name": "Europe & UK (LSE / XETRA / Euronext)",
                    "currency": "EUR",
                    "symbol": "€",
                    "intraday_leverage": 3.0,
                    "source": self.live_sources["EU"],
                    "rules": {
                        "UK_LSE": {
                            "brokerage": "£5.95 flat (Discount) / 0.05% min £3 (Pro)",
                            "uk_sdrt": "0.50% Buy only (UK Shares; 0% ETFs/Gilts)",
                            "ptm_levy": "£1.00 on trades > £10,000",
                        },
                        "FR_EURONEXT": {
                            "brokerage": "0.05% (min €1.25)",
                            "french_ftt": "0.40% Buy only (effective Apr 2025)",
                            "exchange_fee": "0.0038% Euronext",
                        },
                        "IT_BORSA": {
                            "brokerage": "0.05% (min €1.50)",
                            "italian_ftt": "0.10% Buy only (0% Intraday)",
                            "exchange_fee": "0.0038% Borsa Italiana",
                        },
                        "DE_XETRA": {
                            "brokerage": "0.05% (min €1.25)",
                            "ftt": "0% (Germany No National FTT)",
                            "exchange_fee": "0.0038% XETRA (min €0.50, max €18)",
                            "est_cap_gains_tax": "26.375% Abgeltungsteuer (DE ref.)",
                        },
                    },
                },
                "CRYPTO": {
                    "name": "Global Crypto Spot & Perps (Binance / Coinbase)",
                    "currency": "USD",
                    "symbol": "$",
                    "intraday_leverage": 10.0,
                    "source": self.live_sources["CRYPTO"],
                    "rules": {
                        "SPOT_DELIVERY": {
                            "exchange_fee": "0.10% Taker (Discount) / 0.04% VIP Maker (Pro)",
                            "leverage": "1x Unleveraged Spot Custody",
                            "network_fee": "$0.00 Internal Exchange Book",
                            "est_cap_gains_tax": "25% Est. Digital Asset Tax (IND 30% VDA + 1% TDS Ref.)",
                        },
                        "MARGIN_PERPS": {
                            "exchange_fee": "0.05% Taker (Discount) / 0.02% Maker (Pro)",
                            "leverage": "10x Margin / 20x Perpetual Futures",
                            "funding_rate": "~0.01% per 8h Funding Settlement Reference",
                            "est_cap_gains_tax": "Short-Term Crypto Derivatives Income",
                        },
                    },
                },
                "FOREX": {
                    "name": "Global Forex (Majors / Minors / Exotics — 24/5)",
                    "currency": "USD",
                    "symbol": "$",
                    "intraday_leverage": 20.0,
                    "source": self.live_sources["FOREX"],
                    "rules": {
                        "SPOT_FX": {
                            "commission": "$0.00 Retail Raw Spread (Discount) / $3.50 per 100k Lot (ECN Pro)",
                            "spread": "0.8 Pips (Majors) · 1.8 Pips (Minors) · ~4 Pips (Exotics)",
                            "leverage": "1x Unleveraged / 20x FX Margin (Intraday)",
                            "est_cap_gains_tax": "Sec 988 / Spot FX Income (~22% Est.)",
                        },
                    },
                },
            },
        }


RATE_SYNC = LiveRegulatoryRateSync()


def _r2(val: float) -> float:
    return round(float(val), 2)


def _add_item(items: List[dict], label: str, amount: float, rate_desc: str) -> None:
    if amount > 0 or label == "Brokerage":
        items.append({"label": label, "amount": _r2(amount), "rate": rate_desc})


def calculate_order_charges(
    symbol: str,
    quantity: float,
    price: float,
    side: str,
    product_type: str = "DELIVERY",
    broker_plan: str = "DISCOUNT",
    region: Optional[str] = None,
    exchange: Optional[str] = None,
    currency: Optional[str] = None,
    category: str = "stocks",
    fx_quote_to_settle: float = 1.0,
    _compute_breakeven: bool = True,
) -> ChargeBreakdown:
    """
    Computes authentic country-specific live brokerage, statutory taxes, exchange fees,
    regulator levies, GST/VAT, and required margin for any trade worldwide.
    """
    RATE_SYNC.refresh_async_if_stale()
    qty = max(1e-8, float(quantity))
    px = max(0.0, float(price))
    fx_scale = max(1e-8, float(fx_quote_to_settle or 1.0))
    notional = px * qty * fx_scale
    side_u = side.upper().strip()
    prod_u = product_type.upper().strip()
    if prod_u not in ("DELIVERY", "INTRADAY", "FUTURES", "OPTIONS"):
        prod_u = "DELIVERY"
    plan_u = broker_plan.upper().strip()
    if plan_u not in ("DISCOUNT", "PRO"):
        plan_u = "DISCOUNT"

    country, sub, exch = infer_country_and_sub(symbol, region, exchange, currency)
    curr = currency or (
        "INR" if country == "IND"
        else "CAD" if country == "CANADA"
        else "CNY" if country == "CHINA"
        else ("GBp" if sub == "UK_LSE" and symbol.upper().endswith(".L") else "EUR") if country == "EU"
        else "USD"
    )
    cat = (category or "stocks").lower()
    if country == "CRYPTO":
        cat = "crypto"
    elif country == "FOREX":
        cat = "forex"
    if cat == "derivatives" or "-FO" in symbol.upper():
        if prod_u in ("DELIVERY", "INTRADAY"):
            prod_u = "FUTURES"

    leverage = 1.0
    if country == "CRYPTO":
        leverage = 20.0 if prod_u == "FUTURES" else (10.0 if prod_u == "INTRADAY" else 1.0)
    elif country == "FOREX" or (cat == "forex" and prod_u in ("INTRADAY", "FUTURES")):
        if country == "FOREX":
            leverage = 20.0 if prod_u in ("INTRADAY", "FUTURES") else 1.0
        else:
            leverage = 5.0 if country == "IND" else 4.0 if country == "USA" else 10.0
    elif prod_u == "INTRADAY" and cat in ("stocks", "etfs", "forex", "commodities"):
        leverage = (
            5.0 if country == "IND"
            else 4.0 if country == "USA"
            else 3.0 if country in ("CANADA", "EU")
            else 2.0
        )
    elif prod_u == "FUTURES" and cat in ("stocks", "etfs", "derivatives", "commodities", "indices", "forex"):
        leverage = 5.0 if country in ("IND", "USA") else 3.0
    margin_required = notional / leverage

    brokerage = 0.0
    stt_or_ftt = 0.0
    stamp_duty = 0.0
    exchange_fee = 0.0
    regulator_fee = 0.0
    gst_vat = 0.0
    dp_or_clearing = 0.0
    items: List[dict] = []
    notes: List[str] = []

    if country == "IND":
        is_etf_proxy = "BEES" in symbol.upper() or cat == "etfs"
        if cat == "forex":
            brokerage = _r2(min(20.0, notional * 0.0003)) if plan_u == "DISCOUNT" else _r2(notional * 0.0005)
            _add_item(items, "Brokerage (NSE-FX)", brokerage, "min(₹20, 0.03%)" if plan_u == "DISCOUNT" else "0.05%")
            if side_u == "BUY":
                stamp_duty = _r2(notional * 0.000001)  # 0.0001% currency stamp duty
                _add_item(items, "Currency Stamp Duty", stamp_duty, "0.0001% Buy only (0% STT)")
            exchange_fee = _r2(notional * 0.0000035)  # 0.00035% NSE Currency Futures
            _add_item(items, "NSE Currency Txn Fee", exchange_fee, "0.00035%")
            regulator_fee = _r2(notional * 0.000001)
            _add_item(items, "SEBI Turnover Fee", regulator_fee, "₹10/Cr (0.0001%)")
            gst_vat = _r2((brokerage + exchange_fee + regulator_fee) * 0.18)
            _add_item(items, "GST (18%)", gst_vat, "18% on Brok+Exch+SEBI")
            notes.append("India NSE Currency (FX): 0% STT statutory exemption on currency pairs.")

        elif cat == "bonds" and prod_u == "DELIVERY":
            brokerage = 0.0 if plan_u == "DISCOUNT" else _r2(notional * 0.001)
            _add_item(items, "Brokerage (Debt / G-Sec)", brokerage, "₹0 Zero-Comm" if plan_u == "DISCOUNT" else "0.10%")
            if side_u == "BUY":
                stamp_duty = _r2(notional * 0.000001)
                _add_item(items, "Debt Stamp Duty", stamp_duty, "0.0001% Buy only (0% STT)")
            exchange_fee = _r2(notional * 0.000001)
            _add_item(items, "NSE Debt Txn Fee", exchange_fee, "0.0001%")
            regulator_fee = _r2(notional * 0.000001)
            _add_item(items, "SEBI Turnover Fee", regulator_fee, "0.0001%")
            gst_vat = _r2((brokerage + exchange_fee + regulator_fee) * 0.18)
            _add_item(items, "GST (18%)", gst_vat, "18% on Brok+Exch+SEBI")
            if side_u == "SELL" and is_etf_proxy:
                dp_or_clearing = 15.93
                _add_item(items, "DP Charge (Debt ETF)", dp_or_clearing, "₹13.50 + 18% GST (Sell)")
            notes.append("India Sovereign G-Sec / Debt: 0% STT statutory exemption; 0% CDSL DP on direct G-Secs.")

        elif cat == "commodities" and (prod_u in ("FUTURES", "OPTIONS") or not is_etf_proxy):
            # MCX / Commodity Derivatives -> CTT (0.01% Sell Futures / 0.05% Sell Options)
            brokerage = 20.0 if plan_u == "DISCOUNT" else _r2(max(20.0, notional * 0.0003))
            _add_item(items, f"Brokerage (Commodity {prod_u})", brokerage, "₹20 flat/order" if plan_u == "DISCOUNT" else "0.03%")
            if side_u == "SELL":
                ctt_rate = 0.0005 if prod_u == "OPTIONS" else 0.0001  # 0.01% MCX CTT
                stt_or_ftt = _r2(notional * ctt_rate)
                _add_item(items, f"CTT (Commodities Txn Tax)", stt_or_ftt, f"{ctt_rate*100:.2f}% Sell only")
            if side_u == "BUY":
                sd_rate = 0.00003 if prod_u == "OPTIONS" else 0.00002
                stamp_duty = _r2(notional * sd_rate)
                _add_item(items, "Commodity Stamp Duty", stamp_duty, f"{sd_rate*100:.3f}% Buy only")
            exchange_fee = _r2(notional * (0.000418 if prod_u == "OPTIONS" else 0.000021))
            _add_item(items, "MCX / Exchange Txn Fee", exchange_fee, "0.0418%" if prod_u == "OPTIONS" else "0.0021%")
            regulator_fee = _r2(notional * 0.000001)
            _add_item(items, "SEBI Turnover Fee", regulator_fee, "0.0001%")
            gst_vat = _r2((brokerage + exchange_fee + regulator_fee) * 0.18)
            _add_item(items, "GST (18%)", gst_vat, "18% on Brok+Exch+SEBI")
            notes.append("India MCX Commodities: 0.01% CTT (non-agri futures) replaces equity STT.")

        elif prod_u == "DELIVERY":
            brokerage = 0.0 if plan_u == "DISCOUNT" else _r2(notional * 0.0025)
            _add_item(items, "Brokerage", brokerage, "₹0 Zero-Comm" if plan_u == "DISCOUNT" else "0.25% Full-Service")
            if cat == "stocks":
                stt_or_ftt = _r2(notional * 0.001)  # 0.1% both BUY & SELL
                _add_item(items, "STT (Securities Txn Tax)", stt_or_ftt, "0.10% Buy & Sell")
            elif cat == "etfs":
                stt_or_ftt = _r2(notional * 0.00001) if side_u == "SELL" else 0.0
                _add_item(items, "STT (ETF)", stt_or_ftt, "0.001% Sell only")
            elif cat == "commodities":
                _add_item(items, "STT (Commodity ETF)", 0.0, "0% STT on Gold/Silver ETFs")
            if side_u == "BUY" and cat in ("stocks", "etfs", "commodities"):
                stamp_duty = _r2(notional * 0.00015)  # 0.015% BUY only
                _add_item(items, "Stamp Duty", stamp_duty, "0.015% Buy only")
            exch_rate = 0.0000375 if sub == "IND_BSE" else 0.0000297
            ipft_rate = 0.0 if sub == "IND_BSE" else 0.000001
            exchange_fee = _r2(notional * (exch_rate + ipft_rate))
            _add_item(items, f"{'BSE' if sub == 'IND_BSE' else 'NSE'} Txn + IPFT", exchange_fee, f"{(exch_rate + ipft_rate)*100:.5f}%")
            regulator_fee = _r2(notional * 0.000001)
            _add_item(items, "SEBI Turnover Fee", regulator_fee, "₹10/Cr (0.0001%)")
            gst_vat = _r2((brokerage + exchange_fee + regulator_fee) * 0.18)
            _add_item(items, "GST (18%)", gst_vat, "18% on Brok+Exch+SEBI")
            if side_u == "SELL" and cat in ("stocks", "etfs", "commodities"):
                dp_or_clearing = 15.93  # ₹13.50 + 18% GST CDSL/NSDL DP Charge
                _add_item(items, "DP Charge (CDSL/NSDL)", dp_or_clearing, "₹13.50 + 18% GST (Sell)")
            notes.append("India Equity Delivery: 20% STCG (<12M) / 12.5% LTCG (>₹1.25L) on net profit.")

        elif prod_u == "INTRADAY":
            brokerage = _r2(min(20.0, notional * 0.0003)) if plan_u == "DISCOUNT" else _r2(notional * 0.0005)
            _add_item(items, "Brokerage (MIS)", brokerage, "min(₹20, 0.03%)" if plan_u == "DISCOUNT" else "0.05%")
            if side_u == "SELL" and cat in ("stocks", "etfs"):
                stt_or_ftt = _r2(notional * 0.00025)
                _add_item(items, "STT (Intraday)", stt_or_ftt, "0.025% Sell only")
            if side_u == "BUY":
                stamp_duty = _r2(notional * 0.00003)
                _add_item(items, "Stamp Duty", stamp_duty, "0.003% Buy only")
            exch_rate = 0.0000375 if sub == "IND_BSE" else 0.0000297
            ipft_rate = 0.0 if sub == "IND_BSE" else 0.000001
            exchange_fee = _r2(notional * (exch_rate + ipft_rate))
            _add_item(items, f"{'BSE' if sub == 'IND_BSE' else 'NSE'} Txn + IPFT", exchange_fee, f"{(exch_rate + ipft_rate)*100:.5f}%")
            regulator_fee = _r2(notional * 0.000001)
            _add_item(items, "SEBI Turnover Fee", regulator_fee, "₹10/Cr (0.0001%)")
            gst_vat = _r2((brokerage + exchange_fee + regulator_fee) * 0.18)
            _add_item(items, "GST (18%)", gst_vat, "18% on Brok+Exch+SEBI")
            notes.append("India Intraday (5x MIS Margin): Speculative business income taxed at slab rate.")

        else:  # Equity / Index FUTURES / OPTIONS
            brokerage = 20.0 if plan_u == "DISCOUNT" else 50.0
            _add_item(items, f"Brokerage ({prod_u})", brokerage, "₹20 flat/order" if plan_u == "DISCOUNT" else "₹50/order")
            if side_u == "SELL":
                stt_rate = 0.0015 if prod_u == "OPTIONS" else 0.0005
                stt_or_ftt = _r2(notional * stt_rate)
                _add_item(items, f"STT ({prod_u})", stt_or_ftt, f"{stt_rate*100:.3f}% Sell only")
            if side_u == "BUY":
                sd_rate = 0.00003 if prod_u == "OPTIONS" else 0.00002
                stamp_duty = _r2(notional * sd_rate)
                _add_item(items, "Stamp Duty", stamp_duty, f"{sd_rate*100:.4f}% Buy only")
            exch_rate = 0.0003503 if prod_u == "OPTIONS" else 0.0000173
            exchange_fee = _r2(notional * exch_rate)
            _add_item(items, "NSE F&O Txn Charge", exchange_fee, f"{exch_rate*100:.5f}%")
            regulator_fee = _r2(notional * 0.000001)
            _add_item(items, "SEBI Turnover Fee", regulator_fee, "0.0001%")
            gst_vat = _r2((brokerage + exchange_fee + regulator_fee) * 0.18)
            _add_item(items, "GST (18%)", gst_vat, "18% on Brok+Exch+SEBI")
            notes.append("India F&O: Non-speculative business income/loss.")

    elif country == "USA":
        if cat == "commodities" or (prod_u == "FUTURES" and cat in ("commodities", "indices", "derivatives")):
            brokerage = _r2(max(1.25, qty * 1.25))
            _add_item(items, "Futures Commission", brokerage, "$1.25/contract")
            exchange_fee = _r2(qty * 1.38)
            _add_item(items, "CME/Exchange Clearing Fee", exchange_fee, "$1.38/contract")
            regulator_fee = _r2(qty * 0.02)
            _add_item(items, "NFA Assessment Fee", regulator_fee, "$0.02/contract")
            notes.append("USA Futures (CME/COMEX/NYMEX): Sec 1256 (60% long-term / 40% short-term) tax treatment.")
        elif cat == "forex":
            brokerage = _r2(max(1.0, notional * 0.00002)) if plan_u == "PRO" else 0.0
            _add_item(items, "ECN FX Commission", brokerage, "0.002% min $1" if plan_u == "PRO" else "$0.00 Retail FX Spread")
            notes.append("USA Forex (Spot/Interbank): Exempt from SEC Sec 31 & FINRA TAF.")
        elif cat == "bonds":
            brokerage = _r2(max(1.0, notional * 0.0005)) if plan_u == "PRO" else 0.0
            _add_item(items, "Fixed Income / Treasury Desk", brokerage, "$0.00 Zero-Comm" if brokerage == 0 else "0.05% min $1")
            notes.append("USA Bonds / Treasuries: Exempt from SEC Section 31 equity fee.")
        elif prod_u == "OPTIONS":
            brokerage = _r2(qty * (0.65 if plan_u == "DISCOUNT" else 0.50))
            _add_item(items, "Options Contract Commission", brokerage, "$0.65/contract" if plan_u == "DISCOUNT" else "$0.50/contract")
            exchange_fee = _r2(qty * 0.02)
            _add_item(items, "OCC Clearing Fee", exchange_fee, "$0.02/contract")
            orf_fee = _r2(qty * 0.029)
            sec_fee = _r2(max(0.01, notional * (RATE_SYNC.us_sec_rate_per_million / 1_000_000.0))) if side_u == "SELL" and notional >= 100 else 0.0
            taf_rate, _ = RATE_SYNC.effective_us_finra_taf_rate()
            taf_fee = _r2(qty * 0.00279) if (side_u == "SELL" and taf_rate > 0) else 0.0
            regulator_fee = _r2(orf_fee + sec_fee + taf_fee)
            _add_item(items, "ORF + SEC + FINRA Options Fee", regulator_fee, "ORF $0.029/c + SEC/TAF")
            notes.append("USA Options: Per-contract OCC & Options Regulatory Fee (ORF) applied.")
        else:
            if plan_u == "PRO":
                brokerage = _r2(max(1.00, min(notional * 0.01, qty * 0.005)))
                _add_item(items, "Brokerage (IBKR Pro)", brokerage, "$0.005/sh (min $1.00)")
            else:
                brokerage = 0.0
                _add_item(items, "Brokerage (Zero-Comm)", 0.0, "$0.00 US Retail")

            if side_u == "SELL" and cat in ("stocks", "etfs"):
                sec_rate = RATE_SYNC.us_sec_rate_per_million / 1_000_000.0
                sec_fee = _r2(max(0.01, notional * sec_rate)) if (notional * sec_rate) >= 0.005 else 0.0
                taf_rate, taf_desc = RATE_SYNC.effective_us_finra_taf_rate()
                taf_fee = _r2(min(RATE_SYNC.us_finra_taf_cap, qty * taf_rate)) if taf_rate > 0 else 0.0
                regulator_fee = _r2(sec_fee + taf_fee)
                _add_item(items, "SEC Section 31 Fee", sec_fee, f"${RATE_SYNC.us_sec_rate_per_million:.2f}/$1M Sell")
                _add_item(items, "FINRA TAF", taf_fee, taf_desc)

            if cat in ("stocks", "etfs"):
                cat_fee = _r2(qty * 0.000035)
                if cat_fee == 0.0 and notional >= 100.0:
                    cat_fee = 0.01
                dp_or_clearing = cat_fee
                _add_item(items, "CAT & Clearing Fee", dp_or_clearing, "$0.000035/sh")
            notes.append("USA Tax: Short-term cap gains (<1Y) taxed as ordinary income (~22% est.).")

    elif country == "CANADA":
        if cat == "forex":
            brokerage = _r2(max(1.0, notional * 0.00002)) if plan_u == "PRO" else 0.0
            _add_item(items, "CAD FX Commission", brokerage, "0.002% min C$1" if plan_u == "PRO" else "C$0.00 Spread")
            gst_vat = _r2(brokerage * 0.05)
            _add_item(items, "Canada GST (5%)", gst_vat, "5% on Commission")
            notes.append("Canada FX: Exempt from TSX ECN share liquidity levies.")
        elif cat == "bonds":
            brokerage = 0.0 if plan_u == "PRO" else 4.95
            _add_item(items, "Fixed Income Desk", brokerage, "C$0.00" if brokerage == 0 else "C$4.95 flat")
            gst_vat = _r2(brokerage * 0.05)
            _add_item(items, "Canada GST (5%)", gst_vat, "5% on Brokerage")
            notes.append("Canada Bonds: Exempt from TSX share liquidity levies.")
        else:
            if plan_u == "PRO":
                brokerage = 0.0
                _add_item(items, "Brokerage (Zero-Comm)", 0.0, "C$0.00")
            else:
                brokerage = _r2(min(9.95, max(4.95, qty * 0.01)))
                _add_item(items, "Brokerage (CA Standard)", brokerage, "C$0.01/sh (C$4.95–9.95)")
            ecn_rate = 0.0027 if px >= 1.0 else 0.0010
            exchange_fee = _r2(qty * ecn_rate)
            _add_item(items, "TSX / ECN Liquidity Fee", exchange_fee, f"C${ecn_rate:.4f}/sh")
            regulator_fee = _r2(notional * 0.00001)
            _add_item(items, "CIRO Regulatory Fee", regulator_fee, "0.001%")
            gst_vat = _r2(brokerage * 0.05)
            _add_item(items, "Canada GST (5%)", gst_vat, "5% on Brokerage")
            notes.append("Canada Tax: 50% Capital Gains inclusion rate under CRA rules.")

    elif country == "CHINA":
        if cat == "forex":
            brokerage = _r2(max(5.0, notional * 0.00005))
            _add_item(items, "CNY FX Spread/Comm", brokerage, "0.005% min ¥5")
            notes.append("China FX: Exempt from A-share Stamp Duty & ChinaClear transfer fees.")
        elif cat == "bonds":
            brokerage = _r2(max(1.0, notional * 0.0001))
            _add_item(items, "CGB Bond Commission", brokerage, "0.01% min ¥1 (0% Stamp Duty)")
            exchange_fee = _r2(notional * 0.000001)
            _add_item(items, "SSE Bond Handling", exchange_fee, "0.0001%")
            notes.append("China Govt Bonds: Exempt from Stamp Duty and Transfer Fees.")
        else:
            comm_rate = 0.00025 if plan_u == "DISCOUNT" else 0.001
            brokerage = _r2(max(5.00, notional * comm_rate))
            _add_item(items, "Brokerage Commission", brokerage, f"{comm_rate*100:.3f}% (min ¥5)")
            if side_u == "SELL" and cat == "stocks":
                stamp_duty = _r2(notional * 0.0005)
                _add_item(items, "Stamp Duty (印花税)", stamp_duty, "0.05% Sell only")
            dp_or_clearing = _r2(notional * 0.00001) if cat == "stocks" else _r2(notional * 0.000005)
            _add_item(items, "ChinaClear Transfer Fee", dp_or_clearing, "0.001%" if cat == "stocks" else "0.0005% ETF")
            exchange_fee = _r2(notional * (0.0000341 if cat == "stocks" else 0.00004))
            _add_item(items, "SSE/SZSE Handling Fee", exchange_fee, "0.00341%" if cat == "stocks" else "0.004% ETF")
            regulator_fee = _r2(notional * 0.00002) if cat == "stocks" else 0.0
            if regulator_fee > 0:
                _add_item(items, "CSRC Regulatory Fee", regulator_fee, "0.002% Buy & Sell")
            notes.append("China: 0.05% Stamp Duty applies only to Stock Sells (ETFs/Bonds exempt).")

    elif country == "CRYPTO":
        is_perp = prod_u in ("INTRADAY", "FUTURES")
        fee_rate = (0.0005 if plan_u == "DISCOUNT" else 0.0002) if is_perp else (0.0010 if plan_u == "DISCOUNT" else 0.0004)
        brokerage = _r2(notional * fee_rate)
        tier_lbl = "Perp Taker 0.05%" if (is_perp and plan_u == "DISCOUNT") else "Perp Maker 0.02%" if is_perp else ("Spot Taker 0.10%" if plan_u == "DISCOUNT" else "VIP Maker 0.04%")
        _add_item(items, f"Exchange Fee ({'Perp' if is_perp else 'Spot'})", brokerage, tier_lbl)
        notes.append(
            f"Crypto ({'Futures/Margin ' + str(int(leverage)) + 'x' if is_perp else '1x Spot'}): 24/7 continuous book; subject to local VDA/capital gains rules."
        )

    elif country == "FOREX":
        if plan_u == "PRO":
            brokerage = _r2(max(0.35, notional * 0.000035))
            _add_item(items, "ECN Institutional Comm", brokerage, "$3.50 / $100k Lot (min $0.35)")
        else:
            brokerage = 0.0
            _add_item(items, "Brokerage (Raw Spread)", 0.0, "$0.00 Commission (Spread in Bid/Ask)")
        notes.append(
            f"Global Forex (24/5, {int(leverage)}x Margin): 0% equity STT/SEC; overnight positions reflect interbank swap differential."
        )

    else:  # EU & UK sub-jurisdictions
        if cat == "forex":
            brokerage = _r2(max(1.0, notional * 0.00002)) if plan_u == "PRO" else 0.0
            _add_item(items, "EUR/GBP FX Commission", brokerage, "0.002% min €1" if plan_u == "PRO" else "€0.00 Spread")
            notes.append("Europe/UK FX: Exempt from UK SDRT and EU Financial Transaction Taxes.")
        elif sub == "UK_LSE":
            scale = 100.0 if curr == "GBp" else 1.0
            if curr == "USD":
                brokerage = _r2(max(1.50, notional * 0.0005)) if plan_u == "PRO" else 0.0
                _add_item(items, "Brokerage (LSE USD)", brokerage, "$0.00" if brokerage == 0 else "0.05% min $1.50")
            else:
                base_brok = (5.95 * scale) if plan_u == "DISCOUNT" else max(3.0 * scale, notional * 0.0005)
                brokerage = _r2(base_brok)
                _add_item(items, "Brokerage (UK LSE)", brokerage, "£5.95 flat" if plan_u == "DISCOUNT" else "0.05% min £3")
                if side_u == "BUY" and cat == "stocks":
                    stt_or_ftt = _r2(notional * 0.005)
                    _add_item(items, "UK SDRT (Stamp Duty)", stt_or_ftt, "0.50% Buy only")
                    if notional > (10000.0 * scale):
                        regulator_fee = _r2(1.0 * scale)
                        _add_item(items, "UK PTM Levy", regulator_fee, "£1.00 (>£10k trade)")
            notes.append("UK LSE: 0.5% SDRT applies on UK Stock Buys; ETFs, Gilts & Gold ETCs exempt.")

        elif sub == "FR_EURONEXT":
            brokerage = _r2(max(1.25, notional * 0.0005))
            _add_item(items, "Brokerage (Paris)", brokerage, "0.05% (min €1.25)")
            if side_u == "BUY" and cat == "stocks":
                stt_or_ftt = _r2(notional * 0.004)
                _add_item(items, "French FTT (2025+)", stt_or_ftt, "0.40% Buy only")
            exchange_fee = _r2(max(0.50, notional * 0.000038))
            _add_item(items, "Euronext Clearing Fee", exchange_fee, "0.0038%")
            notes.append("France: 0.4% FTT applies on equity buys; ETFs & Bonds exempt.")

        elif sub == "IT_BORSA":
            brokerage = _r2(max(1.50, notional * 0.0005))
            _add_item(items, "Brokerage (Milan)", brokerage, "0.05% (min €1.50)")
            if side_u == "BUY" and cat == "stocks" and prod_u != "INTRADAY":
                stt_or_ftt = _r2(notional * 0.001)
                _add_item(items, "Italian FTT", stt_or_ftt, "0.10% Buy (Delivery)")
            exchange_fee = _r2(max(0.50, notional * 0.000038))
            _add_item(items, "Borsa Italiana Fee", exchange_fee, "0.0038%")
            notes.append("Italy: 0.1% FTT on stock delivery buys; Intraday, ETFs & Bonds exempt.")

        elif sub == "BE_EURONEXT":
            brokerage = _r2(max(1.25, notional * 0.0005))
            _add_item(items, "Brokerage (Brussels)", brokerage, "0.05% (min €1.25)")
            if cat == "stocks":
                stt_or_ftt = _r2(min(1600.0, notional * 0.0035))
                _add_item(items, "Belgium TOB Tax", stt_or_ftt, "0.35% (cap €1,600)")
            elif cat in ("etfs", "bonds"):
                stt_or_ftt = _r2(min(1300.0, notional * 0.0012))
                _add_item(items, "Belgium TOB (ETF/Bond)", stt_or_ftt, "0.12% (cap €1,300)")
            exchange_fee = _r2(max(0.50, notional * 0.000038))
            _add_item(items, "Euronext Fee", exchange_fee, "0.0038%")
            notes.append("Belgium: TOB is 0.35% on stocks vs 0.12% on distributing ETFs/bonds.")

        else:  # DE_XETRA / NL_EURONEXT / EU general
            brokerage = _r2(max(1.25, notional * 0.0005))
            _add_item(items, f"Brokerage ({exch})", brokerage, "0.05% (min €1.25)")
            exchange_fee = _r2(min(18.0, max(0.50, notional * 0.000038)))
            _add_item(items, f"{exch} Exchange & Clearstream", exchange_fee, "0.0038% (€0.50–€18)")
            notes.append("Germany/Netherlands: No national equity FTT; DE Abgeltungsteuer ~26.375% ref.")

    total_charges = _r2(
        brokerage + stt_or_ftt + stamp_duty + exchange_fee + regulator_fee + gst_vat + dp_or_clearing
    )
    net_cash_impact = _r2(margin_required + total_charges) if side_u == "BUY" else _r2(margin_required - total_charges)
    eff_pct = round((total_charges / notional) * 100.0, 4) if notional > 0 else 0.0

    # Compute true round-trip breakeven per share using exact opposite-leg statutory rates
    if _compute_breakeven and qty > 0:
        opp_side = "SELL" if side_u == "BUY" else "BUY"
        opp_bd = calculate_order_charges(
            symbol=symbol,
            quantity=qty,
            price=px,
            side=opp_side,
            product_type=prod_u,
            broker_plan=plan_u,
            region=country,
            exchange=exch,
            currency=curr,
            category=cat,
            fx_quote_to_settle=fx_scale,
            _compute_breakeven=False,
        )
        be_dec = 8 if px < 0.0001 else (6 if px < 0.01 else (5 if (country == "FOREX" and px < 50) else (4 if px < 10 else 2)))
        breakeven_delta = round((total_charges + opp_bd.total_charges) / (qty * fx_scale), be_dec)
    else:
        breakeven_delta = 0.0

    return ChargeBreakdown(
        country=country,
        sub_jurisdiction=sub,
        exchange=exch,
        currency=curr,
        side=side_u,
        product_type=prod_u,
        broker_plan=plan_u,
        category=cat,
        quantity=qty,
        price=px,
        notional=_r2(notional),
        margin_required=_r2(margin_required),
        leverage=leverage,
        brokerage=brokerage,
        stt_or_ftt=stt_or_ftt,
        stamp_duty=stamp_duty,
        exchange_fee=exchange_fee,
        regulator_fee=regulator_fee,
        gst_vat=gst_vat,
        dp_or_clearing_fee=dp_or_clearing,
        total_charges=total_charges,
        net_cash_impact=net_cash_impact,
        effective_rate_pct=eff_pct,
        breakeven_delta=breakeven_delta,
        tax_notes=notes,
        line_items=items,
    )


def estimate_capital_gains_tax_rate(country: str, product_type: str = "DELIVERY") -> tuple[float, str]:
    """Returns estimated realized profit tax rate (%) and statutory label per country."""
    c = (country or "USA").upper()
    p = (product_type or "DELIVERY").upper()
    if c == "IND":
        if p == "INTRADAY":
            return 0.30, "India Speculative Income (30% Est. Slab)"
        if p in ("FUTURES", "OPTIONS"):
            return 0.30, "India F&O Business Income (30% Est. Slab)"
        return 0.20, "India STCG Sec 111A (20%)"
    if c == "USA":
        return 0.22, "US Short-Term Cap Gains (22% Est.)"
    if c == "CANADA":
        return 0.15, "Canada CRA Cap Gains (50% Incl. ~15% Eff.)"
    if c == "CHINA":
        return 0.00, "China A-Share Secondary Market (0% Exempt)"
    if c == "EU":
        return 0.25, "EU/UK Capital Gains Reference (25% Est.)"
    if c == "CRYPTO":
        return 0.25, "Crypto VDA Gains Reference (~25% Est.; 30% in India)"
    if c == "FOREX":
        return 0.22, "Forex Sec 988 / Spot FX Tax (~22% Est.)"
    return 0.20, "Estimated Capital Gains Tax (20%)"
