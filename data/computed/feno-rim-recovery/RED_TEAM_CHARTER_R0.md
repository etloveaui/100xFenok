# RED TEAM CHARTER — R0 (FENO RIM RECOVERY)

> Issued 2026-08-07 by km (handler). For cc (independent red team).
> bias_guard: for awareness, not endorsement. Divergence is signal — do not converge to handler conclusions.

## Role

- cc is the INDEPENDENT red team. Do NOT co-author handler implementation code.
- Independent duties: verify the old retirement logic; pre-review the frozen R0 criteria;
  check math / point-in-time / look-ahead / survivorship; recompute key statistics with your
  OWN code (no imports of handler modules); attack contrary interpretations; reproduce the
  final verdict.
- Reply through the feno-handoff wrapper (`send --right` from your pane); never ask the owner
  to paste.

## Owner directive (2026-08-07)

DEC-290 `RETIRE_RIM_PUBLIC_PRODUCT` is preserved as history but no longer final authority.
`PUBLIC_RIM_SURFACE = KEEP_QUARANTINED` stays in force — no number republication, no promotion.
New state: `TOP_DOWN_B1 = RETIRED`, `HISTORICAL_ACCOUNTING_B1 = RESEARCH_BASELINE_ONLY`,
`CANONICAL_RIM = REOPENED_FOR_BOUNDED_VALIDATION`. Record: DECISION_LOG DEC-291 (parent repo).

## Key paths

- Frozen R0 criteria: `source/100xFenok/data/computed/feno-rim-recovery/r0-criteria.json`
  (sha256 `5d2758840814a9ec8bec8ce15d0f406adf5d949e1fd6b6b0eb7a48382e1ca5f2`, freeze receipt
  `r0-freeze-receipt.json`, committed earlier than any result in `6d3ec4f29c`)
- X2 result under re-adjudication: `source/100xFenok/data/computed/feno-rim-v2/RIM_CROSS_SECTIONAL_BOTTOM_UP.json`
- X2 runner (pipeline R0 must reproduce unchanged): `source/100xFenok/scripts/feno-rim-v2/verify/x2-cross-sectional.mjs`
- Prior decision (history): `source/100xFenok/data/computed/feno-rim-v2/FINAL_RIM_DECISION.json`
- Resolution report: `docs/analysis/yoo-rim-audit/FINAL_RIM_RESOLUTION_REPORT.md`
- Independent audit of X2/X3: `source/100xFenok/data/computed/feno-rim-v2/X2X3_INDEPENDENT_AUDIT.json`

## cc task 1 — criteria pre-review (before handler publishes R0 results)

1. Read `r0-criteria.json` end to end. Attack it:
   - Any choice that could bias toward either rescue or retirement?
   - Is the X2 reproduction gate (1e-6 on per-origin ICs) correctly specified?
   - Are R0-A..D statistics and the verdict mapping internally consistent and pre-committing
     (no degree of freedom left to move after results)?
   - Momentum/size definitions: PIT-clean? Any look-ahead?
   - Equivalence bands (b2 ±0.01, residual IC ±0.05, mean D ±0.05): defensible or arbitrary?
2. Independently verify the DEC-290 basis claim: the raw incremental difference (−0.057/−0.043)
   was computed without a B/P-controlled multivariate test. Confirm or dispute from the files.
3. Deliverable: one red-team report mail listing ISSUE / SEVERITY / RECOMMENDATION per finding,
   plus a PASS/CONDITIONAL_PASS/FAIL verdict on the criteria. Do not rewrite the criteria;
   the handler decides and records any amendment BEFORE running results (amendment = new freeze).

## Ground rules

- Stop conditions: future-info leak, post-result threshold choice, credential exposure,
  repo-boundary breach, paid/login/deploy requirement. Otherwise: record risk, continue.
- All claims must cite `path:line` or artifact json pointer. Mark unavailable evidence `[not verified]`.
- No polling the handler; the handler sends phase results as they close.
