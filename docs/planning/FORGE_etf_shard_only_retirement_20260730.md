# Forge plan: ETF shard-only retirement

## Decision

The Owner accepts removal of the legacy direct-static ETF JSON contract and the
unmeasured external-consumer risk. The acceptance boundary is the first-party
site: ETF API, ETF detail, ETF compare, stock detail, current canonical data,
and deterministic shard regeneration must remain correct.

## Execution

1. Reconstruct the previously rehearsed shard-only writer, materializer,
   runtime, client, guard, and rollback controls on locked source
   `b335dcbb49420490400c595602e78bbbcfb23fee`.
2. Reconcile the rehearsal against the current canonical count of 5,586 payloads.
3. Stop every writer/materializer path from recreating top-level public ETF JSON files.
4. Switch runtime and clients to explicit shard-only integrity states; no legacy fallback or silent downgrade.
5. Create a deterministic retirement plan and journal, then delete only the 5,586 current top-level public ETF JSON files. Preserve canonical payloads, 128 shard bodies, and one manifest.
6. Run writer/materializer reruns, focused tests, typecheck, full public guard, and one guarded Cloudflare build.
7. Measure direct assets and validate first-party API/page behavior locally.
8. Commit exactly 5,742 paths: 27 source/test/plan paths, 129 shard assets, and
   5,586 direct legacy deletions. Exclude all generated admin and market-facts
   churn.
9. Use a skip-annotated main commit so the existing push-triggered workflow
   cannot bypass the staged rollout by deploying 100% before preview.
10. Push the same commit to a release ref, upload a zero-traffic Cloudflare
    version, hard-gate on the version preview, then deploy 10% and 100% with
    the captured pre-deployment version as the rollback anchor.

## Risks

| Risk | Control |
|---|---|
| A writer recreates legacy files | writer/materializer/fetcher regression tests plus post-rerun count zero |
| Shard corruption silently falls back | typed integrity failure and explicit 503; no legacy fallback |
| Incorrect mass deletion | exact plan, path/hash/byte validation, interruption-safe journal |
| Current canonical drift | regenerate shards from the locked current canonical set and use actual count |
| First-party regression | API, ETF detail, ETF compare, stock detail, typecheck, build, and local smoke |
| Existing main push auto-deploys 100% | commit message skips push workflows; staged upload/deploy is manual and evidence-bound |
| Intermittent SPY 5xx recurs | interleave preview and production probes; stop or roll back on candidate-specific 5xx |
| External direct-static consumers are unknown | Owner explicitly accepts removal; verify sampled retired URLs return 404 |

## Rollback

The retirement tool restores every legacy file byte-for-byte from canonical
data using the journal and rejects plan or shard drift. Production rollback
uses the exact pre-transaction Cloudflare version at 100%; durable source
rollback also requires reverting the shard-only source commit.

## Quality gates

- canonical ETF count equals shard manifest payload count;
- public top-level legacy ETF JSON count is zero after every approved writer/materializer rerun;
- shard body count is 128 and manifest count is one;
- focused writer, materializer, loader, client, API, UI, redaction, universe, and public-guard tests pass;
- TypeScript and guarded Cloudflare build pass;
- measured asset count is recorded;
- local API and page smoke pass;
- version preview proves retired static URLs, shard URLs, typed unavailable
  handling, APIs, and pages before any production traffic;
- 10% canary and 100% production each have allocation and smoke evidence;
- the release commit is present on `main` without triggering an uncontrolled
  direct deployment.
