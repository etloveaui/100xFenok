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
  ...findConsumerGuardViolations(),
];

if (errors.length > 0) fail(errors);

console.log("[qa:rim-index-consumer-growth-guard] ok");
