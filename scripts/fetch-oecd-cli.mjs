#!/usr/bin/env node

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAttemptRow,
  buildSingleLaneShard,
  returnedTuple,
  threwTuple,
  transportError,
  writeJsonAtomic,
} from "./lib/data-supply-attempt-shard.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LANE_ID = "oecd_cli";
const ATTEMPT_SHARD_RELATIVE_PATH = "data/admin/data-supply-state/detection-attempts/oecd_cli.json";
export const OECD_SERIES = Object.freeze({
  AUS: "australia", BRA: "brazil", CAN: "canada", CHN: "china", FRA: "france",
  G20: "g20", G7: "g7", DEU: "germany", IND: "india", IDN: "indonesia",
  ITA: "italy", JPN: "japan", KOR: "korea", A5M: "major_five_asia_economies",
  G4E: "major_four_european_countries", MEX: "mexico", NAFTA: "nafta",
  ZAF: "south_africa", ESP: "spain", TUR: "turkiye", GBR: "united_kingdom", USA: "united_states",
});
const AREA_CODES = Object.keys(OECD_SERIES);
const ENDPOINT = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,/${AREA_CODES.join("+")}.M.LI...AA...H?startPeriod=2016-05&format=csvfilewithlabels`;

export function requestBytes(url, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "text/csv", "User-Agent": "100xFenok-platform/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("OECD SDMX request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function parseOecdCsv(text, observedAt = null) {
  const rows = csvRows(String(text));
  const header = rows.shift() ?? [];
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  for (const column of ["REF_AREA", "TIME_PERIOD", "OBS_VALUE"]) {
    if (!Number.isInteger(index[column])) throw new Error(`OECD CSV missing column ${column}`);
  }
  const series = Object.fromEntries(Object.values(OECD_SERIES).map((key) => [key, []]));
  for (const row of rows) {
    const code = row[index.REF_AREA];
    if (!Object.hasOwn(OECD_SERIES, code)) throw new Error(`unknown OECD area ${code}`);
    const period = row[index.TIME_PERIOD];
    const value = Number(row[index.OBS_VALUE]);
    if (!/^\d{4}-\d{2}$/u.test(period) || !Number.isFinite(value)) throw new Error(`invalid OECD observation ${code}:${period}`);
    series[OECD_SERIES[code]].push({ date: `${period}-01`, value });
  }
  const missing = Object.entries(series).filter(([, values]) => values.length === 0).map(([key]) => key);
  if (missing.length > 0) throw new Error(`missing OECD series: ${missing.join(", ")}`);
  for (const values of Object.values(series)) {
    values.sort((left, right) => left.date.localeCompare(right.date));
    if (new Set(values.map((row) => row.date)).size !== values.length) throw new Error("duplicate OECD periods");
  }
  const periods = [...new Set(Object.values(series).flatMap((values) => values.map((row) => row.date)))].sort();
  return {
    schema_version: "oecd-cli-shadow/v1",
    source: "OECD SDMX DF_CLI",
    source_endpoint: "OECD.SDD.STES,DSD_STES@DF_CLI",
    generated_at: observedAt,
    latest_date: periods.at(-1),
    latest_values: Object.fromEntries(Object.entries(series).map(([key, values]) => [key, values.at(-1).value])),
    series,
    records: periods.map((date) => ({
      date,
      period: date.slice(0, 7),
      values: Object.fromEntries(Object.entries(series).filter(([, values]) => values.some((row) => row.date === date)).map(([key, values]) => [key, values.find((row) => row.date === date).value])),
    })),
  };
}

function parityReport(shadow, canonicalPath, observedAt) {
  let canonical;
  try { canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8")); } catch { canonical = null; }
  const existing = canonical?.datasets?.oecd_cli?.coverage?.latest_values ?? {};
  const revisions = Object.entries(shadow.latest_values).filter(([key, value]) => Number.isFinite(existing[key]) && existing[key] !== value)
    .map(([key, value]) => ({ key, canonical_value: existing[key], shadow_value: value, abs_diff: Math.abs(existing[key] - value) }));
  return {
    schema_version: "oecd-cli-shadow-parity/v1",
    observed_at: observedAt,
    canonical_status: canonical ? "readable" : "unavailable",
    compared_latest_values: Object.keys(existing).length,
    revisions,
  };
}

function writePairAtomic(entries) {
  const staged = entries.map(({ target, value }) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    return { target, temporary, prior: fs.existsSync(target) ? fs.readFileSync(target) : null };
  });
  try { for (const row of staged) fs.renameSync(row.temporary, row.target); }
  catch (error) {
    for (const row of staged) {
      fs.rmSync(row.temporary, { force: true });
      if (row.prior === null) fs.rmSync(row.target, { force: true }); else fs.writeFileSync(row.target, row.prior);
    }
    throw error;
  }
}

export async function runOecdCliShadow({
  shadowPath = path.join(REPO_ROOT, "data/admin/oecd_cli/shadow/oecd-cli.json"),
  parityReportPath = path.join(REPO_ROOT, "data/admin/oecd_cli/parity-report.json"),
  attemptShardPath = path.join(REPO_ROOT, ATTEMPT_SHARD_RELATIVE_PATH),
  canonicalPath = path.join(REPO_ROOT, "data/macro/activity-surveys.json"),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = `gh-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-oecd-cli`,
} = {}) {
  let tuple;
  let payload = null;
  try {
    const response = await request(ENDPOINT);
    if (response.statusCode < 200 || response.statusCode >= 300) tuple = returnedTuple({ httpStatus: response.statusCode });
    else {
      try {
        payload = parseOecdCsv(response.body, observedAt);
        tuple = returnedTuple({ httpStatus: response.statusCode, decode: "ok", payload: "non_empty", assertions: [{ id: "sdmx_cli_rows", passed: true }] });
      } catch {
        tuple = returnedTuple({ httpStatus: response.statusCode, decode: "ok", payload: "non_empty", assertions: [{ id: "sdmx_cli_rows", passed: false }] });
      }
    }
  } catch (error) {
    tuple = threwTuple(transportError(error) ? "transport" : "unexpected");
  }
  const row = buildAttemptRow({ laneId: LANE_ID, memberId: null, tuple, attemptId, observedAt });
  writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row }));
  if (payload === null) return { ok: false, updated: false, exitCode: 2, row };
  const parity = parityReport(payload, canonicalPath, observedAt);
  writePairAtomic([{ target: shadowPath, value: payload }, { target: parityReportPath, value: parity }]);
  return { ok: true, updated: true, exitCode: 0, row, parity };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOecdCliShadow().then((result) => { console.log(JSON.stringify({ ok: result.ok, exit_code: result.exitCode })); process.exitCode = result.exitCode; })
    .catch((error) => { console.error(error); process.exitCode = 2; });
}
