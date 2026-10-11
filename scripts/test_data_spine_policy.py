#!/usr/bin/env python3
"""Contract checks for shared Data Spine policy constants."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import data_spine_policy


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DataSpinePolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.facts = load_module(SCRIPTS / "build-market-facts.py", "build_market_facts_policy_test")



    def test_return_3m_label_is_authority_only(self) -> None:
        label = data_spine_policy.tolerance_label("return_3m")
        self.assertIn("authority-only", label)
        self.assertIn("provenance", label)

    def test_market_facts_price_accepts_yahoo_regular_market_fallback(self) -> None:
        payload = {
            "data": {
                "info": {
                    "symbol": "688825.SS",
                    "quoteType": "EQUITY",
                    "regularMarketPrice": 55.18,
                    "regularMarketTime": 1786690801,
                },
                "history_1y": [],
            },
            "fetched_at": "2026-08-15T00:02:50Z",
        }
        built = self.facts.build_one("688825.SS", payload, None, None)
        self.assertEqual(built["facts"]["price"]["value"], 55.18)
        self.assertEqual(built["facts"]["price"]["source"], "yf")
        self.assertEqual(built["source_as_of"], built["facts"]["price"]["as_of"])
        self.assertIsNotNone(built["source_as_of"])

        payload["data"]["info"]["currentPrice"] = 56.01
        preferred = self.facts.build_one("688825.SS", payload, None, None)
        self.assertEqual(preferred["facts"]["price"]["value"], 56.01,
                         "currentPrice must remain preferred over regularMarketPrice")


if __name__ == "__main__":
    unittest.main()
