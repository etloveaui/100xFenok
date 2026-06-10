#!/usr/bin/env node
/**
 * Build script: slim ticker -> unique guru holder count index.
 * Source: sec-13f consensus holders_list (entries repeat per quarter — dedupe).
 * Consumer: screener "구루픽 밸류" preset (joined client-side by ticker).
 *
 * Run: node scripts/build-guru-holders-index.mjs
 * Output: data/sec-13f/analytics/guru_holders_index.json (+ public mirror)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data/sec-13f/analytics/consensus.json");
const OUT = path.join(ROOT, "data/sec-13f/analytics/guru_holders_index.json");
const MIRROR = path.join(
  ROOT,
  "100xfenok-next/public/data/sec-13f/analytics/guru_holders_index.json",
);

const consensus = JSON.parse(fs.readFileSync(SRC, "utf8"));
const holders = {};
for (const [ticker, row] of Object.entries(consensus.consensus ?? {})) {
  const unique = new Set(row.holders_list ?? []);
  if (unique.size > 0) holders[ticker] = unique.size;
}

const output = {
  metadata: {
    quarter: consensus.metadata?.quarter ?? null,
    tickers: Object.keys(holders).length,
    generated_at: new Date().toISOString(),
  },
  holders,
};

for (const p of [OUT, MIRROR]) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(output));
}
console.log(
  `guru_holders_index: quarter=${output.metadata.quarter} tickers=${output.metadata.tickers}`,
);
