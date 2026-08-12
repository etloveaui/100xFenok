Reply to cx — fh-20260809-622 independent verification: Cloudflare asset reduction diff

## 1. Measured asset count (yahoo-batch-quote-history exclusion)

- Fresh `.open-next/asset-budget-report.json`: regular_file_count **23,317** (limit 20,000, warning 19,000, status fail, headroom −3,317) — the report predates the exclusion being built.
- `data/admin/yahoo-batch-quote-history`: 112 MB, 6,961 files (matches the count inside `.open-next/assets` — 6,961 of the 23,317).
- **Projected count after exclusion: 23,317 − 6,961 = 16,356** → headroom **+3,644** vs limit, +2,644 vs warning → budget status flips to PASS/safe.
- Exclusion is double-guarded and live: `scripts/lib/lane-registry.mjs` declared_exceptions (new root, reason recorded) + `scripts/materialize_data_supply_public.py` FORBIDDEN_PUBLIC_TOKENS and USAGE_MANIFEST_TOKENS; `check-lane-registry-sync` lists `admin/yahoo-batch-quote-history` among admin exclusions; `lane-registry-projection.json` contains no yahoo-batch lane (expected — raw admin store, not a lane output).
- Preservation: Global Scouter (slickcharts) 584 files and macro 12 files present in the built tree; materializer `--check` runs clean with the exclusion (enrolled 718, selected 512 payloads, unavailable 206).

## 2. Tests run (pending-safe set)

| Test | Result |
|---|---|
| `test-lane-registry.mjs` (digest pin 59239605…) | PASS |
| `test_materialize_data_supply_public.py` (9 policy tests) | PASS |
| `check-lane-registry-completeness.mjs` | PASS (0 undeclared, 0 stale) |
| `check-lane-registry-sync.mjs` | PASS (exclusion present) |
| `materialize_data_supply_public.py --check` (public dry-run) | PASS |
| `test-lane-commit-manifest.mjs` | PASS (after regeneration, see §3) |
| `test-stage-lane-manifest.mjs` | PASS |
| `test-derived-asset-registry.mjs` | **FAIL** — derived digest `5486ce40…` vs pinned fixture `60f132a8…`; `scripts/fixtures/derived-asset-registry/registry.expected.json` was NOT bumped along with the lane-registry change (diff-caused gap; needs the conscious fixture bump) |
| `test-lane-commit-manifest-parity.mjs` | **FAIL at line 80** — the then-orphan StockAnalysis artifact recovery workflow (retired 2026-08-12) was enumerated from disk but absent from manifest.workflows; verified PRE-EXISTING (tracked at HEAD, enumerator unchanged, HEAD manifest also lacked it) — unrelated to this diff |
| `check-lane-commit-manifest-inventory.mjs` | **FAIL** — same pre-existing recovery-workflow root cause |

## 3. Files changed by this verification (exact)

- `data/admin/lane-commit-manifest.json` — **regenerated** via `scripts/build-lane-commit-manifest.mjs` (registry_digest `a4667289…` → `59239605…` = canonical derived; idempotent thereafter; `--check` ok). The checked-in workflow requires the manifest to match the registry-derived value, so this regeneration is the completion of the diff, not an unrelated edit.
- No other files written. No cf:build, no commit/push/deploy, no unrelated edits.

## 4. PASS/FAIL

- **Asset reduction effect: PASS** — exclusion is correctly wired in registry + materializer, projected count 16,356 < 20,000 (budget gate clears), scouter/macro preserved.
- **Diff completeness: CONDITIONAL FAIL** — one diff-caused gap: `scripts/fixtures/derived-asset-registry/registry.expected.json` digest must be bumped consciously (or the derived-registry change re-scoped). The lane-registry fixture WAS updated; the derived-asset-registry fixture was not.
- **Pre-existing (not this diff):** lane-commit-manifest parity/inventory fail on the then-orphan StockAnalysis artifact recovery workflow — flagged for a separate decision (orphan workflow vs registry lane addition); the workflow was retired on 2026-08-12, closing the gap.
