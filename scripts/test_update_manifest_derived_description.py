"""Derived manifest descriptions must track the payload they describe."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "update-manifest.py"


def _load():
    spec = importlib.util.spec_from_file_location("update_manifest", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DerivedDescriptionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.mod = _load()
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_model(self, payload: object) -> None:
        (self.folder / "yardney_model.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_yardney_description_follows_model_meta_and_last_record(self) -> None:
        self._write_model(
            {
                "meta": {"total_records": 1899, "date_range": "1990-02-02 ~ 2026-09-18"},
                "data": [
                    {"date": "2026-09-11", "fair_value": 6496.44, "premium_pct": 18.71},
                    {"date": "2026-09-18", "fair_value": 6437.65, "premium_pct": 18.84},
                ],
            }
        )
        entry = {"description": "Feno Yardeni model — 1,896 records (1990-02-02 ~ 2026-08-28), fair value 6,496.44 (+18.71%)"}
        reasons = self.mod.refresh_derived_description("yardney", self.folder, entry)
        self.assertEqual(reasons, ["description derived from payload"])
        self.assertEqual(
            entry["description"],
            "Feno Yardeni model — 1,899 records (1990-02-02 ~ 2026-09-18), fair value 6,437.65 (+18.84%)",
        )
        # Idempotent: a second pass reports nothing.
        self.assertEqual(self.mod.refresh_derived_description("yardney", self.folder, entry), [])

    def test_unreadable_or_incomplete_model_leaves_text_untouched(self) -> None:
        entry = {"description": "kept"}
        self.assertEqual(self.mod.refresh_derived_description("yardney", self.folder, entry), [])
        self._write_model({"meta": {"total_records": 3}, "data": []})
        self.assertEqual(self.mod.refresh_derived_description("yardney", self.folder, entry), [])
        self.assertEqual(entry["description"], "kept")

    def test_folders_without_a_derivation_are_ignored(self) -> None:
        entry = {"description": "hand text"}
        self.assertEqual(self.mod.refresh_derived_description("benchmarks", self.folder, entry), [])
        self.assertEqual(entry["description"], "hand text")


if __name__ == "__main__":
    unittest.main()
