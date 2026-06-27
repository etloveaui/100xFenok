#!/usr/bin/env node
/**
 * check-data-freshness-report.mjs — Human-readable data-freshness dashboard.
 *
 * Reads the same product-surface-coverage.json that qa:data-freshness gates on
 * and prints a per-surface report aligned with the REPO freshness policy
 * (generate-product-surface-coverage.mjs):
 *   - HARD fail (7d): market_facts, event_surface, etf_center, screener
 *   - WARN only (8d): yf colletion date (stock_detail, market_valuation)
 *   - HARD 1d:  admin_data_lab self-check
 *   - HARD 14d: edgar summaries (stock_detail)
 *
 * Exit code = number of surfaces with HARD stale checks (0 = pass, >0 = fail).
 * WarnOnly checks may print warnings but do NOT contribute to exit code.
 *
 * Usage:
 *   node scripts/check-data-freshness-report.mjs
 *   node scripts/check-data-freshness-report.mjs --json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const COVERAGE_PATH = path.join(REPO_ROOT, "data", "admin", "product-surface-coverage.json");

const JSON_MODE = process.argv.includes("--json");

function readCoverage() {
  try {
    const raw = fs.readFileSync(COVERAGE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function daysAgo(iso) {
  if (!iso || typeof iso !== "string") return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function fmtAge(d) {
  if (d == null) return "—";
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  return `${d}d ago`;
}

function fmtStatus(c) {
  if (!c) return { icon: "⚫", label: "unknown" };
  if (c.status === "stale") return c.warn_only ? { icon: "🟡", label: "WARN" } : { icon: "🔴", label: "FAIL" };
  if (c.status === "partial" || c.warn_only) return { icon: "🟡", label: "WARN" };
  return { icon: "🟢", label: "OK" };
}

const coverage = readCoverage();
if (!coverage) {
  console.error("product-surface-coverage.json not found at", COVERAGE_PATH);
  process.exit(2);
}

const surfaces = Array.isArray(coverage.surfaces) ? coverage.surfaces : [];
let hardStaleCount = 0;
let warnCount = 0;
let okCount = 0;
const rows = [];

for (const s of surfaces) {
  const checks = Array.isArray(s.checks) ? s.checks : [];
  const freshnessChecks = checks.filter(
    (c) => c && typeof c.max_age_days === "number" && c.max_age_days > 0 && typeof c.age_days === "number"
  );

  const hardFails = freshnessChecks.filter((c) => c.status === "stale" && !c.warn_only);
  const warns = freshnessChecks.filter((c) => (c.status === "stale" && c.warn_only) || c.status === "partial");
  const allOk = hardFails.length === 0 && warns.length === 0;

  if (hardFails.length > 0) hardStaleCount += 1;
  else if (warns.length > 0) warnCount += 1;
  else okCount += 1;

  const worstCheck = [...hardFails, ...warns][0] ?? freshnessChecks[0];
  const status = hardFails.length > 0 ? "FAIL" : warns.length > 0 ? "WARN" : "OK";

  rows.push({
    id: s.id ?? "unknown",
    status,
    description: s.description_en ?? s.description ?? "",
    asOf: s.as_of,
    age: daysAgo(s.as_of),
    hardFails: hardFails.map((c) => ({ label: c.label, age: c.age_days, max: c.max_age_days })),
    warns: warns.map((c) => ({ label: c.label, age: c.age_days, max: c.max_age_days, warn_only: c.warn_only })),
    allChecks: freshnessChecks.map((c) => ({
      label: c.label,
      age: c.age_days,
      max: c.max_age_days,
      warnOnly: c.warn_only ?? false,
      originalStatus: c.status ?? "ready",
    })),
  });
}

if (JSON_MODE) {
  console.log(JSON.stringify({
    generated_at: coverage.generated_at,
    totals: { ok: okCount, warn: warnCount, fail: hardStaleCount },
    surfaces: rows,
  }, null, 2));
} else {
  console.log("");
  console.log("═".repeat(52));
  console.log("  100x Fenok  •  Data Freshness Report");
  console.log(`  ${coverage.generated_at?.slice(0, 19) ?? "unknown"}`);
  console.log("═".repeat(52));
  console.log("");

  for (const row of rows) {
    const marker = row.status === "FAIL" ? "🔴" : row.status === "WARN" ? "🟡" : "🟢";
    console.log(`  ${marker} ${row.id}  (${fmtAge(row.age)})`);
    if (row.description) console.log(`     ${row.description}`);
    for (const c of row.allChecks) {
      const m = fmtStatus({ status: c.originalStatus, warn_only: c.warnOnly });
      const note = c.warnOnly ? " [warn-only]" : "";
      const ageStr = c.age != null ? fmtAge(c.age) : "—";
      console.log(`     ${m.icon} ${c.label}: ${ageStr} / max ${c.max}d${note}`);
    }
    if (row.hardFails.length > 0) {
      for (const f of row.hardFails) console.log(`     ❌ HARD STALE: ${f.label} (${fmtAge(f.age)})`);
    }
    console.log("");
  }

  console.log("─".repeat(52));
  const exitMsg = hardStaleCount > 0
    ? `🔴 ${hardStaleCount} surface(s) HARD stale — gate FAILS`
    : warnCount > 0
      ? `🟡 ${warnCount} surface(s) with warnings — gate OK (warn-only)`
      : "🟢 All surfaces fresh — gate OK";
  console.log(`  ${exitMsg}`);
  console.log("─".repeat(52));
  console.log("");
}

process.exit(hardStaleCount);
