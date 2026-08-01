#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC_RIM_INPUTS = path.join(APP_ROOT, "public", "data", "computed", "rim-index", "inputs.json");
const SCAN_ROOTS = [
  path.join(APP_ROOT, "src"),
];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

function fail(messages) {
  console.error("[qa:rim-index-consumer-growth-guard] failed");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(abs));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(abs);
    }
  }
  return files;
}

function rel(absPath) {
  return path.relative(APP_ROOT, absPath).split(path.sep).join("/");
}

function validatePayload(payload) {
  const errors = [];
  const indices = payload?.indices && typeof payload.indices === "object" ? payload.indices : {};
  for (const [indexId, index] of Object.entries(indices)) {
    const rows = index?.derived?.forecast_grid_v1?.periods;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const period = row?.period ?? "?";
      const growthUsage = row?.growth_usage;
      const growthBasis = row?.growth_basis;
      if (period === "fy1") {
        if (growthUsage !== "context_only_not_earnings_roll_forward") {
          errors.push(`${indexId}.forecast_grid_v1.fy1: expected context_only_not_earnings_roll_forward`);
        }
        if (growthBasis !== "source_reported_eps_growth_snapshot") {
          errors.push(`${indexId}.forecast_grid_v1.fy1: expected source_reported_eps_growth_snapshot`);
        }
      } else if (["fy2", "fy3"].includes(period)) {
        if (growthUsage !== "earnings_path_roll_forward") {
          errors.push(`${indexId}.forecast_grid_v1.${period}: expected earnings_path_roll_forward`);
        }
        if (growthBasis !== "forward_eps_ratio") {
          errors.push(`${indexId}.forecast_grid_v1.${period}: expected forward_eps_ratio`);
        }
      }
    }
  }
  return errors;
}

const RANGE_SCOPE = "inputs_and_assumption_labelled_range_no_single_target";
const RANGE_PRIMARY_IDS = ["SPX", "NDX"];
const RANGE_REQUIRED_GATES = [
  "primary_index",
  "source_tier_satisfied",
  "blockers_empty",
  "operands_complete",
  "source_clock_honest",
  "payout_routes_reconciled",
  "model_sensitivity_bounded",
];
const FORBIDDEN_TARGET_KEYS = new Set([
  "point_target", "target", "target_price", "price_target",
  "fair_value", "fairValue", "intrinsic_value", "intrinsicValue",
  "single_target", "estimate", "valuation",
]);

function forbiddenKeyPaths(node, trail = []) {
  if (Array.isArray(node)) return node.flatMap((item, i) => forbiddenKeyPaths(item, [...trail, String(i)]));
  if (!node || typeof node !== "object") return [];
  const found = [];
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_TARGET_KEYS.has(key)) found.push([...trail, key].join("."));
    found.push(...forbiddenKeyPaths(value, [...trail, key]));
  }
  return found;
}

// Keyed off the payload's OWN declared scope: an inputs-only artifact is not
// failed for lacking a block its contract never promised, and a successor-scope
// artifact is held to the whole band contract.
function validateRangeSemantics(payload) {
  const errors = [];
  const indices = payload?.indices && typeof payload.indices === "object" ? payload.indices : {};
  const declaresRange = payload?.output_scope === RANGE_SCOPE;
  if (payload?.policy?.no_public_single_target !== true) {
    errors.push("policy.no_public_single_target must be true in every scope");
  }
  for (const [indexId, index] of Object.entries(indices)) {
    const range = index?.derived?.valuation_range_v1;
    const isPrimary = RANGE_PRIMARY_IDS.includes(indexId);
    if (!isPrimary) {
      if (range) errors.push(`${indexId}: a non-primary index must not carry a valuation range`);
      continue;
    }
    if (!declaresRange) continue;
    if (!range) {
      errors.push(`${indexId}: the successor scope requires a valuation range block, even a refused one`);
      continue;
    }
    if (range.emits_single_target !== false) {
      errors.push(`${indexId}: valuation range must declare emits_single_target false`);
    }
    for (const found of forbiddenKeyPaths(range)) {
      errors.push(`${indexId}: forbidden single-target key at valuation_range_v1.${found}`);
    }
    const declaredGates = Object.keys(range.gates ?? {}).sort().join(",");
    if (declaredGates !== [...RANGE_REQUIRED_GATES].sort().join(",")) {
      errors.push(`${indexId}: valuation range gates must be exactly ${RANGE_REQUIRED_GATES.join(", ")}`);
    }
    if (range.public_status === "ready_range_no_single_target") {
      for (const gate of RANGE_REQUIRED_GATES) {
        if (range.gates?.[gate]?.passed !== true) {
          errors.push(`${indexId}: a published band requires gate ${gate} to pass`);
        }
      }
      const scenarios = Array.isArray(range.scenarios) ? range.scenarios : [];
      if (scenarios.length !== 2) errors.push(`${indexId}: a published band carries exactly two endpoint scenarios`);
      const { low, high } = range.range ?? {};
      if (!(Number.isFinite(low) && Number.isFinite(high) && low < high)) {
        errors.push(`${indexId}: a published band needs two distinct ordered endpoints`);
      }
    } else if (range.public_status !== "blocked_no_range") {
      errors.push(`${indexId}: unknown valuation range status ${range.public_status}`);
    }
  }
  return errors;
}

// One reader decides whether a band may be drawn. A second hand-rolled reader is
// how a stricter producer contract quietly loses its teeth at the UI layer.
function findRangeConsumerViolations() {
  const violations = [];
  for (const file of SCAN_ROOTS.flatMap(walkFiles)) {
    const relPath = rel(file);
    if (relPath.endsWith("app/market-valuation/rimBand.ts")) continue;
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("valuation_range_v1")) continue;
    if (!text.includes("readRimBand")) {
      violations.push(`${relPath}: a valuation range consumer must gate through readRimBand from app/market-valuation/rimBand`);
    }
  }
  return violations;
}

function findConsumerGuardViolations() {
  const violations = [];
  const files = SCAN_ROOTS.flatMap(walkFiles);
  const rimConsumerHints = [
    "rim-index",
    "forecast_grid_v1",
    "RimIndex",
    "rimIndex",
  ];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const consumesRimGrid = rimConsumerHints.some((needle) => text.includes(needle));
    if (!consumesRimGrid) continue;

    const readsEpsGrowth = /eps[_-]?growth|epsGrowth/.test(text);
    if (!readsEpsGrowth) continue;

    const checksGrowthUsage = text.includes("growth_usage") || text.includes("growthUsage");
    const checksRollForward = text.includes("earnings_path_roll_forward");
    if (!checksGrowthUsage || !checksRollForward) {
      violations.push(`${rel(file)}: RIM eps_growth consumer must check growth_usage === "earnings_path_roll_forward" before displaying path growth`);
    }
  }

  return violations;
}

const payload = readJson(PUBLIC_RIM_INPUTS);
const errors = [
  ...validatePayload(payload),
  ...validateRangeSemantics(payload),
  ...findConsumerGuardViolations(),
  ...findRangeConsumerViolations(),
];

if (errors.length > 0) fail(errors);

console.log("[qa:rim-index-consumer-growth-guard] ok");
