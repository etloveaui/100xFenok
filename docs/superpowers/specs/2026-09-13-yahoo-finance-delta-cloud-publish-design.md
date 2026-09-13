# Yahoo Finance Delta Cloud Publication Design

## Goal

Keep Yahoo Finance cloud publication within its existing job window by transferring and body-verifying only content that is not already proven by the active generation.

## Chosen approach

Opt Yahoo Finance into active-generation reuse while leaving every other family on the current full-publication path.

- Read and validate the active pointer and its manifest before publication.
- List object keys and stored lengths once, then mark a new-manifest object reusable only when the active manifest already binds the same content-addressed key and the listing reports the exact byte length.
- Pass that bounded proof into the shared publication contract. The contract still validates every local payload, freshness rule, privacy rule, path, digest, and byte length, but omits `putIfAbsent` for proven reusable objects.
- Publish and read back every new or unproven object plus the new manifest through the existing bounded pool.
- After the pointer CAS, fetch and cross-bind the active manifest, body-verify every new or unproven object against the local payload, and accept proven reusable objects through the same listing-plus-length invariant already used by rollback.
- Report total, body-verified, and reused asset counts so a run cannot claim full body parity when it used reuse evidence.

## Safety argument

Object keys contain the payload SHA-256. A reusable key must be referenced by the previously active, fully validated manifest and must still appear in the object listing at the declared length. The active generation remains protected throughout publication and becomes `pointer.previous` after promotion, so retention cannot collect those objects during the transition. The remaining assumption is R2 storage integrity after a prior successful parity check; rollback already uses this exact assumption to avoid downloading every retained payload.

An absent or wrong-length listing entry is not reused. It follows the normal `putIfAbsent` path, where absence is repaired and an existing conflicting body fails with `IMMUTABILITY_VIOLATION`. A malformed pointer, manifest, or listing still fails closed before pointer promotion.

## Resume behavior

When the active pointer already targets the same generation, all listed payload objects can be reused. Receipt recovery remains unchanged, and final verification reads only the active manifest while checking payload presence and lengths from the listing proof.

## Scope

Implementation changes the shared generation publisher, the node publisher's reuse planning and parity functions, and their focused offline tests. Yahoo Finance alone enables the optimization. The workflow timeout, cost ceilings, pointer schema, receipt schema, retention rules, privacy rules, and deployment configuration do not change.

## Verification

- Prove a mixed generation uploads and body-verifies only its changed object and manifest.
- Prove missing or wrong-length prior objects are not reused and therefore take the existing full integrity path.
- Prove an unverified reuse claim is rejected by the shared contract.
- Prove changed-object corruption still fails parity before a successful result is emitted.
- Run the focused generation and publisher tests plus syntax and diff checks locally; reserve any heavy or live workflow proof for the approved remote route.

## Acceptance

- A normal Yahoo Finance refresh performs remote body operations proportional to changed content instead of all roughly 6,600 payloads.
- Atomic pointer promotion, crash recovery, rollback, privacy checks, and local payload validation remain intact.
- All non-Yahoo families preserve their current behavior.
- No timeout increase is used to mask the excess work.
