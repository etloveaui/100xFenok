#!/usr/bin/env node
/**
 * Persist the non-public S1 stock promotion gate plan as a derived admin artifact.
 *
 * This intentionally does not mutate S0 stock scoring, fenok_signals, or any public mirror.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAudit } from "./audit-fenok-stock-promotion-candidates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_REL = "data/admin/fenok-s1-stock-promotion-gate-plan.json";
const SCHEMA_VERSION = "fenok-s1-stock-promotion-gate-plan-admin/v0.1";

function parseArgs(argv) {
  const args = {
    check: false,
    noWrite: false,
    json: false,
    out: OUT_REL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--out") {
      const value = argv[++i];
      if (!value || path.isAbsolute(value) || value.includes("..")) {
        throw new Error(`Expected --out to be a repo-relative safe path, got: ${value}`);
      }
      args.out = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function writeJson(relPath, payload) {
  const absPath = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relPath;
}

function sourceChecksOk(artifact) {
  return Array.isArray(artifact?.acceptance_checks)
    && artifact.acceptance_checks.length > 0
    && artifact.acceptance_checks.every((check) => check?.ok === true);
}

function buildAdminArtifact({ outRel, noWrite }) {
  const audit = buildAudit({ promotionGatePlanReport: true });
  const sourceArtifact = audit.s1_stock_promotion_candidates?.joined_gate?.promotion_gate_plan_artifact;
  if (!sourceArtifact) {
    throw new Error("S1 promotion gate plan artifact was not produced");
  }

  const writePolicy = {
    admin_only: true,
    public_mirror: false,
    public_mirror_allowed: false,
    raw_private_rows: false,
    public_s0_mutation: false,
    stock_action_index_mutation: false,
    fenok_signals_mutation: false,
    etf_lane_mutation: false,
  };
  const counts = {
    ...sourceArtifact.counts,
    files_written: noWrite ? 0 : 1,
    public_files_written: 0,
    admin_artifact_rows: sourceArtifact.counts?.promotion_gate_rows ?? 0,
    blocked_plan_rows: sourceArtifact.counts?.excluded_blocked_rows ?? 0,
  };
  const acceptanceChecks = [
    {
      id: "s1_admin_artifact_source_checks_pass",
      ok: sourceChecksOk(sourceArtifact),
      detail: `source_checks=${sourceArtifact.acceptance_checks?.length ?? 0}`,
    },
    {
      id: "s1_admin_artifact_preserves_s0_public_count",
      ok: Number.isInteger(sourceArtifact.counts?.public_s0_before)
        && sourceArtifact.counts.public_s0_before > 0
        && sourceArtifact.counts?.public_s0_after_this_artifact === sourceArtifact.counts.public_s0_before
        && sourceArtifact.counts?.s0_overlap_rows === 0,
      detail: `${sourceArtifact.counts?.public_s0_before}->${sourceArtifact.counts?.public_s0_after_this_artifact}, s0_overlap_rows=${sourceArtifact.counts?.s0_overlap_rows}`,
    },
    {
      id: "s1_admin_artifact_private_only_no_public_mirror",
      ok: writePolicy.admin_only === true && writePolicy.public_mirror === false && counts.public_files_written === 0,
      detail: `out=${outRel}, public_files_written=${counts.public_files_written}`,
    },
    {
      id: "s1_admin_artifact_no_public_daily_gated_claim",
      ok: sourceArtifact.contract?.disallowed_claims
        && Object.values(sourceArtifact.contract.disallowed_claims).every((value) => value === false),
      detail: JSON.stringify(sourceArtifact.contract?.disallowed_claims ?? null),
    },
    {
      id: "s1_admin_artifact_current_counts",
      ok: Number.isInteger(counts.promotion_gate_rows)
        && Number.isInteger(counts.excluded_blocked_rows)
        && counts.promotion_gate_rows >= 0
        && counts.excluded_blocked_rows >= 0
        && counts.promotion_gate_rows + counts.excluded_blocked_rows === counts.s1_gap_total
        && counts.future_candidate_count_if_approved === counts.public_s0_before + counts.promotion_gate_rows
        && counts.admin_artifact_rows === counts.promotion_gate_rows
        && counts.blocked_plan_rows === counts.excluded_blocked_rows,
      detail: `promotion=${counts.promotion_gate_rows}, blocked=${counts.excluded_blocked_rows}, future=${counts.future_candidate_count_if_approved}`,
    },
  ];

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    purpose: "Persist the current non-public S1 stock promotion gate plan so the 108 joined-ready candidates are durable admin evidence, not chat/stdout state.",
    source_artifact_schema_version: sourceArtifact.schema_version,
    source_command: sourceArtifact.file_plan?.command ?? "node scripts/audit-fenok-stock-promotion-candidates.mjs --promotion-gate-plan-report --check",
    file_plan: {
      command: "node scripts/write-fenok-s1-promotion-gate-plan.mjs --check",
      output_file: outRel,
      files_written: noWrite ? [] : [outRel],
      public_files_written: [],
      excluded_paths: sourceArtifact.file_plan?.excluded_paths ?? [],
    },
    write_policy: writePolicy,
    raw_policy: {
      raw_public: false,
      raw_rows_included: false,
      private_artifact_paths_included: false,
      public_mirror_allowed: false,
    },
    counts,
    blocker_counts: sourceArtifact.blocker_counts,
    acceptance_checks: acceptanceChecks,
    source_acceptance_checks: sourceArtifact.acceptance_checks,
    promotion_gate_rows: sourceArtifact.promotion_gate_rows,
    blocked_plan_rows: sourceArtifact.blocked_plan_rows,
  };
}

const args = parseArgs(process.argv.slice(2));
const artifact = buildAdminArtifact({ outRel: args.out, noWrite: args.noWrite });
const ok = artifact.acceptance_checks.every((check) => check.ok === true);
let wrote = null;

if (!args.noWrite) {
  wrote = writeJson(args.out, artifact);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({ ok, wrote, artifact }, null, 2)}\n`);
} else {
  console.log(`Fenok S1 promotion gate admin artifact: ${ok ? "PASS" : "FAIL"}`);
  console.log(`output: ${args.noWrite ? "(no-write)" : wrote}`);
  console.log(`promotion_gate_rows: ${artifact.counts.promotion_gate_rows}`);
  console.log(`excluded_blocked_rows: ${artifact.counts.excluded_blocked_rows}`);
  console.log(`future_candidate_count_if_approved: ${artifact.counts.future_candidate_count_if_approved}`);
  console.log(`public_s0_after_this_artifact: ${artifact.counts.public_s0_after_this_artifact}`);
}

process.exitCode = args.check && !ok ? 1 : 0;
