import fs from "node:fs";
import path from "node:path";
import { projectPublicKpi } from "../scripts/lib/kpi-runtime-projection.mjs";

const rootDir = process.cwd();
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

const PRIVATE_DATA_SUPPLY_PUBLIC_ROOTS = Object.freeze([
  "public/data/admin/data-supply-state",
  "public/data/yf/etf-details",
  // B-380 is a private, change-only Yahoo estimate history record. It has no
  // product reader or public lane; remove the whole generated tree so future
  // date shards cannot leak through blanket canonical synchronization.
  "public/data/yf/estimates-archive",
  "public/data/yf/migration-evidence",
  // Dated Russell factsheet captures, including the source PDFs. Evidence for
  // the RIM research record, never a product surface.
  "public/data/computed/fenok-rim/russell2000-history",
]);

const STALE_PRIVATE_PUBLIC_FILE = "public/data/admin/data-supply-detection-floor.json";

// temp-file -> validate -> rename, shared by the KPI public-mirror re-projection.
function writeJsonAtomic(absPath, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  JSON.parse(fs.readFileSync(tmp, "utf8"));
  fs.renameSync(tmp, absPath);
}

// The ../data -> public copy clobbers the projected mirror with the full-runtime
// root doc. Re-project so the public KPI never carries producer identity/history
// (contract §4). v1 / runtime-less docs pass through untouched. Injectable clock +
// atomic write so the fixture can exercise this exact path against a temp root.
export function projectFenokDataHealthKpiPublicMirror({
  rootDir: baseDir = rootDir,
  nowIso = process.env.KPI_FAKE_NOW || new Date().toISOString(),
} = {}) {
  const relativePath = "public/data/admin/fenok-data-health-kpi.json";
  const filePath = path.join(baseDir, relativePath);
  if (!fs.existsSync(filePath)) return;
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!doc || !doc.runtime) return;
  writeJsonAtomic(filePath, projectPublicKpi(doc, nowIso));
  console.log(`[sync-static-overrides] projected public KPI runtime ${relativePath}`);
}

function replaceExact(content, from, to, filePath) {
  if (content.includes(to)) {
    return content;
  }
  if (!content.includes(from)) {
    console.warn(
      `[sync-static-overrides] pattern not found in ${filePath} — skipped (submodule likely moved past this rewrite)`
    );
    return content;
  }
  return content.replace(from, to);
}

function applyReplacements(relativePath, replacements) {
  const filePath = path.join(rootDir, relativePath);
  let content = fs.readFileSync(filePath, "utf8");

  for (const [from, to] of replacements) {
    content = replaceExact(content, from, to, relativePath);
  }

  fs.writeFileSync(filePath, content, "utf8");
  console.log(`[sync-static-overrides] applied ${relativePath}`);
}

function removeGeneratedPublicMirror(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
  console.log(`[sync-static-overrides] removed private-only public mirror ${relativePath}`);
}

// Some private families share a public top-level directory with an approved
// receipt or summary. A blanket canonical walk can therefore recreate ignored
// working-tree caches beneath that directory even though Git never tracks
// them. Remove every public child except the explicitly approved boundary so
// the cleanup is fail-closed for newly appearing cache/log/bytecode files too.
export function removePublicTreeExcept(
  relativeRoot,
  keepRelativePaths,
  { baseDir = rootDir, logger = console.log } = {},
) {
  const rootPath = path.join(baseDir, relativeRoot);
  if (!fs.existsSync(rootPath)) return { filesRemoved: 0, directoriesRemoved: 0 };

  const keep = new Set(keepRelativePaths);
  const files = [];
  const directories = [];
  const visit = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        directories.push(absolute);
        visit(absolute, relative);
      } else {
        files.push({ absolute, relative });
      }
    }
  };
  visit(rootPath, "");

  let filesRemoved = 0;
  for (const file of files) {
    if (keep.has(file.relative)) continue;
    fs.unlinkSync(file.absolute);
    filesRemoved += 1;
    logger(`[sync-static-overrides] removed private-only public mirror ${path.join(relativeRoot, file.relative)}`);
  }

  let directoriesRemoved = 0;
  for (const directory of directories.sort((left, right) => right.length - left.length)) {
    if (fs.readdirSync(directory).length !== 0) continue;
    fs.rmdirSync(directory);
    directoriesRemoved += 1;
  }
  return { filesRemoved, directoriesRemoved };
}

