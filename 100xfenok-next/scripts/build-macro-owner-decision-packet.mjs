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
    rank2PreActivationTemplate: false,
    rank2OwnerReviewTemplate: false,
    decisionRecordJson: null,
    decisionRecordPath: null,
    decisionFollowupRecordTemplate: false,
    decisionFollowupRecordJson: null,
    decisionFollowupRecordPath: null,
    rank2PreActivationRecordJson: null,
    rank2PreActivationRecordPath: null,
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
    if (arg === "--rank2-pre-activation-template") {
      args.rank2PreActivationTemplate = true;
      continue;
    }
    if (arg === "--rank2-owner-review-template") {
      args.rank2OwnerReviewTemplate = true;
      continue;
    }
    if (arg === "--decision-followup-record-template") {
      args.decisionFollowupRecordTemplate = true;
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
    if (arg === "--decision-followup-record") {
      args.decisionFollowupRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--decision-followup-record=")) {
      args.decisionFollowupRecordPath = requireInlineValue(arg, "--decision-followup-record=", "--decision-followup-record");
      continue;
    }
    if (arg === "--decision-followup-record-json") {
      args.decisionFollowupRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--decision-followup-record-json=")) {
      args.decisionFollowupRecordJson = requireInlineValue(arg, "--decision-followup-record-json=", "--decision-followup-record-json");
      continue;
    }
    if (arg === "--rank2-pre-activation-record") {
      args.rank2PreActivationRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-pre-activation-record=")) {
      args.rank2PreActivationRecordPath = requireInlineValue(arg, "--rank2-pre-activation-record=", "--rank2-pre-activation-record");
      continue;
    }
    if (arg === "--rank2-pre-activation-record-json") {
      args.rank2PreActivationRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-pre-activation-record-json=")) {
      args.rank2PreActivationRecordJson = requireInlineValue(arg, "--rank2-pre-activation-record-json=", "--rank2-pre-activation-record-json");
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (args.decisionRecordJson && args.decisionRecordPath) {
    throw new Error("use only one decision record source: --decision-record-json or --decision-record");
  }
  if (args.decisionFollowupRecordJson && args.decisionFollowupRecordPath) {
    throw new Error("use only one decision followup record source: --decision-followup-record-json or --decision-followup-record");
  }
  if (args.rank2PreActivationRecordJson && args.rank2PreActivationRecordPath) {
    throw new Error("use only one rank2 pre-activation record source: --rank2-pre-activation-record-json or --rank2-pre-activation-record");
  }
  if (args.rank2PreActivationTemplate && (args.rank2PreActivationRecordJson || args.rank2PreActivationRecordPath)) {
    throw new Error("--rank2-pre-activation-template cannot be combined with a rank2 pre-activation record");
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
    {
      id: "rank2_pre_activation_local_smoke_prep",
      gate: "after_rank1_no_mutation_followup_before_rank2_owner_review",
      decision: "pending_rank2",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "run and record the inactive rank-2 local smoke commands before making rank 2 the active owner-review slice",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "inactive preview stays active=false and mutation_allowed=false",
        "owner route, compatibility route, and legacy sample rows all carry local smoke commands",
        "proof status stays prep_only_not_executed until rank 2 is explicitly activated for local review",
        "redirect/delete/deploy remain blocked until separate explicit owner approval",
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

function decisionFollowupRecordTemplate(plan) {
  return {
    schema_version: "macro-owner-decision-followup-record/v0.1",
    family_id: plan.family_id,
    decision: plan.decision,
    followup_id: plan.id,
    recorded_at: "<ISO-8601 timestamp>",
    owner_decision_record_status: "valid_no_mutation",
    evidence_status: "recorded_no_mutation",
    required_evidence: plan.required_evidence,
    mutation_approved: false,
    separate_mutation_approval_required: true,
    rank_2_release_requested: false,
    rank_2_review_candidate_after_followup: plan.rank_2_review_candidate_after_followup,
    notes: "Follow-up record only; rank-2 activation and redirect/delete/deploy require separate explicit gates.",
  };
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

function commandForPath(packet, smokePath) {
  const commands = packet?.pre_approval_local_commands ?? [];
  return commands.find((command) => {
    const match = command.match(/https?:\/\/127\.0\.0\.1:3105[^'"\s]*/);
    if (!match) return false;
    const url = new URL(match[0]);
    return `${url.pathname}${url.search}` === smokePath;
  }) ?? null;
}

function inactiveNextCandidateLiveEquivalencePrep(nextCandidate, packet) {
  const ownerRoute = nextCandidate.owner_route;
  const compatibilityRoute = nextCandidate.compatibility_route;
  const legacySamplePaths = packet?.legacy_sample_paths ?? [];
  const localBaseUrl = "http://127.0.0.1:3105";
  const rows = [];

  const makeRow = ({ role, path: rowPath, pairedPath }) => ({
    role,
    path: rowPath,
    paired_path: pairedPath,
    expected_http_status: 200,
    command: commandForPath(packet, rowPath),
    proof_status: "prep_only_not_executed",
    mutation_status: "not_executed",
  });

  if (ownerRoute) {
    rows.push(makeRow({
      role: "owner_route",
      path: ownerRoute,
      pairedPath: legacySamplePaths[0] ?? compatibilityRoute ?? null,
    }));
  }
  if (compatibilityRoute) {
    rows.push(makeRow({
      role: "compatibility_route",
      path: compatibilityRoute,
      pairedPath: ownerRoute,
    }));
  }
  for (const legacyPath of legacySamplePaths) {
    rows.push(makeRow({
      role: "legacy_sample",
      path: legacyPath,
      pairedPath: ownerRoute,
    }));
  }

  return {
    schema_version: "inactive-owner-review-live-equivalence-prep/v0.1",
    proof_status: "prep_only_not_executed",
    preview_only: true,
    expected_rows: rows.length,
    rows,
    required_before_active_review: [
      "rank 1 owner decision record validates as valid_no_mutation",
      "rank 1 selected no-mutation follow-up is recorded",
      "all inactive preview smoke rows pass locally before rank 2 owner review",
      "rank 2 owner decision is still required before redirect/delete/deploy",
    ],
    record_template: {
      schema_version: "inactive-owner-review-live-equivalence-record/v0.1",
      candidate_family_id: nextCandidate.family_id,
      recording_gate: "after_rank1_no_mutation_followup_before_rank2_owner_review",
      local_live_equivalence_base_url: localBaseUrl,
      proof_status: "not_recorded",
      mutation_approved: false,
      rows: rows.map((row) => ({
        role: row.role,
        path: row.path,
        paired_path: row.paired_path,
        expected_http_status: row.expected_http_status,
        command: row.command,
        actual_http_status: null,
        ok: null,
      })),
    },
  };
}

function inactiveNextCandidatePreview(inventory, review) {
  const nextCandidate = review.next_queue_candidate_after_owner_decision;
  if (!nextCandidate) return null;

  const queueItem = inventory.high_risk_owner_matrix?.owner_review_queue
    ?.find((item) => item.family_id === nextCandidate.family_id) ?? null;
  const packet = queueItem?.packet ?? null;

  return {
    schema_version: "inactive-owner-review-preview/v0.1",
    active: false,
    activation_status: "blocked_until_rank1_owner_record_and_no_mutation_followup",
    mutation: "none",
    mutation_allowed: false,
    owner_record_required: true,
    separate_mutation_approval_required: true,
    blocked_by: [
      `${review.family_id} owner decision record is still required`,
      `${review.family_id} no-mutation follow-up packet is still required`,
      "redirect/delete/deploy require separate explicit owner approval",
    ],
    rank1_family_id: review.family_id,
    candidate: {
      rank: nextCandidate.rank,
      family_id: nextCandidate.family_id,
      owner_route: nextCandidate.owner_route,
      compatibility_route: nextCandidate.compatibility_route,
      legacy_row_count: nextCandidate.legacy_row_count,
      packet_ready: nextCandidate.packet_ready,
      blocked_actions: nextCandidate.blocked_actions,
      priority_reason: queueItem?.priority_reason ?? null,
      recommended_slice: queueItem?.recommended_slice ?? null,
      pro_screen_model_acceptance_ready: Boolean(queueItem?.pro_screen_model_acceptance?.acceptance_ready),
      home_primary_allowed: queueItem?.pro_screen_model_acceptance?.home_primary_allowed ?? null,
      mobile_primary_allowed: queueItem?.pro_screen_model_acceptance?.mobile_primary_allowed ?? null,
      local_smoke_paths: packet?.local_smoke_paths ?? [],
      pre_approval_local_commands: packet?.pre_approval_local_commands ?? [],
    },
    live_equivalence_prep: inactiveNextCandidateLiveEquivalencePrep(nextCandidate, packet),
    release_requirements: [
      "rank 1 owner decision record validates as valid_no_mutation",
      "rank 1 selected decision follow-up is recorded without mutation",
      "rank 2 local commands pass before owner review",
      "rank 2 owner decision is still required before any redirect/delete/deploy proposal",
    ],
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

function validateRank2PreActivationRecord(record, template) {
  const errors = [];
  if (!record) return errors;
  if (!template) return ["rank2 pre-activation record template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 pre-activation record schema_version mismatch: ${record.schema_version}`);
  }
  if (record.candidate_family_id !== template.candidate_family_id) {
    errors.push(`rank2 pre-activation record candidate mismatch: ${record.candidate_family_id}`);
  }
  if (record.recording_gate !== template.recording_gate) {
    errors.push(`rank2 pre-activation record gate mismatch: ${record.recording_gate}`);
  }
  if (record.local_live_equivalence_base_url !== template.local_live_equivalence_base_url) {
    errors.push(`rank2 pre-activation record base URL mismatch: ${record.local_live_equivalence_base_url}`);
  }
  if (record.proof_status !== "local_runtime_smoke_passed") {
    errors.push(`rank2 pre-activation record proof_status must be local_runtime_smoke_passed: ${record.proof_status}`);
  }
  if (record.mutation_approved !== false) {
    errors.push("rank2 pre-activation record must not approve mutation");
  }
  if (!Array.isArray(record.rows) || record.rows.length !== template.rows.length) {
    errors.push(`rank2 pre-activation record row count mismatch: ${record.rows?.length}`);
    return errors;
  }
  for (let index = 0; index < template.rows.length; index += 1) {
    const expected = template.rows[index];
    const actual = record.rows[index];
    const label = `${expected.role} ${expected.path}`;
    if (actual.role !== expected.role || actual.path !== expected.path || actual.paired_path !== expected.paired_path) {
      errors.push(`rank2 pre-activation record row identity mismatch: ${label}`);
    }
    if (actual.expected_http_status !== expected.expected_http_status) {
      errors.push(`rank2 pre-activation record expected status mismatch: ${label}`);
    }
    if (actual.command !== expected.command) {
      errors.push(`rank2 pre-activation record command mismatch: ${label}`);
    }
    if (actual.actual_http_status !== expected.expected_http_status || actual.ok !== true) {
      errors.push(`rank2 pre-activation record row must pass local smoke: ${label}`);
    }
  }
  return errors;
}

function validateDecisionFollowupRecord(record, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.decision_record_status !== "valid_no_mutation" || !packet.selected_decision_followup) {
    return ["decision followup record requires a valid owner decision record first"];
  }
  const template = packet.decision_followup_record_templates.find((item) => item.followup_id === packet.selected_decision_followup.id);
  if (!template) return [`decision followup record template missing for ${packet.selected_decision_followup.id}`];
  if (record.schema_version !== template.schema_version) {
    errors.push(`decision followup record schema_version mismatch: ${record.schema_version}`);
  }
  if (record.family_id !== template.family_id || record.decision !== template.decision || record.followup_id !== template.followup_id) {
    errors.push("decision followup record identity mismatch");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`decision followup record recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.owner_decision_record_status !== "valid_no_mutation") {
    errors.push(`decision followup record owner_decision_record_status mismatch: ${record.owner_decision_record_status}`);
  }
  if (record.evidence_status !== "recorded_no_mutation") {
    errors.push(`decision followup record evidence_status mismatch: ${record.evidence_status}`);
  }
  if (JSON.stringify(record.required_evidence) !== JSON.stringify(template.required_evidence)) {
    errors.push("decision followup record required_evidence mismatch");
  }
  if (record.mutation_approved !== false || record.separate_mutation_approval_required !== true) {
    errors.push("decision followup record must stay no-mutation with separate mutation approval required");
  }
  if (record.rank_2_release_requested !== false) {
    errors.push("decision followup record must not request rank-2 release");
  }
  if (record.rank_2_review_candidate_after_followup !== template.rank_2_review_candidate_after_followup) {
    errors.push(`decision followup record rank-2 candidate mismatch: ${record.rank_2_review_candidate_after_followup}`);
  }
  return errors;
}

function rank2ReviewReadiness(packet) {
  const requiredRecords = [
    {
      id: "rank1_owner_decision_record",
      status: packet.decision_record_status,
      required_status: "valid_no_mutation",
    },
    {
      id: "rank1_no_mutation_followup_record",
      status: packet.decision_followup_record_status,
      required_status: "valid_no_mutation_followup_recorded",
    },
    {
      id: "rank2_pre_activation_local_smoke_record",
      status: packet.rank2_pre_activation_record_status,
      required_status: "valid_no_mutation_pre_activation",
    },
  ];
  const missingRecords = requiredRecords.filter((record) => record.status !== record.required_status);
  const ready = missingRecords.length === 0;
  return {
    schema_version: "rank2-owner-review-readiness/v0.1",
    candidate_family_id: packet.next_queue_candidate_after_owner_decision?.family_id ?? null,
    status: ready ? "ready_for_rank2_owner_review_no_mutation" : "blocked_pending_records",
    ready_for_rank2_owner_review: ready,
    rank2_active: false,
    mutation: "none",
    mutation_allowed: false,
    separate_mutation_approval_required: true,
    blocked_actions: ["delete", "redirect", "deploy"],
    required_records: requiredRecords,
    missing_records: missingRecords.map((record) => record.id),
    next_allowed_action: ready
      ? "start rank-2 owner review only; keep redirect/delete/deploy blocked"
      : "supply the missing valid records before rank-2 owner review",
  };
}

function rank2OwnerReviewTemplate(packet) {
  const preview = packet.inactive_next_candidate_preview;
  const readiness = packet.rank2_review_readiness;
  const candidate = preview?.candidate ?? {};
  return {
    schema_version: "rank2-owner-review-packet/v0.1",
    issue: packet.issue,
    candidate_family_id: candidate.family_id ?? null,
    status: readiness?.ready_for_rank2_owner_review ? "available_no_mutation" : "blocked_until_rank2_review_readiness",
    readiness_status: readiness?.status ?? null,
    rank2_active: false,
    mutation: "none",
    mutation_allowed: false,
    separate_mutation_approval_required: true,
    blocked_actions: ["delete", "redirect", "deploy"],
    owner_route: candidate.owner_route ?? null,
    compatibility_route: candidate.compatibility_route ?? null,
    legacy_sample_paths: preview?.live_equivalence_prep?.rows
      ?.filter((row) => row.role === "legacy_sample")
      .map((row) => row.path) ?? [],
    pro_screen_model_acceptance: {
      ready: candidate.pro_screen_model_acceptance_ready ?? false,
      home_primary_allowed: candidate.home_primary_allowed ?? null,
      mobile_primary_allowed: candidate.mobile_primary_allowed ?? null,
    },
    evidence_status: {
      rank1_owner_decision_record: packet.decision_record_status,
      rank1_no_mutation_followup_record: packet.decision_followup_record_status,
      rank2_pre_activation_local_smoke_record: packet.rank2_pre_activation_record_status,
    },
    decision_record_template: {
      schema_version: "rank2-owner-decision-record/v0.1",
      candidate_family_id: candidate.family_id ?? null,
      decision: "preserve|remap|retire",
      owner_approved_by: "<owner>",
      decided_at: "<ISO-8601 timestamp>",
      mutation_approved: false,
      notes: "Rank-2 owner-review decision only; redirect/delete/deploy require separate explicit approval.",
    },
    decision_options: [
      {
        decision: "preserve",
        meaning: "keep legacy market archive behind current owner/compatibility routes; no redirect/delete/deploy",
        mutation_allowed: false,
      },
      {
        decision: "remap",
        meaning: "prepare a dry-run proposal that keeps /market tied to the native /market-valuation owner route",
        mutation_allowed: false,
      },
      {
        decision: "retire",
        meaning: "prepare retire readiness only after owner-approved equivalence proof, soak, rollback, and separate mutation approval",
        mutation_allowed: false,
      },
    ],
    next_allowed_action: readiness?.ready_for_rank2_owner_review
      ? "ask owner to choose preserve, remap, or retire for rank-2 review only"
      : "supply all readiness records before printing the rank-2 owner-review template",
  };
}

function buildDecisionPacket(inventory, liveProof, decisionRecord, decisionFollowupRecord, rank2PreActivationRecord) {
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

  const followupPlans = decisionFollowupPlans(review, nextCandidate);
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
    supplied_decision_followup_record: decisionFollowupRecord,
    decision_followup_record_status: decisionFollowupRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_pre_activation_record: rank2PreActivationRecord,
    rank2_pre_activation_record_status: rank2PreActivationRecord ? "provided_pending_validation" : "not_supplied",
    next_gated_slice: nextGatedSlice(review, nextCandidate),
    safe_enforcement_slices: safeEnforcementSlices(review, nextCandidate),
    decision_followup_plans: followupPlans,
    decision_followup_record_templates: followupPlans.map(decisionFollowupRecordTemplate),
    selected_decision_followup: null,
    inactive_next_candidate_preview: inactiveNextCandidatePreview(inventory, review),
    rank2_review_readiness: null,
    rank2_owner_review_template: null,
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
    const rank2PrepSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_pre_activation_local_smoke_prep");
    for (const slice of packet.safe_enforcement_slices) {
      if (slice.mutation !== "none" || slice.mutation_allowed !== false) {
        errors.push(`safe enforcement slice must not authorize mutation: ${slice.id}`);
      }
      if (slice.owner_record_required !== true) {
        errors.push(`safe enforcement slice must require owner record: ${slice.id}`);
      }
    }
    if (!rank2PrepSlice) {
      errors.push("safe enforcement slices must include rank2_pre_activation_local_smoke_prep");
    } else {
      if (rank2PrepSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 prep slice candidate mismatch: ${rank2PrepSlice.candidate_family_id}`);
      }
      if (rank2PrepSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 prep slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PrepSlice.acceptance) || !rank2PrepSlice.acceptance.some((item) => item.includes("local smoke commands"))) {
        errors.push("rank2 prep slice must require local smoke commands");
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
  if (!packet.inactive_next_candidate_preview) {
    errors.push("inactive next candidate preview must stay visible");
  } else {
    const preview = packet.inactive_next_candidate_preview;
    if (preview.active !== false || preview.mutation !== "none" || preview.mutation_allowed !== false) {
      errors.push("inactive next candidate preview must remain inactive and no-mutation");
    }
    if (preview.owner_record_required !== true || preview.separate_mutation_approval_required !== true) {
      errors.push("inactive next candidate preview must require owner record and separate mutation approval");
    }
    if (preview.candidate?.family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
      errors.push(`inactive next candidate preview family mismatch: ${preview.candidate?.family_id}`);
    }
    if (preview.candidate?.pro_screen_model_acceptance_ready !== true) {
      errors.push("inactive next candidate preview must carry ready PRO screen-model acceptance");
    }
    if (preview.candidate?.home_primary_allowed !== false || preview.candidate?.mobile_primary_allowed !== false) {
      errors.push("inactive next candidate preview must keep legacy content out of Home/mobile primary IA");
    }
    if (!Array.isArray(preview.candidate?.local_smoke_paths) || preview.candidate.local_smoke_paths.length === 0) {
      errors.push("inactive next candidate preview must expose local smoke paths");
    }
    const prep = preview.live_equivalence_prep;
    if (prep?.proof_status !== "prep_only_not_executed" || prep.preview_only !== true) {
      errors.push("inactive next candidate live-equivalence prep must stay prep-only");
    }
    if (!Array.isArray(prep?.rows) || prep.rows.length !== preview.candidate.local_smoke_paths.length) {
      errors.push("inactive next candidate live-equivalence prep row count must match local smoke paths");
    } else {
      const roles = new Set(prep.rows.map((row) => row.role));
      if (!roles.has("owner_route") || !roles.has("legacy_sample")) {
        errors.push("inactive next candidate live-equivalence prep must include owner_route and legacy_sample rows");
      }
      if (preview.candidate.compatibility_route && !roles.has("compatibility_route")) {
        errors.push("inactive next candidate live-equivalence prep must include compatibility_route row");
      }
      for (const row of prep.rows) {
        if (!row.command) {
          errors.push(`inactive next candidate live-equivalence prep row missing command: ${row.path}`);
        }
        if (row.expected_http_status !== 200) {
          errors.push(`inactive next candidate live-equivalence prep row expected status mismatch: ${row.path}`);
        }
        if (row.proof_status !== "prep_only_not_executed" || row.mutation_status !== "not_executed") {
          errors.push(`inactive next candidate live-equivalence prep row must stay prep-only/no-mutation: ${row.path}`);
        }
      }
    }
    const recordTemplate = prep?.record_template;
    if (recordTemplate?.schema_version !== "inactive-owner-review-live-equivalence-record/v0.1") {
      errors.push(`inactive next candidate record template schema mismatch: ${recordTemplate?.schema_version}`);
    } else {
      if (recordTemplate.candidate_family_id !== preview.candidate.family_id) {
        errors.push(`inactive next candidate record template family mismatch: ${recordTemplate.candidate_family_id}`);
      }
      if (recordTemplate.local_live_equivalence_base_url !== "http://127.0.0.1:3105") {
        errors.push(`inactive next candidate record template base URL mismatch: ${recordTemplate.local_live_equivalence_base_url}`);
      }
      if (recordTemplate.proof_status !== "not_recorded" || recordTemplate.mutation_approved !== false) {
        errors.push("inactive next candidate record template must stay unrecorded and no-mutation");
      }
      if (!Array.isArray(recordTemplate.rows) || recordTemplate.rows.length !== prep.rows.length) {
        errors.push("inactive next candidate record template rows must match prep rows");
      } else {
        for (const row of recordTemplate.rows) {
          if (row.actual_http_status !== null || row.ok !== null) {
            errors.push(`inactive next candidate record template must not prefill runtime proof: ${row.path}`);
          }
          if (!row.command || row.expected_http_status !== 200) {
            errors.push(`inactive next candidate record template row missing command/status: ${row.path}`);
          }
        }
      }
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
  const decisionFollowupRecordErrors = validateDecisionFollowupRecord(packet.supplied_decision_followup_record, packet);
  errors.push(...decisionFollowupRecordErrors);
  if (packet.supplied_decision_followup_record && decisionFollowupRecordErrors.length === 0) {
    packet.decision_followup_record_status = "valid_no_mutation_followup_recorded";
  }
  const rank2RecordErrors = validateRank2PreActivationRecord(
    packet.supplied_rank2_pre_activation_record,
    packet.inactive_next_candidate_preview?.live_equivalence_prep?.record_template,
  );
  errors.push(...rank2RecordErrors);
  if (packet.supplied_rank2_pre_activation_record && rank2RecordErrors.length === 0) {
    packet.rank2_pre_activation_record_status = "valid_no_mutation_pre_activation";
  }
  packet.rank2_review_readiness = rank2ReviewReadiness(packet);
  if (packet.rank2_review_readiness.rank2_active !== false || packet.rank2_review_readiness.mutation_allowed !== false) {
    errors.push("rank2 review readiness must not activate rank2 or allow mutation");
  }
  if (packet.rank2_review_readiness.ready_for_rank2_owner_review && packet.rank2_review_readiness.missing_records.length > 0) {
    errors.push("rank2 review readiness cannot be ready with missing records");
  }
  if (!packet.rank2_review_readiness.blocked_actions.includes("delete")
    || !packet.rank2_review_readiness.blocked_actions.includes("redirect")
    || !packet.rank2_review_readiness.blocked_actions.includes("deploy")) {
    errors.push("rank2 review readiness must keep delete/redirect/deploy blocked");
  }
  packet.rank2_owner_review_template = rank2OwnerReviewTemplate(packet);
  if (packet.rank2_owner_review_template.rank2_active !== false || packet.rank2_owner_review_template.mutation_allowed !== false) {
    errors.push("rank2 owner-review template must not activate rank2 or allow mutation");
  }
  if (!packet.rank2_owner_review_template.blocked_actions.includes("delete")
    || !packet.rank2_owner_review_template.blocked_actions.includes("redirect")
    || !packet.rank2_owner_review_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 owner-review template must keep delete/redirect/deploy blocked");
  }
  for (const option of packet.rank2_owner_review_template.decision_options) {
    if (option.mutation_allowed !== false) {
      errors.push(`rank2 owner-review option must not authorize mutation: ${option.decision}`);
    }
  }
  return errors;
}

function printText(packet) {
  console.log("[macro-owner-decision-packet] OK");
  console.log(`family=${packet.family_id}`);
  console.log(`owner_decision_status=${packet.owner_decision_status}`);
  console.log(`decision_record_status=${packet.decision_record_status}`);
  console.log(`decision_followup_record_status=${packet.decision_followup_record_status}`);
  console.log(`rank2_pre_activation_record_status=${packet.rank2_pre_activation_record_status}`);
  console.log(`rank2_review_readiness=${packet.rank2_review_readiness.status}`);
  console.log(`rank2_owner_review_template=${packet.rank2_owner_review_template.status}`);
  console.log(`local_live_equivalence=${packet.evidence.local_live_equivalence_proof_status} rows=${packet.evidence.local_live_equivalence_rows_checked}/${packet.evidence.local_live_equivalence_rows_expected}`);
  console.log(`next_gated_slice=${packet.next_gated_slice.id}`);
  console.log(`safe_enforcement_slices=${packet.safe_enforcement_slices.map((slice) => slice.id).join(",")}`);
  console.log(`decision_followup_plans=${packet.decision_followup_plans.map((plan) => plan.id).join(",")}`);
  if (packet.selected_decision_followup) {
    console.log(`selected_decision_followup=${packet.selected_decision_followup.id}`);
  }
  console.log(`inactive_next_candidate_preview=${packet.inactive_next_candidate_preview.candidate.family_id}`);
  console.log(`inactive_next_candidate_prep_rows=${packet.inactive_next_candidate_preview.live_equivalence_prep.rows.length}`);
  console.log(`rank2_pre_activation_record_template=${packet.inactive_next_candidate_preview.live_equivalence_prep.record_template.schema_version}`);
  console.log("decision_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --decision-record-template");
  console.log("rank2_pre_activation_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-pre-activation-template");
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
  let decisionFollowupRecord;
  let rank2PreActivationRecord;
  try {
    decisionRecord = readDecisionRecord(args.decisionRecordPath, args.decisionRecordJson);
  } catch (error) {
    fail(`decision record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    decisionFollowupRecord = readDecisionRecord(args.decisionFollowupRecordPath, args.decisionFollowupRecordJson);
  } catch (error) {
    fail(`decision followup record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PreActivationRecord = readDecisionRecord(args.rank2PreActivationRecordPath, args.rank2PreActivationRecordJson);
  } catch (error) {
    fail(`rank2 pre-activation record read/parse failed: ${errorMessage(error)}`, null, false);
  }

  const packet = buildDecisionPacket(inventory, liveProof, decisionRecord, decisionFollowupRecord, rank2PreActivationRecord);
  const errors = validatePacket(packet);

  if (errors.length > 0) {
    fail(`failed (${errors.length} violation(s)): ${errors.join("; ")}`, packet, args.json);
  }

  if (args.decisionRecordTemplate) {
    console.log(JSON.stringify(packet.decision_record_template, null, 2));
    return;
  }

  if (args.rank2PreActivationTemplate) {
    console.log(JSON.stringify(packet.inactive_next_candidate_preview.live_equivalence_prep.record_template, null, 2));
    return;
  }

  if (args.rank2OwnerReviewTemplate) {
    if (!packet.rank2_review_readiness.ready_for_rank2_owner_review) {
      fail("--rank2-owner-review-template requires rank2_review_readiness=ready_for_rank2_owner_review_no_mutation", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_owner_review_template, null, 2));
    return;
  }

  if (args.decisionFollowupRecordTemplate) {
    if (!packet.selected_decision_followup) {
      fail("--decision-followup-record-template requires a valid --decision-record/--decision-record-json", packet, args.json);
    }
    const template = packet.decision_followup_record_templates.find((item) => item.followup_id === packet.selected_decision_followup.id);
    console.log(JSON.stringify(template, null, 2));
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(packet, null, 2));
  } else {
    printText(packet);
  }
}

main();
