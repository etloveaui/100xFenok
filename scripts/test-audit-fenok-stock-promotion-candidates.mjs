#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  classTickerPreservationOk,
  corporateActionEvidenceFor,
  evidenceFamilyFlagsForTicker,
  evidenceFamiliesForTicker,
  localSourceFilesFor,
  stockanalysisCorporateActionsByTicker,
  stockanalysisSurfaceTickers,
} from "./audit-fenok-stock-promotion-candidates.mjs";

const surfacePayload = {
  records: [
    { symbol: "$DAY", other: "DAY", type: "Acquisition" },
    { symbol: "$HOLX", other: "N/A", type: "Delisted" },
    { symbol: "$MRSH", other: "MMC", type: "Symbol Change" },
    { symbol: "$STRC", other: "STRC", type: "Listed" },
    { symbol: "$IGNORED", other: "N/A", type: "Delisted" },
  ],
};

const surfaceTickers = stockanalysisSurfaceTickers(surfacePayload);
assert.deepEqual(surfaceTickers, ["DAY", "HOLX", "IGNORED", "MMC", "MRSH", "STRC"]);

const corporateActionsByTicker = stockanalysisCorporateActionsByTicker(surfacePayload);
assert.equal(corporateActionsByTicker.get("DAY")[0].terminal, true);
assert.equal(corporateActionsByTicker.get("HOLX")[0].terminal, true);
assert.equal(corporateActionsByTicker.get("MMC")[0].alias_target, "MRSH");
assert.equal(corporateActionsByTicker.get("MRSH")[0].alias_source, "MMC");
assert.deepEqual(
  corporateActionEvidenceFor("MMC", { stockanalysisCorporateActionMap: corporateActionsByTicker })[0],
  {
    type: "Symbol Change",
    date: null,
    symbol: "MRSH",
    other: "MMC",
    text: null,
    terminal: false,
    alias_target: "MRSH",
    alias_source: null,
  },
);

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

assert.equal(
  classTickerPreservationOk(
    ["230360.KQ", "BF.B"],
    [{ ticker: "BF.B" }, { ticker: "230360.KQ" }],
  ),
  true,
);

assert.equal(
  classTickerPreservationOk(
    ["230360.KQ", "BF.B"],
    [{ ticker: "BF.B" }],
  ),
  false,
);

console.log("test-audit-fenok-stock-promotion-candidates: ok");
