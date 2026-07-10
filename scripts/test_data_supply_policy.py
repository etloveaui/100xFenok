import sys
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_policy import get_domain_policy


class DataSupplyPolicyTests(unittest.TestCase):
    def test_etf_detail_policy_preserves_frozen_contract(self):
        policy = get_domain_policy("etf_detail")
        self.assertEqual(policy.provider_names, ("stockanalysis", "yahoo_finance"))
        self.assertEqual(policy.primary.endpoint_family, "stockanalysis_etf_detail")
        self.assertEqual(policy.primary.schema, "stockanalysis/v1")
        self.assertEqual(policy.fallback.endpoint_family, "yahoo_finance_etf_detail")
        self.assertEqual(policy.fallback.schema, "yf-etf-detail/v1")
        self.assertEqual(policy.fresh_ttl_hours, 168)
        self.assertEqual(policy.emergency_lkg_ttl_days, 14)
        self.assertEqual(policy.recovery_green_required, 3)
        with self.assertRaises(FrozenInstanceError):
            policy.fresh_ttl_hours = 1

    def test_stock_detail_policy_uses_stock_endpoint_and_schema_contracts(self):
        policy = get_domain_policy("stock_detail")
        self.assertEqual(policy.provider_names, ("stockanalysis", "yahoo_finance"))
        self.assertEqual(policy.primary.endpoint_family, "stockanalysis_stock_detail")
        self.assertEqual(policy.primary.schema, "stockanalysis/v1")
        self.assertEqual(policy.fallback.endpoint_family, "yahoo_finance_stock_detail")
        self.assertEqual(policy.fallback.schema, "yf-finance/v2")
        self.assertEqual(policy.fresh_ttl_hours, 168)
        self.assertEqual(policy.emergency_lkg_ttl_days, 14)
        self.assertEqual(policy.recovery_green_required, 3)

    def test_unknown_domain_fails_closed(self):
        with self.assertRaises(KeyError):
            get_domain_policy("unknown_detail")


if __name__ == "__main__":
    unittest.main()
