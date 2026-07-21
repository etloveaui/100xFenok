import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_policy import (
    PolicyRegistryError,
    get_domain_policy,
    load_policy_registry,
    policy_registry_digest,
    registered_domains,
)


REGISTRY_PATH = SCRIPT_DIR / "data_supply_policy_registry.v1.json"
FIXTURE_DIR = SCRIPT_DIR / "fixtures" / "data_supply" / "policy_registry"
EXPECTED_DIGEST_PATH = FIXTURE_DIR / "registry.expected.json"

ETF_CONSUMER = "scripts.data_supply_resolver"
STOCK_CONSUMER = "scripts.data_supply_stock_detail"


class DataSupplyPolicyTests(unittest.TestCase):
    def test_etf_detail_policy_preserves_frozen_contract(self):
        policy = get_domain_policy("etf_detail", consumer_id=ETF_CONSUMER)
        self.assertEqual(policy.provider_names, ("stockanalysis", "yahoo_finance"))
        self.assertEqual(policy.primary.endpoint_family, "stockanalysis_etf_detail")
        self.assertEqual(policy.primary.schema, "stockanalysis/v1")
        self.assertEqual(policy.fallback.endpoint_family, "yahoo_finance_etf_detail")
        self.assertEqual(policy.fallback.schema, "yf-etf-detail/v1")
        self.assertEqual(policy.fresh_ttl_hours, 168)
        self.assertEqual(policy.emergency_lkg_ttl_days, 14)
        self.assertEqual(policy.recovery_green_required, 3)
        self.assertEqual(policy.resolution_scope, "domain_atomic")
        self.assertIn(ETF_CONSUMER, policy.allowed_consumers)
        self.assertEqual(policy.policy_digest, policy_registry_digest())
        with self.assertRaises(FrozenInstanceError):
            policy.fresh_ttl_hours = 1

    def test_stock_detail_policy_uses_stock_endpoint_and_schema_contracts(self):
        policy = get_domain_policy("stock_detail", consumer_id=STOCK_CONSUMER)
        self.assertEqual(policy.provider_names, ("stockanalysis", "yahoo_finance"))
        self.assertEqual(policy.primary.endpoint_family, "stockanalysis_stock_detail")
        self.assertEqual(policy.primary.schema, "stockanalysis/v1")
        self.assertEqual(policy.fallback.endpoint_family, "yahoo_finance_stock_detail")
        self.assertEqual(policy.fallback.schema, "yf-finance/v2")
        self.assertEqual(policy.fresh_ttl_hours, 168)
        self.assertEqual(policy.emergency_lkg_ttl_days, 14)
        self.assertEqual(policy.recovery_green_required, 3)
        self.assertEqual(policy.resolution_scope, "domain_atomic")
        self.assertIn(STOCK_CONSUMER, policy.allowed_consumers)

    def test_registry_is_exactly_two_domains_and_digest_is_pinned(self):
        self.assertEqual(registered_domains(), ("etf_detail", "stock_detail"))
        expected = json.loads(EXPECTED_DIGEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(expected["schema_version"], "data-supply-policy-registry-expected/v1")
        self.assertEqual(policy_registry_digest(), expected["policy_digest"])

    def test_negative_registry_fixtures_fail_closed(self):
        for path in sorted(FIXTURE_DIR.glob("invalid-*.json")):
            with self.subTest(path=path.name), self.assertRaises(PolicyRegistryError):
                load_policy_registry(path)

    def test_missing_registry_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing-policy.json"
            with self.assertRaises(PolicyRegistryError):
                load_policy_registry(missing)

    def test_unauthorized_consumer_and_unknown_provider_fail_closed(self):
        with self.assertRaises(PolicyRegistryError):
            get_domain_policy("etf_detail", consumer_id="scripts.not_authorized")
        policy = get_domain_policy("etf_detail", consumer_id=ETF_CONSUMER)
        with self.assertRaises(KeyError):
            policy.provider("unknown_provider")

    def test_unknown_domain_fails_closed(self):
        with self.assertRaises(KeyError):
            get_domain_policy("unknown_detail", consumer_id=ETF_CONSUMER)

    def test_direct_python_consumers_fail_in_fresh_process_on_invalid_registry(self):
        invalid = FIXTURE_DIR / "invalid-wrong-digest.json"
        consumers = (
            "data_supply_resolver",
            "data_supply_state",
            "data_supply_stock_detail",
            "migrate_data_supply_stock_detail",
        )
        for module in consumers:
            env = os.environ.copy()
            env["DATA_SUPPLY_POLICY_REGISTRY_PATH"] = str(invalid)
            result = subprocess.run(
                [sys.executable, "-c", f"import {module}"],
                cwd=SCRIPT_DIR,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            with self.subTest(module=module):
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("data-supply-policy-registry", result.stderr)


if __name__ == "__main__":
    unittest.main()
