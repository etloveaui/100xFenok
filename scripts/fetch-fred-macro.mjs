#!/usr/bin/env node

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  atomicWrite,
  classifyEndpointResponse,
  defaultAttemptId,
  returnedTuple,
  threwTuple,
  transportError,
  worstRequestResult,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const FRED_MACRO_SERIES = Object.freeze([
  { id: "M2SL", days: 3650 },
  { id: "WALCL", days: 3650 },
  { id: "RRPONTSYD", days: 3650 },
  { id: "SOFR", days: 3650 },
  { id: "IORB", days: 3650 },
  { id: "WRESBAL", days: 3650 },
  { id: "GDP", days: 1095 },
]);

const MAX_RETRIES = 2;
const BACKOFFS_MS = Object.freeze([1000, 2000, 4000]);

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

function buildUrl(seriesId, days, observedAt, apiKey) {
  const endDate = new Date(observedAt);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - days);
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: formatDate(startDate),
    observation_end: formatDate(endDate),
    sort_order: "asc",
  });
  return `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
}

export function requestBytes(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "100xFenok-fred-macro/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("FRED macro request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function usableObservations(document) {
  return document.observations
    .filter((item) => String(item?.value ?? "").trim() !== ".")
    .map((item) => ({ date: String(item?.date ?? ""), value: Number(item?.value) }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.value));
}

async function evaluateSeries({ request, apiKey, series, observedAt, sleep }) {
  const url = buildUrl(series.id, series.days, observedAt, apiKey);
  let last = null;
  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    if (retry > 0) await sleep(BACKOFFS_MS[Math.min(retry - 1, BACKOFFS_MS.length - 1)]);
    try {
      last = classifyEndpointResponse(await request(url, series.id), {
        laneId: "fred_macro",
        authRequired: true,
      });
    } catch (error) {
      const exceptionKind = transportError(error) ? "transport" : "unexpected";
      last = attemptResult(
        exceptionKind === "transport" ? "transport_error" : "unexpected_error",
        threwTuple(exceptionKind),
      );
    }
    if (last.status === "ready") {
      const rows = usableObservations(last.document);
      if (rows.length > 0) return { ...last, rows };
      last = attemptResult("empty_payload", returnedTuple({
        httpStatus: last.attempt.http_status,
        auth: last.attempt.auth,
        decode: "ok",
        payload: "empty",
      }), last.document);
    }
    if (retry < MAX_RETRIES) continue;
  }
  return last;
}

export async function runFredMacro({
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "fred-macro.json"),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", "fred-macro.json"),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "fred_macro.json"),
  apiKey = process.env.FRED_API_KEY,
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("fred-macro", observedAt),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let requestResults;
  if (!apiKey) {
    requestResults = [attemptResult("unexpected_error", threwTuple("unexpected"))];
  } else {
    requestResults = [];
    for (const series of FRED_MACRO_SERIES) {
      requestResults.push(await evaluateSeries({ request, apiKey, series, observedAt, sleep }));
      if (series !== FRED_MACRO_SERIES.at(-1)) await sleep(500);
    }
  }

  const worst = worstRequestResult(requestResults);
  const attempt = writeAttemptShard({
    laneId: "fred_macro",
    attemptShardPath,
    observedAt,
    attemptId,
    result: worst,
  });
  if (worst.status !== "ready") return { ok: false, reason: worst.reason, updated: false, attempt };

  const series = Object.fromEntries(FRED_MACRO_SERIES.map((item, index) => [item.id, requestResults[index].rows]));
  const output = { updated: observedAt, series };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  atomicWrite(canonicalPath, serialized);
  atomicWrite(publicPath, serialized);
  return { ok: true, reason: "ok", updated: true, attempt, seriesCount: FRED_MACRO_SERIES.length };
}

async function main() {
  const result = await runFredMacro();
  if (!result.ok) {
    console.error(`FRED macro fetch failed: ${result.reason}; last-known-good artifacts retained`);
    process.exitCode = 1;
    return;
  }
  console.log(`Saved ${result.seriesCount} FRED macro series and current-attempt evidence`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
