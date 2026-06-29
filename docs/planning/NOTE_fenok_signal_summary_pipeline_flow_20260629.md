# NOTE: Fenok Signal Summary Pipeline Flow

Date: 2026-06-29 KST

## Source Of Truth

- Canonical full payload: `data/computed/fenok_signals.json`
- Canonical public payload: `data/computed/fenok_signals_summary.json`
- Deployed public copy: `100xfenok-next/public/data/computed/fenok_signals_summary.json`

## Build Flow

1. `100xfenok-next` runs `npm run sync-static` during `predev`, `build:runtime`,
   `build:static`, and `cf:build`.
2. `sync-static` first runs `npm run build:fenok-signals`, which executes
   `node ../scripts/build-fenok-signals.mjs`.
3. The builder writes the full payload as root-only canonical data and writes
   the approved public summary to both root and public.
4. `sync-static` then copies canonical `../data` into `public/data`.
5. `sync-static-overrides.mjs` removes private-only mirrors such as
   `fenok_signals.json` and `fenok_*proxy*.json`.

## Guard

New approved summary fields must be added to `scripts/build-fenok-signals.mjs`.
They then reach the deployed public summary through the normal build path. Raw
FINRA, OCC CSV, option-chain PoC, and direct-corpus/social rows remain private;
public files expose only derived scores and explicit caveats. Public
`netOptionsProxyScore` is OCC listed-options volume skew, not yfinance/Yahoo
option-chain data.

See `.claude/rules/fenok-data-pipeline.md` for the persistent canonical-only
vs write-both rule. Private mirror cleanup is owned by `sync-static-overrides.mjs`.
