#!/usr/bin/env python3
"""Freeze a detached 73-file oracle from the pinned CCH generator.

This is a manual fixture-maintenance utility.  Normal tests consume the frozen
oracle and never import or execute sibling-repository code.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import types
import xml.etree.ElementTree as stdlib_element_tree


ROOT = Path(__file__).resolve().parents[2]
EXPECTED_OUTPUT_COUNT = 73
FORBIDDEN_OUTPUTS = (
    ROOT / "data" / "sec-13f",
    ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
)


class OracleFreezeError(RuntimeError):
    """The pinned oracle cannot be regenerated safely or completely."""


def _canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _load_object(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise OracleFreezeError(f"expected JSON object: {path}")
    return value


def _validate_source(cch_root: Path, source_manifest: dict) -> None:
    declared = source_manifest.get("content_digest")
    unsigned = {key: value for key, value in source_manifest.items() if key != "content_digest"}
    if declared != _digest(_canonical(unsigned)):
        raise OracleFreezeError("CCH source manifest content digest mismatch")
    entries = source_manifest.get("entries")
    if not isinstance(entries, list) or source_manifest.get("snapshot_digest") != _digest(_canonical(entries)):
        raise OracleFreezeError("CCH source manifest snapshot digest mismatch")
    for entry in entries:
        source = cch_root / entry["path"]
        if cch_root not in source.resolve().parents:
            raise OracleFreezeError(f"pinned CCH source escapes root: {entry['path']}")
        if not source.is_file():
            raise OracleFreezeError(f"pinned CCH source is missing: {entry['path']}")
        if source.stat().st_size != entry["bytes"] or _digest(source.read_bytes()) != entry["sha256"]:
            raise OracleFreezeError(f"pinned CCH source drifted: {entry['path']}")


def _load_cch_generator(cch_root: Path):
    sys.dont_write_bytecode = True
    for name in ("generator", "metrics", "analyzer", "parser"):
        sys.modules.pop(name, None)
    if "defusedxml" not in sys.modules:
        shim = types.ModuleType("defusedxml")
        shim.ElementTree = stdlib_element_tree
        sys.modules["defusedxml"] = shim
    sys.path.insert(0, str(cch_root))
    spec = importlib.util.spec_from_file_location("pinned_cch_sec13f_generator", cch_root / "generator.py")
    if spec is None or spec.loader is None:
        raise OracleFreezeError("cannot load pinned CCH generator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _freeze_generated_at(module, generated_at: str) -> None:
    class FrozenDateTime:
        @classmethod
        def now(cls):
            return cls()

        def isoformat(self) -> str:
            return generated_at

    module.datetime = FrozenDateTime


def _assert_safe_output(output_root: Path, cch_root: Path) -> None:
    resolved = output_root.resolve()
    forbidden = [path.resolve() for path in FORBIDDEN_OUTPUTS]
    forbidden.append(cch_root.resolve())
    if any(
        resolved == path or path in resolved.parents or resolved in path.parents
        for path in forbidden
    ):
        raise OracleFreezeError(f"refusing protected output root: {resolved}")


def _assert_safe_manifest(manifest_path: Path, cch_root: Path) -> None:
    resolved = manifest_path.resolve()
    forbidden = [path.resolve() for path in FORBIDDEN_OUTPUTS]
    forbidden.append(cch_root.resolve())
    if any(
        resolved == path or path in resolved.parents or resolved in path.parents
        for path in forbidden
    ):
        raise OracleFreezeError(f"refusing protected manifest path: {resolved}")


def _apply_frozen_set_order_semantics(output_root: Path) -> None:
    path = output_root / "by_sector.json"
    payload = _load_object(path)
    for sector in payload.values():
        if isinstance(sector, dict) and isinstance(sector.get("investors"), list):
            sector["investors"].sort()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def freeze(*, cch_root: Path, input_path: Path, output_root: Path, manifest_path: Path) -> dict:
    source_manifest_path = ROOT / "tests" / "sec13f" / "fixtures" / "cch_source_manifest.json"
    source_manifest = _load_object(source_manifest_path)
    fixture_input = _load_object(input_path)
    if fixture_input.get("content_digest") != _digest(
        _canonical({key: value for key, value in fixture_input.items() if key != "content_digest"})
    ):
        raise OracleFreezeError("fixture input content digest mismatch")
    if fixture_input.get("registry_sha256") != source_manifest.get("source_registry_sha256"):
        raise OracleFreezeError("fixture/CCH registry digest mismatch")

    cch_root = cch_root.resolve()
    output_root = output_root.resolve()
    manifest_path = manifest_path.resolve()
    _assert_safe_output(output_root, cch_root)
    _assert_safe_manifest(manifest_path, cch_root)
    if output_root == manifest_path or output_root in manifest_path.parents:
        raise OracleFreezeError("manifest path must stay outside the 73-file oracle root")
    _validate_source(cch_root, source_manifest)
    if output_root.exists():
        if not output_root.is_dir():
            raise OracleFreezeError("output root exists and is not a directory")
        if any(output_root.iterdir()):
            raise OracleFreezeError("output root must be empty")
    else:
        output_root.mkdir(parents=True)

    cch_generator = _load_cch_generator(cch_root)
    generated_at = fixture_input.get("generated_at")
    if not isinstance(generated_at, str) or not generated_at:
        raise OracleFreezeError("fixture input requires a fixed generated_at")
    _freeze_generated_at(cch_generator, generated_at)
    cch_generator.JSONGenerator(output_dir=output_root, total_investors=60).generate_all(
        investors_data=fixture_input["investors_data"],
        quarters_covered=fixture_input["quarters_covered"],
        summary_metadata_extra=fixture_input.get("summary_metadata_extra"),
    )
    _apply_frozen_set_order_semantics(output_root)

    paths = sorted(path for path in output_root.rglob("*.json") if path.is_file())
    if len(paths) != EXPECTED_OUTPUT_COUNT:
        raise OracleFreezeError(f"oracle output count {len(paths)} != {EXPECTED_OUTPUT_COUNT}")
    entries = [
        {
            "path": path.relative_to(output_root).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": _digest(path.read_bytes()),
        }
        for path in paths
    ]
    manifest = {
        "schema_version": "sec13f-cch-fixture-oracle/v1",
        "source_repository": source_manifest["source_repository"],
        "source_path": source_manifest["source_path"],
        "source_commit": source_manifest["subtree_last_change_commit"],
        "cch_snapshot_digest": source_manifest["snapshot_digest"],
        "registry_digest": fixture_input["registry_sha256"],
        "fixture_input_digest": fixture_input["content_digest"],
        "output_count": len(entries),
        "entries": entries,
        "entries_digest": _digest(_canonical(entries)),
    }
    manifest["content_digest"] = _digest(_canonical(manifest))
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cch-root", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    freeze(cch_root=args.cch_root, input_path=args.input, output_root=args.output, manifest_path=args.manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
