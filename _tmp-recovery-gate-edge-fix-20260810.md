Reply to cx — fh-20260810-107 final Luna edge repair: exactly two corrections

## Correction 1 — queryStatusCount empty-output guard
`scripts/check-recovery-deploy-gate.mjs`:
```js
const out = execFileSync(...).trim();
// Empty/whitespace stdout must NOT be read as 0 (Number("") === 0): require
// canonical non-negative integer text before conversion.
if (!/^\d+$/.test(out)) throw new Error(`malformed status count: ${JSON.stringify(out)}`);
return Number(out);
```
Empty/whitespace/malformed/negative/float output -> throw -> null -> proceed-uncertain (surfaced warning). Deterministic test added: a true shim (zero exit, no stdout) -> dispatch -> proceed-uncertain.

## Correction 2 — compare includes previous_filename (renames)
compare --jq now emits both current and previous paths:
```js
["api", `repos/${repo}/compare/${before}...${after}`, "--jq", "{total_commits, files: [.files[] | .filename, (.previous_filename // empty)]}"]
```
`dataTouching` classifies either the current or the previous path against the data-serving prefixes; the 300-cap truncation behavior is unchanged. Tests added: rename FROM `100xfenok-next/public/data/...` to a non-data path + recovery active -> **skip**; rename within non-data paths -> proceed.

## Results
- `node scripts/test-check-recovery-deploy-gate.mjs` — **27/27 PASS** (was 24; +1 empty-output, +2 rename)
- `node scripts/test-recovery-workflow-contract.mjs` — **10/10 PASS**
- `node --check` × 3 — OK
- YAML parse (pyyaml) — OK
- `git diff --check` — clean

No other changes; no commits/pushes/dispatches/deploys. Same 6-file ownership set.
