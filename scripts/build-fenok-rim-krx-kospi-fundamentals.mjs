#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KRX_KOSPI_SCREEN_URL = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201010107";
export const KRX_JSON_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
export const KRX_HISTORY_BLD = "dbms/MDC/STAT/standard/MDCSTAT00702";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "data/computed/fenok-rim/kospi-official-fundamentals.json");
const DEFAULT_ARCHIVE_DIR = path.join(ROOT, "data/computed/fenok-rim/kospi-official-history");

function isoDate(value, label) {
  const text = String(value ?? "").replaceAll(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(text)) throw new Error(`${label}: YYYYMMDD date required`);
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() + 1 !== month || instant.getUTCDate() !== day) {
    throw new Error(`${label}: invalid date`);
  }
  const result = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return result;
}

function metric(value, label, { optional = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "--") {
    if (optional) return null;
    throw new Error(`KRX KOSPI response missing ${label}`);
  }
  const result = Number(text.replaceAll(",", "").replace("%", ""));
  if (optional && result === 0) return null;
  if (!Number.isFinite(result) || result <= 0) throw new Error(`KRX KOSPI response invalid ${label}`);
  return result;
}

export function parseKrxKospiFundamentals(payload, { requestedDate }) {
  if (typeof payload === "string") {
    if (payload.trim() === "LOGOUT") throw new Error("KRX Data Marketplace authentication required");
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new Error("KRX KOSPI response is not JSON");
    }
  }
  const requested = isoDate(requestedDate, "requestedDate");
  const rows = Array.isArray(payload?.output) ? payload.output : [];
  const row = rows.find((candidate) => {
    if (!candidate?.TRD_DD) return false;
    return isoDate(candidate.TRD_DD, "returned trading date") === requested;
  });
  if (!row) throw new Error("KRX KOSPI exact returned trading-date row missing");
  if (row.IDX_NM && String(row.IDX_NM).trim() !== "코스피") throw new Error("KRX KOSPI identity mismatch");
  const returned = isoDate(row.TRD_DD, "returned trading date");
  const close = metric(row.CLSPRC_IDX, "close");
  const trailingPe = metric(row.WT_PER, "trailing PER");
  const forwardPe = metric(row.FWD_PER, "forward PER", { optional: true });
  const priceToBook = metric(row.WT_STKPRC_NETASST_RTO, "PBR");
  const dividendYield = metric(row.DIV_YD, "dividend yield") / 100;
  return {
    identity: "KOSPI",
    internal_index_code: "1001",
    requested_date: requested,
    as_of: returned,
    date_source: "response_TRD_DD",
    fundamentals: {
      close,
      price_to_book: priceToBook,
      price_to_earnings_trailing: trailingPe,
      price_to_earnings_forward: forwardPe,
      dividend_yield: dividendYield,
    },
    derived: {
      current_roe_trailing_basis: priceToBook / trailingPe,
      payout_trailing_basis: dividendYield * trailingPe,
    },
  };
}

async function fetchKrxKospi(date, cookie, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!cookie) throw new Error("KRX_DATA_COOKIE is required for the authenticated screen route");
  const body = new URLSearchParams({
    bld: KRX_HISTORY_BLD,
    indTpCd: "1",
    indTpCd2: "001",
    strtDd: date.replaceAll("-", ""),
    endDd: date.replaceAll("-", ""),
  });
  const response = await fetchImpl(KRX_JSON_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookie,
      Referer: KRX_KOSPI_SCREEN_URL,
      "User-Agent": "Mozilla/5.0 FENO-RIM/1.0",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`KRX KOSPI request failed: HTTP ${response.status}`);
  if (text.trim() === "LOGOUT") throw new Error("KRX Data Marketplace session expired or authentication required");
  return text;
}

function writeJsonAtomic(destination, payload) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
}

