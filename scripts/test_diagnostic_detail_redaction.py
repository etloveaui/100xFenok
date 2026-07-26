#!/usr/bin/env python3
"""Every copy of bounded_diagnostic_detail must redact the same credential shapes.

The diagnostics sweep that made producer failures readable also duplicated this
helper into three fetchers instead of sharing one, and the copies had already
drifted apart by the time they landed. All three shipped the same hole: the
label pattern required a word boundary, and `\\b` cannot fire inside
`client_secret` because `_` is a word character - so the exact credential pair
this repo uses for FINRA OAuth (FINRA_API_CLIENT_ID / FINRA_API_CLIENT_SECRET)
would have been written to CI logs verbatim on the next failure.

This test exists because the JavaScript copy was reviewed and the Python copies
were not. It holds every copy to one battery, so a fix to one that misses the
others fails here rather than in a log.

Follow-up worth doing: collapse the three copies into one shared module. Until
then, this is what keeps them honest.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

COPIES = (
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


def load(rel: str):
    path = ROOT / rel
    spec = importlib.util.spec_from_file_location(f"copy_{path.stem.replace('-', '_')}", path)
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = [str(path)]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = argv
    return module


def main() -> None:
    checked = 0
    for rel in COPIES:
        module = load(rel)
        fn = getattr(module, "bounded_diagnostic_detail", None)
        assert fn is not None, f"{rel}: bounded_diagnostic_detail is missing"
        for message in CREDENTIAL_MESSAGES:
            detail = str(fn(ValueError(message)))
            assert SECRET not in detail, f"{rel}: credential reached the detail for {message!r}"
            checked += 1
        # The detail must stay useful, not become a wall of [redacted].
        plain = str(fn(ValueError("financial statement below field floor: overview annual rows=0")))
        assert "field floor" in plain, f"{rel}: redaction destroyed an ordinary message"
        # And it must stay bounded.
        assert len(str(fn(ValueError("x" * 5000)))) <= 320, f"{rel}: detail is not bounded"
    print(f"test_diagnostic_detail_redaction: ok ({len(COPIES)} copies, {checked} credential shapes)")


if __name__ == "__main__":
    main()
