# Treasury TGA Staging Deduplication Design

## Goal

Remove Treasury TGA's duplicate manual staging while preserving optional administrative paths and the current fail-closed canonical output contract.

## Scope

- Keep the existing registry, generated manifest, and shared staging helper architecture.
- Mark only `data/macro/tga.json` required in its existing success stage.
- Regenerate the existing manifest.
- Remove manual staging for three administrative files and the canonical TGA payload.
- Delete three redundant administrative path assertions and add one canonical-required assertion in the same existing Treasury check. This reduces assertions by two and adds no test file or suite.

## Preserved behavior

- Administrative files remain optional and stage when present.
- The canonical TGA payload remains required after a successful fetch.
- Missing optional files remain skippable; missing canonical output remains fail-closed.
- Provider acquisition, cadence, provenance, recovery, commit, push, and downstream publication remain unchanged.

## Excluded work

- No stage movement, new framework, checker, or global policy change.
- No other provider or workflow migration.
- No build, broad test, network request, workflow dispatch, deployment, or unrelated cleanup.

## Verification

- Confirm regenerated manifest parity and exact requiredness.
- Use temporary Git fixtures to prove optional present/absent handling and required missing/present behavior.
- Measure runtime and swap count.
- Inspect the exact four-file diff and obtain independent read-only review.
- Do not push; natural scheduled proof remains not verified.

## Acceptance

- The workflow contains exactly two helper calls and no manual Treasury staging.
- Four administrative paths remain optional; the canonical success path is required.
- The implementation changes only the registry policy, generated manifest, workflow, and existing Treasury check.
