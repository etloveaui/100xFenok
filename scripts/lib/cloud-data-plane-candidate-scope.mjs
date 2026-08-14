import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson } from "./json-canonical.mjs";
import { LANE_REGISTRY, registryLaneById } from "./lane-registry.mjs";

export const CANDIDATE_SCOPE_SCHEMA = "cloud-data-plane-candidate-scope/v1";

function fail(message) {
  throw new Error(`cloud-data-plane-candidate-scope: ${message}`);
}

// Why this module exists at all: the estate-wide inventory answers "how large is
// everything we own", which is the wrong question for a migration budget. A
// migration budget must be argued from the exact payload that moves. This builds
// that scoped inventory from the lane registry rather than from a hand-written
// path list, so the include set cannot drift away from declared ownership.
//
// Every field below is either derived from the registry or is an explicit,
// reasoned exclusion. There is deliberately no "everything else" bucket: an
// unclassified sibling path fails the build rather than being silently dropped,
// because a silently dropped path is exactly how a migration under-counts.
const CANDIDATE_SCOPES = Object.freeze({
  stockanalysis_etf_detail: Object.freeze({
    id: "stockanalysis_etf_detail",
    // The shared tree the candidate lives in. Every entry directly under this
    // root must be classified before the scope is considered complete.
    classification_roots: Object.freeze(["data/stockanalysis"]),
    // The public tree is not a mirror of the canonical payloads: sync-public-data
    // folds 5,605 per-ticker files into a shard index plus payload shards. It is
    // rebuilt from canonical on every publication, so it is recorded for
    // traceability and explicitly does not add migration bytes.
    derived_public_projection_roots: Object.freeze([
      Object.freeze({
        path: "100xfenok-next/public/data/stockanalysis/etfs",
        kind: "shard_projection",
        migrates: false,
        reason: "rebuilt deterministically from the canonical root by sync-public-data; migrating it would double-count the same payload under a second shape",
      }),
    ]),
    // Reasons are recorded per path, not per class, because two paths in the same
    // class can be excluded for different reasons and a shared label would hide
    // that. Paths owned by another lane are resolved from the registry at build
    // time and must not be listed here.
    declared_exclusions: Object.freeze({
      "data/stockanalysis/backfill": "one-off historical backfill output with no producing lane; it is also an open finding (tracked as public-manifest exposure) and must not be migrated before that is settled",
      "data/stockanalysis/canary": "publication canary with no declared consumer; migrating a probe artifact would make the probe part of the payload it probes",
      "data/stockanalysis/classification": "shared classification lookup consumed across the whole StockAnalysis family, not an ETF detail acquisition output",
      "data/stockanalysis/coverage": "coverage accounting for the family as a whole; it describes the payload rather than being payload",
      "data/stockanalysis/index.json": "family index spanning all StockAnalysis lanes",
      "data/stockanalysis/README.md": "documentation, not payload",
      "data/stockanalysis/schema.json": "family schema contract, consumed by readers of every lane in the family",
      "data/stockanalysis/surface_consumers.json": "surface consumer declaration for the surfaces lane, not ETF detail payload",
    }),
  }),
  global_scouter: Object.freeze({
    id: "global_scouter",
    // The owner-run export is a family with three individually declared core
    // files plus whole directory outputs. The four workflow-derived core
    // outputs are deliberately excluded here: they already have their own
    // materialization routes and were closed as a separate canonical-only
    // slice.
    classification_roots: Object.freeze(["data/global-scouter"]),
    derived_public_projection_roots: Object.freeze([
      Object.freeze({
        path: "100xfenok-next/public/data/global-scouter/core/stocks_analyzer.json",
        kind: "materialized_file",
        migrates: false,
        reason: "derived by the stocks-analyzer workflow and restored by its exact Update Manifest route; measured separately from the owner-run export",
      }),
      Object.freeze({
        path: "100xfenok-next/public/data/global-scouter/core/per_bands_index.json",
        kind: "materialized_file",
        migrates: false,
        reason: "derived by the stocks-analyzer workflow and restored by its exact Update Manifest route; measured separately from the owner-run export",
      }),
      Object.freeze({
        path: "100xfenok-next/public/data/global-scouter/core/slick_index.json",
        kind: "materialized_file",
        migrates: false,
        reason: "derived by the stocks-analyzer workflow and restored by its exact Update Manifest route; measured separately from the owner-run export",
      }),
      Object.freeze({
        path: "100xfenok-next/public/data/global-scouter/core/revision_movers.json",
        kind: "materialized_file",
        migrates: false,
        reason: "derived by the revision-movers workflow and restored by its exact Update Manifest route; measured separately from the owner-run export",
      }),
    ]),
    declared_exclusions: Object.freeze({
      "data/global-scouter/core/stocks_analyzer.json": "workflow-derived core output already governed by a separate exact materialization route",
      "data/global-scouter/core/per_bands_index.json": "workflow-derived core output already governed by a separate exact materialization route",
      "data/global-scouter/core/slick_index.json": "workflow-derived core output already governed by a separate exact materialization route",
      "data/global-scouter/core/revision_movers.json": "workflow-derived core output already governed by a separate exact materialization route",
    }),
  }),
});

