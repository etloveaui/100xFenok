# CONTRACT: Fenok S1 Stock Promotion Scoring v0.1

Date: 2026-06-30
Status: default-off implementation contract; public mutation requires explicit enable flag
Scope: S1 joined-ready stock candidates -> future opt-in stock scoring promotion

## Purpose

This contract defines the missing gate between S1 normalized stock candidates and
the public S0 stock scoring surface. The default command still does not enable
public scoring, mutate `stock_action_index.json`, mutate `fenok_signals.json`,
or write any public mirror.

S1 promotion must remain fail-closed until an owner-approved implementation uses
this contract and proves the dry-run/admin preview before any public mutation.

## Current Baseline

Current local baseline from the S1 promotion gate:

- S0 scored/public stock denominator: `1,066`
- S1 market-facts stock candidates: `1,178`
- S1 promotion audit gap: `112`
- Promotion-ready S1 rows: `107`
- Blocked S1 rows: `5`
- Future denominator if the 107-row seed is approved: `1,173`

Blocked rows stay excluded:

- `DAY`: `market_currency_country_scope`
- `HOLX`: `market_currency_country_scope`
- `KEY`: `market_currency_country_scope`
- `MMC`: `market_currency_country_scope`
- `STRC`: `evidence_families_min3`

ETF rows are out of scope and must remain in the separate S3 ETF lane.

## Promotion Scope

The first promotion seed is exactly the 107 rows currently emitted by
`data/admin/fenok-s1-stock-promotion-gate-plan.json` as joined-ready promotion
gate rows.

Rows are eligible only when all checks below are true:

- `asset_type_stock`
- `outside_s0`
- `etf_lane_excluded`
- `exact_ticker_contract`
- `market_currency_country_scope`
- `price_or_market_cap`
- `evidence_families_min3`

The five blocked rows must not be scored or promoted until their blockers are
repaired and the S1 joined gate is regenerated.

## Formula Boundary

S1 public promotion may reuse the existing stock-action scoring core only:

- scoring source: `scripts/stock-action-score-core.mjs`
- current score contract: `action-score-v0.3.1`
- source contract doc:
  `docs/planning/CONTRACT_stock_action_score_v0_3_20260613.md`

No separate S1 formula weights are approved in v0.1. The allowed families are
the existing action-score families:

- `valuation`
- `momentum_revision`
- `income`
- `index_structure`
- `smart_money`
- `sector_smart_money`

Missing or unsupported source axes must remain explicit `null` / unavailable
metadata in admin preview rows. They must not be filled with zero, copied from a
different ticker, inferred from company name, or silently converted into
eligible evidence.

The first implementation may use only fields that are already mapped into the
shared scoring core. If a family requires new mapping, the mapping must land as
a separate reviewed change before that family can become present for S1 rows.

Known unsupported S1 mapping gaps at draft time:

- S1 `market_facts` does not carry Global Scouter PER-band min/current/max.
- S1 identity sector is not yet bridged to the canonical stock-action sector
  map.
- S1 conviction remains unmapped until the ticker-level source join is explicit.

## Admin Dry-Run Shape

Before public mutation, an implementation must produce an admin-only dry-run
artifact. Proposed path:

`data/admin/fenok-s1-stock-public-promotion-dry-run.json`

Writer command:

```bash
node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check
```

No-write QA command:

```bash
npm --prefix 100xfenok-next run qa:fenok-s1-public-promotion-dry-run
```

Explicit-enable no-write guard command:

```bash
npm --prefix 100xfenok-next run qa:fenok-s1-public-mutation-guard
```

Enable-readiness review command:

```bash
npm --prefix 100xfenok-next run qa:fenok-s1-public-mutation-readiness
```

Required top-level fields:

- `schema_version`
- `generated_at`
- `source_gate`
- `source_score_contract_version`
- `dry_run: true`
- `public_mutation_enabled: false`
- `counts`
- `write_plan`
- `raw_policy`
- `acceptance_checks`
- `promotion_rows`
- `blocked_rows`

Required `counts` fields:

- `public_s0_before`
- `s1_gap_total`
- `promotion_rows`
- `excluded_blocked_rows`
- `public_s0_after_if_enabled`
- `s0_overlap_rows`
- `etf_rows`
- `non_stock_rows`
- `fake_score_rows`
- `rows_with_missing_axes`
- `rows_with_unsupported_axes`
- `files_written`
- `public_files_written`

When `--enable-public-mutation --no-write` is used, the artifact may set
`public_mutation_enabled: true` to validate the exact mutation path, but
`files_written` and `public_files_written` must remain `0`.

Required `promotion_rows[]` fields:

- `ticker`
- `source_stage`
- `target_stage`
- `asset_type`
- `identity`
- `eligibility`
- `score_source`
- `score_contract_version`
- `score_preview_summary`
- `missing_scoring_axes`
- `unsupported_scoring_axes`
- `claim_scope`

