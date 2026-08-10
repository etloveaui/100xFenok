#!/usr/bin/env python3
"""
Focused tests for ERP source-date canonicalization (run 31404207078 defect).

Damodaran republishes the country ERP workbook as ctryprem<Mon><YY>.xlsx, and
resolve_erp_url() returns the raw filename token (e.g. "Apr26") as the source
month. The downstream owner guard accepts provider dates only, so erp_parser
canonicalizes the token to "April 1, 2026" before emitting metadata.source_date.

Runs standalone (no pytest dependency):
    python3 scripts/lib/damodaran_shadow_converter/test_erp_source_date.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from parsers.erp_parser import canonicalize_source_date  # noqa: E402


def expect_ok(token, expected):
    actual = canonicalize_source_date(token)
    assert actual == expected, f"{token!r}: expected {expected!r}, got {actual!r}"


def expect_reject(token):
    try:
        canonicalize_source_date(token)
    except ValueError:
        return
    raise AssertionError(f"{token!r}: expected ValueError, but was accepted")


# Regression: the exact token that blocked run 31404207078.
expect_ok("Apr26", "April 1, 2026")

# Every three-letter English month token, case-insensitive.
expect_ok("Jan26", "January 1, 2026")
expect_ok("Feb26", "February 1, 2026")
expect_ok("Mar26", "March 1, 2026")
expect_ok("Apr26", "April 1, 2026")
expect_ok("May26", "May 1, 2026")
expect_ok("Jun26", "June 1, 2026")
expect_ok("Jul26", "July 1, 2026")
expect_ok("Aug26", "August 1, 2026")
expect_ok("Sep26", "September 1, 2026")
expect_ok("Oct26", "October 1, 2026")
expect_ok("Nov26", "November 1, 2026")
expect_ok("Dec26", "December 1, 2026")
expect_ok("AUG26", "August 1, 2026")
expect_ok("sep26", "September 1, 2026")

# Two-digit year boundaries map deterministically to 20YY.
expect_ok("Apr00", "April 1, 2000")
expect_ok("Dec99", "December 1, 2099")

# Malformed tokens are rejected, never converted into an invented date.
for token in (
    "",
    "Apr",
    "Apri26",
    "Apr261",
    "Apr 26",
    "april26",
    "Xxx26",
    "Apr2a",
    "Apr2",
    "Apr0",
    "Apr-6",
    "26Apr",
    "Apr2026",
    " Apri",
    None,
    26,
    4.26,
    b"Apr26",
):
    expect_reject(token)

print("test_erp_source_date.py: all canonicalization tests passed")
