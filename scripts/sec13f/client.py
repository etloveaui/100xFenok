"""Bounded, injectable SEC client for Slice A shadow acquisition."""

from __future__ import annotations

import json
import re
import time
from typing import Callable
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class SecClientError(RuntimeError):
    pass


def validate_user_agent(value: str) -> str:
    if not isinstance(value, str) or len(value.strip()) < 8:
        raise SecClientError("SEC User-Agent identity is required")
    lowered = value.lower()
    if "example.com" in lowered or "placeholder" in lowered or "changeme" in lowered:
        raise SecClientError("SEC User-Agent placeholder identity is forbidden")
    if re.search(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) is None:
        raise SecClientError("SEC User-Agent must include a real contact email")
    return value.strip()


def default_transport(url: str, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
    try:
        with urlopen(Request(url, headers=headers), timeout=timeout) as response:
            return int(response.status), response.read()
    except HTTPError as error:
        return int(error.code), error.read()
    except URLError as error:
        raise SecClientError(f"SEC transport failure: {error.reason}") from error


class SecClient:
    def __init__(
        self,
        *,
        user_agent: str,
        transport: Callable[[str, dict[str, str], float], tuple[int, bytes]] = default_transport,
        minimum_interval: float = 0.12,
        timeout: float = 30.0,
        max_attempts: int = 3,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.user_agent = validate_user_agent(user_agent)
        if minimum_interval < 0.1:
            raise SecClientError("SEC request interval must stay below 10 requests/second")
        if max_attempts < 1 or max_attempts > 4:
            raise SecClientError("SEC max_attempts must be between 1 and 4")
        self.transport = transport
        self.minimum_interval = minimum_interval
        self.timeout = timeout
        self.max_attempts = max_attempts
        self.clock = clock
        self.sleep = sleep
        self._last_request_at: float | None = None

    def get_bytes(self, url: str) -> bytes:
        last_error = "unknown"
        for attempt in range(self.max_attempts):
            now = self.clock()
            if self._last_request_at is not None:
                wait = self.minimum_interval - (now - self._last_request_at)
                if wait > 0:
                    self.sleep(wait)
            self._last_request_at = self.clock()
            try:
                status, body = self.transport(
                    url,
                    {"User-Agent": self.user_agent, "Accept-Encoding": "identity"},
                    self.timeout,
                )
            except Exception as error:
                last_error = f"transport: {error}"
                status = 0
                body = b""
            if 200 <= status < 300 and body:
                return body
            last_error = f"HTTP {status}" if status else last_error
            if status in {401, 403}:
                break
            if status not in {0, 429, 500, 502, 503, 504}:
                break
            if attempt + 1 < self.max_attempts:
                self.sleep(min(2**attempt, 4))
        raise SecClientError(f"SEC request failed after bounded attempts: {last_error}")

    def get_json(self, url: str) -> dict:
        try:
            payload = json.loads(self.get_bytes(url).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SecClientError(f"SEC JSON decode failed: {error}") from error
        if not isinstance(payload, dict):
            raise SecClientError("SEC JSON root must be an object")
        return payload