const EDGAR_PUBLIC_RECEIPTS = Object.freeze([
  "r1-panel/dei-refetch-receipt.json",
  "r1-panel/duration-refetch-receipt.json",
  "r1-panel/price-fetch-receipt.json",
  "r1-panel/primary-e-fetch-receipt.json",
  "r1-panel/sic-fetch-receipt.json",
  "r2-panel/dividend-fetch-receipt.json",
  "r3-panel/r3-dividend-fetch-receipt.json",
  "r3-panel/r3-price-fetch-receipt.json",
]);

export function removePrivateEdgarPublicTree(options = {}) {
  return removePublicTreeExcept("public/data/edgar", EDGAR_PUBLIC_RECEIPTS, options);
}

export function removePrivateFactsetPublicTree(options = {}) {
  return removePublicTreeExcept("public/data/factset-earnings-insight", ["archives/receipt.json"], options);
}

// Third-party research inputs. These are read under research use and are not ours to
// republish: the Li-Mohanram paper text and PDF, and the Ken French factor archives.
// The mirror guard already refuses .csv and .txt in the public tree, which catches the
// parsed factor files and the paper text -- but not the PDF or the zips, so the whole
// tree is removed rather than the files the guard happens to name.
const PRIVATE_RESEARCH_PUBLIC_TREES = [
  "public/data/edgar/literature",
  "public/data/kf-french",
];
function removePrivateResearchPublicTrees() {
  for (const relativePath of PRIVATE_RESEARCH_PUBLIC_TREES) {
    const dirPath = path.join(rootDir, relativePath);
    if (!fs.existsSync(dirPath)) continue;
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`[sync-static-overrides] removed private research tree ${relativePath}`);
  }
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizedPrivateDataSupplyRoot(relativePath) {
  const portable = relativePath.split(path.sep).join("/");
  const normalized = path.posix.normalize(portable);
  if (!PRIVATE_DATA_SUPPLY_PUBLIC_ROOTS.includes(normalized)) {
    throw new Error(`refusing non-allowlisted public tree removal: ${relativePath}`);
  }
  return normalized;
}

function pathInsideRoot(resolvedRoot, target) {
  const relative = path.relative(resolvedRoot, target);
  if (relative === "") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing public cleanup path outside root: ${target}`);
  }
  return relative.split(path.sep).join("/");
}

function nodeKind(stat) {
  if (!stat) return "absent";
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "special";
}

function boundNode(resolvedRoot, target, stat) {
  return {
    path: pathInsideRoot(resolvedRoot, target),
    kind: nodeKind(stat),
    identity: stat
      ? [
          String(stat.dev),
          String(stat.ino),
          String(stat.mode),
          String(stat.nlink),
          String(stat.size),
          String(stat.mtimeMs),
          String(stat.ctimeMs),
        ].join(":")
      : null,
  };
}

function sameBoundNode(left, right) {
  return left.kind === right.kind && left.identity === right.identity;
}

function bindPath(plan, target) {
  const stat = lstatIfPresent(target);
  const bound = boundNode(plan.resolvedRoot, target, stat);
  const previous = plan.bindings.get(bound.path);
  if (previous && !sameBoundNode(previous, bound)) {
    throw new Error(`public cleanup identity drift during preflight: ${target}`);
  }
  plan.bindings.set(bound.path, bound);
  return { stat, bound };
}

function bindDirectoryParents(plan, target) {
  const relative = path.relative(plan.resolvedRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing public cleanup path outside root: ${target}`);
  }

  const segments = relative.split(path.sep);
  let cursor = plan.resolvedRoot;
  bindPath(plan, cursor);
  let parentsPresent = true;
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    const { stat } = bindPath(plan, cursor);
    if (!stat) {
      parentsPresent = false;
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing symlink in public cleanup parent path: ${cursor}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`refusing non-directory public cleanup parent path: ${cursor}`);
    }
    if (!parentsPresent) {
      throw new Error(`public cleanup path appeared beneath an absent parent: ${cursor}`);
    }
  }
  return parentsPresent;
}