The dry run may read private/admin artifacts, but it must not include raw private
source rows in any public-bound payload.

## Public Mutation Gate

Public mutation remains forbidden until all acceptance checks below pass in the
same clean worktree:

1. Current S1 gate counts match exactly: `107` promotion-ready and `5` blocked.
2. S0 denominator is preserved during dry run: `1066 -> 1066`.
3. Hypothetical public denominator is explicit: `1066 + 107 = 1173`.
4. `s0_overlap_rows = 0`.
5. `etf_rows = 0` and `non_stock_rows = 0`.
6. `fake_score_rows = 0`.
7. Every missing or unsupported axis is explicit in the dry-run row.
8. `raw_policy.raw_public = false`.
9. `raw_policy.third_party_raw_public = false`.
10. `public_files_written = 0` during dry run.
11. Public mutation is controlled by the explicit non-default
    `--enable-public-mutation` flag; no default command may write public S1
    outputs.
12. `stock_action_index.json`, `fenok_signals.json`, and public mirrors are
    generated from the same promoted ticker set if public mutation is enabled.
13. The exact allowed mutation targets are:
    `data/computed/stock_action_index.json`,
    `data/computed/fenok_signals.json`,
    `data/computed/fenok_signals_summary.json`, and
    `100xfenok-next/public/data/computed/fenok_signals_summary.json`.
14. `100xfenok-next/public/data/computed/fenok_signals.json` remains forbidden.
15. The rollback target set must exactly match the allowed mutation targets.

## Enable-Readiness Manifest

Before any owner release of `--enable-public-mutation`, the implementation must
write an admin-only review artifact:

`data/admin/fenok-s1-public-mutation-enable-readiness.json`

The artifact must be generated without executing the enabled public write path.
It must make these surfaces reviewable:

- exact target files and forbidden public full-signal target;
- per-target row deltas if the enable flag is later released;
- full ticker additions/removals and blocked exclusions;
- score fields included in stock-action rows versus axes that stay null;
- no ETF/non-stock rows, no S0 overlap, no fake scores;
- exact rollback target set and all-or-none rollback policy.

Its QA command must keep `public_files_written = 0`.

Minimum QA before any public mutation:

```bash
node --check scripts/stock-action-score-core.mjs
node --check scripts/audit-fenok-stock-promotion-candidates.mjs
node --check scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs
node --check scripts/write-fenok-s1-public-mutation-enable-readiness.mjs
npm --prefix 100xfenok-next run qa:fenok-stock-promotion-audit
npm --prefix 100xfenok-next run qa:fenok-s1-promotion-gate
npm --prefix 100xfenok-next run qa:fenok-s1-public-promotion-dry-run
npm --prefix 100xfenok-next run qa:fenok-s1-public-mutation-guard
npm --prefix 100xfenok-next run qa:fenok-s1-public-mutation-readiness
npm --prefix 100xfenok-next run qa:fenok-public-guard
npm --prefix 100xfenok-next run qa:fenok-signal-lens
npm --prefix 100xfenok-next run qa:fenok-edge-readiness
```

## Write Sequence If Approved Later

The explicit-enable implementation must use this sequence:

1. Regenerate S1 audit/gate evidence.
2. Produce the admin dry-run artifact with `public_mutation_enabled=false`.
3. Compare counts and row identities against the gate artifact.
4. Only after owner approval, run the explicit public mutation path with
   `--enable-public-mutation`.
5. Rebuild `stock_action_index.json`.
6. Rebuild `fenok_signals.json` and the slim public summary.
7. Verify the public mirror guard rejects private/full signal leakage.
8. Keep S1 daily/gated/readiness claims false unless separate freshness gates
   prove them.

## Fail-Closed And Rollback Policy

If any gate fails:

- stop before public mutation;
- leave `stock_action_index.json`, `fenok_signals.json`, and public mirrors at
  their prior S0-only state;
- keep blocked rows in diagnostics only;
- keep readiness wording as not public/daily/gated for expanded S1 coverage;
- do not claim `PUBLIC + DAILY + GATED` or paid-ready completion.

If a public mutation has already happened and a later QA fails, rollback must
restore the previous generated S0 files as a single scoped revert of generated
outputs and the promotion implementation. Do not partially keep promoted rows.

## Non-Goals

- No live fetch.
- No ETF scoring or ETF denominator change.
- No publication of raw private artifacts.
- No ticker alias inference for acquired, delisted, or old-symbol rows.
- No public done claim for S1 until source, scoring, public, daily, and gated
  evidence all pass together.

## Owner Decisions Still Required

- Approve whether the first public seed is exactly the current 107 rows.
- Approve use of the existing `action-score-v0.3.1` core for S1 public rows.
- Approve the dry-run artifact path and schema.
- Approve the explicit public mutation command name and default-off flag.
- Decide whether unsupported families remain null for v0.1 or require mapping
  work before public promotion.
