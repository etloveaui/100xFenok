#!/usr/bin/env python3
"""Shared diagnostic redaction contract and anti-duplication guard."""

from __future__ import annotations

import ast
import importlib
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = ROOT / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

SHARED_MODULE = "lib.diagnostic_detail"
FETCHERS = (
    "scripts/fetch-fenok-private-options.py",
    "scripts/fetch-yf-finance-v0.py",
    "scripts/fetch-yf-finance.py",
)

SECRET = "sk_live_A1b2C3d4E5f6G7h8I9j0"

# Decorated labels first: those are the ones the bare-word pattern missed.
CREDENTIAL_MESSAGES = (
    f"rejected client_secret={SECRET}",
    f"rejected CLIENT_SECRET={SECRET}",
    f"rejected client-secret={SECRET}",
    f"rejected x_api_key={SECRET}",
    f"rejected refresh_token={SECRET}",
    f"rejected app_password={SECRET}",
    f"rejected key={SECRET}",
    f"rejected api_key={SECRET}",
    f"401 Authorization: Bearer {SECRET}",
    f"fetch failed https://api.example.com/v1/series?api_key={SECRET}",
    f"connect https://user:{SECRET}@api.example.com/v1",
    f'decode failed body: {{"token":"{SECRET}"}}',
)


def load_fetcher(rel: str):
    path = ROOT / rel
    spec = importlib.util.spec_from_file_location(f"fetcher_{path.stem.replace('-', '_')}", path)
    assert spec is not None and spec.loader is not None, f"{rel}: cannot build import spec"
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = [str(path)]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = argv
    return module


def main() -> None:
    try:
        shared = importlib.import_module(SHARED_MODULE)
    except ModuleNotFoundError as exc:
        raise AssertionError("shared diagnostic module is missing: scripts/lib/diagnostic_detail.py") from exc
    fn = getattr(shared, "bounded_diagnostic_detail", None)
    assert fn is not None, "shared module does not export bounded_diagnostic_detail"
    assert fn(None) == "unknown error", "shared helper changed the existing None diagnostic contract"

    checked = 0
    for message in CREDENTIAL_MESSAGES:
        detail = str(fn(ValueError(message)))
        assert SECRET not in detail, f"shared helper leaked a credential for {message!r}"
        checked += 1
    plain = str(fn(ValueError("financial statement below field floor: overview annual rows=0")))
    assert "field floor" in plain, "redaction destroyed an ordinary message"
    normalized = str(fn(ValueError("first\u0000second\nthird\tfourth")))
    assert normalized == "ValueError: first second third fourth", "control/whitespace normalization drifted"
    syntax = str(fn(SyntaxError('Unexpected token; "secret-provider-body" is not valid JSON')))
    assert "secret-provider-body" not in syntax, "SyntaxError quoted provider text leaked"
    assert len(str(fn(ValueError("x" * 5000)))) == 320, "shared detail is not bounded at 320"

    for rel in FETCHERS:
        path = ROOT / rel
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        definitions = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "bounded_diagnostic_detail"
        ]
        assert not definitions, (
            f"{rel}: re-defines bounded_diagnostic_detail at lines {definitions}; "
            "import the shared helper instead"
        )
        imports_shared = any(
            isinstance(node, ast.ImportFrom)
            and node.module == SHARED_MODULE
            and any(alias.name == "bounded_diagnostic_detail" for alias in node.names)
            for node in ast.walk(tree)
        )
        assert imports_shared, f"{rel}: does not import bounded_diagnostic_detail from {SHARED_MODULE}"
        module = load_fetcher(rel)
        assert getattr(module, "bounded_diagnostic_detail", None) is fn, (
            f"{rel}: callsite is not bound to the shared helper object"
        )

    print(
        "test_diagnostic_detail_redaction: ok "
        f"(1 shared module, {len(FETCHERS)} import-only callsites, {checked} credential shapes)"
    )


if __name__ == "__main__":
    main()
