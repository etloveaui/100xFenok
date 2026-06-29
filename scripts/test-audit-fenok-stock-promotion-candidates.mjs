#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  evidenceFamilyFlagsForTicker,
  evidenceFamiliesForTicker,
  localSourceFilesFor,
  stockanalysisSurfaceTickers,
} from "./audit-fenok-stock-promotion-candidates.mjs";

const surfacePayload = {
  records: [
    { symbol: "$DAY", other: "DAY", type: "Acquisition" },
    { symbol: "$STRC", other: "STRC", type: "Listed" },
    { symbol: "$IGNORED", other: "N/A", type: "Delisted" },
  ],
};

const surfaceTickers = stockanalysisSurfaceTickers(surfacePayload);
assert.deepEqual(surfaceTickers, ["DAY", "IGNORED", "STRC"]);

const commonSets = {
  yfSet: new Set(["DAY", "STRC"]),
  secSet: new Set(),
  slickUniverseSet: new Set(),
  slickStockFileSet: new Set(["DAY"]),
  stockanalysisSurfaceSet: new Set(surfaceTickers),
  rawMasterSet: new Set(),
};

assert.deepEqual(
  evidenceFamiliesForTicker("DAY", { sources: { yf: true, slickcharts: true } }, commonSets),
  ["slickcharts", "stockanalysis", "yf"],
);

assert.deepEqual(
  evidenceFamilyFlagsForTicker("DAY", { sources: { yf: true, slickcharts: true } }, commonSets),
  {
    yf: true,
    stockanalysis: true,
    slickcharts: true,
    sec13f: false,
    raw_company_master: false,
  },
);

const dayLocalSources = localSourceFilesFor(
  "DAY",
  { sources: { yf: true, slickcharts: true } },
  { sources: { yf: true, slickcharts: true } },
  {
    ...commonSets,
    stockanalysisFinancialsSet: new Set(),
  },
);

assert.equal(dayLocalSources.stockanalysis_surface_file, true);
assert.equal(dayLocalSources.source_flags.stockanalysis, false);
assert.equal(dayLocalSources.accepted_family_flags.stockanalysis, true);

assert.deepEqual(
  evidenceFamiliesForTicker("STRC", { sources: { yf: true, stockanalysis: true } }, commonSets),
  ["stockanalysis", "yf"],
);

console.log("test-audit-fenok-stock-promotion-candidates: ok");
