#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
const repoDir = path.resolve(scriptDir, "..");
const packetScript = path.join(scriptDir, "build-macro-owner-decision-packet.mjs");
const fixedTimestamp = "2026-07-02T04:58:00+09:00";
const deletedPath = "/100x/100x-main.html";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "macro-owner-fresh-closeout-"));

function fail(message) {
  console.error(`[macro-owner-fresh-closeout-chain] ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runPacket(recordArgs, options = {}) {
  const result = spawnSync(process.execPath, [packetScript, "--json", ...recordArgs], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (options.expectFailure) {
    assert(result.status !== 0, `${options.label ?? "expected failure"} unexpectedly passed`);
    return result;
  }

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    fail(`${options.label ?? "packet run"} failed: ${detail}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${options.label ?? "packet run"} produced non-JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runReportingSummary() {
  const result = spawnSync(process.execPath, [packetScript, "--reporting-summary"], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    fail(`reporting summary run failed: ${detail}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`reporting summary produced non-JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function recordArgs(records) {
  return records.flatMap((record) => [record.flag, record.file]);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const defaultBlockedActions = ["redirect", "delete", "deploy", "public_file_mutation", "rank_2_release"];
const routePatchBlockedActions = ["route_patch", ...defaultBlockedActions];
const ownerDecisionBlockedActions = ["runtime_execution", "route_patch", ...defaultBlockedActions];

function expectedBlockedActionsForGate(gate) {
  return gate?.id === "macro_owner_decision_record" || gate?.id === "macro_owner_decision_followup_record"
    ? ownerDecisionBlockedActions
    : gate?.id === "rank2_pre_activation_local_smoke_record"
      || gate?.id === "rank2_review_readiness"
      || gate?.id === "rank2_owner_decision_record"
      || gate?.id === "rank2_owner_followup_record"
      || gate?.id === "rank2_mutation_approval_readiness"
      || gate?.id === "rank2_mutation_approval_record"
      || gate?.id === "rank2_route_diff_proposal_record"
      || gate?.id === "rank2_rollback_plan_record"
      || gate?.id === "rank2_local_post_patch_smoke_plan_record"
      || gate?.id === "rank2_explicit_deploy_approval_record"
      || gate?.id === "rank2_execution_readiness"
      ? routePatchBlockedActions
      : defaultBlockedActions;
}

function assertBlockedActions(label, actions, expected = ownerDecisionBlockedActions) {
  for (const action of expected) {
    assert(actions?.includes(action), `${label} must block ${action}`);
  }
}

function assertExactBlockedActions(label, actions, expected) {
  assert(JSON.stringify(actions) === JSON.stringify(expected), `${label} blocked actions mismatch`);
}

function normalizePlaceholders(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePlaceholders(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizePlaceholders(item)]),
    );
  }
  if (typeof value === "string") {
    return value
      .replaceAll("<ISO-8601 timestamp>", fixedTimestamp)
      .replaceAll("<deleted path>", deletedPath)
      .replaceAll("preserve|remap|retire", "preserve");
  }
  return value;
}

function markRowsPassed(value) {
  if (Array.isArray(value)) {
    value.forEach((item) => markRowsPassed(item));
    return value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Object.hasOwn(value, "expected_http_status")) {
    if (value.actual_http_status === null) {
      value.actual_http_status = value.expected_http_status;
    }
    if (value.status === null) {
      value.status = value.expected_http_status;
    }
    if (value.ok === null) {
      value.ok = true;
    }
  }

  if (Object.hasOwn(value, "allowed_http_statuses") && Array.isArray(value.allowed_http_statuses)) {
    const status = value.allowed_http_statuses[0];
    if (value.actual_http_status === null) {
      value.actual_http_status = status;
    }
    if (value.status === null) {
      value.status = status;
    }
    if (value.ok === null) {
      value.ok = true;
    }
  }

  Object.values(value).forEach((item) => markRowsPassed(item));
  return value;
}

function fillSelectedDecisionFollowup(record) {
  if (record.schema_version !== "macro-owner-decision-record/v0.1") {
    return record;
  }
  const selected = record.decision_followup_selection_contract?.required_options_by_decision?.[record.decision];
  if (selected) {
    record.selected_decision_followup_plan = selected;
  }
  return record;
}

function makeValidRecord(template) {
  const record = normalizePlaceholders(cloneJson(template));
  const schema = record.schema_version ?? "";
  fillSelectedDecisionFollowup(record);

  if (schema === "inactive-owner-review-live-equivalence-record/v0.1") {
    record.proof_status = "local_runtime_smoke_passed";
    markRowsPassed(record);
  }

  if (schema === "rank2-fresh-owner-runtime-packet-record/v0.1") {
    markRowsPassed(record);
  }

  if (!schema.includes("plan") && /smoke.*(record|evidence)\/v0\.1$/.test(schema)) {
    markRowsPassed(record);
  }

  return record;
}

function expectedCurrentSafeSliceId(packet) {
  const gate = packet.current_next_required_gate;
  if (!gate) return null;
  if (gate.next_safe_enforcement_slice) return gate.next_safe_enforcement_slice;
  if (gate.id === "macro_owner_decision_followup_record") {
    return {
      preserve: "preserve_bridge_documentation",
      remap: "remap_proposal_dry_run",
      retire: "retire_readiness_packet",
    }[gate.selected_decision] ?? null;
  }
  return {
    macro_owner_decision_record: "owner_decision_record_validation",
    rank2_pre_activation_local_smoke_record: "rank2_pre_activation_local_smoke_prep",
    rank2_owner_decision_record: "rank2_owner_decision_record_validation",
    rank2_owner_followup_record: "rank2_owner_followup_record_validation",
    rank2_mutation_approval_readiness: "rank2_mutation_approval_request_prep",
    rank2_mutation_approval_record: "rank2_mutation_approval_record_validation",
    rank2_route_diff_proposal_record: "rank2_route_diff_proposal_validation",
    rank2_rollback_plan_record: "rank2_rollback_plan_validation",
    rank2_local_post_patch_smoke_plan_record: "rank2_local_post_patch_smoke_plan_validation",
    rank2_explicit_deploy_approval_record: "rank2_explicit_deploy_approval_record_validation",
    rank2_execution_readiness: "rank2_execution_readiness_prerequisite_map",
    rank2_route_execution_packet_record: "rank2_route_execution_packet_validation",
    rank2_owner_runtime_release_record: "rank2_owner_runtime_release_record_validation",
    rank2_route_patch_application_record: "rank2_route_patch_application_record_validation",
    rank2_local_post_patch_smoke_record: "rank2_local_post_patch_smoke_record_validation",
    rank2_deploy_execution_record: "rank2_deploy_execution_record_validation",
    rank2_production_live_smoke_record: "rank2_production_live_smoke_record_validation",
    rank2_post_live_redirect_delete_approval_request: "rank2_post_live_redirect_delete_approval_request_validation",
    rank2_post_live_redirect_delete_approval_record: "rank2_post_live_redirect_delete_approval_record_validation",
    rank2_post_live_redirect_delete_execution_packet: "rank2_post_live_redirect_delete_execution_packet_validation",
    rank2_post_live_redirect_delete_execution_record: "rank2_post_live_redirect_delete_execution_record_validation",
    rank2_post_live_redirect_delete_post_execution_smoke_record: "rank2_post_live_redirect_delete_post_execution_smoke_record_validation",
    rank2_post_live_redirect_delete_rollback_readiness_record: "rank2_post_live_redirect_delete_rollback_readiness_record_validation",
    rank2_post_live_redirect_delete_owner_closeout_record: "rank2_post_live_redirect_delete_owner_closeout_record_validation",
    rank2_fresh_owner_runtime_execution_packet_record: "rank2_fresh_owner_runtime_execution_packet_required",
    rank2_fresh_owner_external_runtime_execution_evidence_record: "rank2_fresh_owner_external_runtime_execution_evidence_required",
    rank2_fresh_owner_post_runtime_smoke_evidence_record: "rank2_fresh_owner_post_runtime_smoke_evidence_required",
    rank2_fresh_owner_rollback_readiness_record: "rank2_fresh_owner_rollback_readiness_required",
    rank2_fresh_owner_owner_closeout_record: "rank2_fresh_owner_owner_closeout_required",
  }[gate.id] ?? null;
}

function assertReportingSummaryCurrentSafeSlice(packet) {
  const summary = packet.reporting_summary;
  assert(summary?.schema_version === "macro-owner-reporting-summary/v0.1", "reporting summary is missing");
  const expectedId = expectedCurrentSafeSliceId(packet);
  assert(summary.current_safe_enforcement_slice_id === expectedId, `reporting summary current safe-slice id mismatch for gate ${packet.current_next_required_gate?.id}`);
  if (!expectedId || expectedId === "none_record_chain_closed") {
    assert(summary.current_safe_enforcement_slice === null, `reporting summary current safe-slice object must be null for gate ${packet.current_next_required_gate?.id}`);
    return;
  }
  const expectedSlice = (packet.safe_enforcement_slices ?? []).find((slice) => slice.id === expectedId);
  assert(expectedSlice, `expected safe enforcement slice missing for gate ${packet.current_next_required_gate?.id}: ${expectedId}`);
  assert(JSON.stringify(summary.current_safe_enforcement_slice) === JSON.stringify(expectedSlice), `reporting summary current safe-slice object mismatch for gate ${packet.current_next_required_gate?.id}`);
  assert(summary.current_safe_enforcement_slice.mutation === "none", `reporting summary current safe-slice must be no-mutation for gate ${packet.current_next_required_gate?.id}`);
  assert(summary.current_safe_enforcement_slice.mutation_allowed === false, `reporting summary current safe-slice must keep mutation disallowed for gate ${packet.current_next_required_gate?.id}`);
  assertBlockedActions(
    `current safe-slice blocked actions for ${packet.current_next_required_gate.id}`,
    summary.current_safe_enforcement_slice.blocked_actions,
    expectedBlockedActionsForGate(packet.current_next_required_gate),
  );
  if (expectedSlice.required_evidence_detail_surface) {
    assert(
      JSON.stringify(summary.current_safe_enforcement_slice.required_evidence_detail_surface) === JSON.stringify(packet.current_next_required_gate.required_evidence_detail_surface ?? packet.next_gated_slice.required_evidence_detail_surface),
      `current safe-slice evidence detail surface mismatch for gate ${packet.current_next_required_gate?.id}`,
    );
  }
}

function assertReportingSummaryCurrentGateChecklist(packet) {
  const summary = packet.reporting_summary;
  assert(summary?.schema_version === "macro-owner-reporting-summary/v0.1", "reporting summary is missing");
  const gate = packet.current_next_required_gate;
  const checklist = summary.current_gate_checklist;
  assert(checklist?.schema_version === "macro-owner-current-gate-checklist/v0.1", "reporting summary current gate checklist is missing");
  assert(checklist.gate === gate?.id, `reporting summary current gate checklist gate mismatch for gate ${gate?.id}`);
  assert(checklist.gate_status === gate?.status, `reporting summary current gate checklist status mismatch for gate ${gate?.id}`);
  assert(checklist.current_status === gate?.current_status, `reporting summary current gate checklist current status mismatch for gate ${gate?.id}`);
  assert(checklist.required_status === gate?.required_status, `reporting summary current gate checklist required status mismatch for gate ${gate?.id}`);
  const expectedSchema = gate?.required_record_schema ?? (gate?.id === packet.next_gated_slice?.id ? packet.next_gated_slice?.required_record_schema : null);
  assert(checklist.required_record_schema === expectedSchema, `reporting summary current gate checklist record schema mismatch for gate ${gate?.id}`);
  assert(checklist.mutation === "none", `reporting summary current gate checklist must keep mutation none for gate ${gate?.id}`);
  assert(checklist.mutation_allowed === false, `reporting summary current gate checklist must keep mutation disallowed for gate ${gate?.id}`);
  assert(checklist.separate_mutation_approval_required === true, `reporting summary current gate checklist must require separate mutation approval for gate ${gate?.id}`);
  assertExactBlockedActions(
    `reporting summary current gate checklist for gate ${gate?.id}`,
    checklist.blocked_actions,
    expectedBlockedActionsForGate(gate),
  );
  assert(checklist.next_safe_enforcement_slice_id === expectedCurrentSafeSliceId(packet), `reporting summary current gate checklist safe-slice mismatch for gate ${gate?.id}`);
  const checks = Object.fromEntries((checklist.checks ?? []).map((check) => [check.id, check]));
  for (const id of [
    "gate_no_mutation",
    "separate_mutation_approval_required",
    "blocked_actions_locked",
    "local_live_equivalence_locked",
    "pro_route_ia_acceptance_locked",
    "evidence_detail_surface_locked",
    "safe_enforcement_slice_linked",
  ]) {
    assert(checks[id]?.status === "pass", `reporting summary current gate checklist must pass ${id} for gate ${gate?.id}`);
  }
  const expectedRecordStatus = gate?.current_status === gate?.required_status ? "satisfied" : "pending";
  assert(checks.required_record_status?.status === expectedRecordStatus, `reporting summary current gate checklist required record status mismatch for gate ${gate?.id}`);
}

function assertDefaultProAndSafeSliceEvidence(packet) {
  const evidence = packet.evidence ?? {};
  assert(evidence.canonical_root_inventory_ok === true, "default packet canonical-root inventory is not OK");
  assert(evidence.pro_screen_model_acceptance_ready === true, "default packet PRO screen-model acceptance is not ready");
  assert(evidence.local_live_equivalence_proof_status === "local_runtime_smoke_passed", "default packet local live-equivalence proof is not passed");
  assert(evidence.local_live_equivalence_rows_checked === evidence.local_live_equivalence_rows_expected, "default packet live-equivalence row count mismatch");
  assert(Array.isArray(evidence.smoke_rows) && evidence.smoke_rows.length === evidence.local_live_equivalence_rows_expected, "default packet live-equivalence row set is not locked");

  const routeChecks = packet.owner_decision_acceptance_contract?.required_pro_route_ia_acceptance_checks ?? [];
  assert(routeChecks.length >= 10, "default packet PRO route/IA acceptance checks are incomplete");
  assert(routeChecks.every((check) => check.status === "pass"), "default packet PRO route/IA acceptance checks must all pass");

  const screenModel = packet.owner_decision_acceptance_contract?.required_pro_screen_model_acceptance;
  assert(screenModel?.acceptance_ready === true, "default packet PRO screen-model acceptance contract is not ready");
  assert(screenModel.home_primary_allowed === false, "default packet must keep legacy macro owner out of Home primary IA");
  assert(screenModel.mobile_primary_allowed === false, "default packet must keep legacy macro owner out of mobile primary IA");

  const safeSlices = packet.safe_enforcement_slices ?? [];
  const requiredSliceIds = [
    "owner_decision_record_validation",
    "rank2_pre_activation_local_smoke_prep",
    "rank2_route_diff_proposal_validation",
    "rank2_post_live_redirect_delete_fresh_owner_packet_required",
    "rank2_fresh_owner_runtime_execution_packet_required",
    "rank2_fresh_owner_external_runtime_execution_evidence_required",
    "rank2_fresh_owner_post_runtime_smoke_evidence_required",
    "rank2_fresh_owner_rollback_readiness_required",
    "rank2_fresh_owner_owner_closeout_required",
  ];
  assert(safeSlices.length >= requiredSliceIds.length, "default packet safe enforcement slices are missing");
  for (const id of requiredSliceIds) {
    assert(safeSlices.some((slice) => slice.id === id), `default packet missing safe enforcement slice: ${id}`);
  }
  for (const slice of safeSlices) {
    assert(slice.mutation === "none", `safe enforcement slice must remain no-mutation: ${slice.id}`);
    assert(slice.mutation_allowed === false, `safe enforcement slice must keep mutation disallowed: ${slice.id}`);
    assert(Array.isArray(slice.blocked_actions) && slice.blocked_actions.length >= defaultBlockedActions.length, `safe enforcement slice must carry blocked actions: ${slice.id}`);
    for (const action of defaultBlockedActions) {
      assert(slice.blocked_actions.includes(action), `safe enforcement slice must keep ${action} blocked: ${slice.id}`);
    }
  }

  const summary = packet.reporting_summary;
  assert(summary?.schema_version === "macro-owner-reporting-summary/v0.1", "default packet reporting summary is missing");
  assert(summary.next_gated_slice === packet.next_gated_slice.id, "reporting summary next gate mismatch");
  assert(summary.current_next_required_gate === packet.current_next_required_gate.id, "reporting summary current gate mismatch");
  assert(JSON.stringify(summary.local_live_equivalence?.rows) === JSON.stringify(evidence.smoke_rows), "reporting summary local live-equivalence rows mismatch");
  assert(summary.local_live_equivalence.rows.length === evidence.local_live_equivalence_rows_expected, "reporting summary local live-equivalence row set length mismatch");
  assert(summary.local_live_equivalence.rows.every((row) => row.status === row.expected_http_status && row.ok === true), "reporting summary local live-equivalence rows must carry passing evidence");
  assert(summary.pro_route_ia_acceptance?.status === "all_pass", "reporting summary PRO route/IA status must be all_pass");
  assert(JSON.stringify(summary.pro_route_ia_acceptance?.check_details) === JSON.stringify(routeChecks), "reporting summary PRO route/IA check details mismatch");
  assert(summary.pro_route_ia_acceptance.check_details.every((check) => check.status === "pass"), "reporting summary PRO route/IA check details must all pass");
  assert(summary.pro_route_ia_acceptance?.file_line_evidence?.length > 0, "reporting summary must expose PRO file:line evidence");
  assert(summary.home_dashboard_entrypoint_file_lines?.length === packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows.length, "reporting summary Home/dashboard evidence mismatch");
  assert(summary.source_reference_file_lines?.length === packet.evidence.src_legacy_reference_rows.length, "reporting summary source-reference evidence mismatch");
  assert(summary.safe_enforcement_slice_count === safeSlices.length, "reporting summary safe-slice count mismatch");
  assert(JSON.stringify(summary.safe_enforcement_slice_details) === JSON.stringify(safeSlices), "reporting summary safe-slice details mismatch");
  assert(JSON.stringify(summary.safe_enforcement_slice_details.map((slice) => slice.id)) === JSON.stringify(safeSlices.map((slice) => slice.id)), "reporting summary safe-slice detail ids mismatch");
  assert(summary.safe_enforcement_slice_details.every((slice) => slice.mutation === "none" && slice.mutation_allowed === false), "reporting summary safe-slice details must remain no-mutation");
  const ownerDecisionSafeSlice = safeSlices.find((slice) => slice.id === "owner_decision_record_validation");
  assert(
    JSON.stringify(ownerDecisionSafeSlice?.required_evidence_detail_surface) === JSON.stringify(packet.next_gated_slice.required_evidence_detail_surface),
    "owner decision safe-slice evidence detail surface must match next gate",
  );
  assertReportingSummaryCurrentSafeSlice(packet);
  assertReportingSummaryCurrentGateChecklist(packet);
  const currentGateChecks = Object.fromEntries((summary.current_gate_checklist.checks ?? []).map((check) => [check.id, check]));
  assert(currentGateChecks.evidence_detail_surface_locked?.actual?.required === true, "default current gate checklist must require owner evidence detail surface");
  assert(currentGateChecks.evidence_detail_surface_locked?.actual?.gate_matches_required === true, "default current gate checklist gate evidence detail surface must match owner requirements");
  assert(currentGateChecks.evidence_detail_surface_locked?.actual?.safe_slice_matches_required === true, "default current gate checklist safe-slice evidence detail surface must match owner requirements");
  assert(summary.owner_decision_input_contract?.schema_version === "macro-owner-decision-input-contract/v0.1", "reporting summary owner decision input contract is missing");
  assert(summary.owner_decision_input_contract.required_record_schema === packet.next_gated_slice.required_record_schema, "reporting summary owner decision input record schema mismatch");
  assert(summary.owner_decision_input_contract.template_command === packet.next_owner_action.template_command, "reporting summary owner decision input template command mismatch");
  for (const field of [
    "decision",
    "selected_decision_followup_plan",
    "reporting_summary_acknowledgement",
    "safe_enforcement_slice_acknowledgement",
    "mutation_approved",
    "execution_allowed",
    "execution_by_this_command_allowed",
  ]) {
    assert(summary.owner_decision_input_contract.required_record_fields?.includes(field), `reporting summary owner decision input must require ${field}`);
  }
  for (const field of summary.owner_decision_input_contract.required_record_fields ?? []) {
    assert(Object.hasOwn(packet.decision_record_template ?? {}, field), `owner decision input required field must exist in decision record template: ${field}`);
  }
  assert(summary.owner_decision_input_contract.required_record_mutation_approved === false, "reporting summary owner decision input must expose mutation_approved=false");
  assert(summary.owner_decision_input_contract.required_record_execution_allowed === false, "reporting summary owner decision input must expose execution_allowed=false");
  assert(summary.owner_decision_input_contract.required_record_execution_by_this_command_allowed === false, "reporting summary owner decision input must expose execution_by_this_command_allowed=false");
  assert(summary.owner_decision_input_contract.required_record_mutation_approved === packet.decision_record_template.mutation_approved, "owner decision input mutation_approved must match template");
  assert(summary.owner_decision_input_contract.required_record_execution_allowed === packet.decision_record_template.execution_allowed, "owner decision input execution_allowed must match template");
  assert(summary.owner_decision_input_contract.required_record_execution_by_this_command_allowed === packet.decision_record_template.execution_by_this_command_allowed, "owner decision input execution_by_this_command_allowed must match template");
  assert(summary.owner_decision_input_contract.required_owner_approved_by_placeholder === packet.decision_record_template.owner_approved_by, "owner decision input owner approval placeholder must match template");
  assert(summary.owner_decision_input_contract.required_owner_approved_by_non_empty === true, "owner decision input must require non-empty owner approval");
  assert(summary.owner_decision_input_contract.required_decided_at_placeholder === packet.decision_record_template.decided_at, "owner decision input decided_at placeholder must match template");
  assert(summary.owner_decision_input_contract.required_decided_at_format === "full ISO-8601 timestamp with timezone", "owner decision input decided_at format must require ISO timestamp with timezone");
  assert(typeof summary.owner_decision_input_contract.required_decided_at_pattern === "string" && summary.owner_decision_input_contract.required_decided_at_pattern.includes("Z|[+-]"), "owner decision input decided_at pattern must expose timezone requirement");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_decision_option_keys) === JSON.stringify(packet.decision_record_template.decision_options.map((option) => option.decision)), "owner decision input decision option keys must match template");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_decision_option_keys) === JSON.stringify(packet.next_gated_slice.required_decisions), "owner decision input decision option keys must match current gate");
  assert(summary.owner_decision_input_contract.required_decision_option_count === packet.decision_record_template.decision_options.length, "owner decision input decision option count must match template");
  assert(summary.owner_decision_input_contract.required_decision_options_mutation_allowed === false, "owner decision input decision options must disallow mutation");
  assert(packet.decision_record_template.decision_options.every((option) => option.mutation_allowed === false), "decision record template decision options must disallow mutation");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_decision_options_blocked_actions) === JSON.stringify(Object.fromEntries(packet.decision_record_template.decision_options.map((option) => [option.decision, option.blocked_actions]))), "owner decision input decision option blockers must match template");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_release_blockers_acknowledged) === JSON.stringify(packet.decision_record_template.release_blockers_acknowledged), "owner decision input release blockers must match template");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_release_blockers_acknowledged) === JSON.stringify(packet.release_blockers), "owner decision input release blockers must match packet blockers");
  assert(summary.owner_decision_input_contract.required_release_blocker_count === packet.decision_record_template.release_blockers_acknowledged.length, "owner decision input release blocker count must match template");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_decision_followup_plan_ids) === JSON.stringify(packet.decision_record_template.decision_followup_plans.map((plan) => plan.id)), "owner decision input follow-up plan ids must match template");
  assert(summary.owner_decision_input_contract.required_decision_followup_plan_count === packet.decision_record_template.decision_followup_plans.length, "owner decision input follow-up plan count must match template");
  assert(summary.owner_decision_input_contract.required_family_id === packet.decision_record_template.family_id, "owner decision input family id must match template");
  assert(summary.owner_decision_input_contract.required_owner_route === packet.decision_record_template.owner_route, "owner decision input owner route must match template");
  assert(summary.owner_decision_input_contract.required_compatibility_route === packet.decision_record_template.compatibility_route, "owner decision input compatibility route must match template");
  assert(summary.owner_decision_input_contract.required_local_live_equivalence_base_url === packet.decision_record_template.local_live_equivalence_base_url, "owner decision input live-equivalence base URL must match template");
  assert(summary.owner_decision_input_contract.required_local_live_equivalence_proof_status === packet.decision_record_template.local_live_equivalence_proof_status, "owner decision input live-equivalence status must match template");
  assert(summary.owner_decision_input_contract.required_local_live_equivalence_rows_checked === packet.decision_record_template.local_live_equivalence_rows_checked, "owner decision input live-equivalence checked rows must match template");
  assert(summary.owner_decision_input_contract.required_local_live_equivalence_row_count === packet.decision_record_template.local_live_equivalence_rows.length, "owner decision input live-equivalence row count must match template");
  assert(summary.owner_decision_input_contract.required_local_live_equivalence_row_count === summary.local_live_equivalence.rows_expected, "owner decision input live-equivalence row count must match summary");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_local_live_equivalence_row_paths) === JSON.stringify(packet.decision_record_template.local_live_equivalence_rows.map((row) => row.path)), "owner decision input live-equivalence row paths must match template");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_local_live_equivalence_row_paths) === JSON.stringify(summary.local_live_equivalence.rows.map((row) => row.path)), "owner decision input live-equivalence row paths must match summary");
  assert(summary.owner_decision_input_contract.required_local_live_equivalence_rows_all_ok === true, "owner decision input live-equivalence rows must require all-ok status");
  assert(summary.owner_decision_input_contract.required_local_live_equivalence_row_statuses?.every((row) => row.ok === true && row.status === row.expected_http_status), "owner decision input live-equivalence row statuses must expose passing HTTP status");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_pro_route_ia_acceptance_check_ids) === JSON.stringify(packet.decision_record_template.pro_route_ia_acceptance_checks.map((check) => check.id)), "owner decision input PRO check ids must match template");
  assert(summary.owner_decision_input_contract.required_pro_route_ia_acceptance_check_count === packet.decision_record_template.pro_route_ia_acceptance_checks.length, "owner decision input PRO check count must match template");
  assert(summary.owner_decision_input_contract.required_pro_route_ia_acceptance_check_count === summary.pro_route_ia_acceptance.checks, "owner decision input PRO check count must match summary");
  assert(Object.values(summary.owner_decision_input_contract.required_pro_route_ia_acceptance_check_statuses ?? {}).every((status) => status === "pass"), "owner decision input PRO check statuses must all pass");
  assert(summary.owner_decision_input_contract.required_pro_route_ia_acceptance_all_pass === true, "owner decision input PRO checks must require all-pass status");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_pro_route_ia_acceptance_file_line_evidence) === JSON.stringify(summary.pro_route_ia_acceptance.file_line_evidence), "owner decision input PRO file-line evidence must match summary");
  assert(summary.owner_decision_input_contract.required_home_dashboard_legacy_bridge_entrypoint_count === packet.decision_record_template.home_dashboard_legacy_bridge_entrypoints.length, "owner decision input Home/dashboard count must match template");
  assert(summary.owner_decision_input_contract.required_home_dashboard_legacy_bridge_entrypoint_count === summary.home_dashboard_entrypoint_file_lines.length, "owner decision input Home/dashboard count must match summary");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_home_dashboard_legacy_bridge_entrypoint_file_lines) === JSON.stringify(summary.home_dashboard_entrypoint_file_lines), "owner decision input Home/dashboard file-line evidence must match summary");
  assert(summary.owner_decision_input_contract.required_src_legacy_reference_row_count === packet.decision_record_template.src_legacy_reference_rows.length, "owner decision input source-reference count must match template");
  assert(summary.owner_decision_input_contract.required_src_legacy_reference_row_count === summary.source_reference_file_lines.length, "owner decision input source-reference count must match summary");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_src_legacy_reference_file_lines) === JSON.stringify(summary.source_reference_file_lines), "owner decision input source-reference file-line evidence must match summary");
  assert(!summary.owner_decision_input_contract.required_record_fields?.includes("notes"), "reporting summary owner decision input must not require optional notes");
  assert(summary.owner_decision_input_contract.required_acknowledgement_schemas.reporting_summary === "macro-owner-reporting-summary-ack/v0.1", "reporting summary owner decision input reporting-summary ACK schema mismatch");
  assert(summary.owner_decision_input_contract.required_acknowledgement_schemas.safe_enforcement_slices === "macro-owner-safe-enforcement-slices-ack/v0.1", "reporting summary owner decision input safe-slice ACK schema mismatch");
  assert(summary.owner_decision_input_contract.required_acknowledgement_schemas.followup_selection === "macro-owner-decision-followup-selection/v0.1", "reporting summary owner decision input follow-up selection schema mismatch");
  assert(summary.owner_decision_input_contract.required_decision_followup_selection_contract_fields?.includes("required_options_by_decision"), "reporting summary owner decision input must expose follow-up selection options field");
  assert(summary.owner_decision_input_contract.required_decision_followup_selection_contract_fields?.includes("blocked_actions"), "reporting summary owner decision input must expose follow-up selection blockers field");
  assert(summary.owner_decision_input_contract.required_decision_followup_selection_field === "decision", "reporting summary owner decision input follow-up selection field mismatch");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_decision_followup_selection_option_keys) === JSON.stringify(["preserve", "remap", "retire"]), "reporting summary owner decision input follow-up selection options mismatch");
  assert(summary.owner_decision_input_contract.required_decision_followup_selection_mutation_allowed === false, "reporting summary owner decision input follow-up selection must disallow mutation");
  assert(summary.owner_decision_input_contract.required_decision_followup_selection_separate_mutation_approval_required === true, "reporting summary owner decision input follow-up selection must require separate approval");
  assertExactBlockedActions("reporting summary owner decision input follow-up selection", summary.owner_decision_input_contract.required_decision_followup_selection_blocked_actions, ownerDecisionBlockedActions);
  assert(summary.owner_decision_input_contract.required_decision_followup_selection_options_require_blocked_actions === true, "reporting summary owner decision input follow-up options must require blockers");
  for (const [decision, option] of Object.entries(summary.owner_decision_input_contract.selected_followup_options ?? {})) {
    assert(["preserve", "remap", "retire"].includes(decision), `reporting summary owner decision input unknown follow-up option: ${decision}`);
    assert(option.mutation_allowed === false, `reporting summary owner decision input follow-up option must disallow mutation: ${decision}`);
    assert(option.separate_mutation_approval_required === true, `reporting summary owner decision input follow-up option must require separate approval: ${decision}`);
    assertExactBlockedActions(`reporting summary owner decision input follow-up option ${decision}`, option.blocked_actions, ownerDecisionBlockedActions);
  }
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_fields?.includes("current_gate_checklist_required_checks"), "reporting summary owner decision input must require current-gate checklist ACK checks");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_fields?.includes("summary_must_be_generated_from_current_packet"), "reporting summary owner decision input must require current-packet summary ACK");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_summary_command === "node scripts/build-macro-owner-decision-packet.mjs --reporting-summary", "reporting summary owner decision input reporting-summary command mismatch");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_summary_must_be_generated_from_current_packet === true, "reporting summary owner decision input must require current-packet summary generation");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_current_gate_checklist_required === true, "reporting summary owner decision input must require current-gate checklist ACK");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_current_gate_checklist_schema_version === summary.current_gate_checklist.schema_version, "reporting summary owner decision input current-gate checklist schema mismatch");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_current_gate_checklist_must_match_current_next_required_gate === true, "reporting summary owner decision input must bind checklist to current gate");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_current_gate_checklist_required_checks) === JSON.stringify([
    "gate_no_mutation",
    "separate_mutation_approval_required",
    "blocked_actions_locked",
    "local_live_equivalence_locked",
    "pro_route_ia_acceptance_locked",
    "evidence_detail_surface_locked",
    "required_record_status",
    "safe_enforcement_slice_linked",
  ]), "reporting summary owner decision input current-gate checklist required checks mismatch");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_acknowledged_gate === "macro_owner_decision_record", "reporting summary owner decision input reporting-summary ACK gate mismatch");
  assert(summary.owner_decision_input_contract.required_reporting_summary_acknowledgement_acknowledged_record_schema === "macro-owner-decision-record/v0.1", "reporting summary owner decision input reporting-summary ACK record schema mismatch");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_fields?.includes("slice_blocked_actions"), "reporting summary owner decision input must require safe-slice blocked-action map");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_fields?.includes("all_slices_carry_blocked_actions"), "reporting summary owner decision input must require all-slices blocked-action flag");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_fields?.includes("slice_evidence_detail_surfaces"), "reporting summary owner decision input must require safe-slice evidence-detail map");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_fields?.includes("all_required_evidence_detail_surfaces_acknowledged"), "reporting summary owner decision input must require all evidence-detail surfaces acknowledged flag");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_slice_count === safeSlices.length, "reporting summary owner decision input safe-slice ACK count mismatch");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_slice_ids) === JSON.stringify(safeSlices.map((slice) => slice.id)), "reporting summary owner decision input safe-slice ACK ids mismatch");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_blocked_action_map_keys) === JSON.stringify(safeSlices.map((slice) => slice.id)), "reporting summary owner decision input safe-slice ACK blocker-map keys mismatch");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_blocked_action_map_required === true, "reporting summary owner decision input must require safe-slice blocker map");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_all_slices_carry_blocked_actions === true, "reporting summary owner decision input must require all safe slices to carry blockers");
  const expectedSafeSliceEvidenceDetailSurfaces = Object.fromEntries(
    safeSlices
      .filter((slice) => slice.required_evidence_detail_surface)
      .map((slice) => [slice.id, slice.required_evidence_detail_surface]),
  );
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_evidence_detail_surface_map_required === true, "reporting summary owner decision input must require safe-slice evidence-detail map");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_evidence_detail_surface_map_keys) === JSON.stringify(Object.keys(expectedSafeSliceEvidenceDetailSurfaces)), "reporting summary owner decision input safe-slice evidence-detail map keys mismatch");
  assert(JSON.stringify(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_evidence_detail_surfaces) === JSON.stringify(expectedSafeSliceEvidenceDetailSurfaces), "reporting summary owner decision input safe-slice evidence-detail surfaces mismatch");
  assert(summary.owner_decision_input_contract.required_safe_enforcement_slice_acknowledgement_all_required_evidence_detail_surfaces_acknowledged === true, "reporting summary owner decision input must require all safe-slice evidence details acknowledged");
  assert(summary.owner_decision_input_contract.selected_followup_options?.preserve?.id === "preserve_decision_documentation_packet", "reporting summary preserve follow-up option mismatch");
  assert(summary.owner_decision_input_contract.selected_followup_options?.remap?.id === "remap_dry_run_proposal_packet", "reporting summary remap follow-up option mismatch");
  assert(summary.owner_decision_input_contract.selected_followup_options?.retire?.id === "retire_readiness_packet", "reporting summary retire follow-up option mismatch");

  const summaryAck = packet.owner_decision_acceptance_contract?.required_reporting_summary_acknowledgement;
  assert(summaryAck?.schema_version === "macro-owner-reporting-summary-ack/v0.1", "owner decision reporting summary acknowledgement is missing");
  assert(summaryAck.summary_schema_version === summary.schema_version, "owner decision reporting summary acknowledgement schema mismatch");
  assert(summaryAck.summary_command === "node scripts/build-macro-owner-decision-packet.mjs --reporting-summary", "owner decision reporting summary acknowledgement command mismatch");
  assert(summaryAck.current_gate_checklist_required === true, "owner decision reporting summary acknowledgement must require current gate checklist");
  assert(summaryAck.current_gate_checklist_schema_version === summary.current_gate_checklist.schema_version, "owner decision reporting summary acknowledgement current gate checklist schema mismatch");
  assert(summaryAck.current_gate_checklist_must_match_current_next_required_gate === true, "owner decision reporting summary acknowledgement must bind current gate checklist to current_next_required_gate");
  for (const id of [
    "gate_no_mutation",
    "separate_mutation_approval_required",
    "blocked_actions_locked",
    "local_live_equivalence_locked",
    "pro_route_ia_acceptance_locked",
    "evidence_detail_surface_locked",
    "required_record_status",
    "safe_enforcement_slice_linked",
  ]) {
    assert(summaryAck.current_gate_checklist_required_checks.includes(id), `owner decision reporting summary acknowledgement must require current gate checklist check: ${id}`);
  }
  assert(summaryAck.mutation_allowed === false, "owner decision reporting summary acknowledgement must not allow mutation");
  assert(JSON.stringify(packet.decision_record_template?.reporting_summary_acknowledgement) === JSON.stringify(summaryAck), "decision record template reporting summary acknowledgement mismatch");
  assert(JSON.stringify(packet.next_gated_slice?.required_reporting_summary_acknowledgement) === JSON.stringify(summaryAck), "next gated slice reporting summary acknowledgement mismatch");
  assert(JSON.stringify(packet.next_owner_action?.required_reporting_summary_acknowledgement) === JSON.stringify(summaryAck), "next owner action reporting summary acknowledgement mismatch");
  const evidenceDetailSurface = {
    required_local_live_equivalence_row_paths: summary.owner_decision_input_contract.required_local_live_equivalence_row_paths,
    required_local_live_equivalence_row_statuses: summary.owner_decision_input_contract.required_local_live_equivalence_row_statuses,
    required_local_live_equivalence_rows_all_ok: true,
    required_pro_route_ia_acceptance_check_statuses: summary.owner_decision_input_contract.required_pro_route_ia_acceptance_check_statuses,
    required_pro_route_ia_acceptance_all_pass: true,
    required_pro_route_ia_acceptance_file_line_evidence: summary.owner_decision_input_contract.required_pro_route_ia_acceptance_file_line_evidence,
    required_home_dashboard_legacy_bridge_entrypoint_file_lines: summary.owner_decision_input_contract.required_home_dashboard_legacy_bridge_entrypoint_file_lines,
    required_src_legacy_reference_file_lines: summary.owner_decision_input_contract.required_src_legacy_reference_file_lines,
  };
  assert(JSON.stringify(packet.next_gated_slice?.required_evidence_detail_surface) === JSON.stringify(evidenceDetailSurface), "next gated slice evidence detail surface mismatch");
  assert(JSON.stringify(packet.next_owner_action?.required_evidence_detail_surface) === JSON.stringify(evidenceDetailSurface), "next owner action evidence detail surface mismatch");
  assert(JSON.stringify(packet.owner_decision_acceptance_contract?.required_evidence_detail_surface) === JSON.stringify(evidenceDetailSurface), "owner decision acceptance contract evidence detail surface mismatch");
  assert(packet.decision_record_template.execution_allowed === false, "decision record template must disallow execution");
  assert(packet.decision_record_template.execution_by_this_command_allowed === false, "decision record template must disallow execution by this command");
  assert(packet.next_gated_slice.required_execution_allowed === false, "next gated slice must disallow execution");
  assert(packet.next_gated_slice.required_execution_by_this_command_allowed === false, "next gated slice must disallow execution by this command");
  assert(packet.next_owner_action.required_execution_allowed === false, "next owner action must disallow execution");
  assert(packet.next_owner_action.required_execution_by_this_command_allowed === false, "next owner action must disallow execution by this command");
  assert(packet.owner_decision_acceptance_contract.required_execution_allowed === false, "owner decision acceptance contract must disallow execution");
  assert(packet.owner_decision_acceptance_contract.required_execution_by_this_command_allowed === false, "owner decision acceptance contract must disallow execution by this command");
  assertBlockedActions("next gated slice required blocked actions", packet.next_gated_slice.required_blocked_actions);
  assertBlockedActions("next owner action blocked actions", packet.next_owner_action.blocked_actions);
  assertBlockedActions("owner decision acceptance contract blocked actions", packet.owner_decision_acceptance_contract.blocked_actions);
  assertBlockedActions("reporting summary blocked actions", summary.blocked_actions);
  assertBlockedActions("owner decision reporting summary acknowledgement blocked actions", summaryAck.blocked_actions);

  const safeSliceAck = packet.owner_decision_acceptance_contract?.required_safe_enforcement_slice_acknowledgement;
  assert(safeSliceAck?.schema_version === "macro-owner-safe-enforcement-slices-ack/v0.1", "owner decision safe enforcement slice acknowledgement is missing");
  assert(safeSliceAck.slice_count === safeSlices.length, "owner decision safe enforcement slice acknowledgement count mismatch");
  assert(JSON.stringify(safeSliceAck.slice_ids) === JSON.stringify(safeSlices.map((slice) => slice.id)), "owner decision safe enforcement slice acknowledgement ids mismatch");
  assert(safeSliceAck.all_slices_mutation === "none", "owner decision safe enforcement slice acknowledgement must record no-mutation slices");
  assert(safeSliceAck.all_slices_mutation_allowed === false, "owner decision safe enforcement slice acknowledgement must keep mutation disallowed");
  assert(safeSliceAck.all_slices_carry_blocked_actions === true, "owner decision safe enforcement slice acknowledgement must record per-slice blocked actions");
  assert(
    JSON.stringify(safeSliceAck.slice_blocked_actions) === JSON.stringify(Object.fromEntries(safeSlices.map((slice) => [slice.id, slice.blocked_actions]))),
    "owner decision safe enforcement slice acknowledgement blocked-action map mismatch",
  );
  assert(safeSliceAck.all_required_evidence_detail_surfaces_acknowledged === true, "owner decision safe enforcement slice acknowledgement must record evidence-detail surfaces");
  assert(
    JSON.stringify(safeSliceAck.slice_evidence_detail_surfaces) === JSON.stringify(expectedSafeSliceEvidenceDetailSurfaces),
    "owner decision safe enforcement slice acknowledgement evidence-detail map mismatch",
  );
  assert(
    JSON.stringify(safeSliceAck.slice_evidence_detail_surfaces?.owner_decision_record_validation) === JSON.stringify(packet.next_gated_slice.required_evidence_detail_surface),
    "owner decision safe enforcement slice acknowledgement owner-decision evidence detail mismatch",
  );
  assertBlockedActions("owner decision safe enforcement slice acknowledgement blocked actions", safeSliceAck.blocked_actions);
  assert(JSON.stringify(packet.decision_record_template?.safe_enforcement_slice_acknowledgement) === JSON.stringify(safeSliceAck), "decision record template safe enforcement slice acknowledgement mismatch");
  assert(JSON.stringify(packet.next_gated_slice?.required_safe_enforcement_slice_acknowledgement) === JSON.stringify(safeSliceAck), "next gated slice safe enforcement slice acknowledgement mismatch");
  assert(JSON.stringify(packet.next_owner_action?.required_safe_enforcement_slice_acknowledgement) === JSON.stringify(safeSliceAck), "next owner action safe enforcement slice acknowledgement mismatch");

  const followupSelection = packet.owner_decision_acceptance_contract?.required_decision_followup_selection_contract;
  assert(followupSelection?.schema_version === "macro-owner-decision-followup-selection/v0.1", "owner decision follow-up selection contract is missing");
  assert(followupSelection.required_options_by_decision?.preserve?.id === "preserve_decision_documentation_packet", "preserve follow-up selection is not locked");
  assert(followupSelection.required_options_by_decision?.remap?.id === "remap_dry_run_proposal_packet", "remap follow-up selection is not locked");
  assert(followupSelection.required_options_by_decision?.retire?.id === "retire_readiness_packet", "retire follow-up selection is not locked");
  assert(followupSelection.mutation_allowed === false, "owner decision follow-up selection contract must not allow mutation");
  assert(followupSelection.separate_mutation_approval_required === true, "owner decision follow-up selection contract must require separate mutation approval");
  assertBlockedActions("owner decision follow-up selection contract blocked actions", followupSelection.blocked_actions);
  for (const plan of packet.decision_followup_plans ?? []) {
    assertBlockedActions(`owner decision follow-up plan ${plan.id} blocked actions`, plan.blocked_actions);
    assert(
      JSON.stringify(plan.required_evidence_detail_surface) === JSON.stringify(evidenceDetailSurface),
      `owner decision follow-up plan evidence detail surface mismatch: ${plan.id}`,
    );
  }
  for (const template of packet.decision_followup_record_templates ?? []) {
    assertBlockedActions(`owner decision follow-up record template ${template.followup_id} blocked actions`, template.blocked_actions);
    assert(
      JSON.stringify(template.required_evidence_detail_surface) === JSON.stringify(evidenceDetailSurface),
      `owner decision follow-up template evidence detail surface mismatch: ${template.followup_id}`,
    );
  }
  assert(JSON.stringify(packet.decision_record_template?.decision_followup_selection_contract) === JSON.stringify(followupSelection), "decision record template follow-up selection contract mismatch");
  assert(JSON.stringify(packet.next_gated_slice?.required_decision_followup_selection_contract) === JSON.stringify(followupSelection), "next gated slice follow-up selection contract mismatch");
  assert(JSON.stringify(packet.next_owner_action?.required_decision_followup_selection_contract) === JSON.stringify(followupSelection), "next owner action follow-up selection contract mismatch");
}

