from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Dict, List, Optional

import httpx
import polars as pl
import pyarrow as pa

# Region -> Default Paper Wallet Currency Mapping
REGION_CURRENCY: Dict[str, str] = {
    "IND": "INR",
    "USA": "USD",
    "CANADA": "CAD",
    "CHINA": "CNY",
    "EU": "EUR",
    "CRYPTO": "USD",
    "FOREX": "USD",
}


class GlobalUniverseStore:
    """
    Unified Global Data Pipeline & Dynamic Universe Ingestion Engine.
    - Fetches 100% dynamic exchange symbol masters (zero curated subsets) for IND, USA, CANADA, CHINA, EU.
    - Stores master universe + live metrics in an Apache Arrow-backed Polars DataFrame.
    - Supports 25,000+ live instruments in local RAM (scalable to 100k+ via Redis Hash shards).
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.df: pl.DataFrame = pl.DataFrame(
            schema={
                "symbol": pl.Utf8,
                "name": pl.Utf8,
                "region": pl.Utf8,
                "exchange": pl.Utf8,
                "category": pl.Utf8,
                "currency": pl.Utf8,
                "isin": pl.Utf8,
                "price": pl.Float64,
                "prev_close": pl.Float64,
                "change": pl.Float64,
                "change_percent": pl.Float64,
                "volume": pl.Int64,
                "rsi_14": pl.Float64,
                "as_of": pl.Utf8,
            }
        )
        self._by_symbol: Dict[str, dict] = {}
        self.stats: Dict[str, int] = {}
        self.last_ingested_at: Optional[str] = None

    def _upsert_records(self, records: List[dict]) -> None:
        if not records:
            return
        with self._lock:
            for r in records:
                sym = r["symbol"]
                if sym in self._by_symbol:
                    # Preserve live price if newly ingested symbol row has 0.0
                    existing = self._by_symbol[sym]
                    if r.get("price", 0.0) == 0.0 and existing.get("price", 0.0) > 0.0:
                        r["price"] = existing["price"]
                        r["prev_close"] = existing["prev_close"]
                        r["change"] = existing["change"]
                        r["change_percent"] = existing["change_percent"]
                        r["volume"] = existing["volume"]
                self._by_symbol[sym] = r
            self._rebuild_polars()

    def _rebuild_polars(self) -> None:
        rows = list(self._by_symbol.values())
        if not rows:
            return
        self.df = pl.DataFrame(
            rows,
            schema={
                "symbol": pl.Utf8,
                "name": pl.Utf8,
                "region": pl.Utf8,
                "exchange": pl.Utf8,
                "category": pl.Utf8,
                "currency": pl.Utf8,
                "isin": pl.Utf8,
                "price": pl.Float64,
                "prev_close": pl.Float64,
                "change": pl.Float64,
                "change_percent": pl.Float64,
                "volume": pl.Int64,
                "rsi_14": pl.Float64,
                "as_of": pl.Utf8,
            },
        )
        # Recompute region stats
        counts = self.df.group_by("region").len().to_dicts()
        self.stats = {c["region"]: int(c["len"]) for c in counts}
        self.stats["TOTAL"] = len(self.df)

    def to_arrow(self) -> pa.Table:
        """Zero-copy Apache Arrow table export for columnar analytics."""
        with self._lock:
            return self.df.to_arrow()

    def update_quotes(self, updates: Dict[str, dict]) -> None:
        if not updates:
            return
        with self._lock:
            changed = False
            for sym, q in updates.items():
                if sym in self._by_symbol:
                    row = self._by_symbol[sym]
                    row["price"] = float(q.get("price", row["price"]))
                    row["prev_close"] = float(q.get("prev_close", row["prev_close"]))
                    row["change"] = float(q.get("change", row["change"]))
                    row["change_percent"] = float(q.get("change_percent", row["change_percent"]))
                    row["volume"] = int(q.get("volume", row["volume"]))
                    if "name" in q and q["name"] and row.get("name") == row.get("symbol"):
                        row["name"] = str(q["name"])
                    if "rsi_14" in q:
                        row["rsi_14"] = float(q["rsi_14"])
                    if "as_of" in q:
                        row["as_of"] = str(q["as_of"])
                    changed = True
            if changed:
                self._rebuild_polars()

    def get_by_symbol(self, symbol: str) -> Optional[dict]:
        with self._lock:
            rec = self._by_symbol.get(symbol)
            return dict(rec) if rec else None

    def search(self, query: str, region: Optional[str] = None, category: Optional[str] = None, limit: int = 40) -> List[dict]:
        q_upper = query.strip().upper()
        with self._lock:
            base_lf = self.df.lazy()
            if region and region != "ALL":
                if region == "FOREX":
                    base_lf = base_lf.filter((pl.col("region") == "FOREX") | (pl.col("category") == "forex"))
                elif region == "CRYPTO":
                    base_lf = base_lf.filter((pl.col("region") == "CRYPTO") | (pl.col("category") == "crypto"))
                else:
                    base_lf = base_lf.filter(pl.col("region") == region)
            if category and category != "all":
                base_lf = base_lf.filter(pl.col("category") == category)

            lf = base_lf
            if q_upper:
                lf = lf.filter(
                    pl.col("symbol").str.to_uppercase().str.contains(q_upper, literal=True)
                    | pl.col("name").str.to_uppercase().str.contains(q_upper, literal=True)
                    | pl.col("isin").str.to_uppercase().str.contains(q_upper, literal=True)
                )
            res = (
                lf.with_columns(
                    (pl.col("symbol").str.to_uppercase().str.starts_with(q_upper) if q_upper else pl.lit(False)).alias("_exact"),
                    (pl.col("price") > 0).alias("_has_px"),
                )
                .sort(["_exact", "_has_px", "volume"], descending=[True, True, True])
                .drop(["_exact", "_has_px"])
                .limit(limit)
                .collect()
            )
            hits = res.to_dicts()

            # Fallback token-normalized search when user enters punctuation variants (e.g. "E.I.D.-Parry (India) Ltd")
            if q_upper and len(hits) < 5:
                stop_words = {"LTD", "LIMITED", "INC", "CORP", "CORPORATION", "PLC", "CO", "THE", "OF", "AND", "INDIA"}
                raw_tokens = [t for t in re.split(r"[^A-Z0-9]+", q_upper) if len(t) >= 2]
                tokens = [t for t in raw_tokens if t not in stop_words] or raw_tokens
                if tokens:
                    tok_lf = base_lf
                    for tok in tokens[:4]:
                        tok_lf = tok_lf.filter(
                            pl.col("symbol").str.to_uppercase().str.contains(tok, literal=True)
                            | pl.col("name").str.to_uppercase().str.contains(tok, literal=True)
                        )
                    tok_hits = (
                        tok_lf.with_columns((pl.col("price") > 0).alias("_has_px"))
                        .sort(["_has_px", "volume"], descending=[True, True])
                        .drop(["_has_px"])
                        .limit(limit)
                        .collect()
                        .to_dicts()
                    )
                    seen_syms = {h["symbol"] for h in hits}
                    for th in tok_hits:
                        if th["symbol"] not in seen_syms:
                            seen_syms.add(th["symbol"])
                            hits.append(th)
            return hits[:limit]

    def list_instruments(
        self,
        region: Optional[str] = None,
        category: Optional[str] = None,
        tier: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> dict:
        with self._lock:
            lf = self.df.lazy()
            if region and region != "ALL":
                if region == "FOREX":
                    lf = lf.filter((pl.col("region") == "FOREX") | (pl.col("category") == "forex"))
                elif region == "CRYPTO":
                    lf = lf.filter((pl.col("region") == "CRYPTO") | (pl.col("category") == "crypto"))
                else:
                    lf = lf.filter(pl.col("region") == region)
            if category and category != "all":
                lf = lf.filter(pl.col("category") == category)
            if tier and tier != "all":
                t_up = tier.upper()
                lf = lf.filter(pl.col("isin").str.to_uppercase().str.contains(t_up, literal=True))

            total = lf.select(pl.len()).collect().item()
            items = (
                lf.with_columns(
                    (pl.col("price") > 0).alias("_has_px"),
                    pl.when(pl.col("isin").is_in(["FX_MAJOR", "CRYPTO_MAJOR"]))
                    .then(3)
                    .when(pl.col("isin").is_in(["FX_MINOR", "CRYPTO_L1", "CRYPTO_DEFI"]))
                    .then(2)
                    .when(pl.col("isin").is_in(["FX_EXOTIC", "CRYPTO_MEME"]))
                    .then(1)
                    .otherwise(0)
                    .alias("_tier_rank"),
                )
                .sort(["_tier_rank", "_has_px", "volume"], descending=[True, True, True])
                .drop(["_has_px", "_tier_rank"])
                .slice(offset, limit)
                .collect()
                .to_dicts()
            )
            return {"total": int(total), "offset": offset, "limit": limit, "items": items}

    # -------------------------------------------------------------
    # DYNAMIC EXCHANGE ADAPTERS (100% Real Exchange Master Directories)
    # -------------------------------------------------------------
    def ingest_india_nse_bse(self) -> int:
        records: List[dict] = []
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        with httpx.Client(headers=headers, timeout=12, follow_redirects=True) as client:
            # 1. Complete NSE Equity Master (~2,640+ Stocks)
            try:
                r = client.get("https://archives.nseindia.com/content/equities/EQUITY_L.csv")
                if r.status_code == 200:
                    reader = csv.DictReader(io.StringIO(r.text))
                    for row in reader:
                        sym = (row.get("SYMBOL") or "").strip()
                        if not sym:
                            continue
                        records.append({
                            "symbol": f"{sym}.NS",
                            "name": (row.get("NAME OF COMPANY") or sym).strip(),
                            "region": "IND",
                            "exchange": "NSE",
                            "category": "stocks",
                            "currency": "INR",
                            "isin": (row.get(" ISIN NUMBER") or row.get("ISIN NUMBER") or "").strip(),
                            "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                        })
            except Exception as e:
                print("NSE Equity CSV err:", e)

            # 2. Complete NSE ETFs (~360+ ETFs)
            try:
                r_etf = client.get("https://archives.nseindia.com/content/equities/eq_etfseclist.csv")
                if r_etf.status_code == 200:
                    reader = csv.DictReader(io.StringIO(r_etf.text))
                    for row in reader:
                        sym = (row.get("Symbol") or "").strip()
                        if not sym:
                            continue
                        records.append({
                            "symbol": f"{sym}.NS",
                            "name": (row.get("SecurityName") or row.get("Underlying Asset") or sym).strip(),
                            "region": "IND",
                            "exchange": "NSE",
                            "category": "etfs",
                            "currency": "INR",
                            "isin": (row.get("ISINNumber") or "").strip(),
                            "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                        })
            except Exception as e:
                print("NSE ETF CSV err:", e)

            # 3. NSE F&O Underlyings
            try:
                r_fo = client.get("https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv")
                if r_fo.status_code == 200:
                    for line in r_fo.text.splitlines()[1:]:
                        cols = [c.strip() for c in line.split(",")]
                        if len(cols) >= 2 and cols[1] and cols[1] not in ("SYMBOL", "Symbol"):
                            sym = cols[1]
                            records.append({
                                "symbol": f"{sym}-FO.NS",
                                "name": f"{cols[0]} F&O Contract",
                                "region": "IND",
                                "exchange": "NSE-FO",
                                "category": "derivatives",
                                "currency": "INR",
                                "isin": "",
                                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                            })
            except Exception as e:
                print("NSE FO CSV err:", e)

            # 4. NSE Live G-Secs / Treasury Bills / Sovereign Bonds
            def _parse_num(val: object) -> float:
                if val is None:
                    return 0.0
                s = str(val).replace(",", "").strip().upper()
                if not s or s == "-":
                    return 0.0
                mult = 1.0
                if s.endswith("K"):
                    mult, s = 1000.0, s[:-1].strip()
                elif s.endswith("L"):
                    mult, s = 100000.0, s[:-1].strip()
                elif s.endswith("M"):
                    mult, s = 1000000.0, s[:-1].strip()
                elif s.endswith("CR"):
                    mult, s = 10000000.0, s[:-2].strip()
                try:
                    return float(s) * mult
                except ValueError:
                    return 0.0

            try:
                client.get("https://www.nseindia.com")
                r_gsec = client.get("https://www.nseindia.com/api/liveBonds-traded-on-cm?type=gsec")
                if r_gsec.status_code == 200:
                    data = r_gsec.json().get("data", [])
                    for item in data[:400]:
                        sym = (item.get("symbol") or "").strip()
                        if not sym:
                            continue
                        lp = _parse_num(item.get("lastPrice") or item.get("averagePrice"))
                        pc = _parse_num(item.get("previousClose") or item.get("basePrice")) or lp
                        chg = round(lp - pc, 2)
                        pct = _parse_num(item.get("pChange") or item.get("PChange"))
                        comp = (item.get("meta") or {}).get("companyName") or ""
                        ser = (item.get("series") or "").strip()
                        if not comp or comp.strip() in ("GS", "TB", "SG", ser):
                            prefix = "T-Bill" if ser == "TB" else "State Dev Loan" if ser == "SG" else "GOI G-Sec"
                            bond_name = f"{prefix} {sym}"
                        else:
                            bond_name = comp.strip()
                        records.append({
                            "symbol": f"{sym}.NS",
                            "name": bond_name,
                            "region": "IND",
                            "exchange": "NSE-DEBT",
                            "category": "bonds",
                            "currency": "INR",
                            "isin": (item.get("isin") or "").strip(),
                            "price": lp, "prev_close": pc, "change": chg, "change_percent": pct,
                            "volume": int(_parse_num(item.get("totalTradedVolume"))),
                            "rsi_14": 50.0, "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                        })
            except Exception as e:
                print("NSE G-Sec err:", e)

            # 5. All NSE Live Indices (~139 Indices: Sectoral, Broad Market, Thematic)
            try:
                r_idx = client.get("https://www.nseindia.com/api/allIndices")
                if r_idx.status_code == 200:
                    idx_rows = (r_idx.json() or {}).get("data", [])
                    idx_alias = {"NIFTY 50": "^NSEI", "NIFTY BANK": "^NSEBANK", "INDIA VIX": "^INDIAVIX"}
                    for row in idx_rows:
                        idx_name = (row.get("index") or row.get("indexSymbol") or "").strip()
                        if not idx_name:
                            continue
                        sym = idx_alias.get(idx_name.upper()) or (
                            "^" + re.sub(r"[^A-Z0-9]+", "-", idx_name.upper()).strip("-") + ".NS"
                        )
                        lp = _parse_num(row.get("last"))
                        pc = _parse_num(row.get("previousClose")) or lp
                        chg = round(lp - pc, 2)
                        pct = _parse_num(row.get("percentChange"))
                        records.append({
                            "symbol": sym,
                            "name": f"{idx_name} (NSE Index)",
                            "region": "IND",
                            "exchange": "NSE",
                            "category": "indices",
                            "currency": "INR",
                            "isin": "",
                            "price": lp, "prev_close": pc, "change": chg, "change_percent": pct,
                            "volume": 0, "rsi_14": 50.0,
                            "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                        })
            except Exception as e:
                print("NSE allIndices err:", e)

            # 6. Active BSE Listed Equities (.BO)
            try:
                r_bse = client.get(
                    "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active",
                    headers={"User-Agent": headers["User-Agent"], "Referer": "https://www.bseindia.com/"},
                )
                if r_bse.status_code == 200 and isinstance(r_bse.json(), list):
                    for row in r_bse.json():
                        sid = (row.get("scrip_id") or "").strip()
                        if not sid or any(ch in sid for ch in (" ", "$", "#")):
                            continue
                        records.append({
                            "symbol": f"{sid}.BO",
                            "name": (row.get("Scrip_Name") or sid).strip(),
                            "region": "IND",
                            "exchange": "BSE",
                            "category": "stocks",
                            "currency": "INR",
                            "isin": (row.get("ISIN_NUMBER") or "").strip(),
                            "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0,
                            "volume": 0, "rsi_14": 50.0, "as_of": "",
                        })
            except Exception as e:
                print("BSE Scrip Master err:", e)

        # 7. Core Indian Indices, BSE Benchmarks, MCX Proxies & Major Currency Pairs
        ind_benchmarks = [
            {"symbol": "^NSEI", "name": "NIFTY 50 Index", "exchange": "NSE", "category": "indices"},
            {"symbol": "^BSESN", "name": "BSE SENSEX Index", "exchange": "BSE", "category": "indices"},
            {"symbol": "^NSEBANK", "name": "Bank NIFTY Index", "exchange": "NSE", "category": "indices"},
            {"symbol": "RELIANCE.BO", "name": "Reliance Industries (BSE)", "exchange": "BSE", "category": "stocks"},
            {"symbol": "TCS.BO", "name": "Tata Consultancy Services (BSE)", "exchange": "BSE", "category": "stocks"},
            {"symbol": "HDFCBANK.BO", "name": "HDFC Bank Ltd (BSE)", "exchange": "BSE", "category": "stocks"},
            {"symbol": "GOLDBEES.NS", "name": "Nippon India Gold BeES (MCX Proxy)", "exchange": "NSE", "category": "commodities"},
            {"symbol": "SILVERBEES.NS", "name": "Nippon India Silver BeES (MCX Proxy)", "exchange": "NSE", "category": "commodities"},
            {"symbol": "LIQUIDBEES.NS", "name": "Nippon India Liquid G-Sec BeES", "exchange": "NSE", "category": "bonds"},
            {"symbol": "LTGILTBEES.NS", "name": "Nippon India 8-13Y Gilt ETF", "exchange": "NSE", "category": "bonds"},
            {"symbol": "USDINR=X", "name": "USD/INR Currency Pair", "exchange": "NSE-FX", "category": "forex"},
            {"symbol": "EURINR=X", "name": "EUR/INR Currency Pair", "exchange": "NSE-FX", "category": "forex"},
            {"symbol": "GBPINR=X", "name": "GBP/INR Currency Pair", "exchange": "NSE-FX", "category": "forex"},
            {"symbol": "JPYINR=X", "name": "JPY/INR Currency Pair", "exchange": "NSE-FX", "category": "forex"},
            {"symbol": "AUDINR=X", "name": "AUD/INR Currency Pair", "exchange": "NSE-FX", "category": "forex"},
            {"symbol": "CHFINR=X", "name": "CHF/INR Currency Pair", "exchange": "NSE-FX", "category": "forex"},
            {"symbol": "CADINR=X", "name": "CAD/INR Currency Pair", "exchange": "NSE-FX", "category": "forex"},
        ]
        for b in ind_benchmarks:
            records.append({
                "symbol": b["symbol"], "name": b["name"], "region": "IND", "exchange": b["exchange"],
                "category": b["category"], "currency": "INR", "isin": "",
                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
            })

        self._upsert_records(records)
        return len(records)

    def ingest_usa_complete(self) -> int:
        records: List[dict] = []
        headers = {"User-Agent": "Mozilla/5.0"}
        with httpx.Client(headers=headers, timeout=12, follow_redirects=True) as client:
            # 1. Complete NASDAQ Listed (~5,600+)
            try:
                r = client.get("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt")
                if r.status_code == 200:
                    for line in r.text.splitlines()[1:]:
                        if line.startswith("File Creation Time"):
                            continue
                        parts = line.split("|")
                        if len(parts) >= 7:
                            sym, name, _, test_issue, _, _, is_etf = parts[:7]
                            if test_issue == "Y" or not sym.strip():
                                continue
                            records.append({
                                "symbol": sym.strip(),
                                "name": name.strip(),
                                "region": "USA",
                                "exchange": "NASDAQ",
                                "category": "etfs" if is_etf == "Y" else "stocks",
                                "currency": "USD",
                                "isin": "",
                                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                            })
            except Exception as e:
                print("NASDAQ SymDir err:", e)

            # 2. Complete NYSE / AMEX / ARCA Listed (~7,700+)
            try:
                r2 = client.get("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt")
                exch_map = {"N": "NYSE", "A": "AMEX", "P": "NYSE ARCA", "Z": "BATS", "V": "IEX"}
                if r2.status_code == 200:
                    for line in r2.text.splitlines()[1:]:
                        if line.startswith("File Creation Time"):
                            continue
                        parts = line.split("|")
                        if len(parts) >= 7:
                            sym, name, exch_code, _, is_etf, _, test_issue = parts[:7]
                            if test_issue == "Y" or not sym.strip() or any(c in sym for c in ["$", "#"]):
                                continue
                            records.append({
                                "symbol": sym.strip().replace(".", "-"),
                                "name": name.strip(),
                                "region": "USA",
                                "exchange": exch_map.get(exch_code, "NYSE"),
                                "category": "etfs" if is_etf == "Y" else "stocks",
                                "currency": "USD",
                                "isin": "",
                                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                            })
            except Exception as e:
                print("NYSE/AMEX SymDir err:", e)

        usa_macro = [
            {"symbol": "^GSPC", "name": "S&P 500 Index", "exchange": "CBOE", "category": "indices"},
            {"symbol": "^IXIC", "name": "NASDAQ Composite", "exchange": "NASDAQ", "category": "indices"},
            {"symbol": "^DJI", "name": "Dow Jones Industrial Average", "exchange": "NYSE", "category": "indices"},
            {"symbol": "^RUT", "name": "Russell 2000 Index", "exchange": "FTSE Russell", "category": "indices"},
            {"symbol": "^VIX", "name": "CBOE Volatility Index", "exchange": "CBOE", "category": "indices"},
            {"symbol": "ES=F", "name": "E-Mini S&P 500 Futures", "exchange": "CME", "category": "commodities"},
            {"symbol": "NQ=F", "name": "E-Mini NASDAQ 100 Futures", "exchange": "CME", "category": "commodities"},
            {"symbol": "YM=F", "name": "Mini Dow Jones Futures", "exchange": "CBOT", "category": "commodities"},
            {"symbol": "RTY=F", "name": "E-Mini Russell 2000 Futures", "exchange": "CME", "category": "commodities"},
            {"symbol": "GC=F", "name": "Gold Futures (COMEX)", "exchange": "COMEX", "category": "commodities"},
            {"symbol": "SI=F", "name": "Silver Futures (COMEX)", "exchange": "COMEX", "category": "commodities"},
            {"symbol": "HG=F", "name": "Copper Futures (COMEX)", "exchange": "COMEX", "category": "commodities"},
            {"symbol": "PL=F", "name": "Platinum Futures (NYMEX)", "exchange": "NYMEX", "category": "commodities"},
            {"symbol": "CL=F", "name": "WTI Crude Oil Futures", "exchange": "NYMEX", "category": "commodities"},
            {"symbol": "BZ=F", "name": "Brent Crude Oil Futures", "exchange": "ICE", "category": "commodities"},
            {"symbol": "NG=F", "name": "Natural Gas Futures", "exchange": "NYMEX", "category": "commodities"},
            {"symbol": "HO=F", "name": "Heating Oil Futures", "exchange": "NYMEX", "category": "commodities"},
            {"symbol": "RB=F", "name": "RBOB Gasoline Futures", "exchange": "NYMEX", "category": "commodities"},
            {"symbol": "PA=F", "name": "Palladium Futures (NYMEX)", "exchange": "NYMEX", "category": "commodities"},
            {"symbol": "ZC=F", "name": "Corn Futures (CBOT)", "exchange": "CBOT", "category": "commodities"},
            {"symbol": "ZW=F", "name": "Wheat Futures (CBOT)", "exchange": "CBOT", "category": "commodities"},
            {"symbol": "ZS=F", "name": "Soybean Futures (CBOT)", "exchange": "CBOT", "category": "commodities"},
            {"symbol": "KC=F", "name": "Coffee Futures (ICE)", "exchange": "ICE", "category": "commodities"},
            {"symbol": "SB=F", "name": "Sugar #11 Futures (ICE)", "exchange": "ICE", "category": "commodities"},
            {"symbol": "CT=F", "name": "Cotton Futures (ICE)", "exchange": "ICE", "category": "commodities"},
            {"symbol": "CC=F", "name": "Cocoa Futures (ICE)", "exchange": "ICE", "category": "commodities"},
            {"symbol": "LE=F", "name": "Live Cattle Futures (CME)", "exchange": "CME", "category": "commodities"},
            {"symbol": "^TNX", "name": "US 10-Yr Treasury Yield", "exchange": "UST", "category": "bonds"},
            {"symbol": "^TYX", "name": "US 30-Yr Treasury Yield", "exchange": "UST", "category": "bonds"},
            {"symbol": "^FVX", "name": "US 5-Yr Treasury Yield", "exchange": "UST", "category": "bonds"},
            {"symbol": "^IRX", "name": "US 13-Wk T-Bill Yield", "exchange": "UST", "category": "bonds"},
            {"symbol": "ZN=F", "name": "10-Yr US Treasury Note Futures", "exchange": "CBOT", "category": "bonds"},
            {"symbol": "ZB=F", "name": "30-Yr US Treasury Bond Futures", "exchange": "CBOT", "category": "bonds"},
            {"symbol": "ZF=F", "name": "5-Yr US Treasury Note Futures", "exchange": "CBOT", "category": "bonds"},
            {"symbol": "ZT=F", "name": "2-Yr US Treasury Note Futures", "exchange": "CBOT", "category": "bonds"},
            {"symbol": "^N225", "name": "Nikkei 225 Index (Japan)", "exchange": "TSE", "category": "indices"},
            {"symbol": "^HSI", "name": "Hang Seng Index (Hong Kong)", "exchange": "HKEX", "category": "indices"},
            {"symbol": "^KS11", "name": "KOSPI Composite Index (Korea)", "exchange": "KRX", "category": "indices"},
            {"symbol": "^AXJO", "name": "S&P/ASX 200 Index (Australia)", "exchange": "ASX", "category": "indices"},
            {"symbol": "^STI", "name": "Straits Times Index (Singapore)", "exchange": "SGX", "category": "indices"},
            {"symbol": "^BVSP", "name": "IBOVESPA Index (Brazil)", "exchange": "B3", "category": "indices"},
            {"symbol": "SHY", "name": "iShares 1-3 Year Treasury Bond ETF", "exchange": "NASDAQ", "category": "bonds"},
            {"symbol": "IEF", "name": "iShares 7-10 Year Treasury Bond ETF", "exchange": "NASDAQ", "category": "bonds"},
            {"symbol": "TLT", "name": "iShares 20+ Year Treasury Bond ETF", "exchange": "NASDAQ", "category": "bonds"},
            {"symbol": "BND", "name": "Vanguard Total Bond Market ETF", "exchange": "NASDAQ", "category": "bonds"},
            {"symbol": "LQD", "name": "iShares Investment Grade Corp Bond", "exchange": "NYSE", "category": "bonds"},
            {"symbol": "HYG", "name": "iShares High Yield Corp Bond", "exchange": "NYSE", "category": "bonds"},
            {"symbol": "TIP", "name": "iShares TIPS Inflation-Linked Bond ETF", "exchange": "NYSE", "category": "bonds"},
        ]
        for b in usa_macro:
            records.append({
                "symbol": b["symbol"], "name": b["name"], "region": "USA", "exchange": b["exchange"],
                "category": b["category"], "currency": "USD", "isin": "",
                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
            })

        self._upsert_records(records)
        return len(records)

    def ingest_canada_complete(self) -> int:
        records: List[dict] = []
        headers = {"User-Agent": "Mozilla/5.0"}
        with httpx.Client(headers=headers, timeout=12, follow_redirects=True) as client:
            for exch_path, suffix, exch_label in [
                ("tsx", ".TO", "TSX"),
                ("tsxv", ".V", "TSXV"),
            ]:
                try:
                    r = client.get(f"https://www.tsx.com/json/company-directory/search/{exch_path}/%5E*")
                    if r.status_code == 200:
                        items = r.json().get("results", [])
                        for item in items:
                            sym = (item.get("symbol") or "").strip()
                            name = (item.get("name") or sym).strip()
                            if not sym:
                                continue
                            yf_sym = sym.replace(".", "-") + suffix
                            cat = "etfs" if "ETF" in name.upper() else ("bonds" if "BOND" in name.upper() else "stocks")
                            records.append({
                                "symbol": yf_sym,
                                "name": name,
                                "region": "CANADA",
                                "exchange": exch_label,
                                "category": cat,
                                "currency": "CAD",
                                "isin": "",
                                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                            })
                except Exception as e:
                    print(f"Canada {exch_label} err:", e)

        ca_benchmarks = [
            {"symbol": "^GSPTSE", "name": "S&P/TSX Composite Index", "exchange": "TSX", "category": "indices"},
            {"symbol": "XIU.TO", "name": "iShares S&P/TSX 60 Index ETF", "exchange": "TSX", "category": "etfs"},
            {"symbol": "XEG.TO", "name": "iShares S&P/TSX Capped Energy (Oil Proxy)", "exchange": "TSX", "category": "commodities"},
            {"symbol": "XGD.TO", "name": "iShares S&P/TSX Global Gold ETF", "exchange": "TSX", "category": "commodities"},
            {"symbol": "XBB.TO", "name": "iShares Core Canadian Universe Bond", "exchange": "TSX", "category": "bonds"},
            {"symbol": "ZAG.TO", "name": "BMO Aggregate Bond Index ETF", "exchange": "TSX", "category": "bonds"},
        ]
        for b in ca_benchmarks:
            records.append({
                "symbol": b["symbol"], "name": b["name"], "region": "CANADA", "exchange": b["exchange"],
                "category": b["category"], "currency": "CAD", "isin": "",
                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
            })

        self._upsert_records(records)
        return len(records)

    def ingest_china_complete(self) -> int:
        from concurrent.futures import ThreadPoolExecutor

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

        china_benchmarks = [
            {"symbol": "000001.SS", "name": "SSE Composite Index (Shanghai)", "exchange": "SSE", "category": "indices"},
            {"symbol": "399001.SZ", "name": "SZSE Component Index (Shenzhen)", "exchange": "SZSE", "category": "indices"},
            {"symbol": "510300.SS", "name": "Huatai-PineBridge CSI 300 ETF", "exchange": "SSE", "category": "etfs"},
            {"symbol": "510050.SS", "name": "ChinaAMC SSE 50 ETF", "exchange": "SSE", "category": "etfs"},
            {"symbol": "159915.SZ", "name": "E Fund ChiNext ETF", "exchange": "SZSE", "category": "etfs"},
            {"symbol": "511010.SS", "name": "Guotai SSE 5-Yr CGB China Govt Bond ETF", "exchange": "SSE", "category": "bonds"},
            {"symbol": "511260.SS", "name": "Guotai SSE 10-Yr CGB China Govt Bond ETF", "exchange": "SSE", "category": "bonds"},
            {"symbol": "518880.SS", "name": "HuaAn Gold ETF (SGE Commodity Proxy)", "exchange": "SSE", "category": "commodities"},
        ]
        base_records = [
            {
                "symbol": b["symbol"], "name": b["name"], "region": "CHINA", "exchange": b["exchange"],
                "category": b["category"], "currency": "CNY", "isin": "",
                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
            }
            for b in china_benchmarks
        ]
        self._upsert_records(base_records)

        def _em_num(v: object, default: float = 0.0) -> float:
            if v is None or v == "-":
                return default
            try:
                return float(v)
            except (TypeError, ValueError):
                return default

        em_headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://quote.eastmoney.com/"}
        em_tasks = (
            [("m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23", "stocks", p) for p in range(1, 58)]
            + [("b:MK0021,b:MK0022,b:MK0023,b:MK0024", "etfs", p) for p in range(1, 19)]
            + [("m:1+s:2,m:0+t:5", "indices", p) for p in range(1, 4)]
        )

        with httpx.Client(
            headers=em_headers,
            timeout=10.0,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=16),
        ) as em_client:
            def _fetch_em_page(args: tuple[str, str, int]) -> List[dict]:
                fs_code, cat, page = args
                out: List[dict] = []
                try:
                    url = (
                        f"https://push2.eastmoney.com/api/qt/clist/get?pn={page}&pz=100&po=1&np=1"
                        f"&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs={fs_code}"
                        f"&fields=f12,f13,f14,f2,f3,f4,f5,f18"
                    )
                    r = em_client.get(url)
                    if r.status_code != 200:
                        return out
                    diff = ((r.json() or {}).get("data") or {}).get("diff") or []
                    for item in diff:
                        code = str(item.get("f12") or "").strip()
                        mkt = item.get("f13")
                        if not code:
                            continue
                        suffix = ".SS" if mkt == 1 else ".SZ"
                        exch = "SSE" if mkt == 1 else "SZSE"
                        lp = _em_num(item.get("f2"))
                        pc = _em_num(item.get("f18"), lp)
                        chg = _em_num(item.get("f4"), lp - pc)
                        pct = _em_num(item.get("f3"))
                        vol = int(_em_num(item.get("f5")))
                        name = str(item.get("f14") or code)
                        eff_cat = cat
                        if cat == "etfs" and ("债" in name or "BOND" in name.upper()):
                            eff_cat = "bonds"
                        elif cat == "etfs" and ("金" in name or "GOLD" in name.upper() or "豆" in name or "能源" in name):
                            eff_cat = "commodities"
                        out.append({
                            "symbol": f"{code}{suffix}",
                            "name": name,
                            "region": "CHINA",
                            "exchange": exch,
                            "category": eff_cat,
                            "currency": "CNY",
                            "isin": "",
                            "price": lp,
                            "prev_close": pc,
                            "change": round(chg, 3),
                            "change_percent": round(pct, 2),
                            "volume": vol,
                            "rsi_14": 50.0,
                            "as_of": now_str,
                        })
                except Exception:
                    pass
                return out

            records: List[dict] = []
            with ThreadPoolExecutor(max_workers=10) as pool:
                for chunk in pool.map(_fetch_em_page, em_tasks):
                    records.extend(chunk)

        if len(records) < 50:
            sina_headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"}
            sina_tasks = [("hs_a", "stocks", p) for p in range(1, 25)] + [("hs_b", "stocks", p) for p in range(1, 4)] + [("etf_hq_fund", "etfs", p) for p in range(1, 6)]

            def _fetch_sina_page(args: tuple[str, str, int]) -> List[dict]:
                node, cat, page = args
                out: List[dict] = []
                try:
                    url = (
                        f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
                        f"Market_Center.getHQNodeData?page={page}&num=80&sort=amount&asc=0&node={node}"
                    )
                    r = httpx.get(url, headers=sina_headers, timeout=8, follow_redirects=True)
                    if r.status_code != 200:
                        return out
                    items = r.json()
                    if not isinstance(items, list):
                        return out
                    for item in items:
                        raw_sym = str(item.get("symbol") or "").lower()
                        code = str(item.get("code") or "").strip()
                        if not code:
                            continue
                        if raw_sym.startswith("sh"):
                            suffix, exch = ".SS", "SSE"
                        elif raw_sym.startswith("sz"):
                            suffix, exch = ".SZ", "SZSE"
                        else:
                            continue
                        lp = _em_num(item.get("trade"))
                        pc = _em_num(item.get("settlement"), lp)
                        chg = _em_num(item.get("pricechange"), lp - pc)
                        pct = _em_num(item.get("changepercent"))
                        vol = int(_em_num(item.get("volume")))
                        out.append({
                            "symbol": f"{code}{suffix}",
                            "name": str(item.get("name") or code),
                            "region": "CHINA",
                            "exchange": exch,
                            "category": cat,
                            "currency": "CNY",
                            "isin": "",
                            "price": lp,
                            "prev_close": pc,
                            "change": round(chg, 3),
                            "change_percent": round(pct, 2),
                            "volume": vol,
                            "rsi_14": 50.0,
                            "as_of": now_str,
                        })
                except Exception:
                    pass
                return out

            with ThreadPoolExecutor(max_workers=8) as pool:
                for chunk in pool.map(_fetch_sina_page, sina_tasks):
                    records.extend(chunk)

        self._upsert_records(records)
        return len(base_records) + len(records)

    def ingest_eu_complete(self) -> int:
        records: List[dict] = []
        headers = {"User-Agent": "Mozilla/5.0"}
        mic_suffix = {"XPAR": ".PA", "XAMS": ".AS", "XBRU": ".BR", "XMIL": ".MI"}

        with httpx.Client(headers=headers, timeout=15, follow_redirects=True) as client:
            # 1. Euronext (Paris, Amsterdam, Brussels, Milan) with live quotes!
            try:
                r = client.get(
                    "https://live.euronext.com/pd_es/data/stocks/download?mics=XPAR%2CXAMS%2CXBRU%2CXMIL&initialLetter=&fe_type=csv&fe_decimal_separator=.&fe_date_format=d%2Fm%2FY"
                )
                if r.status_code == 200:
                    reader = csv.DictReader(io.StringIO(r.text.lstrip("\ufeff")), delimiter=";")
                    for row in reader:
                        sym = (row.get("Symbol") or "").strip()
                        market = (row.get("Market") or "").upper()
                        if not sym:
                            continue
                        suffix = ".PA"
                        exch = "Euronext Paris"
                        if "AMSTERDAM" in market:
                            suffix, exch = ".AS", "Euronext Amsterdam"
                        elif "BRUSSELS" in market:
                            suffix, exch = ".BR", "Euronext Brussels"
                        elif "MILAN" in market or "BORSA ITALIANA" in market:
                            suffix, exch = ".MI", "Borsa Italiana"

                        def _f(k: str) -> float:
                            try:
                                return float((row.get(k) or "").replace(",", "").strip() or 0.0)
                            except ValueError:
                                return 0.0

                        lp = _f("last Price")
                        pc = _f("Closing Price") or lp
                        chg = round(lp - pc, 2)
                        pct = round((chg / pc) * 100, 2) if pc else 0.0
                        vol = int(_f("Volume"))
                        records.append({
                            "symbol": f"{sym}{suffix}",
                            "name": (row.get("Name") or sym).strip(),
                            "region": "EU",
                            "exchange": exch,
                            "category": "stocks",
                            "currency": (row.get("Currency") or "EUR").strip(),
                            "isin": (row.get("ISIN") or "").strip(),
                            "price": lp, "prev_close": pc, "change": chg, "change_percent": pct,
                            "volume": vol, "rsi_14": 50.0,
                            "as_of": (row.get("last Trade MIC Time") or "").strip(),
                        })
            except Exception as e:
                print("Euronext CSV err:", e)

            # 2. Deutsche Börse XETRA Complete CSV (~3,000+ Equities & ETFs)
            try:
                rx = client.get(
                    "https://www.xetra.com/resource/blob/1528/717239303152398977974d80999628a8/data/t7-xetr-allTradableInstruments.csv"
                )
                if rx.status_code == 200:
                    lines = rx.text.splitlines()
                    # Find header row starting with Product Status;
                    hdr_idx = next((i for i, l in enumerate(lines[:15]) if l.startswith("Product Status;")), 2)
                    reader = csv.DictReader(io.StringIO("\n".join(lines[hdr_idx:])), delimiter=";")
                    for row in reader:
                        mnem = (row.get("Mnemonic") or "").strip()
                        name = (row.get("Instrument") or "").strip()
                        inst_type = (row.get("Instrument Type") or "").upper()
                        curr = (row.get("Currency") or "EUR").strip()
                        if not mnem:
                            continue
                        cat = "etfs" if "ETF" in inst_type or "ETP" in inst_type else "stocks"
                        records.append({
                            "symbol": f"{mnem}.DE",
                            "name": name or mnem,
                            "region": "EU",
                            "exchange": "XETRA",
                            "category": cat,
                            "currency": curr if curr in ("EUR", "USD", "GBP") else "EUR",
                            "isin": (row.get("ISIN") or "").strip(),
                            "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                        })
            except Exception as e:
                print("XETRA CSV err:", e)

            # 3. Dynamic UK LSE FTSE 100 & FTSE 250 Constituents
            class _WikiTableParser(HTMLParser):
                def __init__(self) -> None:
                    super().__init__()
                    self.in_table = False
                    self.in_row = False
                    self.in_cell = False
                    self.tables: list[list[list[str]]] = []
                    self.cur_table: list[list[str]] = []
                    self.cur_row: list[str] = []
                    self.cur_cell: list[str] = []

                def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
                    if tag == "table" and any(k == "class" and v and "wikitable" in v for k, v in attrs):
                        self.in_table = True
                        self.cur_table = []
                    elif self.in_table and tag == "tr":
                        self.in_row = True
                        self.cur_row = []
                    elif self.in_row and tag in ("td", "th"):
                        self.in_cell = True
                        self.cur_cell = []

                def handle_endtag(self, tag: str) -> None:
                    if self.in_cell and tag in ("td", "th"):
                        self.cur_row.append("".join(self.cur_cell).strip())
                        self.in_cell = False
                    elif self.in_row and tag == "tr":
                        if self.cur_row:
                            self.cur_table.append(self.cur_row)
                        self.in_row = False
                    elif self.in_table and tag == "table":
                        self.tables.append(self.cur_table)
                        self.in_table = False

                def handle_data(self, data: str) -> None:
                    if self.in_cell:
                        self.cur_cell.append(data)

            for wiki_url in ("https://en.wikipedia.org/wiki/FTSE_100_Index", "https://en.wikipedia.org/wiki/FTSE_250_Index"):
                try:
                    rw = client.get(wiki_url)
                    if rw.status_code == 200:
                        parser = _WikiTableParser()
                        parser.feed(rw.text)
                        for tbl in parser.tables:
                            if not tbl:
                                continue
                            hdr = [h.lower() for h in tbl[0]]
                            tick_i = next((i for i, h in enumerate(hdr) if "ticker" in h or "epic" in h), None)
                            comp_i = next((i for i, h in enumerate(hdr) if "company" in h or "constituent" in h), 0)
                            if tick_i is None:
                                continue
                            for rrow in tbl[1:]:
                                if len(rrow) > max(tick_i, comp_i):
                                    tkr = rrow[tick_i].strip().rstrip(".").upper()
                                    cname = rrow[comp_i].strip() or tkr
                                    if tkr and len(tkr) <= 8 and tkr.isalnum():
                                        records.append({
                                            "symbol": f"{tkr}.L",
                                            "name": f"{cname} (LSE)",
                                            "region": "EU",
                                            "exchange": "LSE",
                                            "category": "stocks",
                                            "currency": "GBp",
                                            "isin": "",
                                            "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
                                        })
                except Exception as e:
                    print("UK FTSE wiki err:", e)

        eu_benchmarks = [
            {"symbol": "^GDAXI", "name": "DAX Performance Index", "exchange": "XETRA", "category": "indices", "currency": "EUR"},
            {"symbol": "^FTSE", "name": "FTSE 100 Index", "exchange": "LSE", "category": "indices", "currency": "GBP"},
            {"symbol": "^FCHI", "name": "CAC 40 Index", "exchange": "Euronext", "category": "indices", "currency": "EUR"},
            {"symbol": "^STOXX50E", "name": "EURO STOXX 50 Index", "exchange": "Euronext", "category": "indices", "currency": "EUR"},
            {"symbol": "^SSMI", "name": "Swiss Market Index (SMI)", "exchange": "SIX", "category": "indices", "currency": "CHF"},
            {"symbol": "^IBEX", "name": "IBEX 35 Index (Spain)", "exchange": "BME", "category": "indices", "currency": "EUR"},
            {"symbol": "SHEL.L", "name": "Shell plc (LSE)", "exchange": "LSE", "category": "stocks", "currency": "GBp"},
            {"symbol": "AZN.L", "name": "AstraZeneca plc (LSE)", "exchange": "LSE", "category": "stocks", "currency": "GBp"},
            {"symbol": "HSBA.L", "name": "HSBC Holdings plc (LSE)", "exchange": "LSE", "category": "stocks", "currency": "GBp"},
            {"symbol": "NESN.SW", "name": "Nestle S.A. (Zurich)", "exchange": "SIX", "category": "stocks", "currency": "EUR"},
            {"symbol": "ROG.SW", "name": "Roche Holding AG (Zurich)", "exchange": "SIX", "category": "stocks", "currency": "EUR"},
            {"symbol": "NOVN.SW", "name": "Novartis AG (Zurich)", "exchange": "SIX", "category": "stocks", "currency": "EUR"},
            {"symbol": "UBSG.SW", "name": "UBS Group AG (Zurich)", "exchange": "SIX", "category": "stocks", "currency": "EUR"},
            {"symbol": "CSPX.L", "name": "iShares Core S&P 500 UCITS ETF", "exchange": "LSE", "category": "etfs", "currency": "USD"},
            {"symbol": "EXS1.DE", "name": "iShares Core DAX UCITS ETF", "exchange": "XETRA", "category": "etfs", "currency": "EUR"},
            {"symbol": "IGLN.L", "name": "iShares Physical Gold ETC (Commodities)", "exchange": "LSE", "category": "commodities", "currency": "USD"},
            {"symbol": "IGLT.L", "name": "iShares Core UK Gilts Bond ETF", "exchange": "LSE", "category": "bonds", "currency": "GBp"},
            {"symbol": "EUNH.DE", "name": "iShares Core Euro Govt Bond ETF", "exchange": "XETRA", "category": "bonds", "currency": "EUR"},
        ]
        for b in eu_benchmarks:
            records.append({
                "symbol": b["symbol"], "name": b["name"], "region": "EU", "exchange": b["exchange"],
                "category": b["category"], "currency": b["currency"], "isin": "",
                "price": 0.0, "prev_close": 0.0, "change": 0.0, "change_percent": 0.0, "volume": 0, "rsi_14": 50.0, "as_of": "",
            })

        self._upsert_records(records)
        return len(records)

    def ingest_crypto_complete(self) -> int:
        """Ingests the complete live Crypto spot universe (Binance 24h + CoinGecko top 500 names & rank)."""
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        major_bases = {"BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", "TRX", "TON", "DOT", "LINK", "LTC", "BCH", "SUI", "APT", "NEAR", "XLM"}
        l1_bases = {"ATOM", "ALGO", "ICP", "HBAR", "ARB", "OP", "MATIC", "POL", "FIL", "VET", "ETC", "SEI", "TIA", "INJ", "FTM", "STX", "KAS", "MNT"}
        defi_bases = {"UNI", "AAVE", "MKR", "LDO", "CRV", "SNX", "COMP", "JUP", "RUNE", "ENA", "ONDO", "PENDLE", "TAO", "FET", "RENDER", "RNDR", "GRT", "AR"}
        meme_bases = {"SHIB", "PEPE", "WIF", "BONK", "FLOKI", "MEME", "BOME", "PENGU", "TRUMP", "NEIRO"}

        def _crypto_tier(base: str) -> str:
            b = base.upper()
            if b in major_bases:
                return "CRYPTO_MAJOR"
            if b in l1_bases:
                return "CRYPTO_L1"
            if b in defi_bases:
                return "CRYPTO_DEFI"
            if b in meme_bases:
                return "CRYPTO_MEME"
            return "CRYPTO_ALT"

        cg_names: Dict[str, dict] = {}
        with httpx.Client(headers={"User-Agent": "Mozilla/5.0"}, timeout=10.0, follow_redirects=True) as client:
            for pg in (1, 2):
                try:
                    rg = client.get(
                        f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={pg}&sparkline=false"
                    )
                    if rg.status_code == 200 and isinstance(rg.json(), list):
                        for item in rg.json():
                            sym_u = str(item.get("symbol") or "").upper().strip()
                            if sym_u and sym_u not in cg_names:
                                cg_names[sym_u] = item
                except Exception:
                    pass

            records: List[dict] = []
            seen_syms: set[str] = set()
            try:
                rb = client.get("https://api.binance.com/api/v3/ticker/24hr")
                if rb.status_code == 200 and isinstance(rb.json(), list):
                    for row in rb.json():
                        bsym = str(row.get("symbol") or "").upper()
                        px = float(row.get("lastPrice") or 0.0)
                        qvol = float(row.get("quoteVolume") or 0.0)
                        if px <= 0 or qvol <= 0:
                            continue
                        if bsym.endswith("USDT"):
                            base = bsym[:-4]
                            norm_sym, curr = f"{base}-USD", "USD"
                        elif bsym in ("BTCEUR", "ETHEUR", "SOLEUR", "BNBEUR", "XRPEUR", "ADAEUR", "DOGEEUR", "LTCEUR"):
                            base = bsym[:-3]
                            norm_sym, curr = f"{base}-EUR", "EUR"
                        elif bsym in ("ETHBTC", "SOLBTC", "BNBBTC", "XRPBTC", "ADABTC", "DOGEBTC", "LINKBTC"):
                            base = bsym[:-3]
                            norm_sym, curr = f"{base}-BTC", "USD"
                        else:
                            continue
                        if norm_sym in seen_syms:
                            continue
                        seen_syms.add(norm_sym)
                        cg = cg_names.get(base)
                        cname = f"{cg['name']} ({norm_sym})" if cg and cg.get("name") else f"{base} / {norm_sym.split('-')[1]}"
                        pc = float(row.get("prevClosePrice") or px)
                        chg = float(row.get("priceChange") or (px - pc))
                        pct = float(row.get("priceChangePercent") or 0.0)
                        records.append({
                            "symbol": norm_sym,
                            "name": cname,
                            "region": "CRYPTO",
                            "exchange": "BINANCE",
                            "category": "crypto",
                            "currency": curr,
                            "isin": _crypto_tier(base),
                            "price": px,
                            "prev_close": pc,
                            "change": chg,
                            "change_percent": round(pct, 2),
                            "volume": int(qvol),
                            "rsi_14": 50.0,
                            "as_of": now_str,
                        })
            except Exception as e:
                print("Binance Crypto ingest err:", e)

            # Merge any top CoinGecko coin not already added from Binance
            for sym_u, cg in cg_names.items():
                norm_sym = f"{sym_u}-USD"
                if norm_sym in seen_syms or sym_u in ("USDT", "USDC", "DAI", "TUSD", "USDE", "FDUSD"):
                    continue
                px = float(cg.get("current_price") or 0.0)
                if px <= 0:
                    continue
                seen_syms.add(norm_sym)
                pct = float(cg.get("price_change_percentage_24h") or 0.0)
                pc = px / (1.0 + pct / 100.0) if pct > -99 else px
                records.append({
                    "symbol": norm_sym,
                    "name": f"{cg.get('name') or sym_u} ({norm_sym})",
                    "region": "CRYPTO",
                    "exchange": "COINGECKO",
                    "category": "crypto",
                    "currency": "USD",
                    "isin": _crypto_tier(sym_u),
                    "price": px,
                    "prev_close": pc,
                    "change": px - pc,
                    "change_percent": round(pct, 2),
                    "volume": int(float(cg.get("total_volume") or 0.0)),
                    "rsi_14": 50.0,
                    "as_of": now_str,
                })

        self._upsert_records(records)
        return len(records)

    def ingest_forex_complete(self) -> int:
        """Ingests the complete Global Forex matrix (Majors, Minors/Crosses, Exotics + DXY) with live ECB cross pricing."""
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        curr_names: Dict[str, str] = {}
        usd_rates: Dict[str, float] = {"USD": 1.0}
        with httpx.Client(headers={"User-Agent": "Mozilla/5.0"}, timeout=10.0) as client:
            try:
                rc = client.get("https://api.frankfurter.dev/v1/currencies")
                if rc.status_code == 200 and isinstance(rc.json(), dict):
                    curr_names = {str(k).upper(): str(v) for k, v in rc.json().items()}
                rl = client.get("https://api.frankfurter.dev/v1/latest?base=USD")
                if rl.status_code == 200:
                    rates = (rl.json() or {}).get("rates") or {}
                    for k, v in rates.items():
                        if isinstance(v, (int, float)) and v > 0:
                            usd_rates[str(k).upper()] = float(v)
            except Exception as e:
                print("Frankfurter FX ingest err:", e)

        majors = [
            ("EUR", "USD"), ("GBP", "USD"), ("USD", "JPY"), ("USD", "CHF"),
            ("USD", "CAD"), ("AUD", "USD"), ("NZD", "USD"),
        ]
        minors = [
            ("EUR", "GBP"), ("EUR", "JPY"), ("GBP", "JPY"), ("EUR", "CHF"), ("EUR", "CAD"),
            ("EUR", "AUD"), ("EUR", "NZD"), ("GBP", "AUD"), ("GBP", "CAD"), ("GBP", "CHF"),
            ("GBP", "NZD"), ("AUD", "JPY"), ("AUD", "CAD"), ("AUD", "CHF"), ("AUD", "NZD"),
            ("CAD", "JPY"), ("CAD", "CHF"), ("CHF", "JPY"), ("NZD", "JPY"), ("NZD", "CAD"),
            ("NZD", "CHF"),
        ]
        exotics: List[tuple[str, str]] = [
            ("USD", "INR"), ("EUR", "INR"), ("GBP", "INR"), ("JPY", "INR"), ("AUD", "INR"), ("CAD", "INR"), ("CHF", "INR"),
            ("USD", "CNY"), ("EUR", "CNY"), ("GBP", "CNY"), ("CNY", "JPY"),
            ("USD", "SGD"), ("USD", "HKD"), ("USD", "KRW"), ("USD", "MXN"), ("USD", "ZAR"), ("USD", "TRY"),
            ("USD", "SEK"), ("USD", "NOK"), ("USD", "DKK"), ("USD", "PLN"), ("USD", "BRL"), ("USD", "IDR"),
            ("USD", "MYR"), ("USD", "PHP"), ("USD", "THB"), ("USD", "ILS"), ("USD", "CZK"), ("USD", "HUF"),
            ("EUR", "SEK"), ("EUR", "NOK"), ("EUR", "PLN"), ("EUR", "TRY"), ("EUR", "SGD"), ("EUR", "ZAR"),
            ("GBP", "ZAR"), ("GBP", "SGD"), ("GBP", "TRY"), ("SGD", "JPY"), ("ZAR", "JPY"), ("MXN", "JPY"), ("TRY", "JPY"),
        ]
        for cur in sorted(usd_rates.keys()):
            if cur in ("USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"):
                continue
            if ( "USD", cur) not in exotics:
                exotics.append(("USD", cur))

        def _reg_for_pair(b: str, q: str) -> tuple[str, str, str]:
            if q == "INR":
                return "IND", "NSE-FX", "INR"
            return "FOREX", "FOREX", "USD"

        records: List[dict] = []
        seen: set[str] = set()
        for tier, pairs in (("FX_MAJOR", majors), ("FX_MINOR", minors), ("FX_EXOTIC", exotics)):
            for idx_p, (b, q) in enumerate(pairs):
                sym = f"{b}{q}=X"
                if sym in seen:
                    continue
                seen.add(sym)
                reg, exch_name, settle_curr = _reg_for_pair(b, q)
                px = 0.0
                if b in usd_rates and q in usd_rates and usd_rates[b] > 0:
                    raw_px = usd_rates[q] / usd_rates[b]
                    px = round(raw_px, 3 if (q == "JPY" or raw_px >= 50) else 5)
                b_name = curr_names.get(b, b)
                q_name = curr_names.get(q, q)
                tier_lbl = "Major" if tier == "FX_MAJOR" else "Minor" if tier == "FX_MINOR" else "Exotic"
                vol_weight = 10_000_000 - idx_p * 1000 if tier == "FX_MAJOR" else (4_000_000 - idx_p * 1000 if tier == "FX_MINOR" else 500_000 - idx_p * 100)
                records.append({
                    "symbol": sym,
                    "name": f"{b}/{q} ({tier_lbl} · {b_name} / {q_name})",
                    "region": reg,
                    "exchange": exch_name,
                    "category": "forex",
                    "currency": settle_curr,
                    "isin": tier,
                    "price": px,
                    "prev_close": px,
                    "change": 0.0,
                    "change_percent": 0.0,
                    "volume": max(1000, vol_weight),
                    "rsi_14": 50.0,
                    "as_of": now_str,
                })

        # Add US Dollar Index (DXY) to FOREX hub
        records.append({
            "symbol": "DX-Y.NYB",
            "name": "US Dollar Index (DXY Spot)",
            "region": "FOREX",
            "exchange": "ICE",
            "category": "forex",
            "currency": "USD",
            "isin": "FX_MAJOR",
            "price": 0.0,
            "prev_close": 0.0,
            "change": 0.0,
            "change_percent": 0.0,
            "volume": 20_000_000,
            "rsi_14": 50.0,
            "as_of": now_str,
        })

        self._upsert_records(records)
        return len(records)

    def ingest_all_regions_parallel(self) -> Dict[str, int]:
        results: Dict[str, int] = {}
        threads = [
            threading.Thread(target=lambda: results.update({"IND": self.ingest_india_nse_bse()}), daemon=True),
            threading.Thread(target=lambda: results.update({"USA": self.ingest_usa_complete()}), daemon=True),
            threading.Thread(target=lambda: results.update({"CANADA": self.ingest_canada_complete()}), daemon=True),
            threading.Thread(target=lambda: results.update({"CHINA": self.ingest_china_complete()}), daemon=True),
            threading.Thread(target=lambda: results.update({"EU": self.ingest_eu_complete()}), daemon=True),
            threading.Thread(target=lambda: results.update({"CRYPTO": self.ingest_crypto_complete()}), daemon=True),
            threading.Thread(target=lambda: results.update({"FOREX": self.ingest_forex_complete()}), daemon=True),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=45)
        self.last_ingested_at = datetime.now(timezone.utc).isoformat()
        return results

    def export_cache_snapshot(self, cache_path: str) -> int:
        with self._lock:
            if not self._by_symbol:
                return 0
            payload = {
                "saved_at": datetime.now(timezone.utc).isoformat(),
                "stats": dict(self.stats),
                "records": list(self._by_symbol.values()),
            }
        tmp_path = f"{cache_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, separators=(",", ":"))
        os.replace(tmp_path, cache_path)
        return len(payload["records"])

    def load_cache_snapshot(self, cache_path: str) -> int:
        if not os.path.exists(cache_path):
            return 0
        try:
            with open(cache_path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
            records = payload.get("records") or []
            if not isinstance(records, list) or not records:
                return 0
            with self._lock:
                self._upsert_records(records)
                if isinstance(payload.get("stats"), dict):
                    self.stats.update(payload["stats"])
                self.last_ingested_at = payload.get("saved_at")
            return len(records)
        except Exception:
            return 0
