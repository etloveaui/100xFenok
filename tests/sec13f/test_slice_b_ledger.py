#!/usr/bin/env python3
"""RED-first state and recovery contract for SEC 13F Slice B."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts" / "sec13f"
FIXTURES = ROOT / "tests" / "sec13f" / "fixtures"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from amendments import AmendmentError, compose_amendments  # noqa: E402
from client import SecClient  # noqa: E402
from generator import ANALYTIC_NAMES, generate_base_outputs  # noqa: E402
from ledger import AcquisitionSnapshot, IncrementalLedger, LedgerError, RunFailure  # noqa: E402


def _digest(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _tree(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _documents(investor_data: dict) -> list[dict]:
    rows = []
    for investor_id, investor in sorted(investor_data.items()):
        for filing in investor["filings"]:
            for order, accession in enumerate(filing["accession_numbers"]):
                blobs = []
                for role, name in (("primary", "primary.xml"), ("information_table", "infotable.xml")):
                    digest = hashlib.sha256(f"{investor_id}:{accession}:{role}".encode()).hexdigest()
                    blobs.append(
                        {
                            "role": role,
                            "name": name,
                            "url": f"fixture://{accession}/{name}",
                            "sha256": digest,
                            "bytes": len(accession) + len(role),
                            "cache_path": f"raw/{investor['cik']}/{accession}/{name}",
                        }
                    )
                rows.append(
                    {
                        "investor_id": investor_id,
                        "cik": investor["cik"],
                        "accession": accession,
                        "form": filing["form"],
                        "report_date": filing["report_date"],
                        "filing_date": filing["filing_date"],
                        "amendment_type": None,
                        "amendment_number": None,
                        "component_order": order,
                        "documents": blobs,
                    }
                )
    return rows


class SliceBLedgerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = yaml.safe_load((SCRIPTS / "config" / "investors.yaml").read_text())
        cls.fixture = json.loads((FIXTURES / "generator_input.json").read_text())

    def snapshot(self, investor_data: dict | None = None) -> AcquisitionSnapshot:
        data = deepcopy(investor_data or self.fixture["investors_data"])
        return AcquisitionSnapshot(
            registry_digest=self.fixture["registry_sha256"],
            investor_data=data,
            documents=_documents(data),
        )

    def test_ledger_rejects_canonical_public_and_ancestor_state_roots(self) -> None:
        for root in (
            ROOT / "data" / "sec-13f",
            ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
            ROOT / "data",
        ):
            with self.subTest(root=root), self.assertRaisesRegex(LedgerError, "protected"):
                IncrementalLedger(root)

    def generator(self, investor_data: dict, output_root: Path) -> dict:
        return generate_base_outputs(
            registry=self.registry,
            investor_data=investor_data,
            output_root=output_root,
            generated_at=self.fixture["generated_at"],
            summary_metadata_extra=self.fixture["summary_metadata_extra"],
        )

    def seed(self, root: Path) -> IncrementalLedger:
        ledger = IncrementalLedger(root)
        result = ledger.execute(
            run_id="baseline",
            acquire=self.snapshot,
            generate=self.generator,
        )
        self.assertEqual(result["status"], "published")
        self.assertFalse(result["publish_blocked"])
        return ledger

    def test_fault_matrix_preserves_prior_lkg_and_blocks_publish(self) -> None:
        failures = [
            RunFailure("timeout"),
            RunFailure("auth", http_status=403),
            RunFailure("rate_limited", http_status=429),
            *(RunFailure("server_error", http_status=status) for status in (500, 502, 503, 504)),
            RunFailure("cache_digest_mismatch", accession="0000000001-26-000001"),
            RunFailure("missing_cover_xml", accession="0000000001-26-000001"),
            RunFailure("missing_information_table", accession="0000000001-26-000001"),
            RunFailure("cover_count_mismatch", accession="0000000001-26-000001"),
            RunFailure("cover_value_mismatch", accession="0000000001-26-000001"),
            RunFailure("unexplained_zero_holdings", accession="0000000001-26-000001"),
            RunFailure("unknown_or_missing_amendment_type", accession="0000000001-26-000001"),
            RunFailure("ambiguous_same_day_amendment_order", accession="0000000001-26-000001"),
        ]
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            stable_state = (root / "state.json").read_bytes()
            stable_runs = _tree(root / "runs")
            for index, expected in enumerate(failures):
                with self.subTest(kind=expected.kind, status=expected.http_status):
                    def acquire(error=expected):
                        raise error

                    result = ledger.execute(
                        run_id=f"fault-{index}",
                        acquire=acquire,
                        generate=self.generator,
                    )
                    self.assertEqual(result["status"], "blocked")
                    self.assertTrue(result["publish_blocked"])
                    self.assertEqual(result["failure"]["kind"], expected.kind)
                    self.assertEqual(result["failure"]["http_status"], expected.http_status)
                    self.assertEqual((root / "state.json").read_bytes(), stable_state)
                    self.assertEqual(_tree(root / "runs"), stable_runs)

    def test_crash_failpoints_never_advance_state_or_publish_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            stable_state = (root / "state.json").read_bytes()
            stable_runs = _tree(root / "runs")
            for index, failpoint in enumerate(("after_acquisition", "after_generation"), start=1):
                with self.subTest(failpoint=failpoint):
                    changed = deepcopy(self.fixture["investors_data"])
                    filing = changed[sorted(changed)[0]]["filings"][-1]
                    accession = f"0001578684-26-99999{index}"
                    filing["accession_numbers"].append(accession)
                    filing["accession_number"] += f"+{accession}"
                    result = ledger.execute(
                        run_id=f"crash-{failpoint}",
                        acquire=lambda data=changed: self.snapshot(data),
                        generate=self.generator,
                        failpoint=failpoint,
                    )
                    self.assertEqual(result["status"], "blocked")
                    self.assertEqual(result["failure"]["kind"], "simulated_crash")
                    self.assertEqual((root / "state.json").read_bytes(), stable_state)
                    self.assertEqual(_tree(root / "runs"), stable_runs)
                    self.assertFalse((root / "runs" / result.get("source_set_digest", "missing")).exists())

    def test_typed_client_failure_flows_into_blocked_attempt_without_lkg_advance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            state_before = (root / "state.json").read_bytes()
            client = SecClient.fixture(
                user_agent="Fenok ledger@fenok.test",
                transport=lambda *_args: (403, b"forbidden"),
                sleep=lambda _seconds: None,
            )

            def acquire():
                client.get_bytes("https://fixture.invalid/403")
                return self.snapshot()

            result = ledger.execute(
                run_id="client-403",
                acquire=acquire,
                generate=self.generator,
            )
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["failure"]["kind"], "auth")
            self.assertEqual(result["failure"]["http_status"], 403)
            self.assertEqual((root / "state.json").read_bytes(), state_before)

    def test_identical_accession_replay_is_byte_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            before_state = (root / "state.json").read_bytes()
            before_runs = _tree(root / "runs")
            result = ledger.execute(
                run_id="replay",
                acquire=self.snapshot,
                generate=lambda *_args: self.fail("generator must not run for verified replay"),
            )
            self.assertEqual(result["status"], "replayed")
            self.assertFalse(result["publish_blocked"])
            self.assertEqual((root / "state.json").read_bytes(), before_state)
            self.assertEqual(_tree(root / "runs"), before_runs)

    def test_corrupt_verified_run_cannot_be_accepted_as_a_replay(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            state_before = (root / "state.json").read_bytes()
            pointer = json.loads(state_before)["current"]
            summary = root / pointer["run_root"] / "outputs" / "summary.json"
            summary.write_bytes(summary.read_bytes() + b" ")
            result = ledger.execute(
                run_id="corrupt-replay",
                acquire=self.snapshot,
                generate=lambda *_args: self.fail("corrupt verified run must fail before generation"),
            )
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["failure"]["kind"], "generation_output_digest_mismatch")
            self.assertEqual((root / "state.json").read_bytes(), state_before)

    def test_abandoned_attempt_recovery_never_changes_active_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            state_before = (root / "state.json").read_bytes()
            abandoned = root / "attempts" / "abandoned.json"
            abandoned.write_text(json.dumps({
                "schema_version": "sec13f-attempt/v1",
                "run_id": "abandoned",
                "status": "acquired",
                "publish_blocked": True,
                "source_set_digest": "0" * 64,
            }))
            recovered = ledger.recover_abandoned_runs()
            self.assertEqual(recovered, ["abandoned"])
            attempt = json.loads(abandoned.read_text())
            self.assertEqual(attempt["status"], "blocked")
            self.assertEqual(attempt["failure"]["kind"], "abandoned_run")
            self.assertEqual((root / "state.json").read_bytes(), state_before)

    def test_verified_orphan_run_is_promoted_on_resume_after_pointer_crash(self) -> None:
        changed = deepcopy(self.fixture["investors_data"])
        filing = changed[sorted(changed)[0]]["filings"][-1]
        accession = "0001578684-26-999998"
        filing["accession_numbers"].append(accession)
        filing["accession_number"] += f"+{accession}"
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            state_before = (root / "state.json").read_bytes()
            crashed = ledger.execute(
                run_id="pointer-crash",
                acquire=lambda: self.snapshot(changed),
                generate=self.generator,
                failpoint="after_run_publish",
            )
            self.assertEqual(crashed["status"], "blocked")
            self.assertEqual((root / "state.json").read_bytes(), state_before)
            resumed = ledger.execute(
                run_id="pointer-resume",
                acquire=lambda: self.snapshot(changed),
                generate=lambda *_args: self.fail("verified orphan must not regenerate"),
            )
            self.assertEqual(resumed["status"], "published_recovered")
            self.assertNotEqual((root / "state.json").read_bytes(), state_before)
            self.assertEqual(
                json.loads((root / "state.json").read_text())["current"]["source_set_digest"],
                crashed["source_set_digest"],
            )

    def test_one_new_accession_changes_only_target_and_dependent_indexes(self) -> None:
        changed = deepcopy(self.fixture["investors_data"])
        investor_id = sorted(changed)[0]
        filing = changed[investor_id]["filings"][-1]
        filing["accession_numbers"].append("0001578684-26-999999")
        filing["accession_number"] += "+0001578684-26-999999"
        added = deepcopy(filing["holdings"][0])
        added.update(
            ticker="SLICEB",
            cusip="SLICEB001",
            name="Slice B Incremental Position",
            shares=10_000,
            market_value=100_000,
        )
        filing["holdings"].append(added)
        filing["aum_total"] += 100_000
        filing["holdings_count"] += 1
        filing["reported_holdings_count"] += 1
        for holding in filing["holdings"]:
            holding["weight"] = round(holding["market_value"] / filing["aum_total"], 4)
        filing["top_10_weight"] = round(
            sum(
                row["weight"]
                for row in sorted(filing["holdings"], key=lambda row: -row["market_value"])[:10]
            ),
            4,
        )

        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            ledger = self.seed(root)
            before_pointer = json.loads((root / "state.json").read_text())["current"]
            before_output = root / before_pointer["run_root"] / "outputs"
            before = _tree(before_output)
            result = ledger.execute(
                run_id="incremental",
                acquire=lambda: self.snapshot(changed),
                generate=self.generator,
            )
            self.assertEqual(result["status"], "published")
            after_pointer = json.loads((root / "state.json").read_text())["current"]
            after = _tree(root / after_pointer["run_root"] / "outputs")
            changed_paths = {path for path in before if before[path] != after[path]}
            expected = {
                f"investors/{investor_id}.json",
                "summary.json",
                "by_ticker.json",
                "by_sector.json",
                *(f"analytics/{name}" for name in ANALYTIC_NAMES),
            }
            self.assertEqual(changed_paths, expected)
            self.assertEqual(len([path for path in changed_paths if path.startswith("investors/")]), 1)
            before_manifest = json.loads(
                (root / before_pointer["run_root"] / "run-manifest.json").read_text()
            )
            after_manifest = json.loads(
                (root / after_pointer["run_root"] / "run-manifest.json").read_text()
            )
            changed_completion = {
                key
                for key in before_manifest["completion"]
                if before_manifest["completion"][key] != after_manifest["completion"][key]
            }
            self.assertEqual(changed_completion, {f"{investor_id}/2026-03-31"})

    def test_same_day_amendment_requires_unambiguous_number_order(self) -> None:
        base = {
            "accession": "0000000001-26-000001",
            "form": "13F-HR",
            "filing_date": "2026-05-15",
            "report_date": "2026-03-31",
            "amendment_type": None,
            "amendment_number": None,
            "cover": {"is_confidential_omitted": False},
            "holdings": [{"cusip": "A", "value": 1}],
        }
        amendment = {
            **deepcopy(base),
            "accession": "0000000001-26-000002",
            "form": "13F-HR/A",
            "amendment_type": "RESTATEMENT",
            "amendment_number": 1,
        }
        ambiguous = {
            **deepcopy(amendment),
            "accession": "0000000001-26-000003",
            "amendment_type": "NEW HOLDINGS",
        }
        with self.assertRaisesRegex(AmendmentError, "ambiguous_same_day_amendment_order"):
            compose_amendments([base, amendment, ambiguous])

        distinct = deepcopy(ambiguous)
        distinct["amendment_number"] = 2
        first = compose_amendments([base, amendment, distinct])
        second = compose_amendments([distinct, base, amendment])
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
