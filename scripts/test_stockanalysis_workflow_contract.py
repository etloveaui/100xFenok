#!/usr/bin/env python3
"""Static route contract for bounded scheduled StockAnalysis stock acquisition."""

from __future__ import annotations

import json
import hashlib
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml"
STOCK_CRON = "20 21 * * *"


class StockAnalysisWorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = WORKFLOW.read_text(encoding="utf-8")












    def test_etf_plane_candidate_preserves_active_siblings_and_git_only_names(self) -> None:
        match = re.search(
            r'python3 - "\$RUNNER_TEMP/stockanalysis-artifact" \\\n'
            r'\s+"\$RUNNER_TEMP/stockanalysis-plane-apply.json" "\$CANDIDATE_ROOT" \\\n'
            r'\s+"\$ACTIVE_ROOT" "scripts/fetch-stockanalysis.py" <<\'PYEOF\'\n'
            r'(?P<code>.*?)\n\s+PYEOF',
            self.text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match)
        script = textwrap.dedent(match.group("code"))
        with tempfile.TemporaryDirectory(prefix="etf-plane-merge-") as scratch:
            root = Path(scratch)
            repo = root / "repo"
            git_etfs = repo / "data" / "stockanalysis" / "etfs"
            active = root / "active"
            artifact = root / "artifact"
            payloads = artifact / "files" / "data" / "stockanalysis" / "etfs"
            for directory in (git_etfs, active, payloads):
                directory.mkdir(parents=True)
            now = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)

            def etf_payload(days_ago: float, *, partial: bool = False,
                            empty_quote: bool = False, malformed_history: bool = False,
                            truncated_history: bool = False) -> bytes:
                source = now - timedelta(days=days_ago)
                iso = lambda value: value.isoformat().replace("+00:00", "Z")
                history_rows = [
                    {"date": source.date().isoformat()},
                    {"date": (source - timedelta(days=1)).date().isoformat()},
                ]
                if malformed_history:
                    history_rows = [{}]
                elif truncated_history:
                    history_rows = history_rows[:1]
                result = {
                    "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                    "asset_type": "etf", "ticker": "TARGET",
                    "source_as_of": iso(source.replace(hour=0)) if empty_quote else iso(source),
                    "fetched_at": iso(source + timedelta(hours=1)),
                    "raw": {"quote": {} if empty_quote else {
                        "p": 100.0, "td": source.date().isoformat(), "ts": int(source.timestamp())}},
                    "normalized": {
                        "overview": {}, "holdings": [] if partial else [{"symbol": "TARGET"}],
                        "holding_count": None if partial else 1,
                        "holdings_updated": source.date().isoformat(),
                        "history_periods": {"daily_1y": history_rows},
                    },
                }
                if partial:
                    result["detail_status"] = "stockanalysis_partial"
                    result["partial_reason_codes"] = ["holdings_unavailable"]
                return json.dumps(result).encode()

            for name, body in {
                "KEEP.json": b"active-keep",
                "SHARED.json": b"active-shared",
                "TARGET.json": etf_payload(3),
            }.items():
                (active / name).write_bytes(body)
            for name, body in {
                "KEEP.json": b"old-git-keep",
                "SHARED.json": b"old-git-shared",
                "TARGET.json": etf_payload(2),
                "NEW.json": b"git-only",
            }.items():
                (git_etfs / name).write_bytes(body)
            for command in (
                ["git", "init", "-q"],
                ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "add", "data/stockanalysis/etfs"],
                ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "-qm", "ETF LKG fixture"],
            ):
                completed = subprocess.run(command, cwd=repo, text=True, capture_output=True, check=False)
                self.assertEqual(completed.returncode, 0, completed.stderr)
            target_rel = "data/stockanalysis/etfs/TARGET.json"
            applied = root / "applied.json"
            applied.write_text(json.dumps({"status": "validated", "paths": [target_rel]}), encoding="utf-8")
            def run_candidate(label: str, target_bytes: bytes) -> tuple[subprocess.CompletedProcess, Path]:
                candidate = root / label
                candidate.mkdir()
                for original in active.iterdir():
                    os.link(original, candidate / original.name)
                (payloads / "TARGET.json").write_bytes(target_bytes)
                (artifact / "manifest.json").write_text(json.dumps({
                    "paths": [target_rel],
                    "files": [{"path": target_rel, "size": len(target_bytes),
                               "sha256": hashlib.sha256(target_bytes).hexdigest()}],
                }), encoding="utf-8")
                run = subprocess.run(
                    [sys.executable, "-c", script, str(artifact), str(applied), str(candidate),
                     str(active), str(ROOT / "scripts" / "fetch-stockanalysis.py")],
                    cwd=repo, text=True, capture_output=True, check=False,
                )
                return run, candidate

            target_bytes = etf_payload(1)
            run, candidate = run_candidate("valid", target_bytes)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual({path.name for path in candidate.iterdir()},
                             {"KEEP.json", "SHARED.json", "TARGET.json", "NEW.json"})
            self.assertEqual((candidate / "KEEP.json").read_bytes(), b"active-keep")
            self.assertEqual((candidate / "SHARED.json").read_bytes(), b"active-shared")
            self.assertEqual((candidate / "TARGET.json").read_bytes(), target_bytes)
            self.assertEqual((candidate / "NEW.json").read_bytes(), b"git-only")
            self.assertEqual((active / "TARGET.json").read_bytes(), etf_payload(3))
            self.assertEqual(json.loads(run.stdout), {
                "active_etf_files": 3, "git_only_additions": 1,
                "artifact_etf_overlays": 1, "candidate_etf_files": 4,
                "retained_active_holdings": [],
                "attempted_members": 1, "accepted_members": 1, "refused_members": [], "refusal_budget": 3,
            })
            partial_bytes = etf_payload(1, partial=True)
            recovered, recovered_root = run_candidate("missing-holdings-retained", partial_bytes)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            combined = json.loads((recovered_root / "TARGET.json").read_bytes())
            baseline = json.loads(etf_payload(3))
            for key in ("holdings", "holding_count", "holdings_updated"):
                self.assertEqual(combined["normalized"][key], baseline["normalized"][key])
            self.assertEqual(combined["raw"]["quote"], json.loads(partial_bytes)["raw"]["quote"])
            self.assertEqual(combined["retained_holdings"]["fetched_at"], baseline["fetched_at"])
            self.assertEqual((active / "TARGET.json").read_bytes(), etf_payload(3))
            self.assertEqual((payloads / "TARGET.json").read_bytes(), partial_bytes)
            self.assertEqual(json.loads(recovered.stdout)["retained_active_holdings"], ["TARGET"])
            # TOCT/BCCC: overview samples remain nonempty after the holdings
            # endpoint fails. Preserve the larger verified active portfolio.
            sample = json.loads(partial_bytes)
            sample["normalized"].update(holdings=[{"symbol": "SAMPLE"}], holding_count=1)
            sample["partial_reason_codes"] = ["holdings_surface_fallback_overview", "holdings_countries_unavailable"]
            baseline["normalized"]["holdings"].append({"symbol": "SECOND"})
            baseline["normalized"]["holding_count"] = 2
            (active / "TARGET.json").write_bytes(json.dumps(baseline).encode())
            recovered, recovered_root = run_candidate("overview-sample-retained", json.dumps(sample).encode())
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertEqual(json.loads((recovered_root / "TARGET.json").read_bytes())["normalized"]["holdings"],
                             baseline["normalized"]["holdings"])
            (active / "TARGET.json").write_bytes(etf_payload(3))
            broken = json.loads(etf_payload(1, partial=True, truncated_history=True))
            rejected, _ = run_candidate("retained-holdings-still-rejects-history-loss", json.dumps(broken).encode())
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("loses active daily_1y history", rejected.stdout)
            for label, body, diagnostic in (
                ("active-regression", etf_payload(4), "regresses active"),
                ("lkg-regression", etf_payload(2.5), "regresses Git LKG"),
                ("quote-regression", etf_payload(1, empty_quote=True), "loses active usable quote"),
                ("history-regression", etf_payload(1, malformed_history=True), "loses active daily_1y history"),
                ("history-truncated", etf_payload(1, truncated_history=True), "loses active daily_1y history"),
            ):
                rejected, rejected_root = run_candidate(label, body)
                self.assertEqual(rejected.returncode, 0, rejected.stderr)
                self.assertIn(diagnostic, rejected.stdout)
                self.assertEqual((rejected_root / "TARGET.json").read_bytes(), (active / "TARGET.json").read_bytes())

            legacy = json.loads(etf_payload(3))
            del legacy["source_as_of"]
            legacy_bytes = json.dumps(legacy).encode()
            (active / "TARGET.json").write_bytes(legacy_bytes)
            recovered, recovered_root = run_candidate("legacy-active", target_bytes)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertEqual((recovered_root / "TARGET.json").read_bytes(), target_bytes)
            self.assertEqual((active / "TARGET.json").read_bytes(), legacy_bytes)
            for label, body, diagnostic in (
                ("legacy-active-regression", etf_payload(4), "regresses active"),
                ("legacy-quote-regression", etf_payload(1, empty_quote=True), "loses active usable quote"),
                ("legacy-history-regression", etf_payload(1, truncated_history=True), "loses active daily_1y history"),
                ("unstamped-artifact", legacy_bytes, "artifact contract invalid"),
            ):
                rejected, rejected_root = run_candidate(label, body)
                self.assertEqual(rejected.returncode, 0, rejected.stderr)
                self.assertIn(diagnostic, rejected.stdout)
                self.assertEqual((rejected_root / "TARGET.json").read_bytes(), legacy_bytes)

            # Older payloads did not label their already-missing country surface.
            # The same absence in a newer response is not loss of complete data.
            legacy["raw"]["holdings"] = {"countries": None}
            legacy["normalized"]["countries"] = None
            legacy_country_bytes = json.dumps(legacy).encode()
            (active / "TARGET.json").write_bytes(legacy_country_bytes)

            def country_partial(body):
                payload = json.loads(body)
                payload["raw"]["holdings"] = {"countries": None}
                payload["normalized"]["countries"] = None
                payload["detail_status"] = "stockanalysis_partial"
                payload["partial_reason_codes"] = ["holdings_countries_unavailable"]
                return json.dumps(payload).encode()

            (git_etfs / "TARGET.json").write_bytes(country_partial(etf_payload(2)))
            for command in (["git", "add", target_rel],
                            ["git", "-c", "user.name=Fixture", "-c",
                             "user.email=fixture@example.invalid", "commit", "-qm", "Partial country baseline"]):
                completed = subprocess.run(command, cwd=repo, text=True, capture_output=True, check=False)
                self.assertEqual(completed.returncode, 0, completed.stderr)
            country_bytes = country_partial(target_bytes)
            recovered, recovered_root = run_candidate("legacy-country-gap", country_bytes)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertEqual((recovered_root / "TARGET.json").read_bytes(), country_bytes)
            self.assertEqual((active / "TARGET.json").read_bytes(), legacy_country_bytes)

            missing_holdings = json.loads(country_bytes)
            missing_holdings["normalized"]["holdings"] = []
            extra_reason = json.loads(country_bytes)
            extra_reason["partial_reason_codes"].append("history_daily_1y_unavailable")
            raw_country = json.loads(country_bytes)
            raw_country["raw"]["holdings"]["countries"] = [{"country": "United States"}]
            normalized_country = json.loads(country_bytes)
            normalized_country["normalized"]["countries"] = [{"country": "United States"}]
            changed_count = json.loads(country_bytes)
            changed_count["normalized"]["holding_count"] = 2
            recovered, recovered_root = run_candidate("country-changed-count", json.dumps(changed_count).encode())
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertEqual(json.loads((recovered_root / "TARGET.json").read_bytes())["normalized"]["holding_count"], 2)
            chart_country = json.loads(country_bytes)
            chart_country["raw"]["holdings"]["allocationChartData"] = {
                "countries": [{"country": "United States", "weight": 100}]}
            for label, body, diagnostic in (
                ("country-source-regression", country_partial(etf_payload(4)), "regresses active"),
                ("country-quote-regression", country_partial(etf_payload(1, empty_quote=True)), "loses active usable quote"),
                ("country-history-regression", country_partial(etf_payload(1, truncated_history=True)), "loses active daily_1y history"),
                ("country-missing-holdings", json.dumps(missing_holdings).encode(), "loses complete active"),
                ("country-extra-reason", json.dumps(extra_reason).encode(), "loses complete active"),
                ("country-raw-inconsistent", json.dumps(raw_country).encode(), "loses complete active"),
                ("country-normalized-inconsistent", json.dumps(normalized_country).encode(), "loses complete active"),
                ("country-chart-inconsistent", json.dumps(chart_country).encode(), "loses complete active"),
            ):
                rejected, rejected_root = run_candidate(label, body)
                self.assertEqual(rejected.returncode, 0, rejected.stderr)
                self.assertIn(diagnostic, rejected.stdout)
                self.assertEqual((rejected_root / "TARGET.json").read_bytes(), legacy_country_bytes)

            for label, update in (
                ("country-explicit-baseline", {"source_as_of": json.loads(etf_payload(3))["source_as_of"]}),
                ("country-explicit-status", {"detail_status": "stockanalysis"}),
            ):
                explicit = {**legacy, **update}
                (active / "TARGET.json").write_bytes(json.dumps(explicit).encode())
                rejected, _ = run_candidate(label, country_bytes)
                self.assertEqual(rejected.returncode, 0, rejected.stderr)
                self.assertIn("loses complete active", rejected.stdout)

            legacy["raw"]["holdings"]["allocationChartData"] = {
                "countries": [{"country": "United States", "weight": 100}]}
            (active / "TARGET.json").write_bytes(json.dumps(legacy).encode())
            rejected, _ = run_candidate("country-baseline-chart-loss", country_bytes)
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("loses complete active", rejected.stdout)
            legacy["raw"]["holdings"]["allocationChartData"] = {"countries": []}

            legacy["normalized"]["holdings"].append({"symbol": "OTHER"})
            legacy["normalized"]["holding_count"] = 2
            (active / "TARGET.json").write_bytes(json.dumps(legacy).encode())
            rejected, _ = run_candidate("country-nonempty-shorter-holdings", json.dumps(changed_count).encode())
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("loses complete active", rejected.stdout)
            legacy["normalized"]["holdings"].pop()
            legacy["normalized"]["holding_count"] = 1

            legacy["normalized"]["sectors"] = [{"sector": "Financials", "weight": 100}]
            (active / "TARGET.json").write_bytes(json.dumps(legacy).encode())
            rejected, _ = run_candidate("country-sector-loss", country_bytes)
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("loses complete active", rejected.stdout)
            empty_sector = json.loads(country_bytes)
            empty_sector["normalized"]["sectors"] = []
            rejected, _ = run_candidate("country-sector-empty", json.dumps(empty_sector).encode())
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("loses complete active", rejected.stdout)
            legacy["normalized"]["sectors"] = None
            legacy["raw"]["holdings"]["sectors"] = [{"sector": "Financials"}]
            (active / "TARGET.json").write_bytes(json.dumps(legacy).encode())
            rejected, _ = run_candidate("country-raw-sector-loss", country_bytes)
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("loses complete active", rejected.stdout)
            legacy["raw"]["holdings"]["sectors"] = None

            legacy["normalized"]["countries"] = [{"country": "United States", "weight": 100}]
            (active / "TARGET.json").write_bytes(json.dumps(legacy).encode())
            rejected, _ = run_candidate("country-actual-loss", country_bytes)
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("loses complete active", rejected.stdout)

            def whole_native_portfolio(body, count):
                payload = json.loads(country_partial(body))
                day = payload["normalized"]["holdings_updated"]
                rows = [{"n": f"Position {index}"} for index in range(count)]
                payload["raw"]["holdings"].update(holdings=rows, count=count, date=day)
                payload["normalized"].update(
                    holdings=[{"name": row["n"], "raw": row} for row in rows], holding_count=count)
                return payload

            whole_old = whole_native_portfolio(etf_payload(3), 22)
            for field in ("source_as_of", "detail_status", "partial_reason_codes"):
                whole_old.pop(field, None)
            whole_old_bytes = json.dumps(whole_old).encode()
            (active / "TARGET.json").write_bytes(whole_old_bytes)
            whole_new = whole_native_portfolio(etf_payload(1), 21)
            whole_new_bytes = json.dumps(whole_new).encode()
            recovered, recovered_root = run_candidate("country-whole-fund-count-decreased", whole_new_bytes)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertEqual((recovered_root / "TARGET.json").read_bytes(), whole_new_bytes)
            self.assertEqual((active / "TARGET.json").read_bytes(), whole_old_bytes)
            for label, edit in (
                ("whole-fund-truncated", lambda p: p["raw"]["holdings"].update(count=22)),
                ("whole-fund-unbound-row", lambda p: p["normalized"]["holdings"][0].update(raw={})),
                ("whole-fund-unbound-date", lambda p: p["normalized"].update(
                    holdings_updated=whole_old["normalized"]["holdings_updated"])),
            ):
                candidate_body = json.loads(whole_new_bytes)
                edit(candidate_body)
                rejected, rejected_root = run_candidate(label, json.dumps(candidate_body).encode())
                self.assertEqual(rejected.returncode, 0, rejected.stderr)
                self.assertIn("loses complete active", rejected.stdout)
                self.assertEqual((rejected_root / "TARGET.json").read_bytes(), whole_old_bytes)
            regressed_source = whole_native_portfolio(etf_payload(4), 21)
            rejected, _ = run_candidate("whole-fund-source-regression", json.dumps(regressed_source).encode())
            self.assertEqual(rejected.returncode, 0, rejected.stderr)
            self.assertIn("regresses active", rejected.stdout)

            # One refusal among400 retains its exact prior object while399
            # new members reach the candidate. Four refusals exceed floor3.
            for directory in (active, git_etfs, payloads):
                for owned in directory.iterdir():
                    owned.unlink()
            old_bodies = {}
            for index in range(400):
                ticker = f"ETF{index:03d}"
                old = json.loads(etf_payload(3)); old["ticker"] = ticker
                body = json.dumps(old).encode()
                old_bodies[ticker] = body
                (active / f"{ticker}.json").write_bytes(body)
                (git_etfs / f"{ticker}.json").write_bytes(body)
            subprocess.run(["git", "add", "--", "data/stockanalysis/etfs"], cwd=repo, check=True)
            subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                            "commit", "-qm", "400 ETF baseline"], cwd=repo, check=True, capture_output=True)

            def run_batch(label, refusal_count, corrupt=False):
                target = root / label; target.mkdir()
                for original in active.iterdir():
                    os.link(original, target / original.name)
                rows = []
                for index in range(400):
                    ticker = f"ETF{index:03d}"
                    payload = json.loads(etf_payload(4 if index < refusal_count else 1))
                    payload["ticker"] = ticker
                    body = json.dumps(payload).encode()
                    rel = f"data/stockanalysis/etfs/{ticker}.json"
                    (payloads / f"{ticker}.json").write_bytes(body)
                    rows.append({"path": rel, "size": len(body), "sha256": hashlib.sha256(body).hexdigest()})
                if corrupt:
                    (payloads / "ETF000.json").write_bytes(b"corrupt")
                paths = [row["path"] for row in rows]
                (artifact / "manifest.json").write_text(json.dumps({"paths": paths, "files": rows}))
                applied.write_text(json.dumps({"status": "validated", "paths": paths}))
                result = subprocess.run([sys.executable, "-c", script, str(artifact), str(applied),
                                         str(target), str(active), str(ROOT / "scripts" / "fetch-stockanalysis.py")],
                                        cwd=repo, text=True, capture_output=True, check=False)
                return result, target

            batch, batch_root = run_batch("one-refusal-in-400", 1)
            self.assertEqual(batch.returncode, 0, batch.stderr)
            report = json.loads(batch.stdout)
            self.assertEqual(report["accepted_members"], 399)
            self.assertEqual(report["refusal_budget"], 3)
            self.assertEqual([row["ticker"] for row in report["refused_members"]], ["ETF000"])
            self.assertEqual(report["refused_members"][0]["disposition"], "retained")
            self.assertEqual((batch_root / "ETF000.json").read_bytes(), old_bodies["ETF000"])
            self.assertEqual(report["refused_members"][0]["source_as_of"], json.loads(old_bodies["ETF000"])["source_as_of"])
            self.assertEqual(len(list(batch_root.iterdir())), 400)
            for index in range(1, 400):
                name = f"ETF{index:03d}.json"
                self.assertEqual((batch_root / name).read_bytes(), (payloads / name).read_bytes())
            over, _ = run_batch("too-many-refusals", 4)
            self.assertNotEqual(over.returncode, 0)
            self.assertIn("exceed budget: 4 > 3", over.stderr)
            self.assertEqual([r["ticker"] for r in json.loads(over.stdout)["refused_members"]],
                             ["ETF000", "ETF001", "ETF002", "ETF003"])
            corrupt, corrupt_root = run_batch("artifact-integrity-failure", 0, corrupt=True)
            self.assertNotEqual(corrupt.returncode, 0)
            self.assertIn("artifact changed after apply", corrupt.stderr)
            self.assertEqual((corrupt_root / "ETF001.json").read_bytes(), old_bodies["ETF001"])
            self.assertEqual((active / "ETF000.json").read_bytes(), old_bodies["ETF000"])











if __name__ == "__main__":
    unittest.main()
