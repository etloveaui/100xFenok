#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const publicDataRoot = path.join(appRoot, "public", "data");
const canonicalDataRoot = path.join(repoRoot, "data");

const forbiddenPatterns = [
  /^admin\/fenok-s1-stock-promotion-gate-plan\.json$/,
  /^admin\/fenok-s1-stock-public-promotion-dry-run\.json$/,
  /^admin\/fenok-s1-public-mutation-enable-readiness\.json$/,
  /^admin\/fenok-edge-etf-daily1y-readiness\.json$/,
  /^admin\/fenok-edge-etf-daily1y-fetchable-plan\.json$/,
  /^admin\/fenok-etf-daily1y-dispatch-plan\.json$/,
  /^admin\/fenok-etf-core-daily-basket\.json$/,
  /^admin\/fenok-s0-finra-occ-mapping-ledger\.json$/,
  /^computed\/fenok_signals\.json$/,
  /^computed\/fenok_etf_signals\.json$/,
  /^computed\/etf_action_index\.json$/,
  /^computed\/fenok_flow_proxies.*\.json$/,
  /^computed\/fenok_occ_options_volume.*\.json$/,
  /^computed\/fenok_news_tone_proxy.*\.json$/,
  /^computed\/fenok_signal_lens_proxies.*\.json$/,
  /^computed\/fenok_social_attention_proxy.*\.json$/,
  /^computed\/fenok_apewisdom.*\.json$/,
];

const forbiddenRawPatterns = [
  /\.(csv|txt)$/i,
  /(^|\/)(finra|occ|apewisdom|gdelt|reddit|social)(\/|_)/i,
];

const forbiddenYardneyRawKeys = new Set([
  "moodys_aaa",
  "moodys_baa",
  "spread_avg",
  "raw_moodys_aaa",
  "raw_moodys_baa",
  "fred_aaa",
  "fred_baa",
  "waaa",
  "wbaa",
  "WAAA",
  "WBAA",
  "aaa_yield",
  "baa_yield",
  "corporate_aaa",
  "corporate_baa",
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function toRel(abs) {
  return path.relative(publicDataRoot, abs).split(path.sep).join("/");
}

const files = walk(publicDataRoot).map(toRel);
const violations = files.filter((rel) => (
  forbiddenPatterns.some((pattern) => pattern.test(rel)) ||
  forbiddenRawPatterns.some((pattern) => pattern.test(rel))
)).map((rel) => `public/data/${rel}`);
const yardneyRawKeyHits = new Map();

function recordYardneyRawKeyHit(rel, key) {
  const fileHits = yardneyRawKeyHits.get(rel) ?? new Map();
  fileHits.set(key, (fileHits.get(key) ?? 0) + 1);
  yardneyRawKeyHits.set(rel, fileHits);
}

function scanYardneyRawKeys(root, displayPrefix) {
  for (const abs of walk(path.join(root, "yardney"))) {
    if (!abs.endsWith(".json")) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    const rawKeyMatches = text.matchAll(/"([^"]+)"\s*:/g);
    for (const match of rawKeyMatches) {
      const key = match[1];
      if (forbiddenYardneyRawKeys.has(key)) {
        recordYardneyRawKeyHit(`${displayPrefix}/${rel}`, key);
      }
    }
  }
}

scanYardneyRawKeys(publicDataRoot, "public/data");
scanYardneyRawKeys(canonicalDataRoot, "data");

for (const [rel, keyHits] of [...yardneyRawKeyHits.entries()].sort()) {
  for (const [key, count] of [...keyHits.entries()].sort()) {
    violations.push(`${rel}: forbidden Yardney raw bond-yield key "${key}" (${count} occurrence${count === 1 ? "" : "s"})`);
  }
}

const edgeCoverageMirrorPath = path.join(publicDataRoot, "admin", "fenok-edge-coverage-index.json");

if (fs.existsSync(edgeCoverageMirrorPath)) {
  const mirrorText = fs.readFileSync(edgeCoverageMirrorPath, "utf8");
  const mirror = JSON.parse(mirrorText);
  const unsafeTokens = [
    "_private/",
    "\"private_manifest_file\"",
    "\"manifest_file\"",
    "\"target_universe\"",
    "\"tickers\"",
    "\"source_file\"",
  ].filter((token) => mirrorText.includes(token));
  if (mirror.schema_version !== "fenok-edge-coverage-index-public/v0.1") {
    violations.push("admin/fenok-edge-coverage-index.json: unsafe schema");
  }
  if (
    mirror.raw_policy?.raw_public !== false ||
    mirror.raw_policy?.raw_rows_included !== false ||
    mirror.raw_policy?.private_artifact_paths_included !== false
  ) {
    violations.push("admin/fenok-edge-coverage-index.json: unsafe raw_policy");
  }
  for (const token of unsafeTokens) {
    violations.push(`admin/fenok-edge-coverage-index.json: unsafe token ${token}`);
  }
}

if (violations.length > 0) {
  console.error("[fenok-public-mirror-guard] forbidden public files:");
  for (const rel of violations) console.error(`- ${rel}`);
  process.exit(1);
}

console.log(`[fenok-public-mirror-guard] ok (${files.length} public data files checked)`);
