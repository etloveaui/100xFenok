#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const PARITY_SCHEMA = "us-indices-shadow-parity/v2";
export const SERIES_KEYS = Object.freeze(["sp500", "nasdaq"]);
export const PROVIDER_REVISION_RETENTION_LIMIT = 100;
const FLOAT32_MAX = 3.4028234663852886e38;

export function withinParityTolerance(sourceValue, gasValue) {
  const absolute = Math.abs(sourceValue - gasValue);
  const relative = gasValue === 0 ? Number.POSITIVE_INFINITY : absolute / Math.abs(gasValue);
  return absolute <= 0.05 || relative <= 0.001;
}

export function float32UlpAt(value) {
  if (!Number.isFinite(value)) throw new Error("float32 ULP input must be finite");
  if (Math.abs(value) > FLOAT32_MAX) return null;
  const magnitude = Math.abs(Math.fround(value));
  if (magnitude === 0) return 2 ** -149;
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, magnitude, false);
  const bits = view.getUint32(0, false);
  if (bits >= 0x7f7fffff) {
    view.setUint32(0, bits - 1, false);
    return magnitude - view.getFloat32(0, false);
  }
  view.setUint32(0, bits + 1, false);
  return view.getFloat32(0, false) - magnitude;
}

function float32Rank(value) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, false);
  const bits = view.getUint32(0, false);
  const magnitudeBits = bits & 0x7fffffff;
  return (bits & 0x80000000) === 0 ? magnitudeBits : -magnitudeBits;
}

export function classifyFloat32Change(storedValue, observedValue) {
  if (!Number.isFinite(storedValue) || !Number.isFinite(observedValue)) {
    throw new Error("same-date values must be finite for float32 classification");
  }
  const absolute = Math.abs(storedValue - observedValue);
  const storedUlp = float32UlpAt(storedValue);
  const observedUlp = float32UlpAt(observedValue);
  const ulp = storedUlp === null || observedUlp === null ? null : Math.max(storedUlp, observedUlp);
  const storedFloat32 = Math.fround(storedValue);
  const observedFloat32 = Math.fround(observedValue);
  const storedExact = Number.isFinite(storedFloat32)
    && (Object.is(storedFloat32, storedValue) || storedFloat32 === storedValue);
  const observedExact = Number.isFinite(observedFloat32)
    && (Object.is(observedFloat32, observedValue) || observedFloat32 === observedValue);
  const stepDistance = storedExact && observedExact
    ? Math.abs(float32Rank(storedFloat32) - float32Rank(observedFloat32))
    : null;
  const deltaUlps = ulp === null || !Number.isFinite(absolute) ? null : absolute / ulp;
  const withinOneUlp = stepDistance !== null && stepDistance <= 1;
  return {
    float32_ulp: ulp,
    delta_float32_ulps: deltaUlps,
    float32_step_distance: stepDistance,
    stored_value_float32_exact: storedExact,
    observed_value_float32_exact: observedExact,
    within_one_float32_ulp: withinOneUlp,
    same_date_change_class: withinOneUlp ? "float32_ulp_flutter" : "provider_value_change",
  };
}

function rowsByDate(rows) {
  return new Map(rows.map((row) => [row.date, row.value]));
}

export function checkUsIndicesParity({
  shadowSeries,
  gasSeries,
  providerRevisions = [],
  observedAt = new Date().toISOString(),
}) {
  const series = {};
  for (const key of SERIES_KEYS) {
    const gas = rowsByDate(gasSeries[key] ?? []);
    series[key] = (shadowSeries[key] ?? []).map((row) => {
      if (!gas.has(row.date)) {
        return {
          date: row.date,
          source_value: row.value,
          gas_value: null,
          abs_diff: null,
          relative_diff: null,
          within_tolerance: null,
          status: "pending",
        };
      }
      const gasValue = gas.get(row.date);
      const absolute = Math.abs(row.value - gasValue);
      const relative = gasValue === 0 ? null : absolute / Math.abs(gasValue);
      const within = withinParityTolerance(row.value, gasValue);
      return {
        date: row.date,
        source_value: row.value,
        gas_value: gasValue,
        abs_diff: absolute,
        relative_diff: relative,
        within_tolerance: within,
        status: within ? "pass" : "fail",
      };
    });
  }
  const rows = Object.values(series).flat();
  const parityRowFailures = rows.filter((row) => row.status === "fail").length;
  const currentProviderRevisions = providerRevisions.filter(
    (row) => (row.last_observed_at ?? row.observed_at) === observedAt,
  );
  const revisionFailures = currentProviderRevisions.filter((row) => row.within_tolerance === false).length;
  return {
    schema_version: PARITY_SCHEMA,
    observed_at: observedAt,
    tolerance: { absolute_index_points: 0.05, relative_ratio: 0.001, rule: "either" },
    provider_revision_retention_limit: PROVIDER_REVISION_RETENTION_LIMIT,
    summary: {
      pass: rows.filter((row) => row.status === "pass").length,
      fail: parityRowFailures + revisionFailures,
      pending: rows.filter((row) => row.status === "pending").length,
      parity_row_fail: parityRowFailures,
      provider_revision_events: currentProviderRevisions.length,
      provider_revision_history_events: providerRevisions.length,
      provider_revision_out_of_tolerance: revisionFailures,
    },
    provider_revisions: providerRevisions,
    series,
  };
}

