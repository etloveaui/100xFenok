#!/usr/bin/env node

// Compact public-write fence for the canonical-only producer batches
// (build-stocks-analyzer lane families and the SlickCharts discovery
// summary). Happy-path writes and untouched mirror behavior belong to each
// producer's focused test; this check only prevents mirror paths or
// dual-write interfaces from returning to the producer implementations.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCERS = Object.freeze([
  ["scripts/build-stocks-analyzer.mjs", "data/global-scouter/core/stocks_analyzer.json"],
  ["scripts/build-13f-enrichment-backfill.mjs", "data/sec-13f/summary.json"],
  ["scripts/build-13f-integrity-indexes.mjs", "data/sec-13f/analytics/consensus.json"],
  ["scripts/build-13f-trades.mjs", "data/sec-13f/analytics/trades_ranking.json"],
  ["scripts/build-13f-portfolio-views.mjs", "data/sec-13f/analytics/portfolio_views.json"],
  ["scripts/build-guru-holders-index.mjs", "data/sec-13f/analytics/guru_holders_index.json"],
  ["scripts/build-revision-movers.mjs", "data/global-scouter/core/revision_movers.json"],
  ["scripts/build-industry-benchmarks.mjs", "data/damodaran/industry_benchmarks.json"],
  ["scripts/build-calendar-prev.mjs", "data/calendar/prev-values.json"],
  ["scripts/build-slickcharts-discovery.mjs", "data/slickcharts/discovery-summary.json"],
]);

// Every public mirror output this batch removed from the producers must be
// re-established by one exact Update Manifest materialization route per
// output, non-destructive except for the explicit investors exact-mirror
// exception. The investors tree is the one dynamic
// directory mirror and is the sole exception: its exact-mirror rsync_tree
// route owns the destination with delete:true while excluding griffin.json.
const INVESTORS_MIRROR = Object.freeze({
  source: "data/sec-13f/investors",
  destination: "100xfenok-next/public/data/sec-13f/investors",
});
const REMOVED_MIRROR_OUTPUTS = Object.freeze({
  "scripts/build-stocks-analyzer.mjs": [
    { source: "data/global-scouter/core/stocks_analyzer.json", destination: "100xfenok-next/public/data/global-scouter/core/stocks_analyzer.json" },
    { source: "data/global-scouter/core/per_bands_index.json", destination: "100xfenok-next/public/data/global-scouter/core/per_bands_index.json" },
    { source: "data/global-scouter/core/slick_index.json", destination: "100xfenok-next/public/data/global-scouter/core/slick_index.json" },
  ],
  "scripts/build-13f-enrichment-backfill.mjs": [
    { source: "data/sec-13f/investors", destination: "100xfenok-next/public/data/sec-13f/investors" },
    { source: "data/sec-13f/summary.json", destination: "100xfenok-next/public/data/sec-13f/summary.json" },
    { source: "data/sec-13f/by_sector.json", destination: "100xfenok-next/public/data/sec-13f/by_sector.json" },
  ],
  "scripts/build-13f-integrity-indexes.mjs": [
    { source: "data/sec-13f/investors", destination: "100xfenok-next/public/data/sec-13f/investors" },
    { source: "data/sec-13f/by_ticker.json", destination: "100xfenok-next/public/data/sec-13f/by_ticker.json" },
    { source: "data/sec-13f/analytics/consensus.json", destination: "100xfenok-next/public/data/sec-13f/analytics/consensus.json" },
    { source: "data/sec-13f/analytics/ticker_aliases.json", destination: "100xfenok-next/public/data/sec-13f/analytics/ticker_aliases.json" },
  ],
  "scripts/build-13f-trades.mjs": [
    { source: "data/sec-13f/analytics/trades_ranking.json", destination: "100xfenok-next/public/data/sec-13f/analytics/trades_ranking.json" },
  ],
  "scripts/build-13f-portfolio-views.mjs": [
    { source: "data/sec-13f/analytics/portfolio_views.json", destination: "100xfenok-next/public/data/sec-13f/analytics/portfolio_views.json" },
  ],
  "scripts/build-guru-holders-index.mjs": [
    { source: "data/sec-13f/analytics/guru_holders_index.json", destination: "100xfenok-next/public/data/sec-13f/analytics/guru_holders_index.json" },
  ],
  "scripts/build-revision-movers.mjs": [
    { source: "data/global-scouter/core/revision_movers.json", destination: "100xfenok-next/public/data/global-scouter/core/revision_movers.json" },
  ],
  "scripts/build-industry-benchmarks.mjs": [
    { source: "data/damodaran/industry_benchmarks.json", destination: "100xfenok-next/public/data/damodaran/industry_benchmarks.json" },
  ],
  "scripts/build-calendar-prev.mjs": [
    { source: "data/calendar/prev-values.json", destination: "100xfenok-next/public/data/calendar/prev-values.json" },
  ],
});

