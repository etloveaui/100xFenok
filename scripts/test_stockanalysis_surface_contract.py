#!/usr/bin/env python3
"""Contract checks for StockAnalysis surface definitions and DataPack outputs."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FETCHER_PATH = ROOT / "scripts" / "fetch-stockanalysis.py"
SURFACE_DIR = ROOT / "data" / "stockanalysis" / "surfaces"
PUBLIC_SURFACE_DIR = ROOT / "100xfenok-next" / "public" / "data" / "stockanalysis" / "surfaces"


def load_fetcher_module():
    spec = importlib.util.spec_from_file_location("stockanalysis_fetcher", FETCHER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load fetcher module from {FETCHER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def surface_stems(directory: Path) -> set[str]:
    return {path.stem for path in directory.glob("*.json") if path.name != "index.json"}


class StockanalysisSurfaceContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fetcher = load_fetcher_module()
        cls.index = json.loads((SURFACE_DIR / "index.json").read_text(encoding="utf-8"))
        cls.public_index = json.loads((PUBLIC_SURFACE_DIR / "index.json").read_text(encoding="utf-8"))

    def test_surface_index_matches_fetcher_definitions(self) -> None:
        defined = set(self.fetcher.SURFACE_DEFINITIONS)
        source_files = surface_stems(SURFACE_DIR)
        public_files = surface_stems(PUBLIC_SURFACE_DIR)
        indexed = {row.get("surface") for row in self.index.get("results", [])}

        self.assertEqual(source_files, defined)
        self.assertEqual(public_files, defined)
        self.assertEqual(indexed, defined)
        self.assertEqual(self.index.get("counts", {}).get("surfaces_requested"), len(defined))
        self.assertEqual(self.index.get("counts", {}).get("failed"), 0)

    def test_public_surface_index_matches_source_index(self) -> None:
        source_rows = self.index.get("results", [])
        public_rows = self.public_index.get("results", [])

        self.assertEqual(self.public_index.get("counts"), self.index.get("counts"))
        self.assertEqual([row.get("surface") for row in public_rows], [row.get("surface") for row in source_rows])

    def test_every_ok_surface_has_valid_source_and_public_json(self) -> None:
        for row in self.index.get("results", []):
            with self.subTest(surface=row.get("surface")):
                self.assertEqual(row.get("status"), "ok")
                rel_path = row.get("path")
                self.assertIsInstance(rel_path, str)

                source_path = SURFACE_DIR.parent / rel_path
                public_path = PUBLIC_SURFACE_DIR.parent / rel_path
                source_payload = json.loads(source_path.read_text(encoding="utf-8"))
                public_payload = json.loads(public_path.read_text(encoding="utf-8"))

                self.assertEqual(source_payload.get("surface"), row.get("surface"))
                self.assertEqual(public_payload.get("surface"), row.get("surface"))
                self.assertEqual(source_payload.get("counts"), public_payload.get("counts"))

    def test_surface_sets_reference_known_surfaces(self) -> None:
        defined = set(self.fetcher.SURFACE_DEFINITIONS)
        for set_name, surfaces in self.fetcher.SURFACE_SETS.items():
            with self.subTest(surface_set=set_name):
                self.assertTrue(surfaces)
                self.assertTrue(set(surfaces).issubset(defined))


if __name__ == "__main__":
    unittest.main()