function revisionIdentity(row) {
  return JSON.stringify([row.series, row.date, row.stored_value, row.observed_value]);
}

function earlierObservedAt(left, right) {
  const leftTime = Date.parse(left ?? "");
  const rightTime = Date.parse(right ?? "");
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return leftTime <= rightTime ? left : right;
}

function laterObservedAt(left, right) {
  const leftTime = Date.parse(left ?? "");
  const rightTime = Date.parse(right ?? "");
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return leftTime >= rightTime ? left : right;
}

export function mergeProviderRevisionHistory(previous, incoming) {
  const history = Array.isArray(previous)
    ? previous.map((row) => ({ ...row }))
    : [];
  const byIdentity = new Map(history.map((row, index) => [revisionIdentity(row), index]));
  for (const row of incoming) {
    const identity = revisionIdentity(row);
    const existingIndex = byIdentity.get(identity);
    if (existingIndex !== undefined) {
      const existing = history[existingIndex];
      history[existingIndex] = {
        ...existing,
        first_observed_at: earlierObservedAt(existing.first_observed_at ?? existing.observed_at, row.observed_at),
        last_observed_at: laterObservedAt(existing.last_observed_at ?? existing.observed_at, row.observed_at),
        occurrences: (Number.isInteger(existing.occurrences) ? existing.occurrences : 1) + 1,
      };
      continue;
    }
    byIdentity.set(identity, history.length);
    history.push({
      ...row,
      first_observed_at: row.observed_at,
      last_observed_at: row.observed_at,
      occurrences: 1,
    });
  }
  return history
    .sort((left, right) => {
      const leftObservedAt = Date.parse(left.last_observed_at ?? left.observed_at ?? "");
      const rightObservedAt = Date.parse(right.last_observed_at ?? right.observed_at ?? "");
      const leftRecency = Number.isFinite(leftObservedAt) ? leftObservedAt : Number.NEGATIVE_INFINITY;
      const rightRecency = Number.isFinite(rightObservedAt) ? rightObservedAt : Number.NEGATIVE_INFINITY;
      return leftRecency - rightRecency || revisionIdentity(left).localeCompare(revisionIdentity(right));
    })
    .slice(-PROVIDER_REVISION_RETENTION_LIMIT);
}

function readSeries(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
}

// Dormant historical Yahoo-vs-GAS report generator. The live workflow does not
// invoke or upload it after the atomic GAS ownership cutover.
export function emitUsIndicesParity({
  shadowRoot = path.join(REPO_ROOT, "data", "admin", "us-indices-daily", "shadow"),
  gasCanonicalRoot = path.join(REPO_ROOT, "data", "indices"),
  outputPath = path.join(REPO_ROOT, "data", "admin", "us-indices-daily", "parity-report.json"),
  observedAt = new Date().toISOString(),
  providerRevisions = [],
} = {}) {
  const shadowSeries = Object.fromEntries(SERIES_KEYS.map((key) => [key, readSeries(path.join(shadowRoot, `${key}.json`))]));
  const gasSeries = Object.fromEntries(SERIES_KEYS.map((key) => [key, readSeries(path.join(gasCanonicalRoot, `${key}.json`))]));
  const previousReport = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : null;
  const revisionHistory = mergeProviderRevisionHistory(previousReport?.provider_revisions, providerRevisions);
  const report = checkUsIndicesParity({ shadowSeries, gasSeries, providerRevisions: revisionHistory, observedAt });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, outputPath);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(emitUsIndicesParity().summary));
}