// The SlickCharts discovery summary is the one removed output owned by a
// whole-tree rsync boundary: the destination directory is fully route-owned,
// so the covering route must be exactly one rsync_tree mirror with
// delete:true parity (never a file-level cp_file or delete:false route).
const REMOVED_TREE_MIRROR_OUTPUTS = Object.freeze({
  "scripts/build-slickcharts-discovery.mjs": [
    "100xfenok-next/public/data/slickcharts/discovery-summary.json",
  ],
});

const sources = Object.fromEntries(PRODUCERS.map(([relativePath]) => [
  relativePath,
  fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"),
]));

for (const [relativePath, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /100xfenok-next\/public/u, `${relativePath} references the public mirror root`);
  assert.doesNotMatch(source, /public[\\/]+data/u, `${relativePath} references a public/data mirror path`);
  assert.doesNotMatch(source, /\bpublicPaths?\b/u, `${relativePath} exposes a public-path producer interface`);
  assert.doesNotMatch(source, /writeBoth|writeRootAndPublic|copyInvestorMirror/u, `${relativePath} keeps a dual-write helper`);
  assert.doesNotMatch(source, /PUBLIC_MIRROR|PUBLIC_OUT|PUBLIC_INVESTORS_DIR|\bMIRROR\b/u, `${relativePath} keeps a mirror output constant`);
}

for (const [relativePath, canonicalPath] of PRODUCERS) {
  assert.match(sources[relativePath], new RegExp(canonicalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
    `${relativePath} lost its canonical output path`);
}

assert.match(sources["scripts/build-stocks-analyzer.mjs"], /writeJson\(PATHS\.output, output\)/u);
assert.match(sources["scripts/build-stocks-analyzer.mjs"], /writeJson\(PATHS\.perBandsOutput, perBandsOutput\)/u);
assert.match(sources["scripts/build-stocks-analyzer.mjs"], /writeJson\(PATHS\.slickOutput, slickOutput\)/u);
assert.match(sources["scripts/build-13f-enrichment-backfill.mjs"], /writeJson\(SUMMARY_PATH, summary\)/u);
assert.match(sources["scripts/build-13f-enrichment-backfill.mjs"], /writeJson\(BY_SECTOR_PATH, bySector\)/u);
assert.match(sources["scripts/build-13f-trades.mjs"], /writeJson\(OUTPUT, output\)/u);
assert.match(sources["scripts/build-13f-portfolio-views.mjs"], /writeJson\(OUTPUT, output\)/u);
assert.match(sources["scripts/build-guru-holders-index.mjs"], /writeFileSync\(OUT, JSON\.stringify\(output\)\)/u);
assert.match(sources["scripts/build-revision-movers.mjs"], /writeFileSync\(OUT, JSON\.stringify\(payload\)\)/u);
assert.match(sources["scripts/build-industry-benchmarks.mjs"], /writeFileSync\(OUT, JSON\.stringify\(payload\)\)/u);
assert.match(sources["scripts/build-slickcharts-discovery.mjs"], /writeJson\(PATHS\.output, payload\)/u);

const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "data/admin/lane-commit-manifest.json"), "utf8"),
);
const routes = manifest.update_manifest.materializations;
for (const [relativePath, removedOutputs] of Object.entries(REMOVED_MIRROR_OUTPUTS)) {
  for (const expectedRoute of removedOutputs) {
    const covering = routes.filter((route) => (
      route.source === expectedRoute.source
      && route.destination === expectedRoute.destination
    ));
    assert.equal(
      covering.length,
      1,
      `${relativePath} removed mirror output must keep its exact source/destination route: ${expectedRoute.source} -> ${expectedRoute.destination}`,
    );
    if (expectedRoute.source === INVESTORS_MIRROR.source && expectedRoute.destination === INVESTORS_MIRROR.destination) {
      assert.equal(
        covering[0].delete,
        true,
        `${relativePath} investors mirror route must keep delete:true exact-mirror parity: ${expectedRoute.destination}`,
      );
      assert.deepEqual(
        covering[0].excludes,
        ["griffin.json"],
        `${relativePath} investors mirror route must keep the exact griffin.json exclusion: ${expectedRoute.destination}`,
      );
    } else {
      assert.equal(
        covering[0].delete,
        false,
        `${relativePath} mirror route must never delete destination content: ${expectedRoute.destination}`,
      );
    }
  }
}

for (const [relativePath, removedOutputs] of Object.entries(REMOVED_TREE_MIRROR_OUTPUTS)) {
  for (const publicPath of removedOutputs) {
    const covering = routes.filter((route) => (
      route.mode === "rsync_tree"
      && publicPath.startsWith(`${route.destination}/`)
    ));
    assert.equal(
      covering.length,
      1,
      `${relativePath} removed tree-mirror output must be covered by exactly one whole-tree rsync route: ${publicPath}`,
    );
    assert.equal(
      covering[0].delete,
      true,
      `${relativePath} whole-tree mirror route must own its destination with delete:true parity: ${publicPath}`,
    );
  }
}

console.log("build-producers public-write fence: ok (10 canonical-only APIs)");
