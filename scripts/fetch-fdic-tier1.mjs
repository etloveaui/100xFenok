#!/usr/bin/env node

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

export function generateQuarters(now = new Date()) {
  const quarterEnds = ["0331", "0630", "0930", "1231"];
  const quarters = [];
  const currentYear = now.getUTCFullYear();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 45);
  for (let year = 2009; year <= currentYear; year += 1) {
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const quarterMonth = quarter * 3 + 2;
      const quarterEnd = new Date(Date.UTC(year, quarterMonth + 1, 0));
      if (quarterEnd <= cutoff) quarters.push(`${year}${quarterEnds[quarter]}`);
    }
  }
  return quarters;
}

function buildUrl(quarter) {
  const params = new URLSearchParams({
    limit: "10000",
    fields: "RBC1AAJ,RISDATE",
    filters: `RISDATE:${quarter}`,
  });
  return `https://api.fdic.gov/banks/financials?${params.toString()}`;
}

export function requestBytes(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "100xFenok-fdic-tier1/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("FDIC request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function quarterRow(document, quarter) {
  const ratios = document.data
    .map((row) => Number(row?.data?.RBC1AAJ))
    .filter(Number.isFinite);
  if (ratios.length === 0) return null;
  const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  return {
    date: `${quarter.slice(0, 4)}-${quarter.slice(4, 6)}-${quarter.slice(6, 8)}`,
    value: Number(average.toFixed(2)),
    banks: ratios.length,
  };
}

async function evaluateQuarter({ request, quarter }) {
  try {
    const classified = classifyEndpointResponse(await request(buildUrl(quarter), quarter), {
      laneId: "fdic_tier1",
    });
    if (classified.status !== "ready") return { ...classified, quarter };
    const row = quarterRow(classified.document, quarter);
    if (row !== null) return { ...classified, quarter, row };
    return {
      ...attemptResult("empty_payload", returnedTuple({
        httpStatus: classified.attempt.http_status,
        auth: classified.attempt.auth,
        decode: "ok",
        payload: "empty",
      }), classified.document),
      quarter,
    };
  } catch (error) {
    const exceptionKind = transportError(error) ? "transport" : "unexpected";
    return {
      ...attemptResult(
        exceptionKind === "transport" ? "transport_error" : "unexpected_error",
        threwTuple(exceptionKind),
      ),
      quarter,
    };
  }
}

export async function runFdicTier1({
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "fdic-tier1.json"),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", "fdic-tier1.json"),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "fdic_tier1.json"),
  quarters = generateQuarters(),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("fdic-tier1", observedAt),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!Array.isArray(quarters) || quarters.length === 0) throw new Error("FDIC quarter list must be non-empty");
  const requestResults = [];
  for (const [index, quarter] of quarters.entries()) {
    requestResults.push(await evaluateQuarter({ request, quarter }));
    if (index < quarters.length - 1) await sleep(300);
  }
  const worst = worstRequestResult(requestResults);
  const attempt = writeAttemptShard({
    laneId: "fdic_tier1",
    attemptShardPath,
    observedAt,
    attemptId,
    result: worst,
  });
  if (worst.status !== "ready") return { ok: false, reason: worst.reason, updated: false, attempt };

  const data = requestResults.map((row) => row.row).sort((a, b) => a.date.localeCompare(b.date));
  const output = {
    updated: observedAt,
    source: "FDIC",
    description: "Average Tier 1 Capital Ratio (RBC1AAJ)",
    data,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  atomicWrite(canonicalPath, serialized);
  atomicWrite(publicPath, serialized);
  return { ok: true, reason: "ok", updated: true, attempt, quarters: data.length };
}

async function main() {
  const result = await runFdicTier1();
  if (!result.ok) {
    console.error(`FDIC Tier1 fetch failed: ${result.reason}; last-known-good artifacts retained`);
    process.exitCode = 1;
    return;
  }
  console.log(`Saved ${result.quarters} FDIC quarters and current-attempt evidence`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
