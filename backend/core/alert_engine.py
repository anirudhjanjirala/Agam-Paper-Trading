from __future__ import annotations

import bisect
import json
import os
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional, Tuple

ConditionType = Literal["PRICE_ABOVE", "PRICE_BELOW", "RSI_ABOVE", "RSI_BELOW"]


@dataclass
class AlertRule:
    id: str
    symbol: str
    condition: ConditionType
    threshold: float
    note: str = ""
    non_expiring: bool = True
    triggered_count: int = 0
    last_triggered_at: Optional[str] = None
    created_at: str = ""


class InMemoryZSet:
    """Sorted-set data structure mirroring Redis ZADD / ZRANGEBYSCORE in O(log N + M)."""

    def __init__(self) -> None:
        self._scores: List[float] = []
        self._members: List[str] = []

    def zadd(self, member: str, score: float) -> None:
        idx = bisect.bisect_left(self._scores, score)
        self._scores.insert(idx, score)
        self._members.insert(idx, member)

    def zrem(self, member: str) -> None:
        for i, m in enumerate(self._members):
            if m == member:
                self._members.pop(i)
                self._scores.pop(i)
                return

    def zrangebyscore(self, min_score: float, max_score: float) -> List[str]:
        lo = bisect.bisect_left(self._scores, min_score)
        hi = bisect.bisect_right(self._scores, max_score)
        return list(self._members[lo:hi])


class NonExpiringAlertEngine:
    """
    High-scale Alert Engine (1,000+ persistent rules):
    - Uses Redis Sorted Sets (ZSET) per (symbol, condition) key when REDIS_URL is live.
    - Seamlessly falls back to identical O(log N + M) in-memory ZSET index when local Redis daemon is absent.
    - Non-expiring rules remain active across triggers unless explicitly deleted (with cooldown).
    """

    def __init__(self, cooldown_sec: int = 60) -> None:
        self.cooldown_sec = cooldown_sec
        self.rules: Dict[str, AlertRule] = {}
        self.triggered_log: List[dict] = []
        self._last_fired_ts: Dict[str, float] = {}
        self._zsets: Dict[str, InMemoryZSet] = {}
        self._prev_metrics: Dict[str, Tuple[float, float]] = {}  # symbol -> (price, rsi)
        self.redis_client = None
        self.backend_mode = "IN_MEMORY_ZSET"
        self._init_redis()

    def _init_redis(self) -> None:
        redis_url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
        try:
            import redis
            client = redis.Redis.from_url(redis_url, socket_connect_timeout=0.3, decode_responses=True)
            client.ping()
            self.redis_client = client
            self.backend_mode = "REDIS_ZSET"
        except Exception:
            self.redis_client = None
            self.backend_mode = "IN_MEMORY_ZSET"

    def _zkey(self, symbol: str, condition: ConditionType) -> str:
        return f"agam:alerts:{condition}:{symbol}"

    def add_rule(
        self,
        symbol: str,
        condition: ConditionType,
        threshold: float,
        note: str = "",
        rule_id: Optional[str] = None,
    ) -> AlertRule:
        rule_id = rule_id or f"alr-{int(time.time() * 1000)}-{len(self.rules) + 1}"
        rule = AlertRule(
            id=rule_id,
            symbol=symbol,
            condition=condition,
            threshold=float(threshold),
            note=note,
            non_expiring=True,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.rules[rule_id] = rule

        zkey = self._zkey(symbol, condition)
        if self.redis_client:
            try:
                self.redis_client.zadd(zkey, {rule_id: float(threshold)})
                self.redis_client.hset("agam:alert_rules", rule_id, json.dumps(asdict(rule)))
                return rule
            except Exception:
                pass

        if zkey not in self._zsets:
            self._zsets[zkey] = InMemoryZSet()
        self._zsets[zkey].zadd(rule_id, float(threshold))
        return rule

    def delete_rule(self, rule_id: str) -> bool:
        rule = self.rules.pop(rule_id, None)
        if not rule:
            return False
        zkey = self._zkey(rule.symbol, rule.condition)
        if self.redis_client:
            try:
                self.redis_client.zrem(zkey, rule_id)
                self.redis_client.hdel("agam:alert_rules", rule_id)
            except Exception:
                pass
        if zkey in self._zsets:
            self._zsets[zkey].zrem(rule_id)
        return True

    def _range_query(self, zkey: str, min_s: float, max_s: float) -> List[str]:
        if self.redis_client:
            try:
                return self.redis_client.zrangebyscore(zkey, min_s, max_s)
            except Exception:
                pass
        z = self._zsets.get(zkey)
        return z.zrangebyscore(min_s, max_s) if z else []

    def evaluate_tick(self, symbol: str, price: float, rsi: float = 50.0) -> List[dict]:
        now = time.time()
        fired_now: List[dict] = []

        # Query ZSET buckets matching crossed or active thresholds in O(log N + M)
        matches: List[str] = []
        matches.extend(self._range_query(self._zkey(symbol, "PRICE_ABOVE"), float("-inf"), price))
        matches.extend(self._range_query(self._zkey(symbol, "PRICE_BELOW"), price, float("inf")))
        matches.extend(self._range_query(self._zkey(symbol, "RSI_ABOVE"), float("-inf"), rsi))
        matches.extend(self._range_query(self._zkey(symbol, "RSI_BELOW"), rsi, float("inf")))

        for rule_id in matches:
            rule = self.rules.get(rule_id)
            if not rule:
                continue
            last_ts = self._last_fired_ts.get(rule_id, 0.0)
            if (now - last_ts) < self.cooldown_sec:
                continue

            self._last_fired_ts[rule_id] = now
            rule.triggered_count += 1
            rule.last_triggered_at = datetime.now(timezone.utc).isoformat()
            ev = {
                "rule_id": rule_id,
                "symbol": symbol,
                "condition": rule.condition,
                "threshold": rule.threshold,
                "observed_price": price,
                "observed_rsi": rsi,
                "note": rule.note,
                "triggered_at": rule.last_triggered_at,
                "non_expiring": True,
            }
            self.triggered_log.insert(0, ev)
            self.triggered_log = self.triggered_log[:100]
            fired_now.append(ev)

        self._prev_metrics[symbol] = (price, rsi)
        return fired_now

    def list_state(self) -> dict:
        return {
            "backend_mode": self.backend_mode,
            "total_rules": len(self.rules),
            "rules": [asdict(r) for r in self.rules.values()],
            "recent_triggers": self.triggered_log[:30],
        }
