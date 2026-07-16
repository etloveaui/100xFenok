#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATA_SUPPLY_DETECTION_CONFIG,
  canonicalJson,
  configDigest,
  validateDetectionConfig,
} from "./lib/data-supply-detection-config.mjs";
import {
  ATTEMPT_SCHEMA,
  ATTEMPT_SHARD_SCHEMA,
  CALENDAR_PATH,
  DetectionFloorError,
  REPO_ROOT,
  REPORT_BASENAME,
  buildDetectionReport,
  canonicalExistingDirectory,
  classifyAttempt,
  detectAndProject,
  evaluateAttemptCadence,
  evaluateFreshness,
  loadAttemptShards,
  pathsOverlap,
  prepareOutputContext,
  projectReportAtomic,
  validateAttemptEvidence,
  validateAttemptShard,
  validateCalendars,
  validateConfigCalendarBindings,
  validateDetectionReport,
  verifyDetectionReportFile,
} from "./build-data-supply-detection-floor.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.join(__dirname, "fixtures", "data_supply", "detection_floor");
const BUILDER = path.join(__dirname, "build-data-supply-detection-floor.mjs");
const CONFIG_MODULE = path.join(__dirname, "lib", "data-supply-detection-config.mjs");
const ATTEMPTS_PATH = path.join(FIXTURE_DIR, "attempts.fixture.json");
const CALENDARS_PATH = path.join(FIXTURE_DIR, "calendars.fixture.json");
const ARTIFACTS_PATH = path.join(FIXTURE_DIR, "artifacts.fixture.json");
const EXPECTED_PATH = path.join(FIXTURE_DIR, "cases.expected.json");
const ADMIN_REPORT = path.join(REPO_ROOT, "data", "admin", REPORT_BASENAME);
const DEPLOY_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "deploy-worker.yml");
const UPDATE_MANIFEST_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "update-manifest.yml");
const TEST_PREFIX = "fenok-dfloor-test-";
const PROTECTED_RELATIVE_PATHS = [
  ".github/workflows/deploy-worker.yml",
  "100xfenok-next/sync-static-overrides.mjs",
  "100xfenok-next/scripts/check-fenok-public-mirror-guard.mjs",
  "scripts/build-fenok-data-health-kpi.mjs",
  "scripts/lib/kpi-contract-constants.mjs",
  "scripts/test-build-fenok-data-health-kpi.mjs",
  "100xfenok-next/scripts/check-fenok-data-health-kpi.mjs",
  "100xfenok-next/package.json",
  "100xfenok-next/src/app/admin/data-lab/page.tsx",
  "scripts/generate-product-surface-coverage.mjs",
  "scripts/build-data-entity-graph.mjs",
  "scripts/check-fenok-edge-freshness.mjs",
  "scripts/update-manifest.py",
  "data/admin/product-surface-coverage.json",
  "100xfenok-next/public/data/admin/product-surface-coverage.json",
  "data/computed/entity_graph.json",
  "data/computed/entity_graph_stock_index.json",
  "data/computed/entity_graph_stock_services.json",
  "100xfenok-next/public/data/computed/entity_graph.json",
  "100xfenok-next/public/data/computed/entity_graph_stock_index.json",
  "100xfenok-next/public/data/computed/entity_graph_stock_services.json",
  "data/manifest.json",
  "100xfenok-next/public/data/manifest.json",
  "data/admin/data-supply-detection-floor.json",
  "100xfenok-next/public/data/admin/data-supply-detection-floor.json",
  "scripts/fixtures/data_supply/detection_floor/artifacts.fixture.json",
  "scripts/fixtures/data_supply/detection_floor/attempts.fixture.json",
  "scripts/fixtures/data_supply/detection_floor/calendars.fixture.json",
  "scripts/fixtures/data_supply/detection_floor/cases.expected.json",
  "scripts/lib/data-supply-detection-calendars.json",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function protectedSnapshot() {
  const paths = new Set(PROTECTED_RELATIVE_PATHS);
  const boundedGlobs = new Set();
  for (const laneConfig of DATA_SUPPLY_DETECTION_CONFIG.lanes) {
    for (const member of laneConfig.producer_members) {
      for (const contract of member.artifact_contracts) {
        if (contract.path.includes("*")) boundedGlobs.add(contract.path);
        else paths.add(contract.path);
      }
    }
  }
  const snapshot = {};
  for (const relative of [...paths].sort()) {
    const absolute = path.join(REPO_ROOT, ...relative.split("/"));
    if (!fs.existsSync(absolute)) {
      snapshot[relative] = "absent";
      continue;
    }
    const stat = fs.lstatSync(absolute);
    snapshot[relative] = stat.isFile() && !stat.isSymbolicLink()
      ? `file:${stat.size}:${createSha(fs.readFileSync(absolute))}`
      : `other:${stat.mode}:${stat.dev}:${stat.ino}`;
  }
  for (const pattern of [...boundedGlobs].sort()) {
    const relativeDirectory = path.posix.dirname(pattern);
    const basenamePattern = path.posix.basename(pattern);
    const namePattern = new RegExp(`^${basenamePattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+")}$`);
    const absoluteDirectory = path.join(REPO_ROOT, ...relativeDirectory.split("/"));
    if (!fs.existsSync(absoluteDirectory)) {
      snapshot[`glob:${pattern}`] = "absent";
      continue;
    }
    const matches = [];
    for (const name of fs.readdirSync(absoluteDirectory).filter((entry) => namePattern.test(entry)).sort()) {
      const absolute = path.join(absoluteDirectory, name);
      const stat = fs.lstatSync(absolute);
      matches.push(stat.isFile() && !stat.isSymbolicLink()
        ? [name, "file", stat.size, stat.mode & 0o777, createSha(fs.readFileSync(absolute))]
        : [name, "other", stat.mode, stat.size]);
    }
    snapshot[`glob:${pattern}`] = matches;
  }
  for (const [relativeRoot, hashContents] of [
    [".github/workflows", true],
    ["data", false],
    ["100xfenok-next/public/data", false],
    ["100xfenok-next/public", false],
    ["100xfenok-next/.next", false],
    ["100xfenok-next/.open-next", false],
    ["dist", false],
    ["build", false],
  ]) {
    const absoluteRoot = path.join(REPO_ROOT, ...relativeRoot.split("/"));
    if (!fs.existsSync(absoluteRoot)) {
      snapshot[`tree:${relativeRoot}`] = "absent";
      continue;
    }
    const records = [];
    const walk = (directory, prefix = "") => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        const stat = fs.lstatSync(absolute);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          records.push([relative, "dir", stat.mode & 0o777]);
          walk(absolute, relative);
        } else if (entry.isFile()) {
          records.push([relative, "file", stat.size, stat.mode & 0o777, hashContents ? createSha(fs.readFileSync(absolute)) : null]);
        } else if (entry.isSymbolicLink()) {
          records.push([relative, "symlink", fs.readlinkSync(absolute)]);
        } else {
          records.push([relative, "other", stat.mode, stat.size]);
        }
      }
    };
    walk(absoluteRoot);
    snapshot[`tree:${relativeRoot}`] = createSha(Buffer.from(canonicalJson(records), "utf8"));
  }
  for (const relativeRoot of ["data", "100xfenok-next/public", "100xfenok-next/.next", "100xfenok-next/.open-next", "dist", "build"]) {
    const absoluteRoot = path.join(REPO_ROOT, ...relativeRoot.split("/"));
    const matches = [];
    const scan = (directory, prefix = "") => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.name === REPORT_BASENAME) matches.push(relative);
        if (entry.isDirectory() && !entry.isSymbolicLink()) scan(path.join(directory, entry.name), relative);
      }
    };
    scan(absoluteRoot);
    snapshot[`report-files:${relativeRoot}`] = matches.sort();
  }
  return snapshot;
}

const attemptsFixture = readJson(ATTEMPTS_PATH);
const calendarsFixture = readJson(CALENDARS_PATH);
const artifactsFixture = readJson(ARTIFACTS_PATH);
const expectedFixture = readJson(EXPECTED_PATH);

const ownedRoots = [];

function makeOwnedRoot(parent = os.tmpdir()) {
  const realParent = fs.realpathSync.native(parent);
  const raw = fs.mkdtempSync(path.join(parent, TEST_PREFIX));
  fs.chmodSync(raw, 0o700);
  const stat = fs.lstatSync(raw);
  const record = { raw, real: fs.realpathSync.native(raw), dev: stat.dev, ino: stat.ino, parentReal: realParent };
  ownedRoots.push(record);
  return record;
}

function safeCleanup(record) {
  if (!record || !path.basename(record.raw).startsWith(TEST_PREFIX)) throw new Error("cleanup refused unknown root");
  const lexical = fs.lstatSync(record.raw);
  const real = fs.realpathSync.native(record.raw);
  if (lexical.isSymbolicLink() || !lexical.isDirectory() || lexical.dev !== record.dev || lexical.ino !== record.ino || real !== record.real) {
    throw new Error("cleanup refused changed root identity");
  }
  if (pathsOverlap(real, fs.realpathSync.native(REPO_ROOT))) throw new Error("cleanup refused repository overlap");
  fs.rmSync(real, { recursive: true, force: false });
}

function documentMap() {
  return new Map(artifactsFixture.documents.map((document) => [document.id, document]));
}

function mergedLayout(layoutId) {
  const baseline = artifactsFixture.layouts.find((layout) => layout.id === "all_valid");
  const selected = artifactsFixture.layouts.find((layout) => layout.id === layoutId);
  assert.ok(baseline && selected, `fixture layout ${layoutId} exists`);
  const nodes = new Map(baseline.nodes.map((node) => [node.path, node]));
  if (selected !== baseline) selected.nodes.forEach((node) => nodes.set(node.path, node));
  return [...nodes.values()];
}

function ensureFixtureParent(root, relativePath) {
  let cursor = root;
  for (const component of relativePath.split("/").slice(0, -1)) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor, { mode: 0o700 });
      continue;
    }
    assert.equal(stat.isSymbolicLink(), false, `fixture parent must not be a symlink: ${relativePath}`);
    assert.equal(stat.isDirectory(), true, `fixture parent must be a directory: ${relativePath}`);
  }
}