function collectBoundRemovalTree(plan, directory, files, directories) {
  directories.push(directory);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const { stat } = bindPath(plan, entryPath);
    if (!stat) {
      throw new Error(`private public tree changed during preflight: ${entryPath}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing symlink in private public tree: ${entryPath}`);
    }
    if (stat.isDirectory()) {
      collectBoundRemovalTree(plan, entryPath, files, directories);
    } else if (stat.isFile()) {
      files.push(entryPath);
    } else {
      throw new Error(`refusing special file in private public tree: ${entryPath}`);
    }
  }
}

function buildPublicCleanupPlan(resolvedRoot) {
  const plan = {
    resolvedRoot,
    bindings: new Map(),
    privateRoots: [],
    staleFile: null,
  };
  const { stat: rootStat } = bindPath(plan, resolvedRoot);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`refusing unsafe sync-static root: ${resolvedRoot}`);
  }

  for (const relativePath of PRIVATE_DATA_SUPPLY_PUBLIC_ROOTS) {
    const normalized = normalizedPrivateDataSupplyRoot(relativePath);
    const target = path.resolve(resolvedRoot, ...normalized.split("/"));
    const parentsPresent = bindDirectoryParents(plan, target);
    const { stat } = bindPath(plan, target);
    if (!parentsPresent) {
      if (stat) throw new Error(`public cleanup target appeared beneath an absent parent: ${target}`);
      continue;
    }
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing symlink in private public tree: ${target}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`refusing non-directory private public tree: ${target}`);
    }
    const files = [];
    const directories = [];
    collectBoundRemovalTree(plan, target, files, directories);
    plan.privateRoots.push({ normalized, files, directories });
  }

  const staleTarget = path.resolve(resolvedRoot, ...STALE_PRIVATE_PUBLIC_FILE.split("/"));
  const staleParentsPresent = bindDirectoryParents(plan, staleTarget);
  const { stat: staleStat } = bindPath(plan, staleTarget);
  if (!staleParentsPresent) {
    if (staleStat) throw new Error(`stale public file appeared beneath an absent parent: ${staleTarget}`);
  } else if (staleStat) {
    if (staleStat.isSymbolicLink()) {
      throw new Error(`refusing symlink at stale public file: ${staleTarget}`);
    }
    if (!staleStat.isFile()) {
      throw new Error(`stale public file must be a regular file: ${staleTarget}`);
    }
    plan.staleFile = { normalized: STALE_PRIVATE_PUBLIC_FILE, path: staleTarget };
  }
  return plan;
}

