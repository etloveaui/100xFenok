#!/usr/bin/env node

// FENO RIM v2 — evidence manifest (Phase 1, PLAN_FENO_RIM_REBUILD_v2).
//
// One versioned manifest assigns exactly one role per evidence id and freezes
// the calibration cutoff. Roles are frozen BEFORE any fit exists; the final
// holdout stays empty until the next published bounded RIM claim is sealed.
// Family B consumers must refuse any input whose evidence id is absent here.
//
// Deterministic: identical inputs produce an identical manifest hash; the
// generated_at timestamp is not part of the hash.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MANIFEST_SCHEMA_VERSION = "feno_rim_v2_evidence_manifest.v1";

// Owner ruling: every claim published up to and including this date is
// development material. The final holdout is the NEXT bounded claim.
export const CALIBRATION_CUTOFF_AT = "2026-08-05";

export const ROLES = Object.freeze([
  "STRUCTURE", "FIT", "SELECT", "VALIDATE", "FINAL_HOLDOUT", "CONTEXT_ONLY",
]);

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const canonicalJson = (value) => JSON.stringify(value);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function fileSha(relativePath) {
  return sha256(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

// Role policy, frozen in code and covered by tests. Floors, ambiguous rows and
// wrong-family labels never score; two-sided claims validate; printed grids
// identify structure. Nothing is FIT or SELECT until a fit exists, and
// FINAL_HOLDOUT stays null until a sealed next claim arrives.
function roleForClaim(claim) {
  const label = claim.label;
  const raw = String(claim.raw_value ?? "");
  if (label !== "RIM") return "CONTEXT_ONLY";
  if (raw.startsWith("AMBIGUOUS")) return "CONTEXT_ONLY";
  if (raw.includes("~") || (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw))) {
    // bounded range or point: two-sided, may validate; never fits.
    return "VALIDATE";
  }
  if (raw.includes("이상")) return "CONTEXT_ONLY"; // one-sided floor
  return "CONTEXT_ONLY";
}

export function buildEvidenceManifest({ generatedAt = new Date().toISOString() } = {}) {
  const calibration = readJson("scripts/fixtures/fenok-rim-calibration-evidence.json");
  const calibrationSha = fileSha("scripts/fixtures/fenok-rim-calibration-evidence.json");
  const gridSha = fileSha("scripts/fixtures/fenok-rim-2025-12-09-grid.json");
  const stockSha = fileSha("scripts/fixtures/fenok-rim-2026-08-03-stock-grids.json");

  const evidence = [];

  // Printed grid cells: structure identification for the reproduction family.
  evidence.push({
    evidence_id: "grid-2025-12-09-54cells",
    role: "STRUCTURE",
    source: { path: "scripts/fixtures/fenok-rim-2025-12-09-grid.json", sha256: gridSha },
    publication_date: "2025-12-09",
    first_knowable_at: "2025-12-09",
    asset: "SPX|CCMP|RUT",
    model_family: "current_2025_index_grid",
    metric: "fair_value_grid_cells",
    unit: "index_points",
    value_kind: "bounded_grid",
  });

  evidence.push({
    evidence_id: "stock-2026-08-03-36cells",
    role: "STRUCTURE",
    source: { path: "scripts/fixtures/fenok-rim-2026-08-03-stock-grids.json", sha256: stockSha },
    publication_date: "2026-08-03",
    first_knowable_at: "2026-08-03",
    asset: "Samsung|Hynix",
    model_family: "current_2026_stock_sheet",
    metric: "fair_value_grid_cells",
    unit: "KRW_per_share",
    value_kind: "bounded_grid",
  });

  // Dated published claims, role-assigned by the frozen policy.
  for (const claim of calibration.claims) {
    evidence.push({
      evidence_id: claim.evidence_id,
      role: roleForClaim(claim),
      source: { url: claim.source, sha256: calibrationSha },
      publication_date: claim.date,
      first_knowable_at: claim.date,
      asset: claim.asset,
      model_family: "weekly_public_rim_claims",
      metric: claim.metric,
      unit: "percent_upside",
      value_kind: claim.label,
      raw_value: claim.raw_value,
    });
  }

  evidence.sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));

  const body = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    calibration_cutoff_at: CALIBRATION_CUTOFF_AT,
    roles_frozen: true,
    final_holdout: null,
    evidence,
  };
  const manifestSha = sha256(canonicalJson(body));
  return { ...body, generated_at: generatedAt, manifest_sha256: manifestSha };
}

export function assertManifestIntegrity(manifest) {
  const errors = [];
  const ids = new Set();
  for (const row of manifest.evidence) {
    if (ids.has(row.evidence_id)) errors.push(`duplicate id ${row.evidence_id}`);
    ids.add(row.evidence_id);
    if (!ROLES.includes(row.role)) errors.push(`${row.evidence_id}: unknown role ${row.role}`);
    if (row.first_knowable_at > manifest.calibration_cutoff_at) {
      errors.push(`${row.evidence_id}: first-knowable ${row.first_knowable_at} postdates cutoff`);
    }
  }
  const byRole = (role) => manifest.evidence.filter((row) => row.role === role).map((row) => row.evidence_id);
  const fitSelect = new Set([...byRole("FIT"), ...byRole("SELECT")]);
  for (const id of byRole("FINAL_HOLDOUT")) {
    if (fitSelect.has(id)) errors.push(`${id}: fit/select overlaps final holdout`);
  }
  if (errors.length) throw new Error(`evidence manifest integrity: ${errors.join("; ")}`);
  return true;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const manifest = buildEvidenceManifest();
  assertManifestIntegrity(manifest);
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const counts = {};
  for (const row of manifest.evidence) counts[row.role] = (counts[row.role] ?? 0) + 1;
  console.log(`evidence manifest: ${manifest.evidence.length} ids, roles ${JSON.stringify(counts)}, sha ${manifest.manifest_sha256.slice(0, 12)}`);
  console.log(`written: ${path.join(outDir, "evidence-manifest.json")}`);
}
