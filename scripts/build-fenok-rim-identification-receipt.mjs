#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStructuralTransferReceipt } from "./fenok-rim-identification-protocol.mjs";
import { buildCalibrationReceipt, canonicalJson } from "./lib/fenok-rim-calibration-receipt.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(REPO, "../..");
const FIXTURE_REL = "scripts/fixtures/fenok-rim-2026-08-03-stock-grids.json";
const CALIBRATION_EVIDENCE_REL = "scripts/fixtures/fenok-rim-calibration-evidence.json";
const CALIBRATION_RECEIPT_SOURCE_REL = "scripts/lib/fenok-rim-calibration-receipt.mjs";
const STRUCTURAL_ALGORITHM_SOURCE_RELS = [
  "scripts/analyze-fenok-rim-identifiability.mjs",
  "scripts/build-fenok-rim-identification-receipt.mjs",
  "scripts/fenok-rim-identification-protocol.mjs",
];
const SUSTAINABLE_ARTIFACT_REL = "data/computed/fenok-rim/sustainable-index-ranges.json";
const PRINTED_INDEX_GRID_REL = "scripts/fixtures/fenok-rim-2025-12-09-grid.json";
const SUSTAINABLE_ALGORITHM_SOURCE_RELS = [
  "scripts/build-fenok-rim-identification-receipt.mjs",
  "scripts/build-fenok-rim-sustainable-index-ranges.mjs",
  "scripts/fenok-rim-yoo-panel-engine.mjs",
  "scripts/lib/fenok-rim-calibration-receipt.mjs",
];
const SUSTAINABLE_SUPPORT_SOURCE_RELS = [
  "data/benchmarks/emerging.json",
  "data/benchmarks/micro_sectors.json",
  "data/benchmarks/us.json",
  "data/computed/fenok-rim/payout-history.json",
  "data/computed/fenok-rim/russell2000-official-fundamentals.json",
  "data/macro/fred-banking-daily.json",
  "data/yf/finance/EWY.json",
  "data/yf/finance/IWM.json",
  "data/yf/finance/ONEQ.json",
  "data/yf/finance/QQQ.json",
  "data/yf/finance/SOXX.json",
  "data/yf/finance/SPY.json",
];
const RIM_INDEX_INPUTS_REL = "data/computed/rim-index/inputs.json";
const OUTPUT_REL = "data/computed/fenok-rim/identification-receipt.json";
const EXTERNAL_BOOK_CONFIG = {
  HYNIX: { source_file: "data/yf/finance/000660.KS.json", fiscal_period: "2025-12-31", ticker: "000660.KS", currency: "KRW" },
  SAMSUNG: { source_file: "data/yf/finance/005930.KS.json", fiscal_period: "2025-12-31", ticker: "005930.KS", currency: "KRW" },
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO, relativePath), "utf8"));
}

