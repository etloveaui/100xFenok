import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson } from "./json-canonical.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./data-supply-detection-config.mjs";
import { DERIVED_ASSET_REGISTRY } from "./derived-asset-registry.mjs";
import { OWNERSHIP_REGISTRY, RETENTION_REGISTRY } from "./cloud-data-plane-retention-registry.mjs";
import { buildCandidateScope } from "./cloud-data-plane-candidate-scope.mjs";
import { LANE_REGISTRY } from "./lane-registry.mjs";

export const CLOUD_DATA_PLANE_REPORT_SCHEMA = "cloud-data-plane-budget/v1";
export const CLOUD_DATA_PLANE_MONTH_DAYS = 30;
export const CLOUD_DATA_PLANE_VERDICTS = Object.freeze(["pass", "not_verified", "fail"]);

export const DEFAULT_CLOUD_DATA_PLANE_POLICY = deepFreeze({
  schema_version: "cloud-data-plane-policy/v1",
  status: "verified",
  verified_on: "2026-07-30",
  scope: "cloudflare-free-plan-official-limits",
  period: "monthly-limits-with-daily-operation-limits",
  r2: {
    hard_limit: {
      decimal_gb_month: 10,
      class_a_operations_per_month: 1_000_000,
      class_b_operations_per_month: 10_000_000,
    },
    planning_line: {
      decimal_gb_month: 8,
      class_a_operations_per_month: 800_000,
    },
  },
  d1: {
    hard_limit: {
      database_bytes: 500_000_000,
      account_bytes: 5_000_000_000,
      max_row_or_blob_bytes: 2_000_000,
      queries_per_worker_invocation: 50,
      rows_read_per_day: 5_000_000,
      rows_written_per_day: 100_000,
    },
    planning_line: {
      database_bytes: 400_000_000,
      account_bytes: 4_000_000_000,
      rows_read_per_day: 4_000_000,
      rows_written_per_day: 80_000,
    },
  },
  kv: {
    hard_limit: {
      stored_bytes: 1_000_000_000,
      max_pointer_bytes: 25 * 1024 * 1024,
      reads_per_day: 100_000,
      writes_per_day: 1_000,
    },
    planning_line: {
      writes_per_day: 800,
    },
  },
});

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(message) {
  throw new Error(`cloud-data-plane-budget: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digest(value) {
  return sha256(canonicalJson(value));
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function repoRelative(value, context) {
  if (typeof value !== "string"
    || value.length === 0
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("\\")
    || value.split("/").includes("..")) {
    fail(`${context} must be a normalized repo-relative path`);
  }
  return value;
}

function nonnegative(value, context) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${context} must be a finite non-negative number`);
  }
  return value;
}

function inferredKind(pathValue) {
  return path.posix.extname(pathValue) ? "file" : "directory";
}

