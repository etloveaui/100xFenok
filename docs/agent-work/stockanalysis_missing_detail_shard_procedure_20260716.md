# StockAnalysis ETF detail missing-shard procedure (2026-07-16)

## Scope and hard gates

- PREP artifact only. No provider fetch, workflow dispatch, or canonical data write is performed by the selector.
- Initial source snapshot: 666 missing tickers, ordered-set SHA-256
  `c90d87e011807d0d3e9a9cbca83ba88bf3724ea060e5c96aa290657935396b19`.
- Initial snapshot artifact:
  `docs/agent-work/stockanalysis_missing_detail_shards_20260716.json`.
- Do not prepare a dispatch command until Deploy is GREEN and source/public ETF detail coverage have identical count and ordered-set hash.
- Run only one StockAnalysis writer at a time. Do not start the next shard until the prior source commit and public re-projection are complete.

## Selector contract

`scripts/plan-stockanalysis-missing-detail-shards.py` imports the producer module and calls
`build_etf_detail_coverage()` directly. This is the same local candidate-union and missing-set
calculation used by `--reconcile-missing-etf-details`, without calling producer `main()`, the
endpoint canary, the fetch loop, or GitHub Actions.

The selector order is uppercase ticker ascending, exactly matching producer `missing_tickers`.
Each dispatch selector is regenerated as the first 100 tickers of the current missing set. The
last selector uses all remaining tickers.

The script also requires the recomputed producer set to equal the committed source coverage
artifact. A mismatch stops before a selector or command is emitted.

## Snapshot shard boundaries

| Shard | Snapshot indices | Size | First | Last | Expected remaining |
|---:|---:|---:|---|---|---:|
| 2 | 0..99 | 100 | ALA | DVXY | 566 |
| 3 | 100..199 | 100 | DWUS | IAUM | 466 |
| 4 | 200..299 | 100 | IBGM | MAYU | 366 |
| 5 | 300..399 | 100 | MBCE | QBTX | 266 |
| 6 | 400..499 | 100 | QBUF | TDCL | 166 |
| 7 | 500..599 | 100 | TDOG | WDCC | 66 |
| 8 | 600..665 | 66 | WDCX | ZSEP | 0 |

These are snapshot expectations, not dispatch-time assertions. The mandatory re-verification
below may regenerate a shard when small accepted drift changes the current set.

## Mandatory pre-dispatch re-verification

For shard 2, after Deploy is GREEN and public parity is restored:

```bash
python3 scripts/plan-stockanalysis-missing-detail-shards.py \
  --shard 2 \
  --previous-plan docs/agent-work/stockanalysis_missing_detail_shards_20260716.json \
  --output _tmp/stockanalysis-missing-detail-shard-2.json
```

For shard N after shard N-1 has committed and public re-projection has completed:

```bash
python3 scripts/plan-stockanalysis-missing-detail-shards.py \
  --shard N \
  --previous-plan _tmp/stockanalysis-missing-detail-shard-N_MINUS_1.json \
  --output _tmp/stockanalysis-missing-detail-shard-N.json
```

The previous selector artifact is the roll-forward checkpoint. The expected current set is:

```text
previous current_missing_tickers - previous selector.tickers
```

The script then recomputes the actual set and calculates the symmetric difference:

```text
delta = (actual - expected) union (expected - actual)
```

Both drift conditions must pass:

- `|delta| <= 10`
- `|delta| / max(1, |expected|) <= 0.02`

If either limit fails, source/public parity fails, source coverage differs from producer
recomputation, or the shard number is not sequential, the script exits non-zero without emitting
a selector artifact. Do not override these limits during the shard sequence; inspect and approve a
new baseline instead.

Before dispatch, inspect these fields:

```bash
jq '{shard,source,public_projection,drift_gate,selector:{size:.selector.size,first:.selector.first_ticker,last:.selector.last_ticker,set_sha256:.selector.set_sha256},expected_post_run_remaining_missing,dispatch}' \
  _tmp/stockanalysis-missing-detail-shard-N.json
```

The owner may then copy and run the exact `.dispatch.command` value. Do not `eval` it, and do not
dispatch more than one selector at a time.

## Required post-run/public re-projection gate

After every shard:

1. Wait for `fetch-stockanalysis.yml` to finish and commit canonical source data.
2. Confirm its `Dispatch shared projection rebuild` step dispatched `update-manifest.yml`.
3. Wait for Update Manifest and Deploy to become GREEN.
4. Require source/public `missing_tickers` count and ordered-set SHA-256 parity.
5. Confirm actual `remaining_missing`; compare it with the selector artifact's
   `expected_post_run_remaining_missing`. Any fetch failure remains visible as small drift at the
   next pre-dispatch gate; excessive drift stops the sequence.
6. Only then generate the next shard selector using the preceding selector artifact.

The expected count assumes every selected ticker becomes a valid detail file and no concurrent
catalog change occurs. Actual source coverage is authoritative.
