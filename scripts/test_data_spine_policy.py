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
        cls.p1 = load_module(SCRIPTS / "audit-data-spine-p1.py", "audit_data_spine_p1_policy_test")
        cls.v0 = load_module(SCRIPTS / "audit-data-spine-v0.py", "audit_data_spine_v0_policy_test")

    def test_resolver_fields_match_ratified_policy_fields(self) -> None:
        self.assertEqual(
            set(self.facts.FIELD_SOURCE_POLICY),
            set(data_spine_policy.V0_FIELD_POLICY),
        )

    def test_p1_and_v0_use_shared_policy_objects(self) -> None:
        self.assertIs(self.p1.DIAGNOSIS_ACTION, data_spine_policy.DIAGNOSIS_ACTION)
        self.assertIs(self.v0.V0_FIELD_POLICY, data_spine_policy.V0_FIELD_POLICY)
        self.assertIs(self.v0.POLICY_RATIONALE, data_spine_policy.POLICY_RATIONALE)

    def test_v0_specific_tolerances_are_not_regressed_to_old_p1_draft(self) -> None:
        cases = {
            "dividend_yield": 0.5,
            "return_1m": 5.0,
            "return_3m": None,
            "return_ytd": 7.0,
            "return_1y": 10.0,
            "return_5y_avg": 1.25,
            "return_10y_avg": 1.0,
        }
        for field, expected in cases.items():
            with self.subTest(field=field):
                self.assertEqual(data_spine_policy.V0_FIELD_POLICY[field]["tolerance"], expected)

    def test_return_3m_label_is_authority_only(self) -> None:
        label = data_spine_policy.tolerance_label("return_3m")
        self.assertIn("authority-only", label)
        self.assertIn("provenance", label)


if __name__ == "__main__":
    unittest.main()
