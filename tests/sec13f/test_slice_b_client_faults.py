#!/usr/bin/env python3
"""Slice B SEC client identity, global pacing, and retry fault contracts."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from client import (  # noqa: E402
    GlobalRateGate,
    SecClient,
    SecClientError,
    SecRequestError,
)


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class SliceBClientFaultTest(unittest.TestCase):
    def test_production_identity_rejects_test_domain_and_fixture_mode_is_explicit(self) -> None:
        with self.assertRaisesRegex(SecClientError, "production"):
            SecClient.production(user_agent="Fenok sec13f@fenok.test")

        fixture = SecClient.fixture(
            user_agent="Fenok sec13f@fenok.test",
            transport=lambda *_args: (200, b"fixture"),
        )
        self.assertEqual(fixture.get_bytes("https://fixture.invalid"), b"fixture")
        self.assertEqual(fixture.identity_mode, "fixture")

        production = SecClient.production(
            user_agent="Fenok SEC bot sec13f@fenok.com",
            transport=lambda *_args: (200, b"ok"),
        )
        self.assertEqual(production.identity_mode, "production")

    def test_one_shared_gate_paces_requests_across_two_clients(self) -> None:
        clock = FakeClock()
        gate = GlobalRateGate(
            minimum_interval=0.25,
            clock=clock.monotonic,
            sleep=clock.sleep,
        )
        request_times: list[float] = []

        def transport(*_args):
            request_times.append(clock.monotonic())
            return 200, b"ok"

        first = SecClient.fixture(
            user_agent="Fenok first@fenok.test",
            transport=transport,
            rate_gate=gate,
            max_attempts=1,
        )
        second = SecClient.fixture(
            user_agent="Fenok second@fenok.test",
            transport=transport,
            rate_gate=gate,
            max_attempts=1,
        )

        first.get_bytes("https://fixture.invalid/one")
        second.get_bytes("https://fixture.invalid/two")

        self.assertEqual(request_times, [0.0, 0.25])
        self.assertEqual(clock.sleeps, [0.25])

    def test_production_clients_share_the_global_gate_by_default(self) -> None:
        clock = FakeClock()
        request_times: list[float] = []

        def transport(*_args):
            request_times.append(clock.monotonic())
            return 200, b"ok"

        clients = [
            SecClient.production(
                user_agent=f"Fenok SEC bot{i}@fenok.com",
                transport=transport,
                minimum_interval=0.2,
                max_attempts=1,
                clock=clock.monotonic,
                sleep=clock.sleep,
            )
            for i in range(2)
        ]
        clients[0].get_bytes("https://data.sec.gov/one")
        clients[1].get_bytes("https://data.sec.gov/two")
        self.assertEqual(request_times, [0.0, 0.2])

    def test_timeout_retries_exactly_and_returns_typed_failure(self) -> None:
        clock = FakeClock()
        calls: list[int] = []

        def timeout(*_args):
            calls.append(1)
            raise TimeoutError("fixture timeout")

        client = SecClient.fixture(
            user_agent="Fenok timeout@fenok.test",
            transport=timeout,
            max_attempts=3,
            clock=clock.monotonic,
            sleep=clock.sleep,
        )
        with self.assertRaises(SecRequestError) as raised:
            client.get_bytes("https://fixture.invalid/timeout")

        self.assertEqual(len(calls), 3)
        self.assertEqual(clock.sleeps, [1.0, 2.0])
        self.assertEqual(raised.exception.reason, "timeout")
        self.assertIsNone(raised.exception.status)
        self.assertEqual(raised.exception.attempts, 3)

    def test_http_faults_have_exact_retry_count_backoff_and_typed_reason(self) -> None:
        cases = {
            403: (1, [], "auth"),
            429: (3, [1.0, 2.0], "rate_limited"),
            500: (3, [1.0, 2.0], "server_error"),
            502: (3, [1.0, 2.0], "server_error"),
            503: (3, [1.0, 2.0], "server_error"),
            504: (3, [1.0, 2.0], "server_error"),
        }
        for status, (expected_calls, expected_sleeps, reason) in cases.items():
            with self.subTest(status=status):
                clock = FakeClock()
                calls: list[int] = []

                def transport(*_args, status=status):
                    calls.append(1)
                    return status, b"fault"

                client = SecClient.fixture(
                    user_agent="Fenok faults@fenok.test",
                    transport=transport,
                    max_attempts=3,
                    clock=clock.monotonic,
                    sleep=clock.sleep,
                )
                with self.assertRaises(SecRequestError) as raised:
                    client.get_bytes(f"https://fixture.invalid/{status}")

                self.assertEqual(len(calls), expected_calls)
                self.assertEqual(clock.sleeps, expected_sleeps)
                self.assertEqual(raised.exception.reason, reason)
                self.assertEqual(raised.exception.status, status)
                self.assertEqual(raised.exception.attempts, expected_calls)

    def test_retry_after_is_honored_but_capped(self) -> None:
        clock = FakeClock()
        calls: list[int] = []

        def transport(*_args):
            calls.append(1)
            return 429, b"slow down", {"Retry-After": "120"}

        client = SecClient.fixture(
            user_agent="Fenok retry-after@fenok.test",
            transport=transport,
            max_attempts=3,
            retry_after_cap=4.0,
            clock=clock.monotonic,
            sleep=clock.sleep,
        )
        with self.assertRaises(SecRequestError) as raised:
            client.get_bytes("https://fixture.invalid/retry-after")

        self.assertEqual(len(calls), 3)
        self.assertEqual(clock.sleeps, [4.0, 4.0])
        self.assertEqual(raised.exception.reason, "rate_limited")


if __name__ == "__main__":
    unittest.main()