function selectDecisionFollowup(packet) {
  return packet.decision_followup_record_templates.find(
    (item) => item.followup_id === packet.selected_decision_followup?.id,
  ) ?? packet.decision_followup_record_templates[0];
}

function selectRank2OwnerFollowup(packet) {
  return packet.rank2_owner_followup_record_templates.find(
    (item) => item.followup_id === packet.selected_rank2_owner_followup?.id,
  ) ?? packet.rank2_owner_followup_record_templates[0];
}

const steps = [
  {
    label: "decision-record",
    flag: "--decision-record",
    select: (packet) => packet.decision_record_template,
  },
  {
    label: "decision-followup",
    flag: "--decision-followup-record",
    select: selectDecisionFollowup,
  },
  {
    label: "rank2-pre-activation",
    flag: "--rank2-pre-activation-record",
    select: (packet) => packet.inactive_next_candidate_preview.live_equivalence_prep.record_template,
  },
  {
    label: "rank2-owner-decision",
    flag: "--rank2-owner-decision-record",
    select: (packet) => packet.rank2_owner_review_template.decision_record_template,
  },
  {
    label: "rank2-owner-followup",
    flag: "--rank2-owner-followup-record",
    select: selectRank2OwnerFollowup,
  },
  {
    label: "rank2-mutation-approval",
    flag: "--rank2-mutation-approval-record",
    select: (packet) => packet.rank2_mutation_approval_record_template,
  },
  {
    label: "rank2-route-diff-proposal",
    flag: "--rank2-route-diff-proposal",
    select: (packet) => packet.rank2_route_diff_proposal_template,
  },
  {
    label: "rank2-rollback-plan",
    flag: "--rank2-rollback-plan",
    select: (packet) => packet.rank2_rollback_plan_template,
  },
  {
    label: "rank2-local-post-patch-smoke-plan",
    flag: "--rank2-local-post-patch-smoke-plan",
    select: (packet) => packet.rank2_local_post_patch_smoke_plan_template,
  },
  {
    label: "rank2-explicit-deploy-approval",
    flag: "--rank2-explicit-deploy-approval",
    select: (packet) => packet.rank2_explicit_deploy_approval_template,
  },
  {
    label: "rank2-route-execution-packet",
    flag: "--rank2-route-execution-packet",
    select: (packet) => packet.rank2_route_execution_packet_template,
  },
  {
    label: "rank2-owner-runtime-release",
    flag: "--rank2-owner-runtime-release",
    select: (packet) => packet.rank2_owner_runtime_release_template,
  },
  {
    label: "rank2-route-patch-application",
    flag: "--rank2-route-patch-application",
    select: (packet) => packet.rank2_route_patch_application_template,
  },
  {
    label: "rank2-local-post-patch-smoke-record",
    flag: "--rank2-local-post-patch-smoke-record",
    select: (packet) => packet.rank2_local_post_patch_smoke_record_template,
  },
  {
    label: "rank2-deploy-execution",
    flag: "--rank2-deploy-execution",
    select: (packet) => packet.rank2_deploy_execution_template,
  },
  {
    label: "rank2-production-live-smoke",
    flag: "--rank2-production-live-smoke",
    select: (packet) => packet.rank2_production_live_smoke_template,
  },
  {
    label: "rank2-post-live-redirect-delete-approval-request",
    flag: "--rank2-post-live-redirect-delete-approval-request",
    select: (packet) => packet.rank2_post_live_redirect_delete_approval_request_template,
  },
  {
    label: "rank2-post-live-redirect-delete-approval-record",
    flag: "--rank2-post-live-redirect-delete-approval-record",
    select: (packet) => packet.rank2_post_live_redirect_delete_approval_record_template,
  },
  {
    label: "rank2-post-live-redirect-delete-execution-packet",
    flag: "--rank2-post-live-redirect-delete-execution-packet",
    select: (packet) => packet.rank2_post_live_redirect_delete_execution_packet_template,
  },
  {
    label: "rank2-post-live-redirect-delete-execution-record",
    flag: "--rank2-post-live-redirect-delete-execution-record",
    select: (packet) => packet.rank2_post_live_redirect_delete_execution_record_template,
  },
  {
    label: "rank2-post-live-redirect-delete-post-execution-smoke",
    flag: "--rank2-post-live-redirect-delete-post-execution-smoke",
    select: (packet) => packet.rank2_post_live_redirect_delete_post_execution_smoke_template,
  },
  {
    label: "rank2-post-live-redirect-delete-rollback-readiness",
    flag: "--rank2-post-live-redirect-delete-rollback-readiness",
    select: (packet) => packet.rank2_post_live_redirect_delete_rollback_readiness_template,
  },
  {
    label: "rank2-post-live-redirect-delete-owner-closeout",
    flag: "--rank2-post-live-redirect-delete-owner-closeout",
    select: (packet) => packet.rank2_post_live_redirect_delete_owner_closeout_template,
  },
  {
    label: "rank2-fresh-owner-runtime-packet",
    flag: "--rank2-fresh-owner-runtime-packet",
    select: (packet) => packet.rank2_fresh_owner_runtime_packet_template,
  },
  {
    label: "rank2-fresh-owner-runtime-execution-packet",
    flag: "--rank2-fresh-owner-runtime-execution-packet",
    select: (packet) => packet.rank2_fresh_owner_runtime_execution_packet_template,
  },
  {
    label: "rank2-fresh-owner-external-runtime-execution-evidence",
    flag: "--rank2-fresh-owner-external-runtime-execution-evidence",
    select: (packet) => packet.rank2_fresh_owner_external_runtime_execution_evidence_template,
  },
  {
    label: "rank2-fresh-owner-post-runtime-smoke-evidence",
    flag: "--rank2-fresh-owner-post-runtime-smoke-evidence",
    select: (packet) => packet.rank2_fresh_owner_post_runtime_smoke_evidence_template,
  },
  {
    label: "rank2-fresh-owner-rollback-readiness",
    flag: "--rank2-fresh-owner-rollback-readiness",
    select: (packet) => packet.rank2_fresh_owner_rollback_readiness_template,
  },
  {
    label: "rank2-fresh-owner-owner-closeout",
    flag: "--rank2-fresh-owner-owner-closeout",
    select: (packet) => packet.rank2_fresh_owner_owner_closeout_template,
  },
];

