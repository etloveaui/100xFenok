// Lane routing derivation (#366 item 4, shadow step): derives the private-root
// lists from the lane registry so the hand-maintained copies can be
// cross-checked — and later REPLACED — by a single source. Shadow contract of
// this slice: the hand lists stay authoritative; these derivations exist to
// assert parity with them, fail-closed on any divergence (the 07-18 finra leak
// class, pinned by bd46f916f8).
//
// Derivation rules (all paths returned data/-stripped, matching the consumers):
//   - excluded public data ROOTS (sync-public-data): declared exception roots
//     + admin_store of every privacy_class:"private" lane + non-admin
//     canonical_outputs of private lanes whose public_mirror is empty;
//   - excluded public data FILES (sync-public-data): declared exception files
//     flagged may_be_absent (ephemeral, intentionally not committed);
//   - forbidden private data-supply roots (mirror guard): declared exception
//     roots + non-admin canonical_outputs of private lanes whose public_mirror
//     is empty (lane admin stores are NOT here by design — they never reach
//     the mirror because the sync list above withholds them).

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
  // Canonical outputs are withheld from the mirror when the lane mirrors
  // NOTHING — independent of the admin-store privacy axis (a lane can have a
  // publicly-synced admin store yet a withheld canonical, or a mixed canonical
  // like OCC where availability mirrors but volume/history stay private).
  return registry.lanes
    .filter((lane) => lane.roots.public_mirror.length === 0)
    .flatMap((lane) => lane.roots.canonical_outputs)
    .filter((candidate) => !candidate.startsWith("data/admin/"));
}

function exceptionRootsOf(registry) {
  // Unified on the parameterized registry API (fh-175 root-fix).
  return declaredExceptionPaths("root", registry);
}

export function deriveExcludedPublicDataRoots(registry = LANE_REGISTRY) {
  return uniqueSorted([
    ...exceptionRootsOf(registry),
    ...laneAdminRoots(registry),
    ...laneCanonicalPrivateRoots(registry),
  ].map(stripDataPrefix));
}

export function deriveExcludedPublicDataFiles(registry = LANE_REGISTRY) {
  return uniqueSorted(
    registry.declared_exceptions
      .filter((entry) => entry.kind === "file" && entry.may_be_absent === true)
      .map((entry) => stripDataPrefix(entry.path)),
  );
}

export function deriveForbiddenPrivateDataSupplyRoots(registry = LANE_REGISTRY) {
  return uniqueSorted([
    ...exceptionRootsOf(registry),
    ...laneCanonicalPrivateRoots(registry),
  ].map(stripDataPrefix));
}
