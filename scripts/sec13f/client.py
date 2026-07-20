"""Bounded, injectable SEC client for hermetic and production acquisition."""

from __future__ import annotations

import json
import re
import socket
import threading
import time
from collections.abc import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class SecClientError(RuntimeError):
    pass


class SecRequestError(SecClientError):
    """A request stopped with a stable fault classification."""

    def __init__(
        self,
        reason: str,
        *,
        attempts: int,
        status: int | None = None,
        detail: str = "",
    ) -> None:
        self.reason = reason
        self.attempts = attempts
        self.status = status
        self.http_status = status
        self.detail = detail
        message = f"SEC request failed: {reason}; attempts={attempts}"
        if status is not None:
            message += f"; status={status}"
        if detail:
            message += f"; detail={detail}"
        super().__init__(message)


_TEST_DOMAINS = frozenset({"example.com", "example.org", "example.net", "localhost"})


def validate_user_agent(value: str, *, production: bool = False) -> str:
    if not isinstance(value, str) or len(value.strip()) < 8:
        raise SecClientError("SEC User-Agent identity is required")
    normalized = value.strip()
    lowered = normalized.lower()
    if "example.com" in lowered or "placeholder" in lowered or "changeme" in lowered:
        raise SecClientError("SEC User-Agent placeholder identity is forbidden")
    email = re.search(r"[^\s@]+@([^\s@]+\.[^\s@]+)", normalized)
    if email is None:
        raise SecClientError("SEC User-Agent must include a real contact email")
    if production:
        domain = email.group(1).rstrip(".,;:)").lower()
        if (
            domain in _TEST_DOMAINS
            or domain.endswith((".test", ".invalid", ".example", ".localhost"))
        ):
            raise SecClientError("SEC production identity cannot use a reserved test domain")
    return normalized


