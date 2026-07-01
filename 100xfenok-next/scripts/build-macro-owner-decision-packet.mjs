#!/usr/bin/env node
/**
 * #296 rank-1 macro owner decision packet.
 *
 * Builds a no-mutation packet from the canonical-root inventory and the local
 * macro-owner live-equivalence smoke gate. It does not record an owner decision;
 * it prepares the exact preserve/remap/retire choice surface.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventoryScript = path.join(__dirname, "check-canonical-root-inventory.mjs");
const liveEquivalenceScript = path.join(__dirname, "check-macro-owner-live-equivalence.mjs");

function parseArgs(argv) {
  const args = {
    decisionRecordJson: null,
    decisionRecordPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--decision-record") {
      args.decisionRecordPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--decision-record=")) {
      args.decisionRecordPath = arg.slice("--decision-record=".length);
      continue;
    }
    if (arg === "--decision-record-json") {
      args.decisionRecordJson = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--decision-record-json=")) {
      args.decisionRecordJson = arg.slice("--decision-record-json=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function runJson(scriptPath) {
  const raw = execFileSync(process.execPath, [scriptPath, "--json"], { encoding: "utf8" });
  return JSON.parse(raw);
}

function readDecisionRecord(recordPath, recordJson) {
  if (recordJson) return JSON.parse(recordJson);
  if (!recordPath) return null;
  return JSON.parse(fs.readFileSync(recordPath, "utf8"));
}

function fail(message, packet, json) {
  if (json && packet) console.log(JSON.stringify(packet, null, 2));
  console.error(`[macro-owner-decision-packet] ${message}`);
  process.exit(1);
}

function decisionRecordTemplate(review, liveProof) {
  return {
    schema_version: "macro-owner-decision-record/v0.1",
    family_id: review.family_id,
    decision: "preserve|remap|retire",
    owner_approved_by: "<owner>",
    decided_at: "<ISO-8601 timestamp>",
    local_live_equivalence_proof_status: liveProof.proof_status,
    local_live_equivalence_rows_checked: liveProof.rows_checked,
    mutation_approved: false,
    notes: "Decision record only; redirect/delete/deploy requires separate explicit approval.",
  };
}

function nextGatedSlice(review, nextCandidate) {
  return {
    id: "macro_owner_decision_record",
    family_id: review.family_id,
    required_before_queue_release: true,
    mutation: "none",
    mutation_allowed: false,
    validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<json>'",
    required_record_schema: "macro-owner-decision-record/v0.1",
    required_decisions: ["preserve", "remap", "retire"],
    required_mutation_flag: false,
    rank_2_candidate_after_valid_record: nextCandidate?.family_id ?? null,
  };
}

function safeEnforcementSlices(review, nextCandidate) {
  return [
    {
      id: "owner_decision_record_validation",
      gate: "before_rank_2_release",
      decision: "pending",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      allowed_next_action: "validate a supplied owner record; keep rank 1 active until the record is valid",
      acceptance: [
        "record schema is macro-owner-decision-record/v0.1",
        `family_id is ${review.family_id}`,
        "decision is preserve, remap, or retire",
        "local proof status and row count match the current packet",
        "mutation_approved is false",
      ],
    },
    {
      id: "preserve_bridge_documentation",
      gate: "after_valid_preserve_record",
      decision: "preserve",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      allowed_next_action: "document the preserve decision and keep the legacy bridge behind the current owner/compatibility routes",
      acceptance: [
        "Home remains search-first",
        "legacy macro-monitor HTML stays out of mobile primary IA",
        "rank 2 is only a review candidate after the valid record is present",
      ],
    },
    {
      id: "remap_proposal_dry_run",
      gate: "after_valid_remap_record",
      decision: "remap",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      allowed_next_action: "prepare an href-remap proposal and rollback plan; do not edit links until explicit mutation approval",
      acceptance: [
        `proposed destination remains ${review.owner_route}`,
        "dashboard/home entrypoints are compared against native macro-chart PRO IA",
        "redirect/delete/deploy remain blocked",
      ],
    },
    {
      id: "retire_readiness_packet",
      gate: "after_valid_retire_record",
      decision: "retire",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      allowed_next_action: "prepare a delete/redirect readiness packet with soak and rollback evidence; do not mutate public assets",
      acceptance: [
        "direct legacy samples and Radar bridge samples keep live-equivalence proof",
        "soak and rollback plan are recorded before any mutation request",
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"} until rank 1 is released`,
      ],
    },
  ];
}

function validateDecisionRecord(record, packet) {
  const errors = [];
  if (!record) return errors;
  const allowedDecisions = new Set(["preserve", "remap", "retire"]);
  if (record.schema_version !== "macro-owner-decision-record/v0.1") {
    errors.push(`decision record schema_version mismatch: ${record.schema_version}`);
  }
  if (record.family_id !== packet.family_id) {
    errors.push(`decision record family_id mismatch: ${record.family_id}`);
  }
  if (!allowedDecisions.has(record.decision)) {
    errors.push(`decision record decision must be preserve, remap, or retire: ${record.decision}`);
  }
  if (typeof record.owner_approved_by !== "string" || record.owner_approved_by.trim().length === 0) {
    errors.push("decision record owner_approved_by is required");
  }
  if (typeof record.decided_at !== "string" || Number.isNaN(Date.parse(record.decided_at))) {
    errors.push(`decision record decided_at must be an ISO-8601 timestamp: ${record.decided_at}`);
  }
  if (record.local_live_equivalence_proof_status !== packet.evidence.local_live_equivalence_proof_status) {
    errors.push(`decision record proof status mismatch: ${record.local_live_equivalence_proof_status}`);
  }
  if (record.local_live_equivalence_rows_checked !== packet.evidence.local_live_equivalence_rows_checked) {
    errors.push(`decision record row count mismatch: ${record.local_live_equivalence_rows_checked}`);
  }
  if (record.mutation_approved !== false) {
    errors.push("decision record must not approve redirect/delete/deploy mutation");
  }
  return errors;
}

function buildDecisionPacket(inventory, liveProof, decisionRecord) {
  const review = inventory.macro_monitor_rank1_owner_review;
  const nextCandidate = review.next_queue_candidate_after_owner_decision;
  const smokeRows = liveProof.rows.map((row) => ({
    role: row.role,
    equivalence_group: row.equivalence_group,
    path: row.path,
    paired_path: row.paired_path,
    status: row.status,
    ok: row.ok,
  }));

  return {
    schema_version: "macro-owner-decision-packet/v0.1",
    issue: "#296 legacy 100x -> Next canonical-root cleanup",
    mutation: "none",
    network: "local_runtime_only",
    owner_decision_status: review.owner_decision_status,
    decision_record_status: decisionRecord ? "provided_pending_validation" : "not_supplied",
    family_id: review.family_id,
    owner_route: review.owner_route,
    compatibility_route: review.compatibility_route,
    blocked_actions_until_owner_decision: review.blocked_actions,
    decision_required: true,
    decision_options: [
      {
        decision: "preserve",
        meaning: "keep legacy macro-monitor bridge behind current owner/compatibility routes; no redirect/delete/deploy",
        allowed_next_action: "document preservation decision and keep rank 2 queued",
        mutation_allowed: false,
      },
      {
        decision: "remap",
        meaning: "remap Home/dashboard links to native /macro-chart only after owner-approved route IA",
        allowed_next_action: "prepare href-remap patch and rollback plan after explicit owner approval",
        mutation_allowed: false,
      },
      {
        decision: "retire",
        meaning: "retire legacy paths only after owner-approved equivalence proof, soak, rollback, and explicit mutation approval",
        allowed_next_action: "prepare deletion/redirect proposal after explicit owner approval",
        mutation_allowed: false,
      },
    ],
    evidence: {
      canonical_root_inventory_ok: inventory.ok,
      pro_screen_model_acceptance_ready: Boolean(review.pro_screen_model_acceptance?.acceptance_ready),
      local_live_equivalence_proof_status: liveProof.proof_status,
      local_live_equivalence_rows_checked: liveProof.rows_checked,
      local_live_equivalence_rows_expected: liveProof.expected_rows,
      smoke_rows: smokeRows,
      home_dashboard_legacy_bridge_entrypoints: review.public_home_legacy_bridge_entrypoint_count,
      src_legacy_references: review.src_legacy_reference_count,
    },
    release_blockers: [
      "owner decision must be recorded as preserve, remap, or retire",
      "redirect/delete/deploy approval must be recorded explicitly before mutation",
      "soak and rollback plan must be recorded before redirect/delete/deploy",
      "rank 2 cannot become active until rank 1 owner decision is recorded",
    ],
    decision_record_template: decisionRecordTemplate(review, liveProof),
    supplied_decision_record: decisionRecord,
    next_gated_slice: nextGatedSlice(review, nextCandidate),
    safe_enforcement_slices: safeEnforcementSlices(review, nextCandidate),
    next_queue_candidate_after_owner_decision: nextCandidate,
  };
}

function validatePacket(packet) {
  const errors = [];
  if (packet.owner_decision_status !== "pending_owner_decision") {
    errors.push(`owner decision must still be pending: ${packet.owner_decision_status}`);
  }
  if (!packet.evidence.canonical_root_inventory_ok) {
    errors.push("canonical-root inventory must be OK");
  }
  if (!packet.evidence.pro_screen_model_acceptance_ready) {
    errors.push("PRO screen-model acceptance must be ready");
  }
  if (packet.evidence.local_live_equivalence_proof_status !== "local_runtime_smoke_passed") {
    errors.push(`local live-equivalence proof must pass: ${packet.evidence.local_live_equivalence_proof_status}`);
  }
  if (packet.evidence.local_live_equivalence_rows_checked !== packet.evidence.local_live_equivalence_rows_expected) {
    errors.push(`live-equivalence row count mismatch: checked=${packet.evidence.local_live_equivalence_rows_checked} expected=${packet.evidence.local_live_equivalence_rows_expected}`);
  }
  if (!packet.next_queue_candidate_after_owner_decision) {
    errors.push("next queue candidate must stay visible after owner decision");
  }
  for (const option of packet.decision_options) {
    if (option.mutation_allowed !== false) {
      errors.push(`decision option must not authorize mutation: ${option.decision}`);
    }
  }
  if (packet.next_gated_slice?.mutation !== "none" || packet.next_gated_slice?.mutation_allowed !== false) {
    errors.push("next gated slice must be no-mutation");
  }
  if (!packet.next_gated_slice?.required_before_queue_release) {
    errors.push("next gated slice must be required before queue release");
  }
  if (!Array.isArray(packet.safe_enforcement_slices) || packet.safe_enforcement_slices.length === 0) {
    errors.push("safe enforcement slices must be present");
  } else {
    for (const slice of packet.safe_enforcement_slices) {
      if (slice.mutation !== "none" || slice.mutation_allowed !== false) {
        errors.push(`safe enforcement slice must not authorize mutation: ${slice.id}`);
      }
      if (slice.owner_record_required !== true) {
        errors.push(`safe enforcement slice must require owner record: ${slice.id}`);
      }
    }
  }
  const decisionRecordErrors = validateDecisionRecord(packet.supplied_decision_record, packet);
  errors.push(...decisionRecordErrors);
  if (packet.supplied_decision_record && decisionRecordErrors.length === 0) {
    packet.decision_record_status = "valid_no_mutation";
  }
  return errors;
}

function printText(packet) {
  console.log("[macro-owner-decision-packet] OK");
  console.log(`family=${packet.family_id}`);
  console.log(`owner_decision_status=${packet.owner_decision_status}`);
  console.log(`decision_record_status=${packet.decision_record_status}`);
  console.log(`local_live_equivalence=${packet.evidence.local_live_equivalence_proof_status} rows=${packet.evidence.local_live_equivalence_rows_checked}/${packet.evidence.local_live_equivalence_rows_expected}`);
  console.log(`next_gated_slice=${packet.next_gated_slice.id}`);
  console.log(`safe_enforcement_slices=${packet.safe_enforcement_slices.map((slice) => slice.id).join(",")}`);
  console.log(`next_queue_candidate=${packet.next_queue_candidate_after_owner_decision.family_id}`);
  console.log("decision_options=preserve,remap,retire");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inventory = runJson(inventoryScript);
  const liveProof = runJson(liveEquivalenceScript);
  const decisionRecord = readDecisionRecord(args.decisionRecordPath, args.decisionRecordJson);
  const packet = buildDecisionPacket(inventory, liveProof, decisionRecord);
  const errors = validatePacket(packet);

  if (errors.length > 0) {
    fail(`failed (${errors.length} violation(s)): ${errors.join("; ")}`, packet, args.json);
  }

  if (args.json) {
    console.log(JSON.stringify(packet, null, 2));
  } else {
    printText(packet);
  }
}

main();
