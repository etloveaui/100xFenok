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
const ISO_8601_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function requireArgValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requireInlineValue(arg, prefix, flag) {
  const value = arg.slice(prefix.length);
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    decisionRecordTemplate: false,
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
    if (arg === "--decision-record-template") {
      args.decisionRecordTemplate = true;
      continue;
    }
    if (arg === "--decision-record") {
      args.decisionRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--decision-record=")) {
      args.decisionRecordPath = requireInlineValue(arg, "--decision-record=", "--decision-record");
      continue;
    }
    if (arg === "--decision-record-json") {
      args.decisionRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--decision-record-json=")) {
      args.decisionRecordJson = requireInlineValue(arg, "--decision-record-json=", "--decision-record-json");
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (args.decisionRecordJson && args.decisionRecordPath) {
    throw new Error("use only one decision record source: --decision-record-json or --decision-record");
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

function isIso8601Timestamp(value) {
  return typeof value === "string"
    && ISO_8601_TIMESTAMP_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value));
}

function fail(message, packet, json) {
  if (json && packet) console.log(JSON.stringify(packet, null, 2));
  console.error(`[macro-owner-decision-packet] ${message}`);
  process.exit(1);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function decisionRecordTemplate(review, liveProof) {
  return {
    schema_version: "macro-owner-decision-record/v0.1",
    family_id: review.family_id,
    decision: "preserve|remap|retire",
    owner_approved_by: "<owner>",
    decided_at: "<ISO-8601 timestamp>",
    local_live_equivalence_base_url: liveProof.base_url,
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
    required_decided_at_format: "full ISO-8601 timestamp with timezone",
    required_local_live_equivalence_base_url: "must match current packet proof",
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
        "decided_at is a full ISO-8601 timestamp with timezone",
        "local proof base URL, status, and row count match the current packet",
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

function decisionFollowupPlans(review, nextCandidate) {
  const common = {
    family_id: review.family_id,
    mutation: "none",
    mutation_allowed: false,
    owner_record_required: true,
    separate_mutation_approval_required: true,
    blocked_actions: review.blocked_actions,
    rank_2_review_candidate_after_followup: nextCandidate?.family_id ?? null,
  };

  return [
    {
      ...common,
      id: "preserve_decision_documentation_packet",
      gate: "after_valid_preserve_record_before_rank_2_review",
      decision: "preserve",
      allowed_next_action: "document the owner-approved preserve decision and keep legacy macro-monitor bridges behind owner/compatibility routes",
      required_evidence: [
        "owner decision record remains valid_no_mutation",
        "Home and mobile primary IA remain search-first / non-legacy",
        "rank 2 is exposed as a candidate only after the preserve documentation packet is recorded",
      ],
    },
    {
      ...common,
      id: "remap_dry_run_proposal_packet",
      gate: "after_valid_remap_record_before_any_href_edit",
      decision: "remap",
      allowed_next_action: "prepare a dry-run href-remap proposal against native /macro-chart, with rollback and QA commands, without editing routes or public assets",
      required_evidence: [
        `proposed destination stays ${review.owner_route}`,
        "Home/dashboard legacy entrypoints are listed before any href patch",
        "redirect/delete/deploy remain blocked until a separate mutation approval is recorded",
      ],
    },
    {
      ...common,
      id: "retire_readiness_packet",
      gate: "after_valid_retire_record_before_any_delete_or_redirect",
      decision: "retire",
      allowed_next_action: "prepare delete/redirect readiness, soak, rollback, and post-change smoke evidence without mutating public assets",
      required_evidence: [
        "local live-equivalence proof stays green for owner, compatibility, direct legacy, and Radar bridge paths",
        "soak and rollback plan are written before any delete/redirect request",
        "deploy/live smoke remains explicit owner-approved work, not implied by the retire decision record",
      ],
    },
  ];
}

function selectedDecisionFollowup(packet) {
  const record = packet.supplied_decision_record;
  if (!record || packet.decision_record_status !== "valid_no_mutation") return null;
  const plan = packet.decision_followup_plans.find((candidate) => candidate.decision === record.decision);
  if (!plan) return null;
  return {
    ...plan,
    selected_by_decision_record: true,
    owner_approved_by: record.owner_approved_by,
    decided_at: record.decided_at,
    mutation_status: "not_executed",
    rank_2_release_status: "candidate_visible_only_after_no_mutation_followup",
  };
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
  if (!isIso8601Timestamp(record.decided_at)) {
    errors.push(`decision record decided_at must be a full ISO-8601 timestamp with timezone: ${record.decided_at}`);
  }
  if (record.local_live_equivalence_base_url !== packet.evidence.local_live_equivalence_base_url) {
    errors.push(`decision record base URL mismatch: ${record.local_live_equivalence_base_url}`);
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
      local_live_equivalence_base_url: liveProof.base_url,
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
    decision_followup_plans: decisionFollowupPlans(review, nextCandidate),
    selected_decision_followup: null,
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
  if (packet.decision_record_template?.schema_version !== "macro-owner-decision-record/v0.1") {
    errors.push(`decision record template schema mismatch: ${packet.decision_record_template?.schema_version}`);
  }
  if (packet.decision_record_template?.family_id !== packet.family_id) {
    errors.push(`decision record template family mismatch: ${packet.decision_record_template?.family_id}`);
  }
  if (packet.decision_record_template?.local_live_equivalence_base_url !== packet.evidence.local_live_equivalence_base_url) {
    errors.push("decision record template base URL must match packet proof");
  }
  if (packet.decision_record_template?.local_live_equivalence_proof_status !== packet.evidence.local_live_equivalence_proof_status) {
    errors.push("decision record template proof status must match packet proof");
  }
  if (packet.decision_record_template?.local_live_equivalence_rows_checked !== packet.evidence.local_live_equivalence_rows_checked) {
    errors.push("decision record template row count must match packet proof");
  }
  if (packet.decision_record_template?.mutation_approved !== false) {
    errors.push("decision record template must keep mutation_approved=false");
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
  if (!Array.isArray(packet.decision_followup_plans) || packet.decision_followup_plans.length !== 3) {
    errors.push("decision followup plans must cover preserve, remap, and retire");
  } else {
    const expectedDecisions = new Set(["preserve", "remap", "retire"]);
    for (const plan of packet.decision_followup_plans) {
      expectedDecisions.delete(plan.decision);
      if (plan.mutation !== "none" || plan.mutation_allowed !== false) {
        errors.push(`decision followup plan must not authorize mutation: ${plan.id}`);
      }
      if (plan.owner_record_required !== true || plan.separate_mutation_approval_required !== true) {
        errors.push(`decision followup plan must require owner record plus separate mutation approval: ${plan.id}`);
      }
    }
    if (expectedDecisions.size > 0) {
      errors.push(`decision followup plans missing decisions: ${Array.from(expectedDecisions).join(",")}`);
    }
  }
  const decisionRecordErrors = validateDecisionRecord(packet.supplied_decision_record, packet);
  errors.push(...decisionRecordErrors);
  if (packet.supplied_decision_record && decisionRecordErrors.length === 0) {
    packet.decision_record_status = "valid_no_mutation";
    packet.selected_decision_followup = selectedDecisionFollowup(packet);
    if (!packet.selected_decision_followup) {
      errors.push(`valid decision record did not select a followup plan: ${packet.supplied_decision_record.decision}`);
    } else if (
      packet.selected_decision_followup.mutation !== "none" ||
      packet.selected_decision_followup.mutation_allowed !== false ||
      packet.selected_decision_followup.separate_mutation_approval_required !== true
    ) {
      errors.push(`selected decision followup must remain no-mutation: ${packet.selected_decision_followup.id}`);
    }
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
  console.log(`decision_followup_plans=${packet.decision_followup_plans.map((plan) => plan.id).join(",")}`);
  if (packet.selected_decision_followup) {
    console.log(`selected_decision_followup=${packet.selected_decision_followup.id}`);
  }
  console.log("decision_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --decision-record-template");
  console.log(`next_queue_candidate=${packet.next_queue_candidate_after_owner_decision.family_id}`);
  console.log("decision_options=preserve,remap,retire");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(errorMessage(error), null, false);
  }

  const inventory = runJson(inventoryScript);
  const liveProof = runJson(liveEquivalenceScript);
  let decisionRecord;
  try {
    decisionRecord = readDecisionRecord(args.decisionRecordPath, args.decisionRecordJson);
  } catch (error) {
    fail(`decision record read/parse failed: ${errorMessage(error)}`, null, false);
  }

  const packet = buildDecisionPacket(inventory, liveProof, decisionRecord);
  const errors = validatePacket(packet);

  if (errors.length > 0) {
    fail(`failed (${errors.length} violation(s)): ${errors.join("; ")}`, packet, args.json);
  }

  if (args.decisionRecordTemplate) {
    console.log(JSON.stringify(packet.decision_record_template, null, 2));
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(packet, null, 2));
  } else {
    printText(packet);
  }
}

main();
