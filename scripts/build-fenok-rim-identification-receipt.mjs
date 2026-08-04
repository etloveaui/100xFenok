#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStructuralTransferReceipt } from "./fenok-rim-identification-protocol.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_REL = "scripts/fixtures/fenok-rim-2026-08-03-stock-grids.json";
const OUTPUT_REL = "data/computed/fenok-rim/identification-receipt.json";
const EXTERNAL_BOOK_CONFIG = {
  HYNIX: { source_file: "data/yf/finance/000660.KS.json", fiscal_period: "2025-12-31", ticker: "000660.KS", currency: "KRW" },
  SAMSUNG: { source_file: "data/yf/finance/005930.KS.json", fiscal_period: "2025-12-31", ticker: "005930.KS", currency: "KRW" },
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO, relativePath), "utf8"));
}

function externalBookMeasurement(id, config) {
  const source = readJson(config.source_file);
  const currency = source?.data?.info?.currency;
  if (source?.ticker !== config.ticker || currency !== config.currency) {
    throw new Error(`${id} external book source identity mismatch`);
  }
  const row = source?.data?.balance_sheet?.[config.fiscal_period];
  const equity = row?.["Stockholders Equity"];
  const shares = row?.["Ordinary Shares Number"];
  if (!(Number.isFinite(equity) && equity > 0 && Number.isFinite(shares) && shares > 0)) {
    throw new Error(`${id} external book source is missing positive equity or ordinary shares`);
  }
  const measurement = {
    source_schema: source.schema_version,
    ticker: source.ticker,
    currency,
    fiscal_period: config.fiscal_period,
    stockholders_equity: equity,
    ordinary_shares_number: shares,
  };
  return {
    source_file: config.source_file,
    source_schema: source.schema_version,
    ticker: source.ticker,
    currency,
    source_as_of: source.source_as_of,
    fetched_at: source.fetched_at,
    fiscal_period: config.fiscal_period,
    numerator: "Stockholders Equity",
    denominator: "Ordinary Shares Number",
    value: equity / shares,
    unit: "KRW_per_share",
    measurement_sha256: digest(JSON.stringify(measurement)),
    temporal_eligible: false,
    availability_note: "Fiscal period is not first-knowable availability; this source is a structural cross-check only.",
  };
}

export function buildIdentificationArtifact() {
  const fixtureBytes = fs.readFileSync(path.join(REPO, FIXTURE_REL));
  const fixture = JSON.parse(fixtureBytes);
  const externalBookSources = Object.fromEntries(
    Object.entries(EXTERNAL_BOOK_CONFIG).map(([id, config]) => [id, externalBookMeasurement(id, config)]),
  );
  const receipt = buildStructuralTransferReceipt(fixture, {
    externalBooks: Object.fromEntries(
      Object.entries(externalBookSources).map(([id, source]) => [id, {
        value: source.value,
        fiscal_period: source.fiscal_period,
        source: `${source.source_file} ${source.numerator} / ${source.denominator}`,
        measurement_sha256: source.measurement_sha256,
      }]),
    ),
    externalBookTolerance: 0.03,
  });
  return {
    ...receipt,
    fixture: {
      path: FIXTURE_REL,
      sha256: digest(fixtureBytes),
      instrument_count: Object.keys(fixture.instruments).length,
      cell_count: Object.values(fixture.instruments).reduce(
        (sum, instrument) => sum + instrument.grids.reduce((gridSum, grid) => gridSum + grid.cells.length, 0),
        0,
      ),
    },
    external_book_sources: externalBookSources,
    publication_status: "NULL",
  };
}

export function writeIdentificationArtifact(outputRelativePath = OUTPUT_REL) {
  const artifact = buildIdentificationArtifact();
  const outputPath = path.join(REPO, outputRelativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return { artifact, outputPath };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const { artifact, outputPath } = writeIdentificationArtifact();
  console.log(`Wrote ${path.relative(REPO, outputPath)}: ${artifact.status}; publication ${artifact.publication_status}`);
}
