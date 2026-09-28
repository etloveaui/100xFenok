#!/usr/bin/env bash
set -euo pipefail
bash scripts/load-guard.sh --assert-nested
python3 ../scripts/test_build_earnings_overview.py
python3 ../scripts/build-earnings-overview.py --refresh --output-dir ../data/earnings-overview
npx tsx scripts/check-earnings-documents.ts
