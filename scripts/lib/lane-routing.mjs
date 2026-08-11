// Lane routing derivation (#366 item 4): private directory roots and exact
// file-shaped exclusions now feed the public-data sync directly from the lane
// registry — a single fail-closed SSOT with no consumer hand lists. Only
// GENUINELY PRIVATE mirrorless lanes derive exclusions: public/public_mirror
// plane families must never be deleted from the public mirror merely because
// their public_mirror list is temporarily empty (mirror ownership moved to
// the merge boundary — sync full walk + update-manifest materialize). This
// keeps a newly registered private admin root or file-shaped private
// canonical fail-closed against the 07-18 FINRA leak class without deleting
// tracked LKG mirror fallbacks.
//
// Derivation rules (all paths returned data/-stripped, matching the consumers):
//   - excluded public data ROOTS (sync-public-data): declared exception roots
//     + admin_store of every privacy_class:"private" lane + directory-shaped
//     non-admin canonical_outputs of privacy_class:"private" lanes whose
//     public_mirror is empty, excluding explicitly declared
//     public_canonical_outputs;
//   - excluded public data FILES (sync-public-data): declared exception files
//     explicitly flagged public_sync:"exclude" (may_be_absent remains a
//     compatibility shorthand for the historical detection-floor report)
//     + file-shaped (.json) non-admin canonical_outputs of
//     privacy_class:"private" lanes whose public_mirror is empty, excluding
//     explicitly declared public_canonical_outputs — the sync consumer
//     requires roots to be directories on disk;
//   - forbidden private data-supply roots (mirror guard): declared exception
//     roots + non-admin canonical_outputs of privacy_class:"private" lanes
//     whose public_mirror is empty, excluding explicitly declared
//     public_canonical_outputs (lane admin stores are NOT here by design —
//     they never reach the mirror because the sync list above withholds them).

import { LANE_REGISTRY, declaredExceptionPaths } from "./lane-registry.mjs";

function stripDataPrefix(path) {
  return path.replace(/^data\//, "");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function privateLanes(registry) {
  return registry.lanes.filter((lane) => lane.privacy_class === "private");
}

function laneAdminRoots(registry) {
  return privateLanes(registry)
    .filter((lane) => lane.roots.admin_store !== null)
    .map((lane) => lane.roots.admin_store);
}

function laneCanonicalPrivateRoots(registry) {
  // Canonical outputs are withheld from the mirror only for genuinely
  // PRIVATE lanes that mirror NOTHING. Public/public_mirror plane families
  // must never derive into exact-file deletion merely because public_mirror
  // is temporarily empty (mirror ownership moved to the merge boundary); a
  // lane with a declared public_mirror (plane-enrolled) is also never
  // withheld. The admin-store axis stays independent: a lane can have a
  // publicly-synced admin store yet a withheld canonical, or a mixed
  // canonical like OCC where availability mirrors but volume/history stay
  // private.
  return registry.lanes
    .filter((lane) => lane.privacy_class === "private")
    .filter((lane) => lane.roots.public_mirror.length === 0)
    .flatMap((lane) => lane.roots.canonical_outputs
      .filter((candidate) => !(lane.public_canonical_outputs ?? []).includes(candidate)))
    .filter((candidate) => !candidate.startsWith("data/admin/"));
}

function exceptionRootsOf(registry) {
  // Unified on the parameterized registry API (fh-175 root-fix).
  return declaredExceptionPaths("root", registry);
}

function isFileShapedCanonical(candidate) {
  // sync-public-data hard-splits its exclusion lists: ROOTS entries present on
  // disk must be directories, FILES entries must be regular files. Canonical
  // outputs are directory stores unless they are single JSON artifacts, so the
  // derivation must make the same split (2026-07-19 deploy-crash class: a
  // file-shaped canonical in the roots list crashes the build the moment the
  // lane's first successful run commits the artifact).
  return candidate.endsWith(".json");
}

export function deriveExcludedPublicDataRoots(registry = LANE_REGISTRY) {
  return uniqueSorted([
    ...exceptionRootsOf(registry),
    ...laneAdminRoots(registry),
    ...laneCanonicalPrivateRoots(registry).filter((candidate) => !isFileShapedCanonical(candidate)),
  ].map(stripDataPrefix));
}

export function deriveExcludedPublicDataFiles(registry = LANE_REGISTRY) {
  return uniqueSorted([
    ...registry.declared_exceptions
      .filter((entry) => entry.kind === "file" && (entry.public_sync === "exclude" || entry.may_be_absent === true))
      .map((entry) => entry.path),
    ...laneCanonicalPrivateRoots(registry).filter(isFileShapedCanonical),
  ].map(stripDataPrefix));
}

export function deriveForbiddenPrivateDataSupplyRoots(registry = LANE_REGISTRY) {
  return uniqueSorted([
    ...exceptionRootsOf(registry),
    ...laneCanonicalPrivateRoots(registry),
  ].map(stripDataPrefix));
}
