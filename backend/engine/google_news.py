from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Dict, List, Optional, Set
from urllib.parse import quote_plus

import feedparser
import httpx
from bs4 import BeautifulSoup

REGION_LOCALE: Dict[str, Dict[str, str]] = {
    "IND": {"hl": "en-IN", "gl": "IN", "ceid": "IN:en"},
    "USA": {"hl": "en-US", "gl": "US", "ceid": "US:en"},
    "CANADA": {"hl": "en-CA", "gl": "CA", "ceid": "CA:en"},
    "CHINA": {"hl": "en-SG", "gl": "SG", "ceid": "SG:en"},
    "EU": {"hl": "en-GB", "gl": "GB", "ceid": "GB:en"},
    "CRYPTO": {"hl": "en-US", "gl": "US", "ceid": "US:en"},
    "FOREX": {"hl": "en-US", "gl": "US", "ceid": "US:en"},
}

POS_KEYWORDS = (
    "surge", "soar", "jump", "rally", "beat", "beats", "upgrade", "bullish",
    "record high", "profit", "growth", "outperform", "strong", "gain", "gains",
    "buyback", "dividend", "breakout", "expand", "acquisition", "approval",
)
NEG_KEYWORDS = (
    "plunge", "slump", "drop", "fall", "miss", "misses", "downgrade", "bearish",
    "loss", "lawsuit", "probe", "investigation", "warning", "cut", "cuts",
    "decline", "selloff", "crash", "recall", "fine", "layoff", "deficit",
)


def _classify_sentiment(title: str) -> str:
    low = title.lower()
    pos_score = sum(1 for w in POS_KEYWORDS if w in low)
    neg_score = sum(1 for w in NEG_KEYWORDS if w in low)
    if pos_score > neg_score:
        return "POSITIVE"
    if neg_score > pos_score:
        return "NEGATIVE"
    return "NEUTRAL"


def _relative_time(ts: float) -> str:
    diff = max(0, int(time.time() - ts))
    if diff < 60:
        return f"{diff}s ago"
    if diff < 3600:
        return f"{diff // 60}m ago"
    if diff < 86400:
        return f"{diff // 3600}h ago"
    return f"{diff // 86400}d ago"


def _clean_html(raw: str) -> str:
    if not raw:
        return ""
    txt = BeautifulSoup(raw, "lxml").get_text(" ", strip=True)
    return re.sub(r"\s+", " ", txt).strip()


class GoogleNewsEngine:
    """
    Asynchronous real-time Google News RSS streaming engine with regional locale routing,
    30-second TTL caching, headline deduplication, and breaking news delta detection.
    """

    def __init__(self, cache_ttl_sec: int = 30) -> None:
        self.cache_ttl_sec = cache_ttl_sec
        self._cache: Dict[str, tuple[float, List[dict]]] = {}
        self._seen_ids: Dict[str, Set[str]] = {}

    async def fetch_symbol_news(
        self,
        symbol: str,
        company_name: Optional[str] = None,
        region: str = "USA",
        limit: int = 20,
    ) -> List[dict]:
        cache_key = f"{symbol}:{region}"
        now = time.time()
        cached = self._cache.get(cache_key)
        if cached and (now - cached[0]) < self.cache_ttl_sec:
            return cached[1][:limit]

        loc = REGION_LOCALE.get(region.upper(), REGION_LOCALE["USA"])
        sym_u = symbol.upper().strip()
        clean_sym = sym_u.split(".")[0].lstrip("^")
        clean_co = (company_name or "").replace("Limited", "").replace("Ltd", "").strip()
        if region.upper() == "CRYPTO" or sym_u.endswith(("-USD", "-USDT", "-EUR", "-GBP", "-BTC")):
            base = sym_u.split("-")[0]
            coin_name = clean_co.split("(")[0].strip() if clean_co else base
            q_str = f"{coin_name} {base} crypto cryptocurrency" if coin_name.upper() != base else f"{base} crypto cryptocurrency"
        elif region.upper() == "FOREX" or sym_u.endswith("=X") or sym_u == "DX-Y.NYB":
            pair = sym_u.replace("=X", "")
            q_str = "US Dollar Index DXY forex" if sym_u == "DX-Y.NYB" else f"{pair[:3]} {pair[3:6]} forex currency rate"
        elif sym_u.startswith("^"):
            q_str = f"{clean_co or clean_sym} index market"
        else:
            q_str = f"{clean_sym} {clean_co} stock".strip() if clean_co and clean_co.upper() != clean_sym else f"{clean_sym} stock"

        url = (
            f"https://news.google.com/rss/search?"
            f"q={quote_plus(q_str)}&hl={loc['hl']}&gl={loc['gl']}&ceid={loc['ceid']}"
        )

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        }

        articles: List[dict] = []
        try:
            async with httpx.AsyncClient(headers=headers, timeout=8.0, follow_redirects=True) as client:
                res = await client.get(url)
                if res.status_code != 200:
                    return cached[1][:limit] if cached else []
                parsed = feedparser.parse(res.text)
        except Exception:
            return cached[1][:limit] if cached else []

        for entry in parsed.entries[:limit]:
            raw_title = (entry.get("title") or "").strip()
            source_obj = entry.get("source")
            publisher = (source_obj.get("title") if isinstance(source_obj, dict) else None) or ""

            if not publisher and " - " in raw_title:
                parts = raw_title.rsplit(" - ", 1)
                title = parts[0].strip()
                publisher = parts[1].strip()
            else:
                title = raw_title.rsplit(f" - {publisher}", 1)[0].strip() if publisher and raw_title.endswith(f" - {publisher}") else raw_title

            pub_raw = entry.get("published") or ""
            try:
                dt = parsedate_to_datetime(pub_raw)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                pub_ts = dt.timestamp()
                iso_str = dt.astimezone(timezone.utc).isoformat()
            except Exception:
                pub_ts = time.time()
                iso_str = datetime.now(timezone.utc).isoformat()

            link = entry.get("link") or ""
            snippet = _clean_html(entry.get("summary") or "")
            art_id = hashlib.md5(f"{symbol}:{title}".encode("utf-8")).hexdigest()[:12]

            articles.append({
                "id": art_id,
                "symbol": symbol,
                "title": title,
                "publisher": publisher or "Google News",
                "published_at": iso_str,
                "published_ts": pub_ts,
                "relative_time": _relative_time(pub_ts),
                "url": link,
                "snippet": snippet,
                "sentiment": _classify_sentiment(title),
            })

        articles.sort(key=lambda a: a["published_ts"], reverse=True)
        self._cache[cache_key] = (now, articles)
        return articles[:limit]

    async def poll_new_headlines(
        self,
        symbol: str,
        company_name: Optional[str] = None,
        region: str = "USA",
    ) -> List[dict]:
        """Returns ONLY newly observed breaking headlines since the prior poll for WebSocket broadcast."""
        articles = await self.fetch_symbol_news(symbol, company_name=company_name, region=region, limit=15)
        if not articles:
            return []

        seen = self._seen_ids.get(symbol)
        if seen is None:
            # First snapshot establishes baseline without flooding old headlines
            self._seen_ids[symbol] = {a["id"] for a in articles}
            return []

        fresh = [a for a in articles if a["id"] not in seen]
        if fresh:
            seen.update(a["id"] for a in fresh)
        return fresh