export function candidateScopeIds() {
  return Object.keys(CANDIDATE_SCOPES).sort();
}

/**
 * Content identity for the included roots.
 *
 * Deliberately separate from `path_digest`, which covers path plus byte size so
 * that the routine budget check stays cheap. Path-and-size cannot see a
 * same-size content replacement, so anything that will be kept as evidence needs
 * this instead. It reads every included byte, so it is opt-in rather than part of
 * the ordinary scope build.
 */
export function computeCandidateContentDigest({ repoRoot, candidateId, laneRegistry = LANE_REGISTRY } = {}) {
  const { manifest } = buildCandidateScope({ repoRoot, candidateId, laneRegistry });
  const rows = [];
  for (const root of manifest.included_canonical_roots) {
    const absoluteRoot = path.join(repoRoot, root.path);
    const walk = (current) => {
      const stat = fs.lstatSync(current);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current).sort()) walk(path.join(current, entry));
        return;
      }
      const relative = path.relative(repoRoot, current);
      rows.push(`${relative}:${createHash("sha256").update(fs.readFileSync(current)).digest("hex")}`);
    };
    walk(absoluteRoot);
  }
  return {
    mode: "content_sha256",
    file_count: rows.length,
    digest: createHash("sha256").update(rows.join("\n")).digest("hex"),
  };
}

function listDirEntries(absoluteRoot) {
  if (!fs.existsSync(absoluteRoot)) return [];
  const stat = fs.lstatSync(absoluteRoot);
  if (!stat.isDirectory()) fail(`classification root is not a directory: ${absoluteRoot}`);
  return fs.readdirSync(absoluteRoot).sort();
}

// Walks a root and returns count, bytes, and a content-independent path digest.
// The digest covers relative path plus byte size, not file content: the scope
// contract is about which bytes move and how many, and a content digest over a
// gigabyte of payload would make the check too slow to run on every review.
function measureRoot(repoRoot, relativeRoot) {
  const absolute = path.join(repoRoot, relativeRoot);
  if (!fs.existsSync(absolute)) fail(`included root is absent: ${relativeRoot}`);
  const rows = [];
  let bytes = 0;
  const walk = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail(`symlink inside included root: ${path.relative(repoRoot, current)}`);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current).sort()) walk(path.join(current, entry));
      return;
    }
    if (!stat.isFile()) fail(`non-regular file inside included root: ${path.relative(repoRoot, current)}`);
    const relative = path.relative(repoRoot, current);
    rows.push(`${relative}:${stat.size}`);
    bytes += stat.size;
  };
  walk(absolute);
  return {
    path: relativeRoot,
    file_count: rows.length,
    bytes,
    digest: createHash("sha256").update(rows.join("\n")).digest("hex"),
  };
}

function ownedCanonicalRoots(laneRegistry) {
  const owners = new Map();
  for (const lane of laneRegistry.lanes) {
    for (const root of lane.roots?.canonical_outputs ?? []) {
      if (owners.has(root)) fail(`canonical root declared by two lanes: ${root}`);
      owners.set(root, lane.id);
    }
  }
  return owners;
}

