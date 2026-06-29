# RELEASE: Fenok S1 Public Mutation Go/No-Go Checklist

Date: 2026-06-30
Status: admin readiness GO; public mutation NO-GO until explicit owner release
Base: `origin/main` at `028ee21381 chore: update computed signals and manifest`
Scope: S1 joined-ready stock candidates -> optional public stock scoring promotion

## Decision

Do not run the real public mutation yet.

The current clean-tree readiness gate is ready for owner review only. Public data
mutation remains blocked because it changes the public-facing S0 stock scoring
surface and requires an explicit owner or PM release instruction.

## Exact Release Command

Run only after explicit owner release:

```bash
node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check --enable-public-mutation
```

Safe no-write rehearsal:

```bash
node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check --enable-public-mutation --no-write
```

Readiness review command:

```bash
npm --prefix 100xfenok-next run qa:fenok-s1-public-mutation-readiness
```

## Mutation Surface

Exactly four files may change if the owner releases the enable command:

1. `data/computed/stock_action_index.json`
   - rows: `1066 -> 1174`
   - delta: `+108`
   - public file: no
2. `data/computed/fenok_signals.json`
   - rows: `1066 -> 1174`
   - delta: `+108`
   - public file: no
3. `data/computed/fenok_signals_summary.json`
   - rows: `1066 -> 1174`
   - delta: `+108`
   - public file: no
4. `100xfenok-next/public/data/computed/fenok_signals_summary.json`
   - rows: `1066 -> 1174`
   - delta: `+108`
   - public file: yes, slim summary only

Forbidden target:

- `100xfenok-next/public/data/computed/fenok_signals.json`

## Current Counts

- S0 public stock rows before enable: `1066`
- S1 promotion rows if enabled: `108`
- blocked excluded rows: `4`
- public rows after enable: `1174`
- S0 overlap rows: `0`
- ETF rows: `0`
- non-stock rows: `0`
- fake score rows: `0`
- duplicate current symbols: `0`
- current blocked exclusions: `DAY`, `HOLX`, `MMC`, `STRC`

## Rollback

The rollback policy is all-or-none. Do not partially keep promoted rows.

Before release, record the pre-mutation base:

```bash
PRE_MUTATION_BASE=$(git rev-parse HEAD)
```

If QA fails before commit:

```bash
git restore --worktree -- data/computed/stock_action_index.json data/computed/fenok_signals.json data/computed/fenok_signals_summary.json 100xfenok-next/public/data/computed/fenok_signals_summary.json data/admin/fenok-s1-stock-public-promotion-dry-run.json
```

If mutation was committed and must be reverted:

```bash
git checkout "$PRE_MUTATION_BASE" -- data/computed/stock_action_index.json data/computed/fenok_signals.json data/computed/fenok_signals_summary.json 100xfenok-next/public/data/computed/fenok_signals_summary.json data/admin/fenok-s1-stock-public-promotion-dry-run.json
```

Then rerun the QA list below before any corrective commit or push.

## QA Gate

Minimum checks for this release gate:

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
git diff --check
```

Also scan the changed diff for credential material before commit or push using
the project-standard staged-diff scan.

## Deploy And Public Guard Implications

- The release changes the public denominator from `1066` to `1174` only after
  the explicit enable command runs and the resulting generated files are
  committed and published.
- The slim public summary may change; the full public signal file remains
  forbidden.
- `qa:fenok-public-guard` must pass after mutation and before commit/push.
- No `PUBLIC + DAILY + GATED` claim is allowed for expanded S1 coverage unless
  separate freshness, daily, and gated evidence all pass together.

## Block Status

`[blocked]` Real public mutation is blocked by missing owner/PM release.

`[pass]` Admin readiness evidence is current in a clean worktree and may be
reviewed without public mutation.
