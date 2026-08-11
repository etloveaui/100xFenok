#!/usr/bin/env python3
"""Contract checks for StockAnalysis surface definitions and DataPack outputs."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FETCHER_PATH = ROOT / "scripts" / "fetch-stockanalysis.py"
SURFACE_DIR = Path(
    os.environ.get("STOCKANALYSIS_SOURCE_SURFACE_DIR", ROOT / "data" / "stockanalysis" / "surfaces")
)
PUBLIC_SURFACE_DIR = Path(
    os.environ.get(
        "STOCKANALYSIS_PROJECTION_ORACLE_DIR",
        ROOT / "100xfenok-next" / "public" / "data" / "stockanalysis" / "surfaces",
    )
)


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
                self.assertEqual(source_path.read_bytes(), public_path.read_bytes())

    def test_surface_sets_reference_known_surfaces(self) -> None:
        defined = set(self.fetcher.SURFACE_DEFINITIONS)
        for set_name, surfaces in self.fetcher.SURFACE_SETS.items():
            with self.subTest(surface_set=set_name):
                self.assertTrue(surfaces)
                self.assertTrue(set(surfaces).issubset(defined))

    def test_source_producer_never_projects_surfaces_and_central_projection_owns_public(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("100xfenok-next/public/data/stockanalysis", workflow)
        self.assertNotIn("restore_public_surfaces", workflow)

        projection_workflow = (
            ROOT / ".github" / "workflows" / "update-manifest.yml"
        ).read_text(encoding="utf-8")
        projection_runner = (
            ROOT / "scripts" / "update-manifest-projections.sh"
        ).read_text(encoding="utf-8")
        lane_manifest = json.loads(
            (ROOT / "data" / "admin" / "lane-commit-manifest.json").read_text(encoding="utf-8")
        )
        stockanalysis_routes = [
            route
            for route in lane_manifest["update_manifest"]["materializations"]
            if route["source"] == "data/stockanalysis"
        ]
        self.assertEqual(stockanalysis_routes, [{
            "source": "data/stockanalysis",
            "destination": "100xfenok-next/public/data/stockanalysis",
            "mode": "rsync_tree",
            "delete": True,
            "required": True,
            "trailing_slash": True,
            "excludes": ["etfs"],
        }])

        materialize = "node scripts/materialize-update-manifest-routes.mjs --all"
        validate_only = f"{materialize} --validate-only --assert-no-untracked"
        initial_block = projection_workflow.split("      - name: Check if manifest changed", 1)[0]
        retry_block = projection_workflow.split("          for attempt in 1 2 3; do", 1)[1]
        initial_lines = [line.strip() for line in initial_block.splitlines()]
        retry_lines = [line.strip() for line in retry_block.splitlines()]
        runner_call = "bash scripts/update-manifest-projections.sh"
        initial_runner_call = f"run: {runner_call}"
        runner_lines = [line.strip() for line in projection_runner.splitlines()]
        self.assertEqual(initial_lines.count(initial_runner_call), 1)
        self.assertEqual(retry_lines.count(runner_call), 1)
        self.assertEqual(runner_lines.count(materialize), 1)
        self.assertEqual(retry_lines.count(validate_only), 1)
        self.assertLess(retry_lines.index(validate_only), retry_lines.index(runner_call))
        self.assertNotIn(
            "rsync -a --checksum --delete data/stockanalysis/ 100xfenok-next/public/data/stockanalysis/",
            projection_workflow,
        )

        # Run 30689758451 died at the immutable-snapshot guard because the retry
        # attempt re-projected on top of an earlier projection's snapshot
        # directory still present in the working tree. A content-addressed
        # directory may be replaced, never compared against a stale sibling, so
        # the retry must start from an empty snapshot root every attempt.
        shard_projection = "node 100xfenok-next/scripts/sync-public-data.mjs --write --etf-shards-only"
        snapshot_reset = (
            "rm -rf 100xfenok-next/public/data/stockanalysis/etfs/shards/snapshots"
        )
        self.assertEqual(runner_lines.count(shard_projection), 1)
        self.assertEqual(
            runner_lines.count(snapshot_reset),
            1,
            "the retry attempt must clear the ETF shard snapshot root exactly once",
        )
        self.assertLess(
            runner_lines.index(snapshot_reset),
            runner_lines.index(shard_projection),
            "the snapshot root must be cleared BEFORE the shard projection re-runs",
        )

        # The surfaces mirror drifted two producer cycles behind its source and
        # nothing noticed: the only CI run of this contract overrides the
        # comparison target with a copy of the source, so its byte-equality
        # assertion cannot fail there. SlickCharts already proves the mirror
        # immediately after projection; StockAnalysis surfaces must too. Scoped to
        # surfaces on purpose -- `etfs/` is deliberately shard-only and excluded
        # from this mirror, so a whole-tree diff would fail by contract.
        surfaces_diff = (
            "diff -qr data/stockanalysis/surfaces "
            "100xfenok-next/public/data/stockanalysis/surfaces"
        )
        self.assertEqual(
            runner_lines.count(surfaces_diff),
            1,
            "the shared runner must verify the surfaces mirror exactly once",
        )
        self.assertLess(
            runner_lines.index(materialize),
            runner_lines.index(surfaces_diff),
            "the surfaces check must run AFTER the projection it verifies",
        )
        self.assertNotIn(
            "diff -qr data/stockanalysis 100xfenok-next/public/data/stockanalysis",
            projection_workflow,
            "a whole-tree stockanalysis diff would fail by contract; etfs/ is shard-only",
        )

    # NOTE: test_surface_catalog_labels_cover_all_index_groups removed — it validated
    # SurfaceCatalogCard.tsx groupLabel coverage, but that public diagnostic card was
    # intentionally removed in ef5227996. The catalog/groupLabel surface no longer exists.


if __name__ == "__main__":
    unittest.main()