class GlobalRateGate:
    """A lock-protected request gate shared by every participating client."""

    def __init__(
        self,
        *,
        minimum_interval: float = 0.12,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if minimum_interval < 0.1:
            raise SecClientError("SEC request interval must stay below 10 requests/second")
        self.minimum_interval = float(minimum_interval)
        self.clock = clock
        self.sleep = sleep
        self._last_request_at: float | None = None
        self._lock = threading.Lock()

    def acquire(self) -> None:
        with self._lock:
            now = self.clock()
            if self._last_request_at is not None:
                wait = self.minimum_interval - (now - self._last_request_at)
                if wait > 0:
                    self.sleep(wait)
            self._last_request_at = self.clock()


_PRODUCTION_GATES: dict[tuple[float, object, object], GlobalRateGate] = {}
_PRODUCTION_GATES_LOCK = threading.Lock()


def _production_gate(
    minimum_interval: float,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
) -> GlobalRateGate:
    key = (float(minimum_interval), clock, sleep)
    with _PRODUCTION_GATES_LOCK:
        gate = _PRODUCTION_GATES.get(key)
        if gate is None:
            gate = GlobalRateGate(minimum_interval=minimum_interval, clock=clock, sleep=sleep)
            _PRODUCTION_GATES[key] = gate
        return gate


TransportResult = tuple[int, bytes] | tuple[int, bytes, Mapping[str, str]]


def default_transport(
    url: str,
    headers: dict[str, str],
    timeout: float,
) -> tuple[int, bytes, Mapping[str, str]]:
    try:
        with urlopen(Request(url, headers=headers), timeout=timeout) as response:
            return int(response.status), response.read(), dict(response.headers.items())
    except HTTPError as error:
        response_headers = dict(error.headers.items()) if error.headers is not None else {}
        return int(error.code), error.read(), response_headers
    except (TimeoutError, socket.timeout):
        raise
    except URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise TimeoutError(str(error.reason)) from error
        raise SecClientError(f"SEC transport failure: {error.reason}") from error


class SecClient:
    def __init__(
        self,
        *,
        user_agent: str,
        transport: Callable[[str, dict[str, str], float], TransportResult] = default_transport,
        minimum_interval: float = 0.12,
        timeout: float = 30.0,
        max_attempts: int = 3,
        retry_after_cap: float = 4.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        rate_gate: GlobalRateGate | None = None,
        identity_mode: str = "compatibility",
    ) -> None:
        if identity_mode not in {"compatibility", "fixture", "production"}:
            raise SecClientError(f"unsupported SEC identity mode: {identity_mode}")
        self.identity_mode = identity_mode
        self.user_agent = validate_user_agent(user_agent, production=identity_mode == "production")
        if max_attempts < 1 or max_attempts > 4:
            raise SecClientError("SEC max_attempts must be between 1 and 4")
        if retry_after_cap <= 0 or retry_after_cap > 60:
            raise SecClientError("SEC retry_after_cap must be between 0 and 60 seconds")
        self.transport = transport
        self.timeout = timeout
        self.max_attempts = max_attempts
        self.retry_after_cap = float(retry_after_cap)
        self.clock = clock
        self.sleep = sleep
        self.rate_gate = rate_gate or (
            _production_gate(minimum_interval, clock, sleep)
            if identity_mode == "production"
            else GlobalRateGate(minimum_interval=minimum_interval, clock=clock, sleep=sleep)
        )

    @classmethod
    def production(cls, **kwargs) -> "SecClient":
        """Construct a live client whose identity cannot use reserved domains."""

        if "identity_mode" in kwargs:
            raise SecClientError("production identity mode is fixed")
        return cls(identity_mode="production", **kwargs)

    @classmethod
    def fixture(cls, **kwargs) -> "SecClient":
        """Construct an explicitly hermetic client that may use test domains."""

        if "identity_mode" in kwargs:
            raise SecClientError("fixture identity mode is fixed")
        return cls(identity_mode="fixture", **kwargs)

    @staticmethod
    def _response_parts(response: TransportResult) -> tuple[int, bytes, Mapping[str, str]]:
        if not isinstance(response, tuple) or len(response) not in {2, 3}:
            raise SecClientError("SEC transport returned an invalid response tuple")
        status, body = response[:2]
        headers = response[2] if len(response) == 3 else {}
        if (
            isinstance(status, bool)
            or not isinstance(status, int)
            or not isinstance(body, bytes)
            or not isinstance(headers, Mapping)
        ):
            raise SecClientError("SEC transport returned invalid response fields")
        return status, body, headers

    def _retry_delay(self, attempt: int, headers: Mapping[str, str]) -> float:
        exponential = min(float(2**attempt), self.retry_after_cap)
        retry_after: float | None = None
        for key, value in headers.items():
            if str(key).casefold() != "retry-after":
                continue
            try:
                candidate = float(value)
            except (TypeError, ValueError):
                break
            if candidate >= 0:
                retry_after = candidate
            break
        if retry_after is None:
            return exponential
        return min(max(exponential, retry_after), self.retry_after_cap)

    def get_bytes(self, url: str) -> bytes:
        last_reason = "transport_error"
        last_status: int | None = None
        last_detail = "unknown"
        for attempt in range(self.max_attempts):
            self.rate_gate.acquire()
            headers: Mapping[str, str] = {}
            try:
                status, body, headers = self._response_parts(
                    self.transport(
                        url,
                        {"User-Agent": self.user_agent, "Accept-Encoding": "identity"},
                        self.timeout,
                    )
                )
            except (TimeoutError, socket.timeout) as error:
                last_reason = "timeout"
                last_status = None
                last_detail = str(error)
                status = None
                body = b""
            except Exception as error:
                last_reason = "transport_error"
                last_status = None
                last_detail = str(error)
                status = None
                body = b""
            if status is not None and 200 <= status < 300 and body:
                return body
            if status is not None:
                last_status = status
                last_detail = f"HTTP {status}"
                if status in {401, 403}:
                    last_reason = "auth"
                elif status == 429:
                    last_reason = "rate_limited"
                elif status in {500, 502, 503, 504}:
                    last_reason = "server_error"
                elif 200 <= status < 300:
                    last_reason = "empty_response"
                else:
                    last_reason = "http_error"

            retryable = status is None or status in {429, 500, 502, 503, 504}
            if not retryable or attempt + 1 >= self.max_attempts:
                raise SecRequestError(
                    last_reason,
                    attempts=attempt + 1,
                    status=last_status,
                    detail=last_detail,
                )
            self.sleep(self._retry_delay(attempt, headers))

        raise AssertionError("bounded SEC retry loop exhausted without a result")

    def get_json(self, url: str) -> dict:
        try:
            payload = json.loads(self.get_bytes(url).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SecClientError(f"SEC JSON decode failed: {error}") from error
        if not isinstance(payload, dict):
            raise SecClientError("SEC JSON root must be an object")
        return payload
