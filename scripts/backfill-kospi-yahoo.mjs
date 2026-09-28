#!/usr/bin/env node
/**
 * One-time Yahoo ^KS11 backfill for the KRX public index-daily artifact.
 *
 * Context: data/computed/fenok-edge-korea-krx-index-daily.json held only the
 * latest single-day KRX snapshot, so the home KOSPI sparkline (which slices
 * the last 21 composite points) rendered nothing. The daily producer now
 * accumulates dates; this script fills the missing history once from Yahoo
 * ^KS11 daily closes (same row schema, explicit backfill origin fields).
 *
 * Merge rule: existing (KRX-official) rows always win a date conflict, and no
 * backfill row may advance the document as_of past the retained KRX maximum.
 * The script is idempotent: re-running with the same upstream data changes
 * nothing. Default is a dry run; pass --write to apply.
 *
 * Usage: node scripts/backfill-kospi-yahoo.mjs [--days N] [--write]
 *        [--target PATH] [--range 6mo]
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KRX_PUBLIC_INDEX_CLOSES_MAX_DATES,
  krxPublicIndexRowKey,
  mergeKrxPublicIndexCloses,
} from "./fetch-fenok-krx-daily-private.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_TARGET = "data/computed/fenok-edge-korea-krx-index-daily.json";
const YAHOO_SYMBOL = "^KS11";
const YAHOO_ENCODED = "%5EKS11";
const YAHOO_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";
const COMPOSITE_IDENTITY = Object.freeze({ market: "KOSPI", index_class: "KOSPI", index_name: "코스피" });

function parseArgs(argv) {
  const args = { days: 100, range: "6mo", target: DEFAULT_TARGET, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") args.write = true;
    else if (arg === "--days" || arg === "--range" || arg === "--target") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      if (arg === "--days") {
        args.days = Number.parseInt(value, 10);
        if (!Number.isInteger(args.days) || args.days < 2) throw new Error(`days must be an integer >= 2: ${value}`);
      } else if (arg === "--range") args.range = value;
      else args.target = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/backfill-kospi-yahoo.mjs [--days N] [--write] [--target PATH] [--range 6mo]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function requestBytes(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json", "User-Agent": "100xFenok-platform/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("Yahoo chart request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function localDate(unixSeconds, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(unixSeconds * 1000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function finiteNumber(value) {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof num === "number" && Number.isFinite(num) ? num : null;
}

function round(value, digits = 4) {
  return value === null ? null : Number(value.toFixed(digits));
}

// Parse the Yahoo chart payload into date-ordered OHLCV rows. Unlike the
// quote-only Yahoo ticker producer, the backfill needs OHLC + volume to fill
// the KRX row schema as completely as possible.
export function parseKs11Chart(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result || result.meta?.symbol !== YAHOO_SYMBOL) throw new Error(`Yahoo chart symbol mismatch for ${YAHOO_SYMBOL}`);
  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0] ?? {};
  const timeZone = result.meta?.exchangeTimezoneName;
  if (!Array.isArray(timestamps) || typeof timeZone !== "string") {
    throw new Error(`Yahoo chart arrays are invalid for ${YAHOO_SYMBOL}`);
  }
  const length = timestamps.length;
  for (const key of ["close", "open", "high", "low", "volume"]) {
    if (quote[key] !== undefined && (!Array.isArray(quote[key]) || quote[key].length !== length)) {
      throw new Error(`Yahoo chart ${key} array is invalid for ${YAHOO_SYMBOL}`);
    }
  }
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    const close = finiteNumber(quote.close?.[index]);
    if (close === null || close <= 0) continue;
    const date = localDate(timestamps[index], timeZone);
    if (!validIsoDate(date)) continue;
    rows.push({
      date,
      close,
      open: finiteNumber(quote.open?.[index]),
      high: finiteNumber(quote.high?.[index]),
      low: finiteNumber(quote.low?.[index]),
      volume: finiteNumber(quote.volume?.[index]),
    });
  }
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildKs11BackfillRows(chartRows, { days = 100 } = {}) {
  const window = chartRows.slice(-Math.max(days + 1, 2));
  const rows = [];
  for (let i = 0; i < window.length; i += 1) {
    const current = window[i];
    const previous = i > 0 ? window[i - 1] : null;
    const change = previous ? current.close - previous.close : null;
    rows.push({
      ...COMPOSITE_IDENTITY,
      date: current.date,
      close: current.close,
      change: round(change, 4),
      change_pct: previous && previous.close > 0 ? round((change / previous.close) * 100, 4) : null,
      open: current.open,
      high: current.high,
      low: current.low,
      acc_trade_volume: current.volume,
      acc_trade_value: null,
      origin: "yahoo_chart_backfill",
      origin_symbol: YAHOO_SYMBOL,
    });
  }
  // The leading row has no previous close for change/change_pct; drop it when
  // the window still leaves enough history.
  const trimmed = rows.length > days ? rows.slice(-days) : rows;
  return trimmed.filter((row) => row.change !== null || trimmed.length < 2);
}

export function applyKs11Backfill(document, backfillRows) {
  const previous = document && typeof document === "object" && !Array.isArray(document) ? document : null;
  const existingKeys = new Set(
    (Array.isArray(previous?.indices) ? previous.indices : []).map(krxPublicIndexRowKey),
  );
  const ceilingDate = Array.isArray(previous?.indices) && previous.indices.length > 0
    ? previous.indices.map((row) => row?.date).filter(validIsoDate).sort().at(-1) ?? null
    : null;
  // KRX-official rows always win: only fill (identity, date) slots KRX never reported.
  const fillRows = backfillRows.filter((row) => {
    if (ceilingDate !== null && row.date > ceilingDate) return false;
    return !existingKeys.has(krxPublicIndexRowKey(row));
  });
  const merged = mergeKrxPublicIndexCloses({
    freshRows: fillRows,
    previousDocument: previous,
    ceilingDate,
  });
  return {
    filled: fillRows.length,
    skipped_conflict: backfillRows.length - fillRows.length,
    merged,
  };
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const targetPath = path.isAbsolute(args.target) ? args.target : path.join(REPO_ROOT, args.target);
  const document = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const request = dependencies.request ?? requestBytes;
  const url = `${YAHOO_ENDPOINT}/${YAHOO_ENCODED}?range=${encodeURIComponent(args.range)}&interval=1d`;
  const response = await request(url);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Yahoo chart request failed: HTTP ${response.statusCode}`);
  }
  const chartRows = parseKs11Chart(JSON.parse(response.body));
  const backfillRows = buildKs11BackfillRows(chartRows, { days: Math.min(args.days, KRX_PUBLIC_INDEX_CLOSES_MAX_DATES) });
  const { filled, skipped_conflict: skipped, merged } = applyKs11Backfill(document, backfillRows);
  const next = {
    ...document,
    generated_at: new Date().toISOString(),
    as_of: merged.date_max ?? document.as_of,
    status: merged.indices.length > 0 ? "ready" : "unavailable",
    row_count: merged.indices.length,
    distinct_dates: merged.distinct_dates,
    date_min: merged.date_min,
    date_max: merged.date_max,
    notes: Array.isArray(document.notes) && !document.notes.some((note) => String(note).includes("yahoo_chart_backfill"))
      ? [...document.notes, "Yahoo ^KS11 one-time history backfill (origin=yahoo_chart_backfill rows); KRX rows win date conflicts."]
      : document.notes,
    indices: merged.indices,
  };
  const result = {
    ok: true,
    target: path.relative(REPO_ROOT, targetPath).split(path.sep).join("/"),
    yahoo_rows: chartRows.length,
    backfill_rows: backfillRows.length,
    filled,
    skipped_conflict: skipped,
    row_count: next.row_count,
    distinct_dates: next.distinct_dates,
    date_min: next.date_min,
    date_max: next.date_max,
    as_of: next.as_of,
    wrote: false,
  };
  if (args.write) {
    const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
    const temporary = `${targetPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, targetPath);
    result.wrote = true;
  }
  console.log(JSON.stringify(result, null, 2));
  return { result, document: next };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().then(({ result }) => {
    if (!result.wrote) console.log("(dry run — pass --write to apply)");
    process.exitCode = 0;
  }).catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 2;
  });
}
