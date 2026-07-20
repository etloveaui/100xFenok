#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const PARITY_SCHEMA = "us-indices-shadow-parity/v1";
export const SERIES_KEYS = Object.freeze(["sp500", "nasdaq"]);

export function withinParityTolerance(sourceValue, gasValue) {
  const absolute = Math.abs(sourceValue - gasValue);
  const relative = gasValue === 0 ? Number.POSITIVE_INFINITY : absolute / Math.abs(gasValue);
  return absolute <= 0.05 || relative <= 0.001;
}

function rowsByDate(rows) {
  return new Map(rows.map((row) => [row.date, row.value]));
}

export function checkUsIndicesParity({ shadowSeries, gasSeries, observedAt = new Date().toISOString() }) {
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
  return {
    schema_version: PARITY_SCHEMA,
    observed_at: observedAt,
    tolerance: { absolute_index_points: 0.05, relative_ratio: 0.001, rule: "either" },
    summary: {
      pass: rows.filter((row) => row.status === "pass").length,
      fail: rows.filter((row) => row.status === "fail").length,
      pending: rows.filter((row) => row.status === "pending").length,
    },
    series,
  };
}

function readSeries(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
}

export function emitUsIndicesParity({
  shadowRoot = path.join(REPO_ROOT, "data", "admin", "us-indices-daily", "shadow"),
  gasCanonicalRoot = path.join(REPO_ROOT, "data", "indices"),
  outputPath = path.join(REPO_ROOT, "data", "admin", "us-indices-daily", "parity-report.json"),
  observedAt = new Date().toISOString(),
} = {}) {
  const shadowSeries = Object.fromEntries(SERIES_KEYS.map((key) => [key, readSeries(path.join(shadowRoot, `${key}.json`))]));
  const gasSeries = Object.fromEntries(SERIES_KEYS.map((key) => [key, readSeries(path.join(gasCanonicalRoot, `${key}.json`))]));
  const report = checkUsIndicesParity({ shadowSeries, gasSeries, observedAt });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, outputPath);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(emitUsIndicesParity().summary));
}