function latestFetchedAt(sources) {
  const timestamps = Object.values(sources).map((source) => Date.parse(source.fetched_at));
  if (timestamps.some((value) => !Number.isFinite(value))) {
    throw new Error("external book source fetched_at must be a valid timestamp");
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function resolveEvidencePath(relativePath) {
  const candidates = [
    { resolved_scope: "nested_repo", absolute_path: path.join(REPO, relativePath) },
    { resolved_scope: "parent_project", absolute_path: path.join(PROJECT_ROOT, relativePath) },
  ];
  return candidates.find((candidate) => fs.existsSync(candidate.absolute_path)) ?? null;
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

function fileSource(id, relativePath, measurement) {
  return {
    id,
    path: relativePath,
    bytes: fs.readFileSync(path.join(REPO, relativePath)),
    measurement,
  };
}

function sustainableCalibrationReceipt({ sourceLedger }) {
  const sustainable = readJson(SUSTAINABLE_ARTIFACT_REL);
  const indexGrid = readJson(PRINTED_INDEX_GRID_REL);
  const stockGrid = readJson(FIXTURE_REL);
  const rimInputs = readJson(RIM_INDEX_INPUTS_REL);
  const spy = readJson("data/yf/finance/SPY.json");
  const qqq = readJson("data/yf/finance/QQQ.json");
  const domain = sustainable.rows?.[0]?.value?.convexity?.printed_domain;
  if (!domain || domain.observations !== 12) {
    throw new Error("sustainable calibration receipt requires the full 12-observation printed convexity domain");
  }
  const printedDomainObservations = sustainable.calibration.structural_reproduction.instruments
    .filter((instrument) => instrument.status === "reproduced")
    .flatMap((instrument) => indexGrid.instruments[instrument.instrument].lt_roe_axis.flatMap((ltRoe) => (
      Object.entries(indexGrid.rate_scenarios).map(([scenario, riskFree]) => ({
        instrument: instrument.instrument,
        lt_roe: ltRoe,
        scenario,
        risk_free: riskFree,
        fitted_payout: instrument.fitted_payout,
        growth_to_discount: (ltRoe * (1 - instrument.fitted_payout)) / (0.076 + 0.56 * riskFree),
      }))
    )));
  const printedDomainMeasurement = { summary: domain, observations: printedDomainObservations };
  if (printedDomainObservations.length !== domain.observations
    || Math.min(...printedDomainObservations.map((row) => row.growth_to_discount)) !== domain.low
    || Math.max(...printedDomainObservations.map((row) => row.growth_to_discount)) !== domain.high) {
    throw new Error("printed convexity receipt observations must reproduce the published full-cell domain");
  }
  const algorithmSources = SUSTAINABLE_ALGORITHM_SOURCE_RELS.map((relativePath) => ({
    path: relativePath,
    raw_sha256: digest(fs.readFileSync(path.join(REPO, relativePath))),
  }));
  const selfBlocker = "sustainable_calibration_receipt_not_integrated";
  const remainingBlockers = (sustainable.promotion?.blockers ?? [])
    .filter((blocker) => blocker?.id !== selfBlocker);
  const payoutAvailableAt = new Date(Math.max(
    Date.parse(rimInputs.generated_at),
    Date.parse(spy.fetched_at),
    Date.parse(qqq.fetched_at),
  )).toISOString();
  if ([payoutAvailableAt, sustainable.generated_at].some((value) => !Number.isFinite(Date.parse(value)))) {
    throw new Error("sustainable calibration availability clocks must be valid timestamps");
  }
  const supportSources = SUSTAINABLE_SUPPORT_SOURCE_RELS.map((relativePath) => {
    const measurement = readJson(relativePath);
    return fileSource(`support-${relativePath.replaceAll(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`, relativePath, measurement);
  });
  const sustainableMeasurement = {
    as_of: sustainable.as_of,
    status: sustainable.status,
    calibration: {
      lt_roe_rule: sustainable.calibration.lt_roe_rule,
      payout_multiplier: sustainable.calibration.payout_multiplier,
      twelve_month_conversion: sustainable.calibration.twelve_month_conversion,
    },
    printed_convexity_domain: printedDomainMeasurement,
    promotion: {
      blockers: remainingBlockers,
      findings: sustainable.promotion?.findings ?? [],
      contract: sustainable.promotion?.contract,
    },
  };
  const ltObservations = sustainable.calibration.lt_roe_rule.refit.observations;
  const horizon = sustainable.calibration.twelve_month_conversion.refit;
  return buildCalibrationReceipt({
    generated_at: sustainable.generated_at,
    calibration_cutoff_at: sustainable.generated_at,
    algorithm: {
      id: "fenok-rim-sustainable-index-calibration",
      version: "fenok-rim-sustainable-index-calibration/v1",
      sources: algorithmSources,
      source_sha256: digest(canonicalJson(algorithmSources)),
      parameters: {
        lt_roe_rule: sustainable.calibration.lt_roe_rule.frozen,
        payout_multiplier: sustainable.calibration.payout_multiplier.frozen,
        printed_convexity_domain: domain,
        twelve_month_conversion: sustainable.calibration.twelve_month_conversion.frozen,
      },
    },
    calibration_components: {
      lt_roe_rule: sustainable.calibration.lt_roe_rule,
      payout_multiplier: sustainable.calibration.payout_multiplier,
      printed_convexity_domain: printedDomainMeasurement,
      twelve_month_conversion: sustainable.calibration.twelve_month_conversion,
    },
    sources: [
      fileSource("sustainable-calibration-artifact", SUSTAINABLE_ARTIFACT_REL, sustainableMeasurement),
      fileSource("printed-index-grid", PRINTED_INDEX_GRID_REL, indexGrid),
      fileSource("printed-stock-grid", FIXTURE_REL, stockGrid),
      fileSource("rim-index-inputs", RIM_INDEX_INPUTS_REL, {
        generated_at: rimInputs.generated_at,
        SPX: rimInputs.indices?.SPX?.derived?.payout_ratio,
        NDX: rimInputs.indices?.NDX?.derived?.payout_ratio,
      }),
      ...supportSources,
    ],
    evidence: [
      {
        id: "ltroe-index-centres-2025-12-09",
        observation_at: "2025-12-09T23:59:59.999Z",
        available_as_of: "2025-12-09T23:59:59.999Z",
        point_in_time: true,
        measurement: { observations: ltObservations.filter((row) => row.id.endsWith("@2025-12-09")) },
      },
      {
        id: "ltroe-stock-centres-2026-08-03",
        observation_at: "2026-08-03T23:59:59.999Z",
        available_as_of: "2026-08-03T23:59:59.999Z",
        point_in_time: true,
        measurement: { observations: ltObservations.filter((row) => row.id.endsWith("@2026-08-03")) },
      },
      {
        id: "payout-multiplier-spx-ndx-2026-07-31",
        observation_at: payoutAvailableAt,
        available_as_of: payoutAvailableAt,
        point_in_time: true,
        measurement: {
          source_observation_at: "2026-07-31T23:59:59.999Z",
          rows: sustainable.calibration.payout_multiplier.refit.rows,
        },
      },
      {
        id: "printed-convexity-full-cells-2025-12-09",
        observation_at: "2025-12-09T23:59:59.999Z",
        available_as_of: "2025-12-09T23:59:59.999Z",
        point_in_time: true,
        measurement: printedDomainMeasurement,
      },
      {
        id: "twelve-month-fit-2017-01-06--2022-07-22",
        observation_at: sustainable.generated_at,
        available_as_of: sustainable.generated_at,
        point_in_time: true,
        measurement: {
          source_period: horizon.out_of_sample.fitted_on,
          full_refit: horizon.full,
          point_in_time_operand_filter: true,
        },
      },
      {
        id: "twelve-month-evaluation-2022-09-30--2026-07-17",
        observation_at: sustainable.generated_at,
        available_as_of: sustainable.generated_at,
        point_in_time: true,
        measurement: {
          source_period: horizon.out_of_sample.evaluated_on,
          converted_mae: horizon.out_of_sample.converted_mae,
          raw_band_mae: horizon.out_of_sample.raw_band_mae,
          improves: horizon.out_of_sample.improves,
          point_in_time_operand_filter: true,
        },
      },
    ],
    fit_evidence_ids: [
      "ltroe-index-centres-2025-12-09",
      "ltroe-stock-centres-2026-08-03",
      "payout-multiplier-spx-ndx-2026-07-31",
      "printed-convexity-full-cells-2025-12-09",
      "twelve-month-fit-2017-01-06--2022-07-22",
    ],
    evaluation_evidence_ids: ["twelve-month-evaluation-2022-09-30--2026-07-17"],
    proxy_decisions: [
      { id: "ndx-to-qqq-payout", accepted: true, reason: "tracker_is_index_and_same_basis_identity_measured" },
      { id: "rut-to-iwm-payout", accepted: false, reason: "payout_identity_gate_fails" },
      { id: "sox-to-soxx-payout", accepted: false, reason: "tracker_is_not_the_philadelphia_semiconductor_index" },
      { id: "spx-to-spy-payout", accepted: true, reason: "tracker_is_index_and_same_basis_identity_measured" },
    ],
    source_ledger: sourceLedger,
    external_promotion: {
      production_identified: remainingBlockers.length === 0,
      blockers: remainingBlockers.map((blocker) => blocker.id),
    },
    promotion_requested: true,
  });
}

export function buildIdentificationArtifact() {
  const fixtureBytes = fs.readFileSync(path.join(REPO, FIXTURE_REL));
  const fixture = JSON.parse(fixtureBytes);
  const calibrationEvidenceBytes = fs.readFileSync(path.join(REPO, CALIBRATION_EVIDENCE_REL));
  const calibrationEvidence = JSON.parse(calibrationEvidenceBytes);
  const calibrationReceiptSourceBytes = fs.readFileSync(path.join(REPO, CALIBRATION_RECEIPT_SOURCE_REL));
  const structuralAlgorithmSources = STRUCTURAL_ALGORITHM_SOURCE_RELS.map((relativePath) => ({
    path: relativePath,
    raw_sha256: digest(fs.readFileSync(path.join(REPO, relativePath))),
  }));
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
  const sourceLedgerPath = calibrationEvidence.source_ledger;
  const resolvedSourceLedger = typeof sourceLedgerPath === "string" ? resolveEvidencePath(sourceLedgerPath) : null;
  const sourceLedger = resolvedSourceLedger ? {
    path: sourceLedgerPath,
    resolved_scope: resolvedSourceLedger.resolved_scope,
    expected_sha256: calibrationEvidence.source_ledger_sha256,
    bytes: fs.readFileSync(resolvedSourceLedger.absolute_path),
    measurement: JSON.parse(fs.readFileSync(resolvedSourceLedger.absolute_path, "utf8")),
  } : {
    path: sourceLedgerPath,
    expected_sha256: calibrationEvidence.source_ledger_sha256,
  };
  const calibrationReceipt = buildCalibrationReceipt({
    generated_at: latestFetchedAt(externalBookSources),
    algorithm: {
      id: "fenok-rim-structural-transfer",
      version: "fenok-rim-structural-transfer/v2",
      sources: structuralAlgorithmSources,
      source_sha256: digest(canonicalJson(structuralAlgorithmSources)),
      parameters: {
        external_book_tolerance: 0.03,
        fit_objective: "relative_rms",
        printed_roe_rounding_scope: "within_panel_only",
      },
    },
    sources: [
      { id: "printed-grid-fixture", path: FIXTURE_REL, bytes: fixtureBytes, measurement: fixture },
      { id: "calibration-evidence", path: CALIBRATION_EVIDENCE_REL, bytes: calibrationEvidenceBytes, measurement: calibrationEvidence },
      {
        id: "calibration-receipt-implementation",
        path: CALIBRATION_RECEIPT_SOURCE_REL,
        bytes: calibrationReceiptSourceBytes,
        measurement: { content_sha256: digest(calibrationReceiptSourceBytes) },
      },
      ...Object.entries(EXTERNAL_BOOK_CONFIG).map(([id, config]) => ({
        id: `${id.toLowerCase()}-external-book`,
        path: config.source_file,
        bytes: fs.readFileSync(path.join(REPO, config.source_file)),
        measurement: { measurement_sha256: externalBookSources[id].measurement_sha256 },
      })),
    ],
    evidence: Object.entries(fixture.instruments).map(([id, instrument]) => ({
      id: `stock-grid-${id.toLowerCase()}`,
      observation_at: `${fixture.source_date}T23:59:59.999Z`,
      available_as_of: `${fixture.source_date}T23:59:59.999Z`,
      point_in_time: true,
      measurement: {
        instrument: id,
        artifact: fixture.artifacts[id],
        printed: instrument.printed,
        grids: instrument.grids,
        timestamp_precision: "source_date",
      },
    })),
    fit_evidence_ids: Object.keys(fixture.instruments).map((id) => `stock-grid-${id.toLowerCase()}`),
    evaluation_evidence_ids: [],
    evaluation_evidence_status: "not_applicable",
    proxy_decisions: [],
    source_ledger: sourceLedger,
    external_promotion: {
      production_identified: receipt.production_identified,
      blockers: receipt.blocking_reasons,
    },
    promotion_requested: true,
  });
  const sustainableReceipt = sustainableCalibrationReceipt({ sourceLedger });
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
    calibration_receipt: calibrationReceipt,
    sustainable_calibration_receipt: sustainableReceipt,
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
