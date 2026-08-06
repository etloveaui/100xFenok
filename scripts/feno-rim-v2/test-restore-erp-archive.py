#!/usr/bin/env python3
# FENO RIM v2 — ERP archive restoration contract tests.
#
# Pins, on the COMMITTED raw bytes (no network):
# 1. the uniform first-knowable date rule, including both rejection cases
#    (ctryprem22 stale 2018-12-31, ctryprem24 stale 2020-12-31) and the
#    genuine mid-year internal date (ctryprem15 2016-07-01);
# 2. the US/Korea composite-ERP column choice per era;
# 3. reproducibility: re-parsing the raw archive reproduces the observations
#    and the artifact hash (generated_at excluded).

import os
import sys
import importlib.util
import json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location(
    "restore_erp_archive", os.path.join(os.path.dirname(os.path.abspath(__file__)), "restore-erp-archive.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def obs_by_file(artifact):
    return {o["file"]: o for o in artifact["observations"] if "error" not in o}


# --- 1. date rule ------------------------------------------------------------

a1 = r.build_artifact()
by_file = obs_by_file(a1)

assert len(a1["observations"]) == 25, "all 25 fetched files parse"
assert a1["observations_failed"] == [], f"no parse failures: {a1['observations_failed']}"

# page_label base: no internal date -> {YY+1}-01-31
assert by_file["ctryprem00.xls"]["first_knowable"] == "2001-01-31"
assert by_file["ctryprem00.xls"]["date_source"] == "page_label"
assert by_file["ctryprem12.xls"]["first_knowable"] == "2013-01-31"

# internal date LATER than the base wins (genuine mid-year edition)
assert by_file["ctryprem15.xls"]["first_knowable"] == "2016-07-01"
assert by_file["ctryprem15.xls"]["date_source"] == "internal_date_later"

# internal date EARLIER than the base: base wins, rejected value recorded
assert by_file["ctryprem13.xls"]["first_knowable"] == "2014-01-31"
assert by_file["ctryprem13.xls"]["date_source"] == "page_label_internal_rejected"
assert by_file["ctryprem13.xls"]["rejected_internal_date"] == "2014-01-01"

# the two stale-cell rejection cases named in the ruling
assert by_file["ctryprem22.xls"]["first_knowable"] == "2023-01-31"
assert by_file["ctryprem22.xls"]["rejected_internal_date"] == "2018-12-31"
assert by_file["ctryprem24.xls"]["first_knowable"] == "2025-01-31"
assert by_file["ctryprem24.xls"]["rejected_internal_date"] == "2020-12-31"
assert by_file["ctryprem24.xls"]["date_source"] == "page_label_internal_rejected"

# no observation may carry month_unknown — the archive page supplies the month
for o in a1["observations"]:
    if "error" not in o:
        assert "month_unknown" not in o["date_source"], o["file"]
        assert o["date_source"] in ("page_label", "internal_date_later", "page_label_internal_rejected"), o["file"]

# --- 2. column choice (composite ERP, never additive) ------------------------

# era A (7-col, no region): col 3; era B (8-col with region): col 4; 12+ (Total
# Equity Risk Premium header): col 4
assert by_file["ctryprem00.xls"]["erp_column"] == 3
assert by_file["ctryprem00.xls"]["us_erp"] == 0.0551
assert by_file["ctryprem00.xls"]["kr_erp"] == 0.0681
assert by_file["ctryprem08.xls"]["erp_column"] == 4
assert by_file["ctryprem12.xls"]["erp_column"] == 4
assert by_file["ctryprem24.xls"]["erp_column"] == 4
assert by_file["ctryprem24.xls"]["us_erp"] == 0.0433
assert by_file["ctryprem24.xls"]["kr_erp"] == 0.049888
for o in a1["observations"]:
    if "error" not in o:
        assert 0.01 < o["us_erp"] < 0.35 and 0.01 < o["kr_erp"] < 0.35, o["file"]
        assert o["kr_erp"] > o["us_erp"], f"{o['file']}: KR>US expected"

# --- 3. reproducibility ------------------------------------------------------

a2 = r.build_artifact()
assert obs_by_file(a2) == by_file, "re-parse from committed raw bytes must reproduce the observations"
assert a1["artifact_sha256"] == a2["artifact_sha256"], "artifact hash must be stable (generated_at excluded)"
assert a1["band_us_52w_at_evaluation"]["distinct_official_releases"] == 1
assert a1["band_us_52w_at_evaluation"]["point"] is True

print("feno-rim-v2 erp-archive-restoration tests passed")