function cleanupPlanSignature(plan) {
  return JSON.stringify(
    [...plan.bindings.values()]
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
}

function assertBoundRemovalNode(plan, target, expectedKind, stableOnly = false) {
  const relative = pathInsideRoot(plan.resolvedRoot, target);
  const expected = plan.bindings.get(relative);
  const current = boundNode(plan.resolvedRoot, target, lstatIfPresent(target));
  if (!expected || current.kind !== expectedKind) {
    throw new Error(`public cleanup node changed before mutation: ${target}`);
  }
  const expectedIdentity = String(expected.identity ?? "").split(":");
  const currentIdentity = String(current.identity ?? "").split(":");
  const fieldCount = stableOnly ? 3 : expectedIdentity.length;
  if (expectedIdentity.slice(0, fieldCount).join(":") !== currentIdentity.slice(0, fieldCount).join(":")) {
    throw new Error(`public cleanup identity drift before mutation: ${target}`);
  }
}

function removeCollectedTree(plan, files, directories) {
  for (const filePath of files) {
    assertBoundRemovalNode(plan, filePath, "file");
    fs.unlinkSync(filePath);
  }
  for (const directory of [...directories].reverse()) {
    assertBoundRemovalNode(plan, directory, "directory", true);
    fs.rmdirSync(directory);
  }
}

export function removePrivateDataSupplyPublicTrees({
  rootDir: baseDir = rootDir,
  logger = console.log,
  beforeMutation = null,
} = {}) {
  const resolvedRoot = path.resolve(baseDir);
  if (beforeMutation !== null && typeof beforeMutation !== "function") {
    throw new Error("beforeMutation must be a function when provided");
  }
  const initialPlan = buildPublicCleanupPlan(resolvedRoot);
  beforeMutation?.({
    rootDir: resolvedRoot,
    privateRoots: [...PRIVATE_DATA_SUPPLY_PUBLIC_ROOTS],
    staleFile: STALE_PRIVATE_PUBLIC_FILE,
  });
  const reboundPlan = buildPublicCleanupPlan(resolvedRoot);
  if (cleanupPlanSignature(initialPlan) !== cleanupPlanSignature(reboundPlan)) {
    throw new Error("public cleanup identity drift before mutation");
  }

  const result = {
    rootsRemoved: 0,
    filesRemoved: 0,
    directoriesRemoved: 0,
    staleFilesRemoved: 0,
  };
  for (const item of reboundPlan.privateRoots) {
    removeCollectedTree(reboundPlan, item.files, item.directories);
    result.rootsRemoved += 1;
    result.filesRemoved += item.files.length;
    result.directoriesRemoved += item.directories.length;
    logger(
      `[sync-static-overrides] removed private-only public tree ${item.normalized} `
      + `(${item.files.length} files, ${item.directories.length} directories)`,
    );
  }
  if (result.rootsRemoved > 0) {
    logger(
      `[sync-static-overrides] removed ${result.filesRemoved} files and `
      + `${result.directoriesRemoved} directories from ${result.rootsRemoved} private data-supply roots`,
    );
  }
  if (reboundPlan.staleFile) {
    assertBoundRemovalNode(reboundPlan, reboundPlan.staleFile.path, "file");
    fs.unlinkSync(reboundPlan.staleFile.path);
    result.staleFilesRemoved = 1;
    logger(
      `[sync-static-overrides] removed stale private-only public mirror `
      + reboundPlan.staleFile.normalized,
    );
  }
  return result;
}

function writeJson(relativePath, payload) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export function removePublicDevelopmentDocs({ baseDir = rootDir, logger = console.log } = {}) {
  const files = walkFiles(path.join(baseDir, "public"))
    .filter((file) => /^(?:CLAUDE|AGENTS|ORCHESTRATOR|DEV)\.md$/i.test(path.basename(file)));
  for (const file of files) fs.unlinkSync(file);
  if (files.length) logger(`[sync-static-overrides] excluded ${files.length} public development documents`);
  return { filesRemoved: files.length };
}

function sanitizePrivateTokens(node) {
  if (Array.isArray(node)) return node.map(sanitizePrivateTokens);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== "private_manifest_file" && key !== "manifest_file")
        .map(([key, value]) => [key, sanitizePrivateTokens(value)]),
    );
  }
  if (typeof node === "string" && node.includes("_private/")) {
    return "admin_private_path_redacted";
  }
  return node;
}

