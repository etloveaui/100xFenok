#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");

const SCHEMA_VERSION = "nasdaq_giw_sox_constituents.v1";
const DEFAULT_OUTPUT = "indices/nasdaq-giw-sox-constituents.json";
const GIW_WEIGHTING_URL = "https://indexes.nasdaqomx.com/Index/Weighting/SOX";
const GIW_ENDPOINT = "https://indexes.nasdaqomx.com/Index/WeightingData";
const MIN_ROWS = 25;

function parseArgs(argv) {
  const args = {
    date: null,
    lookbackDays: 10,
    output: DEFAULT_OUTPUT,
    write: true,
    publicMirror: true,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--date") {
      args.date = argv[++i];
    } else if (arg.startsWith("--date=")) {
      args.date = arg.slice("--date=".length);
    } else if (arg === "--lookback-days") {
      args.lookbackDays = Number(argv[++i]);
    } else if (arg.startsWith("--lookback-days=")) {
      args.lookbackDays = Number(arg.slice("--lookback-days=".length));
    } else if (arg === "--output") {
      args.output = argv[++i];
    } else if (arg.startsWith("--output=")) {
      args.output = arg.slice("--output=".length);
    } else if (arg === "--check") {
      args.check = true;
      args.write = false;
    } else if (arg === "--no-write") {
      args.write = false;
    } else if (arg === "--no-public-mirror") {
      args.publicMirror = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.lookbackDays) || args.lookbackDays < 0 || args.lookbackDays > 30) {
    throw new Error("--lookback-days must be between 0 and 30");
  }
  return args;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function candidateDates(startDate, lookbackDays) {
  const start = startDate ? new Date(`${startDate}T00:00:00Z`) : new Date();
  if (!Number.isFinite(start.getTime())) throw new Error(`Invalid --date: ${startDate}`);
  const dates = [];
  for (let i = 0; i <= lookbackDays; i += 1) {
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() - i);
    dates.push(isoDate(next));
  }
  return dates;
}

function normalizeRows(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  return rows
    .map((row, index) => {
      const symbol = String(row?.Symbol ?? row?.symbol ?? row?.SecuritySymbol ?? "").trim().toUpperCase();
      const name = String(row?.Name ?? row?.CompanyName ?? row?.["Company Name"] ?? "").trim();
      return {
        rank: index + 1,
        name,
        symbol,
      };
    })
    .filter((row) => row.symbol);
}

async function fetchWeightingRows(tradeDate) {
  const body = new URLSearchParams({
    id: "SOX",
    tradeDate,
    timeOfDay: "SOD",
  });
  const response = await fetch(GIW_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Origin": "https://indexes.nasdaqomx.com",
      "Referer": GIW_WEIGHTING_URL,
      "User-Agent": "100xFenok-data-pipeline/1.0",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Nasdaq GIW WeightingData ${tradeDate}: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return normalizeRows(payload?.aaData);
}

async function fetchLatest(args) {
  const errors = [];
  for (const tradeDate of candidateDates(args.date, args.lookbackDays)) {
    try {
      const rows = await fetchWeightingRows(tradeDate);
      if (rows.length >= MIN_ROWS) {
        return { tradeDate, rows };
      }
      errors.push(`${tradeDate}: only ${rows.length} rows`);
    } catch (error) {
      errors.push(`${tradeDate}: ${error.message}`);
    }
  }
  throw new Error(`No usable SOX GIW constituent payload found. ${errors.join("; ")}`);
}

function buildPayload({ tradeDate, rows }) {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source: "Nasdaq Global Index Watch",
    source_url: GIW_WEIGHTING_URL,
    endpoint: GIW_ENDPOINT,
    access_scope: "public_free_constituent_view_no_official_weight_columns",
    index_id: "SOX",
    index_name: "PHLX Semiconductor",
    time_of_day: "SOD",
    as_of: tradeDate,
    row_count: rows.length,
    symbols: rows.map((row) => row.symbol),
    rows,
    notes: [
      "Nasdaq GIW public free weighting view exposes official SOX constituents but not official weight columns.",
      "RIM builder derives SOX input weights from these official constituents plus stock_action market caps using the published SOX methodology cap schedule.",
      "This file must not be treated as a licensed official weight file.",
    ],
  };
}

function stableComparable(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  delete clone.generated_at;
  return clone;
}

function writeJson(relPath, payload, roots) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const root of roots) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, body, "utf8");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fetched = await fetchLatest(args);
  const payload = buildPayload(fetched);
  if (args.check) {
    const currentPath = path.join(dataRoot, args.output);
    const current = fs.existsSync(currentPath) ? JSON.parse(fs.readFileSync(currentPath, "utf8")) : null;
    if (!current || JSON.stringify(stableComparable(current)) !== JSON.stringify(stableComparable(payload))) {
      throw new Error(`${path.join("data", args.output)} is not up to date with Nasdaq GIW SOX constituents`);
    }
    if (args.publicMirror) {
      const mirrorPath = path.join(publicDataRoot, args.output);
      const mirror = fs.existsSync(mirrorPath) ? JSON.parse(fs.readFileSync(mirrorPath, "utf8")) : null;
      if (!mirror || JSON.stringify(stableComparable(mirror)) !== JSON.stringify(stableComparable(payload))) {
        throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is not up to date with Nasdaq GIW SOX constituents`);
      }
    }
  }
  if (args.write) {
    writeJson(args.output, payload, args.publicMirror ? [dataRoot, publicDataRoot] : [dataRoot]);
  }
  console.log(JSON.stringify({
    ok: true,
    wrote: args.write ? [path.join("data", args.output), ...(args.publicMirror ? [path.join("100xfenok-next/public/data", args.output)] : [])] : [],
    as_of: payload.as_of,
    row_count: payload.row_count,
    symbols: payload.symbols,
    access_scope: payload.access_scope,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
