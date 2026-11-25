from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from typing import Dict, Set

from fastapi import WebSocket


class RealtimeWebSocketHub:
    """
    Manages authenticated user duplex channels (/ws/user/{user_id})
    and symbol broadcast channels (/ws/market/{symbol}), optionally relaying via Redis Pub/Sub.
    """

    def __init__(self) -> None:
        self.user_sockets: Dict[str, Set[WebSocket]] = defaultdict(set)
        self.market_sockets: Dict[str, Set[WebSocket]] = defaultdict(set)
        self.redis_client = None
        self._init_redis()

    def _init_redis(self) -> None:
        redis_url = os.environ.get("REDIS_URL", "").strip()
        if not redis_url:
            return
        try:
            import redis
            client = redis.Redis.from_url(redis_url, socket_connect_timeout=0.4, decode_responses=True)
            client.ping()
            self.redis_client = client
        except Exception:
            self.redis_client = None

    async def connect_user(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.user_sockets[user_id].add(ws)

    def disconnect_user(self, user_id: str, ws: WebSocket) -> None:
        self.user_sockets[user_id].discard(ws)

    async def connect_market(self, symbol: str, ws: WebSocket) -> None:
        await ws.accept()
        self.market_sockets[symbol].add(ws)

    def disconnect_market(self, symbol: str, ws: WebSocket) -> None:
        self.market_sockets[symbol].discard(ws)

    async def publish_user_event(self, user_id: str, payload: dict) -> None:
        if self.redis_client:
            try:
                self.redis_client.publish(f"agam:ws:user:{user_id}", json.dumps(payload))
            except Exception:
                pass
        dead: Set[WebSocket] = set()
        for ws in list(self.user_sockets.get(user_id, set())):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.user_sockets[user_id].discard(ws)

    async def publish_market_tick(self, symbol: str, payload: dict) -> None:
        if self.redis_client:
            try:
                self.redis_client.publish(f"agam:ws:market:{symbol}", json.dumps(payload))
            except Exception:
                pass
        dead: Set[WebSocket] = set()
        for ws in list(self.market_sockets.get(symbol, set())):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.market_sockets[symbol].discard(ws)

    def schedule_user_event(self, loop: asyncio.AbstractEventLoop | None, user_id: str, payload: dict) -> None:
        if not loop or not loop.is_running():
            return
        try:
            asyncio.run_coroutine_threadsafe(self.publish_user_event(user_id, payload), loop)
        except Exception:
            pass
