# KRX Staging Deduplication Design

## Goal

Remove KRX's duplicate manual Git staging without changing private raw acquisition, public-safe aggregation, walkback/LKG recovery, publication, or consumers.

## Chosen approach

Keep the existing lane registry, generated commit manifest, and shared staging helper unchanged. Modify only the workflow and its existing direct workflow test.

- Remove the two guarded manual recovery-state `git add` blocks after the always-stage helper.
- Remove the four manual public-safe output `git add` commands after the success-stage helper.
- Keep both helper calls, the success guard, emitter, walkback, recovery exit behavior, commit/rebase/push, and manifest-reconciliation dispatch unchanged.
- Replace five staging-path literal assertions with one exact staging-control assertion that covers the generated manifest and requires zero manual `git add` commands.
- Keep the detection-attempt assertion because it validates emitter wiring rather than duplicate staging.

## Why no registry change

The manifest already expresses the intended contract:

- Detection attempt, recovery index, and retained bridge LKG are optional on the always path.
- The bridge index and three public-safe computed aggregates are required on success.
- Exclusions and the two other stages are empty.

The helper therefore already preserves optional absence and fails closed if any successful output is missing.

## Privacy and recovery boundary

- Raw KRX payloads remain under the private producer-owned area and are not added to the commit manifest.
- The four success outputs remain bounded public-safe summaries without issuer rows.
- Public copies remain owned by later Update Manifest materialization, not by this commit step.
- Walkback and LKG transactions finish before staging; no condition or path in those flows changes.

## Scope

Implementation changes exactly two existing files:

- `.github/workflows/fenok-edge-krx-daily.yml`
- `scripts/test-fenok-edge-krx-daily-workflow.mjs`

No registry, generated manifest, helper, producer, data, privacy metadata, public route, recovery logic, or new test file changes are included.

## Verification

- Add the combined staging-control assertion first and prove it fails because the workflow still contains six manual `git add` commands.
- Run manifest parity, JavaScript syntax, exact workflow-diff checks, tracked/nonignored path checks, and the existing direct workflow test.
- Use only a bounded temporary Git fixture if needed to reconfirm optional and required file behavior.
- Obtain independent read-only review of the actual two-file diff.
- Do not run a build, broad suite, network request, workflow dispatch, deployment, or push.

## Acceptance

- All seven manifest paths retain their existing stage and requiredness.
- Failure/degraded runs still persist optional recovery state; successful runs still require all four public-safe outputs.
- Private raw and downstream public materialization boundaries remain unchanged.
- Five literal assertions become one manifest assertion, reducing the assertion count by four.
- The direct workflow test stays below the load gate; natural scheduled proof remains not verified.