const records = [];
let packet = runPacket([]);
assertDefaultProAndSafeSliceEvidence(packet);
const reportingSummary = runReportingSummary();
assert(
  JSON.stringify(reportingSummary) === JSON.stringify(packet.reporting_summary),
  "summary-only CLI output must match the full packet reporting summary",
);
const badDecisionRecord = makeValidRecord(packet.decision_record_template);
delete badDecisionRecord.reporting_summary_acknowledgement;
const badDecisionFile = path.join(tempDir, "bad-decision-record-missing-reporting-summary-ack.json");
fs.writeFileSync(badDecisionFile, `${JSON.stringify(badDecisionRecord, null, 2)}\n`);
const negativeDecision = runPacket(
  ["--decision-record", badDecisionFile],
  {
    expectFailure: true,
    label: "negative missing decision reporting summary acknowledgement",
  },
);
const negativeDecisionOutput = `${negativeDecision.stderr}\n${negativeDecision.stdout}`;
assert(
  negativeDecisionOutput.includes("reporting summary acknowledgement"),
  "negative guard did not report decision record reporting summary acknowledgement validation",
);
const badDecisionSummaryAckRecord = makeValidRecord(packet.decision_record_template);
badDecisionSummaryAckRecord.reporting_summary_acknowledgement.current_gate_checklist_schema_version = "stale-current-gate-checklist/v0.0";
const badDecisionSummaryAckFile = path.join(tempDir, "bad-decision-record-stale-reporting-summary-ack.json");
fs.writeFileSync(badDecisionSummaryAckFile, `${JSON.stringify(badDecisionSummaryAckRecord, null, 2)}\n`);
const negativeDecisionSummaryAck = runPacket(
  ["--decision-record", badDecisionSummaryAckFile],
  {
    expectFailure: true,
    label: "negative stale decision reporting summary acknowledgement",
  },
);
const negativeDecisionSummaryAckOutput = `${negativeDecisionSummaryAck.stderr}\n${negativeDecisionSummaryAck.stdout}`;
assert(
  negativeDecisionSummaryAckOutput.includes("reporting summary acknowledgement"),
  "negative guard did not report stale decision record reporting summary acknowledgement validation",
);
const badDecisionSafeSliceRecord = makeValidRecord(packet.decision_record_template);
delete badDecisionSafeSliceRecord.safe_enforcement_slice_acknowledgement;
const badDecisionSafeSliceFile = path.join(tempDir, "bad-decision-record-missing-safe-slice-ack.json");
fs.writeFileSync(badDecisionSafeSliceFile, `${JSON.stringify(badDecisionSafeSliceRecord, null, 2)}\n`);
const negativeDecisionSafeSlice = runPacket(
  ["--decision-record", badDecisionSafeSliceFile],
  {
    expectFailure: true,
    label: "negative missing decision safe enforcement slice acknowledgement",
  },
);
const negativeDecisionSafeSliceOutput = `${negativeDecisionSafeSlice.stderr}\n${negativeDecisionSafeSlice.stdout}`;
assert(
  negativeDecisionSafeSliceOutput.includes("safe enforcement slice acknowledgement"),
  "negative guard did not report decision record safe enforcement slice acknowledgement validation",
);
const badDecisionSafeSliceBlockedActionsRecord = makeValidRecord(packet.decision_record_template);
badDecisionSafeSliceBlockedActionsRecord.safe_enforcement_slice_acknowledgement.slice_blocked_actions.owner_decision_record_validation = defaultBlockedActions;
const badDecisionSafeSliceBlockedActionsFile = path.join(tempDir, "bad-decision-record-stale-safe-slice-blocked-actions.json");
fs.writeFileSync(badDecisionSafeSliceBlockedActionsFile, `${JSON.stringify(badDecisionSafeSliceBlockedActionsRecord, null, 2)}\n`);
const negativeDecisionSafeSliceBlockedActions = runPacket(
  ["--decision-record", badDecisionSafeSliceBlockedActionsFile],
  {
    expectFailure: true,
    label: "negative stale decision safe enforcement slice blocked actions",
  },
);
const negativeDecisionSafeSliceBlockedActionsOutput = `${negativeDecisionSafeSliceBlockedActions.stderr}\n${negativeDecisionSafeSliceBlockedActions.stdout}`;
assert(
  negativeDecisionSafeSliceBlockedActionsOutput.includes("safe enforcement slice acknowledgement"),
  "negative guard did not report stale decision record safe enforcement slice blocked-action validation",
);
const badDecisionSafeSliceEvidenceDetailRecord = makeValidRecord(packet.decision_record_template);
badDecisionSafeSliceEvidenceDetailRecord.safe_enforcement_slice_acknowledgement.slice_evidence_detail_surfaces.owner_decision_record_validation.required_local_live_equivalence_row_paths = [];
const badDecisionSafeSliceEvidenceDetailFile = path.join(tempDir, "bad-decision-record-stale-safe-slice-evidence-detail.json");
fs.writeFileSync(badDecisionSafeSliceEvidenceDetailFile, `${JSON.stringify(badDecisionSafeSliceEvidenceDetailRecord, null, 2)}\n`);
const negativeDecisionSafeSliceEvidenceDetail = runPacket(
  ["--decision-record", badDecisionSafeSliceEvidenceDetailFile],
  {
    expectFailure: true,
    label: "negative stale decision safe enforcement slice evidence detail",
  },
);
const negativeDecisionSafeSliceEvidenceDetailOutput = `${negativeDecisionSafeSliceEvidenceDetail.stderr}\n${negativeDecisionSafeSliceEvidenceDetail.stdout}`;
assert(
  negativeDecisionSafeSliceEvidenceDetailOutput.includes("safe enforcement slice acknowledgement"),
  "negative guard did not report stale decision record safe enforcement slice evidence-detail validation",
);
const badDecisionFollowupSelectionRecord = makeValidRecord(packet.decision_record_template);
badDecisionFollowupSelectionRecord.decision = "remap";
badDecisionFollowupSelectionRecord.selected_decision_followup_plan = badDecisionFollowupSelectionRecord.decision_followup_selection_contract.required_options_by_decision.preserve;
const badDecisionFollowupSelectionFile = path.join(tempDir, "bad-decision-record-mismatched-followup-selection.json");
fs.writeFileSync(badDecisionFollowupSelectionFile, `${JSON.stringify(badDecisionFollowupSelectionRecord, null, 2)}\n`);
const negativeDecisionFollowupSelection = runPacket(
  ["--decision-record", badDecisionFollowupSelectionFile],
  {
    expectFailure: true,
    label: "negative mismatched decision follow-up selection",
  },
);
const negativeDecisionFollowupSelectionOutput = `${negativeDecisionFollowupSelection.stderr}\n${negativeDecisionFollowupSelection.stdout}`;
assert(
  negativeDecisionFollowupSelectionOutput.includes("selected follow-up plan"),
  "negative guard did not report decision record selected follow-up validation",
);
const badDecisionExecutionAllowedRecord = makeValidRecord(packet.decision_record_template);
badDecisionExecutionAllowedRecord.execution_by_this_command_allowed = true;
const badDecisionExecutionAllowedFile = path.join(tempDir, "bad-decision-record-execution-allowed.json");
fs.writeFileSync(badDecisionExecutionAllowedFile, `${JSON.stringify(badDecisionExecutionAllowedRecord, null, 2)}\n`);
const negativeDecisionExecutionAllowed = runPacket(
  ["--decision-record", badDecisionExecutionAllowedFile],
  {
    expectFailure: true,
    label: "negative decision execution by this command allowed",
  },
);
const negativeDecisionExecutionAllowedOutput = `${negativeDecisionExecutionAllowed.stderr}\n${negativeDecisionExecutionAllowed.stdout}`;
assert(
  negativeDecisionExecutionAllowedOutput.includes("execution by this command"),
  "negative guard did not report decision record command-side execution validation",
);
const badDecisionGlobalExecutionAllowedRecord = makeValidRecord(packet.decision_record_template);
badDecisionGlobalExecutionAllowedRecord.execution_allowed = true;
const badDecisionGlobalExecutionAllowedFile = path.join(tempDir, "bad-decision-record-global-execution-allowed.json");
fs.writeFileSync(badDecisionGlobalExecutionAllowedFile, `${JSON.stringify(badDecisionGlobalExecutionAllowedRecord, null, 2)}\n`);
const negativeDecisionGlobalExecutionAllowed = runPacket(
  ["--decision-record", badDecisionGlobalExecutionAllowedFile],
  {
    expectFailure: true,
    label: "negative decision execution allowed",
  },
);
const negativeDecisionGlobalExecutionAllowedOutput = `${negativeDecisionGlobalExecutionAllowed.stderr}\n${negativeDecisionGlobalExecutionAllowed.stdout}`;
assert(
  negativeDecisionGlobalExecutionAllowedOutput.includes("must not allow execution"),
  "negative guard did not report decision record execution_allowed validation",
);
const validDecisionRecord = makeValidRecord(packet.decision_record_template);
const validDecisionRecordFile = path.join(tempDir, "valid-decision-record-for-followup-negative.json");
fs.writeFileSync(validDecisionRecordFile, `${JSON.stringify(validDecisionRecord, null, 2)}\n`);
const packetAfterDecision = runPacket(["--decision-record", validDecisionRecordFile], {
  label: "valid decision record for follow-up negative guard",
});
assert(
  packetAfterDecision.current_next_required_gate?.id === "macro_owner_decision_followup_record",
  `expected follow-up gate after valid decision record: ${packetAfterDecision.current_next_required_gate?.id}`,
);
assert(
  JSON.stringify(packetAfterDecision.current_next_required_gate.required_evidence_detail_surface) === JSON.stringify(selectDecisionFollowup(packetAfterDecision).required_evidence_detail_surface),
  "decision follow-up current gate evidence detail surface must match selected template",
);
assertBlockedActions(
  "macro owner decision follow-up current gate blocked actions",
  packetAfterDecision.current_next_required_gate?.blocked_actions,
);
assertReportingSummaryCurrentSafeSlice(packetAfterDecision);
assertReportingSummaryCurrentGateChecklist(packetAfterDecision);
const badDecisionFollowupBlockedActionsRecord = makeValidRecord(selectDecisionFollowup(packetAfterDecision));
badDecisionFollowupBlockedActionsRecord.blocked_actions = ["delete", "redirect", "deploy"];
const badDecisionFollowupBlockedActionsFile = path.join(tempDir, "bad-decision-followup-blocked-actions.json");
fs.writeFileSync(badDecisionFollowupBlockedActionsFile, `${JSON.stringify(badDecisionFollowupBlockedActionsRecord, null, 2)}\n`);
const negativeDecisionFollowupBlockedActions = runPacket(
  ["--decision-record", validDecisionRecordFile, "--decision-followup-record", badDecisionFollowupBlockedActionsFile],
  {
    expectFailure: true,
    label: "negative decision follow-up blocked actions",
  },
);
const negativeDecisionFollowupBlockedActionsOutput = `${negativeDecisionFollowupBlockedActions.stderr}\n${negativeDecisionFollowupBlockedActions.stdout}`;
assert(
  negativeDecisionFollowupBlockedActionsOutput.includes("blocked actions"),
  "negative guard did not report decision follow-up blocked-actions validation",
);
const badDecisionFollowupEvidenceDetailRecord = makeValidRecord(selectDecisionFollowup(packetAfterDecision));
badDecisionFollowupEvidenceDetailRecord.required_evidence_detail_surface.required_local_live_equivalence_row_paths = [];
const badDecisionFollowupEvidenceDetailFile = path.join(tempDir, "bad-decision-followup-evidence-detail.json");
fs.writeFileSync(badDecisionFollowupEvidenceDetailFile, `${JSON.stringify(badDecisionFollowupEvidenceDetailRecord, null, 2)}\n`);
const negativeDecisionFollowupEvidenceDetail = runPacket(
  ["--decision-record", validDecisionRecordFile, "--decision-followup-record", badDecisionFollowupEvidenceDetailFile],
  {
    expectFailure: true,
    label: "negative decision follow-up evidence detail",
  },
);
const negativeDecisionFollowupEvidenceDetailOutput = `${negativeDecisionFollowupEvidenceDetail.stderr}\n${negativeDecisionFollowupEvidenceDetail.stdout}`;
assert(
  negativeDecisionFollowupEvidenceDetailOutput.includes("required_evidence_detail_surface"),
  "negative guard did not report decision follow-up evidence-detail validation",
);
const validDecisionFollowupRecord = makeValidRecord(selectDecisionFollowup(packetAfterDecision));
const validDecisionFollowupRecordFile = path.join(tempDir, "valid-decision-followup-record-for-rank2-pre-activation-negative.json");
fs.writeFileSync(validDecisionFollowupRecordFile, `${JSON.stringify(validDecisionFollowupRecord, null, 2)}\n`);
const packetAfterDecisionFollowup = runPacket(
  ["--decision-record", validDecisionRecordFile, "--decision-followup-record", validDecisionFollowupRecordFile],
  {
    label: "valid decision follow-up record for rank2 pre-activation negative guard",
  },
);
assert(
  packetAfterDecisionFollowup.current_next_required_gate?.id === "rank2_pre_activation_local_smoke_record",
  `expected rank2 pre-activation gate after valid follow-up record: ${packetAfterDecisionFollowup.current_next_required_gate?.id}`,
);
assert(
  JSON.stringify(packetAfterDecisionFollowup.current_next_required_gate.required_evidence_detail_surface) === JSON.stringify(packetAfterDecisionFollowup.inactive_next_candidate_preview.live_equivalence_prep.record_template.required_evidence_detail_surface),
  "rank2 pre-activation current gate evidence detail surface must match inactive candidate template",
);
assertReportingSummaryCurrentSafeSlice(packetAfterDecisionFollowup);
assertReportingSummaryCurrentGateChecklist(packetAfterDecisionFollowup);
const badRank2PreActivationEvidenceDetailRecord = makeValidRecord(packetAfterDecisionFollowup.inactive_next_candidate_preview.live_equivalence_prep.record_template);
badRank2PreActivationEvidenceDetailRecord.required_evidence_detail_surface.required_row_paths = [];
const badRank2PreActivationEvidenceDetailFile = path.join(tempDir, "bad-rank2-pre-activation-evidence-detail.json");
fs.writeFileSync(badRank2PreActivationEvidenceDetailFile, `${JSON.stringify(badRank2PreActivationEvidenceDetailRecord, null, 2)}\n`);
const negativeRank2PreActivationEvidenceDetail = runPacket(
  [
    "--decision-record",
    validDecisionRecordFile,
    "--decision-followup-record",
    validDecisionFollowupRecordFile,
    "--rank2-pre-activation-record",
    badRank2PreActivationEvidenceDetailFile,
  ],
  {
    expectFailure: true,
    label: "negative rank2 pre-activation evidence detail",
  },
);
const negativeRank2PreActivationEvidenceDetailOutput = `${negativeRank2PreActivationEvidenceDetail.stderr}\n${negativeRank2PreActivationEvidenceDetail.stdout}`;
assert(
  negativeRank2PreActivationEvidenceDetailOutput.includes("required_evidence_detail_surface"),
  "negative guard did not report rank2 pre-activation evidence-detail validation",
);
const validRank2PreActivationRecord = makeValidRecord(packetAfterDecisionFollowup.inactive_next_candidate_preview.live_equivalence_prep.record_template);
const validRank2PreActivationRecordFile = path.join(tempDir, "valid-rank2-pre-activation-record-for-owner-blocker-negative.json");
fs.writeFileSync(validRank2PreActivationRecordFile, `${JSON.stringify(validRank2PreActivationRecord, null, 2)}\n`);
const packetAfterRank2PreActivation = runPacket(
  [
    "--decision-record",
    validDecisionRecordFile,
    "--decision-followup-record",
    validDecisionFollowupRecordFile,
    "--rank2-pre-activation-record",
    validRank2PreActivationRecordFile,
  ],
  {
    label: "valid rank2 pre-activation record for owner blocker negative guard",
  },
);
assert(
  packetAfterRank2PreActivation.current_next_required_gate?.id === "rank2_owner_decision_record",
  `expected rank2 owner decision gate after valid pre-activation record: ${packetAfterRank2PreActivation.current_next_required_gate?.id}`,
);
assertExactBlockedActions(
  "rank2 review readiness",
  packetAfterRank2PreActivation.rank2_review_readiness.blocked_actions,
  routePatchBlockedActions,
);
assertExactBlockedActions(
  "rank2 owner review template",
  packetAfterRank2PreActivation.rank2_owner_review_template.blocked_actions,
  routePatchBlockedActions,
);
assertExactBlockedActions(
  "rank2 owner decision template",
  packetAfterRank2PreActivation.rank2_owner_review_template.decision_record_template.blocked_actions,
  routePatchBlockedActions,
);
for (const option of packetAfterRank2PreActivation.rank2_owner_review_template.decision_options ?? []) {
  assertExactBlockedActions(`rank2 owner decision option ${option.decision}`, option.blocked_actions, routePatchBlockedActions);
}
assertReportingSummaryCurrentSafeSlice(packetAfterRank2PreActivation);
assertReportingSummaryCurrentGateChecklist(packetAfterRank2PreActivation);
const badRank2OwnerDecisionBlockedActionsRecord = makeValidRecord(packetAfterRank2PreActivation.rank2_owner_review_template.decision_record_template);
badRank2OwnerDecisionBlockedActionsRecord.blocked_actions = defaultBlockedActions;
const badRank2OwnerDecisionBlockedActionsFile = path.join(tempDir, "bad-rank2-owner-decision-blocked-actions.json");
fs.writeFileSync(badRank2OwnerDecisionBlockedActionsFile, `${JSON.stringify(badRank2OwnerDecisionBlockedActionsRecord, null, 2)}\n`);
const negativeRank2OwnerDecisionBlockedActions = runPacket(
  [
    "--decision-record",
    validDecisionRecordFile,
    "--decision-followup-record",
    validDecisionFollowupRecordFile,
    "--rank2-pre-activation-record",
    validRank2PreActivationRecordFile,
    "--rank2-owner-decision-record",
    badRank2OwnerDecisionBlockedActionsFile,
  ],
  {
    expectFailure: true,
    label: "negative rank2 owner decision blocked actions",
  },
);
const negativeRank2OwnerDecisionBlockedActionsOutput = `${negativeRank2OwnerDecisionBlockedActions.stderr}\n${negativeRank2OwnerDecisionBlockedActions.stdout}`;
assert(
  negativeRank2OwnerDecisionBlockedActionsOutput.includes("blocked actions"),
  "negative guard did not report rank2 owner decision blocked-action validation",
);
console.log(
  `[macro-owner-fresh-closeout-chain] default PRO/safe-slice guard OK rows=${packet.evidence.local_live_equivalence_rows_checked}/${packet.evidence.local_live_equivalence_rows_expected} slices=${packet.safe_enforcement_slices.length}`,
);
console.log("[macro-owner-fresh-closeout-chain] negative guard OK missing_decision_reporting_summary_acknowledgement=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK stale_decision_reporting_summary_acknowledgement=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK missing_decision_safe_enforcement_slice_acknowledgement=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK stale_decision_safe_enforcement_slice_blocked_actions=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK stale_decision_safe_enforcement_slice_evidence_detail=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK mismatched_decision_followup_selection=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK decision_execution_allowed=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK decision_execution_by_this_command_allowed=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK decision_followup_blocked_actions=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK decision_followup_evidence_detail=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK rank2_pre_activation_evidence_detail=true");
console.log("[macro-owner-fresh-closeout-chain] negative guard OK rank2_owner_decision_blocked_actions=true");