function sanitizePublicPrivateTokenLeaks() {
  const publicDataDir = path.join(rootDir, "public", "data");
  const tokens = ["_private/", "\"private_manifest_file\"", "\"manifest_file\""];
  for (const filePath of walkFiles(publicDataDir)) {
    if (!filePath.endsWith(".json")) continue;
    const text = fs.readFileSync(filePath, "utf8");
    if (!tokens.some((token) => text.includes(token))) continue;
    try {
      const sanitized = sanitizePrivateTokens(JSON.parse(text));
      fs.writeFileSync(filePath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
      console.log(`[sync-static-overrides] redacted private path tokens ${path.relative(rootDir, filePath)}`);
    } catch (error) {
      console.warn(`[sync-static-overrides] failed to sanitize ${path.relative(rootDir, filePath)}: ${error.message}`);
    }
  }
}

function compactFenokEdgeSourceRow(row) {
  return {
    id: row.id,
    label: row.label,
    covered_count: row.covered_count,
    denominator: row.denominator,
    denominator_label: row.denominator_label,
    coverage_pct: row.coverage_pct,
    active_scoring_coverage_pct: row.active_scoring_coverage_pct,
    source_date: row.source_date,
    availability_status: row.availability_status,
    claim_scope: row.claim_scope,
    not_public_scoring: row.not_public_scoring === true,
    caveat: row.caveat,
  };
}

function compactFenokEdgePublicMirror() {
  const relativePath = "public/data/admin/fenok-edge-coverage-index.json";
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) return;

  const index = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (index.schema_version === "fenok-edge-coverage-index-public/v0.1") return;
  if (index.schema_version !== "fenok-edge-coverage-index/v0.2") {
    console.warn(`[sync-static-overrides] unexpected ${relativePath} schema; skipped compact mirror`);
    return;
  }

  writeJson(relativePath, {
    schema_version: "fenok-edge-coverage-index-public/v0.1",
    source_schema_version: index.schema_version,
    generated_at: index.generated_at,
    purpose: "Compact public admin readiness mirror. Contains derived counts/status only; no raw rows, private manifests, target ticker lists, or private artifact paths.",
    raw_policy: {
      raw_public: index.raw_policy?.raw_public === true,
      raw_rows_included: index.raw_policy?.raw_rows_included === true,
      private_artifact_paths_included: false,
    },
    active_scoring_universe: {
      generated_at: index.active_scoring_universe?.generated_at ?? null,
      current_only: index.active_scoring_universe?.current_only === true,
      total: index.active_scoring_universe?.total ?? null,
      by_market: index.active_scoring_universe?.by_market ?? [],
      buckets: index.active_scoring_universe?.buckets ?? {},
    },
    expanded_stock_candidate_universe: {
      generated_at: index.expanded_stock_candidate_universe?.generated_at ?? null,
      collected_asset_total: index.expanded_stock_candidate_universe?.collected_asset_total ?? null,
      collected_stock_candidates: index.expanded_stock_candidate_universe?.collected_stock_candidates ?? null,
      scored_public_stock: index.expanded_stock_candidate_universe?.scored_public_stock ?? null,
      stock_promotion_audit_gap: index.expanded_stock_candidate_universe?.stock_promotion_audit_gap ?? null,
      stage: index.expanded_stock_candidate_universe?.stage ?? null,
      public_done_claim_allowed: index.expanded_stock_candidate_universe?.public_done_claim_allowed === true,
      caveat: index.expanded_stock_candidate_universe?.caveat ?? null,
    },
    etf_universe: {
      collected_etf_candidates: index.etf_universe?.collected_etf_candidates ?? null,
      eligible_etf_count: index.etf_universe?.eligible_etf_count ?? null,
      stage: index.etf_universe?.stage ?? null,
      scored_public_etf: index.etf_universe?.scored_public_etf ?? null,
      public_done_claim_allowed: index.etf_universe?.public_done_claim_allowed === true,
      evidence_based_readiness: index.etf_universe?.evidence_based_readiness ?? null,
      core_daily_basket: index.etf_universe?.core_daily_basket ?? null,
      caveat: index.etf_universe?.caveat ?? null,
    },
    source_availability: {
      not_public_scoring: index.source_availability?.not_public_scoring === true,
      caveat: index.source_availability?.caveat ?? null,
      source_count: (index.source_availability?.sources ?? []).length,
      sources: (index.source_availability?.sources ?? []).map(compactFenokEdgeSourceRow),
    },
    source_availability_composites: index.source_availability_composites ?? null,
    public_scoring_readiness: index.public_scoring_readiness ?? null,
    freshness_gate: index.freshness_gate ?? null,
  });
  console.log(`[sync-static-overrides] compacted ${relativePath}`);
}

// Four control-plane bridge/index mirrors reach the served surface carrying the
// filesystem paths of their private raw artifacts. The payloads never ship —
// _private/ is gitignored and untracked — but the path structure does, and the
// public mirror guard has been failing on exactly these four for as long as
// nothing ran it.
//
// These are redacted rather than removed. The canonical data/** copies must keep
// the fields, because the edge coverage-index builder reads them to open the
// private manifests, and every other field these four publish stays intact; only
// the served projection loses the private paths. A key is dropped when its name
// is a private-artifact reference or when its string value points inside
// _private/, so a null-valued reference cannot survive as a bare key either.
const PRIVATE_ARTIFACT_PATH_MIRRORS = Object.freeze([
  "public/data/admin/fenok-flow-backfill-index.json",
  "public/data/admin/krx/lkg/bridge.json",
  "public/data/admin/taiwan-data-bridge-index.json",
  "public/data/computed/taiwan-data-bridge-index.json",
]);
const PRIVATE_ARTIFACT_KEYS = Object.freeze([
  "private_artifacts",
  "private_manifest_file",
  "private_raw_base_dir",
  "private_storage_ref",
]);

// A value that IS a private path is a reference and its key is dropped. A value
// that merely MENTIONS the private tree is prose — one of these files documents
// the boundary in a sentence, so the sentence asserting the privacy rule is what
// trips the privacy guard. Redact the token in place there and the statement
// keeps its meaning without publishing the structure.
const PRIVATE_PATH_TOKEN = /_private\/[A-Za-z0-9._/<>-]*/g;
const BARE_PRIVATE_PATH = /^[A-Za-z0-9._/-]*_private\/[A-Za-z0-9._/<>-]*$/;