function archiveSnapshot({ archiveDir, rawText, snapshot, automaticDownload }) {
  if (!archiveDir) return null;
  fs.mkdirSync(archiveDir, { recursive: true });
  const suffix = snapshot.source.raw_response_sha256;
  const basename = `${snapshot.as_of}_${suffix}`;
  const rawPath = path.join(archiveDir, `${basename}.raw.json`);
  const parsedPath = path.join(archiveDir, `${basename}.json`);
  const manifestPath = path.join(archiveDir, `${basename}.manifest.json`);
  const latestPath = path.join(archiveDir, "latest.json");
  if (fs.existsSync(latestPath)) {
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    if (automaticDownload && latest.as_of > snapshot.as_of) {
      throw new Error(`KRX KOSPI automatic date regression: ${snapshot.as_of} < ${latest.as_of}`);
    }
  }
  if (fs.existsSync(rawPath)) {
    const existing = fs.readFileSync(rawPath, "utf8").trimEnd();
    const existingHash = crypto.createHash("sha256").update(existing).digest("hex");
    const expectedHash = crypto.createHash("sha256").update(rawText.trimEnd()).digest("hex");
    if (existingHash !== expectedHash) throw new Error(`KRX KOSPI raw archive hash collision or corruption at ${rawPath}`);
  } else {
    fs.writeFileSync(rawPath, rawText.endsWith("\n") ? rawText : `${rawText}\n`, { flag: "wx" });
  }
  if (fs.existsSync(parsedPath)) {
    if (!fs.existsSync(manifestPath)) throw new Error(`KRX KOSPI parsed archive manifest missing at ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const parsedHash = crypto.createHash("sha256").update(fs.readFileSync(parsedPath)).digest("hex");
    if (manifest.raw_response_sha256 !== snapshot.source.raw_response_sha256 || manifest.parsed_json_sha256 !== parsedHash) {
      throw new Error(`KRX KOSPI parsed archive hash collision or corruption at ${parsedPath}`);
    }
  } else {
    writeJsonAtomic(parsedPath, snapshot);
    writeJsonAtomic(manifestPath, {
      schema_version: "fenok_rim_krx_kospi_snapshot_manifest.v1",
      raw_response_sha256: snapshot.source.raw_response_sha256,
      parsed_json_sha256: crypto.createHash("sha256").update(fs.readFileSync(parsedPath)).digest("hex"),
      raw_response: path.basename(rawPath),
      snapshot_json: path.basename(parsedPath),
    });
  }
  const snapshotManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pointer = {
    schema_version: "fenok_rim_krx_kospi_archive_pointer.v1",
    as_of: snapshot.as_of,
    sha256: snapshot.source.raw_response_sha256,
    snapshot_json: path.basename(parsedPath),
    snapshot_manifest: path.basename(manifestPath),
    parsed_json_sha256: snapshotManifest.parsed_json_sha256,
    raw_response: path.basename(rawPath),
  };
  if (automaticDownload) {
    const latest = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, "utf8")) : null;
    if (!latest || latest.as_of <= snapshot.as_of) writeJsonAtomic(latestPath, pointer);
  }
  return { rawPath, parsedPath, manifestPath, latestPath: automaticDownload ? latestPath : null };
}

export async function buildKrxKospiFundamentals({
  date,
  responsePath = null,
  cookie = process.env.KRX_DATA_COOKIE,
  archiveDir = DEFAULT_ARCHIVE_DIR,
  fetchImpl = fetch,
  timeoutMs = 15000,
} = {}) {
  const requestedDate = isoDate(date, "date");
  const automaticDownload = !responsePath;
  const resolvedArchiveDir = archiveDir ? path.resolve(archiveDir) : null;
  const rawText = responsePath
    ? fs.readFileSync(path.resolve(responsePath), "utf8")
    : await fetchKrxKospi(requestedDate, cookie, { fetchImpl, timeoutMs });
  const parsed = parseKrxKospiFundamentals(rawText, { requestedDate });
  const snapshot = {
    schema_version: "fenok_rim_krx_kospi_official_fundamentals.v1",
    generated_at: new Date().toISOString(),
    source: {
      publisher: "Korea Exchange",
      screen_menu_id: "MDC0201010107",
      screen_no: "11007",
      screen_url: KRX_KOSPI_SCREEN_URL,
      endpoint: KRX_JSON_URL,
      bld: KRX_HISTORY_BLD,
      retrieval: automaticDownload ? "authenticated_official_screen_request" : "caller_supplied_response",
      raw_response_sha256: crypto.createHash("sha256").update(rawText).digest("hex"),
    },
    ...parsed,
    status: "ready_official_same_date_trailing_snapshot",
    valuation_role: "exact-index trailing ROE and payout; forward FY1-FY3 path remains separate",
    runtime_yoo_value_injection: false,
  };
  const archive = archiveSnapshot({ archiveDir: resolvedArchiveDir, rawText, snapshot, automaticDownload });
  return archive ? {
    ...snapshot,
    archive: {
      directory: path.relative(ROOT, resolvedArchiveDir),
      raw_response: path.basename(archive.rawPath),
      snapshot_json: path.basename(archive.parsedPath),
      snapshot_manifest: path.basename(archive.manifestPath),
      latest_pointer: archive.latestPath ? path.basename(archive.latestPath) : null,
    },
  } : snapshot;
}

export function parseKrxArgs(argv) {
  const result = { date: null, responsePath: null, output: DEFAULT_OUTPUT, archiveDir: DEFAULT_ARCHIVE_DIR };
  let outputExplicit = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (["--date", "--response", "--output", "--archive-dir"].includes(flag)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--date") result.date = value;
      else if (flag === "--response") result.responsePath = value;
      else if (flag === "--output") {
        result.output = path.resolve(value);
        outputExplicit = true;
      }
      else result.archiveDir = path.resolve(value);
      index += 1;
    } else if (flag === "--no-archive") result.archiveDir = null;
    else if (flag === "--stdout") {
      result.output = null;
      outputExplicit = true;
    }
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!result.date) throw new Error("--date is required");
  if (result.responsePath && !outputExplicit) {
    throw new Error("--response requires an explicit --output or --stdout so manual input cannot replace the canonical artifact");
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseKrxArgs(process.argv.slice(2));
  const artifact = await buildKrxKospiFundamentals(args);
  if (args.output) writeJsonAtomic(args.output, artifact);
  else process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}