for (const [index, step] of steps.entries()) {
  const template = step.select(packet);
  assert(template, `${step.label} template missing`);
  const record = makeValidRecord(template);
  const file = path.join(tempDir, `${String(index + 1).padStart(2, "0")}-${step.label}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  records.push({ flag: step.flag, file, label: step.label });
  packet = runPacket(recordArgs(records), { label: step.label });
  assertReportingSummaryCurrentSafeSlice(packet);
  assertReportingSummaryCurrentGateChecklist(packet);
  if (step.label === "rank2-owner-followup") {
    assert(
      packet.current_next_required_gate?.id === "rank2_mutation_approval_record",
      `expected mutation approval record gate after rank2 owner followup: ${packet.current_next_required_gate?.id}`,
    );
    assertExactBlockedActions(
      "rank2 mutation approval current gate",
      packet.current_next_required_gate.blocked_actions,
      routePatchBlockedActions,
    );
    assertExactBlockedActions(
      "rank2 mutation approval request template",
      packet.rank2_mutation_approval_request_template.blocked_actions,
      routePatchBlockedActions,
    );
    assertExactBlockedActions(
      "rank2 mutation approval record template",
      packet.rank2_mutation_approval_record_template.blocked_actions,
      routePatchBlockedActions,
    );
    const badRank2MutationApprovalBlockedActionsRecord = makeValidRecord(packet.rank2_mutation_approval_record_template);
    badRank2MutationApprovalBlockedActionsRecord.blocked_actions = defaultBlockedActions;
    const badRank2MutationApprovalBlockedActionsFile = path.join(tempDir, "bad-rank2-mutation-approval-blocked-actions.json");
    fs.writeFileSync(badRank2MutationApprovalBlockedActionsFile, `${JSON.stringify(badRank2MutationApprovalBlockedActionsRecord, null, 2)}\n`);
    const negativeRank2MutationApprovalBlockedActions = runPacket(
      [
        ...recordArgs(records),
        "--rank2-mutation-approval-record",
        badRank2MutationApprovalBlockedActionsFile,
      ],
      {
        expectFailure: true,
        label: "negative rank2 mutation approval blocked actions",
      },
    );
    const negativeRank2MutationApprovalBlockedActionsOutput = `${negativeRank2MutationApprovalBlockedActions.stderr}\n${negativeRank2MutationApprovalBlockedActions.stdout}`;
    assert(
      negativeRank2MutationApprovalBlockedActionsOutput.includes("blocked actions"),
      "negative guard did not report rank2 mutation approval blocked-action validation",
    );
    console.log("[macro-owner-fresh-closeout-chain] negative guard OK rank2_mutation_approval_blocked_actions=true");
  }
  if (step.label === "rank2-mutation-approval") {
    assert(
      packet.current_next_required_gate?.id === "rank2_route_diff_proposal_record",
      `expected route diff proposal gate after rank2 mutation approval: ${packet.current_next_required_gate?.id}`,
    );
    assertExactBlockedActions(
      "rank2 route diff proposal current gate",
      packet.current_next_required_gate.blocked_actions,
      routePatchBlockedActions,
    );
    assertExactBlockedActions(
      "rank2 route diff proposal template",
      packet.rank2_route_diff_proposal_template.blocked_actions,
      routePatchBlockedActions,
    );
    const badRank2RouteDiffBlockedActionsRecord = makeValidRecord(packet.rank2_route_diff_proposal_template);
    badRank2RouteDiffBlockedActionsRecord.blocked_actions = defaultBlockedActions;
    const badRank2RouteDiffBlockedActionsFile = path.join(tempDir, "bad-rank2-route-diff-blocked-actions.json");
    fs.writeFileSync(badRank2RouteDiffBlockedActionsFile, `${JSON.stringify(badRank2RouteDiffBlockedActionsRecord, null, 2)}\n`);
    const negativeRank2RouteDiffBlockedActions = runPacket(
      [
        ...recordArgs(records),
        "--rank2-route-diff-proposal",
        badRank2RouteDiffBlockedActionsFile,
      ],
      {
        expectFailure: true,
        label: "negative rank2 route diff blocked actions",
      },
    );
    const negativeRank2RouteDiffBlockedActionsOutput = `${negativeRank2RouteDiffBlockedActions.stderr}\n${negativeRank2RouteDiffBlockedActions.stdout}`;
    assert(
      negativeRank2RouteDiffBlockedActionsOutput.includes("blocked actions"),
      "negative guard did not report rank2 route diff blocked-action validation",
    );
    console.log("[macro-owner-fresh-closeout-chain] negative guard OK rank2_route_diff_blocked_actions=true");
  }
  if (step.label === "rank2-route-diff-proposal") {
    assertExactBlockedActions(
      "rank2 rollback plan current gate",
      packet.current_next_required_gate.blocked_actions,
      routePatchBlockedActions,
    );
    assertExactBlockedActions(
      "rank2 rollback plan template",
      packet.rank2_rollback_plan_template.blocked_actions,
      routePatchBlockedActions,
    );
  }
  if (step.label === "rank2-rollback-plan") {
    assertExactBlockedActions(
      "rank2 local post-patch smoke plan current gate",
      packet.current_next_required_gate.blocked_actions,
      routePatchBlockedActions,
    );
    assertExactBlockedActions(
      "rank2 local post-patch smoke plan template",
      packet.rank2_local_post_patch_smoke_plan_template.blocked_actions,
      routePatchBlockedActions,
    );
  }
  if (step.label === "rank2-local-post-patch-smoke-plan") {
    assertExactBlockedActions(
      "rank2 explicit deploy approval current gate",
      packet.current_next_required_gate.blocked_actions,
      routePatchBlockedActions,
    );
    assertExactBlockedActions(
      "rank2 explicit deploy approval template",
      packet.rank2_explicit_deploy_approval_template.blocked_actions,
      routePatchBlockedActions,
    );
  }
  if (step.label === "rank2-explicit-deploy-approval") {
    assertExactBlockedActions(
      "rank2 execution readiness",
      packet.rank2_execution_readiness.blocked_actions,
      routePatchBlockedActions,
    );
  }
}

assertExactBlockedActions(
  "rank2 mutation approval readiness",
  packet.rank2_mutation_approval_readiness.blocked_actions,
  routePatchBlockedActions,
);
assert(
  packet.current_next_required_gate?.id === "rank2_fresh_owner_record_chain_closed",
  `unexpected final gate: ${packet.current_next_required_gate?.id}`,
);
assert(
  packet.current_next_required_gate?.status === "fresh_owner_record_chain_closed_no_additional_runtime",
  `unexpected final gate status: ${packet.current_next_required_gate?.status}`,
);
assert(
  packet.rank2_fresh_owner_owner_closeout_record_status === "valid_fresh_owner_owner_closeout_recorded",
  `unexpected closeout status: ${packet.rank2_fresh_owner_owner_closeout_record_status}`,
);

const closeoutRecord = JSON.parse(fs.readFileSync(records.at(-1).file, "utf8"));
closeoutRecord.additional_runtime_required = true;
const badCloseoutFile = path.join(tempDir, "bad-rank2-fresh-owner-owner-closeout.json");
fs.writeFileSync(badCloseoutFile, `${JSON.stringify(closeoutRecord, null, 2)}\n`);

const negative = runPacket(
  [
    ...recordArgs(records.slice(0, -1)),
    records.at(-1).flag,
    badCloseoutFile,
  ],
  {
    expectFailure: true,
    label: "negative additional_runtime_required=true",
  },
);

const negativeOutput = `${negative.stderr}\n${negative.stdout}`;
assert(
  negativeOutput.includes("rank2 fresh owner owner closeout"),
  "negative guard did not report rank2 fresh owner owner closeout validation",
);

console.log(
  `[macro-owner-fresh-closeout-chain] full synthetic chain OK gate=${packet.current_next_required_gate.id} status=${packet.rank2_fresh_owner_owner_closeout_record_status}`,
);
console.log("[macro-owner-fresh-closeout-chain] negative guard OK additional_runtime_required=true");
fs.rmSync(tempDir, { recursive: true, force: true });