function materializeArtifacts(layoutId, parent = os.tmpdir()) {
  const record = makeOwnedRoot(parent);
  const documents = documentMap();
  for (const node of mergedLayout(layoutId)) {
    const absolute = path.join(record.raw, ...node.path.split("/"));
    if (node.node_type === "missing") continue;
    ensureFixtureParent(record.raw, node.path);
    if (node.node_type === "directory") {
      let stat;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        fs.mkdirSync(absolute, { mode: 0o700 });
      }
      if (stat) {
        assert.equal(stat.isSymbolicLink(), false, `fixture directory must not be a symlink: ${node.path}`);
        assert.equal(stat.isDirectory(), true, `fixture directory has an incompatible node: ${node.path}`);
      }
    } else if (node.node_type === "symlink") {
      fs.symlinkSync(node.target, absolute);
    } else if (node.node_type === "special") {
      const result = spawnSync("/usr/bin/mkfifo", [absolute], { encoding: "utf8" });
      assert.equal(result.status, 0, `mkfifo fixture: ${result.stderr}`);
    } else {
      assert.equal(node.node_type, "regular");
      const document = documents.get(node.document_id);
      assert.ok(document, `document ${node.document_id} exists`);
      const body = document.encoding === "json" ? JSON.stringify(document.content) : document.content;
      fs.writeFileSync(absolute, body, { encoding: "utf8", mode: 0o600 });
    }
  }
  return record;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactFixtureKeys(value, expected, context) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${context} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${context} keys`);
}

function validateArtifactFixture(document) {
  exactFixtureKeys(document, ["schema_version", "documents", "layouts"], "artifact fixture");
  assert.equal(document.schema_version, "data-supply-detection-artifacts/v1");
  assert.ok(Array.isArray(document.documents) && Array.isArray(document.layouts));
  const documentIds = new Set();
  for (const [index, row] of document.documents.entries()) {
    exactFixtureKeys(row, ["id", "encoding", "content"], `documents[${index}]`);
    assert.match(row.id, /^[a-z][a-z0-9_]{0,63}$/);
    assert.equal(documentIds.has(row.id), false, `duplicate document ${row.id}`);
    documentIds.add(row.id);
    assert.ok(row.encoding === "json" || row.encoding === "raw_utf8");
    if (row.encoding === "raw_utf8") assert.equal(typeof row.content, "string");
  }
  const layoutIds = new Set();
  for (const [layoutIndex, layout] of document.layouts.entries()) {
    exactFixtureKeys(layout, ["id", "nodes"], `layouts[${layoutIndex}]`);
    assert.match(layout.id, /^[a-z][a-z0-9_]{0,63}$/);
    assert.equal(layoutIds.has(layout.id), false, `duplicate layout ${layout.id}`);
    layoutIds.add(layout.id);
    assert.ok(Array.isArray(layout.nodes));
    const paths = new Set();
    for (const [nodeIndex, node] of layout.nodes.entries()) {
      const context = `${layout.id}.nodes[${nodeIndex}]`;
      const expectedKeys = node.node_type === "regular" ? ["path", "node_type", "document_id"]
        : node.node_type === "symlink" ? ["path", "node_type", "target"]
          : node.node_type === "special" ? ["path", "node_type", "special_kind"]
            : ["path", "node_type"];
      exactFixtureKeys(node, expectedKeys, context);
      assert.ok(new Set(["regular", "missing", "directory", "symlink", "special"]).has(node.node_type), `${context}.node_type`);
      assert.equal(typeof node.path, "string");
      assert.equal(path.isAbsolute(node.path) || node.path.includes("\\") || node.path.includes("\0") || node.path.includes("*"), false, `${context}.path form`);
      const components = node.path.split("/");
      assert.equal(components[0], "data", `${context}.path root`);
      assert.equal(components.some((component) => !component || component === "." || component === ".."), false, `${context}.path escape`);
      assert.equal(paths.has(node.path), false, `${context}.path duplicate`);
      paths.add(node.path);
      if (node.node_type === "regular") assert.ok(documentIds.has(node.document_id), `${context}.document_id`);
      if (node.node_type === "symlink") {
        assert.ok(typeof node.target === "string" && node.target.length > 0 && !node.target.includes("\0"), `${context}.target`);
        assert.equal(path.posix.isAbsolute(node.target) || node.target.includes("\\"), false, `${context}.target form`);
        const targetComponents = node.target.split("/");
        assert.equal(targetComponents.some((component) => !component || component === "." || component === ".."), false, `${context}.target escape`);
        const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(node.path), node.target));
        assert.ok(resolvedTarget === "data" || resolvedTarget.startsWith("data/"), `${context}.target root`);
      }
      if (node.node_type === "special") assert.equal(node.special_kind, "fifo", `${context}.special_kind`);
    }
  }
  const baseline = document.layouts.find((layout) => layout.id === "all_valid");
  assert.ok(baseline, "artifact fixture requires all_valid layout");
  for (const layout of document.layouts) {
    const merged = new Map(baseline.nodes.map((node) => [node.path, node]));
    if (layout !== baseline) layout.nodes.forEach((node) => merged.set(node.path, node));
    for (const node of merged.values()) {
      const components = node.path.split("/");
      for (let index = 1; index < components.length; index += 1) {
        const ancestor = merged.get(components.slice(0, index).join("/"));
        if (ancestor) assert.equal(ancestor.node_type, "directory", `${layout.id}: non-directory fixture ancestor ${ancestor.path}`);
      }
    }
  }
  return true;
}

function lane(report, id) {
  const row = report.lanes.find((candidate) => candidate.id === id);
  assert.ok(row, `report lane ${id} exists`);
  return row;
}

function replaceAttempt(document, laneId, memberId, replacement) {
  const copy = clone(document);
  const index = copy.attempts.findIndex((row) => row.lane_id === laneId && row.member_id === memberId);
  assert.notEqual(index, -1);
  const evidence = { ...replacement };
  delete evidence.lane_id;
  delete evidence.member_id;
  copy.attempts[index] = { ...copy.attempts[index], ...evidence };
  return copy;
}

function legalAttempt(reason) {
  const base = {
    lane_id: "fred_macro",
    member_id: null,
    attempt_id: "attempt-reason-case",
    observed_at: "2026-07-11T00:00:00Z",
    execution: "returned",
    exception_kind: null,
    http_status: 200,
    auth: "ok",
    rate_limited: false,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "observations_array", passed: true }],
  };
  if (reason === "transport_error") return { ...base, execution: "threw", exception_kind: "transport", http_status: null, auth: "not_applicable", decode: "not_attempted", payload: "not_available", assertions: [] };
  if (reason === "unexpected_error") return { ...base, execution: "threw", exception_kind: "unexpected", http_status: null, auth: "not_applicable", decode: "not_attempted", payload: "not_available", assertions: [] };
  if (reason === "http_error") return { ...base, http_status: 500, auth: "not_applicable", decode: "not_attempted", payload: "not_available", assertions: [] };
  if (reason === "auth_error") return { ...base, http_status: 401, auth: "rejected", decode: "not_attempted", payload: "not_available", assertions: [] };
  if (reason === "rate_limited") return { ...base, http_status: 429, auth: "not_applicable", rate_limited: true, decode: "not_attempted", payload: "not_available", assertions: [] };
  if (reason === "decode_error") return { ...base, decode: "error", payload: "not_available", assertions: [] };
  if (reason === "empty_payload") return { ...base, payload: "empty", assertions: [] };
  if (reason === "schema_drift") return { ...base, assertions: [{ id: "observations_array", passed: false }] };
  if (reason === "workflow_unobserved") return { ...base, attempt_id: null, observed_at: null, execution: "unobserved", http_status: null, auth: "not_applicable", decode: "not_attempted", payload: "not_available", assertions: [] };
  throw new Error(`unknown reason fixture ${reason}`);
}

function assertThrowsCode(callback, code) {
  assert.throws(callback, (error) => error instanceof DetectionFloorError && error.code === code);
}

function captureThrow(callback) {
  let caught = null;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected callback to throw");
  return caught;
}

function createFsAdapter(overrides = {}) {
  return Object.assign(Object.create(fs), overrides);
}

function driftedStat(stat) {
  return new Proxy(stat, {
    get(target, property) {
      if (property === "ino") return target.ino + 1;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function reportBytes(report) {
  return Buffer.from(`${canonicalJson(report)}\n`, "utf8");
}

function runConfigAndFixtureChecks() {
  const networkPattern = /from\s+["'](?:node:)?(?:https?|net|tls|dns|child_process)["']|import\(["'](?:node:)?(?:https?|net|tls|dns|child_process)["']\)|\bfetch\s*\(|\bundici\b|\baxios\b|\brequire\s*\(|\bcreateRequire\b|\bprocess\.getBuiltinModule\b|(?<![.\w])(?:spawn|spawnSync|exec|execFile|fork)\s*\(/;
  assert.doesNotMatch(fs.readFileSync(BUILDER, "utf8"), networkPattern);
  assert.doesNotMatch(fs.readFileSync(CONFIG_MODULE, "utf8"), networkPattern);
  assert.equal(validateDetectionConfig(DATA_SUPPLY_DETECTION_CONFIG), true);
  assert.equal(Object.isFrozen(DATA_SUPPLY_DETECTION_CONFIG), true);
  assert.equal(DATA_SUPPLY_DETECTION_CONFIG.lanes.length, 16);
  assert.equal(DATA_SUPPLY_DETECTION_CONFIG.lanes.flatMap((item) => item.producer_members).length, 20);
  assert.deepEqual(DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === "slickcharts").producer_members.map((item) => item.id), ["daily", "weekly", "monthly", "history", "symbols"]);
  const treasuryTga = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === "treasury_tga");
  const fredYardeni = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === "fred_yardeni");
  const liveLaneIds = DATA_SUPPLY_DETECTION_CONFIG.lanes
    .filter((item) => item.enforcement === "live")
    .map((item) => item.id);
  assert.equal(DATA_SUPPLY_DETECTION_CONFIG.enforcement, "shadow", "top-level enforcement remains shadow");
  assert.deepEqual(liveLaneIds, [
    "fred_macro",
    "fred_banking",
    "fred_yardeni",
    "fdic_tier1",
    "treasury_tga",
    "yahoo_ticker_macro",
    "sentiment",
    "nasdaq_giw_sox",
    "slickcharts",
    "edgar_filings",
    "finra_short_volume",
    "occ_options_volume",
  ], "only attempt-proven lanes are live");
  assert.equal(treasuryTga.enforcement, "live");
  assert.equal(treasuryTga.kpi_required, true);
  assert.equal(fredYardeni.enforcement, "live");
  assert.equal(fredYardeni.kpi_required, true);
  const nasdaqGiwSox = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === "nasdaq_giw_sox");
  assert.equal(nasdaqGiwSox.enforcement, "live");
  assert.equal(nasdaqGiwSox.kpi_required, true);
  assert.deepEqual(nasdaqGiwSox.producer_members[0].schedule, ["50 23 * * 1-5"]);
  assert.deepEqual(nasdaqGiwSox.endpoint_contract.assertions.map((item) => item.id), ["weighting_rows_array"]);
  assert.equal(nasdaqGiwSox.producer_members[0].artifact_contracts[0].assertions
    .some((item) => item.id === "constituent_identity_consistency"), true);
  assert.equal(treasuryTga.freshness.unit, "business_days");
  assert.equal(treasuryTga.freshness.calendar, "us_federal_business");
  assert.equal(treasuryTga.freshness.max_staleness, 2);
  assert.equal(treasuryTga.producer_members[0].cadence_calendar, "utc");
  for (const laneConfig of DATA_SUPPLY_DETECTION_CONFIG.lanes.filter((item) => !liveLaneIds.includes(item.id))) {
    assert.equal(laneConfig.enforcement, "shadow", `${laneConfig.id} stays shadow`);
    assert.equal(laneConfig.kpi_required, false, `${laneConfig.id} stays optional in KPI`);
  }
  for (const laneConfig of DATA_SUPPLY_DETECTION_CONFIG.lanes) {
    for (const memberConfig of laneConfig.producer_members) {
      if (memberConfig.cadence_declaration === null) {
        assert.equal(memberConfig.cadence_calendar, null, `${laneConfig.id}:${memberConfig.id} ownerless cadence`);
        continue;
      }
      assert.deepEqual(memberConfig.cadence_declaration, {
        kind: "github_workflow",
        evidence: memberConfig.workflow,
      });
      for (const cron of memberConfig.schedule) {
        assert.equal(calendarsFixture.schedules.filter((row) => row.cron === cron && row.calendar_id === memberConfig.cadence_calendar).length, 1, `${laneConfig.id}:${memberConfig.id} cadence contract`);
      }
    }
  }
  assert.equal(configDigest(), expectedFixture.config_digest);
  const digestProcess = spawnSync(process.execPath, ["-e", "import('./scripts/lib/data-supply-detection-config.mjs').then((module) => process.stdout.write(module.configDigest()))"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, TZ: "Pacific/Honolulu", LC_ALL: "C" },
  });
  assert.equal(digestProcess.status, 0, digestProcess.stderr);
  assert.equal(digestProcess.stdout, expectedFixture.config_digest);
  for (const declaration of [
    { kind: "owner_contract", evidence: "converter:global-scouter-weekly" },
    { kind: "payload_field", evidence: "/update_frequency" },
  ]) {
    const external = clone(DATA_SUPPLY_DETECTION_CONFIG);
    const externalLane = external.lanes.find((item) => item.id === "fred_macro");
    externalLane.owner_workflow = null;
    externalLane.producer_members[0].workflow = null;
    externalLane.producer_members[0].cadence_declaration = declaration;
    assert.equal(validateDetectionConfig(external), true, `${declaration.kind} can evidence an external producer cadence`);
  }
  const invalidConfigs = [
    (value) => { value.unknown = true; },
    (value) => { delete value.lanes[0].label; },
    (value) => { value.lanes[0].enabled = false; },
    (value) => { [value.lanes[0], value.lanes[1]] = [value.lanes[1], value.lanes[0]]; },
    (value) => { value.logical_lane_count = 14; },
    (value) => { value.lanes[0].monitoring_mode = "unknown"; },
    (value) => { value.lanes[0].freshness.fold = "unknown"; },
    (value) => { value.lanes[0].freshness.unit = "unknown"; },
    (value) => { value.lanes[0].freshness.calendar = "unknown"; },
    (value) => { value.lanes[0].producer_members[0].artifact_contracts[0].path = "../escape.json"; },
    (value) => { value.lanes[0].producer_members[0].artifact_contracts[0].path = "data/**/*.json"; value.lanes[0].producer_members[0].artifact_contracts[0].selection = "all"; },
    (value) => { value.lanes[0].producer_members[0].artifact_contracts[0].path = "data/bounded/*.json"; value.lanes[0].producer_members[0].artifact_contracts[0].selection = "single"; },
    (value) => { value.lanes[1].producer_members[0].artifact_contracts[0].path = value.lanes[0].producer_members[0].artifact_contracts[0].path; },
    (value) => { value.lanes[0].producer_members[0].artifact_contracts[0].unexpected = true; },
    (value) => { delete value.lanes[0].producer_members[0].cadence_calendar; },
    (value) => { value.lanes[0].producer_members[0].cadence_calendar = "unknown"; },
    (value) => { value.lanes[0].producer_members[0].cadence_declaration = null; },
    (value) => { value.lanes[0].producer_members[0].cadence_declaration = { kind: "payload_field", evidence: "not-a-pointer" }; value.lanes[0].producer_members[0].workflow = null; value.lanes[0].owner_workflow = null; },
    (value) => { value.lanes[0].producer_members[0].cadence_declaration = { kind: "owner_contract", evidence: "?" }; value.lanes[0].producer_members[0].workflow = null; value.lanes[0].owner_workflow = null; },
    (value) => { value.lanes[0].enforcement = "invalid"; },
    (value) => { value.lanes[0].kpi_required = false; },
    (value) => { value.lanes[0].enforcement = "shadow"; value.lanes[0].kpi_required = false; },
    (value) => { const lane = value.lanes.find((item) => item.id === "sec_13f"); lane.enforcement = "live"; lane.kpi_required = true; },
    (value) => { value.lanes.find((item) => item.id === "treasury_tga").enforcement = "shadow"; },
    (value) => { value.lanes.find((item) => item.id === "treasury_tga").kpi_required = false; },
  ];
  for (const mutate of invalidConfigs) {
    const invalid = clone(DATA_SUPPLY_DETECTION_CONFIG);
    mutate(invalid);
    assert.throws(() => validateDetectionConfig(invalid), TypeError);
  }
  assert.equal(validateAttemptEvidence(attemptsFixture), true);
  assert.equal(validateCalendars(calendarsFixture), undefined);
  const canonicalCalendars = readJson(CALENDAR_PATH);
  assert.deepEqual(canonicalCalendars, calendarsFixture, "promoted calendar SSOT matches the proven fixture byte-for-data");
  assert.equal(validateCalendars(canonicalCalendars), undefined);
  assert.equal(validateConfigCalendarBindings(DATA_SUPPLY_DETECTION_CONFIG, canonicalCalendars), true);
  const missingCadenceContract = clone(canonicalCalendars);
  missingCadenceContract.schedules = missingCadenceContract.schedules.filter((row) => row.id !== "six_hourly");
  assertThrowsCode(() => validateConfigCalendarBindings(DATA_SUPPLY_DETECTION_CONFIG, missingCadenceContract), "calendar_error");
  assert.equal(validateArtifactFixture(artifactsFixture), true);
  const invalidArtifactFixtures = [
    (value) => { value.layouts[0].nodes[0].path = "/absolute.json"; },
    (value) => { value.layouts[0].nodes[0].path = "data/../escape.json"; },
    (value) => { value.layouts[0].nodes.push(clone(value.layouts[0].nodes[0])); },
    (value) => { value.layouts[0].nodes[0].unexpected = true; },
    (value) => { value.layouts[0].nodes[0].document_id = "missing_document"; },
    (value) => { value.layouts.find((layout) => layout.id === "symlink_artifact").nodes[0].target = "/tmp/escape.json"; },
    (value) => { value.layouts.find((layout) => layout.id === "symlink_artifact").nodes[0].target = "../../../escape.json"; },
    (value) => { value.layouts[0].nodes.push({ path: "data/macro", node_type: "symlink", target: "safe-target" }); },
  ];
  for (const mutate of invalidArtifactFixtures) {
    const invalid = clone(artifactsFixture);
    mutate(invalid);
    assert.throws(() => validateArtifactFixture(invalid));
  }
  assert.equal(new Set(attemptsFixture.attempts.map((row) => `${row.lane_id}:${row.member_id ?? "_"}`)).size, 20);
}

function shardDocument(laneId, source = attemptsFixture) {
  return {
    schema_version: ATTEMPT_SHARD_SCHEMA,
    lane_id: laneId,
    attempts: source.attempts.filter((row) => row.lane_id === laneId),
  };
}

function writeShard(root, fileLaneId, document = shardDocument(fileLaneId)) {
  const filePath = path.join(root.raw, `${fileLaneId}.json`);
  fs.writeFileSync(filePath, `${canonicalJson(document)}\n`, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

function runAttemptShardChecks(artifactRoot) {
  const empty = makeOwnedRoot();
  const emptyMerged = loadAttemptShards({ shardRoot: empty.raw });
  assert.deepEqual(emptyMerged, { schema_version: ATTEMPT_SCHEMA, attempts: [] });
  const emptyReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: emptyMerged, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  assert.equal(emptyReport.lanes.filter((row) => row.endpoint.reason === "workflow_unobserved").length, 16, "empty private root keeps all lanes explicitly unobserved");

  const root = makeOwnedRoot();
  writeShard(root, "treasury_tga");
  assert.equal(validateAttemptShard(shardDocument("treasury_tga"), "treasury_tga"), true);
  const merged = loadAttemptShards({ shardRoot: root.raw });
  assert.equal(merged.schema_version, ATTEMPT_SCHEMA);
  assert.deepEqual(merged.attempts, attemptsFixture.attempts.filter((row) => row.lane_id === "treasury_tga"));
  const report = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: merged, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  assert.equal(lane(report, "treasury_tga").endpoint.reason, "ok");
  assert.equal(lane(report, "fred_macro").endpoint.reason, "workflow_unobserved", "missing lane shard is unobserved");

  const multi = makeOwnedRoot();
  writeShard(multi, "treasury_tga");
  writeShard(multi, "fred_macro");
  assert.deepEqual(loadAttemptShards({ shardRoot: multi.raw }).attempts.map((row) => row.lane_id), ["fred_macro", "treasury_tga"], "merge follows config order, not directory order");

  const incomplete = shardDocument("slickcharts");
  incomplete.attempts.pop();
  assertThrowsCode(() => validateAttemptShard(incomplete, "slickcharts"), "schema_error");

  const mismatched = makeOwnedRoot();
  writeShard(mismatched, "treasury_tga", shardDocument("fred_macro"));
  assertThrowsCode(() => loadAttemptShards({ shardRoot: mismatched.raw }), "schema_error");

  const unexpected = makeOwnedRoot();
  fs.writeFileSync(path.join(unexpected.raw, "README.txt"), "not a shard\n", { mode: 0o600 });
  assertThrowsCode(() => loadAttemptShards({ shardRoot: unexpected.raw }), "unsafe_path");

  const symlinked = makeOwnedRoot();
  fs.symlinkSync(ATTEMPTS_PATH, path.join(symlinked.raw, "treasury_tga.json"));
  assertThrowsCode(() => loadAttemptShards({ shardRoot: symlinked.raw }), "unsafe_path");

  const hardlinkedSource = makeOwnedRoot();
  const sourcePath = writeShard(hardlinkedSource, "treasury_tga");
  const hardlinked = makeOwnedRoot();
  fs.linkSync(sourcePath, path.join(hardlinked.raw, "treasury_tga.json"));
  assertThrowsCode(() => loadAttemptShards({ shardRoot: hardlinked.raw }), "unsafe_path");
}

function runBaselineAndArtifactChecks() {
  const artifactRoot = materializeArtifacts("all_valid");
  const report = buildDetectionReport({
    artifactRoot: artifactRoot.raw,
    attempts: attemptsFixture,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.deepEqual(report, expectedFixture.baseline.expected_report);
  assert.equal(createSha(reportBytes(report)), expectedFixture.baseline.report_file_sha256);

  const externalProducerConfig = clone(DATA_SUPPLY_DETECTION_CONFIG);
  const externalProducerLane = externalProducerConfig.lanes.find((item) => item.id === "fred_macro");
  externalProducerLane.owner_workflow = null;
  externalProducerLane.producer_members[0].workflow = null;
  externalProducerLane.producer_members[0].cadence_declaration = {
    kind: "payload_field",
    evidence: "/update_frequency",
  };
  const externalProducerReport = buildDetectionReport({
    config: externalProducerConfig,
    artifactRoot: artifactRoot.raw,
    attempts: attemptsFixture,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(externalProducerReport, "fred_macro").endpoint.reason, "ok", "external producer cadence is evaluated without a GitHub workflow");

  const modifiedConfig = clone(DATA_SUPPLY_DETECTION_CONFIG);
  modifiedConfig.lanes[0].freshness.max_staleness += 1;
  assert.equal(validateDetectionConfig(modifiedConfig), true);
  const modifiedReport = buildDetectionReport({ config: modifiedConfig, artifactRoot: artifactRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  assert.notEqual(modifiedReport.config_digest, report.config_digest);
  assert.equal(validateDetectionReport(modifiedReport, modifiedConfig), true);
  assertThrowsCode(() => validateDetectionReport(modifiedReport), "schema_error");
  const modifiedOutput = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  projectReportAtomic({ report: modifiedReport, config: modifiedConfig, outputRoot: modifiedOutput.raw, artifactRoot: artifactRoot.raw, tempToken: "00000000000000a0" });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(modifiedOutput.raw, REPORT_BASENAME), "utf8")), modifiedReport);
  const wrongConfigOutput = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  assertThrowsCode(() => projectReportAtomic({ report: modifiedReport, outputRoot: wrongConfigOutput.raw, artifactRoot: artifactRoot.raw, tempToken: "00000000000000a1" }), "schema_error");
  assert.deepEqual(fs.readdirSync(wrongConfigOutput.raw), []);

  const overlappingGlobConfig = clone(DATA_SUPPLY_DETECTION_CONFIG);
  const edgarMember = overlappingGlobConfig.lanes.find((row) => row.id === "edgar_filings").producer_members[0];
  const overlappingContract = clone(edgarMember.artifact_contracts.find((contract) => contract.selection === "all"));
  overlappingContract.id = "edgar_overlapping_glob";
  overlappingContract.path = "data/edgar-korean-summaries/by-ticker/a*.json";
  edgarMember.artifact_contracts.push(overlappingContract);
  assert.equal(validateDetectionConfig(overlappingGlobConfig), true);
  assertThrowsCode(() => buildDetectionReport({ config: overlappingGlobConfig, artifactRoot: artifactRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now }), "schema_error");
  assert.equal(lane(report, "edgar_filings").artifact.source_as_of, "2026-07-10", "bounded glob folds deterministic sorted matches");

  for (const artifactCase of expectedFixture.artifact_cases) {
    const variantRoot = materializeArtifacts(artifactCase.layout_id);
    if (artifactCase.expected_reason) {
      const variant = buildDetectionReport({ artifactRoot: variantRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now });
      const variantLane = lane(variant, artifactCase.lane_id ?? "fred_macro");
      assert.equal(variantLane.reason, artifactCase.expected_reason, artifactCase.layout_id);
      if (artifactCase.expected_status) assert.equal(variantLane.status, artifactCase.expected_status, artifactCase.layout_id);
    } else {
      assertThrowsCode(() => buildDetectionReport({ artifactRoot: variantRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now }), "unsafe_path");
    }
  }
  const inconsistentSoxRoot = materializeArtifacts("all_valid");
  const inconsistentSoxPath = path.join(inconsistentSoxRoot.raw, "data", "indices", "nasdaq-giw-sox-constituents.json");
  const inconsistentSox = JSON.parse(fs.readFileSync(inconsistentSoxPath, "utf8"));
  inconsistentSox.symbols[0] = "MISMATCH";
  fs.writeFileSync(inconsistentSoxPath, JSON.stringify(inconsistentSox));
  const inconsistentSoxReport = buildDetectionReport({
    artifactRoot: inconsistentSoxRoot.raw,
    attempts: attemptsFixture,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(inconsistentSoxReport, "nasdaq_giw_sox").artifact.reason, "schema_drift",
    "SOX artifact symbols and normalized rows must remain identity-bound");
  const externalSentinelRoot = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const externalSentinel = path.join(externalSentinelRoot.raw, "sentinel.json");
  const sentinelBytes = Buffer.from('{"must_remain":"untouched"}\n', "utf8");
  fs.writeFileSync(externalSentinel, sentinelBytes, { mode: 0o600 });
  const symlinkEscapeRoot = materializeArtifacts("all_valid");
  const symlinkArtifact = path.join(symlinkEscapeRoot.raw, "data", "macro", "fred-macro.json");
  fs.unlinkSync(symlinkArtifact);
  fs.symlinkSync(externalSentinel, symlinkArtifact);
  assertThrowsCode(() => buildDetectionReport({ artifactRoot: symlinkEscapeRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now }), "unsafe_path");
  assert.deepEqual(fs.readFileSync(externalSentinel), sentinelBytes);
  return { artifactRoot, report };
}

function createSha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runAttemptChecks(artifactRoot) {
  const mapping = {
    transport_exception: "transport_error",
    unexpected_exception: "unexpected_error",
    http_non_2xx: "http_error",
    auth_rejected: "auth_error",
    rate_limited: "rate_limited",
    decode_error: "decode_error",
    empty_payload: "empty_payload",
    assertion_failed: "schema_drift",
    unobserved: "workflow_unobserved",
  };
  for (const reasonCase of expectedFixture.reason_cases) {
    const reason = mapping[reasonCase.id];
    const row = legalAttempt(reason);
    assert.equal(validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [row] }), true);
    assert.equal(classifyAttempt(row).reason, reasonCase.expected_reason);
  }
  const brokenSoxEndpoint = clone(attemptsFixture);
  const soxAttempt = brokenSoxEndpoint.attempts.find((row) => row.lane_id === "nasdaq_giw_sox");
  soxAttempt.assertions[0].passed = false;
  const brokenSoxReport = buildDetectionReport({
    artifactRoot: artifactRoot.raw,
    attempts: brokenSoxEndpoint,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(brokenSoxReport, "nasdaq_giw_sox").reason, "schema_drift");
  const contradiction = legalAttempt("http_error");
  contradiction.decode = "ok";
  assertThrowsCode(() => validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [contradiction] }), "schema_error");
  const unknownAttempt = { ...legalAttempt("transport_error"), unexpected: true };
  assertThrowsCode(() => validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [unknownAttempt] }), "schema_error");
  const missingAttemptField = legalAttempt("transport_error");
  delete missingAttemptField.auth;
  assertThrowsCode(() => validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [missingAttemptField] }), "schema_error");

  const staleAttempt = clone(attemptsFixture);
  staleAttempt.attempts.find((row) => row.lane_id === "fred_macro").observed_at = "2026-07-08T00:00:00Z";
  const staleAttemptReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: staleAttempt, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  assert.equal(lane(staleAttemptReport, "fred_macro").endpoint.reason, "stale");
  const futureAttempt = clone(attemptsFixture);
  futureAttempt.attempts.find((row) => row.lane_id === "fred_macro").observed_at = "2026-07-11T00:00:01Z";
  const futureAttemptReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: futureAttempt, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  assert.equal(lane(futureAttemptReport, "fred_macro").endpoint.reason, "future_source");

  const missingScheduledRow = clone(attemptsFixture);
  missingScheduledRow.attempts = missingScheduledRow.attempts.filter((row) => row.lane_id !== "fred_macro");
  assert.equal(validateAttemptEvidence(missingScheduledRow), true);
  const missingScheduledReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: missingScheduledRow, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  assert.equal(missingScheduledReport.logical_lane_count, 16);
  assert.equal(missingScheduledReport.producer_member_count, 20);
  assert.equal(lane(missingScheduledReport, "fred_macro").endpoint.reason, "workflow_unobserved");

  const missingCompositeRow = clone(attemptsFixture);
  missingCompositeRow.attempts = missingCompositeRow.attempts.filter((row) => !(row.lane_id === "slickcharts" && row.member_id === "weekly"));
  assert.equal(validateAttemptEvidence(missingCompositeRow), true);
  const missingCompositeReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: missingCompositeRow, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  const missingWeekly = lane(missingCompositeReport, "slickcharts");
  assert.equal(missingCompositeReport.logical_lane_count, 16);
  assert.equal(missingCompositeReport.producer_member_count, 20);
  assert.equal(missingWeekly.status, "unobserved");
  assert.equal(missingWeekly.reason, "workflow_unobserved");
  assert.equal(missingWeekly.members.find((member) => member.id === "weekly").endpoint.reason, "workflow_unobserved");

  const ownerlessReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  for (const id of ["sec_13f", "apewisdom_attention", "gdelt_news_tone"]) {
    assert.equal(lane(ownerlessReport, id).endpoint.reason, "workflow_unobserved", id);
  }
  assert.equal(lane(ownerlessReport, "apewisdom_attention").artifact.age, 1);
  assert.equal(lane(ownerlessReport, "gdelt_news_tone").artifact.age, 1);

  for (const memberCase of expectedFixture.slickcharts_member_worst_cases) {
    const broken = replaceAttempt(attemptsFixture, "slickcharts", memberCase.member_id, legalAttempt("transport_error"));
    const index = broken.attempts.findIndex((row) => row.lane_id === "slickcharts" && row.member_id === memberCase.member_id);
    broken.attempts[index].attempt_id = `attempt-slick-${memberCase.member_id}-broken`;
    validateAttemptEvidence(broken);
    const report = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: broken, calendars: calendarsFixture, now: expectedFixture.baseline.now });
    const slick = lane(report, "slickcharts");
    assert.equal(slick.status, memberCase.expected_logical_status);
    assert.equal(slick.members.length, 5);
    assert.equal(slick.members.find((member) => member.id === memberCase.member_id).reason, "transport_error");
  }
}

function runCompositeSourceFoldChecks() {
  const artifactRoot = materializeArtifacts("all_valid");
  const symbolsPath = path.join(artifactRoot.raw, "data", "slickcharts", "symbols.json");
  const symbols = JSON.parse(fs.readFileSync(symbolsPath, "utf8"));
  symbols.history[0].date = "2026-06-15";
  fs.writeFileSync(symbolsPath, JSON.stringify(symbols), { encoding: "utf8", mode: 0o600 });
  const readyReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  const readySlick = lane(readyReport, "slickcharts");
  const symbolsMember = readySlick.members.find((member) => member.id === "symbols");
  assert.equal(readySlick.status, "ready");
  assert.equal(readySlick.artifact.source_as_of, "2026-06-15");
  assert.equal(readySlick.artifact.age, symbolsMember.artifact.age);

  const staleRoot = materializeArtifacts("all_valid");
  const dailyPath = path.join(staleRoot.raw, "data", "slickcharts", "gainers.json");
  const daily = JSON.parse(fs.readFileSync(dailyPath, "utf8"));
  daily.history[0].date = "2026-01-01";
  fs.writeFileSync(dailyPath, JSON.stringify(daily), { encoding: "utf8", mode: 0o600 });
  const report = buildDetectionReport({ artifactRoot: staleRoot.raw, attempts: attemptsFixture, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  const slick = lane(report, "slickcharts");
  assert.equal(slick.status, "stale");
  assert.equal(slick.artifact.reason, "stale");
  assert.equal(slick.artifact.source_as_of, "2026-01-01");
  assert.equal(slick.artifact.age, slick.members.find((member) => member.id === "daily").artifact.age);
}

function runCalendarChecks() {
  for (const fixtureCase of calendarsFixture.cases) {
    if (fixtureCase.kind === "schedule") {
      const schedule = calendarsFixture.schedules.find((row) => row.id === fixtureCase.schedule_id);
      assert.ok(schedule, fixtureCase.schedule_id);
      const result = evaluateAttemptCadence(fixtureCase.observed_at, [schedule.cron], schedule.calendar_id, fixtureCase.now, calendarsFixture);
      assert.equal(result.reason === "ok" ? "ready" : result.reason, fixtureCase.expected, fixtureCase.id);
      continue;
    }
    if (fixtureCase.expected === "workflow_unobserved") {
      const cadence = evaluateAttemptCadence(null, [], fixtureCase.calendar_id, fixtureCase.now, calendarsFixture);
      assert.equal(cadence.reason, "workflow_unobserved", fixtureCase.id);
      const freshness = evaluateFreshness(fixtureCase.source_as_of, { unit: fixtureCase.unit, calendar: fixtureCase.calendar_id, due_policy: fixtureCase.due_policy }, fixtureCase.now, calendarsFixture);
      assert.equal(freshness.reason, "ok", `${fixtureCase.id}: artifact age remains independent`);
      continue;
    }
    const policy = fixtureCase.unit === "due_window"
      ? { unit: fixtureCase.unit, calendar: fixtureCase.calendar_id, due_policy: fixtureCase.due_policy }
      : { unit: fixtureCase.unit, calendar: fixtureCase.calendar_id, max_staleness: fixtureCase.max_staleness };
    const result = evaluateFreshness(fixtureCase.source_as_of, policy, fixtureCase.now, calendarsFixture);
    assert.equal(result.reason === "ok" ? "ready" : result.reason, fixtureCase.expected, fixtureCase.id);
  }
}

function runAtomicAdapterChecks({ artifactRoot, report, changedReport, physicalParent }) {
  let tokenCounter = 0x100;
  const nextToken = () => (tokenCounter++).toString(16).padStart(16, "0");
  const seed = () => {
    const root = makeOwnedRoot(physicalParent);
    projectReportAtomic({ report, outputRoot: root.raw, artifactRoot: artifactRoot.raw, tempToken: nextToken() });
    return { root, prior: fs.readFileSync(path.join(root.raw, REPORT_BASENAME)) };
  };
  const assertPriorFailure = (label, adapterFactory) => {
    const { root, prior } = seed();
    const adapter = adapterFactory(root);
    captureThrow(() => projectReportAtomic({ report: changedReport, outputRoot: root.raw, artifactRoot: artifactRoot.raw, tempToken: nextToken(), fsModule: adapter }));
    assert.deepEqual(fs.readFileSync(path.join(root.raw, REPORT_BASENAME)), prior, label);
    assert.deepEqual(fs.readdirSync(root.raw), [REPORT_BASENAME], label);
  };

  for (const mode of ["zero", "short"]) {
    assertPriorFailure(`${mode} write`, () => createFsAdapter({
      writeSync(_fd, _buffer, _offset, length) {
        return mode === "zero" ? 0 : length - 1;
      },
    }));
  }
  assertPriorFailure("temp fsync", () => {
    let failed = false;
    return createFsAdapter({
      fsyncSync(fd) {
        if (!failed) {
          failed = true;
          throw new Error("injected temp fsync failure");
        }
        return fs.fsyncSync(fd);
      },
    });
  });
  assertPriorFailure("temp close", () => {
    let tempFd = null;
    let failed = false;
    return createFsAdapter({
      openSync(filePath, flags, ...rest) {
        const fd = fs.openSync(filePath, flags, ...rest);
        if (String(filePath).includes(`.${REPORT_BASENAME}.`) && (flags & fs.constants.O_WRONLY) !== 0) tempFd = fd;
        return fd;
      },
      closeSync(fd) {
        if (fd === tempFd && !failed) {
          failed = true;
          throw new Error("injected temp close failure");
        }
        return fs.closeSync(fd);
      },
    });
  });
  assertPriorFailure("temp readback", () => {
    let tempReadFd = null;
    return createFsAdapter({
      openSync(filePath, flags, ...rest) {
        const fd = fs.openSync(filePath, flags, ...rest);
        if (String(filePath).includes(`.${REPORT_BASENAME}.`) && (flags & fs.constants.O_WRONLY) === 0) tempReadFd = fd;
        return fd;
      },
      readFileSync(target, ...rest) {
        if (target === tempReadFd) return Buffer.from("{}\n", "utf8");
        return fs.readFileSync(target, ...rest);
      },
    });
  });
  assertPriorFailure("rename", () => createFsAdapter({
    renameSync() {
      throw new Error("injected rename failure");
    },
  }));

  const finalReadRoot = seed().root;
  let renamed = false;
  let finalReadFd = null;
  const finalReadAdapter = createFsAdapter({
    renameSync(from, to) {
      fs.renameSync(from, to);
      renamed = true;
    },
    openSync(filePath, flags, ...rest) {
      const fd = fs.openSync(filePath, flags, ...rest);
      if (renamed && String(filePath) === path.join(finalReadRoot.raw, REPORT_BASENAME) && (flags & fs.constants.O_WRONLY) === 0) finalReadFd = fd;
      return fd;
    },
    readFileSync(target, ...rest) {
      if (target === finalReadFd) return Buffer.from("{}\n", "utf8");
      return fs.readFileSync(target, ...rest);
    },
  });
  captureThrow(() => projectReportAtomic({ report: changedReport, outputRoot: finalReadRoot.raw, artifactRoot: artifactRoot.raw, tempToken: nextToken(), fsModule: finalReadAdapter }));
  assert.deepEqual(fs.readFileSync(path.join(finalReadRoot.raw, REPORT_BASENAME)), reportBytes(changedReport));
  assert.deepEqual(fs.readdirSync(finalReadRoot.raw), [REPORT_BASENAME]);

  const parentFsyncRoot = seed().root;
  let rootFd = null;
  const parentFsyncAdapter = createFsAdapter({
    openSync(filePath, flags, ...rest) {
      const fd = fs.openSync(filePath, flags, ...rest);
      if (String(filePath) === fs.realpathSync.native(parentFsyncRoot.raw) && (flags & fs.constants.O_DIRECTORY) !== 0) rootFd = fd;
      return fd;
    },
    fsyncSync(fd) {
      if (fd === rootFd) throw new Error("injected parent fsync failure");
      return fs.fsyncSync(fd);
    },
  });
  captureThrow(() => projectReportAtomic({ report: changedReport, outputRoot: parentFsyncRoot.raw, artifactRoot: artifactRoot.raw, tempToken: nextToken(), fsModule: parentFsyncAdapter }));
  assert.deepEqual(fs.readFileSync(path.join(parentFsyncRoot.raw, REPORT_BASENAME)), reportBytes(changedReport));
  assert.deepEqual(fs.readdirSync(parentFsyncRoot.raw), [REPORT_BASENAME]);

  const flagRoot = makeOwnedRoot(physicalParent);
  const openEvents = [];
  const flagAdapter = createFsAdapter({
    openSync(filePath, flags, ...rest) {
      openEvents.push({ path: String(filePath), flags });
      return fs.openSync(filePath, flags, ...rest);
    },
  });
  projectReportAtomic({ report, outputRoot: flagRoot.raw, artifactRoot: artifactRoot.raw, tempToken: nextToken(), fsModule: flagAdapter });
  const tempOpens = openEvents.filter((event) => event.path.includes(`.${REPORT_BASENAME}.`));
  assert.equal(tempOpens.length, 2);
  assert.ok((tempOpens[0].flags & fs.constants.O_CREAT) !== 0 && (tempOpens[0].flags & fs.constants.O_EXCL) !== 0 && (tempOpens[0].flags & fs.constants.O_NOFOLLOW) !== 0);
  assert.ok((tempOpens[1].flags & fs.constants.O_NOFOLLOW) !== 0 && (tempOpens[1].flags & fs.constants.O_WRONLY) === 0);

  const hooks = [
    "before_temp_open",
    "after_temp_open",
    "mid_write",
    "after_temp_fsync",
    "after_temp_validation",
    "before_rename",
    "after_rename_before_parent_fsync",
    "after_parent_fsync",
  ];
  const postRenameHooks = new Set(["after_rename_before_parent_fsync", "after_parent_fsync"]);
  for (const hook of hooks) {
    const { root, prior } = seed();
    let driftPath = null;
    let remainingDriftReads = 0;
    const adapter = createFsAdapter({
      lstatSync(filePath, ...rest) {
        const stat = fs.lstatSync(filePath, ...rest);
        if (remainingDriftReads > 0 && String(filePath) === driftPath) {
          remainingDriftReads -= 1;
          return driftedStat(stat);
        }
        return stat;
      },
    });
    const error = captureThrow(() => projectReportAtomic({
      report: changedReport,
      outputRoot: root.raw,
      artifactRoot: artifactRoot.raw,
      tempToken: nextToken(),
      fsModule: adapter,
      failpoint(name, { context }) {
        if (name === hook) {
          driftPath = context.output.real;
          remainingDriftReads = 1;
        }
      },
    }));
    assert.equal(error.code, "unsafe_path", hook);
    const expected = postRenameHooks.has(hook) ? reportBytes(changedReport) : prior;
    assert.deepEqual(fs.readFileSync(path.join(root.raw, REPORT_BASENAME)), expected, hook);
    assert.deepEqual(fs.readdirSync(root.raw), [REPORT_BASENAME], hook);
  }
}

function runPathAndAtomicChecks(artifactRoot, report) {
  const physicalParent = fs.realpathSync.native(os.tmpdir());
  const physicalOutput = makeOwnedRoot(physicalParent);
  assert.equal(pathsOverlap(physicalOutput.real, artifactRoot.real), false, "sibling string prefixes remain physically disjoint");
  const first = projectReportAtomic({ report, outputRoot: physicalOutput.raw, artifactRoot: artifactRoot.raw, tempToken: "0000000000000001" });
  assert.equal(first.report_file_sha256, expectedFixture.baseline.report_file_sha256);
  assert.deepEqual(fs.readdirSync(physicalOutput.raw), [REPORT_BASENAME]);

  const aliasParent = process.platform === "darwin" && fs.existsSync("/var/tmp") ? "/var/tmp" : os.tmpdir();
  const aliasOutput = makeOwnedRoot(aliasParent);
  const aliasInfo = canonicalExistingDirectory(aliasOutput.raw, { secure: true });
  const aliasResult = projectReportAtomic({ report, outputRoot: aliasOutput.raw, artifactRoot: artifactRoot.raw, tempToken: "0000000000000002" });
  assert.equal(aliasResult.report_file_sha256, first.report_file_sha256);
  assert.deepEqual(fs.readFileSync(aliasResult.report_path), fs.readFileSync(first.report_path));
  assert.equal(path.dirname(aliasResult.report_path), aliasInfo.real);
  const physicalSpellingResult = projectReportAtomic({ report, outputRoot: aliasInfo.real, artifactRoot: artifactRoot.raw, tempToken: "0000000000000005" });
  assert.equal(physicalSpellingResult.report_path, aliasResult.report_path);
  assert.equal(physicalSpellingResult.report_file_sha256, aliasResult.report_file_sha256);
  if (process.platform === "darwin" && aliasOutput.raw.startsWith("/var/")) assert.ok(aliasInfo.real.startsWith("/private/var/"));

  const changedReport = { ...report, generated_at: "2026-07-11T00:00:01Z" };
  const second = projectReportAtomic({ report: changedReport, outputRoot: physicalOutput.raw, artifactRoot: artifactRoot.raw, tempToken: "0000000000000003" });
  assert.notEqual(second.report_file_sha256, first.report_file_sha256);
  assert.deepEqual(fs.readFileSync(path.join(physicalOutput.raw, REPORT_BASENAME)), reportBytes(changedReport));
  assert.deepEqual(fs.readdirSync(physicalOutput.raw), [REPORT_BASENAME]);

  assertThrowsCode(() => prepareOutputContext({ outputRoot: "relative", artifactRoot: artifactRoot.raw }), "unsafe_path");
  assertThrowsCode(() => prepareOutputContext({ outputRoot: "", artifactRoot: artifactRoot.raw }), "unsafe_path");
  assertThrowsCode(() => prepareOutputContext({ outputRoot: `${physicalParent}/bad\0root`, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assertThrowsCode(() => prepareOutputContext({ outputRoot: path.join(physicalParent, "missing-dfloor-root"), artifactRoot: artifactRoot.raw }), "unsafe_path");
  assertThrowsCode(() => prepareOutputContext({ outputRoot: REPO_ROOT, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assertThrowsCode(() => prepareOutputContext({ outputRoot: artifactRoot.raw, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assertThrowsCode(() => prepareOutputContext({ outputRoot: `${physicalOutput.raw}/./child`, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assertThrowsCode(() => prepareOutputContext({ outputRoot: `${physicalOutput.raw}/../${path.basename(physicalOutput.raw)}`, artifactRoot: artifactRoot.raw }), "unsafe_path");
  for (const protectedPath of [
    path.resolve(REPO_ROOT, "../.."),
    path.join(REPO_ROOT, "data"),
    path.join(REPO_ROOT, "100xfenok-next", "public"),
    path.join(REPO_ROOT, "100xfenok-next", ".next"),
    path.join(REPO_ROOT, "100xfenok-next", ".open-next"),
    path.join(REPO_ROOT, "dist"),
    path.join(REPO_ROOT, "build"),
  ]) {
    if (fs.existsSync(protectedPath)) assertThrowsCode(() => prepareOutputContext({ outputRoot: protectedPath, artifactRoot: artifactRoot.raw }), "unsafe_path");
  }

  const insideContainer = makeOwnedRoot(physicalParent);
  const insideProtected = path.join(insideContainer.raw, "protected");
  const insideOutput = path.join(insideProtected, "output");
  fs.mkdirSync(insideOutput, { recursive: true, mode: 0o700 });
  fs.chmodSync(insideProtected, 0o700);
  fs.chmodSync(insideOutput, 0o700);
  assertThrowsCode(() => prepareOutputContext({ outputRoot: insideOutput, artifactRoot: insideProtected }), "unsafe_path");

  const containingOutput = makeOwnedRoot(physicalParent);
  const containedArtifact = path.join(containingOutput.raw, "artifact");
  fs.mkdirSync(containedArtifact, { mode: 0o700 });
  assertThrowsCode(() => prepareOutputContext({ outputRoot: containingOutput.raw, artifactRoot: containedArtifact }), "unsafe_path");

  const prefixContainer = makeOwnedRoot(physicalParent);
  const prefixArtifact = path.join(prefixContainer.raw, "artifact");
  const prefixOutput = path.join(prefixContainer.raw, "artifact-safe");
  fs.mkdirSync(prefixArtifact, { mode: 0o700 });
  fs.mkdirSync(prefixOutput, { mode: 0o700 });
  const prefixResult = projectReportAtomic({ report, outputRoot: prefixOutput, artifactRoot: prefixArtifact, tempToken: "0000000000000004" });
  assert.equal(prefixResult.report_path, path.join(fs.realpathSync.native(prefixOutput), REPORT_BASENAME));

  const linkTarget = makeOwnedRoot(physicalParent);
  const linkContainer = makeOwnedRoot(physicalParent);
  const linkPath = path.join(linkContainer.raw, "output-link");
  fs.symlinkSync(linkTarget.raw, linkPath);
  try {
    assertThrowsCode(() => prepareOutputContext({ outputRoot: linkPath, artifactRoot: artifactRoot.raw }), "unsafe_path");
  } finally {
    fs.unlinkSync(linkPath);
  }

  const ancestorLinkRoot = makeOwnedRoot(physicalParent);
  const repositoryAlias = path.join(ancestorLinkRoot.raw, "repository-alias");
  fs.symlinkSync(REPO_ROOT, repositoryAlias);
  assertThrowsCode(() => prepareOutputContext({ outputRoot: path.join(repositoryAlias, "scripts"), artifactRoot: artifactRoot.raw }), "unsafe_path");

  const extraRoot = makeOwnedRoot(physicalParent);
  const extraPath = path.join(extraRoot.raw, "extra.txt");
  fs.writeFileSync(extraPath, "blocked", { mode: 0o600 });
  assertThrowsCode(() => prepareOutputContext({ outputRoot: extraRoot.raw, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assert.equal(fs.readFileSync(extraPath, "utf8"), "blocked");

  const staleTempRoot = makeOwnedRoot(physicalParent);
  const staleTempPath = path.join(staleTempRoot.raw, `.${REPORT_BASENAME}.999.0000000000000000.tmp`);
  fs.writeFileSync(staleTempPath, "stale", { mode: 0o600 });
  assertThrowsCode(() => prepareOutputContext({ outputRoot: staleTempRoot.raw, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assert.equal(fs.readFileSync(staleTempPath, "utf8"), "stale");

  const invalidFinalRoot = makeOwnedRoot(physicalParent);
  const invalidFinalPath = path.join(invalidFinalRoot.raw, REPORT_BASENAME);
  fs.writeFileSync(invalidFinalPath, "{}\n", { mode: 0o600 });
  assertThrowsCode(() => prepareOutputContext({ outputRoot: invalidFinalRoot.raw, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assert.equal(fs.readFileSync(invalidFinalPath, "utf8"), "{}\n");

  const specialFinalRoot = makeOwnedRoot(physicalParent);
  const fifoResult = spawnSync("/usr/bin/mkfifo", [path.join(specialFinalRoot.raw, REPORT_BASENAME)], { encoding: "utf8" });
  assert.equal(fifoResult.status, 0, fifoResult.stderr);
  assertThrowsCode(() => prepareOutputContext({ outputRoot: specialFinalRoot.raw, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assert.equal(fs.lstatSync(path.join(specialFinalRoot.raw, REPORT_BASENAME)).isFIFO(), true);

  const finalSymlinkRoot = makeOwnedRoot(physicalParent);
  const escapeTarget = path.join(makeOwnedRoot(physicalParent).raw, "escape.json");
  fs.symlinkSync(escapeTarget, path.join(finalSymlinkRoot.raw, REPORT_BASENAME));
  assertThrowsCode(() => prepareOutputContext({ outputRoot: finalSymlinkRoot.raw, artifactRoot: artifactRoot.raw }), "unsafe_path");
  assert.equal(fs.existsSync(escapeTarget), false);

  const maliciousRoot = makeOwnedRoot(physicalParent);
  assertThrowsCode(() => projectReportAtomic({ report: { ...report, raw_response_bodies: ["secret"] }, outputRoot: maliciousRoot.raw, artifactRoot: artifactRoot.raw }), "schema_error");
  assert.deepEqual(fs.readdirSync(maliciousRoot.raw), []);
  const nestedMalicious = clone(report);
  nestedMalicious.lanes[0].artifact.private_artifact_paths = ["/secret"];
  assertThrowsCode(() => projectReportAtomic({ report: nestedMalicious, outputRoot: maliciousRoot.raw, artifactRoot: artifactRoot.raw }), "schema_error");
  assert.deepEqual(fs.readdirSync(maliciousRoot.raw), []);

  const priorRoot = makeOwnedRoot(physicalParent);
  projectReportAtomic({ report, outputRoot: priorRoot.raw, artifactRoot: artifactRoot.raw, tempToken: "0000000000000010" });
  const priorBytes = fs.readFileSync(path.join(priorRoot.raw, REPORT_BASENAME));
  assert.equal(changedReport.schema_version, "data-supply-detection-floor/v1");
  assert.equal(changedReport.config_digest, configDigest());
  for (const [index, failpoint] of ["before_temp_open", "after_temp_open", "mid_write", "after_temp_fsync", "after_temp_validation", "before_rename"].entries()) {
    let caught = null;
    try {
      projectReportAtomic({ report: changedReport, outputRoot: priorRoot.raw, artifactRoot: artifactRoot.raw, tempToken: `00000000000001${String(index).padStart(2, "0")}`.slice(-16), failpoint });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught?.code, "injected_failure", `${failpoint}: ${caught?.message ?? "no error"}`);
    assert.deepEqual(fs.readFileSync(path.join(priorRoot.raw, REPORT_BASENAME)), priorBytes, failpoint);
    assert.deepEqual(fs.readdirSync(priorRoot.raw), [REPORT_BASENAME], failpoint);
  }
  assertThrowsCode(() => projectReportAtomic({ report: changedReport, outputRoot: priorRoot.raw, artifactRoot: artifactRoot.raw, tempToken: "0000000000000020", failpoint: "after_rename_before_parent_fsync" }), "injected_failure");
  assert.deepEqual(fs.readFileSync(path.join(priorRoot.raw, REPORT_BASENAME)), reportBytes(changedReport));
  assert.deepEqual(fs.readdirSync(priorRoot.raw), [REPORT_BASENAME]);
  const afterParentRoot = makeOwnedRoot(physicalParent);
  projectReportAtomic({ report, outputRoot: afterParentRoot.raw, artifactRoot: artifactRoot.raw, tempToken: "0000000000000021" });
  assertThrowsCode(() => projectReportAtomic({ report: changedReport, outputRoot: afterParentRoot.raw, artifactRoot: artifactRoot.raw, tempToken: "0000000000000022", failpoint: "after_parent_fsync" }), "injected_failure");
  assert.deepEqual(fs.readFileSync(path.join(afterParentRoot.raw, REPORT_BASENAME)), reportBytes(changedReport));
  assert.deepEqual(fs.readdirSync(afterParentRoot.raw), [REPORT_BASENAME]);
  assertThrowsCode(() => projectReportAtomic({ report, outputRoot: makeOwnedRoot(physicalParent).raw, artifactRoot: artifactRoot.raw, failpoint: "not_a_failpoint" }), "schema_error");

  runAtomicAdapterChecks({ artifactRoot, report, changedReport, physicalParent });
}

function runCliReproduction(artifactRoot) {
  const output = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const cliArgs = [
    BUILDER,
    "--artifact-root", artifactRoot.raw,
    "--attempt-evidence", ATTEMPTS_PATH,
    "--calendar-fixture", CALENDARS_PATH,
    "--now", expectedFixture.baseline.now,
    "--output-root", output.raw,
  ];
  const networkBlocker = `data:text/javascript,${encodeURIComponent("globalThis.fetch = () => { throw new Error('network invocation forbidden'); };")}`;
  const result = spawnSync(process.execPath, ["--import", networkBlocker, ...cliArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      ALL_PROXY: "http://127.0.0.1:1",
      FENOK_API_TOKEN: "must-not-be-read",
      GITHUB_TOKEN: "must-not-be-read",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.report_file_sha256, expectedFixture.baseline.report_file_sha256);
  const reportPath = path.join(output.raw, REPORT_BASENAME);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), expectedFixture.baseline.expected_report);
  assert.deepEqual(verifyDetectionReportFile({ reportPath }), {
    schema_version: expectedFixture.baseline.expected_report.schema_version,
    report_file_sha256: expectedFixture.baseline.report_file_sha256,
    logical_lane_count: 16,
    producer_member_count: 20,
  });
  const verifyCli = spawnSync(process.execPath, [BUILDER, "--verify-report", reportPath], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(verifyCli.status, 0, verifyCli.stderr);
  assert.deepEqual(JSON.parse(verifyCli.stdout), verifyDetectionReportFile({ reportPath }));

  const shardRoot = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  writeShard(shardRoot, "treasury_tga");
  const shardOutput = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const shardCliArgs = [
    BUILDER,
    "--artifact-root", artifactRoot.raw,
    "--attempt-shard-root", shardRoot.raw,
    "--calendars", CALENDAR_PATH,
    "--now", expectedFixture.baseline.now,
    "--output-root", shardOutput.raw,
  ];
  const shardCli = spawnSync(process.execPath, ["--import", networkBlocker, ...shardCliArgs], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(shardCli.status, 0, shardCli.stderr);
  const shardReportPath = path.join(shardOutput.raw, REPORT_BASENAME);
  const expectedShardReport = buildDetectionReport({
    artifactRoot: artifactRoot.raw,
    attempts: loadAttemptShards({ shardRoot: shardRoot.raw }),
    calendars: readJson(CALENDAR_PATH),
    now: expectedFixture.baseline.now,
  });
  assert.deepEqual(readJson(shardReportPath), expectedShardReport);
  assert.equal(lane(expectedShardReport, "treasury_tga").endpoint.status, "ready");
  assert.equal(lane(expectedShardReport, "fred_macro").endpoint.status, "unobserved");

  const nonCanonicalRoot = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const nonCanonicalReport = path.join(nonCanonicalRoot.raw, REPORT_BASENAME);
  fs.writeFileSync(nonCanonicalReport, JSON.stringify(expectedFixture.baseline.expected_report, null, 2), { mode: 0o600 });
  assertThrowsCode(() => verifyDetectionReportFile({ reportPath: nonCanonicalReport }), "schema_error");
  const linkedReportRoot = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const linkedReport = path.join(linkedReportRoot.raw, REPORT_BASENAME);
  fs.symlinkSync(reportPath, linkedReport);
  assertThrowsCode(() => verifyDetectionReportFile({ reportPath: linkedReport }), "unsafe_path");

  const verifierRoot = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const configPath = path.join(verifierRoot.raw, "config.json");
  fs.writeFileSync(configPath, `${canonicalJson(DATA_SUPPLY_DETECTION_CONFIG)}\n`, { encoding: "utf8", mode: 0o600 });
  const verifierSource = String.raw`
    const fs = require("node:fs");
    const { createHash } = require("node:crypto");
    const [configPath, reportPath, expectedPath, attemptsPath, artifactsPath, calendarsPath] = process.argv.slice(1);
    const hash = (value) => createHash("sha256").update(value).digest("hex");
    const canonicalize = (value) => {
      if (value === null || typeof value === "string" || typeof value === "boolean") return value;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("non-finite number");
        return Object.is(value, -0) ? 0 : value;
      }
      if (Array.isArray(value)) return value.map(canonicalize);
      if (typeof value !== "object") throw new Error("non-JSON value");
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    };
    const canonical = (value) => JSON.stringify(canonicalize(value));
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const reportBytes = fs.readFileSync(reportPath);
    const report = JSON.parse(reportBytes.toString("utf8"));
    const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
    const attempts = JSON.parse(fs.readFileSync(attemptsPath, "utf8"));
    const artifacts = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
    const calendars = JSON.parse(fs.readFileSync(calendarsPath, "utf8"));
    const pointer = (document, raw) => raw === "" ? document : raw.slice(1).split("/").reduce((value, token) => value == null ? undefined : value[token.replaceAll("~1", "/").replaceAll("~0", "~")], document);
    const reasonStatus = { ok: "ready", workflow_unobserved: "unobserved", stale: "stale", schema_drift: "drift", decode_error: "drift", missing_artifact: "unavailable", transport_error: "unavailable", http_error: "unavailable", auth_error: "unavailable", rate_limited: "unavailable", empty_payload: "unavailable", future_source: "unavailable", unexpected_error: "unavailable" };
    const severity = { ready: 0, unobserved: 1, stale: 2, drift: 3, unavailable: 4 };
    const classifyAttempt = (row) => {
      if (!row || row.execution === "unobserved") return "workflow_unobserved";
      if (row.execution === "threw") return row.exception_kind === "transport" ? "transport_error" : "unexpected_error";
      if (row.http_status === 401 || (row.http_status === 403 && row.auth === "rejected")) return "auth_error";
      if (row.http_status === 429) return "rate_limited";
      if (row.http_status < 200 || row.http_status >= 300) return "http_error";
      if (row.decode === "error") return "decode_error";
      if (row.payload === "empty") return "empty_payload";
      if (row.assertions.some((assertion) => assertion.passed === false)) return "schema_drift";
      return "ok";
    };
    const normalizeSource = (value, format) => {
      if (format === "date") return value;
      if (format === "yyyymmdd") return value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6, 8);
      if (format === "unix_seconds") return new Date(value * 1000).toISOString().replace(/\.000Z$/, "Z");
      if (format === "rfc3339") return new Date(value).toISOString().replace(/\.000Z$/, "Z");
      throw new Error("unknown source format");
    };
    const quarterEnd = (value) => {
      const match = /^(\d{4})-Q([1-4])$/.exec(value);
      const month = Number(match[2]) * 3;
      const day = new Date(Date.UTC(Number(match[1]), month, 0)).getUTCDate();
      return match[1] + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    };
    const sourceOf = (document, selector) => {
      if (selector.kind === "not_applicable") return null;
      let values;
      if (selector.kind === "pointer") values = [pointer(document, selector.pointer)];
      else if (selector.kind === "max_array_field") values = pointer(document, selector.pointer).map((row) => row[selector.field]);
      else if (selector.kind === "max_object_series_field") values = Object.values(pointer(document, selector.pointer)).flatMap((rows) => rows.map((row) => row[selector.field]));
      else if (selector.kind === "max_object_field") values = Object.values(pointer(document, selector.pointer)).map((row) => row[selector.field]);
      else if (selector.kind === "max_quarter") return pointer(document, selector.pointer).map(quarterEnd).sort().at(-1);
      else throw new Error("unknown source selector");
      return values.map((value) => normalizeSource(value, selector.format)).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
    };
    const assertionPasses = (document, assertion) => {
      const value = pointer(document, assertion.pointer);
      if (assertion.kind === "required_pointer") return value !== undefined;
      if (assertion.kind === "type") return assertion.expected === "array" ? Array.isArray(value) : assertion.expected === "null" ? value === null : typeof value === assertion.expected && !Array.isArray(value);
      if (assertion.kind === "exact") return canonical(value) === canonical(assertion.value);
      if (assertion.kind === "enum") return assertion.values.some((candidate) => canonical(candidate) === canonical(value));
      if (assertion.kind === "min_rows") return Array.isArray(value) && value.length >= assertion.min;
      if (assertion.kind === "min_keys") return value && !Array.isArray(value) && typeof value === "object" && Object.keys(value).length >= assertion.min;
      if (assertion.kind === "non_empty_series") return value && !Array.isArray(value) && Object.values(value).every((rows) => Array.isArray(rows) && rows.length > 0);
      if (assertion.kind === "object_array_fields") {
        if (!Array.isArray(value) || value.length < assertion.min) return false;
        const unique = new Set();
        return value.every((row) => {
          const identity = row?.[assertion.unique_by];
          const normalized = typeof identity === "string" ? identity.trim().toUpperCase() : identity;
          if (!row || Array.isArray(row) || typeof row !== "object"
            || Object.entries(assertion.fields).some(([field, type]) => typeof row[field] !== type)
            || assertion.non_empty_fields.some((field) => row[field].trim() === "") || unique.has(normalized)) return false;
          unique.add(normalized);
          return true;
        });
      }
      if (assertion.kind === "counted_identity_rows") {
        const count = value?.[assertion.count_field];
        const identities = value?.[assertion.identities_field];
        const rows = value?.[assertion.rows_field];
        if (!Number.isInteger(count) || count < assertion.min || !Array.isArray(identities) || !Array.isArray(rows)
          || identities.length !== count || rows.length !== count) return false;
        const unique = new Set();
        return rows.every((row, index) => {
          const identity = row?.[assertion.row_identity_field];
          const normalized = typeof identity === "string" ? identity.trim().toUpperCase() : identity;
          if (!row || Array.isArray(row) || typeof row !== "object" || row[assertion.row_rank_field] !== index + 1
            || assertion.row_string_fields.some((field) => typeof row[field] !== "string" || row[field].trim() === "")
            || identities[index] !== identity || unique.has(normalized)) return false;
          unique.add(normalized);
          return true;
        });
      }
      throw new Error("unknown assertion");
    };
    const documentMap = new Map(artifacts.documents.map((row) => [row.id, row]));
    const baseline = artifacts.layouts.find((row) => row.id === expected.baseline.artifact_layout_id);
    const baselineNodes = baseline.nodes;
    const nodesFor = (contract) => {
      if (contract.selection === "single") return baselineNodes.filter((node) => node.path === contract.path);
      const escaped = contract.path.split(".").join("\\.").replace("*", ".*");
      const matcher = new RegExp("^" + escaped + "$");
      return baselineNodes.filter((node) => matcher.test(node.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    };
    const calendarParts = (epoch, timezone) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epoch)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const ordinal = (value) => Math.floor(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)) / 86400000);
    const sourceOrdinal = (source, calendar) => /^\d{4}-\d{2}-\d{2}$/.test(source) ? Math.floor(Date.parse(source + "T00:00:00Z") / 86400000) : ordinal(calendarParts(Date.parse(source), calendar.timezone));
    const businessAge = (source, now, calendar) => {
      let cursor = sourceOrdinal(source, calendar) + 1;
      const end = ordinal(calendarParts(Date.parse(now), calendar.timezone));
      let count = 0;
      while (cursor <= end) {
        const date = new Date(cursor * 86400000);
        const iso = date.toISOString().slice(0, 10);
        if (!calendar.weekend_days.includes(date.getUTCDay()) && !calendar.holidays.includes(iso)) count += 1;
        cursor += 1;
      }
      return count;
    };
    const freshnessReason = (source, policy) => {
      if (source === null) return "ok";
      const now = expected.baseline.now;
      const calendar = calendars.calendars.find((row) => row.id === policy.calendar);
      const nowEpoch = Date.parse(now);
      const sourceEpoch = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(source) ? source + "T00:00:00Z" : source);
      if (sourceEpoch > nowEpoch || (/^\d{4}-\d{2}-\d{2}$/.test(source) && sourceOrdinal(source, calendar) > ordinal(calendarParts(nowEpoch, calendar.timezone)))) return "future_source";
      if (policy.unit === "due_window") {
        if (policy.due_policy.kind === "source_date_plus_days") return nowEpoch <= sourceEpoch + policy.due_policy.days * 86400000 ? "ok" : "stale";
        return "ok";
      }
      const age = policy.unit === "hours" ? (nowEpoch - sourceEpoch) / 3600000 : policy.unit === "calendar_days" ? ordinal(calendarParts(nowEpoch, calendar.timezone)) - sourceOrdinal(source, calendar) : businessAge(source, now, calendar);
      return age <= policy.max_staleness ? "ok" : "stale";
    };
    const evaluateArtifact = (member, policy) => {
      const results = [];
      for (const contract of member.artifact_contracts) {
        const nodes = nodesFor(contract);
        if (nodes.length === 0) return { reason: "missing_artifact", source: null };
        for (const node of nodes) {
          if (node.node_type !== "regular") return { reason: "missing_artifact", source: null };
          const fixtureDocument = documentMap.get(node.document_id);
          if (!fixtureDocument || fixtureDocument.encoding !== "json") return { reason: "decode_error", source: null };
          const document = fixtureDocument.content;
          if (contract.schema_version && canonical(pointer(document, contract.schema_version.pointer)) !== canonical(contract.schema_version.value)) return { reason: "schema_drift", source: null };
          for (const assertion of contract.assertions) {
            if (!assertionPasses(document, assertion)) return { reason: ["min_rows", "min_keys", "non_empty_series"].includes(assertion.kind) ? "empty_payload" : "schema_drift", source: null };
          }
          results.push({ reason: "ok", source: sourceOf(document, contract.source_selector), required: contract.source_selector.kind !== "not_applicable" });
        }
      }
      const sources = results.filter((row) => row.required).map((row) => row.source);
      const source = sources.length === 0 ? null : policy.fold === "oldest" ? sources.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : sources.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
      return { reason: freshnessReason(source, policy), source };
    };
    const attemptMap = new Map(attempts.attempts.map((row) => [row.lane_id + ":" + (row.member_id ?? "_lane"), row]));
    const configDigest = hash(Buffer.from(canonical(config), "utf8"));
    if (configDigest !== expected.config_digest || report.config_digest !== configDigest) throw new Error("config digest mismatch");
    if (!reportBytes.equals(Buffer.from(canonical(report) + "\n", "utf8"))) throw new Error("report bytes are not canonical");
    const reportDigest = hash(reportBytes);
    if (reportDigest !== expected.baseline.report_file_sha256) throw new Error("report digest mismatch");
    if (canonical(report) !== canonical(expected.baseline.expected_report)) throw new Error("independent report expectation mismatch");
    const statuses = ["ready", "stale", "drift", "unavailable", "unobserved"];
    const reasons = new Set(["ok", "missing_artifact", "workflow_unobserved", "transport_error", "http_error", "auth_error", "rate_limited", "decode_error", "schema_drift", "empty_payload", "future_source", "stale", "unexpected_error"]);
    const logical = Object.fromEntries(statuses.map((status) => [status, 0]));
    const members = Object.fromEntries(statuses.map((status) => [status, 0]));
    const modes = { post_fetch_artifact: 0, artifact_only: 0, composite: 0 };
    if (report.lanes.length !== 16) throw new Error("logical denominator mismatch");
    for (const [laneIndex, lane] of report.lanes.entries()) {
      const laneConfig = config.lanes[laneIndex];
      if (lane.id !== laneConfig.id) throw new Error("lane/config identity mismatch");
      if (!statuses.includes(lane.status) || !reasons.has(lane.reason)) throw new Error("closed vocabulary mismatch");
      logical[lane.status] += 1;
      modes[lane.monitoring_mode] += 1;
      const rows = lane.members || [lane];
      const derivedMembers = [];
      for (const [memberIndex, memberReport] of rows.entries()) {
        const memberConfig = laneConfig.producer_members[memberIndex];
        if (!statuses.includes(memberReport.status) || !reasons.has(memberReport.reason)) throw new Error("member vocabulary mismatch");
        const attemptKey = laneConfig.id + ":" + (laneConfig.monitoring_mode === "composite" ? memberConfig.id : "_lane");
        const endpointReason = memberConfig.cadence_declaration === null ? "workflow_unobserved" : classifyAttempt(attemptMap.get(attemptKey));
        if (memberReport.endpoint.reason !== endpointReason) throw new Error("independent endpoint reason mismatch for " + memberConfig.id);
        const artifactResult = evaluateArtifact(memberConfig, laneConfig.freshness);
        if (memberReport.artifact.reason !== artifactResult.reason || memberReport.artifact.source_as_of !== artifactResult.source) throw new Error("independent artifact reason/source mismatch for " + memberConfig.id);
        const endpointState = { reason: endpointReason, status: reasonStatus[endpointReason] };
        const artifactState = { reason: artifactResult.reason, status: reasonStatus[artifactResult.reason] };
        const derived = severity[artifactState.status] > severity[endpointState.status] ? artifactState : endpointState;
        if (memberReport.reason !== derived.reason || memberReport.status !== derived.status) throw new Error("independent member fold mismatch for " + memberConfig.id);
        derivedMembers.push(derived);
        members[memberReport.status] += 1;
      }
      const derivedLane = derivedMembers.reduce((worst, row) => severity[row.status] > severity[worst.status] ? row : worst);
      if (lane.reason !== derivedLane.reason || lane.status !== derivedLane.status) throw new Error("independent lane fold mismatch for " + lane.id);
    }
    if (Object.values(members).reduce((sum, value) => sum + value, 0) !== 20) throw new Error("member denominator mismatch");
    const counts = { ...logical, producer_members_ready: members.ready, producer_members_stale: members.stale, producer_members_drift: members.drift, producer_members_unavailable: members.unavailable, producer_members_unobserved: members.unobserved };
    if (canonical(counts) !== canonical(report.counts) || canonical(modes) !== canonical(report.monitoring_mode_counts)) throw new Error("aggregate mismatch");
    process.stdout.write(JSON.stringify({ config_digest: configDigest, report_file_sha256: reportDigest, logical_lanes: report.lanes.length, producer_members: Object.values(members).reduce((sum, value) => sum + value, 0) }) + "\n");
  `;
  const verifier = spawnSync(process.execPath, ["-e", verifierSource, configPath, reportPath, EXPECTED_PATH, ATTEMPTS_PATH, ARTIFACTS_PATH, CALENDARS_PATH], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, TZ: "Pacific/Honolulu", LC_ALL: "C" },
  });
  assert.equal(verifier.status, 0, verifier.stderr);
  assert.deepEqual(JSON.parse(verifier.stdout), {
    config_digest: expectedFixture.config_digest,
    report_file_sha256: expectedFixture.baseline.report_file_sha256,
    logical_lanes: 16,
    producer_members: 20,
  });

  const assertCliFailureBeforeOutput = (args, failureOutput) => {
    const failed = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, HTTP_PROXY: "http://127.0.0.1:1", FENOK_API_TOKEN: "must-not-be-read" } });
    assert.notEqual(failed.status, 0, failed.stdout);
    if (failureOutput) assert.deepEqual(fs.readdirSync(failureOutput.raw), []);
  };
  assertCliFailureBeforeOutput(cliArgs.slice(0, -2), null);
  for (const [flag, invalidValue] of [
    ["--artifact-root", path.join(artifactRoot.raw, "missing-artifact-root")],
    ["--attempt-evidence", path.join(artifactRoot.raw, "missing-attempts.json")],
    ["--calendar-fixture", path.join(artifactRoot.raw, "missing-calendars.json")],
    ["--now", "not-a-clock"],
    ["--output-root", path.join(artifactRoot.raw, "missing-output-root")],
  ]) {
    const failureOutput = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
    const args = [...cliArgs];
    const valueIndex = args.indexOf(flag) + 1;
    args[valueIndex] = flag === "--output-root" ? invalidValue : invalidValue;
    if (flag !== "--output-root") args[args.indexOf("--output-root") + 1] = failureOutput.raw;
    assertCliFailureBeforeOutput(args, flag === "--output-root" ? null : failureOutput);
    if (flag === "--output-root") assert.equal(fs.existsSync(invalidValue), false);
  }
  for (const mutateArgs of [
    (args) => { args[args.indexOf("--now")] = "--unknown"; },
    (args) => { args.push("positional"); },
    (args) => { args.push("--attempt-shard-root", shardRoot.raw); },
    (args) => { args.push("--calendars", CALENDAR_PATH); },
  ]) {
    const failureOutput = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
    const args = [...cliArgs];
    args[args.indexOf("--output-root") + 1] = failureOutput.raw;
    mutateArgs(args);
    assertCliFailureBeforeOutput(args, failureOutput);
  }
  const externalEvidenceRoot = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const externalEvidence = path.join(externalEvidenceRoot.raw, "attempts.json");
  fs.writeFileSync(externalEvidence, JSON.stringify(attemptsFixture), { encoding: "utf8", mode: 0o600 });
  const externalOutput = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const externalArgs = [...cliArgs];
  externalArgs[externalArgs.indexOf("--attempt-evidence") + 1] = externalEvidence;
  externalArgs[externalArgs.indexOf("--output-root") + 1] = externalOutput.raw;
  assertCliFailureBeforeOutput(externalArgs, externalOutput);
}

function runPrivacyAndProtectedChecks(report) {
  const text = canonicalJson(report);
  for (const token of ["raw_response", "credential", "request_headers", "query_tokens", "current_lkg", "promotion_pointer", artifactRootToken()]) {
    assert.equal(text.includes(token), false, `report excludes ${token}`);
  }
  assert.equal(fs.existsSync(ADMIN_REPORT), false, "Stage 1 canonical admin report stays absent");
}

function runWorkflowBridgeChecks() {
  const workflow = fs.readFileSync(DEPLOY_WORKFLOW, "utf8");
  const updateWorkflow = fs.readFileSync(UPDATE_MANIFEST_WORKFLOW, "utf8");
  const stepName = "      - name: Build data supply detection floor\n";
  const stepStart = workflow.indexOf(stepName);
  const reconcileStart = workflow.indexOf("      - name: Reconcile derived data\n");
  assert.ok(stepStart >= 0, "deploy workflow runs the detection floor");
  assert.ok(reconcileStart > stepStart, "detection floor is installed before KPI reconciliation");
  const step = workflow.slice(stepStart, reconcileStart);
  const requiredTokens = [
    "mktemp -d \"/tmp/fenok-data-supply-detection-floor-",
    "trap 'rm -rf \"$output_root\"' EXIT",
    "--attempt-shard-root",
    "scripts/lib/data-supply-detection-calendars.json",
    "--verify-report \"$report_path\"",
    "install -m 0644 \"$report_path\" \"$installed_path\"",
    "cmp -s \"$report_path\" \"$installed_path\"",
    "--verify-report \"$installed_path\"",
  ];
  for (const required of requiredTokens) {
    assert.ok(step.includes(required), `deploy bridge includes ${required}`);
    assert.equal(updateWorkflow.split(required).length - 1, 2, `update-manifest initial and retry bridges include ${required}`);
  }
  assert.equal(step.includes("--output-root \"$repo_root/data"), false, "builder never writes under repo data");
  assert.equal(updateWorkflow.split("--output-root \"$repo_root/data").length - 1, 0, "update-manifest builder never writes under repo data");

  const initialBridgeStart = updateWorkflow.indexOf(stepName);
  const initialKpiStart = updateWorkflow.indexOf("      - name: Build data health KPI\n");
  assert.ok(initialBridgeStart >= 0, "update-manifest initial path runs the detection floor");
  assert.ok(initialKpiStart > initialBridgeStart, "update-manifest initial path installs the floor before KPI build");
  const retryReset = updateWorkflow.indexOf("git reset --hard origin/main");
  const retryBridgeStart = updateWorkflow.indexOf("repo_root=\"$(pwd -P)\"", retryReset);
  const retryKpiStart = updateWorkflow.indexOf("npm --prefix 100xfenok-next run build:fenok-data-health-kpi", retryReset);
  assert.ok(retryReset >= 0 && retryBridgeStart > retryReset, "update-manifest retry rebuilds the floor after resetting to latest main");
  assert.ok(retryKpiStart > retryBridgeStart, "update-manifest retry installs the floor before KPI rebuild");
  assert.equal(updateWorkflow.includes("data/admin/data-supply-detection-floor.json \\\n"), false, "ephemeral report is not added to the manifest commit pathspec");
}

function runCurrentRepositoryDryRun() {
  const output = makeOwnedRoot(fs.realpathSync.native(os.tmpdir()));
  const result = detectAndProject({
    artifactRoot: REPO_ROOT,
    attempts: attemptsFixture,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
    outputRoot: output.raw,
    tempToken: "0000000000000f00",
  });
  assert.equal(result.report.logical_lane_count, 16);
  assert.equal(result.report.producer_member_count, 20);
  assert.deepEqual(result.report.lanes.map((row) => row.id), DATA_SUPPLY_DETECTION_CONFIG.lanes.map((row) => row.id));
  assert.equal(path.dirname(result.report_path), output.real);
  assert.deepEqual(fs.readdirSync(output.raw), [REPORT_BASENAME]);
  assert.equal(fs.existsSync(ADMIN_REPORT), false);
}

function artifactRootToken() {
  return `${path.sep}fenok-dfloor-test-`;
}

async function main() {
  const originalFetch = globalThis.fetch;
  const protectedBefore = protectedSnapshot();
  const assertRepositoryUnchanged = (context) => {
    assert.deepEqual(protectedSnapshot(), protectedBefore, `protected repository ledger changed after ${context}`);
  };
  for (const [key, value] of Object.entries(protectedBefore)) {
    if (key.startsWith("report-files:")) assert.deepEqual(value, [], `${key} must remain absent`);
  }
  globalThis.fetch = () => { throw new Error("network invocation forbidden"); };
  try {
    runConfigAndFixtureChecks();
    assertRepositoryUnchanged("config and fixture rejection cases");
    const { artifactRoot, report } = runBaselineAndArtifactChecks();
    assertRepositoryUnchanged("successful and classified artifact cases");
    runAttemptShardChecks(artifactRoot);
    assertRepositoryUnchanged("per-lane attempt shard merge and rejection cases");
    runAttemptChecks(artifactRoot);
    assertRepositoryUnchanged("attempt classification cases");
    runCompositeSourceFoldChecks();
    assertRepositoryUnchanged("composite member-worst cases");
    runCalendarChecks();
    assertRepositoryUnchanged("calendar and schedule cases");
    runPathAndAtomicChecks(artifactRoot, report);
    assertRepositoryUnchanged("path rejection and atomic fault cases");
    runCliReproduction(artifactRoot);
    assertRepositoryUnchanged("CLI success and failure cases");
    runPrivacyAndProtectedChecks(report);
    runWorkflowBridgeChecks();
    assertRepositoryUnchanged("deploy bridge contract checks");
    runCurrentRepositoryDryRun();
    assertRepositoryUnchanged("current-repository read-only dry run");
  } finally {
    globalThis.fetch = originalFetch;
    for (const record of [...ownedRoots].reverse()) {
      if (fs.existsSync(record.raw)) safeCleanup(record);
    }
  }
  assertRepositoryUnchanged("external fixture and output cleanup");
  process.stdout.write("test-build-data-supply-detection-floor: ok\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