export function buildCandidateScope({
  repoRoot,
  candidateId,
  laneRegistry = LANE_REGISTRY,
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) fail("repoRoot is required");
  const scope = CANDIDATE_SCOPES[candidateId];
  if (!scope) fail(`unknown candidate: ${candidateId}`);

  const lane = registryLaneById(candidateId);
  if (!lane) fail(`candidate has no lane record: ${candidateId}`);

  // The include set is the lane's declared canonical outputs. It is never taken
  // from this module's own table, so a registry change moves the scope with it.
  const includedRoots = [...(lane.roots?.canonical_outputs ?? [])].sort();
  if (includedRoots.length === 0) fail(`candidate lane declares no canonical outputs: ${candidateId}`);

  const owners = ownedCanonicalRoots(laneRegistry);
  for (const root of includedRoots) {
    const owner = owners.get(root);
    if (owner !== candidateId) {
      fail(`included root ${root} is owned by ${owner ?? "no lane"}, not ${candidateId}`);
    }
  }

  const measured = includedRoots.map((root) => measureRoot(repoRoot, root));
  const fileCount = measured.reduce((sum, row) => sum + row.file_count, 0);
  const bytes = measured.reduce((sum, row) => sum + row.bytes, 0);

  // Fail-closed classification. Every direct child of each classification root is
  // one of: part of this candidate, owned by a named other lane, or excluded with
  // a written reason. Anything else stops the build.
  const excluded = [];
  const unclassified = [];
  const includedRootSet = new Set(includedRoots);
  const classificationRootSet = new Set(scope.classification_roots);
  const isContainerOfDeclaredPath = (relative) => (
    includedRoots.some((root) => root.startsWith(`${relative}/`))
    || scope.classification_roots.some((root) => root.startsWith(`${relative}/`))
  );
  const classify = (relative) => {
    if (includedRootSet.has(relative)) return;
    const otherOwner = owners.get(relative);
    if (otherOwner) {
      excluded.push({ path: relative, class: "other_lane_owned", owner_lane: otherOwner, reason: `declared canonical output of lane ${otherOwner}` });
      return;
    }
    const declared = scope.declared_exclusions[relative];
    if (declared) {
      excluded.push({ path: relative, class: "declared_exclusion", owner_lane: null, reason: declared });
      return;
    }
    if (isContainerOfDeclaredPath(relative)) {
      for (const entry of listDirEntries(path.join(repoRoot, relative))) {
        classify(`${relative}/${entry}`);
      }
      return;
    }
    unclassified.push(relative);
  };
  for (const classificationRoot of classificationRootSet) {
    for (const entry of listDirEntries(path.join(repoRoot, classificationRoot))) {
      classify(`${classificationRoot}/${entry}`);
    }
  }
  if (unclassified.length > 0) {
    fail(`unclassified paths under the candidate family (add an owner or a written exclusion reason): ${unclassified.join(", ")}`);
  }

  // A recorded exclusion for a path that no longer exists is stale bookkeeping and
  // is treated as a defect, so the table cannot rot into a list of reasons for
  // things that are already gone.
  const presentPaths = new Set(excluded.map((row) => row.path));
  const staleReasons = Object.keys(scope.declared_exclusions).filter((row) => !presentPaths.has(row));
  if (staleReasons.length > 0) fail(`declared exclusion no longer present on disk: ${staleReasons.join(", ")}`);

  excluded.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const manifest = {
    schema_version: CANDIDATE_SCOPE_SCHEMA,
    candidate_id: candidateId,
    owner: {
      lane_id: lane.id,
      lane_label: lane.label,
      owner_workflow: lane.owner_workflow,
      enforcement: lane.enforcement,
    },
    included_canonical_roots: measured,
    derived_public_projection_roots: scope.derived_public_projection_roots.map((row) => ({ ...row })),
    excluded,
    totals: { file_count: fileCount, bytes },
  };
  manifest.path_digest = createHash("sha256")
    .update(canonicalJson({
      included: measured.map((row) => ({ path: row.path, digest: row.digest })),
      excluded: excluded.map((row) => row.path),
    }))
    .digest("hex");

  return {
    manifest,
    // Shaped exactly like the estate inventory the budget calculator already
    // consumes, so the same calculator runs unchanged against a scoped input.
    inventory: {
      complete: true,
      file_count: fileCount,
      bytes,
      digest: manifest.path_digest,
    },
  };
}
