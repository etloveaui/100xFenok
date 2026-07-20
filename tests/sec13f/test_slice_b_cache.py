#!/usr/bin/env python3
"""Slice B immutable, digest-validated SEC raw-cache contract."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from cache import RawCache, RawCacheError  # noqa: E402


CIK = "0000000001"
ACCESSION = "0000000001-26-000001"


def document(role: str, name: str, content: bytes) -> dict:
    return {
        "role": role,
        "name": name,
        "url": (
            "https://www.sec.gov/Archives/edgar/data/1/"
            f"{ACCESSION.replace('-', '')}/{name}"
        ),
        "content": content,
    }


def fixture_documents() -> list[dict]:
    return [
        document("archive_index", "index.json", b'{"directory":{"item":[]}}'),
        document("primary", "primary.xml", b"<edgarSubmission/>"),
        document("information_table", "infotable.xml", b"<informationTable/>"),
    ]


def canonical(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def rewrite_manifest(path: Path, mutate) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.pop("content_digest")
    mutate(payload)
    payload["content_digest"] = hashlib.sha256(canonical(payload)).hexdigest()
    path.chmod(0o644)
    path.write_bytes(canonical(payload) + b"\n")


def byte_snapshot(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(item for item in root.rglob("*") if item.is_file())
    }


class SliceBRawCacheTest(unittest.TestCase):
    def test_cache_rejects_canonical_public_and_ancestor_roots(self) -> None:
        for root in (
            ROOT / "data" / "sec-13f",
            ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
            ROOT / "data",
        ):
            with self.subTest(root=root), self.assertRaises(RawCacheError) as raised:
                RawCache(root)
            self.assertEqual(raised.exception.reason, "cache_root_overlaps_protected_data")

    def test_store_and_load_address_every_required_document(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            cache = RawCache(root)
            stored = cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
            loaded = cache.load(cik=CIK, accession=ACCESSION)

            self.assertEqual(stored.manifest, loaded.manifest)
            self.assertEqual(stored.documents, loaded.documents)
            self.assertEqual(
                set(loaded.documents),
                {"archive_index", "primary", "information_table"},
            )
            self.assertEqual(loaded.documents["primary"], b"<edgarSubmission/>")
            self.assertEqual(
                set(loaded.manifest),
                {"schema_version", "cik", "accession", "documents", "content_digest"},
            )
            self.assertEqual(loaded.manifest["schema_version"], "sec13f-raw-cache/v1")
            for entry in loaded.manifest["documents"]:
                self.assertEqual(
                    set(entry), {"role", "name", "url", "sha256", "bytes"}
                )
                body = loaded.documents[entry["role"]]
                self.assertEqual(entry["bytes"], len(body))
                self.assertEqual(entry["sha256"], hashlib.sha256(body).hexdigest())

    def test_exact_replay_is_byte_idempotent_and_does_not_rewrite(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            cache = RawCache(root)
            first = cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
            before = byte_snapshot(root)
            manifest_mtime = (first.path / "manifest.json").stat().st_mtime_ns

            replayed = cache.store(
                cik=CIK,
                accession=ACCESSION,
                documents=list(reversed(fixture_documents())),
            )

            self.assertEqual(byte_snapshot(root), before)
            self.assertEqual(replayed.manifest, first.manifest)
            self.assertEqual(
                (first.path / "manifest.json").stat().st_mtime_ns,
                manifest_mtime,
            )

    def test_same_accession_content_drift_is_rejected_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            cache = RawCache(root)
            cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
            before = byte_snapshot(root)
            changed = fixture_documents()
            changed[1] = document("primary", "primary.xml", b"<changed/>")

            with self.assertRaises(RawCacheError) as raised:
                cache.store(cik=CIK, accession=ACCESSION, documents=changed)

            self.assertEqual(raised.exception.reason, "accession_content_drift")
            self.assertEqual(byte_snapshot(root), before)

    def test_new_accession_adds_one_leaf_without_mutating_prior_objects(self) -> None:
        second = "0000000001-26-000002"
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            cache = RawCache(root)
            first = cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
            before = byte_snapshot(first.path)
            second_documents = [
                {
                    **row,
                    "url": row["url"].replace(ACCESSION.replace("-", ""), second.replace("-", "")),
                }
                for row in fixture_documents()
            ]
            cache.store(cik=CIK, accession=second, documents=second_documents)
            self.assertEqual(byte_snapshot(first.path), before)
            self.assertEqual(
                sorted(path.name for path in (root / CIK).iterdir()),
                [ACCESSION, second],
            )

    def test_corrupt_document_bytes_are_detected_on_every_load(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            cache = RawCache(root)
            record = cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
            primary = next(
                row for row in record.manifest["documents"] if row["role"] == "primary"
            )
            object_path = record.path / "objects" / primary["sha256"]
            object_path.chmod(0o644)
            object_path.write_bytes(b"X" * primary["bytes"])

            with self.assertRaises(RawCacheError) as raised:
                cache.load(cik=CIK, accession=ACCESSION)

            self.assertEqual(raised.exception.reason, "document_digest_mismatch")

    def test_missing_document_object_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            cache = RawCache(Path(temporary_root))
            record = cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
            table = next(
                row
                for row in record.manifest["documents"]
                if row["role"] == "information_table"
            )
            object_path = record.path / "objects" / table["sha256"]
            object_path.chmod(0o644)
            object_path.unlink()

            with self.assertRaises(RawCacheError) as raised:
                cache.load(cik=CIK, accession=ACCESSION)

            self.assertEqual(raised.exception.reason, "missing_document_object")

    def test_manifest_schema_self_digest_and_declared_size_are_validated(self) -> None:
        cases = (
            ("schema", lambda payload: payload.__setitem__("schema_version", "wrong/v0"), "unsupported_schema"),
            (
                "self_digest",
                None,
                "manifest_digest_mismatch",
            ),
            (
                "declared_size",
                lambda payload: payload["documents"][0].__setitem__(
                    "bytes", payload["documents"][0]["bytes"] + 1
                ),
                "document_size_mismatch",
            ),
        )
        for name, mutation, reason in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary_root:
                cache = RawCache(Path(temporary_root))
                record = cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
                manifest_path = record.path / "manifest.json"
                if name == "self_digest":
                    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
                    payload["cik"] = "0000000002"
                    manifest_path.chmod(0o644)
                    manifest_path.write_bytes(canonical(payload) + b"\n")
                else:
                    assert mutation is not None
                    rewrite_manifest(manifest_path, mutation)

                with self.assertRaises(RawCacheError) as raised:
                    cache.load(cik=CIK, accession=ACCESSION)
                self.assertEqual(raised.exception.reason, reason)

    def test_missing_primary_or_information_table_is_blocked_on_store_and_load(self) -> None:
        for missing_role in ("primary", "information_table"):
            with self.subTest(stage="store", role=missing_role), tempfile.TemporaryDirectory() as temporary_root:
                cache = RawCache(Path(temporary_root))
                documents = [row for row in fixture_documents() if row["role"] != missing_role]
                with self.assertRaises(RawCacheError) as raised:
                    cache.store(cik=CIK, accession=ACCESSION, documents=documents)
                self.assertEqual(raised.exception.reason, "missing_required_document_role")

            with self.subTest(stage="load", role=missing_role), tempfile.TemporaryDirectory() as temporary_root:
                cache = RawCache(Path(temporary_root))
                record = cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())
                manifest_path = record.path / "manifest.json"
                rewrite_manifest(
                    manifest_path,
                    lambda payload: payload.__setitem__(
                        "documents",
                        [row for row in payload["documents"] if row["role"] != missing_role],
                    ),
                )
                with self.assertRaises(RawCacheError) as raised:
                    cache.load(cik=CIK, accession=ACCESSION)
                self.assertEqual(raised.exception.reason, "missing_required_document_role")

    def test_failed_atomic_publish_leaves_no_accession_or_temp_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            cache = RawCache(root)
            with mock.patch("cache.os.rename", side_effect=OSError("fixture crash")):
                with self.assertRaises(RawCacheError) as raised:
                    cache.store(cik=CIK, accession=ACCESSION, documents=fixture_documents())

            self.assertEqual(raised.exception.reason, "cache_write_failed")
            self.assertFalse((root / CIK / ACCESSION).exists())
            self.assertEqual(list((root / CIK).glob(f".{ACCESSION}.tmp-*")), [])


if __name__ == "__main__":
    unittest.main()
