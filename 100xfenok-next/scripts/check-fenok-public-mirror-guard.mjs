#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const publicDataRoot = path.join(appRoot, "public", "data");

const forbiddenPatterns = [
  /^computed\/fenok_signals\.json$/,
  /^computed\/fenok_etf_signals\.json$/,
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
));

if (violations.length > 0) {
  console.error("[fenok-public-mirror-guard] forbidden public files:");
  for (const rel of violations) console.error(`- public/data/${rel}`);
  process.exit(1);
}

console.log(`[fenok-public-mirror-guard] ok (${files.length} public data files checked)`);
