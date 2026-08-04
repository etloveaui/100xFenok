#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RUSSELL_2000_FACTSHEET_URL = "https://research.ftserussell.com/Analytics/FactSheets/Home/DownloadSingleIssue?issueName=US2000USD&isManual=True";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARCHIVE_DIR = path.join(ROOT, "data/computed/fenok-rim/russell2000-history");

function number(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Russell 2000 factsheet missing ${label}`);
  const value = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(value)) throw new Error(`Russell 2000 factsheet invalid ${label}`);
  return value;
}

function isoDate(month, day, year) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseRussell2000FactsheetText(text) {
  if (!/Russell 2000(?:®)? Index/.test(text)) throw new Error("Russell 2000 identity missing");
  const date = text.match(/\(As of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\)/i);
  if (!date) throw new Error("Russell 2000 factsheet as-of date missing");
  const priceToBook = number(text, /Price\s*\/\s*Book\s+([\d,.]+)/i, "Price/Book");
  const dividendYieldPct = number(text, /Dividend Yield\s+([\d,.]+)/i, "Dividend Yield");
  const peExNegative = number(text, /P\s*\/\s*E Ex-Neg Earnings\s+([\d,.]+)/i, "P/E Ex-Neg Earnings");
  const epsGrowth5yPct = number(text, /EPS Growth\s*-\s*5 Years\s+([\d,.]+)/i, "EPS Growth - 5 Years");
  const holdings = number(text, /Number of Holdings\s+([\d,.]+)/i, "Number of Holdings");
  const dividendYield = dividendYieldPct / 100;
  const epsGrowth5y = epsGrowth5yPct / 100;
  return {
    identity: "Russell 2000",
    ticker: "RTY",
    as_of: isoDate(date[1], date[2], date[3]),
    fundamentals: {
      price_to_book: priceToBook,
      dividend_yield: dividendYield,
      price_to_earnings_ex_negative: peExNegative,
      eps_growth_5y: epsGrowth5y,
      holdings,
    },
    derived: {
      current_roe_ex_negative_basis: priceToBook / peExNegative,
      payout_ex_negative_basis: dividendYield * peExNegative,
    },
  };
}

function parseArgs(argv) {
  const result = { pdf: null, output: null, archiveDir: DEFAULT_ARCHIVE_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--pdf" || flag === "--output" || flag === "--archive-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
      result[flag === "--archive-dir" ? "archiveDir" : flag.slice(2)] = value;
      index += 1;
    } else if (flag === "--no-archive") {
      result.archiveDir = null;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  return result;
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Russell 2000 factsheet download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error("Russell 2000 factsheet response is not PDF");
  fs.writeFileSync(destination, bytes);
}

function writeJsonAtomic(destination, payload) {
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
}

export function archiveRussell2000Snapshot({ archiveDir, pdfBytes, snapshot, automaticDownload }) {
  if (!archiveDir) return null;
  const resolved = path.resolve(archiveDir);
  fs.mkdirSync(resolved, { recursive: true });
  const suffix = snapshot.source.sha256.slice(0, 12);
  const basename = `${snapshot.as_of}_${suffix}`;
  const pdfPath = path.join(resolved, `${basename}.pdf`);
  const jsonPath = path.join(resolved, `${basename}.json`);
  const latestPath = path.join(resolved, "latest.json");
  if (fs.existsSync(latestPath)) {
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    if (automaticDownload && latest.as_of > snapshot.as_of) {
      throw new Error(`Russell 2000 automatic factsheet date regression: ${snapshot.as_of} < ${latest.as_of}`);
    }
  }
  if (fs.existsSync(pdfPath)) {
    const existingHash = crypto.createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex");
    if (existingHash !== snapshot.source.sha256) throw new Error(`Russell 2000 archive hash collision at ${pdfPath}`);
  } else {
    fs.writeFileSync(pdfPath, pdfBytes, { flag: "wx" });
  }
  if (!fs.existsSync(jsonPath)) writeJsonAtomic(jsonPath, snapshot);
  const pointer = {
    schema_version: "fenok_rim_russell2000_archive_pointer.v1",
    as_of: snapshot.as_of,
    sha256: snapshot.source.sha256,
    snapshot_json: path.basename(jsonPath),
    raw_pdf: path.basename(pdfPath),
  };
  const currentLatest = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, "utf8")) : null;
  if (!currentLatest || currentLatest.as_of <= snapshot.as_of) {
    const nextLatestPath = `${latestPath}.next`;
    writeJsonAtomic(nextLatestPath, pointer);
    fs.renameSync(nextLatestPath, latestPath);
  }
  return { directory: resolved, snapshot_json: jsonPath, raw_pdf: pdfPath, latest_pointer: latestPath };
}

export async function buildRussell2000Fundamentals({ pdf = null, archiveDir = DEFAULT_ARCHIVE_DIR } = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-rut-factsheet-"));
  try {
    const pdfPath = pdf ? path.resolve(pdf) : path.join(temporaryRoot, "russell2000.pdf");
    if (!pdf) await download(RUSSELL_2000_FACTSHEET_URL, pdfPath);
    const textPath = path.join(temporaryRoot, "russell2000.txt");
    execFileSync("pdftotext", ["-layout", pdfPath, textPath], { stdio: "pipe" });
    const bytes = fs.readFileSync(pdfPath);
    const parsed = parseRussell2000FactsheetText(fs.readFileSync(textPath, "utf8"));
    const snapshot = {
      schema_version: "fenok_rim_russell2000_official_fundamentals.v1",
      generated_at: new Date().toISOString(),
      source: {
        publisher: "LSEG FTSE Russell",
        url: RUSSELL_2000_FACTSHEET_URL,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        retrieval: pdf ? "caller_supplied_pdf" : "automatic_official_download",
      },
      ...parsed,
      status: "ready_official_quarterly_snapshot",
      valuation_role: "exact-index fundamentals snapshot; price/as-of alignment and long-run ROE model remain separate gates",
      runtime_yoo_value_injection: false,
    };
    const archive = archiveRussell2000Snapshot({
      archiveDir,
      pdfBytes: bytes,
      snapshot,
      automaticDownload: !pdf,
    });
    return archive ? {
      ...snapshot,
      archive: {
        directory: path.relative(ROOT, archive.directory),
        snapshot_json: path.basename(archive.snapshot_json),
        raw_pdf: path.basename(archive.raw_pdf),
        latest_pointer: path.basename(archive.latest_pointer),
      },
    } : snapshot;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const output = await buildRussell2000Fundamentals({ pdf: args.pdf, archiveDir: args.archiveDir });
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (args.output) writeJsonAtomic(path.resolve(args.output), output);
  else process.stdout.write(serialized);
}
