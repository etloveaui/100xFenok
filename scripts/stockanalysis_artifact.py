#!/usr/bin/env python3
"""Immutable acquire/publish boundary for StockAnalysis candidate data."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
from typing import Callable
import uuid


PROTOCOL = "stockanalysis-acquire-artifact/v1"
DEFAULT_WORKFLOW = ".github/workflows/fetch-stockanalysis.yml"
DEFAULT_LANE_MANIFEST = "data/admin/lane-commit-manifest.json"
MAX_FILE_COUNT = 20_000
MAX_TOTAL_BYTES = 750 * 1024 * 1024
PUBLIC_PREFIX = "100xfenok-next/public/"
TRAILER_NUMBER = "StockAnalysis-Run-Number:"
TRAILER_ATTEMPT = "StockAnalysis-Run-Attempt:"
TRAILER_ID = "StockAnalysis-Run-ID:"


def fail(message: str) -> None:
    raise ValueError(message)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_git(repo_root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def normalize_rel(raw: str) -> str:
    if not isinstance(raw, str) or not raw or "\\" in raw or "\x00" in raw:
        fail("artifact path is invalid")
    if any(ord(char) < 32 or ord(char) == 127 for char in raw):
        fail("artifact path contains a control character")
    path = PurePosixPath(raw)
    if path.is_absolute() or ".." in path.parts:
        fail(f"artifact path escapes repository: {raw}")
    normalized = path.as_posix()
    if normalized in ("", ".") or normalized != raw:
        fail(f"artifact path is not normalized: {raw}")
    return normalized


def external_root(repo_root: Path, requested: Path, label: str) -> Path:
    repo = repo_root.resolve(strict=True)
    if requested.is_symlink():
        fail(f"{label} must not be a symlink")
    resolved = requested.resolve(strict=requested.exists())
    if resolved == repo or repo in resolved.parents or resolved in repo.parents:
        fail(f"{label} must be outside the repository")
    return resolved


def load_policy(repo_root: Path, workflow: str, manifest_rel: str = DEFAULT_LANE_MANIFEST) -> tuple[list[dict], list[dict]]:
    manifest_path = repo_root / normalize_rel(manifest_rel)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "lane-commit-manifest/v1":
        fail("lane commit manifest schema is invalid")
    entry = (payload.get("workflows") or {}).get(workflow)
    if not isinstance(entry, dict):
        fail(f"lane commit manifest has no workflow entry: {workflow}")
    specs = ((entry.get("stages") or {}).get("always_if_exists"))
    excludes = entry.get("exclude")
    if not isinstance(specs, list) or not specs or not isinstance(excludes, list):
        fail("lane commit manifest workflow policy is invalid")
    for group in (specs, excludes):
        for spec in group:
            if not isinstance(spec, dict) or spec.get("kind") not in {"file", "directory", "glob", "dynamic_set"}:
                fail("lane commit manifest path spec is invalid")
            normalize_rel(spec.get("path"))
    return specs, excludes


def spec_matches(path: str, spec: dict) -> bool:
    value = normalize_rel(spec["path"])
    kind = spec["kind"]
    if kind == "file":
        return path == value
    if kind in {"directory", "dynamic_set"}:
        return path == value or path.startswith(value + "/")
    return fnmatch.fnmatchcase(path, value)


def validate_allowed_path(path: str, specs: list[dict], excludes: list[dict]) -> None:
    path = normalize_rel(path)
    if path.startswith(PUBLIC_PREFIX):
        fail(f"public path is forbidden in StockAnalysis artifact: {path}")
    if any(spec_matches(path, spec) for spec in excludes):
        fail(f"excluded path is forbidden in StockAnalysis artifact: {path}")
    if not any(spec_matches(path, spec) for spec in specs):
        fail(f"path is outside StockAnalysis lane ownership: {path}")


def assert_regular_tree(root: Path) -> list[Path]:
    if root.is_symlink():
        fail(f"tree root must not be a symlink: {root}")
    files: list[Path] = []
    if not root.exists():
        return files
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        directory = Path(dirpath)
        if not stat.S_ISDIR(directory.lstat().st_mode):
            fail(f"tree entry is not a directory: {directory}")
        for name in list(dirnames):
            child = directory / name
            child_stat = child.lstat()
            if stat.S_ISLNK(child_stat.st_mode):
                fail(f"symlink is forbidden in artifact tree: {child}")
            if not stat.S_ISDIR(child_stat.st_mode):
                fail(f"tree entry is not a regular directory: {child}")
        for name in filenames:
            child = directory / name
            child_stat = child.lstat()
            if stat.S_ISLNK(child_stat.st_mode):
                fail(f"symlink is forbidden in artifact tree: {child}")
            if not stat.S_ISREG(child_stat.st_mode):
                fail(f"tree entry is not a regular file: {child}")
            if child_stat.st_nlink != 1:
                fail(f"hardlinked file is forbidden in artifact tree: {child}")
            files.append(child)
    return sorted(files)


def copy_source(source: Path, target: Path) -> None:
    source_stat = source.lstat()
    if stat.S_ISLNK(source_stat.st_mode):
        fail(f"source symlink is forbidden: {source}")
    if stat.S_ISREG(source_stat.st_mode):
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        return
    if not stat.S_ISDIR(source_stat.st_mode):
        fail(f"source entry is not regular: {source}")
    for item in assert_regular_tree(source):
        rel = item.relative_to(source)
        destination = target / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, destination)


def seed_candidate(
    repo_root: Path,
    candidate_root: Path,
    workflow: str = DEFAULT_WORKFLOW,
    *,
    replace: bool = False,
) -> Path:
    repo = repo_root.resolve(strict=True)
    candidate = external_root(repo, candidate_root, "candidate root")
    if candidate.exists():
        if replace:
            shutil.rmtree(candidate)
        elif any(candidate.iterdir()):
            fail("candidate root must be empty")
    candidate.mkdir(parents=True, exist_ok=True)
    specs, _ = load_policy(repo, workflow)
    copied: set[str] = set()
    for spec in specs:
        path_value = normalize_rel(spec["path"])
        matches = sorted(repo.glob(path_value)) if spec["kind"] == "glob" else [repo / path_value]
        for source in matches:
            if not source.exists():
                continue
            rel = source.relative_to(repo).as_posix()
            if rel in copied:
                continue
            copy_source(source, candidate / rel)
            copied.add(rel)
    assert_regular_tree(candidate)
    return candidate


def candidate_files(candidate: Path) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for path in assert_regular_tree(candidate):
        rel = normalize_rel(path.relative_to(candidate).as_posix())
        if rel in out:
            fail(f"duplicate normalized candidate path: {rel}")
        out[rel] = path
    return out


def repository_owned_files(repo: Path, specs: list[dict], excludes: list[dict]) -> set[str]:
    paths: set[str] = set()
    for spec in specs:
        value = normalize_rel(spec["path"])
        source = repo / value
        matches = sorted(repo.glob(value)) if spec["kind"] == "glob" else [source]
        for match in matches:
            if not match.exists():
                continue
            if match.is_symlink():
                fail(f"repository source symlink is forbidden: {match}")
            leaves = [match] if match.is_file() else assert_regular_tree(match)
            for leaf in leaves:
                rel = normalize_rel(leaf.relative_to(repo).as_posix())
                if any(spec_matches(rel, excluded) for excluded in excludes):
                    continue
                paths.add(rel)
    return paths


def pack_artifact(
    *,
    repo_root: Path,
    candidate_root: Path,
    artifact_root: Path,
    workflow: str,
    base_sha: str,
    run_id: str,
    run_number: int,
    run_attempt: int,
    artifact_name: str,
) -> dict:
    repo = repo_root.resolve(strict=True)
    candidate = external_root(repo, candidate_root, "candidate root")
    artifact = external_root(repo, artifact_root, "artifact root")
    if not re.fullmatch(r"[0-9a-f]{40}", str(base_sha)):
        fail("artifact base SHA is invalid")
    if run_git(repo, "rev-parse", "HEAD").stdout.strip() != str(base_sha):
        fail("artifact base SHA does not match acquisition checkout HEAD")
    if int(run_number) < 1 or int(run_attempt) < 1 or not str(run_id) or not str(artifact_name):
        fail("artifact run identity is invalid")
    specs, excludes = load_policy(repo, workflow)
    all_leaves = candidate_files(candidate)
    leaves: dict[str, Path] = {}
    for rel, path in all_leaves.items():
        if any(spec_matches(rel, excluded) for excluded in excludes):
            source = repo / rel
            if not source.is_file() or sha256_file(source) != sha256_file(path):
                fail(f"excluded path is forbidden in StockAnalysis artifact: {rel}")
            continue
        validate_allowed_path(rel, specs, excludes)
        leaves[rel] = path
    missing = repository_owned_files(repo, specs, excludes) - set(leaves)
    if missing:
        fail(f"candidate deletion is forbidden: {sorted(missing)[0]}")
    changed: list[tuple[str, Path, int, str]] = []
    total = 0
    for rel, path in sorted(leaves.items()):
        source = repo / rel
        digest = sha256_file(path)
        if source.is_file() and sha256_file(source) == digest:
            continue
        size = path.stat().st_size
        total += size
        changed.append((rel, path, size, digest))
    if len(changed) > MAX_FILE_COUNT or total > MAX_TOTAL_BYTES:
        fail("artifact file count or total size exceeds the safety limit")
    if artifact.exists():
        fail("artifact root must not already exist")
    files_root = artifact / "files"
    files_root.mkdir(parents=True)
    file_rows = []
    for rel, source, size, digest in changed:
        target = files_root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        file_rows.append({"path": rel, "sha256": digest, "size": size})
    manifest = {
        "protocol": PROTOCOL,
        "workflow": workflow,
        "base_sha": str(base_sha),
        "run_id": str(run_id),
        "run_number": int(run_number),
        "run_attempt": int(run_attempt),
        "artifact_name": str(artifact_name),
        "file_count": len(file_rows),
        "total_bytes": total,
        "paths": [row["path"] for row in file_rows],
        "files": file_rows,
    }
    (artifact / "manifest.json").write_text(canonical_json(manifest) + "\n", encoding="utf-8")
    assert_regular_tree(artifact)
    return manifest


def load_and_validate_artifact(
    *,
    repo_root: Path,
    artifact_root: Path,
    workflow: str,
    run_id: str,
    run_number: int,
    run_attempt: int,
    artifact_name: str,
) -> dict:
    repo = repo_root.resolve(strict=True)
    artifact = external_root(repo, artifact_root, "artifact root")
    files = assert_regular_tree(artifact)
    manifest_path = artifact / "manifest.json"
    if manifest_path not in files:
        fail("artifact manifest is missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_keys = {
        "protocol", "workflow", "base_sha", "run_id", "run_number", "run_attempt",
        "artifact_name", "file_count", "total_bytes", "paths", "files",
    }
    if not isinstance(manifest, dict) or set(manifest) != expected_keys:
        fail("artifact manifest shape is invalid")
    expected_context = {
        "protocol": PROTOCOL,
        "workflow": workflow,
        "run_id": str(run_id),
        "run_number": int(run_number),
        "run_attempt": int(run_attempt),
        "artifact_name": str(artifact_name),
    }
    for key, value in expected_context.items():
        if manifest.get(key) != value:
            fail(f"artifact {key} does not match publish context")
    if not re.fullmatch(r"[0-9a-f]{40}", str(manifest.get("base_sha"))):
        fail("artifact base SHA is invalid")
    rows = manifest.get("files")
    paths = manifest.get("paths")
    if not isinstance(rows, list) or not isinstance(paths, list):
        fail("artifact file list is invalid")
    normalized: list[str] = []
    total = 0
    specs, excludes = load_policy(repo, workflow)
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "sha256", "size"}:
            fail("artifact file row is invalid")
        rel = normalize_rel(row["path"])
        if rel in normalized:
            fail(f"duplicate normalized artifact path: {rel}")
        normalized.append(rel)
        validate_allowed_path(rel, specs, excludes)
        source = artifact / "files" / rel
        if not source.is_file() or source.is_symlink():
            fail(f"artifact payload is missing or not regular: {rel}")
        size = source.stat().st_size
        if size != row["size"] or sha256_file(source) != row["sha256"]:
            fail(f"artifact hash or size mismatch: {rel}")
        total += size
    if paths != normalized:
        fail("artifact paths do not exactly match file rows")
    if manifest["file_count"] != len(rows) or manifest["total_bytes"] != total:
        fail("artifact count or total size mismatch")
    if len(rows) > MAX_FILE_COUNT or total > MAX_TOTAL_BYTES:
        fail("artifact file count or total size exceeds the safety limit")
    expected_tree = {manifest_path, *(artifact / "files" / rel for rel in normalized)}
    if set(files) != expected_tree:
        fail("artifact contains an undeclared file")
    return manifest


def assert_clean_targets(repo: Path, paths: list[str]) -> None:
    for rel in paths:
        target = repo / rel
        cursor = target.parent
        while cursor != repo:
            if cursor.is_symlink():
                fail(f"target ancestor symlink is forbidden: {cursor}")
            cursor = cursor.parent
        if target.exists() or target.is_symlink():
            target_stat = target.lstat()
            if stat.S_ISLNK(target_stat.st_mode):
                fail(f"target symlink is forbidden: {rel}")
            if not stat.S_ISREG(target_stat.st_mode):
                fail(f"target is not a regular file: {rel}")
            if target_stat.st_nlink != 1:
                fail(f"hardlinked target is forbidden: {rel}")
    status_output = run_git(repo, "status", "--porcelain=v1", "--", *paths).stdout
    if status_output.strip():
        fail("publish checkout has pre-existing candidate-path changes")


def newer_publish_since_base(repo: Path, base_sha: str, current: tuple[int, int]) -> tuple[int, int, str] | None:
    messages = run_git(repo, "log", "--format=%B%x00", f"{base_sha}..HEAD").stdout.split("\x00")
    newer = None
    for message in messages:
        fields: dict[str, str] = {}
        for line in message.splitlines():
            for label, key in ((TRAILER_NUMBER, "number"), (TRAILER_ATTEMPT, "attempt"), (TRAILER_ID, "id")):
                if line.startswith(label):
                    fields[key] = line[len(label):].strip()
        try:
            candidate = (int(fields["number"]), int(fields["attempt"]), fields.get("id", ""))
        except (KeyError, ValueError):
            continue
        if candidate[:2] > current and (newer is None or candidate[:2] > newer[:2]):
            newer = candidate
    return newer


def stale_reason(repo: Path, manifest: dict) -> str | None:
    base = manifest["base_sha"]
    if run_git(repo, "cat-file", "-e", f"{base}^{{commit}}", check=False).returncode != 0:
        fail("artifact base commit is unavailable")
    if run_git(repo, "merge-base", "--is-ancestor", base, "HEAD", check=False).returncode != 0:
        fail("artifact base is not an ancestor of current main")
    newer = newer_publish_since_base(repo, base, (manifest["run_number"], manifest["run_attempt"]))
    if newer is not None:
        return f"newer accepted publish {newer[0]}/{newer[1]} ({newer[2]}) exists since base"
    touched = []
    for rel in manifest["paths"]:
        result = run_git(repo, "rev-list", "--max-count=1", f"{base}..HEAD", "--", rel)
        if result.stdout.strip():
            touched.append(rel)
    if touched:
        return "candidate path touched since acquisition base: " + ", ".join(touched)
    return None


def apply_artifact(
    *,
    repo_root: Path,
    artifact_root: Path,
    workflow: str,
    run_id: str,
    run_number: int,
    run_attempt: int,
    artifact_name: str,
    artifact_digest: str,
    replace_fn: Callable[[str | os.PathLike, str | os.PathLike], None] = os.replace,
) -> dict:
    repo = repo_root.resolve(strict=True)
    if not re.fullmatch(r"[0-9a-f]{64}", str(artifact_digest)):
        fail("GitHub artifact digest is invalid")
    manifest = load_and_validate_artifact(
        repo_root=repo,
        artifact_root=artifact_root,
        workflow=workflow,
        run_id=run_id,
        run_number=run_number,
        run_attempt=run_attempt,
        artifact_name=artifact_name,
    )
    assert_clean_targets(repo, manifest["paths"])
    reason = stale_reason(repo, manifest)
    if reason:
        return {"status": "stale", "reason": reason, "paths": manifest["paths"]}
    artifact = Path(artifact_root).resolve(strict=True)
    backups: dict[str, tuple[bytes, int] | None] = {}
    temp_paths: list[Path] = []
    try:
        for rel in manifest["paths"]:
            target = repo / rel
            backups[rel] = (target.read_bytes(), stat.S_IMODE(target.stat().st_mode)) if target.exists() else None
            target.parent.mkdir(parents=True, exist_ok=True)
            temp_path = target.parent / f".{target.name}.stockanalysis-{uuid.uuid4().hex}.tmp"
            shutil.copyfile(artifact / "files" / rel, temp_path)
            os.chmod(temp_path, 0o644)
            temp_paths.append(temp_path)
            replace_fn(temp_path, target)
        return {
            "status": "applied",
            "reason": None,
            "paths": manifest["paths"],
            "artifact_digest": artifact_digest,
        }
    except Exception:
        for rel, backup in backups.items():
            target = repo / rel
            if backup is None:
                target.unlink(missing_ok=True)
                continue
            data, mode = backup
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, raw_path = tempfile.mkstemp(prefix=f".{target.name}.rollback-", dir=target.parent)
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.chmod(raw_path, mode)
            os.replace(raw_path, target)
        raise
    finally:
        for temp_path in temp_paths:
            temp_path.unlink(missing_ok=True)


def audit_staged_paths(repo_root: Path, artifact_root: Path) -> None:
    manifest = json.loads((Path(artifact_root) / "manifest.json").read_text(encoding="utf-8"))
    expected = manifest.get("paths")
    rows = manifest.get("files")
    if not isinstance(expected, list) or not isinstance(rows, list):
        fail("artifact paths or files are invalid for stage audit")
    expected_rows: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "sha256", "size"}:
            fail("artifact file row is invalid for stage audit")
        rel = normalize_rel(row["path"])
        if rel in expected_rows:
            fail(f"duplicate artifact path in stage audit: {rel}")
        if not re.fullmatch(r"[0-9a-f]{64}", str(row["sha256"])):
            fail(f"artifact SHA-256 is invalid for stage audit: {rel}")
        if not isinstance(row["size"], int) or row["size"] < 0:
            fail(f"artifact size is invalid for stage audit: {rel}")
        expected_rows[rel] = row
    if expected != list(expected_rows):
        fail("artifact paths do not exactly match file rows for stage audit")
    output = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only", "-z"],
        cwd=repo_root,
    )
    actual = sorted(item.decode("utf-8") for item in output.split(b"\x00") if item)
    if actual != sorted(expected):
        fail(f"staged paths do not exactly match artifact: expected={sorted(expected)} actual={actual}")
    for rel, row in expected_rows.items():
        stage = subprocess.run(
            ["git", "ls-files", "--stage", "-z", "--", rel],
            cwd=repo_root,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ).stdout
        prefix, separator, indexed_path = stage.partition(b"\t")
        fields = prefix.split()
        if not separator or indexed_path.rstrip(b"\x00").decode("utf-8") != rel:
            fail(f"staged index entry is missing or ambiguous: {rel}")
        if len(fields) != 3 or fields[0] != b"100644" or fields[2] != b"0":
            fail(f"staged index entry is not a regular stage-0 file: {rel}")
        blob = subprocess.run(
            ["git", "show", f":{rel}"],
            cwd=repo_root,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ).stdout
        digest = hashlib.sha256(blob).hexdigest()
        if len(blob) != row["size"] or digest != row["sha256"]:
            fail(
                f"staged blob does not exactly match artifact bytes: {rel} "
                f"expected_size={row['size']} actual_size={len(blob)} "
                f"expected_sha256={row['sha256']} actual_sha256={digest}"
            )


def write_outputs(path: str | None, result: dict) -> None:
    if not path:
        return
    with Path(path).open("a", encoding="utf-8") as handle:
        for key in ("status", "reason"):
            handle.write(f"{key}={str(result.get(key) or '')}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    seed = subparsers.add_parser("seed")
    pack = subparsers.add_parser("pack")
    apply = subparsers.add_parser("apply")
    audit = subparsers.add_parser("audit-stage")
    for item in (seed, pack, apply, audit):
        item.add_argument("--repo-root", default=".")
        item.add_argument("--workflow", default=DEFAULT_WORKFLOW)
    seed.add_argument("--candidate-root", required=True)
    seed.add_argument("--replace", action="store_true")
    pack.add_argument("--candidate-root", required=True)
    pack.add_argument("--artifact-root", required=True)
    pack.add_argument("--base-sha", required=True)
    for item in (pack, apply):
        item.add_argument("--run-id", required=True)
        item.add_argument("--run-number", required=True, type=int)
        item.add_argument("--run-attempt", required=True, type=int)
        item.add_argument("--artifact-name", required=True)
    apply.add_argument("--artifact-root", required=True)
    apply.add_argument("--artifact-digest", required=True)
    apply.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"))
    audit.add_argument("--artifact-root", required=True)
    args = parser.parse_args()
    repo = Path(args.repo_root)
    if args.command == "seed":
        result = {"candidate_root": str(seed_candidate(repo, Path(args.candidate_root), args.workflow, replace=args.replace))}
    elif args.command == "pack":
        result = pack_artifact(
            repo_root=repo,
            candidate_root=Path(args.candidate_root),
            artifact_root=Path(args.artifact_root),
            workflow=args.workflow,
            base_sha=args.base_sha,
            run_id=args.run_id,
            run_number=args.run_number,
            run_attempt=args.run_attempt,
            artifact_name=args.artifact_name,
        )
    elif args.command == "apply":
        result = apply_artifact(
            repo_root=repo,
            artifact_root=Path(args.artifact_root),
            workflow=args.workflow,
            run_id=args.run_id,
            run_number=args.run_number,
            run_attempt=args.run_attempt,
            artifact_name=args.artifact_name,
            artifact_digest=args.artifact_digest,
        )
        write_outputs(args.github_output, result)
    else:
        audit_staged_paths(repo, Path(args.artifact_root))
        result = {"status": "ok"}
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
