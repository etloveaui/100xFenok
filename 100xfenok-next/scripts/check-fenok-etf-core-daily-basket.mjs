#!/usr/bin/env node
/**
 * ETF Core Daily Basket gate.
 *
 * Requires the generated admin artifact and public-safe summary to match a
 * clean regeneration. The gate allows not_ready, but forbids pretending stale
 * selected rows are daily-ready.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ADMIN_REL,
  SUMMARY_REL,
  buildEtfCoreDailyBasket,
  normalizeGenerated,
  validateEtfCoreDailyBasket,
} from "../../scripts/build-fenok-etf-core-daily-basket.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_ADMIN_REL = "100xfenok-next/public/data/admin/fenok-etf-core-daily-basket.json";
const PUBLIC_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_etf_core_daily_basket_summary.json";

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(abs(relPath), "utf8"));
}

function readJsonOrNull(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function fileExists(relPath) {
  return fs.existsSync(abs(relPath));
}

export function runEtfCoreDailyBasketChecks() {
  const errors = [];
  const existingAdmin = readJsonOrNull(ADMIN_REL);
  const existingSummary = readJsonOrNull(SUMMARY_REL);
  const regenerated = buildEtfCoreDailyBasket();
  const admin = existingAdmin ?? regenerated.admin;
  const summary = existingSummary ?? regenerated.summary;
  const validation = validateEtfCoreDailyBasket(admin, summary);
  errors.push(...validation.errors);

  if (!existingAdmin) errors.push(`${ADMIN_REL} must exist`);
  if (!existingSummary) errors.push(`${SUMMARY_REL} must exist`);
  if (existingAdmin && JSON.stringify(normalizeGenerated(existingAdmin)) !== JSON.stringify(normalizeGenerated(regenerated.admin))) {
    errors.push("admin ETF core daily basket differs from clean-base regenerated payload");
  }
  if (existingSummary && JSON.stringify(normalizeGenerated(existingSummary)) !== JSON.stringify(normalizeGenerated(regenerated.summary))) {
    errors.push("public summary ETF core daily basket differs from clean-base regenerated payload");
  }
  if (fileExists(PUBLIC_ADMIN_REL)) errors.push("public admin ETF core daily basket mirror must not exist");
  if (fileExists(PUBLIC_SUMMARY_REL) && existingSummary) {
    const publicSummary = readJson(PUBLIC_SUMMARY_REL);
    if (JSON.stringify(normalizeGenerated(publicSummary)) !== JSON.stringify(normalizeGenerated(existingSummary))) {
      errors.push("public ETF core daily basket summary mirror differs from generated summary");
    }
  }

  const rows = Array.isArray(admin?.rows) ? admin.rows : [];
  const summaryRows = Array.isArray(summary?.rows) ? summary.rows : [];
  const newEtfRows = rows.filter((row) => row.status === "new_etf_radar_only" || row.core_candidate_allowed === false);
  if (newEtfRows.length > 0) errors.push("core basket rows must not include new ETF radar-only rows");
  if (admin?.readiness?.core_daily_basket_ready === true && Number(admin?.readiness?.stale_selected_count) > 0) {
    errors.push("core_daily_basket_ready=true cannot have stale selected rows");
  }

  return {
    ok: errors.length === 0,
    errors,
    counts: {
      selected_count: rows.length,
      summary_rows: summaryRows.length,
      fresh_selected_count: admin?.coverage?.fresh_selected_count ?? null,
      stale_selected_count: admin?.coverage?.stale_selected_count ?? null,
      structural_candidate_count: admin?.coverage?.structural_candidate_count ?? null,
    },
    readiness: admin?.readiness ?? null,
    privacy_proof: {
      admin_file_present: Boolean(existingAdmin),
      summary_file_present: Boolean(existingSummary),
      public_admin_mirror_absent: !fileExists(PUBLIC_ADMIN_REL),
      public_summary_mirror_present: fileExists(PUBLIC_SUMMARY_REL),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runEtfCoreDailyBasketChecks();
  if (!result.ok) {
    console.error("[fenok-etf-core-daily-basket-gate] FAIL");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `[fenok-etf-core-daily-basket-gate] ok `
    + `(selected=${result.counts.selected_count}, fresh=${result.counts.fresh_selected_count}, stale=${result.counts.stale_selected_count})`
  );
}