function stripPrivateArtifactPaths(value) {
  if (typeof value === "string") {
    return value.includes("_private/") ? value.replace(PRIVATE_PATH_TOKEN, "<private-raw-tree>") : value;
  }
  if (Array.isArray(value)) return value.map(stripPrivateArtifactPaths);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PRIVATE_ARTIFACT_KEYS.includes(key)) continue;
    if (typeof entry === "string" && BARE_PRIVATE_PATH.test(entry.trim())) continue;
    const cleaned = stripPrivateArtifactPaths(entry);
    // A container whose only contents were private paths is dropped rather than
    // published as an empty object, which would read as "nothing was here".
    if (cleaned !== null && typeof cleaned === "object" && !Array.isArray(cleaned)
      && Object.keys(cleaned).length === 0 && Object.keys(entry).length > 0) continue;
    out[key] = cleaned;
  }
  return out;
}

// rootDir is injectable because sync-static is no longer the only caller: the
// public-data producer regenerates these same four mirrors and must redact the
// tree it just wrote, wherever that tree is. Defaulting to the module rootDir
// keeps the sync-static step byte-identical.
export function redactPrivateArtifactPathMirrors({
  mirrors = PRIVATE_ARTIFACT_PATH_MIRRORS,
  rootDir: baseDir = rootDir,
  logger = console.log,
} = {}) {
  const resolvedRoot = path.resolve(baseDir);
  const redacted = [];
  for (const relativePath of mirrors) {
    const filePath = path.join(resolvedRoot, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const original = fs.readFileSync(filePath, "utf8");
    if (!original.includes("_private/") && !PRIVATE_ARTIFACT_KEYS.some((key) => original.includes(`"${key}"`))) continue;
    writeJsonAtomic(filePath, stripPrivateArtifactPaths(JSON.parse(original)));
    redacted.push(relativePath);
    logger(`[sync-static-overrides] redacted private artifact paths from ${relativePath}`);
  }
  return redacted;
}

// Guard so importing this module (fixture tests) does not run the whole override
// pipeline against the importer's cwd. Executed only when run as the sync-static step.
if (isMain) {
// Regenerate the lane-owned slim marker after the generic copy skips it.
const occAvailability = path.resolve(rootDir, "../data/computed/fenok_occ_options_availability.json");
if (fs.existsSync(occAvailability)) {
  const { rows, side_attempts, ...slim } = JSON.parse(fs.readFileSync(occAvailability, "utf8"));
  writeJsonAtomic(path.join(rootDir, "public/data/computed/fenok_occ_options_availability.json"), slim);
}
removePrivateDataSupplyPublicTrees();
removePublicDevelopmentDocs();
// Blanket static sync may leave ignored files from a prior legacy checkout.
removePublicTreeExcept("public/tools/stock_analyzer", []);
redactPrivateArtifactPathMirrors();
removePrivateResearchPublicTrees();
removePrivateEdgarPublicTree();
removePrivateFactsetPublicTree();
// The FENO RIM research records. They carry every operand, the frozen
// calibration constants, the fitted discount equation, and the source notes that
// name where each constant came from. Only the redacted projection built by
// build-fenok-rim-sustainable-public-projection.mjs, plus the two artifacts
// deliberately committed under public/, are publishable. These five were
// reaching the deployed site through the blanket computed/ copy, and no surface
// reads any of them.
for (const relativePath of [
  "public/data/computed/fenok-rim/sustainable-index-ranges.json",
  "public/data/computed/fenok-rim/identification-receipt.json",
  "public/data/computed/fenok-rim/input-diagnostics.json",
  "public/data/computed/fenok-rim/index-residual-roe-diagnostic.json",
  "public/data/computed/fenok-rim/membership-sensitivity-2026.json",
  "public/data/computed/fenok-rim/russell2000-official-fundamentals.json",
]) {
  removeGeneratedPublicMirror(relativePath);
}
// FactSet's public boundary retains only the provenance receipt. The fetch and
// probe files are canonical control-plane artifacts and must not reach a served
// surface or be reintroduced by the blanket canonical-data sync.
for (const relativePath of [
  "public/data/factset-earnings-insight/fetch-parent.py",
  "public/data/factset-earnings-insight/fetch.py",
  "public/data/factset-earnings-insight/parse.py",
  "public/data/factset-earnings-insight/probe-log.jsonl",
  "public/data/factset-earnings-insight/zacks-render-test.py",
]) {
  removeGeneratedPublicMirror(relativePath);
}
removeGeneratedPublicMirror("public/data/computed/fenok_signals.json");
// EDGAR public boundary retains provenance receipts only. The SEC bootstrap and
// RIM-DOW companyfacts caches are canonical recovery/research inputs, not a
// served surface, and must be removed after blanket canonical synchronization.
for (const relativePath of [
  "public/data/edgar/company_tickers.json",
  "public/data/edgar/rim-dow/AAPL.json",
  "public/data/edgar/rim-dow/AMGN.json",
  "public/data/edgar/rim-dow/AMZN.json",
  "public/data/edgar/rim-dow/AXP.json",
  "public/data/edgar/rim-dow/BA.json",
  "public/data/edgar/rim-dow/CAT.json",
  "public/data/edgar/rim-dow/CRM.json",
  "public/data/edgar/rim-dow/CSCO.json",
  "public/data/edgar/rim-dow/CVX.json",
  "public/data/edgar/rim-dow/DIS.json",
  "public/data/edgar/rim-dow/GOOGL.json",
  "public/data/edgar/rim-dow/GS.json",
  "public/data/edgar/rim-dow/HD.json",
  "public/data/edgar/rim-dow/HON.json",
  "public/data/edgar/rim-dow/IBM.json",
  "public/data/edgar/rim-dow/JNJ.json",
  "public/data/edgar/rim-dow/JPM.json",
  "public/data/edgar/rim-dow/KO.json",
  "public/data/edgar/rim-dow/MCD.json",
  "public/data/edgar/rim-dow/MMM.json",
  "public/data/edgar/rim-dow/MRK.json",
  "public/data/edgar/rim-dow/MSFT.json",
  "public/data/edgar/rim-dow/NKE.json",
  "public/data/edgar/rim-dow/NVDA.json",
  "public/data/edgar/rim-dow/PG.json",
  "public/data/edgar/rim-dow/SHW.json",
  "public/data/edgar/rim-dow/TRV.json",
  "public/data/edgar/rim-dow/UNH.json",
  "public/data/edgar/rim-dow/V.json",
  "public/data/edgar/rim-dow/WMT.json",
]) {
  removeGeneratedPublicMirror(relativePath);
}
removeGeneratedPublicMirror("public/data/computed/fenok_etf_signals.json");
removeGeneratedPublicMirror("public/data/computed/etf_action_index.json");
removeGeneratedPublicMirror("public/data/admin/fenok-s1-stock-promotion-gate-plan.json");
removeGeneratedPublicMirror("public/data/admin/fenok-s1-stock-public-promotion-dry-run.json");
removeGeneratedPublicMirror("public/data/admin/fenok-s1-public-mutation-enable-readiness.json");
removeGeneratedPublicMirror("public/data/admin/fenok-edge-etf-daily1y-readiness.json");
removeGeneratedPublicMirror("public/data/admin/fenok-edge-etf-daily1y-fetchable-plan.json");
removeGeneratedPublicMirror("public/data/admin/fenok-etf-daily1y-dispatch-plan.json");
removeGeneratedPublicMirror("public/data/admin/fenok-etf-core-daily-basket.json");
removeGeneratedPublicMirror("public/data/admin/fenok-s0-finra-occ-mapping-ledger.json");
for (const relativePath of [
  "public/data/computed/fenok_flow_proxies.json",
  "public/data/computed/fenok_flow_proxies_history.json",
  "public/data/computed/fenok_occ_options_volume.json",
  "public/data/computed/fenok_occ_options_volume_history.json",
  "public/data/computed/fenok_news_tone_proxy.json",
  "public/data/computed/fenok_news_tone_proxy_history.json",
  "public/data/computed/fenok_signal_lens_proxies.json",
  "public/data/computed/fenok_signal_lens_proxies_history.json",
  "public/data/computed/fenok_signal_lens_proxies_summary.json",
  "public/data/computed/fenok_social_attention_proxy.json",
  "public/data/computed/fenok_social_attention_proxy_history.json",
  "public/data/computed/fenok_apewisdom_attention_proxy.json",
  "public/data/computed/fenok_apewisdom_attention_proxy_history.json",
]) {
  removeGeneratedPublicMirror(relativePath);
}
compactFenokEdgePublicMirror();
projectFenokDataHealthKpiPublicMirror();
sanitizePublicPrivateTokenLeaks();

applyReplacements("public/alpha-scout/alpha-scout-main.html", [
  [
    `            let totalPages = 0;
            let currentPage = 1;

            // --- 초기화 함수 ---`,
    `            let totalPages = 0;
            let currentPage = 1;

            async function loadReportData(filename) {
                const response = await fetch(\`\${METADATA_PATH}\${filename}\`);
                if (!response.ok) throw new Error(\`리포트 데이터 로딩 실패: \${filename} (\${response.status})\`);
                return response.json();
            }

            // --- 초기화 함수 ---`,
  ],
  [
    `                    const res = await fetch(\`\${METADATA_PATH}\${filename}\`);
                    const report = await res.json();`,
    `                    const report = await loadReportData(filename);`,
  ],
  [
    `                    featuredReportLink.href = \`index.html?path=\${report.filePath}\`;`,
    `                    featuredReportLink.href = \`/alpha-scout?path=\${encodeURIComponent(report.filePath)}\`;`,
  ],
  [
    `                    const requests = pageFilenames.map(filename => fetch(\`\${METADATA_PATH}\${filename}\`).then(res => res.json()));
                    const reports = await Promise.all(requests);`,
    `                    const settled = await Promise.allSettled(pageFilenames.map(loadReportData));
                    const reports = settled
                        .filter(result => result.status === 'fulfilled')
                        .map(result => result.value);`,
  ],
  [
    `                            <a href="index.html?path=\${report.filePath}" data-path="\${report.filePath}" class="block bg-white rounded-xl p-6 card-shadow card-hover">`,
    `                            <a href="/alpha-scout?path=\${encodeURIComponent(report.filePath)}" data-path="\${report.filePath}" class="block bg-white rounded-xl p-6 card-shadow card-hover">`,
  ],
  [
    `                    });
                    archiveGrid.innerHTML = archiveHTML;`,
    `                    });
                    if (!archiveHTML) {
                        archiveGrid.innerHTML = \`<p class="w-full text-center text-slate-500">표시할 리포트가 없습니다.</p>\`;
                        renderPaginationControls();
                        return;
                    }
                    archiveGrid.innerHTML = archiveHTML;`,
  ],
]);

applyReplacements("public/vr/vr-complete-system.html", [
  [
    '<meta name="description" content="라오어의 TQQQ 기반 밸류 리밸런싱 5.0 투자 전략의 모든 것을 담은 최종 마스터 가이드. 공식, 시뮬레이터, 백테스트 데이터, 실전 Q&amp;A까지 제공합니다.">',
    '<meta name="description" content="TQQQ 기반 밸류 리밸런싱 5.0 전략의 공식, 시뮬레이터, 백테스트, 실전 Q&amp;A를 담은 가이드입니다.">',
  ],
  [
    '<title>밸류 리밸런싱(VR) 5.0 최종 마스터 가이드 (통합 완성본 v3.0)</title>',
    '<title>밸류 리밸런싱(VR) 5.0 완전 가이드</title>',
  ],
  [
    '<meta property="og:title" content="밸류 리밸런싱(VR) 5.0 최종 마스터 가이드 (통합 완성본 v3.0)">',
    '<meta property="og:title" content="밸류 리밸런싱(VR) 5.0 완전 가이드">',
  ],
]);

applyReplacements("public/vr/vr-total-guide-calculator.html", [
  [
    '<title>밸류 리밸런싱 토탈 가이드 &amp; 계산기</title>',
    '<title>밸류 리밸런싱 계산기</title>',
  ],
  [
    '<meta name="description" content="VR 전략 계산기와 통합 가이드를 제공하는 페이지.">',
    '<meta name="description" content="VR 전략 계산과 주문표 작성을 위한 계산기입니다.">',
  ],
  [
    '<meta property="og:title" content="밸류 리밸런싱 토탈 가이드 &amp; 계산기">',
    '<meta property="og:title" content="밸류 리밸런싱 계산기">',
  ],
]);






} // end if (isMain)
