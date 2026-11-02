"""Small in-memory rate limits for sign-in and registration (enough for a single server process)."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request

from app.config import get_settings


class SlidingWindow:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        return hits

    def blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key, time.monotonic())) >= self.limit

    def add(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._prune(key, now).append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# Failed sign-ins: per username (guessing one account) and per client address (spraying many).
failed_logins_by_user = SlidingWindow(limit=8, window_seconds=600)
failed_logins_by_ip = SlidingWindow(limit=30, window_seconds=600)
registrations_by_ip = SlidingWindow(limit=10, window_seconds=3600)


def client_address(request: Request) -> str:
    """The visitor's address. Behind a reverse proxy, CLIENT_IP_HEADER names the header the
    proxy overwrites with it (Render: True-Client-IP; the Caddy setup: X-Real-IP). Plain
    X-Forwarded-For is not used: visitors can prepend fake entries to it."""
    header = get_settings().client_ip_header.strip()
    if header:
        value = request.headers.get(header, "").split(",")[0].strip()
        if value:
            return value
    return request.client.host if request.client else "unknown"


def too_many(detail: str = "尝试次数太多，请过几分钟再试") -> HTTPException:
    return HTTPException(status_code=429, detail=detail)


def reset_all() -> None:
    for limiter in (failed_logins_by_user, failed_logins_by_ip, registrations_by_ip):
        limiter.reset()