function declaredOwnedRoots(laneRegistry, derivedRegistry) {
  const byPath = new Map();
  const folded = new Map();
  function declare(pathValue, kind, owner) {
    const normalized = repoRelative(pathValue, `${owner.kind} ${owner.id} output`);
    const fold = normalized.toLocaleLowerCase("en-US");
    const priorCase = folded.get(fold);
    if (priorCase !== undefined && priorCase !== normalized) {
      fail(`case-colliding declared roots: ${priorCase} and ${normalized}`);
    }
    folded.set(fold, normalized);
    const prior = byPath.get(normalized);
    if (prior) {
      if (prior.kind !== kind) fail(`duplicate root kind mismatch: ${normalized}`);
      if (prior.owners.some((entry) => entry.kind === owner.kind)) {
        fail(`false path ownership for ${normalized}: multiple ${owner.kind} owners`);
      }
      prior.owners.push(owner);
      return;
    }
    byPath.set(normalized, { path: normalized, kind, owners: [owner] });
  }
  for (const lane of laneRegistry.lanes) {
    for (const root of lane.roots.canonical_outputs) {
      const derivedKind = derivedRegistry.assets
        .flatMap((asset) => asset.outputs)
        .find((output) => output.path === root)?.kind;
      declare(root, derivedKind ?? inferredKind(root), { kind: "lane", id: lane.id });
    }
  }
  for (const asset of derivedRegistry.assets) {
    for (const output of asset.outputs) {
      declare(output.path, output.kind, { kind: "derived_asset", id: asset.id });
    }
  }
  const roots = [...byPath.values()]
    .map((entry) => ({
      ...entry,
      owners: entry.owners.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  for (let index = 0; index < roots.length; index += 1) {
    for (let cursor = index + 1; cursor < roots.length; cursor += 1) {
      if (roots[cursor].path.startsWith(`${roots[index].path}/`)) {
        fail(`nested root ownership overlap: ${roots[index].path} and ${roots[cursor].path}`);
      }
    }
  }
  return roots;
}

function insideRepo(repoRoot, relativePath) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) fail(`path escapes repository: ${relativePath}`);
  return absolute;
}

function collectRoot(repoRoot, declaration, globalFoldedFiles) {
  const absoluteRoot = insideRepo(repoRoot, declaration.path);
  if (!fs.existsSync(absoluteRoot)) {
    return {
      ...declaration,
      missing: true,
      file_count: 0,
      bytes: 0,
      digest: null,
    };
  }
  const rootStat = fs.lstatSync(absoluteRoot);
  if (rootStat.isSymbolicLink()) fail(`declared root is a symlink: ${declaration.path}`);
  if (declaration.kind === "file" && !rootStat.isFile()) fail(`declared file root is not a file: ${declaration.path}`);
  if (declaration.kind === "directory" && !rootStat.isDirectory()) fail(`declared directory root is not a directory: ${declaration.path}`);
  const files = [];
  function visit(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`owned root contains a symlink: ${relative}`);
    if (stat.isDirectory()) {
      const localNames = new Map();
      for (const name of fs.readdirSync(absolute).sort((left, right) => left.localeCompare(right))) {
        const fold = name.toLocaleLowerCase("en-US");
        if (localNames.has(fold) && localNames.get(fold) !== name) {
          fail(`case-colliding filesystem entries: ${relative}/${localNames.get(fold)} and ${relative}/${name}`);
        }
        localNames.set(fold, name);
        visit(path.join(absolute, name), `${relative}/${name}`);
      }
      return;
    }
    if (!stat.isFile()) fail(`owned root contains a non-file entry: ${relative}`);
    const fold = relative.toLocaleLowerCase("en-US");
    if (globalFoldedFiles.has(fold) && globalFoldedFiles.get(fold) !== relative) {
      fail(`case-colliding owned files: ${globalFoldedFiles.get(fold)} and ${relative}`);
    }
    globalFoldedFiles.set(fold, relative);
    files.push({ path: relative, bytes: stat.size });
  }
  if (declaration.kind === "file") visit(absoluteRoot, declaration.path);
  else {
    for (const name of fs.readdirSync(absoluteRoot).sort((left, right) => left.localeCompare(right))) {
      visit(path.join(absoluteRoot, name), `${declaration.path}/${name}`);
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    ...declaration,
    missing: false,
    file_count: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    digest: digest(files),
  };
}

/**
 * Retention widens what can be *declared*, not what can be *skipped*. An entry
 * without a reason is rejected, and an entry may not shadow a lane's own
 * canonical output — otherwise this would become a way to drop a served family
 * out of the canonical set without saying so.
 */
function normalizeRetention(registry, declarations, ownership = OWNERSHIP_REGISTRY) {
  const source = registry ?? RETENTION_REGISTRY;
  // Platform outputs, external artifacts, documentation and the
  // exposed-no-consumer hygiene queue are accounted for the same way retention
  // is — declared with a reason — but they are separate categories on purpose.
  // Folding them into retention would call serving data control-plane state, and
  // folding them into canonical ownership would claim a producer that does not
  // exist. The exposed-no-consumer bucket in particular is a question, not a
  // claim: it records that something is published with no reader found.
  const ownershipEntries = ["platform_outputs", "external_artifacts", "exposed_no_consumer", "documentation"]
    .flatMap((category) => (Array.isArray(ownership?.[category]) ? ownership[category] : []));
  const retained = [...(Array.isArray(source?.retained) ? source.retained : []), ...ownershipEntries];
  const optional = Array.isArray(source?.optional_paths) ? source.optional_paths : [];
  const declaredPaths = new Set(declarations.map((entry) => entry.path));
  const check = (entry, label) => {
    if (!plainObject(entry) || typeof entry.path !== "string" || entry.path.length === 0) {
      fail(`${label} entry requires a path`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      fail(`${label} ${entry.path} requires a non-empty reason`);
    }
    return repoRelative(entry.path, `${label} ${entry.path}`);
  };
  const retainedPaths = retained.map((entry) => {
    const normalized = check(entry, "retention");
    if (declaredPaths.has(normalized)) {
      fail(`retention entry ${normalized} shadows a declared canonical output`);
    }
    return normalized;
  });
  const optionalPaths = optional.map((entry) => check(entry, "optional path"));
  return { retainedPaths, optionalPaths: new Set(optionalPaths) };
}

function scanDataEstate(repoRoot, declarations, retainedPaths = []) {
  const dataRoot = insideRepo(repoRoot, "data");
  if (!fs.existsSync(dataRoot) || !fs.lstatSync(dataRoot).isDirectory()) fail("data root is missing");
  const files = [];
  const folded = new Map();
  function visit(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`data estate contains a symlink: ${relative}`);
    if (stat.isDirectory()) {
      const localNames = new Map();
      for (const name of fs.readdirSync(absolute).sort((left, right) => left.localeCompare(right))) {
        const fold = name.toLocaleLowerCase("en-US");
        if (localNames.has(fold) && localNames.get(fold) !== name) {
          fail(`case-colliding data entries: ${relative}/${localNames.get(fold)} and ${relative}/${name}`);
        }
        localNames.set(fold, name);
        visit(path.join(absolute, name), `${relative}/${name}`);
      }
      return;
    }
    if (!stat.isFile()) fail(`data estate contains a non-file entry: ${relative}`);
    const fold = relative.toLocaleLowerCase("en-US");
    if (folded.has(fold) && folded.get(fold) !== relative) {
      fail(`case-colliding data files: ${folded.get(fold)} and ${relative}`);
    }
    folded.set(fold, relative);
    const owner = declarations.find((root) => root.kind === "file"
      ? root.path === relative
      : relative.startsWith(`${root.path}/`));
    const retainedBy = owner
      ? null
      : retainedPaths.find((root) => relative === root || relative.startsWith(`${root}/`)) ?? null;
    files.push({
      path: relative,
      bytes: stat.size,
      declared: owner !== undefined,
      retained: retainedBy,
    });
  }
  for (const name of fs.readdirSync(dataRoot).sort((left, right) => left.localeCompare(right))) {
    visit(path.join(dataRoot, name), `data/${name}`);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const declaredFiles = files.filter((file) => file.declared);
  // Retained files are accounted for but deliberately kept out of declared
  // coverage: counting control-plane state as canonical would overstate what the
  // product actually serves and pull it into the migration scope.
  const retainedFiles = files.filter((file) => !file.declared && file.retained !== null);
  const unownedFiles = files.filter((file) => !file.declared && file.retained === null);
  const groupMap = new Map();
  for (const file of unownedFiles) {
    const group = file.path.split("/")[1] ?? "<root>";
    const entry = groupMap.get(group) ?? { group, file_count: 0, bytes: 0, records: [] };
    entry.file_count += 1;
    entry.bytes += file.bytes;
    entry.records.push({ path: file.path, bytes: file.bytes });
    groupMap.set(group, entry);
  }
  const topLevelGroups = [...groupMap.values()]
    .map(({ records, ...entry }) => ({ ...entry, digest: digest(records) }))
    .sort((left, right) => left.group.localeCompare(right.group));
  const summarize = (records) => ({
    file_count: records.length,
    bytes: records.reduce((sum, file) => sum + file.bytes, 0),
    digest: digest(records.map(({ path: filePath, bytes }) => ({ path: filePath, bytes }))),
  });
  return {
    total: summarize(files),
    declared: summarize(declaredFiles),
    retained: summarize(retainedFiles),
    unowned: {
      ...summarize(unownedFiles),
      top_level_groups: topLevelGroups,
    },
  };
}

export function inventoryCloudDataPlaneRoots({
  repoRoot,
  laneRegistry = LANE_REGISTRY,
  derivedRegistry = DERIVED_ASSET_REGISTRY,
  retentionRegistry = RETENTION_REGISTRY,
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) fail("repoRoot is required");
  const foldedFiles = new Map();
  const declarations = declaredOwnedRoots(laneRegistry, derivedRegistry);
  const retention = normalizeRetention(retentionRegistry, declarations);
  const roots = declarations
    .map((declaration) => collectRoot(repoRoot, declaration, foldedFiles));
  // A root declared optional is allowed to be absent: some scrapers only run on
  // an explicit manual selection, so absence is the normal state rather than a
  // lost artifact. Every other absence still fails.
  const absentRoots = roots.filter((root) => root.missing).map((root) => root.path);
  const optionalAbsent = absentRoots.filter((rootPath) => retention.optionalPaths.has(rootPath));
  const missingPaths = absentRoots.filter((rootPath) => !retention.optionalPaths.has(rootPath));
  const estate = scanDataEstate(repoRoot, declarations, retention.retainedPaths);
  const complete = missingPaths.length === 0 && estate.unowned.file_count === 0;
  const declaredCoverage = {
    file_count: estate.declared.file_count,
    bytes: estate.declared.bytes,
    file_share: estate.total.file_count === 0 ? 1 : estate.declared.file_count / estate.total.file_count,
    byte_share: estate.total.bytes === 0 ? 1 : estate.declared.bytes / estate.total.bytes,
  };
  return {
    complete,
    file_count: estate.total.file_count,
    bytes: estate.total.bytes,
    digest: estate.total.digest,
    missing_paths: missingPaths,
    optional_absent: optionalAbsent,
    declared: estate.declared,
    retained: estate.retained,
    declared_coverage: declaredCoverage,
    unowned: estate.unowned,
    roots,
  };
}

function detectionMap(config) {
  const result = new Map();
  for (const lane of config.lanes) {
    if (result.has(lane.id)) fail(`duplicate detection lane ${lane.id}`);
    result.set(lane.id, lane);
  }
  return result;
}

function readDataHealthKpi(repoRoot, supplied) {
  if (supplied !== undefined) return supplied;
  const kpiPath = path.join(repoRoot, "data", "admin", "fenok-data-health-kpi.json");
  if (!fs.existsSync(kpiPath)) return null;
  return JSON.parse(fs.readFileSync(kpiPath, "utf8"));
}

function dataHealthLaneMap(kpi) {
  const result = new Map();
  for (const lane of Array.isArray(kpi?.lanes) ? kpi.lanes : []) {
    if (typeof lane?.id !== "string") fail("data health KPI lane id is invalid");
    if (result.has(lane.id)) fail(`duplicate data health KPI lane ${lane.id}`);
    result.set(lane.id, lane);
  }
  return result;
}

function transitiveLanes(assetId, assetById, memo, visiting = [], historical = false) {
  if (!historical && memo.has(assetId)) return memo.get(assetId);
  if (visiting.includes(assetId)) {
    if (historical) return new Set();
    fail(`derived asset cycle: ${[...visiting, assetId].join(" -> ")}`);
  }
  const asset = assetById.get(assetId);
  if (!asset) fail(`unknown derived asset ${assetId}`);
  const laneIds = new Set();
  for (const input of asset.inputs) {
    if (input.kind === "lane") laneIds.add(input.ref);
    if (input.kind === "asset" || input.kind === "prior_asset") {
      const nextHistorical = historical || input.kind === "prior_asset";
      for (const laneId of transitiveLanes(
        input.ref,
        assetById,
        memo,
        [...visiting, assetId],
        nextHistorical,
      )) laneIds.add(laneId);
    }
  }
  if (!historical) memo.set(assetId, laneIds);
  return laneIds;
}

function rootInventoryFor(ownerKind, ownerId, inventory) {
  return inventory.roots
    .filter((root) => root.owners.some((owner) => owner.kind === ownerKind && owner.id === ownerId))
    .map(({ owners: _owners, ...root }) => root);
}

export function buildCloudDataPlaneCatalog({
  repoRoot,
  laneRegistry = LANE_REGISTRY,
  derivedRegistry = DERIVED_ASSET_REGISTRY,
  detectionConfig = DATA_SUPPLY_DETECTION_CONFIG,
  dataHealthKpi,
} = {}) {
  const inventory = inventoryCloudDataPlaneRoots({ repoRoot, laneRegistry, derivedRegistry });
  const detection = detectionMap(detectionConfig);
  const kpi = readDataHealthKpi(repoRoot, dataHealthKpi);
  const healthByLane = dataHealthLaneMap(kpi);
  const laneById = new Map(laneRegistry.lanes.map((lane) => [lane.id, lane]));
  const assetById = new Map(derivedRegistry.assets.map((asset) => [asset.id, asset]));
  const memo = new Map();
  const derivedAssets = derivedRegistry.assets.map((asset) => {
    const laneIds = [...transitiveLanes(asset.id, assetById, memo)].sort();
    if (asset.lifecycle === "active" && laneIds.length === 0) fail(`active derived asset has no transitive lane: ${asset.id}`);
    const providerIds = new Set();
    for (const laneId of laneIds) {
      const lane = laneById.get(laneId);
      if (!lane) fail(`derived asset ${asset.id} references unknown lane ${laneId}`);
      for (const ref of lane.provider_refs) providerIds.add(ref.provider_id);
    }
    const sourceStates = laneIds.map((laneId) => {
      const health = healthByLane.get(laneId);
      return health === undefined
        ? { id: laneId, status: "not_verified", as_of: null, deployment_blocking: null }
        : {
            id: laneId,
            status: health.status ?? "not_verified",
            as_of: health.as_of ?? null,
            deployment_blocking: health.deployment_blocking ?? null,
          };
    });
    const expectedArrivalStatus = asset.lifecycle === "active"
      && laneIds.length > 0
      && laneIds.every((laneId) => detection.has(laneId))
      ? "verified"
      : "not_verified";
    const currentStatus = asset.lifecycle === "active"
      && sourceStates.every((state) => state.status !== "not_verified")
      ? "verified"
      : "not_verified";
    return {
      id: asset.id,
      category: "derived",
      lifecycle: asset.lifecycle,
      provider_ids: [...providerIds].sort(),
      lane_ids: laneIds,
      owner_workflow: asset.owner_workflow,
      writer: asset.writer,
      inputs: asset.inputs,
      cadence: asset.cadence,
      privacy_class: asset.privacy_class,
      public_serving_status: asset.public_serving_status,
      serving_paths: asset.public_outputs,
      retention: asset.retention,
      recovery: asset.recovery,
      recovery_evidence: asset.recovery_evidence,
      retention_recovery_status: asset.lifecycle === "active" ? "verified" : "not_verified",
      expected_arrival: {
        status: expectedArrivalStatus,
        source_lane_ids: laneIds,
        cadence: asset.cadence,
      },
      current_state: {
        status: currentStatus,
        source_lanes: sourceStates,
      },
      completeness_status: expectedArrivalStatus === "verified"
        && currentStatus === "verified"
        && asset.lifecycle === "active"
        ? "verified"
        : "not_verified",
      output_inventory: rootInventoryFor("derived_asset", asset.id, inventory),
    };
  });
  const derivedByLane = new Map(laneRegistry.lanes.map((lane) => [lane.id, []]));
  for (const asset of derivedAssets) for (const laneId of asset.lane_ids) derivedByLane.get(laneId).push(asset.id);
  const lanes = laneRegistry.lanes.map((lane) => {
    const detectionLane = detection.get(lane.id) ?? null;
    const currentStatus = healthByLane.get(lane.id)?.status ?? "not_verified";
    const recoveryStatus = lane.recovery_store !== null || lane.store_kind === "artifact_only"
      ? "verified"
      : "not_verified";
    const expectedArrivalStatus = detectionLane === null ? "not_verified" : "verified";
    return {
      id: lane.id,
      category: lane.lane_class,
      owner_workflow: lane.owner_workflow,
      privacy_class: lane.privacy_class,
      provider_ids: [...new Set(lane.provider_refs.map((ref) => ref.provider_id))].sort(),
      derived_asset_ids: derivedByLane.get(lane.id).sort(),
      roots: lane.roots,
      serving_paths: lane.roots.public_mirror,
      recovery_store: lane.recovery_store,
      retention_recovery: {
        retention_status: recoveryStatus,
        recovery_status: recoveryStatus,
        policy: lane.recovery_store === null ? "source_owned" : "current_plus_lane_recovery_store",
      },
      enforcement: lane.enforcement,
      current_state: {
        status: currentStatus,
        as_of: healthByLane.get(lane.id)?.as_of ?? null,
        deployment_blocking: healthByLane.get(lane.id)?.deployment_blocking ?? null,
        required: healthByLane.get(lane.id)?.required ?? null,
        evidence: healthByLane.has(lane.id) ? "data_health_kpi" : "not_verified",
      },
      expected_arrival: detectionLane === null
        ? { producer_members: [], registry_cadence: lane.cadence, status: expectedArrivalStatus }
        : {
            producer_members: detectionLane.producer_members.map((member) => ({
              id: member.id,
              schedule: member.schedule,
              cadence_calendar: member.cadence_calendar,
              cadence_declaration: member.cadence_declaration,
            })),
            registry_cadence: lane.cadence,
            status: expectedArrivalStatus,
          },
      freshness: detectionLane?.freshness ?? null,
      completeness_status: expectedArrivalStatus === "verified"
        && currentStatus !== "not_verified"
        && recoveryStatus === "verified"
        ? "verified"
        : "not_verified",
      root_inventory: rootInventoryFor("lane", lane.id, inventory),
    };
  });
  const providers = laneRegistry.providers.map((provider) => ({
    id: provider.id,
    class: provider.class,
    lane_ids: lanes.filter((lane) => lane.provider_ids.includes(provider.id)).map((lane) => lane.id),
    derived_asset_ids: derivedAssets
      .filter((asset) => asset.provider_ids.includes(provider.id))
      .map((asset) => asset.id),
  }));
  const catalogVerdict = inventory.complete
    && lanes.every((lane) => lane.completeness_status === "verified")
    && derivedAssets.every((asset) => asset.completeness_status === "verified")
    ? "pass"
    : "not_verified";
  return {
    source_digests: {
      lane_registry: digest(laneRegistry),
      derived_asset_registry: digest(derivedRegistry),
      data_supply_detection_config: digest(detectionConfig),
      data_health_kpi: kpi === null ? null : digest(kpi),
    },
    providers,
    lanes,
    derived_assets: derivedAssets,
    inventory: {
      complete: inventory.complete,
      file_count: inventory.file_count,
      bytes: inventory.bytes,
      digest: inventory.digest,
      missing_paths: inventory.missing_paths,
      optional_absent: inventory.optional_absent,
      declared: inventory.declared,
      declared_coverage: inventory.declared_coverage,
      retained: inventory.retained,
      unowned: inventory.unowned,
    },
    verdict: catalogVerdict,
  };
}

function provenance(value, absentSchema) {
  const object = plainObject(value) ? value : null;
  return {
    digest: object === null ? null : digest(object),
    schema_version: object?.schema_version ?? absentSchema,
    status: object?.status ?? "not_verified",
    verified_on: object?.verified_on ?? null,
    scope: object?.scope ?? null,
    period: object?.period ?? null,
  };
}

function inputVerified(value) {
  return plainObject(value)
    && value.status === "verified"
    && typeof value.schema_version === "string"
    && typeof value.verified_on === "string"
    && typeof value.scope === "string"
    && typeof value.period === "string";
}

function exactKeys(value, expected, context) {
  if (!plainObject(value)) fail(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(required)) {
    fail(`${context} keys must be exactly ${required.join(",")}`);
  }
}

/**
 * Planning thresholds for a candidate-scoped run.
 *
 * Owner decision 2026-08-14: govern the metrics this candidate actually uses
 * rather than completing the estate-wide policy or declaring hard-limit-only.
 * The estate policy is untouched and its six gaps stay visible as non-gating
 * findings; this applies only when a candidate scope is in force. Corrected from
 * "nine" on 2026-08-15: the code produces six — R2 class B; D1 max row/blob and
 * queries per invocation; KV stored bytes, max pointer bytes and reads per day —
 * matching the prose in cloud-data-plane-candidate-gate.mjs. The nine was a
 * comment only, and it had been copied into the project's task record.
 *
 * The thresholds are not invented: every one is 80% of the same hard limit the
 * estate policy already uses, which is the ratio that policy itself applies to
 * the two metrics it does govern (8 of 10 GB-month, 800,000 of 1,000,000 Class
 * A). Extending an existing ratio to the metrics it had skipped is a different
 * act from picking numbers, and it keeps the two policies commensurable.
 */
export const CANDIDATE_PLANNING_POLICY = deepFreeze({
  schema_version: "cloud-data-plane-candidate-planning/v1",
  derived_from: "0.8 x the pinned hard limit, the ratio the estate planning line already applies",
  r2: {
    decimal_gb_month: 8,
    class_a_operations_per_month: 800_000,
    class_b_operations_per_month: 8_000_000,
  },
  d1: {
    database_bytes: 400_000_000,
    account_bytes: 400_000_000,
    rows_read_per_day: 4_000_000,
    rows_written_per_day: 80_000,
    max_row_or_blob_bytes: 1_600_000,
    queries_per_worker_invocation: 40,
  },
  kv: {
    stored_bytes: 800_000_000,
    reads_per_day: 80_000,
    writes_per_day: 800,
    max_pointer_bytes: 20_000_000,
  },
});

/**
 * Every metric the candidate policy governs must exist and must not exceed the
 * hard limit it was derived from. Without this the policy could silently govern
 * a metric the report does not produce, which reads as coverage and is not.
 */
export function validateCandidatePlanningPolicy(policy = CANDIDATE_PLANNING_POLICY) {
  for (const service of ["r2", "d1", "kv"]) {
    const hard = DEFAULT_CLOUD_DATA_PLANE_POLICY[service].hard_limit;
    for (const [key, value] of Object.entries(policy[service] ?? {})) {
      const ceiling = hard[key];
      if (ceiling === undefined) fail(`candidate policy governs unknown metric ${service}.${key}`);
      if (!(value > 0) || value > ceiling) fail(`candidate policy ${service}.${key} must be positive and at most the hard limit ${ceiling}`);
    }
  }
  return true;
}

export function validateCloudDataPlanePolicy(policy) {
  if (!inputVerified(policy)) fail("policy provenance is not verified");
  if (policy.schema_version !== DEFAULT_CLOUD_DATA_PLANE_POLICY.schema_version) {
    fail(`policy schema must be ${DEFAULT_CLOUD_DATA_PLANE_POLICY.schema_version}`);
  }
  for (const service of ["r2", "d1", "kv"]) {
    exactKeys(policy[service], ["hard_limit", "planning_line"], `policy.${service}`);
    const pinnedHard = DEFAULT_CLOUD_DATA_PLANE_POLICY[service].hard_limit;
    exactKeys(policy[service].hard_limit, Object.keys(pinnedHard), `policy.${service}.hard_limit`);
    for (const [key, pinnedValue] of Object.entries(pinnedHard)) {
      if (policy[service].hard_limit[key] !== pinnedValue) {
        fail(`policy.${service}.hard_limit.${key} must equal pinned value ${pinnedValue}`);
      }
    }
    const pinnedPlanning = DEFAULT_CLOUD_DATA_PLANE_POLICY[service].planning_line;
    exactKeys(policy[service].planning_line, Object.keys(pinnedPlanning), `policy.${service}.planning_line`);
    for (const [key, pinnedValue] of Object.entries(pinnedPlanning)) {
      const value = nonnegative(policy[service].planning_line[key], `policy.${service}.planning_line.${key}`);
      if (value > pinnedValue) {
        fail(`policy.${service}.planning_line.${key} cannot exceed pinned value ${pinnedValue}`);
      }
    }
  }
  return true;
}

function numberAt(value, key) {
  const result = value?.[key];
  return typeof result === "number" && Number.isFinite(result) && result >= 0 ? result : null;
}

function metric(lowerBound, complete) {
  return { lower_bound: lowerBound, complete };
}

function addMetric(baseline, demand, baselineKey, demandKey = baselineKey, verified = false) {
  const left = numberAt(baseline, baselineKey);
  const right = numberAt(demand, demandKey);
  return metric((left ?? 0) + (right ?? 0), verified && left !== null && right !== null);
}

function maxMetric(baseline, demand, key, verified = false) {
  const left = numberAt(baseline, key);
  const right = numberAt(demand, key);
  return metric(Math.max(left ?? 0, right ?? 0), verified && left !== null && right !== null);
}

function evaluate(metrics, limits) {
  if (!plainObject(limits)) return { verdict: "not_verified", checks: {} };
  const checks = {};
  let missing = false;
  let exceeded = false;
  for (const key of Object.keys(limits).sort()) {
    const limit = nonnegative(limits[key], `policy limit ${key}`);
    if (!metrics[key]) fail(`policy references unknown metric ${key}`);
    const isExceeded = metrics[key].lower_bound > limit;
    checks[key] = {
      lower_bound: metrics[key].lower_bound,
      complete: metrics[key].complete,
      limit,
      verdict: isExceeded ? "fail" : metrics[key].complete ? "pass" : "not_verified",
    };
    exceeded ||= isExceeded;
    missing ||= !metrics[key].complete;
  }
  // Which metrics this limit set actually governs. A metric the policy does not
  // mention is not "passing" here — it is ungoverned, and saying so is the
  // difference between an honest partial pass and a green light that quietly
  // covers less than the reader assumes.
  const governed = Object.keys(limits).sort();
  const ungoverned = Object.keys(metrics).sort().filter((key) => !governed.includes(key));
  const verdict = exceeded ? "fail" : missing ? "not_verified" : "pass";
  return {
    verdict,
    checks,
    coverage: {
      governed,
      ungoverned,
      complete: ungoverned.length === 0,
      // Named so a reader never has to infer scope from the verdict alone.
      label: ungoverned.length === 0 ? verdict : `${verdict}_partial_coverage`,
    },
  };
}

function combine(verdicts) {
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("not_verified")) return "not_verified";
  return "pass";
}

function evaluateD1TableContracts(baselineRows, demandTables, inputsVerified) {
  const baseline = plainObject(baselineRows) ? baselineRows : {};
  if (!Array.isArray(demandTables)) {
    return {
      tables: [],
      complete: false,
      verdict: "not_verified",
      rows_read_per_day: 0,
      rows_written_per_day: 0,
      purge_rows_per_day: 0,
    };
  }
  const seen = new Set();
  let exceeded = false;
  let incomplete = !inputsVerified || !plainObject(baselineRows);
  let rowsRead = 0;
  let rowsWritten = 0;
  let purgeRows = 0;
  const tables = demandTables.map((contract) => {
    if (!plainObject(contract) || typeof contract.id !== "string" || contract.id.length === 0) {
      fail("D1 table contract id is required");
    }
    if (seen.has(contract.id)) fail(`duplicate D1 table contract ${contract.id}`);
    seen.add(contract.id);
    const fields = [
      "added_rows",
      "max_rows",
      "retention_days",
      "purge_batch_rows",
      "rows_read_per_day",
      "logical_writes_per_day",
      "index_read_amplification",
      "index_write_amplification",
    ];
    const values = Object.fromEntries(fields.map((field) => [field, numberAt(contract, field)]));
    const baselineValue = numberAt(baseline, contract.id);
    const complete = inputsVerified
      && baselineValue !== null
      && Object.values(values).every((value) => value !== null)
      && values.retention_days >= 1
      && values.max_rows >= 1
      && values.index_read_amplification >= 1
      && values.index_write_amplification >= 1;
    incomplete ||= !complete;
    const actualRows = (baselineValue ?? 0) + (values.added_rows ?? 0);
    const rowExceeded = values.max_rows !== null && actualRows > values.max_rows;
    exceeded ||= rowExceeded;
    rowsRead += (values.rows_read_per_day ?? 0) * (values.index_read_amplification ?? 0);
    rowsWritten += ((values.logical_writes_per_day ?? 0) + (values.purge_batch_rows ?? 0))
      * (values.index_write_amplification ?? 0);
    purgeRows += values.purge_batch_rows ?? 0;
    return {
      id: contract.id,
      baseline_rows: baselineValue ?? 0,
      added_rows: values.added_rows ?? 0,
      projected_rows: actualRows,
      max_rows: values.max_rows ?? 0,
      retention_days: values.retention_days ?? 0,
      purge_batch_rows: values.purge_batch_rows ?? 0,
      rows_read_per_day: values.rows_read_per_day ?? 0,
      logical_writes_per_day: values.logical_writes_per_day ?? 0,
      index_read_amplification: values.index_read_amplification ?? 0,
      index_write_amplification: values.index_write_amplification ?? 0,
      verdict: rowExceeded ? "fail" : complete ? "pass" : "not_verified",
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return {
    tables,
    complete: !incomplete,
    verdict: exceeded ? "fail" : incomplete ? "not_verified" : "pass",
    rows_read_per_day: rowsRead,
    rows_written_per_day: rowsWritten,
    purge_rows_per_day: purgeRows,
  };
}

export function calculateCloudDataPlaneBudget({
  inventory,
  accountBaseline = null,
  requestDemand = null,
  policy = DEFAULT_CLOUD_DATA_PLANE_POLICY,
  candidatePlanning = null,
} = {}) {
  if (candidatePlanning) validateCandidatePlanningPolicy(candidatePlanning);
  if (!plainObject(inventory)) fail("inventory must be an object");
  const currentBytes = nonnegative(inventory.bytes, "inventory.bytes");
  const currentObjects = nonnegative(inventory.file_count, "inventory.file_count");
  const inventoryComplete = inventory.complete === true;
  const baselineVerified = inputVerified(accountBaseline);
  const demandVerified = inputVerified(requestDemand);
  const policyVerified = validateCloudDataPlanePolicy(policy);
  const inputsVerified = baselineVerified && demandVerified;

  const r2Baseline = accountBaseline?.r2 ?? null;
  const r2Demand = requestDemand?.r2 ?? null;
  const unrelatedStorageByteDays = numberAt(r2Baseline, "unrelated_storage_byte_days");
  const unrelatedObjects = numberAt(r2Baseline, "unrelated_objects");
  const slots = {
    current: { bytes: currentBytes, objects: currentObjects, complete: inventoryComplete },
    previous: { bytes: currentBytes, objects: currentObjects, complete: inventoryComplete },
    in_progress: { bytes: currentBytes, objects: currentObjects, complete: inventoryComplete },
  };
  const unrelatedComplete = baselineVerified
    && unrelatedStorageByteDays !== null
    && unrelatedObjects !== null;
  const slotComplete = Object.values(slots).every((slot) => slot.complete) && unrelatedComplete;
  const storageByteDays = Object.values(slots)
    .reduce((sum, slot) => sum + slot.bytes * CLOUD_DATA_PLANE_MONTH_DAYS, unrelatedStorageByteDays ?? 0);
  const classAPut = addMetric(r2Baseline?.class_a, r2Demand?.class_a, "put", "put", inputsVerified);
  const classACopy = addMetric(r2Baseline?.class_a, r2Demand?.class_a, "copy", "copy", inputsVerified);
  const classAList = addMetric(r2Baseline?.class_a, r2Demand?.class_a, "list", "list", inputsVerified);
  const classAComplete = classAPut.complete && classACopy.complete && classAList.complete;
  const classAOperations = metric(
    classAPut.lower_bound + classACopy.lower_bound + classAList.lower_bound,
    classAComplete,
  );
  const r2Metrics = {
    decimal_gb_month: metric(
      storageByteDays / (CLOUD_DATA_PLANE_MONTH_DAYS * 1_000_000_000),
      slotComplete,
    ),
    class_a_operations_per_month: classAOperations,
    class_b_operations_per_month: addMetric(
      r2Baseline,
      r2Demand,
      "class_b_operations_per_month",
      "class_b_operations_per_month",
      inputsVerified,
    ),
  };

  const d1Baseline = accountBaseline?.d1 ?? null;
  const d1Demand = requestDemand?.d1 ?? null;
  const baselineRead = numberAt(d1Baseline, "rows_read_per_day");
  const baselineWrite = numberAt(d1Baseline, "rows_written_per_day");
  const tableContracts = evaluateD1TableContracts(
    d1Baseline?.per_table_rows,
    d1Demand?.tables,
    inputsVerified,
  );
  const d1OperationComplete = tableContracts.complete
    && baselineRead !== null
    && baselineWrite !== null;
  const d1Metrics = {
    database_bytes: addMetric(d1Baseline, d1Demand, "database_bytes", "database_bytes", inputsVerified),
    account_bytes: addMetric(d1Baseline, d1Demand, "account_bytes", "database_bytes", inputsVerified),
    max_row_or_blob_bytes: maxMetric(d1Baseline, d1Demand, "max_row_or_blob_bytes", inputsVerified),
    rows_read_per_day: metric(
      (baselineRead ?? 0) + tableContracts.rows_read_per_day,
      d1OperationComplete,
    ),
    rows_written_per_day: metric(
      (baselineWrite ?? 0) + tableContracts.rows_written_per_day,
      d1OperationComplete,
    ),
    queries_per_worker_invocation: maxMetric(
      d1Baseline,
      d1Demand,
      "queries_per_worker_invocation",
      inputsVerified,
    ),
  };
  const kvBaseline = accountBaseline?.kv ?? null;
  const kvDemand = requestDemand?.kv ?? null;
  const kvMetrics = {
    stored_bytes: addMetric(kvBaseline, kvDemand, "stored_bytes", "pointer_bytes", inputsVerified),
    max_pointer_bytes: maxMetric(kvBaseline, kvDemand, "max_pointer_bytes", inputsVerified),
    reads_per_day: addMetric(kvBaseline, kvDemand, "reads_per_day", "reads_per_day", inputsVerified),
    writes_per_day: addMetric(kvBaseline, kvDemand, "writes_per_day", "writes_per_day", inputsVerified),
  };
  const accountPointers = numberAt(kvBaseline, "pointers");
  const candidatePointers = numberAt(kvDemand, "pointers");
  const pointerModel = kvDemand?.model ?? null;
  const pointerKnownFailure = (pointerModel !== null && pointerModel !== "single_active_generation_pointer")
    || (candidatePointers !== null && candidatePointers > 1);
  const pointerContractComplete = inputsVerified
    && pointerModel === "single_active_generation_pointer"
    && candidatePointers !== null;
  const pointerContractVerdict = pointerKnownFailure
    ? "fail"
    : pointerContractComplete
      ? "pass"
      : "not_verified";

  function service(name, metrics) {
    const hardLimit = evaluate(metrics, policy?.[name]?.hard_limit);
    // A candidate-scoped run is governed by the candidate policy, which covers
    // every metric the candidate uses. The estate planning line is unchanged and
    // reported alongside, so a candidate pass never relabels the estate.
    const planningLimits = candidatePlanning ? candidatePlanning[name] : policy?.[name]?.planning_line;
    const planningLine = evaluate(metrics, planningLimits);
    const result = {
      metrics,
      hard_limit: hardLimit,
      planning_line: planningLine,
      verdict: combine([hardLimit.verdict, planningLine.verdict]),
    };
    if (candidatePlanning) {
      result.planning_policy = "candidate";
      result.estate_planning_line = evaluate(metrics, policy?.[name]?.planning_line);
    }
    return result;
  }
  const r2 = {
    slots,
    unrelated_account_baseline: {
      storage_byte_days: metric(unrelatedStorageByteDays ?? 0, unrelatedComplete),
      objects: metric(unrelatedObjects ?? 0, unrelatedComplete),
    },
    peak_objects: metric(
      Object.values(slots).reduce((sum, slot) => sum + slot.objects, unrelatedObjects ?? 0),
      slotComplete,
    ),
    storage_byte_days: metric(storageByteDays, slotComplete),
    class_a_breakdown: {
      put: classAPut,
      copy: classACopy,
      list: classAList,
      delete_free: addMetric(r2Baseline?.class_a, r2Demand?.class_a, "delete", "delete", inputsVerified),
    },
    ...service("r2", r2Metrics),
  };
  const d1 = {
    table_contracts: {
      rows: tableContracts.tables,
      complete: tableContracts.complete,
      verdict: tableContracts.verdict,
    },
    purge_policy: {
      total_purge_batch_rows: tableContracts.purge_rows_per_day,
      index_amplified: true,
      complete: tableContracts.complete,
    },
    ...service("d1", d1Metrics),
  };
  const kv = {
    pointer_contract: {
      model: pointerModel,
      candidate_pointers: candidatePointers ?? 0,
      account_pointers: metric(accountPointers ?? 0, baselineVerified && accountPointers !== null),
      verdict: pointerContractVerdict,
    },
    ...service("kv", kvMetrics),
  };
  r2.verdict = combine([
    r2.verdict,
    r2.class_a_breakdown.delete_free.complete ? "pass" : "not_verified",
    policyVerified ? "pass" : "not_verified",
  ]);
  d1.verdict = combine([
    d1.verdict,
    tableContracts.verdict,
    policyVerified ? "pass" : "not_verified",
  ]);
  kv.verdict = combine([
    kv.verdict,
    pointerContractVerdict,
    policyVerified ? "pass" : "not_verified",
  ]);
  return {
    assumptions: {
      r2_slots: ["current", "previous", "in_progress"],
      month_days: CLOUD_DATA_PLANE_MONTH_DAYS,
      decimal_gb_bytes: 1_000_000_000,
    },
    input_provenance: {
      account_baseline: provenance(accountBaseline, "cloud-data-plane-account-baseline/absent"),
      request_demand: provenance(requestDemand, "cloud-data-plane-request-demand/absent"),
      policy: provenance(policy, "cloud-data-plane-policy/absent"),
    },
    r2,
    d1,
    kv,
    verdict: combine([r2.verdict, d1.verdict, kv.verdict]),
  };
}

export function buildCloudDataPlaneReport({
  repoRoot,
  accountBaseline = null,
  requestDemand = null,
  policy = DEFAULT_CLOUD_DATA_PLANE_POLICY,
  laneRegistry = LANE_REGISTRY,
  derivedRegistry = DERIVED_ASSET_REGISTRY,
  detectionConfig = DATA_SUPPLY_DETECTION_CONFIG,
  dataHealthKpi,
  candidateId = null,
} = {}) {
  const catalog = buildCloudDataPlaneCatalog({
    repoRoot,
    laneRegistry,
    derivedRegistry,
    detectionConfig,
    dataHealthKpi,
  });
  // A migration budget is argued from the payload that actually moves, so a
  // candidate run replaces the estate inventory with the candidate's scoped one.
  // The catalog is still built and still reported: dropping it would remove the
  // estate-wide ownership completeness check, and a scoped budget computed over
  // an estate with unowned files is not trustworthy just because it is smaller.
  // The scope is recorded in the report so a scoped verdict can never be read as
  // an estate verdict.
  const candidateScope = candidateId
    ? buildCandidateScope({ repoRoot, candidateId, laneRegistry })
    : null;
  const budget = calculateCloudDataPlaneBudget({
    inventory: candidateScope ? candidateScope.inventory : catalog.inventory,
    accountBaseline,
    requestDemand,
    policy,
    // Owner decision 2026-08-14: candidate runs are governed by the candidate
    // policy; estate runs keep the estate policy and its declared gaps.
    candidatePlanning: candidateScope ? CANDIDATE_PLANNING_POLICY : null,
  });
  return {
    schema_version: CLOUD_DATA_PLANE_REPORT_SCHEMA,
    catalog,
    ...(candidateScope ? { candidate_scope: candidateScope.manifest } : {}),
    inventory_scope: candidateScope ? { kind: "candidate", candidate_id: candidateId } : { kind: "estate" },
    budget,
    verdict: combine([catalog.verdict, budget.verdict]),
  };
}

export function cloudDataPlaneExitCode(verdict) {
  if (verdict === "pass") return 0;
  if (verdict === "fail") return 1;
  if (verdict === "not_verified") return 2;
  return 64;
}
