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
