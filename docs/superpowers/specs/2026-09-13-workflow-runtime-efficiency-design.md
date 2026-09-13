# Workflow Runtime Efficiency Design

## Goal

Remove repeated or unnecessarily serialized work from the six workflow hot spots identified from recent hosted runs, while preserving the existing publication, quota, freshness, and deployment safety boundaries.

## Design

### Update Manifest

Run the shared projection stack only inside the existing fetch/reset/push-retry loop. The first loop attempt becomes the normal path: it starts from current `origin/main`, performs the final public-validating projection, checks the centrally owned paths, and either exits cleanly on no change or commits and pushes. A rejected push repeats the projection against the new remote head. This removes the preliminary projection and duplicate change probe without weakening race recovery.

### StockAnalysis publication retries

Cache validation within one publish job by a deterministic fingerprint of the checked source contracts plus the immutable acquisition artifact digest. The first attempt runs the full validation suite. A retry after an unrelated data-writer race reuses that proof; a change to any covered workflow, script, app script, package contract, lane manifest, or acquisition artifact invalidates the fingerprint and reruns validation. Applying the artifact, resolving provider state, rebuilding public projections, staging, and auditing remain per-attempt because they depend on the latest main tree.

### Serving probe

Replace the single-request loop with a small bounded worker pool. Each path keeps its own timeout and result, the total deadline still stops new work, and every unstarted path receives an explicit deadline failure. Results are returned in enrollment order so reports and incident diffs stay deterministic. The concurrency cap is immutable by default and environment input may only tighten it.

### Cloud cost gate

The pre-publication gate already includes the planned class A, class B, and byte cost of the complete write. Treat that result as the publication's budget proof instead of walking the whole R2 estate again immediately after the write. The outcome records the preflight verdict and an explicit skipped-after reason; blocked or unreadable preflight measurements still fail closed. Rollback and chaos paths retain their current separate measurements.

### Worker deployment

Retain the full-history checkout: the pre-upload source-lineage fence compares the live deployed revision, the candidate, and current main with Git ancestry, so a shallow checkout cannot safely answer it. Run token policy immediately after dependency installation so source-policy failures stop before data projection and bundling. Keep the token check inside the build chain as a second check after generated/static synchronization. Worker bundle size still requires a completed bundle and therefore remains immediately after build. Replacing the ancestry proof with a remote comparison service would add a new availability dependency and is outside this bounded cleanup.

### AKAF resolver

No new implementation is required. Current source already maps an expired emergency LKG with the resolver's `unavailable` transition to an honest unavailable result and keeps all other missing-current states fail-closed. Re-run the focused regression and workflow contract as closure evidence.

### Validation drift found during implementation

Update every structural test that still requires the removed preliminary projection. Correct the deploy provenance test to inspect the current `build-deploy` job instead of the retired `deploy` job. Register the earnings-overview admin refresh summary as retained control-plane evidence so the current data estate remains completely owned; the existing budget test is the regression gate.

## Safety boundaries

- No workflow timeout, quota threshold, deployment smoke, pointer rule, or writer concurrency rule changes.
- No cached proof crosses workflow runs.
- Retry validation reuse is invalidated by covered source or artifact drift.
- Probe concurrency is bounded and preserves one result per enrolled path.
- The cost gate remains mandatory before every real write and still blocks on an unreadable measurement.
- No local build, deployment, or live write is performed from the Mac.

## Acceptance

- Update Manifest has one projection call site, inside its retry loop.
- StockAnalysis retries do not rerun validation when the covered source and artifact are unchanged.
- The serving probe uses bounded concurrency and preserves timeout/deadline failure accounting and stable report order.
- Normal publication performs one full cost measurement instead of two.
- Deploy Worker exposes token failures before the build; full checkout and post-build bundle sizing remain documented safety costs.
- The AKAF unavailable regression passes unchanged.
- Current structural tests inspect live workflow names and the cloud budget inventory has no unowned file.
