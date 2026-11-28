from __future__ import annotations

import time
from typing import Optional
import polars as pl
from pydantic import BaseModel

from core.universe_loader import GlobalUniverseStore


class ScreenerQuery(BaseModel):
    region: Optional[str] = "ALL"       # IND, USA, CANADA, CHINA, EU, ALL
    category: Optional[str] = "all"     # stocks, etfs, bonds, indices, commodities, forex, all
    exchange: Optional[str] = None
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    change_pct_min: Optional[float] = None
    change_pct_max: Optional[float] = None
    volume_min: Optional[int] = None
    rsi_min: Optional[float] = None
    rsi_max: Optional[float] = None
    sort_by: str = "volume"             # volume, change_percent, price, rsi_14
    descending: bool = True
    only_priced: bool = False
    limit: int = 100


def run_columnar_scan(store: GlobalUniverseStore, query: ScreenerQuery) -> dict:
    """
    Runs a sub-second vectorized scan using Polars LazyFrame over the full
    multi-region Arrow-backed security universe.
    """
    t0 = time.perf_counter()

    with store._lock:
        lf = store.df.lazy()

        if query.region and query.region != "ALL":
            if query.region == "FOREX":
                lf = lf.filter((pl.col("region") == "FOREX") | (pl.col("category") == "forex"))
            elif query.region == "CRYPTO":
                lf = lf.filter((pl.col("region") == "CRYPTO") | (pl.col("category") == "crypto"))
            else:
                lf = lf.filter(pl.col("region") == query.region)
        if query.category and query.category != "all":
            lf = lf.filter(pl.col("category") == query.category)
        if query.exchange:
            lf = lf.filter(pl.col("exchange").str.to_uppercase() == query.exchange.upper())
        if query.only_priced:
            lf = lf.filter(pl.col("price") > 0)
        if query.price_min is not None:
            lf = lf.filter(pl.col("price") >= query.price_min)
        if query.price_max is not None:
            lf = lf.filter(pl.col("price") <= query.price_max)
        if query.change_pct_min is not None:
            lf = lf.filter(pl.col("change_percent") >= query.change_pct_min)
        if query.change_pct_max is not None:
            lf = lf.filter(pl.col("change_percent") <= query.change_pct_max)
        if query.volume_min is not None:
            lf = lf.filter(pl.col("volume") >= query.volume_min)
        if query.rsi_min is not None:
            lf = lf.filter(pl.col("rsi_14") >= query.rsi_min)
        if query.rsi_max is not None:
            lf = lf.filter(pl.col("rsi_14") <= query.rsi_max)

        sort_col = query.sort_by if query.sort_by in {"volume", "change_percent", "price", "rsi_14", "symbol"} else "volume"

        matched_count = lf.select(pl.len()).collect().item()
        if sort_col == "volume" and query.descending:
            df_out = (
                lf.with_columns(
                    pl.when(pl.col("isin").is_in(["FX_MAJOR", "CRYPTO_MAJOR"]))
                    .then(3)
                    .when(pl.col("isin").is_in(["FX_MINOR", "CRYPTO_L1", "CRYPTO_DEFI"]))
                    .then(2)
                    .when(pl.col("isin").is_in(["FX_EXOTIC", "CRYPTO_MEME"]))
                    .then(1)
                    .otherwise(0)
                    .alias("_tier_rank"),
                )
                .sort(["_tier_rank", "volume"], descending=[True, True], maintain_order=True)
                .drop("_tier_rank")
                .limit(min(query.limit, 500))
                .collect()
            )
        else:
            df_out = (
                lf.sort(sort_col, descending=query.descending, maintain_order=True)
                .limit(min(query.limit, 500))
                .collect()
            )

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return {
        "scanned_universe": len(store.df),
        "matched_count": int(matched_count),
        "scan_ms": elapsed_ms,
        "results": df_out.to_dicts(),
    }
