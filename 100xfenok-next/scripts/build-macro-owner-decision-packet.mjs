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
const PRODUCTION_WORKER_BASE_URL = "https://100xfenok.etloveaui.workers.dev";

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
    rank2OwnerDecisionRecordTemplate: false,
    rank2OwnerFollowupRecordTemplate: false,
    rank2MutationApprovalRequestTemplate: false,
    rank2MutationApprovalRecordTemplate: false,
    rank2RouteDiffProposalTemplate: false,
    rank2RollbackPlanTemplate: false,
    rank2LocalPostPatchSmokePlanTemplate: false,
    rank2ExplicitDeployApprovalTemplate: false,
    rank2RouteExecutionPacketTemplate: false,
    rank2OwnerRuntimeReleaseTemplate: false,
    rank2RoutePatchApplicationTemplate: false,
    rank2LocalPostPatchSmokeRecordTemplate: false,
    rank2DeployExecutionTemplate: false,
    rank2ProductionLiveSmokeTemplate: false,
    rank2PostLiveRedirectDeleteApprovalRequestTemplate: false,
    rank2PostLiveRedirectDeleteApprovalRecordTemplate: false,
    rank2PostLiveRedirectDeleteExecutionPacketTemplate: false,
    rank2PostLiveRedirectDeleteExecutionRecordTemplate: false,
    rank2PostLiveRedirectDeletePostExecutionSmokeTemplate: false,
    rank2PostLiveRedirectDeleteRollbackReadinessTemplate: false,
    rank2PostLiveRedirectDeleteOwnerCloseoutTemplate: false,
    rank2FreshOwnerRuntimePacketTemplate: false,
    rank2FreshOwnerRuntimeExecutionPacketTemplate: false,
    rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate: false,
    rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate: false,
    rank2FreshOwnerRollbackReadinessTemplate: false,
    rank2FreshOwnerOwnerCloseoutTemplate: false,
    decisionRecordJson: null,
    decisionRecordPath: null,
    decisionFollowupRecordTemplate: false,
    decisionFollowupRecordJson: null,
    decisionFollowupRecordPath: null,
    rank2PreActivationRecordJson: null,
    rank2PreActivationRecordPath: null,
    rank2OwnerDecisionRecordJson: null,
    rank2OwnerDecisionRecordPath: null,
    rank2OwnerFollowupRecordJson: null,
    rank2OwnerFollowupRecordPath: null,
    rank2MutationApprovalRecordJson: null,
    rank2MutationApprovalRecordPath: null,
    rank2RouteDiffProposalRecordJson: null,
    rank2RouteDiffProposalRecordPath: null,
    rank2RollbackPlanRecordJson: null,
    rank2RollbackPlanRecordPath: null,
    rank2LocalPostPatchSmokePlanRecordJson: null,
    rank2LocalPostPatchSmokePlanRecordPath: null,
    rank2ExplicitDeployApprovalRecordJson: null,
    rank2ExplicitDeployApprovalRecordPath: null,
    rank2RouteExecutionPacketRecordJson: null,
    rank2RouteExecutionPacketRecordPath: null,
    rank2OwnerRuntimeReleaseRecordJson: null,
    rank2OwnerRuntimeReleaseRecordPath: null,
    rank2RoutePatchApplicationRecordJson: null,
    rank2RoutePatchApplicationRecordPath: null,
    rank2LocalPostPatchSmokeRecordJson: null,
    rank2LocalPostPatchSmokeRecordPath: null,
    rank2DeployExecutionRecordJson: null,
    rank2DeployExecutionRecordPath: null,
    rank2ProductionLiveSmokeRecordJson: null,
    rank2ProductionLiveSmokeRecordPath: null,
    rank2PostLiveRedirectDeleteApprovalRequestRecordJson: null,
    rank2PostLiveRedirectDeleteApprovalRequestRecordPath: null,
    rank2PostLiveRedirectDeleteApprovalRecordJson: null,
    rank2PostLiveRedirectDeleteApprovalRecordPath: null,
    rank2PostLiveRedirectDeleteExecutionPacketRecordJson: null,
    rank2PostLiveRedirectDeleteExecutionPacketRecordPath: null,
    rank2PostLiveRedirectDeleteExecutionRecordJson: null,
    rank2PostLiveRedirectDeleteExecutionRecordPath: null,
    rank2PostLiveRedirectDeletePostExecutionSmokeRecordJson: null,
    rank2PostLiveRedirectDeletePostExecutionSmokeRecordPath: null,
    rank2PostLiveRedirectDeleteRollbackReadinessRecordJson: null,
    rank2PostLiveRedirectDeleteRollbackReadinessRecordPath: null,
    rank2PostLiveRedirectDeleteOwnerCloseoutRecordJson: null,
    rank2PostLiveRedirectDeleteOwnerCloseoutRecordPath: null,
    rank2FreshOwnerRuntimePacketRecordJson: null,
    rank2FreshOwnerRuntimePacketRecordPath: null,
    rank2FreshOwnerRuntimeExecutionPacketRecordJson: null,
    rank2FreshOwnerRuntimeExecutionPacketRecordPath: null,
    rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordJson: null,
    rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordPath: null,
    rank2FreshOwnerPostRuntimeSmokeEvidenceRecordJson: null,
    rank2FreshOwnerPostRuntimeSmokeEvidenceRecordPath: null,
    rank2FreshOwnerRollbackReadinessRecordJson: null,
    rank2FreshOwnerRollbackReadinessRecordPath: null,
    rank2FreshOwnerOwnerCloseoutRecordJson: null,
    rank2FreshOwnerOwnerCloseoutRecordPath: null,
    reportingSummary: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--reporting-summary") {
      args.reportingSummary = true;
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
    if (arg === "--rank2-owner-decision-record-template") {
      args.rank2OwnerDecisionRecordTemplate = true;
      continue;
    }
    if (arg === "--rank2-owner-followup-record-template") {
      args.rank2OwnerFollowupRecordTemplate = true;
      continue;
    }
    if (arg === "--rank2-mutation-approval-request-template") {
      args.rank2MutationApprovalRequestTemplate = true;
      continue;
    }
    if (arg === "--rank2-mutation-approval-record-template") {
      args.rank2MutationApprovalRecordTemplate = true;
      continue;
    }
    if (arg === "--rank2-route-diff-proposal-template") {
      args.rank2RouteDiffProposalTemplate = true;
      continue;
    }
    if (arg === "--rank2-rollback-plan-template") {
      args.rank2RollbackPlanTemplate = true;
      continue;
    }
    if (arg === "--rank2-local-post-patch-smoke-plan-template") {
      args.rank2LocalPostPatchSmokePlanTemplate = true;
      continue;
    }
    if (arg === "--rank2-explicit-deploy-approval-template") {
      args.rank2ExplicitDeployApprovalTemplate = true;
      continue;
    }
    if (arg === "--rank2-route-execution-packet-template") {
      args.rank2RouteExecutionPacketTemplate = true;
      continue;
    }
    if (arg === "--rank2-owner-runtime-release-template") {
      args.rank2OwnerRuntimeReleaseTemplate = true;
      continue;
    }
    if (arg === "--rank2-route-patch-application-template") {
      args.rank2RoutePatchApplicationTemplate = true;
      continue;
    }
    if (arg === "--rank2-local-post-patch-smoke-record-template") {
      args.rank2LocalPostPatchSmokeRecordTemplate = true;
      continue;
    }
    if (arg === "--rank2-deploy-execution-template") {
      args.rank2DeployExecutionTemplate = true;
      continue;
    }
    if (arg === "--rank2-production-live-smoke-template") {
      args.rank2ProductionLiveSmokeTemplate = true;
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-approval-request-template") {
      args.rank2PostLiveRedirectDeleteApprovalRequestTemplate = true;
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-approval-record-template") {
      args.rank2PostLiveRedirectDeleteApprovalRecordTemplate = true;
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-execution-packet-template") {
      args.rank2PostLiveRedirectDeleteExecutionPacketTemplate = true;
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-execution-record-template") {
      args.rank2PostLiveRedirectDeleteExecutionRecordTemplate = true;
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-post-execution-smoke-template") {
      args.rank2PostLiveRedirectDeletePostExecutionSmokeTemplate = true;
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-rollback-readiness-template") {
      args.rank2PostLiveRedirectDeleteRollbackReadinessTemplate = true;
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-owner-closeout-template") {
      args.rank2PostLiveRedirectDeleteOwnerCloseoutTemplate = true;
      continue;
    }
    if (arg === "--rank2-fresh-owner-runtime-packet-template") {
      args.rank2FreshOwnerRuntimePacketTemplate = true;
      continue;
    }
    if (arg === "--rank2-fresh-owner-runtime-execution-packet-template") {
      args.rank2FreshOwnerRuntimeExecutionPacketTemplate = true;
      continue;
    }
    if (arg === "--rank2-fresh-owner-external-runtime-execution-evidence-template") {
      args.rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate = true;
      continue;
    }
    if (arg === "--rank2-fresh-owner-post-runtime-smoke-evidence-template") {
      args.rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate = true;
      continue;
    }
    if (arg === "--rank2-fresh-owner-rollback-readiness-template") {
      args.rank2FreshOwnerRollbackReadinessTemplate = true;
      continue;
    }
    if (arg === "--rank2-fresh-owner-owner-closeout-template") {
      args.rank2FreshOwnerOwnerCloseoutTemplate = true;
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
    if (arg === "--rank2-owner-decision-record") {
      args.rank2OwnerDecisionRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-owner-decision-record=")) {
      args.rank2OwnerDecisionRecordPath = requireInlineValue(arg, "--rank2-owner-decision-record=", "--rank2-owner-decision-record");
      continue;
    }
    if (arg === "--rank2-owner-decision-record-json") {
      args.rank2OwnerDecisionRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-owner-decision-record-json=")) {
      args.rank2OwnerDecisionRecordJson = requireInlineValue(arg, "--rank2-owner-decision-record-json=", "--rank2-owner-decision-record-json");
      continue;
    }
    if (arg === "--rank2-owner-followup-record") {
      args.rank2OwnerFollowupRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-owner-followup-record=")) {
      args.rank2OwnerFollowupRecordPath = requireInlineValue(arg, "--rank2-owner-followup-record=", "--rank2-owner-followup-record");
      continue;
    }
    if (arg === "--rank2-owner-followup-record-json") {
      args.rank2OwnerFollowupRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-owner-followup-record-json=")) {
      args.rank2OwnerFollowupRecordJson = requireInlineValue(arg, "--rank2-owner-followup-record-json=", "--rank2-owner-followup-record-json");
      continue;
    }
    if (arg === "--rank2-mutation-approval-record") {
      args.rank2MutationApprovalRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-mutation-approval-record=")) {
      args.rank2MutationApprovalRecordPath = requireInlineValue(arg, "--rank2-mutation-approval-record=", "--rank2-mutation-approval-record");
      continue;
    }
    if (arg === "--rank2-mutation-approval-record-json") {
      args.rank2MutationApprovalRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-mutation-approval-record-json=")) {
      args.rank2MutationApprovalRecordJson = requireInlineValue(arg, "--rank2-mutation-approval-record-json=", "--rank2-mutation-approval-record-json");
      continue;
    }
    if (arg === "--rank2-route-diff-proposal") {
      args.rank2RouteDiffProposalRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-route-diff-proposal=")) {
      args.rank2RouteDiffProposalRecordPath = requireInlineValue(arg, "--rank2-route-diff-proposal=", "--rank2-route-diff-proposal");
      continue;
    }
    if (arg === "--rank2-route-diff-proposal-json") {
      args.rank2RouteDiffProposalRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-route-diff-proposal-json=")) {
      args.rank2RouteDiffProposalRecordJson = requireInlineValue(arg, "--rank2-route-diff-proposal-json=", "--rank2-route-diff-proposal-json");
      continue;
    }
    if (arg === "--rank2-rollback-plan") {
      args.rank2RollbackPlanRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-rollback-plan=")) {
      args.rank2RollbackPlanRecordPath = requireInlineValue(arg, "--rank2-rollback-plan=", "--rank2-rollback-plan");
      continue;
    }
    if (arg === "--rank2-rollback-plan-json") {
      args.rank2RollbackPlanRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-rollback-plan-json=")) {
      args.rank2RollbackPlanRecordJson = requireInlineValue(arg, "--rank2-rollback-plan-json=", "--rank2-rollback-plan-json");
      continue;
    }
    if (arg === "--rank2-local-post-patch-smoke-plan") {
      args.rank2LocalPostPatchSmokePlanRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-local-post-patch-smoke-plan=")) {
      args.rank2LocalPostPatchSmokePlanRecordPath = requireInlineValue(arg, "--rank2-local-post-patch-smoke-plan=", "--rank2-local-post-patch-smoke-plan");
      continue;
    }
    if (arg === "--rank2-local-post-patch-smoke-plan-json") {
      args.rank2LocalPostPatchSmokePlanRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-local-post-patch-smoke-plan-json=")) {
      args.rank2LocalPostPatchSmokePlanRecordJson = requireInlineValue(arg, "--rank2-local-post-patch-smoke-plan-json=", "--rank2-local-post-patch-smoke-plan-json");
      continue;
    }
    if (arg === "--rank2-explicit-deploy-approval") {
      args.rank2ExplicitDeployApprovalRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-explicit-deploy-approval=")) {
      args.rank2ExplicitDeployApprovalRecordPath = requireInlineValue(arg, "--rank2-explicit-deploy-approval=", "--rank2-explicit-deploy-approval");
      continue;
    }
    if (arg === "--rank2-explicit-deploy-approval-json") {
      args.rank2ExplicitDeployApprovalRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-explicit-deploy-approval-json=")) {
      args.rank2ExplicitDeployApprovalRecordJson = requireInlineValue(arg, "--rank2-explicit-deploy-approval-json=", "--rank2-explicit-deploy-approval-json");
      continue;
    }
    if (arg === "--rank2-route-execution-packet") {
      args.rank2RouteExecutionPacketRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-route-execution-packet=")) {
      args.rank2RouteExecutionPacketRecordPath = requireInlineValue(arg, "--rank2-route-execution-packet=", "--rank2-route-execution-packet");
      continue;
    }
    if (arg === "--rank2-route-execution-packet-json") {
      args.rank2RouteExecutionPacketRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-route-execution-packet-json=")) {
      args.rank2RouteExecutionPacketRecordJson = requireInlineValue(arg, "--rank2-route-execution-packet-json=", "--rank2-route-execution-packet-json");
      continue;
    }
    if (arg === "--rank2-owner-runtime-release") {
      args.rank2OwnerRuntimeReleaseRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-owner-runtime-release=")) {
      args.rank2OwnerRuntimeReleaseRecordPath = requireInlineValue(arg, "--rank2-owner-runtime-release=", "--rank2-owner-runtime-release");
      continue;
    }
    if (arg === "--rank2-owner-runtime-release-json") {
      args.rank2OwnerRuntimeReleaseRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-owner-runtime-release-json=")) {
      args.rank2OwnerRuntimeReleaseRecordJson = requireInlineValue(arg, "--rank2-owner-runtime-release-json=", "--rank2-owner-runtime-release-json");
      continue;
    }
    if (arg === "--rank2-route-patch-application") {
      args.rank2RoutePatchApplicationRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-route-patch-application=")) {
      args.rank2RoutePatchApplicationRecordPath = requireInlineValue(arg, "--rank2-route-patch-application=", "--rank2-route-patch-application");
      continue;
    }
    if (arg === "--rank2-route-patch-application-json") {
      args.rank2RoutePatchApplicationRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-route-patch-application-json=")) {
      args.rank2RoutePatchApplicationRecordJson = requireInlineValue(arg, "--rank2-route-patch-application-json=", "--rank2-route-patch-application-json");
      continue;
    }
    if (arg === "--rank2-local-post-patch-smoke-record") {
      args.rank2LocalPostPatchSmokeRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-local-post-patch-smoke-record=")) {
      args.rank2LocalPostPatchSmokeRecordPath = requireInlineValue(arg, "--rank2-local-post-patch-smoke-record=", "--rank2-local-post-patch-smoke-record");
      continue;
    }
    if (arg === "--rank2-local-post-patch-smoke-record-json") {
      args.rank2LocalPostPatchSmokeRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-local-post-patch-smoke-record-json=")) {
      args.rank2LocalPostPatchSmokeRecordJson = requireInlineValue(arg, "--rank2-local-post-patch-smoke-record-json=", "--rank2-local-post-patch-smoke-record-json");
      continue;
    }
    if (arg === "--rank2-deploy-execution") {
      args.rank2DeployExecutionRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-deploy-execution=")) {
      args.rank2DeployExecutionRecordPath = requireInlineValue(arg, "--rank2-deploy-execution=", "--rank2-deploy-execution");
      continue;
    }
    if (arg === "--rank2-deploy-execution-json") {
      args.rank2DeployExecutionRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-deploy-execution-json=")) {
      args.rank2DeployExecutionRecordJson = requireInlineValue(arg, "--rank2-deploy-execution-json=", "--rank2-deploy-execution-json");
      continue;
    }
    if (arg === "--rank2-production-live-smoke") {
      args.rank2ProductionLiveSmokeRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-production-live-smoke=")) {
      args.rank2ProductionLiveSmokeRecordPath = requireInlineValue(arg, "--rank2-production-live-smoke=", "--rank2-production-live-smoke");
      continue;
    }
    if (arg === "--rank2-production-live-smoke-json") {
      args.rank2ProductionLiveSmokeRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-production-live-smoke-json=")) {
      args.rank2ProductionLiveSmokeRecordJson = requireInlineValue(arg, "--rank2-production-live-smoke-json=", "--rank2-production-live-smoke-json");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-approval-request") {
      args.rank2PostLiveRedirectDeleteApprovalRequestRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-approval-request=")) {
      args.rank2PostLiveRedirectDeleteApprovalRequestRecordPath = requireInlineValue(arg, "--rank2-post-live-redirect-delete-approval-request=", "--rank2-post-live-redirect-delete-approval-request");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-approval-request-json") {
      args.rank2PostLiveRedirectDeleteApprovalRequestRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-approval-request-json=")) {
      args.rank2PostLiveRedirectDeleteApprovalRequestRecordJson = requireInlineValue(arg, "--rank2-post-live-redirect-delete-approval-request-json=", "--rank2-post-live-redirect-delete-approval-request-json");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-approval-record") {
      args.rank2PostLiveRedirectDeleteApprovalRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-approval-record=")) {
      args.rank2PostLiveRedirectDeleteApprovalRecordPath = requireInlineValue(arg, "--rank2-post-live-redirect-delete-approval-record=", "--rank2-post-live-redirect-delete-approval-record");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-approval-record-json") {
      args.rank2PostLiveRedirectDeleteApprovalRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-approval-record-json=")) {
      args.rank2PostLiveRedirectDeleteApprovalRecordJson = requireInlineValue(arg, "--rank2-post-live-redirect-delete-approval-record-json=", "--rank2-post-live-redirect-delete-approval-record-json");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-execution-packet") {
      args.rank2PostLiveRedirectDeleteExecutionPacketRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-execution-packet=")) {
      args.rank2PostLiveRedirectDeleteExecutionPacketRecordPath = requireInlineValue(arg, "--rank2-post-live-redirect-delete-execution-packet=", "--rank2-post-live-redirect-delete-execution-packet");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-execution-packet-json") {
      args.rank2PostLiveRedirectDeleteExecutionPacketRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-execution-packet-json=")) {
      args.rank2PostLiveRedirectDeleteExecutionPacketRecordJson = requireInlineValue(arg, "--rank2-post-live-redirect-delete-execution-packet-json=", "--rank2-post-live-redirect-delete-execution-packet-json");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-execution-record") {
      args.rank2PostLiveRedirectDeleteExecutionRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-execution-record=")) {
      args.rank2PostLiveRedirectDeleteExecutionRecordPath = requireInlineValue(arg, "--rank2-post-live-redirect-delete-execution-record=", "--rank2-post-live-redirect-delete-execution-record");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-execution-record-json") {
      args.rank2PostLiveRedirectDeleteExecutionRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-execution-record-json=")) {
      args.rank2PostLiveRedirectDeleteExecutionRecordJson = requireInlineValue(arg, "--rank2-post-live-redirect-delete-execution-record-json=", "--rank2-post-live-redirect-delete-execution-record-json");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-post-execution-smoke") {
      args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-post-execution-smoke=")) {
      args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordPath = requireInlineValue(arg, "--rank2-post-live-redirect-delete-post-execution-smoke=", "--rank2-post-live-redirect-delete-post-execution-smoke");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-post-execution-smoke-json") {
      args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-post-execution-smoke-json=")) {
      args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordJson = requireInlineValue(arg, "--rank2-post-live-redirect-delete-post-execution-smoke-json=", "--rank2-post-live-redirect-delete-post-execution-smoke-json");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-rollback-readiness") {
      args.rank2PostLiveRedirectDeleteRollbackReadinessRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-rollback-readiness=")) {
      args.rank2PostLiveRedirectDeleteRollbackReadinessRecordPath = requireInlineValue(arg, "--rank2-post-live-redirect-delete-rollback-readiness=", "--rank2-post-live-redirect-delete-rollback-readiness");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-rollback-readiness-json") {
      args.rank2PostLiveRedirectDeleteRollbackReadinessRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-rollback-readiness-json=")) {
      args.rank2PostLiveRedirectDeleteRollbackReadinessRecordJson = requireInlineValue(arg, "--rank2-post-live-redirect-delete-rollback-readiness-json=", "--rank2-post-live-redirect-delete-rollback-readiness-json");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-owner-closeout") {
      args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-owner-closeout=")) {
      args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordPath = requireInlineValue(arg, "--rank2-post-live-redirect-delete-owner-closeout=", "--rank2-post-live-redirect-delete-owner-closeout");
      continue;
    }
    if (arg === "--rank2-post-live-redirect-delete-owner-closeout-json") {
      args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-post-live-redirect-delete-owner-closeout-json=")) {
      args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordJson = requireInlineValue(arg, "--rank2-post-live-redirect-delete-owner-closeout-json=", "--rank2-post-live-redirect-delete-owner-closeout-json");
      continue;
    }
    if (arg === "--rank2-fresh-owner-runtime-packet") {
      args.rank2FreshOwnerRuntimePacketRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-runtime-packet=")) {
      args.rank2FreshOwnerRuntimePacketRecordPath = requireInlineValue(arg, "--rank2-fresh-owner-runtime-packet=", "--rank2-fresh-owner-runtime-packet");
      continue;
    }
    if (arg === "--rank2-fresh-owner-runtime-packet-json") {
      args.rank2FreshOwnerRuntimePacketRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-runtime-packet-json=")) {
      args.rank2FreshOwnerRuntimePacketRecordJson = requireInlineValue(arg, "--rank2-fresh-owner-runtime-packet-json=", "--rank2-fresh-owner-runtime-packet-json");
      continue;
    }
    if (arg === "--rank2-fresh-owner-runtime-execution-packet") {
      args.rank2FreshOwnerRuntimeExecutionPacketRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-runtime-execution-packet=")) {
      args.rank2FreshOwnerRuntimeExecutionPacketRecordPath = requireInlineValue(arg, "--rank2-fresh-owner-runtime-execution-packet=", "--rank2-fresh-owner-runtime-execution-packet");
      continue;
    }
    if (arg === "--rank2-fresh-owner-runtime-execution-packet-json") {
      args.rank2FreshOwnerRuntimeExecutionPacketRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-runtime-execution-packet-json=")) {
      args.rank2FreshOwnerRuntimeExecutionPacketRecordJson = requireInlineValue(arg, "--rank2-fresh-owner-runtime-execution-packet-json=", "--rank2-fresh-owner-runtime-execution-packet-json");
      continue;
    }
    if (arg === "--rank2-fresh-owner-external-runtime-execution-evidence") {
      args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-external-runtime-execution-evidence=")) {
      args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordPath = requireInlineValue(arg, "--rank2-fresh-owner-external-runtime-execution-evidence=", "--rank2-fresh-owner-external-runtime-execution-evidence");
      continue;
    }
    if (arg === "--rank2-fresh-owner-external-runtime-execution-evidence-json") {
      args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-external-runtime-execution-evidence-json=")) {
      args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordJson = requireInlineValue(arg, "--rank2-fresh-owner-external-runtime-execution-evidence-json=", "--rank2-fresh-owner-external-runtime-execution-evidence-json");
      continue;
    }
    if (arg === "--rank2-fresh-owner-post-runtime-smoke-evidence") {
      args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-post-runtime-smoke-evidence=")) {
      args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordPath = requireInlineValue(arg, "--rank2-fresh-owner-post-runtime-smoke-evidence=", "--rank2-fresh-owner-post-runtime-smoke-evidence");
      continue;
    }
    if (arg === "--rank2-fresh-owner-post-runtime-smoke-evidence-json") {
      args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-post-runtime-smoke-evidence-json=")) {
      args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordJson = requireInlineValue(arg, "--rank2-fresh-owner-post-runtime-smoke-evidence-json=", "--rank2-fresh-owner-post-runtime-smoke-evidence-json");
      continue;
    }
    if (arg === "--rank2-fresh-owner-rollback-readiness") {
      args.rank2FreshOwnerRollbackReadinessRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-rollback-readiness=")) {
      args.rank2FreshOwnerRollbackReadinessRecordPath = requireInlineValue(arg, "--rank2-fresh-owner-rollback-readiness=", "--rank2-fresh-owner-rollback-readiness");
      continue;
    }
    if (arg === "--rank2-fresh-owner-rollback-readiness-json") {
      args.rank2FreshOwnerRollbackReadinessRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-rollback-readiness-json=")) {
      args.rank2FreshOwnerRollbackReadinessRecordJson = requireInlineValue(arg, "--rank2-fresh-owner-rollback-readiness-json=", "--rank2-fresh-owner-rollback-readiness-json");
      continue;
    }
    if (arg === "--rank2-fresh-owner-owner-closeout") {
      args.rank2FreshOwnerOwnerCloseoutRecordPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-owner-closeout=")) {
      args.rank2FreshOwnerOwnerCloseoutRecordPath = requireInlineValue(arg, "--rank2-fresh-owner-owner-closeout=", "--rank2-fresh-owner-owner-closeout");
      continue;
    }
    if (arg === "--rank2-fresh-owner-owner-closeout-json") {
      args.rank2FreshOwnerOwnerCloseoutRecordJson = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--rank2-fresh-owner-owner-closeout-json=")) {
      args.rank2FreshOwnerOwnerCloseoutRecordJson = requireInlineValue(arg, "--rank2-fresh-owner-owner-closeout-json=", "--rank2-fresh-owner-owner-closeout-json");
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
  if (args.rank2OwnerDecisionRecordJson && args.rank2OwnerDecisionRecordPath) {
    throw new Error("use only one rank2 owner decision record source: --rank2-owner-decision-record-json or --rank2-owner-decision-record");
  }
  if (args.rank2OwnerFollowupRecordJson && args.rank2OwnerFollowupRecordPath) {
    throw new Error("use only one rank2 owner followup record source: --rank2-owner-followup-record-json or --rank2-owner-followup-record");
  }
  if (args.rank2MutationApprovalRecordJson && args.rank2MutationApprovalRecordPath) {
    throw new Error("use only one rank2 mutation approval record source: --rank2-mutation-approval-record-json or --rank2-mutation-approval-record");
  }
  if (args.rank2RouteDiffProposalRecordJson && args.rank2RouteDiffProposalRecordPath) {
    throw new Error("use only one rank2 route diff proposal source: --rank2-route-diff-proposal-json or --rank2-route-diff-proposal");
  }
  if (args.rank2RollbackPlanRecordJson && args.rank2RollbackPlanRecordPath) {
    throw new Error("use only one rank2 rollback plan source: --rank2-rollback-plan-json or --rank2-rollback-plan");
  }
  if (args.rank2LocalPostPatchSmokePlanRecordJson && args.rank2LocalPostPatchSmokePlanRecordPath) {
    throw new Error("use only one rank2 local post-patch smoke plan source: --rank2-local-post-patch-smoke-plan-json or --rank2-local-post-patch-smoke-plan");
  }
  if (args.rank2ExplicitDeployApprovalRecordJson && args.rank2ExplicitDeployApprovalRecordPath) {
    throw new Error("use only one rank2 explicit deploy approval source: --rank2-explicit-deploy-approval-json or --rank2-explicit-deploy-approval");
  }
  if (args.rank2RouteExecutionPacketRecordJson && args.rank2RouteExecutionPacketRecordPath) {
    throw new Error("use only one rank2 route execution packet source: --rank2-route-execution-packet-json or --rank2-route-execution-packet");
  }
  if (args.rank2OwnerRuntimeReleaseRecordJson && args.rank2OwnerRuntimeReleaseRecordPath) {
    throw new Error("use only one rank2 owner runtime release source: --rank2-owner-runtime-release-json or --rank2-owner-runtime-release");
  }
  if (args.rank2RoutePatchApplicationRecordJson && args.rank2RoutePatchApplicationRecordPath) {
    throw new Error("use only one rank2 route patch application source: --rank2-route-patch-application-json or --rank2-route-patch-application");
  }
  if (args.rank2LocalPostPatchSmokeRecordJson && args.rank2LocalPostPatchSmokeRecordPath) {
    throw new Error("use only one rank2 local post-patch smoke record source: --rank2-local-post-patch-smoke-record-json or --rank2-local-post-patch-smoke-record");
  }
  if (args.rank2DeployExecutionRecordJson && args.rank2DeployExecutionRecordPath) {
    throw new Error("use only one rank2 deploy execution source: --rank2-deploy-execution-json or --rank2-deploy-execution");
  }
  if (args.rank2ProductionLiveSmokeRecordJson && args.rank2ProductionLiveSmokeRecordPath) {
    throw new Error("use only one rank2 production live smoke source: --rank2-production-live-smoke-json or --rank2-production-live-smoke");
  }
  if (args.rank2PostLiveRedirectDeleteApprovalRequestRecordJson && args.rank2PostLiveRedirectDeleteApprovalRequestRecordPath) {
    throw new Error("use only one rank2 post-live redirect/delete approval request source: --rank2-post-live-redirect-delete-approval-request-json or --rank2-post-live-redirect-delete-approval-request");
  }
  if (args.rank2PostLiveRedirectDeleteApprovalRecordJson && args.rank2PostLiveRedirectDeleteApprovalRecordPath) {
    throw new Error("use only one rank2 post-live redirect/delete approval record source: --rank2-post-live-redirect-delete-approval-record-json or --rank2-post-live-redirect-delete-approval-record");
  }
  if (args.rank2PostLiveRedirectDeleteExecutionPacketRecordJson && args.rank2PostLiveRedirectDeleteExecutionPacketRecordPath) {
    throw new Error("use only one rank2 post-live redirect/delete execution packet source: --rank2-post-live-redirect-delete-execution-packet-json or --rank2-post-live-redirect-delete-execution-packet");
  }
  if (args.rank2PostLiveRedirectDeleteExecutionRecordJson && args.rank2PostLiveRedirectDeleteExecutionRecordPath) {
    throw new Error("use only one rank2 post-live redirect/delete execution record source: --rank2-post-live-redirect-delete-execution-record-json or --rank2-post-live-redirect-delete-execution-record");
  }
  if (args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordJson && args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordPath) {
    throw new Error("use only one rank2 post-live redirect/delete post-execution smoke source: --rank2-post-live-redirect-delete-post-execution-smoke-json or --rank2-post-live-redirect-delete-post-execution-smoke");
  }
  if (args.rank2PostLiveRedirectDeleteRollbackReadinessRecordJson && args.rank2PostLiveRedirectDeleteRollbackReadinessRecordPath) {
    throw new Error("use only one rank2 post-live redirect/delete rollback readiness source: --rank2-post-live-redirect-delete-rollback-readiness-json or --rank2-post-live-redirect-delete-rollback-readiness");
  }
  if (args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordJson && args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordPath) {
    throw new Error("use only one rank2 post-live redirect/delete owner closeout source: --rank2-post-live-redirect-delete-owner-closeout-json or --rank2-post-live-redirect-delete-owner-closeout");
  }
  if (args.rank2FreshOwnerRuntimePacketRecordJson && args.rank2FreshOwnerRuntimePacketRecordPath) {
    throw new Error("use only one rank2 fresh owner runtime packet source: --rank2-fresh-owner-runtime-packet-json or --rank2-fresh-owner-runtime-packet");
  }
  if (args.rank2FreshOwnerRuntimeExecutionPacketRecordJson && args.rank2FreshOwnerRuntimeExecutionPacketRecordPath) {
    throw new Error("use only one rank2 fresh owner runtime execution packet source: --rank2-fresh-owner-runtime-execution-packet-json or --rank2-fresh-owner-runtime-execution-packet");
  }
  if (args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordJson && args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordPath) {
    throw new Error("use only one rank2 fresh owner external runtime execution evidence source: --rank2-fresh-owner-external-runtime-execution-evidence-json or --rank2-fresh-owner-external-runtime-execution-evidence");
  }
  if (args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordJson && args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordPath) {
    throw new Error("use only one rank2 fresh owner post-runtime smoke evidence source: --rank2-fresh-owner-post-runtime-smoke-evidence-json or --rank2-fresh-owner-post-runtime-smoke-evidence");
  }
  if (args.rank2FreshOwnerRollbackReadinessRecordJson && args.rank2FreshOwnerRollbackReadinessRecordPath) {
    throw new Error("use only one rank2 fresh owner rollback readiness source: --rank2-fresh-owner-rollback-readiness-json or --rank2-fresh-owner-rollback-readiness");
  }
  if (args.rank2FreshOwnerOwnerCloseoutRecordJson && args.rank2FreshOwnerOwnerCloseoutRecordPath) {
    throw new Error("use only one rank2 fresh owner owner closeout source: --rank2-fresh-owner-owner-closeout-json or --rank2-fresh-owner-owner-closeout");
  }
  if (args.rank2PreActivationTemplate && (args.rank2PreActivationRecordJson || args.rank2PreActivationRecordPath)) {
    throw new Error("--rank2-pre-activation-template cannot be combined with a rank2 pre-activation record");
  }
  if (args.rank2OwnerDecisionRecordTemplate && (args.rank2OwnerDecisionRecordJson || args.rank2OwnerDecisionRecordPath)) {
    throw new Error("--rank2-owner-decision-record-template cannot be combined with a rank2 owner decision record");
  }
  if (args.rank2OwnerFollowupRecordTemplate && (args.rank2OwnerFollowupRecordJson || args.rank2OwnerFollowupRecordPath)) {
    throw new Error("--rank2-owner-followup-record-template cannot be combined with a rank2 owner followup record");
  }
  if (args.rank2MutationApprovalRecordTemplate && (args.rank2MutationApprovalRecordJson || args.rank2MutationApprovalRecordPath)) {
    throw new Error("--rank2-mutation-approval-record-template cannot be combined with a rank2 mutation approval record");
  }
  if (args.rank2RouteDiffProposalTemplate && (args.rank2RouteDiffProposalRecordJson || args.rank2RouteDiffProposalRecordPath)) {
    throw new Error("--rank2-route-diff-proposal-template cannot be combined with a rank2 route diff proposal record");
  }
  if (args.rank2RollbackPlanTemplate && (args.rank2RollbackPlanRecordJson || args.rank2RollbackPlanRecordPath)) {
    throw new Error("--rank2-rollback-plan-template cannot be combined with a rank2 rollback plan record");
  }
  if (args.rank2LocalPostPatchSmokePlanTemplate && (args.rank2LocalPostPatchSmokePlanRecordJson || args.rank2LocalPostPatchSmokePlanRecordPath)) {
    throw new Error("--rank2-local-post-patch-smoke-plan-template cannot be combined with a rank2 local post-patch smoke plan record");
  }
  if (args.rank2ExplicitDeployApprovalTemplate && (args.rank2ExplicitDeployApprovalRecordJson || args.rank2ExplicitDeployApprovalRecordPath)) {
    throw new Error("--rank2-explicit-deploy-approval-template cannot be combined with a rank2 explicit deploy approval record");
  }
  if (args.rank2RouteExecutionPacketTemplate && (args.rank2RouteExecutionPacketRecordJson || args.rank2RouteExecutionPacketRecordPath)) {
    throw new Error("--rank2-route-execution-packet-template cannot be combined with a rank2 route execution packet record");
  }
  if (args.rank2OwnerRuntimeReleaseTemplate && (args.rank2OwnerRuntimeReleaseRecordJson || args.rank2OwnerRuntimeReleaseRecordPath)) {
    throw new Error("--rank2-owner-runtime-release-template cannot be combined with a rank2 owner runtime release record");
  }
  if (args.rank2RoutePatchApplicationTemplate && (args.rank2RoutePatchApplicationRecordJson || args.rank2RoutePatchApplicationRecordPath)) {
    throw new Error("--rank2-route-patch-application-template cannot be combined with a rank2 route patch application record");
  }
  if (args.rank2LocalPostPatchSmokeRecordTemplate && (args.rank2LocalPostPatchSmokeRecordJson || args.rank2LocalPostPatchSmokeRecordPath)) {
    throw new Error("--rank2-local-post-patch-smoke-record-template cannot be combined with a rank2 local post-patch smoke record");
  }
  if (args.rank2DeployExecutionTemplate && (args.rank2DeployExecutionRecordJson || args.rank2DeployExecutionRecordPath)) {
    throw new Error("--rank2-deploy-execution-template cannot be combined with a rank2 deploy execution record");
  }
  if (args.rank2ProductionLiveSmokeTemplate && (args.rank2ProductionLiveSmokeRecordJson || args.rank2ProductionLiveSmokeRecordPath)) {
    throw new Error("--rank2-production-live-smoke-template cannot be combined with a rank2 production live smoke record");
  }
  if (args.rank2PostLiveRedirectDeleteApprovalRequestTemplate
    && (args.rank2PostLiveRedirectDeleteApprovalRequestRecordJson || args.rank2PostLiveRedirectDeleteApprovalRequestRecordPath)) {
    throw new Error("--rank2-post-live-redirect-delete-approval-request-template cannot be combined with a rank2 post-live redirect/delete approval request record");
  }
  if (args.rank2PostLiveRedirectDeleteApprovalRecordTemplate
    && (args.rank2PostLiveRedirectDeleteApprovalRecordJson || args.rank2PostLiveRedirectDeleteApprovalRecordPath)) {
    throw new Error("--rank2-post-live-redirect-delete-approval-record-template cannot be combined with a rank2 post-live redirect/delete approval record");
  }
  if (args.rank2PostLiveRedirectDeleteExecutionPacketTemplate
    && (args.rank2PostLiveRedirectDeleteExecutionPacketRecordJson || args.rank2PostLiveRedirectDeleteExecutionPacketRecordPath)) {
    throw new Error("--rank2-post-live-redirect-delete-execution-packet-template cannot be combined with a rank2 post-live redirect/delete execution packet record");
  }
  if (args.rank2PostLiveRedirectDeleteExecutionRecordTemplate
    && (args.rank2PostLiveRedirectDeleteExecutionRecordJson || args.rank2PostLiveRedirectDeleteExecutionRecordPath)) {
    throw new Error("--rank2-post-live-redirect-delete-execution-record-template cannot be combined with a rank2 post-live redirect/delete execution record");
  }
  if (args.rank2PostLiveRedirectDeletePostExecutionSmokeTemplate
    && (args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordJson || args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordPath)) {
    throw new Error("--rank2-post-live-redirect-delete-post-execution-smoke-template cannot be combined with a rank2 post-live redirect/delete post-execution smoke record");
  }
  if (args.rank2PostLiveRedirectDeleteRollbackReadinessTemplate
    && (args.rank2PostLiveRedirectDeleteRollbackReadinessRecordJson || args.rank2PostLiveRedirectDeleteRollbackReadinessRecordPath)) {
    throw new Error("--rank2-post-live-redirect-delete-rollback-readiness-template cannot be combined with a rank2 post-live redirect/delete rollback readiness record");
  }
  if (args.rank2PostLiveRedirectDeleteOwnerCloseoutTemplate
    && (args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordJson || args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordPath)) {
    throw new Error("--rank2-post-live-redirect-delete-owner-closeout-template cannot be combined with a rank2 post-live redirect/delete owner closeout record");
  }
  if (args.rank2FreshOwnerRuntimePacketTemplate
    && (args.rank2FreshOwnerRuntimePacketRecordJson || args.rank2FreshOwnerRuntimePacketRecordPath)) {
    throw new Error("--rank2-fresh-owner-runtime-packet-template cannot be combined with a rank2 fresh owner runtime packet record");
  }
  if (args.rank2FreshOwnerRuntimeExecutionPacketTemplate
    && (args.rank2FreshOwnerRuntimeExecutionPacketRecordJson || args.rank2FreshOwnerRuntimeExecutionPacketRecordPath)) {
    throw new Error("--rank2-fresh-owner-runtime-execution-packet-template cannot be combined with a rank2 fresh owner runtime execution packet record");
  }
  if (args.rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate
    && (args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordJson || args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordPath)) {
    throw new Error("--rank2-fresh-owner-external-runtime-execution-evidence-template cannot be combined with a rank2 fresh owner external runtime execution evidence record");
  }
  if (args.rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate
    && (args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordJson || args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordPath)) {
    throw new Error("--rank2-fresh-owner-post-runtime-smoke-evidence-template cannot be combined with a rank2 fresh owner post-runtime smoke evidence record");
  }
  if (args.rank2FreshOwnerRollbackReadinessTemplate
    && (args.rank2FreshOwnerRollbackReadinessRecordJson || args.rank2FreshOwnerRollbackReadinessRecordPath)) {
    throw new Error("--rank2-fresh-owner-rollback-readiness-template cannot be combined with a rank2 fresh owner rollback readiness record");
  }
  if (args.rank2FreshOwnerOwnerCloseoutTemplate
    && (args.rank2FreshOwnerOwnerCloseoutRecordJson || args.rank2FreshOwnerOwnerCloseoutRecordPath)) {
    throw new Error("--rank2-fresh-owner-owner-closeout-template cannot be combined with a rank2 fresh owner owner closeout record");
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

function ownerDecisionRecordProScreenModelAcceptance(review) {
  const acceptance = review.pro_screen_model_acceptance ?? {};
  return {
    schema_version: acceptance.schema_version ?? null,
    acceptance_ready: Boolean(acceptance.acceptance_ready),
    owner_area: acceptance.owner_area ?? null,
    owner_route: acceptance.owner_route ?? null,
    compatibility_route: acceptance.compatibility_route ?? null,
    pro_route_ia_acceptance: acceptance.pro_route_ia_acceptance ?? null,
    screen_model_contract: acceptance.screen_model_contract ?? [],
    owner_packet_required_checks: acceptance.owner_packet_required_checks ?? [],
    home_primary_allowed: acceptance.home_primary_allowed ?? null,
    mobile_primary_allowed: acceptance.mobile_primary_allowed ?? null,
    mutation_blocked_without_owner_decision: acceptance.mutation_blocked_without_owner_decision ?? null,
    dedicated_route_owner_required: acceptance.dedicated_route_owner_required ?? null,
    dedicated_route_owner_present: acceptance.dedicated_route_owner_present ?? null,
    source_refs: acceptance.source_refs ?? [],
  };
}

function ownerDecisionProRouteIaAcceptanceChecks(review, liveProof) {
  const acceptance = ownerDecisionRecordProScreenModelAcceptance(review);
  const liveRows = ownerDecisionLiveEquivalenceRows(liveProof);
  const homeEntrypoints = ownerDecisionHomeDashboardEntrypoints(review);
  const sourceReferences = ownerDecisionSourceLegacyReferences(review);
  const compatibilityRefs = sourceReferences.filter((row) => row.class === "compatibility_bridge_route");
  const homeEntrypointRefs = sourceReferences.filter((row) => row.class === "home_dashboard_legacy_bridge_entrypoint");
  return [
    {
      id: "pro_acceptance_ready",
      status: acceptance.acceptance_ready === true ? "pass" : "fail",
      required: true,
      actual: acceptance.acceptance_ready,
      evidence: acceptance.source_refs,
    },
    {
      id: "owner_route_identity",
      status: acceptance.owner_route === review.owner_route ? "pass" : "fail",
      required: review.owner_route,
      actual: acceptance.owner_route,
      evidence: [`owner_route=${review.owner_route}`],
    },
    {
      id: "compatibility_route_identity",
      status: acceptance.compatibility_route === review.compatibility_route ? "pass" : "fail",
      required: review.compatibility_route,
      actual: acceptance.compatibility_route,
      evidence: [`compatibility_route=${review.compatibility_route}`],
    },
    {
      id: "home_primary_disallowed",
      status: acceptance.home_primary_allowed === false ? "pass" : "fail",
      required: false,
      actual: acceptance.home_primary_allowed,
      evidence: acceptance.screen_model_contract.filter((item) => item.includes("Home remains")),
    },
    {
      id: "mobile_primary_disallowed",
      status: acceptance.mobile_primary_allowed === false ? "pass" : "fail",
      required: false,
      actual: acceptance.mobile_primary_allowed,
      evidence: acceptance.screen_model_contract.filter((item) => item.includes("Mobile primary")),
    },
    {
      id: "dedicated_route_owner_present",
      status: acceptance.dedicated_route_owner_required === true && acceptance.dedicated_route_owner_present === true ? "pass" : "fail",
      required: true,
      actual: acceptance.dedicated_route_owner_present,
      evidence: acceptance.screen_model_contract.filter((item) => item.includes("Depth owners")),
    },
    {
      id: "mutation_blocked_without_owner_decision",
      status: acceptance.mutation_blocked_without_owner_decision === true ? "pass" : "fail",
      required: true,
      actual: acceptance.mutation_blocked_without_owner_decision,
      evidence: acceptance.owner_packet_required_checks.filter((item) => item.includes("owner records")),
    },
    {
      id: "local_live_equivalence_locked",
      status: liveProof.proof_status === "local_runtime_smoke_passed"
        && liveProof.rows_checked === liveProof.expected_rows
        && liveRows.every((row) => row.ok === true)
        ? "pass"
        : "fail",
      required: {
        proof_status: "local_runtime_smoke_passed",
        rows_checked: liveProof.expected_rows,
      },
      actual: {
        proof_status: liveProof.proof_status,
        rows_checked: liveProof.rows_checked,
      },
      evidence: liveRows.map((row) => `${row.role}:${row.path}:status=${row.status}:ok=${row.ok}`),
    },
    {
      id: "home_dashboard_entrypoints_inventory_locked",
      status: homeEntrypoints.length > 0
        && homeEntrypoints.every((row) => row.class === "home_dashboard_legacy_bridge_entrypoint")
        ? "pass"
        : "fail",
      required: "all Home/dashboard legacy bridge entrypoints are inventoried before any href patch",
      actual: homeEntrypoints.length,
      evidence: homeEntrypoints.map((row) => `${row.file}:${row.line}`),
    },
    {
      id: "source_reference_inventory_locked",
      status: compatibilityRefs.length > 0 && homeEntrypointRefs.length > 0 ? "pass" : "fail",
      required: "compatibility bridge route and Home/dashboard references are both present",
      actual: {
        compatibility_bridge_route: compatibilityRefs.length,
        home_dashboard_legacy_bridge_entrypoint: homeEntrypointRefs.length,
      },
      evidence: sourceReferences.map((row) => `${row.file}:${row.line}:${row.class}`),
    },
  ];
}

function ownerDecisionLiveEquivalenceRows(liveProof) {
  return (liveProof.rows ?? []).map((row) => ({
    role: row.role,
    equivalence_group: row.equivalence_group ?? null,
    path: row.path,
    paired_path: row.paired_path ?? null,
    expected_http_status: row.expected_http_status,
    status: row.status,
    ok: row.ok,
  }));
}

function ownerDecisionHomeDashboardEntrypoints(review) {
  return (review.public_home_legacy_bridge_entrypoints ?? []).map((row) => ({
    file: row.file,
    line: row.line,
    matched_tokens: row.matched_tokens ?? [],
    class: row.class,
    owner_gate: row.owner_gate,
  }));
}

function ownerDecisionSourceLegacyReferences(review) {
  return (review.src_legacy_references ?? []).map((row) => ({
    file: row.file,
    line: row.line,
    matched_tokens: row.matched_tokens ?? [],
    class: row.class,
    owner_gate: row.owner_gate,
  }));
}

function ownerDecisionOptions() {
  return [
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
  ].map((slice) => ({
    blocked_actions: defaultBlockedActions(),
    ...slice,
  }));
}

function ownerDecisionReleaseBlockers() {
  return [
    "owner decision must be recorded as preserve, remap, or retire",
    "route patch and runtime execution approval must be recorded explicitly before mutation or runtime",
    "redirect/delete/deploy approval must be recorded explicitly before mutation",
    "soak and rollback plan must be recorded before redirect/delete/deploy",
    "rank 2 cannot become active until rank 1 owner decision is recorded",
  ];
}

function defaultBlockedActions() {
  return ["redirect", "delete", "deploy", "public_file_mutation", "rank_2_release"];
}

function ownerDecisionBlockedActions() {
  return ["runtime_execution", "route_patch", ...defaultBlockedActions()];
}

function routePatchBlockedActions() {
  return ["route_patch", ...defaultBlockedActions()];
}

function requiredBlockedActionsForGate(gate) {
  return gate?.id === "macro_owner_decision_record" || gate?.id === "macro_owner_decision_followup_record"
    ? ownerDecisionBlockedActions()
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
      ? routePatchBlockedActions()
      : defaultBlockedActions();
}

function ownerDecisionReportingSummaryAcknowledgement() {
  return {
    schema_version: "macro-owner-reporting-summary-ack/v0.1",
    required: true,
    summary_schema_version: "macro-owner-reporting-summary/v0.1",
    summary_command: "node scripts/build-macro-owner-decision-packet.mjs --reporting-summary",
    summary_must_be_generated_from_current_packet: true,
    current_gate_checklist_required: true,
    current_gate_checklist_schema_version: "macro-owner-current-gate-checklist/v0.1",
    current_gate_checklist_must_match_current_next_required_gate: true,
    current_gate_checklist_required_checks: [
      "gate_no_mutation",
      "separate_mutation_approval_required",
      "blocked_actions_locked",
      "local_live_equivalence_locked",
      "pro_route_ia_acceptance_locked",
      "evidence_detail_surface_locked",
      "required_record_status",
      "safe_enforcement_slice_linked",
    ],
    acknowledged_gate: "macro_owner_decision_record",
    acknowledged_record_schema: "macro-owner-decision-record/v0.1",
    mutation_allowed: false,
    blocked_actions: ownerDecisionBlockedActions(),
  };
}

function ownerDecisionReportingSummaryAcknowledgementRequiredFields() {
  return [
    "schema_version",
    "required",
    "summary_schema_version",
    "summary_command",
    "summary_must_be_generated_from_current_packet",
    "current_gate_checklist_required",
    "current_gate_checklist_schema_version",
    "current_gate_checklist_must_match_current_next_required_gate",
    "current_gate_checklist_required_checks",
    "acknowledged_gate",
    "acknowledged_record_schema",
    "mutation_allowed",
    "blocked_actions",
  ];
}

function safeEnforcementSliceBlockedActionsById(slices) {
  return Object.fromEntries(
    (slices ?? []).map((slice) => [slice.id, slice.blocked_actions ?? []]),
  );
}

function safeEnforcementSliceEvidenceDetailSurfacesById(slices) {
  return Object.fromEntries(
    (slices ?? [])
      .filter((slice) => slice.required_evidence_detail_surface)
      .map((slice) => [slice.id, slice.required_evidence_detail_surface]),
  );
}

function ownerDecisionSafeEnforcementSliceAcknowledgementFromSlices(slices, nextCandidate) {
  const evidenceDetailSurfaces = safeEnforcementSliceEvidenceDetailSurfacesById(slices);
  return {
    schema_version: "macro-owner-safe-enforcement-slices-ack/v0.1",
    required: true,
    acknowledged_gate: "macro_owner_decision_record",
    acknowledged_record_schema: "macro-owner-decision-record/v0.1",
    slice_count: slices.length,
    slice_ids: slices.map((slice) => slice.id),
    all_slices_mutation: "none",
    all_slices_mutation_allowed: false,
    all_slices_carry_blocked_actions: slices.every(
      (slice) => Array.isArray(slice.blocked_actions) && slice.blocked_actions.length > 0,
    ),
    slice_blocked_actions: safeEnforcementSliceBlockedActionsById(slices),
    all_required_evidence_detail_surfaces_acknowledged: slices.every(
      (slice) => !slice.required_evidence_detail_surface || Boolean(evidenceDetailSurfaces[slice.id]),
    ),
    slice_evidence_detail_surfaces: evidenceDetailSurfaces,
    rank_2_candidate_after_valid_record: nextCandidate?.family_id ?? null,
    blocked_actions: ownerDecisionBlockedActions(),
  };
}

function ownerDecisionSafeEnforcementSliceAcknowledgement(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface = null) {
  return ownerDecisionSafeEnforcementSliceAcknowledgementFromSlices(
    safeEnforcementSlices(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    nextCandidate,
  );
}

function ownerDecisionSafeEnforcementSliceAcknowledgementForPacket(packet) {
  return ownerDecisionSafeEnforcementSliceAcknowledgementFromSlices(
    packet.safe_enforcement_slices ?? [],
    packet.next_queue_candidate_after_owner_decision,
  );
}

function ownerDecisionFollowupPlanContract(followupPlans) {
  return (followupPlans ?? []).map((plan) => ({
    id: plan.id,
    gate: plan.gate,
    decision: plan.decision,
    mutation: plan.mutation,
    mutation_allowed: plan.mutation_allowed,
    owner_record_required: plan.owner_record_required,
    separate_mutation_approval_required: plan.separate_mutation_approval_required,
    blocked_actions: plan.blocked_actions,
    rank_2_review_candidate_after_followup: plan.rank_2_review_candidate_after_followup,
    allowed_next_action: plan.allowed_next_action,
    required_evidence: plan.required_evidence,
    required_evidence_detail_surface: plan.required_evidence_detail_surface,
  }));
}

function ownerDecisionFollowupSelectionContract(followupPlans) {
  const plans = ownerDecisionFollowupPlanContract(followupPlans);
  return {
    schema_version: "macro-owner-decision-followup-selection/v0.1",
    required: true,
    selection_field: "decision",
    required_options_by_decision: Object.fromEntries(plans.map((plan) => [plan.decision, plan])),
    mutation_allowed: false,
    separate_mutation_approval_required: true,
    blocked_actions: ownerDecisionBlockedActions(),
  };
}

function ownerDecisionFollowupSelectionContractRequiredFields() {
  return [
    "schema_version",
    "required",
    "selection_field",
    "required_options_by_decision",
    "mutation_allowed",
    "separate_mutation_approval_required",
    "blocked_actions",
  ];
}

function ownerDecisionSelectedFollowupPlanContract(followupPlans, decision) {
  const selection = ownerDecisionFollowupSelectionContract(followupPlans);
  return selection.required_options_by_decision?.[decision] ?? null;
}

function decisionRecordTemplate(review, liveProof, followupPlans, nextCandidate, rank2PreActivationEvidenceDetailSurface = null) {
  return {
    schema_version: "macro-owner-decision-record/v0.1",
    family_id: review.family_id,
    owner_route: review.owner_route,
    compatibility_route: review.compatibility_route,
    decision: "preserve|remap|retire",
    owner_approved_by: "<owner>",
    decided_at: "<ISO-8601 timestamp>",
    local_live_equivalence_base_url: liveProof.base_url,
    local_live_equivalence_proof_status: liveProof.proof_status,
    local_live_equivalence_rows_checked: liveProof.rows_checked,
    local_live_equivalence_rows: ownerDecisionLiveEquivalenceRows(liveProof),
    pro_screen_model_acceptance: ownerDecisionRecordProScreenModelAcceptance(review),
    pro_route_ia_acceptance_checks: ownerDecisionProRouteIaAcceptanceChecks(review, liveProof),
    home_dashboard_legacy_bridge_entrypoints: ownerDecisionHomeDashboardEntrypoints(review),
    src_legacy_reference_rows: ownerDecisionSourceLegacyReferences(review),
    decision_options: ownerDecisionOptions(),
    release_blockers_acknowledged: ownerDecisionReleaseBlockers(),
    decision_followup_plans: ownerDecisionFollowupPlanContract(followupPlans),
    decision_followup_selection_contract: ownerDecisionFollowupSelectionContract(followupPlans),
    selected_decision_followup_plan: "<fill with the decision_followup_selection_contract option matching decision>",
    reporting_summary_acknowledgement: ownerDecisionReportingSummaryAcknowledgement(),
    safe_enforcement_slice_acknowledgement: ownerDecisionSafeEnforcementSliceAcknowledgement(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    mutation_approved: false,
    execution_allowed: false,
    execution_by_this_command_allowed: false,
    notes: "Decision record only; redirect/delete/deploy requires separate explicit approval.",
  };
}

function ownerDecisionEvidenceDetailRequirements(review, liveProof) {
  const localRows = ownerDecisionLiveEquivalenceRows(liveProof);
  const proChecks = ownerDecisionProRouteIaAcceptanceChecks(review, liveProof);
  const homeEntrypoints = ownerDecisionHomeDashboardEntrypoints(review);
  const sourceReferences = ownerDecisionSourceLegacyReferences(review);
  return {
    required_local_live_equivalence_row_paths: localRows.map((row) => row.path),
    required_local_live_equivalence_row_statuses: liveEquivalenceRowStatusSurface(localRows),
    required_local_live_equivalence_rows_all_ok: true,
    required_pro_route_ia_acceptance_check_statuses: proRouteIaCheckStatusSurface(proChecks),
    required_pro_route_ia_acceptance_all_pass: true,
    required_pro_route_ia_acceptance_file_line_evidence: proRouteIaFileLineEvidence(proChecks),
    required_home_dashboard_legacy_bridge_entrypoint_file_lines: homeDashboardFileLineEvidence(homeEntrypoints),
    required_src_legacy_reference_file_lines: sourceReferenceFileLineEvidence(sourceReferences),
  };
}

function ownerDecisionEvidenceDetailRequirementsFromRecord(record) {
  const localRows = record?.local_live_equivalence_rows ?? [];
  const proChecks = record?.pro_route_ia_acceptance_checks ?? [];
  return {
    required_local_live_equivalence_row_paths: localRows.map((row) => row.path),
    required_local_live_equivalence_row_statuses: liveEquivalenceRowStatusSurface(localRows),
    required_local_live_equivalence_rows_all_ok: true,
    required_pro_route_ia_acceptance_check_statuses: proRouteIaCheckStatusSurface(proChecks),
    required_pro_route_ia_acceptance_all_pass: true,
    required_pro_route_ia_acceptance_file_line_evidence: proRouteIaFileLineEvidence(proChecks),
    required_home_dashboard_legacy_bridge_entrypoint_file_lines: homeDashboardFileLineEvidence(record?.home_dashboard_legacy_bridge_entrypoints ?? []),
    required_src_legacy_reference_file_lines: sourceReferenceFileLineEvidence(record?.src_legacy_reference_rows ?? []),
  };
}

function nextGatedSlice(review, liveProof, nextCandidate, followupPlans, rank2PreActivationEvidenceDetailSurface = null) {
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
    required_local_live_equivalence_rows: ownerDecisionLiveEquivalenceRows(liveProof),
    required_owner_route: review.owner_route,
    required_compatibility_route: review.compatibility_route,
    required_pro_screen_model_acceptance: ownerDecisionRecordProScreenModelAcceptance(review),
    required_pro_route_ia_acceptance_checks: ownerDecisionProRouteIaAcceptanceChecks(review, liveProof),
    required_home_dashboard_legacy_bridge_entrypoints: ownerDecisionHomeDashboardEntrypoints(review),
    required_src_legacy_reference_rows: ownerDecisionSourceLegacyReferences(review),
    required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
    required_decision_options: ownerDecisionOptions(),
    required_release_blockers_acknowledged: ownerDecisionReleaseBlockers(),
    required_decision_followup_plans: ownerDecisionFollowupPlanContract(followupPlans),
    required_decision_followup_selection_contract: ownerDecisionFollowupSelectionContract(followupPlans),
    required_reporting_summary_acknowledgement: ownerDecisionReportingSummaryAcknowledgement(),
    required_safe_enforcement_slice_acknowledgement: ownerDecisionSafeEnforcementSliceAcknowledgement(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    required_mutation_flag: false,
    required_execution_allowed: false,
    required_execution_by_this_command_allowed: false,
    required_blocked_actions: ownerDecisionBlockedActions(),
    rank_2_candidate_after_valid_record: nextCandidate?.family_id ?? null,
  };
}

function nextOwnerAction(review, liveProof, nextCandidate, followupPlans, rank2PreActivationEvidenceDetailSurface = null) {
  return {
    id: "record_macro_owner_decision",
    gate: "macro_owner_decision_record",
    status: "blocked_pending_owner_record",
    family_id: review.family_id,
    owner_record_required: true,
    mutation: "none",
    mutation_allowed: false,
    template_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-template",
    validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<json>'",
    required_record_schema: "macro-owner-decision-record/v0.1",
    required_decisions: ["preserve", "remap", "retire"],
    required_local_live_equivalence: {
      base_url: liveProof.base_url,
      proof_status: liveProof.proof_status,
      rows_checked: liveProof.rows_checked,
      rows: ownerDecisionLiveEquivalenceRows(liveProof),
    },
    required_pro_route_ia_acceptance_checks: ownerDecisionProRouteIaAcceptanceChecks(review, liveProof),
    required_home_dashboard_legacy_bridge_entrypoints: ownerDecisionHomeDashboardEntrypoints(review),
    required_src_legacy_reference_rows: ownerDecisionSourceLegacyReferences(review),
    required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
    required_decision_options: ownerDecisionOptions(),
    required_release_blockers_acknowledged: ownerDecisionReleaseBlockers(),
    required_decision_followup_plans: ownerDecisionFollowupPlanContract(followupPlans),
    required_decision_followup_selection_contract: ownerDecisionFollowupSelectionContract(followupPlans),
    required_reporting_summary_acknowledgement: ownerDecisionReportingSummaryAcknowledgement(),
    required_safe_enforcement_slice_acknowledgement: ownerDecisionSafeEnforcementSliceAcknowledgement(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    required_mutation_approved: false,
    required_execution_allowed: false,
    required_execution_by_this_command_allowed: false,
    blocked_actions: ownerDecisionBlockedActions(),
    rank_2_candidate_after_valid_record: nextCandidate?.family_id ?? null,
  };
}

function ownerDecisionAcceptanceContract(review, liveProof, followupPlans, nextCandidate, rank2PreActivationEvidenceDetailSurface = null) {
  return {
    id: "macro_owner_decision_acceptance_contract",
    gate: "macro_owner_decision_record",
    status: "blocked_pending_owner_record",
    family_id: review.family_id,
    owner_route: review.owner_route,
    compatibility_route: review.compatibility_route,
    mutation: "none",
    mutation_allowed: false,
    required_record_schema: "macro-owner-decision-record/v0.1",
    required_decisions: ["preserve", "remap", "retire"],
    required_local_live_equivalence: {
      base_url: liveProof.base_url,
      proof_status: liveProof.proof_status,
      rows_checked: liveProof.rows_checked,
      rows: ownerDecisionLiveEquivalenceRows(liveProof),
    },
    required_pro_screen_model_acceptance: ownerDecisionRecordProScreenModelAcceptance(review),
    required_pro_route_ia_acceptance_checks: ownerDecisionProRouteIaAcceptanceChecks(review, liveProof),
    required_home_dashboard_legacy_bridge_entrypoints: ownerDecisionHomeDashboardEntrypoints(review),
    required_src_legacy_reference_rows: ownerDecisionSourceLegacyReferences(review),
    required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
    required_decision_options: ownerDecisionOptions(),
    required_release_blockers_acknowledged: ownerDecisionReleaseBlockers(),
    required_decision_followup_plans: ownerDecisionFollowupPlanContract(followupPlans),
    required_decision_followup_selection_contract: ownerDecisionFollowupSelectionContract(followupPlans),
    required_reporting_summary_acknowledgement: ownerDecisionReportingSummaryAcknowledgement(),
    required_safe_enforcement_slice_acknowledgement: ownerDecisionSafeEnforcementSliceAcknowledgement(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    required_execution_allowed: false,
    required_execution_by_this_command_allowed: false,
    blocked_actions: ownerDecisionBlockedActions(),
  };
}

function safeEnforcementSlices(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface = null) {
  return [
    {
      id: "owner_decision_record_validation",
      gate: "before_rank_2_release",
      decision: "pending",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      blocked_actions: ownerDecisionBlockedActions(),
      required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
      allowed_next_action: "validate a supplied owner record; keep rank 1 active until the record is valid",
      acceptance: [
        "record schema is macro-owner-decision-record/v0.1",
        `family_id is ${review.family_id}`,
        "decision is preserve, remap, or retire",
        "decided_at is a full ISO-8601 timestamp with timezone",
        "local proof base URL, status, and row count match the current packet",
        "detailed live-equivalence, PRO route/IA, and inventory evidence surface matches the current owner gate",
        "mutation_approved is false",
        "execution_allowed is false and execution_by_this_command_allowed is false",
      ],
    },
    {
      id: "preserve_bridge_documentation",
      gate: "after_valid_preserve_record",
      decision: "preserve",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      blocked_actions: ownerDecisionBlockedActions(),
      required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
      allowed_next_action: "document the preserve decision and keep the legacy bridge behind the current owner/compatibility routes",
      acceptance: [
        "Home remains search-first",
        "legacy macro-monitor HTML stays out of mobile primary IA",
        "detailed live-equivalence, PRO route/IA, and inventory evidence surface remains locked from the owner decision record",
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
      blocked_actions: ownerDecisionBlockedActions(),
      required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
      allowed_next_action: "prepare an href-remap proposal and rollback plan; do not edit links until explicit mutation approval",
      acceptance: [
        `proposed destination remains ${review.owner_route}`,
        "dashboard/home entrypoints are compared against native macro-chart PRO IA",
        "detailed live-equivalence, PRO route/IA, and inventory evidence surface remains locked from the owner decision record",
        "route_patch/redirect/delete/deploy remain blocked",
      ],
    },
    {
      id: "retire_readiness_packet",
      gate: "after_valid_retire_record",
      decision: "retire",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      blocked_actions: ownerDecisionBlockedActions(),
      required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
      allowed_next_action: "prepare a delete/redirect readiness packet with soak and rollback evidence; do not mutate public assets",
      acceptance: [
        "direct legacy samples and Radar bridge samples keep live-equivalence proof",
        "detailed live-equivalence, PRO route/IA, and inventory evidence surface remains locked from the owner decision record",
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
      blocked_actions: routePatchBlockedActions(),
      ...(rank2PreActivationEvidenceDetailSurface
        ? { required_evidence_detail_surface: rank2PreActivationEvidenceDetailSurface }
        : {}),
      allowed_next_action: "run and record the inactive rank-2 local smoke commands before making rank 2 the active owner-review slice",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "inactive preview stays active=false and mutation_allowed=false",
        "owner route, compatibility route, and legacy sample rows all carry local smoke commands",
        "detailed inactive rank-2 live-equivalence row identity, commands, and expected status surface remains locked",
        "proof status stays prep_only_not_executed until rank 2 is explicitly activated for local review",
        "route_patch/redirect/delete/deploy remain blocked until separate explicit owner approval",
      ],
    },
    {
      id: "rank2_owner_decision_record_validation",
      gate: "after_rank2_review_readiness_before_any_rank2_route_mutation",
      decision: "pending_rank2_owner_review",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "validate a rank-2 owner decision record for preserve/remap/retire; do not mutate routes or public assets",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rank-2 owner decision record schema is rank2-owner-decision-record/v0.1",
        `record stays tied to owner route ${nextCandidate?.owner_route ?? "unavailable"}`
          + (nextCandidate?.compatibility_route ? ` and compatibility route ${nextCandidate.compatibility_route}` : ""),
        "record keeps rank2_active=false, mutation=none, mutation_approved=false",
        "route_patch/redirect/delete/deploy/public mutation/rank-2 release remain blocked until separate explicit owner approval",
      ],
    },
    {
      id: "rank2_owner_followup_record_validation",
      gate: "after_valid_rank2_owner_decision_before_any_route_mutation_request",
      decision: "pending_rank2_followup",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "validate the selected rank-2 no-mutation follow-up packet before any route mutation request",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rank-2 owner follow-up record schema is rank2-owner-followup-record/v0.1",
        "selected preserve/remap/retire follow-up stays tied to the rank-2 owner decision",
        "record keeps route_mutation_requested=false and deploy_requested=false",
        "route_patch/redirect/delete/deploy/public mutation/rank-2 release remain blocked until separate explicit owner approval",
      ],
    },
    {
      id: "rank2_mutation_approval_request_prep",
      gate: "after_valid_rank2_followup_before_any_mutation_approval_record",
      decision: "pending_separate_mutation_approval",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "prepare a request-only mutation approval packet; do not execute redirect/delete/deploy",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "request packet schema is rank2-mutation-approval-request/v0.1",
        "approval_status remains pending_owner_approval",
        "request_only=true, mutation_allowed=false, execution_allowed=false",
        "route_patch/redirect/delete/deploy/public mutation/rank-2 release remain blocked until a separate owner approval record is supplied",
      ],
    },
    {
      id: "rank2_mutation_approval_record_validation",
      gate: "after_request_only_packet_before_any_route_patch",
      decision: "pending_owner_mutation_approval_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "validate an owner mutation approval record; keep execution, deploy, redirect, and delete blocked",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "approval record schema is rank2-mutation-approval-record/v0.1",
        "mutation_approved=true is only an approval record, not an execution permit",
        "execution_allowed=false, deploy_approved=false, route_patch_applied=false",
        "route_patch/redirect/delete/deploy/public mutation/rank-2 release remain blocked until a future execution packet is approved",
      ],
    },
    {
      id: "rank2_execution_readiness_prerequisite_map",
      gate: "after_valid_mutation_approval_record_before_any_route_execution",
      decision: "pending_execution_prerequisites",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "map the execution prerequisites for route/file diff, rollback, local smoke, and deploy approval without applying them",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "valid owner mutation approval record is necessary but not sufficient for execution",
        "route/file diff proposal is still required before any patch",
        "rollback plan, post-patch local smoke, and explicit deploy approval remain unsatisfied",
        "execution_allowed=false and route_patch/redirect/delete/deploy/public mutation/rank-2 release remain blocked",
      ],
    },
    {
      id: "rank2_route_diff_proposal_validation",
      gate: "after_valid_mutation_approval_record_before_any_route_file_patch",
      decision: "pending_route_file_diff_proposal",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "validate a draft route/file diff proposal without applying a patch, redirect, delete, or deploy",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "proposal schema is rank2-route-diff-proposal-record/v0.1",
        "proposal_status=draft_no_mutation and patch_applied=false",
        "public_files_modified=false, redirect_config_changed=false, and delete_paths=[]",
        "execution_allowed=false, deploy_approved=false, and route_patch/redirect/delete/deploy/public mutation/rank-2 release remain blocked",
      ],
    },
    {
      id: "rank2_rollback_plan_validation",
      gate: "after_valid_route_diff_proposal_before_any_route_execution",
      decision: "pending_rollback_plan",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "validate a rollback plan record without applying rollback, route patches, redirects, deletes, or deploys",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rollback plan schema is rank2-rollback-plan-record/v0.1",
        "route diff proposal must already be valid_no_mutation_route_diff_proposal_recorded",
        "rollback_plan_status=recorded_no_mutation and rollback_applied=false",
        "patch_applied=false, public_files_modified=false, redirect_config_changed=false, and delete_paths=[]",
        "execution_allowed=false, deploy_approved=false, and route_patch/redirect/delete/deploy/public mutation/rank-2 release remain blocked",
      ],
    },
    {
      id: "rank2_local_post_patch_smoke_plan_validation",
      gate: "after_valid_rollback_plan_before_any_route_execution",
      decision: "pending_local_post_patch_smoke_plan",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "validate a local post-patch smoke plan without running post-patch smoke, route patches, redirects, deletes, or deploys",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "local smoke plan schema is rank2-local-post-patch-smoke-plan-record/v0.1",
        "rollback plan must already be valid_no_mutation_rollback_plan_recorded",
        "smoke_plan_status=planned_before_execution_no_runtime and smoke_executed=false",
        "actual_http_status and ok remain null until a future approved post-patch run",
        "execution_allowed=false, deploy_approved=false, and redirect/delete/deploy remain blocked",
      ],
    },
    {
      id: "rank2_explicit_deploy_approval_record_validation",
      gate: "after_valid_local_post_patch_smoke_plan_before_any_deploy_or_live_smoke",
      decision: "pending_explicit_deploy_approval_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      blocked_actions: routePatchBlockedActions(),
      allowed_next_action: "validate an explicit owner deploy approval record without deploying, running production live smoke, redirecting, or deleting",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "deploy approval schema is rank2-explicit-deploy-approval-record/v0.1",
        "local smoke plan must already be valid_no_mutation_local_post_patch_smoke_plan_recorded",
        "approval_status=owner_approved and approval_scope=record_only_no_deploy",
        "deploy_approved=true but deploy_executed=false and production_live_smoke_executed=false",
        "execution_allowed=false and redirect/delete/deploy execution remain blocked",
      ],
    },
    {
      id: "rank2_route_execution_packet_validation",
      gate: "after_all_prerequisites_recorded_before_any_route_execution",
      decision: "pending_route_execution_packet_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate a route execution packet without applying route patches, running post-patch smoke, deploying, redirecting, or deleting",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "execution readiness must already be all_prerequisites_recorded_no_runtime",
        "route execution packet schema is rank2-route-execution-packet-record/v0.1",
        "execution_scope=record_only_no_runtime and owner_runtime_release_status=not_recorded",
        "route_patch_applied=false, post_patch_smoke_executed=false, deploy_executed=false",
        "production_live_smoke_executed=false and redirect/delete/deploy execution remain blocked",
      ],
    },
    {
      id: "rank2_owner_runtime_release_record_validation",
      gate: "after_valid_route_execution_packet_before_any_route_patch",
      decision: "pending_owner_runtime_release_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate an owner runtime release record without applying route patches, running post-patch smoke, deploying, redirecting, or deleting",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "route execution packet must already be valid_route_execution_packet_recorded_no_runtime",
        "owner runtime release schema is rank2-owner-runtime-release-record/v0.1",
        "release_scope=record_only_before_runtime and runtime_release_recorded=true",
        "execution_allowed=false, route_patch_applied=false, post_patch_smoke_executed=false",
        "deploy_executed=false, production_live_smoke_executed=false, and redirect/delete/deploy execution remain blocked",
      ],
    },
    {
      id: "rank2_route_patch_application_record_validation",
      gate: "after_valid_owner_runtime_release_before_post_patch_smoke_or_deploy",
      decision: "pending_route_patch_application_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate a route patch application record without running post-patch smoke, deploying, redirecting, deleting, or mutating public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "owner runtime release must already be valid_owner_runtime_release_recorded_no_execution",
        "route patch application schema is rank2-route-patch-application-record/v0.1",
        "patch_scope=record_only_local_patch_no_smoke_no_deploy and route_patch_applied=true",
        "post_patch_smoke_executed=false, deploy_executed=false, production_live_smoke_executed=false",
        "public_files_modified=false, redirect_config_changed=false, delete_paths=[], and redirect/delete/deploy remain blocked",
      ],
    },
    {
      id: "rank2_local_post_patch_smoke_record_validation",
      gate: "after_valid_route_patch_application_before_deploy_or_live_smoke",
      decision: "pending_local_post_patch_smoke_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate local post-patch smoke results without deploying, running production live smoke, redirecting, deleting, or mutating public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "route patch application must already be valid_route_patch_application_recorded_no_smoke_no_deploy",
        "local post-patch smoke schema is rank2-local-post-patch-smoke-record/v0.1",
        "smoke_scope=local_runtime_only_no_deploy and post_patch_smoke_executed=true",
        "all smoke rows must report ok=true and expected HTTP status",
        "deploy_executed=false, production_live_smoke_executed=false, public_files_modified=false, redirect_config_changed=false, delete_paths=[]",
      ],
    },
    {
      id: "rank2_deploy_execution_record_validation",
      gate: "after_valid_local_post_patch_smoke_before_production_live_smoke",
      decision: "pending_deploy_execution_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate a deploy execution record without running production live smoke, redirecting, deleting, or mutating public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "local post-patch smoke must already be valid_local_post_patch_smoke_recorded_no_deploy",
        "deploy execution schema is rank2-deploy-execution-record/v0.1",
        "deploy_scope=record_only_deploy_no_live_smoke and deploy_executed=true",
        "production_live_smoke_executed=false, public_files_modified=false, redirect_config_changed=false, delete_paths=[]",
        "production live smoke remains a separate future record",
      ],
    },
    {
      id: "rank2_production_live_smoke_record_validation",
      gate: "after_valid_deploy_execution_before_redirect_or_delete",
      decision: "pending_production_live_smoke_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate production live smoke results without redirecting, deleting, or mutating public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "deploy execution must already be valid_deploy_execution_recorded_no_live_smoke",
        "production live smoke schema is rank2-production-live-smoke-record/v0.1",
        "smoke_scope=production_live_smoke_only_no_redirect_no_delete and production_live_smoke_executed=true",
        "all production smoke rows must report ok=true and expected HTTP status",
        "public_files_modified=false, redirect_config_changed=false, delete_paths=[]",
        "redirect/delete remain blocked until a separate post-live approval request",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_approval_request_validation",
      gate: "after_valid_production_live_smoke_before_redirect_delete_owner_approval",
      decision: "pending_post_live_redirect_delete_approval_request",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate a post-live redirect/delete approval request without redirecting, deleting, or mutating public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "production live smoke must already be valid_production_live_smoke_recorded_no_redirect_no_delete",
        "request schema is rank2-post-live-redirect-delete-approval-request/v0.1",
        "request_scope=post_live_request_only_no_redirect_no_delete and redirect_delete_approval_requested=true",
        "redirect_delete_executed=false, public_files_modified=false, redirect_config_changed=false, delete_paths=[]",
        "redirect/delete remain blocked until a separate owner approval record",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_approval_record_validation",
      gate: "after_valid_post_live_request_before_redirect_delete_execution_packet",
      decision: "pending_post_live_redirect_delete_approval_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate an owner redirect/delete approval record without redirecting, deleting, or mutating public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "post-live request must already be valid_post_live_redirect_delete_approval_requested_no_execution",
        "approval schema is rank2-post-live-redirect-delete-approval-record/v0.1",
        "approval_scope=record_only_no_redirect_no_delete and redirect_delete_approved=true",
        "redirect_delete_executed=false, public_files_modified=false, redirect_config_changed=false, delete_paths=[]",
        "redirect/delete execution remains blocked until a separate execution packet",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_execution_packet_validation",
      gate: "after_valid_post_live_owner_approval_before_redirect_delete_execution_record",
      decision: "pending_post_live_redirect_delete_execution_packet",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate a redirect/delete execution packet without executing redirects, deletes, or public-file mutation",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "owner approval must already be valid_post_live_redirect_delete_approved_no_execution",
        "execution packet schema is rank2-post-live-redirect-delete-execution-packet/v0.1",
        "execution_scope=packet_only_no_redirect_no_delete and redirect_delete_execution_planned=true",
        "redirect_delete_executed=false, public_files_modified=false, redirect_config_changed=false, delete_paths=[]",
        "redirect/delete execution remains blocked until a separate execution record",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_execution_record_validation",
      gate: "after_valid_post_live_redirect_delete_execution_packet_before_post_execution_smoke",
      decision: "pending_post_live_redirect_delete_execution_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate an owner-approved redirect/delete execution evidence record without executing redirects, deletes, deploys, or public-file mutation from this command",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "execution packet must already be valid_post_live_redirect_delete_execution_packet_recorded_no_execution",
        "execution record schema is rank2-post-live-redirect-delete-execution-record/v0.1",
        "execution_scope=record_only_redirect_delete_execution_evidence and redirect_delete_executed=true",
        "execution_performed_by_this_command=false and local_files_modified_by_this_command=false",
        "post-execution smoke remains blocked until a separate smoke record",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_post_execution_smoke_record_validation",
      gate: "after_valid_post_live_redirect_delete_execution_record_before_rollback_readiness",
      decision: "pending_post_live_redirect_delete_post_execution_smoke_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate externally performed post-execution production smoke evidence without executing deploys, redirects, deletes, or public-file mutation from this command",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "execution record must already be valid_post_live_redirect_delete_execution_recorded_pending_smoke",
        "post-execution smoke schema is rank2-post-live-redirect-delete-post-execution-smoke-record/v0.1",
        "smoke_scope=post_execution_smoke_only_no_additional_redirect_delete_no_deploy",
        "all post-execution smoke rows must report ok=true with an allowed HTTP status",
        "smoke_performed_by_this_command=false and rollback readiness remains a separate future record",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_rollback_readiness_record_validation",
      gate: "after_valid_post_execution_smoke_before_owner_closeout",
      decision: "pending_post_live_redirect_delete_rollback_readiness_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate rollback readiness evidence without applying rollback, deploys, redirects, deletes, or public-file mutation from this command",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "post-execution smoke must already be valid_post_live_redirect_delete_post_execution_smoke_recorded",
        "rollback readiness schema is rank2-post-live-redirect-delete-rollback-readiness-record/v0.1",
        "rollback_scope=record_only_rollback_readiness_no_rollback_no_deploy and rollback_ready=true",
        "rollback_applied=false and rollback_performed_by_this_command=false",
        "owner closeout remains a separate future record",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_owner_closeout_record_validation",
      gate: "after_valid_rollback_readiness_before_record_chain_close",
      decision: "pending_post_live_redirect_delete_owner_closeout_record",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate final owner closeout evidence without applying runtime, rollback, deploy, redirect, delete, or public-file mutation from this command",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rollback readiness must already be valid_post_live_redirect_delete_rollback_readiness_recorded",
        "owner closeout schema is rank2-post-live-redirect-delete-owner-closeout-record/v0.1",
        "closeout_scope=record_only_owner_closeout_no_additional_runtime",
        "owner_closeout_accepted=true and additional_runtime_required=false",
        "closeout_performed_by_this_command=false and next_required_runtime_gate=none_record_chain_closed",
      ],
    },
    {
      id: "rank2_post_live_redirect_delete_fresh_owner_packet_required",
      gate: "after_record_chain_closed_before_any_new_runtime",
      decision: "fresh_owner_approved_packet_required",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      required_contract_id: "post_terminal_fresh_owner_packet_contract",
      required_record_schema: "rank2-fresh-owner-runtime-packet-record/v0.1",
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<json>'",
      required_contract_sections: [
        "pro_route_ia_acceptance",
        "local_live_equivalence",
        "rollback_plan",
        "explicit_owner_approval",
      ],
      allowed_next_action: "prepare a fresh owner-approved packet before any additional redirect/delete/deploy/public mutation; no runtime action from this command",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "owner closeout must already be valid_post_live_redirect_delete_owner_closeout_recorded",
        "terminal gate must be rank2_post_live_redirect_delete_record_chain_closed",
        "fresh owner-approved packet must carry PRO route/IA acceptance, live-equivalence proof, rollback plan, and explicit owner approval",
        "redirect/delete/deploy/public mutation remains blocked until that fresh owner-approved packet is supplied and validated",
      ],
    },
    {
      id: "rank2_fresh_owner_runtime_execution_packet_required",
      gate: "after_valid_fresh_owner_packet_before_any_runtime_execution",
      decision: "runtime_execution_packet_required",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      required_record_schema: "rank2-fresh-owner-runtime-execution-packet-record/v0.1",
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-execution-packet-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<json>'",
      allowed_next_action: "prepare a separate runtime execution packet record after a valid fresh owner packet; no runtime execution from this command",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "fresh owner runtime packet must already be valid_fresh_owner_runtime_packet_recorded_no_execution",
        "runtime execution packet schema is rank2-fresh-owner-runtime-execution-packet-record/v0.1",
        "execution_scope=packet_only_no_runtime",
        "execution_allowed=false and execution_performed_by_this_command=false",
        "route patch, redirect/delete, deploy, public-file mutation, redirect config changes, and delete paths remain blocked",
      ],
    },
    {
      id: "rank2_fresh_owner_external_runtime_execution_evidence_required",
      gate: "after_valid_fresh_owner_runtime_execution_packet_before_post_runtime_smoke",
      decision: "external_runtime_execution_evidence_required",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      required_record_schema: "rank2-fresh-owner-external-runtime-execution-evidence-record/v0.1",
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-external-runtime-execution-evidence-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<json>'",
      allowed_next_action: "record externally performed runtime execution evidence only; this command must not execute route patch, redirect/delete, deploy, smoke, or public-file mutation",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "runtime execution packet must already be valid_fresh_owner_runtime_execution_packet_recorded_no_execution",
        "external runtime execution evidence schema is rank2-fresh-owner-external-runtime-execution-evidence-record/v0.1",
        "execution_scope=external_runtime_execution_evidence_only",
        "execution_performed_outside_this_command=true and execution_performed_by_this_command=false",
        "post-runtime smoke remains blocked until a separate smoke evidence record",
      ],
    },
    {
      id: "rank2_fresh_owner_post_runtime_smoke_evidence_required",
      gate: "after_valid_fresh_owner_external_runtime_execution_evidence_before_rollback_readiness",
      decision: "post_runtime_smoke_evidence_required",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      required_record_schema: "rank2-fresh-owner-post-runtime-smoke-evidence-record/v0.1",
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-post-runtime-smoke-evidence-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<json>'",
      allowed_next_action: "record externally performed post-runtime smoke evidence only; this command must not run smoke, execute rollback, patch routes, redirect/delete, deploy, or mutate public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "external runtime execution evidence must already be valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke",
        "post-runtime smoke evidence schema is rank2-fresh-owner-post-runtime-smoke-evidence-record/v0.1",
        "smoke_scope=post_runtime_smoke_evidence_only_no_additional_runtime",
        "smoke_performed_outside_this_command=true and smoke_performed_by_this_command=false",
        "rollback readiness remains blocked until a separate rollback readiness record",
      ],
    },
    {
      id: "rank2_fresh_owner_rollback_readiness_required",
      gate: "after_valid_fresh_owner_post_runtime_smoke_evidence_before_owner_closeout",
      decision: "rollback_readiness_required",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      required_record_schema: "rank2-fresh-owner-rollback-readiness-record/v0.1",
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-rollback-readiness-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<post-runtime-smoke-json>' --rank2-fresh-owner-rollback-readiness-json='<json>'",
      allowed_next_action: "record rollback readiness evidence only; this command must not execute rollback, run smoke, patch routes, redirect/delete, deploy, or mutate public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "post-runtime smoke evidence must already be valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback",
        "rollback readiness schema is rank2-fresh-owner-rollback-readiness-record/v0.1",
        "rollback_scope=record_only_rollback_readiness_no_rollback_no_deploy",
        "rollback_ready=true and rollback_performed_by_this_command=false",
        "owner closeout remains blocked until a separate owner closeout record",
      ],
    },
    {
      id: "rank2_fresh_owner_owner_closeout_required",
      gate: "after_valid_fresh_owner_rollback_readiness_before_chain_close",
      decision: "owner_closeout_required",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      required_record_schema: "rank2-fresh-owner-owner-closeout-record/v0.1",
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-owner-closeout-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<post-runtime-smoke-json>' --rank2-fresh-owner-rollback-readiness-json='<rollback-readiness-json>' --rank2-fresh-owner-owner-closeout-json='<json>'",
      allowed_next_action: "record owner closeout evidence only; this command must not execute closeout, rollback, smoke, patch routes, redirect/delete, deploy, or mutate public files",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rollback readiness must already be valid_fresh_owner_rollback_readiness_recorded_pending_closeout",
        "owner closeout schema is rank2-fresh-owner-owner-closeout-record/v0.1",
        "closeout_scope=record_only_owner_closeout_no_additional_runtime",
        "owner_closeout_accepted=true and additional_runtime_required=false",
        "closeout_performed_by_this_command=false and next_required_runtime_gate=none_record_chain_closed",
      ],
    },
  ].map((slice) => ({
    blocked_actions: defaultBlockedActions(),
    ...slice,
  }));
}

function decisionFollowupPlans(review, liveProof, nextCandidate) {
  const common = {
    family_id: review.family_id,
    mutation: "none",
    mutation_allowed: false,
    owner_record_required: true,
    separate_mutation_approval_required: true,
    blocked_actions: ownerDecisionBlockedActions(),
    required_evidence_detail_surface: ownerDecisionEvidenceDetailRequirements(review, liveProof),
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

function decisionFollowupRecordTemplate(plan, proRouteIaAcceptanceChecks) {
  return {
    schema_version: "macro-owner-decision-followup-record/v0.1",
    family_id: plan.family_id,
    decision: plan.decision,
    followup_id: plan.id,
    recorded_at: "<ISO-8601 timestamp>",
    owner_decision_record_status: "valid_no_mutation",
    evidence_status: "recorded_no_mutation",
    required_evidence: plan.required_evidence,
    required_evidence_detail_surface: plan.required_evidence_detail_surface,
    pro_route_ia_acceptance_checks: proRouteIaAcceptanceChecks,
    mutation_approved: false,
    separate_mutation_approval_required: true,
    blocked_actions: plan.blocked_actions,
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

function selectedDecisionFollowupRecordTemplate(packet) {
  if (!packet.selected_decision_followup) return null;
  return packet.decision_followup_record_templates.find((template) => template.followup_id === packet.selected_decision_followup.id) ?? null;
}

function rank2PreActivationRecordTemplate(packet) {
  return packet.inactive_next_candidate_preview?.live_equivalence_prep?.record_template ?? null;
}

function rank2OwnerReviewPacketTemplate(packet) {
  return packet.rank2_owner_review_template ?? null;
}

function rank2OwnerDecisionRecordTemplate(packet) {
  return rank2OwnerReviewPacketTemplate(packet)?.decision_record_template ?? null;
}

function selectedRank2OwnerFollowupRecordTemplate(packet) {
  if (!packet.selected_rank2_owner_followup) return null;
  return packet.rank2_owner_followup_record_templates.find((template) => template.followup_id === packet.selected_rank2_owner_followup.id) ?? null;
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

  const recordTemplate = {
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
  };
  const requiredEvidenceDetailSurface = rank2PreActivationEvidenceDetailSurfaceFromRecordTemplate(recordTemplate);

  return {
    schema_version: "inactive-owner-review-live-equivalence-prep/v0.1",
    proof_status: "prep_only_not_executed",
    preview_only: true,
    expected_rows: rows.length,
    rows,
    required_evidence_detail_surface: requiredEvidenceDetailSurface,
    required_before_active_review: [
      "rank 1 owner decision record validates as valid_no_mutation",
      "rank 1 selected no-mutation follow-up is recorded",
      "all inactive preview smoke rows pass locally before rank 2 owner review",
      "rank 2 owner decision is still required before redirect/delete/deploy",
    ],
    record_template: {
      ...recordTemplate,
      required_evidence_detail_surface: requiredEvidenceDetailSurface,
    },
  };
}

function rank2PreActivationEvidenceDetailSurfaceFromRecordTemplate(recordTemplate) {
  const rows = recordTemplate?.rows ?? [];
  return {
    schema_version: "rank2-pre-activation-evidence-detail-surface/v0.1",
    candidate_family_id: recordTemplate?.candidate_family_id ?? null,
    required_record_schema: recordTemplate?.schema_version ?? null,
    required_recording_gate: recordTemplate?.recording_gate ?? null,
    required_local_live_equivalence_base_url: recordTemplate?.local_live_equivalence_base_url ?? null,
    required_proof_status_after_record: "local_runtime_smoke_passed",
    required_mutation_approved: false,
    required_row_count: rows.length,
    required_row_roles: rows.map((row) => row.role),
    required_row_paths: rows.map((row) => row.path),
    required_row_expected_http_statuses: rows.map((row) => ({
      role: row.role,
      path: row.path,
      paired_path: row.paired_path,
      expected_http_status: row.expected_http_status,
    })),
    required_row_commands: rows.map((row) => ({
      role: row.role,
      path: row.path,
      command: row.command,
    })),
    required_all_commands_present: rows.every((row) => typeof row.command === "string" && row.command.length > 0),
    required_rows_all_ok_after_record: true,
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

function freshOwnerApprovedPacketContract(packet) {
  const preview = packet.inactive_next_candidate_preview ?? {};
  const candidate = preview.candidate ?? {};
  const liveTemplate = preview.live_equivalence_prep?.record_template ?? null;
  return {
    id: "post_terminal_fresh_owner_packet_contract",
    schema_version: "fresh-owner-approved-runtime-packet-contract/v0.1",
    status: "required_before_any_new_runtime",
    candidate_family_id: candidate.family_id ?? packet.next_queue_candidate_after_owner_decision?.family_id ?? null,
    owner_route: candidate.owner_route ?? null,
    compatibility_route: candidate.compatibility_route ?? null,
    mutation: "none",
    mutation_allowed: false,
    previous_record_chain_reuse_allowed: false,
    required_sections: [
      "pro_route_ia_acceptance",
      "local_live_equivalence",
      "rollback_plan",
      "explicit_owner_approval",
    ],
    required_pro_route_ia_acceptance_checks: packet.owner_decision_acceptance_contract?.required_pro_route_ia_acceptance_checks ?? [],
    required_pro_screen_model_acceptance: {
      acceptance_ready: candidate.pro_screen_model_acceptance_ready ?? false,
      home_primary_allowed: candidate.home_primary_allowed ?? null,
      mobile_primary_allowed: candidate.mobile_primary_allowed ?? null,
    },
    required_live_equivalence: {
      schema_version: liveTemplate?.schema_version ?? null,
      proof_status_required: "local_runtime_smoke_passed",
      base_url: liveTemplate?.local_live_equivalence_base_url ?? null,
      rows: liveTemplate?.rows?.map((row) => ({
        role: row.role,
        path: row.path,
        paired_path: row.paired_path,
        expected_http_status: row.expected_http_status,
        command: row.command,
      })) ?? [],
    },
    required_rollback_plan: {
      schema_version: "rank2-rollback-plan-record/v0.1",
      rollback_scope: "plan_only_no_execution",
      route_patch_applied: false,
      rollback_applied: false,
      public_files_modified: false,
      redirect_config_changed: false,
      delete_paths: [],
    },
    required_explicit_owner_approval: {
      approved_by_required: true,
      approved_at_iso8601_required: true,
      mutation_scope_must_name: ["redirect", "delete", "deploy", "public_file_mutation"],
      execution_by_this_command_allowed: false,
    },
    blocked_actions_until_valid: ["redirect", "delete", "deploy", "public_file_mutation"],
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
  if (JSON.stringify(record.local_live_equivalence_rows) !== JSON.stringify(packet.evidence.smoke_rows)) {
    errors.push("decision record live-equivalence row set mismatch");
  }
  if (JSON.stringify(record.home_dashboard_legacy_bridge_entrypoints) !== JSON.stringify(packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows)) {
    errors.push("decision record Home/dashboard legacy bridge entrypoint set mismatch");
  }
  if (JSON.stringify(record.src_legacy_reference_rows) !== JSON.stringify(packet.evidence.src_legacy_reference_rows)) {
    errors.push("decision record source legacy reference set mismatch");
  }
  if (JSON.stringify(record.decision_options) !== JSON.stringify(packet.decision_options)) {
    errors.push("decision record option semantics mismatch");
  }
  if (JSON.stringify(record.release_blockers_acknowledged) !== JSON.stringify(packet.release_blockers)) {
    errors.push("decision record release blocker acknowledgement mismatch");
  }
  if (JSON.stringify(record.decision_followup_plans) !== JSON.stringify(ownerDecisionFollowupPlanContract(packet.decision_followup_plans))) {
    errors.push("decision record follow-up plan contract mismatch");
  }
  if (JSON.stringify(record.decision_followup_selection_contract) !== JSON.stringify(packet.owner_decision_acceptance_contract?.required_decision_followup_selection_contract)) {
    errors.push("decision record follow-up selection contract mismatch");
  }
  const selectedFollowupPlan = ownerDecisionSelectedFollowupPlanContract(packet.decision_followup_plans, record.decision);
  if (JSON.stringify(record.selected_decision_followup_plan) !== JSON.stringify(selectedFollowupPlan)) {
    errors.push("decision record selected follow-up plan must match the chosen decision");
  }
  if (JSON.stringify(record.reporting_summary_acknowledgement) !== JSON.stringify(packet.owner_decision_acceptance_contract?.required_reporting_summary_acknowledgement)) {
    errors.push("decision record reporting summary acknowledgement mismatch");
  }
  if (JSON.stringify(record.safe_enforcement_slice_acknowledgement) !== JSON.stringify(packet.owner_decision_acceptance_contract?.required_safe_enforcement_slice_acknowledgement)) {
    errors.push("decision record safe enforcement slice acknowledgement mismatch");
  }
  if (record.owner_route !== packet.owner_route || record.compatibility_route !== packet.compatibility_route) {
    errors.push("decision record route identity mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(packet.owner_decision_acceptance_contract?.required_pro_screen_model_acceptance)) {
    errors.push("decision record PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(packet.owner_decision_acceptance_contract?.required_pro_route_ia_acceptance_checks)) {
    errors.push("decision record PRO route/IA acceptance checks mismatch");
  }
  if (record.pro_screen_model_acceptance?.acceptance_ready !== true) {
    errors.push("decision record PRO screen-model acceptance must be ready");
  }
  if (record.pro_screen_model_acceptance?.home_primary_allowed !== false || record.pro_screen_model_acceptance?.mobile_primary_allowed !== false) {
    errors.push("decision record must keep legacy HTML out of Home/mobile primary IA");
  }
  if (record.mutation_approved !== false) {
    errors.push("decision record must not approve redirect/delete/deploy mutation");
  }
  if (record.execution_allowed !== false) {
    errors.push("decision record must not allow execution");
  }
  if (record.execution_by_this_command_allowed !== false) {
    errors.push("decision record must not allow execution by this command");
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
  if (JSON.stringify(record.required_evidence_detail_surface) !== JSON.stringify(template.required_evidence_detail_surface)) {
    errors.push("rank2 pre-activation record required_evidence_detail_surface mismatch");
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
  if (JSON.stringify(record.required_evidence_detail_surface) !== JSON.stringify(template.required_evidence_detail_surface)) {
    errors.push("decision followup record required_evidence_detail_surface mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(template.pro_route_ia_acceptance_checks)) {
    errors.push("decision followup record PRO route/IA acceptance checks mismatch");
  }
  if (!Array.isArray(record.pro_route_ia_acceptance_checks)
    || record.pro_route_ia_acceptance_checks.some((check) => check.status !== "pass")) {
    errors.push("decision followup record PRO route/IA acceptance checks must all pass");
  }
  if (record.mutation_approved !== false || record.separate_mutation_approval_required !== true) {
    errors.push("decision followup record must stay no-mutation with separate mutation approval required");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("decision followup record blocked actions mismatch");
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
    blocked_actions: routePatchBlockedActions(),
    required_records: requiredRecords,
    missing_records: missingRecords.map((record) => record.id),
    next_allowed_action: ready
      ? "start rank-2 owner review only; keep route patch, public mutation, rank-2 release, redirect/delete, and deploy blocked"
      : "supply the missing valid records before rank-2 owner review",
  };
}

function currentNextRequiredGate(packet) {
  const blockedActions = defaultBlockedActions();
  const common = {
    schema_version: "current-next-required-gate/v0.1",
    issue: packet.issue,
    family_id: packet.family_id,
    candidate_family_id: packet.next_queue_candidate_after_owner_decision?.family_id ?? null,
    mutation: "none",
    mutation_allowed: false,
    separate_mutation_approval_required: true,
    blocked_actions: blockedActions,
    required_pro_route_ia_acceptance_checks: packet.owner_decision_acceptance_contract?.required_pro_route_ia_acceptance_checks ?? [],
  };

  if (packet.decision_record_status !== "valid_no_mutation") {
    return {
      ...common,
      id: "macro_owner_decision_record",
      gate: packet.next_gated_slice?.id ?? "macro_owner_decision_record",
      status: "blocked_pending_owner_record",
      current_status: packet.decision_record_status,
      required_status: "valid_no_mutation",
      owner_record_required: true,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<json>'",
      next_allowed_action: "record preserve/remap/retire owner decision only; no route, public file, redirect/delete, or deploy mutation",
      required_valid_records: [],
      required_evidence: [
        "current macro owner decision record template",
        "locked local live-equivalence row set",
        "locked PRO route/IA acceptance contract",
      ],
      blocked_actions: ownerDecisionBlockedActions(),
    };
  }

  if (packet.decision_followup_record_status !== "valid_no_mutation_followup_recorded") {
    const selectedFollowupTemplate = selectedDecisionFollowupRecordTemplate(packet);
    return {
      ...common,
      id: "macro_owner_decision_followup_record",
      gate: packet.selected_decision_followup?.gate ?? "after_valid_owner_decision_before_rank_2_review",
      status: "blocked_pending_decision_followup_record",
      current_status: packet.decision_followup_record_status,
      required_status: "valid_no_mutation_followup_recorded",
      owner_record_required: true,
      selected_followup_id: packet.selected_decision_followup?.id ?? null,
      selected_decision: packet.selected_decision_followup?.decision ?? packet.supplied_decision_record?.decision ?? null,
      required_record_schema: selectedFollowupTemplate?.schema_version ?? null,
      required_followup_record_template: selectedFollowupTemplate,
      required_evidence_detail_surface: selectedFollowupTemplate?.required_evidence_detail_surface ?? null,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<json>'",
      next_allowed_action: packet.selected_decision_followup?.allowed_next_action ?? "record the selected no-mutation decision follow-up packet",
      blocked_actions: ownerDecisionBlockedActions(),
      required_valid_records: [
        {
          id: "rank1_owner_decision_record",
          status: packet.decision_record_status,
          required_status: "valid_no_mutation",
        },
      ],
      required_evidence: packet.selected_decision_followup?.required_evidence ?? [],
    };
  }

  if (packet.rank2_pre_activation_record_status !== "valid_no_mutation_pre_activation") {
    const preActivationTemplate = rank2PreActivationRecordTemplate(packet);
    return {
      ...common,
      id: "rank2_pre_activation_local_smoke_record",
      gate: "after_rank1_no_mutation_followup_before_rank2_owner_review",
      status: "blocked_pending_rank2_pre_activation_local_smoke_record",
      current_status: packet.rank2_pre_activation_record_status,
      required_status: "valid_no_mutation_pre_activation",
      owner_record_required: true,
      required_record_schema: preActivationTemplate?.schema_version ?? null,
      required_rank2_pre_activation_record_template: preActivationTemplate,
      required_evidence_detail_surface: preActivationTemplate?.required_evidence_detail_surface ?? null,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-pre-activation-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<json>'",
      next_allowed_action: "record inactive rank-2 local smoke proof only; keep rank 2 inactive and mutation blocked",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: [
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
      ],
      required_rows: packet.inactive_next_candidate_preview?.live_equivalence_prep?.record_template?.rows ?? [],
      required_evidence: packet.inactive_next_candidate_preview?.live_equivalence_prep?.required_before_active_review ?? [],
    };
  }

  if (!packet.rank2_review_readiness?.ready_for_rank2_owner_review) {
    return {
      ...common,
      id: "rank2_review_readiness",
      gate: "after_all_rank2_review_readiness_records",
      status: packet.rank2_review_readiness?.status ?? "blocked_pending_rank2_review_readiness",
      current_status: packet.rank2_review_readiness?.status ?? null,
      required_status: "ready_for_rank2_owner_review_no_mutation",
      owner_record_required: true,
      template_command: null,
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>'",
      next_allowed_action: "supply missing readiness records before rank-2 owner review",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: packet.rank2_review_readiness?.required_records ?? [],
      missing_records: packet.rank2_review_readiness?.missing_records ?? [],
      required_evidence: ["rank2_review_readiness must become ready without activating rank 2 or allowing mutation"],
    };
  }

  if (packet.rank2_owner_decision_record_status !== "valid_no_mutation_owner_review_recorded") {
    const ownerReviewTemplate = rank2OwnerReviewPacketTemplate(packet);
    const ownerDecisionTemplate = rank2OwnerDecisionRecordTemplate(packet);
    return {
      ...common,
      id: "rank2_owner_decision_record",
      gate: "after_rank2_review_readiness_before_any_rank2_route_mutation",
      status: "ready_for_rank2_owner_review_no_mutation",
      current_status: packet.rank2_owner_decision_record_status,
      required_status: "valid_no_mutation_owner_review_recorded",
      owner_record_required: true,
      required_record_schema: ownerDecisionTemplate?.schema_version ?? null,
      required_rank2_owner_review_template: ownerReviewTemplate,
      required_rank2_owner_decision_record_template: ownerDecisionTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<json>'",
      next_allowed_action: "ask owner to choose preserve/remap/retire for rank-2 review only; keep route patch, public mutation, rank-2 release, redirect/delete, and deploy blocked",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: packet.rank2_review_readiness.required_records,
      required_evidence: [
        "rank2_review_readiness=ready_for_rank2_owner_review_no_mutation",
        "rank2 owner review template stays rank2_active=false",
        "rank2 owner review template stays mutation_allowed=false",
      ],
    };
  }

  if (packet.rank2_owner_followup_record_status !== "valid_no_mutation_owner_followup_recorded") {
    const selectedFollowupTemplate = selectedRank2OwnerFollowupRecordTemplate(packet);
    return {
      ...common,
      id: "rank2_owner_followup_record",
      gate: packet.selected_rank2_owner_followup?.gate ?? "after_valid_rank2_owner_decision_before_any_mutation_approval",
      status: "blocked_pending_rank2_owner_followup_record",
      current_status: packet.rank2_owner_followup_record_status,
      required_status: "valid_no_mutation_owner_followup_recorded",
      owner_record_required: true,
      selected_followup_id: packet.selected_rank2_owner_followup?.id ?? null,
      selected_decision: packet.selected_rank2_owner_followup?.decision ?? packet.supplied_rank2_owner_decision_record?.decision ?? null,
      required_record_schema: selectedFollowupTemplate?.schema_version ?? null,
      required_rank2_owner_followup_record_template: selectedFollowupTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<json>'",
      next_allowed_action: packet.selected_rank2_owner_followup?.allowed_next_action ?? "record the selected rank-2 no-mutation follow-up packet",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: [
        {
          id: "rank2_owner_decision_record",
          status: packet.rank2_owner_decision_record_status,
          required_status: "valid_no_mutation_owner_review_recorded",
        },
      ],
      required_evidence: packet.selected_rank2_owner_followup?.required_evidence ?? [],
    };
  }

  if (!packet.rank2_mutation_approval_readiness?.ready_for_mutation_approval_request) {
    return {
      ...common,
      id: "rank2_mutation_approval_readiness",
      gate: "after_rank2_owner_followup_before_mutation_approval_request",
      status: packet.rank2_mutation_approval_readiness?.status ?? "blocked_pending_rank2_mutation_approval_readiness",
      current_status: packet.rank2_mutation_approval_readiness?.status ?? null,
      required_status: "ready_for_separate_owner_mutation_approval_request_no_execution",
      owner_record_required: true,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-mutation-approval-request-template",
      validation_command: null,
      next_allowed_action: "prepare a separate owner mutation approval request only; no route mutation, redirect/delete, deploy, or public file mutation",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: packet.rank2_mutation_approval_readiness?.required_records ?? [],
      missing_records: packet.rank2_mutation_approval_readiness?.missing_records ?? [],
      required_evidence: ["rank2_mutation_approval_readiness must be ready before any separate mutation approval request"],
    };
  }

  if (packet.rank2_mutation_approval_record_status !== "valid_owner_approved_no_execution") {
    const requestTemplate = packet.rank2_mutation_approval_request_template ?? rank2MutationApprovalRequestTemplate(packet);
    const approvalTemplate = packet.rank2_mutation_approval_record_template ?? rank2MutationApprovalRecordTemplate(packet);
    return {
      ...common,
      id: "rank2_mutation_approval_record",
      gate: "after_rank2_owner_followup_before_any_route_patch",
      status: requestTemplate?.status ?? packet.rank2_mutation_approval_readiness.status,
      current_status: packet.rank2_mutation_approval_record_status,
      required_status: "valid_owner_approved_no_execution",
      owner_record_required: true,
      required_record_schema: approvalTemplate?.schema_version ?? null,
      required_rank2_mutation_approval_request_template: requestTemplate,
      required_rank2_mutation_approval_record_template: approvalTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-mutation-approval-request-template",
      approval_record_template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-mutation-approval-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<json>'",
      next_allowed_action: "ask owner for a separate mutation approval record only; no route patch, redirect/delete, deploy, or public file mutation",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: packet.rank2_mutation_approval_readiness.required_records,
      required_evidence: [
        "rank2_mutation_approval_readiness=ready_for_separate_owner_mutation_approval_request_no_execution",
        "rank2 mutation approval request template stays request_only=true",
        "rank2 mutation approval record template stays record_only_no_execution",
        "route_patch/redirect/delete/deploy/public mutation/rank-2 release stay blocked by the request and record templates",
      ],
    };
  }

  if (packet.rank2_route_diff_proposal_record_status !== "valid_no_mutation_route_diff_proposal_recorded") {
    const proposalTemplate = packet.rank2_route_diff_proposal_template ?? rank2RouteDiffProposalTemplate(packet);
    return {
      ...common,
      id: "rank2_route_diff_proposal_record",
      gate: "after_valid_mutation_approval_record_before_any_route_file_patch",
      status: proposalTemplate?.proposal_status ?? "blocked_pending_route_diff_proposal_record",
      current_status: packet.rank2_route_diff_proposal_record_status,
      required_status: "valid_no_mutation_route_diff_proposal_recorded",
      owner_record_required: true,
      required_record_schema: proposalTemplate?.schema_version ?? null,
      required_rank2_route_diff_proposal_record_template: proposalTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-route-diff-proposal-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<json>'",
      next_allowed_action: "record a draft route/file diff proposal only; no route patch, redirect/delete, deploy, or public file mutation",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: [
        {
          id: "rank2_mutation_approval_record",
          status: packet.rank2_mutation_approval_record_status,
          required_status: "valid_owner_approved_no_execution",
        },
      ],
      required_evidence: [
        "rank2_mutation_approval_record_status=valid_owner_approved_no_execution",
        "rank2 route diff proposal template stays draft_no_mutation",
        "route/file patch, public files, redirect/delete, deploy, and execution stay blocked",
      ],
    };
  }

  if (packet.rank2_rollback_plan_record_status !== "valid_no_mutation_rollback_plan_recorded") {
    const rollbackTemplate = packet.rank2_rollback_plan_template ?? rank2RollbackPlanTemplate(packet);
    return {
      ...common,
      id: "rank2_rollback_plan_record",
      gate: "after_valid_route_diff_proposal_before_any_route_execution",
      status: rollbackTemplate?.rollback_plan_status ?? "blocked_pending_rollback_plan_record",
      current_status: packet.rank2_rollback_plan_record_status,
      required_status: "valid_no_mutation_rollback_plan_recorded",
      owner_record_required: true,
      required_record_schema: rollbackTemplate?.schema_version ?? null,
      required_rank2_rollback_plan_record_template: rollbackTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-rollback-plan-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<json>'",
      next_allowed_action: "record a rollback plan only; no rollback, route patch, redirect/delete, deploy, execution, or public file mutation",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: [
        {
          id: "rank2_route_diff_proposal_record",
          status: packet.rank2_route_diff_proposal_record_status,
          required_status: "valid_no_mutation_route_diff_proposal_recorded",
        },
      ],
      required_evidence: [
        "rank2_route_diff_proposal_record_status=valid_no_mutation_route_diff_proposal_recorded",
        "rank2 rollback plan template stays plan_only_no_execution",
        "rollback, route/file patch, public files, redirect/delete, deploy, and execution stay blocked",
      ],
    };
  }

  if (packet.rank2_local_post_patch_smoke_plan_record_status !== "valid_no_mutation_local_post_patch_smoke_plan_recorded") {
    const smokePlanTemplate = packet.rank2_local_post_patch_smoke_plan_template ?? rank2LocalPostPatchSmokePlanTemplate(packet);
    return {
      ...common,
      id: "rank2_local_post_patch_smoke_plan_record",
      gate: "after_valid_rollback_plan_before_any_route_execution",
      status: smokePlanTemplate?.smoke_plan_status ?? "blocked_pending_local_post_patch_smoke_plan_record",
      current_status: packet.rank2_local_post_patch_smoke_plan_record_status,
      required_status: "valid_no_mutation_local_post_patch_smoke_plan_recorded",
      owner_record_required: true,
      required_record_schema: smokePlanTemplate?.schema_version ?? null,
      required_rank2_local_post_patch_smoke_plan_record_template: smokePlanTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-local-post-patch-smoke-plan-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<json>'",
      next_allowed_action: "record a local post-patch smoke plan only; no patch, rollback, runtime smoke, redirect/delete, deploy, execution, or public file mutation",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: [
        {
          id: "rank2_rollback_plan_record",
          status: packet.rank2_rollback_plan_record_status,
          required_status: "valid_no_mutation_rollback_plan_recorded",
        },
      ],
      required_evidence: [
        "rank2_rollback_plan_record_status=valid_no_mutation_rollback_plan_recorded",
        "rank2 local post-patch smoke plan template stays plan_only_no_runtime",
        "patch, rollback, runtime smoke, public files, redirect/delete, deploy, and execution stay blocked",
      ],
    };
  }

  if (packet.rank2_explicit_deploy_approval_record_status !== "valid_explicit_deploy_approval_recorded_no_runtime") {
    const deployApprovalTemplate = packet.rank2_explicit_deploy_approval_template ?? rank2ExplicitDeployApprovalTemplate(packet);
    return {
      ...common,
      id: "rank2_explicit_deploy_approval_record",
      gate: "after_valid_local_post_patch_smoke_plan_before_any_route_execution",
      status: deployApprovalTemplate?.approval_status ?? "blocked_pending_explicit_deploy_approval_record",
      current_status: packet.rank2_explicit_deploy_approval_record_status,
      required_status: "valid_explicit_deploy_approval_recorded_no_runtime",
      owner_record_required: true,
      required_record_schema: deployApprovalTemplate?.schema_version ?? null,
      required_rank2_explicit_deploy_approval_record_template: deployApprovalTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-explicit-deploy-approval-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<json>'",
      next_allowed_action: "record explicit deploy approval only; no deploy, runtime smoke, route patch, redirect/delete, execution, or public file mutation",
      blocked_actions: routePatchBlockedActions(),
      required_valid_records: [
        {
          id: "rank2_local_post_patch_smoke_plan_record",
          status: packet.rank2_local_post_patch_smoke_plan_record_status,
          required_status: "valid_no_mutation_local_post_patch_smoke_plan_recorded",
        },
      ],
      required_evidence: [
        "rank2_local_post_patch_smoke_plan_record_status=valid_no_mutation_local_post_patch_smoke_plan_recorded",
        "rank2 explicit deploy approval template stays record_only_no_deploy",
        "deploy execution, live smoke, route patch, public files, redirect/delete, and execution stay blocked",
      ],
    };
  }

  const executionReadinessGate = {
    ...common,
    id: "rank2_execution_readiness",
    gate: "after_valid_mutation_approval_record_before_execution_prerequisites",
    status: packet.rank2_execution_readiness?.status ?? "blocked_pending_execution_prerequisites",
    current_status: packet.rank2_execution_readiness?.status ?? null,
    required_status: "all_prerequisites_recorded_no_runtime",
    owner_record_required: true,
    template_command: null,
    validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>'",
    next_allowed_action: "record route/file diff, rollback, local smoke plan, and explicit deploy approval prerequisites only; no route patch, redirect/delete, deploy, or public file mutation",
    blocked_actions: routePatchBlockedActions(),
    required_valid_records: [
      {
        id: "rank2_mutation_approval_record",
        status: packet.rank2_mutation_approval_record_status,
        required_status: "valid_owner_approved_no_execution",
      },
    ],
    missing_prerequisites: packet.rank2_execution_readiness?.missing_prerequisites ?? [],
    required_evidence: ["rank2 execution readiness must stay no-runtime until all execution prerequisite records are supplied"],
  };

  if (packet.rank2_execution_readiness?.status !== "all_prerequisites_recorded_no_runtime") {
    return executionReadinessGate;
  }

  if (packet.rank2_route_execution_packet_record_status !== "valid_route_execution_packet_recorded_no_runtime") {
    const routeExecutionPacketTemplate = packet.rank2_route_execution_packet_template ?? rank2RouteExecutionPacketTemplate(packet);
    return {
      ...common,
      id: "rank2_route_execution_packet_record",
      gate: "after_execution_readiness_before_any_route_patch",
      status: routeExecutionPacketTemplate?.execution_packet_status ?? "blocked_pending_route_execution_packet_record",
      current_status: packet.rank2_route_execution_packet_record_status,
      required_status: "valid_route_execution_packet_recorded_no_runtime",
      owner_record_required: true,
      required_record_schema: routeExecutionPacketTemplate?.schema_version ?? null,
      required_rank2_route_execution_packet_record_template: routeExecutionPacketTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-route-execution-packet-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<json>'",
      next_allowed_action: "record a route execution packet only; no route patch, post-patch smoke, deploy, live smoke, redirect/delete, execution, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_execution_readiness",
          status: packet.rank2_execution_readiness?.status,
          required_status: "all_prerequisites_recorded_no_runtime",
        },
      ],
      required_evidence: [
        "rank2_execution_readiness=all_prerequisites_recorded_no_runtime",
        "rank2 route execution packet template stays record_only_no_runtime",
        "route patch, post-patch smoke, deploy, live smoke, public files, redirect/delete, and execution stay blocked",
      ],
    };
  }

  if (packet.rank2_owner_runtime_release_record_status !== "valid_owner_runtime_release_recorded_no_execution") {
    const ownerRuntimeReleaseTemplate = packet.rank2_owner_runtime_release_template ?? rank2OwnerRuntimeReleaseTemplate(packet);
    return {
      ...common,
      id: "rank2_owner_runtime_release_record",
      gate: "after_valid_route_execution_packet_before_any_route_patch",
      status: ownerRuntimeReleaseTemplate?.release_status ?? "blocked_pending_owner_runtime_release_record",
      current_status: packet.rank2_owner_runtime_release_record_status,
      required_status: "valid_owner_runtime_release_recorded_no_execution",
      owner_record_required: true,
      required_record_schema: ownerRuntimeReleaseTemplate?.schema_version ?? null,
      required_rank2_owner_runtime_release_record_template: ownerRuntimeReleaseTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-owner-runtime-release-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<json>'",
      next_allowed_action: "record owner runtime release only; no route patch, post-patch smoke, deploy, live smoke, redirect/delete, execution, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_route_execution_packet_record",
          status: packet.rank2_route_execution_packet_record_status,
          required_status: "valid_route_execution_packet_recorded_no_runtime",
        },
      ],
      required_evidence: [
        "rank2_route_execution_packet_record_status=valid_route_execution_packet_recorded_no_runtime",
        "rank2 owner runtime release template stays record_only_before_runtime",
        "route patch, post-patch smoke, deploy, live smoke, public files, redirect/delete, and execution stay blocked",
      ],
    };
  }

  if (packet.rank2_route_patch_application_record_status !== "valid_route_patch_application_recorded_no_smoke_no_deploy") {
    const routePatchApplicationTemplate = packet.rank2_route_patch_application_template ?? rank2RoutePatchApplicationTemplate(packet);
    return {
      ...common,
      id: "rank2_route_patch_application_record",
      gate: "after_valid_owner_runtime_release_before_post_patch_smoke_or_deploy",
      status: routePatchApplicationTemplate?.patch_status ?? "blocked_pending_route_patch_application_record",
      current_status: packet.rank2_route_patch_application_record_status,
      required_status: "valid_route_patch_application_recorded_no_smoke_no_deploy",
      owner_record_required: true,
      required_record_schema: routePatchApplicationTemplate?.schema_version ?? null,
      required_rank2_route_patch_application_record_template: routePatchApplicationTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-route-patch-application-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<json>'",
      next_allowed_action: "record route patch application only; no post-patch smoke, deploy, live smoke, redirect/delete, execution by this command, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_owner_runtime_release_record",
          status: packet.rank2_owner_runtime_release_record_status,
          required_status: "valid_owner_runtime_release_recorded_no_execution",
        },
      ],
      required_evidence: [
        "rank2_owner_runtime_release_record_status=valid_owner_runtime_release_recorded_no_execution",
        "rank2 route patch application template stays record_only_local_patch_no_smoke_no_deploy",
        "post-patch smoke, deploy, live smoke, public files, redirect/delete, and execution by this command stay blocked",
      ],
    };
  }

  if (packet.rank2_local_post_patch_smoke_record_status !== "valid_local_post_patch_smoke_recorded_no_deploy") {
    const localPostPatchSmokeRecordTemplate = packet.rank2_local_post_patch_smoke_record_template ?? rank2LocalPostPatchSmokeRecordTemplate(packet);
    return {
      ...common,
      id: "rank2_local_post_patch_smoke_record",
      gate: "after_valid_route_patch_application_before_deploy_or_live_smoke",
      status: localPostPatchSmokeRecordTemplate?.smoke_status ?? "blocked_pending_local_post_patch_smoke_record",
      current_status: packet.rank2_local_post_patch_smoke_record_status,
      required_status: "valid_local_post_patch_smoke_recorded_no_deploy",
      owner_record_required: true,
      required_record_schema: localPostPatchSmokeRecordTemplate?.schema_version ?? null,
      required_rank2_local_post_patch_smoke_record_template: localPostPatchSmokeRecordTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-local-post-patch-smoke-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<json>'",
      next_allowed_action: "record local post-patch smoke results only; no deploy, production live smoke, redirect/delete, execution by this command, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_route_patch_application_record",
          status: packet.rank2_route_patch_application_record_status,
          required_status: "valid_route_patch_application_recorded_no_smoke_no_deploy",
        },
      ],
      required_evidence: [
        "rank2_route_patch_application_record_status=valid_route_patch_application_recorded_no_smoke_no_deploy",
        "rank2 local post-patch smoke template stays local_runtime_only_no_deploy",
        "deploy, production live smoke, public files, redirect/delete, and execution by this command stay blocked",
      ],
    };
  }

  if (packet.rank2_deploy_execution_record_status !== "valid_deploy_execution_recorded_no_live_smoke") {
    const deployExecutionTemplate = packet.rank2_deploy_execution_template ?? rank2DeployExecutionTemplate(packet);
    return {
      ...common,
      id: "rank2_deploy_execution_record",
      gate: "after_valid_local_post_patch_smoke_before_production_live_smoke",
      status: deployExecutionTemplate?.deploy_status ?? "blocked_pending_deploy_execution_record",
      current_status: packet.rank2_deploy_execution_record_status,
      required_status: "valid_deploy_execution_recorded_no_live_smoke",
      owner_record_required: true,
      required_record_schema: deployExecutionTemplate?.schema_version ?? null,
      required_rank2_deploy_execution_record_template: deployExecutionTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-deploy-execution-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<json>'",
      next_allowed_action: "record deploy execution only; no production live smoke, redirect/delete, execution by this command, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_local_post_patch_smoke_record",
          status: packet.rank2_local_post_patch_smoke_record_status,
          required_status: "valid_local_post_patch_smoke_recorded_no_deploy",
        },
      ],
      required_evidence: [
        "rank2_local_post_patch_smoke_record_status=valid_local_post_patch_smoke_recorded_no_deploy",
        "rank2 deploy execution template stays record_only_deploy_no_live_smoke",
        "production live smoke, public files, redirect/delete, and execution by this command stay blocked",
      ],
    };
  }

  if (packet.rank2_production_live_smoke_record_status !== "valid_production_live_smoke_recorded_no_redirect_no_delete") {
    const productionLiveSmokeTemplate = packet.rank2_production_live_smoke_template ?? rank2ProductionLiveSmokeTemplate(packet);
    return {
      ...common,
      id: "rank2_production_live_smoke_record",
      gate: "after_valid_deploy_execution_before_redirect_or_delete",
      status: productionLiveSmokeTemplate?.production_live_smoke_status ?? "blocked_pending_production_live_smoke_record",
      current_status: packet.rank2_production_live_smoke_record_status,
      required_status: "valid_production_live_smoke_recorded_no_redirect_no_delete",
      owner_record_required: true,
      required_record_schema: productionLiveSmokeTemplate?.schema_version ?? null,
      required_rank2_production_live_smoke_record_template: productionLiveSmokeTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-production-live-smoke-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<json>'",
      next_allowed_action: "record production live smoke results only; no redirect/delete, execution by this command, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_deploy_execution_record",
          status: packet.rank2_deploy_execution_record_status,
          required_status: "valid_deploy_execution_recorded_no_live_smoke",
        },
      ],
      required_evidence: [
        "rank2_deploy_execution_record_status=valid_deploy_execution_recorded_no_live_smoke",
        "rank2 production live smoke template stays production_live_smoke_only_no_redirect_no_delete",
        "redirect/delete, public files, and execution by this command stay blocked",
      ],
    };
  }

  if (packet.rank2_post_live_redirect_delete_approval_request_record_status !== "valid_post_live_redirect_delete_approval_requested_no_execution") {
    const postLiveApprovalRequestTemplate = packet.rank2_post_live_redirect_delete_approval_request_template
      ?? rank2PostLiveRedirectDeleteApprovalRequestTemplate(packet);
    return {
      ...common,
      id: "rank2_post_live_redirect_delete_approval_request",
      gate: "after_valid_production_live_smoke_before_redirect_delete_owner_approval",
      status: postLiveApprovalRequestTemplate?.request_status ?? "blocked_pending_post_live_redirect_delete_approval_request",
      current_status: packet.rank2_post_live_redirect_delete_approval_request_record_status,
      required_status: "valid_post_live_redirect_delete_approval_requested_no_execution",
      owner_record_required: true,
      required_record_schema: postLiveApprovalRequestTemplate?.schema_version ?? null,
      required_rank2_post_live_redirect_delete_approval_request_record_template: postLiveApprovalRequestTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-approval-request-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<production-live-smoke-json>' --rank2-post-live-redirect-delete-approval-request-json='<json>'",
      next_allowed_action: "record post-live redirect/delete approval request only; no redirect/delete, execution by this command, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_production_live_smoke_record",
          status: packet.rank2_production_live_smoke_record_status,
          required_status: "valid_production_live_smoke_recorded_no_redirect_no_delete",
        },
      ],
      required_evidence: [
        "rank2_production_live_smoke_record_status=valid_production_live_smoke_recorded_no_redirect_no_delete",
        "rank2 post-live redirect/delete approval request template stays post_live_request_only_no_redirect_no_delete",
        "redirect/delete, public files, and execution by this command stay blocked",
      ],
    };
  }

  if (packet.rank2_post_live_redirect_delete_approval_record_status !== "valid_post_live_redirect_delete_approved_no_execution") {
    const postLiveApprovalRecordTemplate = packet.rank2_post_live_redirect_delete_approval_record_template
      ?? rank2PostLiveRedirectDeleteApprovalRecordTemplate(packet);
    return {
      ...common,
      id: "rank2_post_live_redirect_delete_approval_record",
      gate: "after_valid_post_live_request_before_redirect_delete_execution_packet",
      status: postLiveApprovalRecordTemplate?.approval_status ?? "blocked_pending_post_live_redirect_delete_approval_record",
      current_status: packet.rank2_post_live_redirect_delete_approval_record_status,
      required_status: "valid_post_live_redirect_delete_approved_no_execution",
      owner_record_required: true,
      required_record_schema: postLiveApprovalRecordTemplate?.schema_version ?? null,
      required_rank2_post_live_redirect_delete_approval_record_template: postLiveApprovalRecordTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-approval-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<production-live-smoke-json>' --rank2-post-live-redirect-delete-approval-request-json='<approval-request-json>' --rank2-post-live-redirect-delete-approval-record-json='<json>'",
      next_allowed_action: "record post-live redirect/delete owner approval only; no redirect/delete execution by this command or public file mutation",
      required_valid_records: [
        {
          id: "rank2_post_live_redirect_delete_approval_request_record",
          status: packet.rank2_post_live_redirect_delete_approval_request_record_status,
          required_status: "valid_post_live_redirect_delete_approval_requested_no_execution",
        },
      ],
      required_evidence: [
        "rank2_post_live_redirect_delete_approval_request_record_status=valid_post_live_redirect_delete_approval_requested_no_execution",
        "rank2 post-live redirect/delete approval record template stays record_only_no_redirect_no_delete",
        "redirect/delete execution remains blocked until a separate execution packet",
      ],
    };
  }

  if (packet.rank2_post_live_redirect_delete_execution_packet_record_status !== "valid_post_live_redirect_delete_execution_packet_recorded_no_execution") {
    const postLiveExecutionPacketTemplate = packet.rank2_post_live_redirect_delete_execution_packet_template
      ?? rank2PostLiveRedirectDeleteExecutionPacketTemplate(packet);
    return {
      ...common,
      id: "rank2_post_live_redirect_delete_execution_packet",
      gate: "after_valid_post_live_owner_approval_before_redirect_delete_execution_record",
      status: postLiveExecutionPacketTemplate?.execution_packet_status ?? "blocked_pending_post_live_redirect_delete_execution_packet",
      current_status: packet.rank2_post_live_redirect_delete_execution_packet_record_status,
      required_status: "valid_post_live_redirect_delete_execution_packet_recorded_no_execution",
      owner_record_required: true,
      required_record_schema: postLiveExecutionPacketTemplate?.schema_version ?? null,
      required_rank2_post_live_redirect_delete_execution_packet_record_template: postLiveExecutionPacketTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-execution-packet-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<production-live-smoke-json>' --rank2-post-live-redirect-delete-approval-request-json='<approval-request-json>' --rank2-post-live-redirect-delete-approval-record-json='<approval-record-json>' --rank2-post-live-redirect-delete-execution-packet-json='<json>'",
      next_allowed_action: "record post-live redirect/delete execution packet only; no redirect/delete execution by this command or public file mutation",
      required_valid_records: [
        {
          id: "rank2_post_live_redirect_delete_approval_record",
          status: packet.rank2_post_live_redirect_delete_approval_record_status,
          required_status: "valid_post_live_redirect_delete_approved_no_execution",
        },
      ],
      required_evidence: [
        "rank2_post_live_redirect_delete_approval_record_status=valid_post_live_redirect_delete_approved_no_execution",
        "rank2 post-live redirect/delete execution packet template stays packet_only_no_redirect_no_delete",
        "redirect/delete execution remains blocked until a separate execution record",
      ],
    };
  }

  if (packet.rank2_post_live_redirect_delete_execution_record_status !== "valid_post_live_redirect_delete_execution_recorded_pending_smoke") {
    const postLiveExecutionRecordTemplate = packet.rank2_post_live_redirect_delete_execution_record_template
      ?? rank2PostLiveRedirectDeleteExecutionRecordTemplate(packet);
    return {
      ...common,
      id: "rank2_post_live_redirect_delete_execution_record",
      gate: "after_valid_post_live_redirect_delete_execution_packet_before_post_execution_smoke",
      status: postLiveExecutionRecordTemplate?.execution_record_status ?? "blocked_pending_post_live_redirect_delete_execution_record",
      current_status: packet.rank2_post_live_redirect_delete_execution_record_status,
      required_status: "valid_post_live_redirect_delete_execution_recorded_pending_smoke",
      owner_record_required: true,
      required_record_schema: postLiveExecutionRecordTemplate?.schema_version ?? null,
      required_rank2_post_live_redirect_delete_execution_record_template: postLiveExecutionRecordTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-execution-record-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<production-live-smoke-json>' --rank2-post-live-redirect-delete-approval-request-json='<approval-request-json>' --rank2-post-live-redirect-delete-approval-record-json='<approval-record-json>' --rank2-post-live-redirect-delete-execution-packet-json='<execution-packet-json>' --rank2-post-live-redirect-delete-execution-record-json='<json>'",
      next_allowed_action: "record externally performed redirect/delete execution evidence only; this command must not execute redirect/delete, deploy, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_post_live_redirect_delete_execution_packet_record",
          status: packet.rank2_post_live_redirect_delete_execution_packet_record_status,
          required_status: "valid_post_live_redirect_delete_execution_packet_recorded_no_execution",
        },
      ],
      required_evidence: [
        "rank2_post_live_redirect_delete_execution_packet_record_status=valid_post_live_redirect_delete_execution_packet_recorded_no_execution",
        "rank2 post-live redirect/delete execution record template marks execution_performed_outside_this_command=true",
        "execution_performed_by_this_command, local_files_modified_by_this_command, redirect_config_changed_by_this_command, and delete_performed_by_this_command stay false",
      ],
    };
  }

  if (packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status !== "valid_post_live_redirect_delete_post_execution_smoke_recorded") {
    const postExecutionSmokeTemplate = packet.rank2_post_live_redirect_delete_post_execution_smoke_template
      ?? rank2PostLiveRedirectDeletePostExecutionSmokeTemplate(packet);
    return {
      ...common,
      id: "rank2_post_live_redirect_delete_post_execution_smoke_record",
      gate: "after_valid_post_live_redirect_delete_execution_record_before_rollback_readiness",
      status: postExecutionSmokeTemplate?.post_execution_smoke_status ?? "blocked_pending_post_execution_smoke_record",
      current_status: packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status,
      required_status: "valid_post_live_redirect_delete_post_execution_smoke_recorded",
      owner_record_required: true,
      required_record_schema: postExecutionSmokeTemplate?.schema_version ?? null,
      required_rank2_post_live_redirect_delete_post_execution_smoke_record_template: postExecutionSmokeTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-post-execution-smoke-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<production-live-smoke-json>' --rank2-post-live-redirect-delete-approval-request-json='<approval-request-json>' --rank2-post-live-redirect-delete-approval-record-json='<approval-record-json>' --rank2-post-live-redirect-delete-execution-packet-json='<execution-packet-json>' --rank2-post-live-redirect-delete-execution-record-json='<execution-record-json>' --rank2-post-live-redirect-delete-post-execution-smoke-json='<json>'",
      next_allowed_action: "record externally performed post-execution smoke evidence only; this command must not run smoke, redirect/delete, deploy, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_post_live_redirect_delete_execution_record",
          status: packet.rank2_post_live_redirect_delete_execution_record_status,
          required_status: "valid_post_live_redirect_delete_execution_recorded_pending_smoke",
        },
      ],
      required_evidence: [
        "rank2_post_live_redirect_delete_execution_record_status=valid_post_live_redirect_delete_execution_recorded_pending_smoke",
        "rank2 post-execution smoke template stays post_execution_smoke_only_no_additional_redirect_delete_no_deploy",
        "smoke_performed_by_this_command, execution_performed_by_this_command, and by-this-command mutation flags stay false",
      ],
    };
  }

  if (packet.rank2_post_live_redirect_delete_rollback_readiness_record_status !== "valid_post_live_redirect_delete_rollback_readiness_recorded") {
    const rollbackReadinessTemplate = packet.rank2_post_live_redirect_delete_rollback_readiness_template
      ?? rank2PostLiveRedirectDeleteRollbackReadinessTemplate(packet);
    return {
      ...common,
      id: "rank2_post_live_redirect_delete_rollback_readiness_record",
      gate: "after_valid_post_execution_smoke_before_owner_closeout",
      status: rollbackReadinessTemplate?.rollback_readiness_status ?? "blocked_pending_rollback_readiness_record",
      current_status: packet.rank2_post_live_redirect_delete_rollback_readiness_record_status,
      required_status: "valid_post_live_redirect_delete_rollback_readiness_recorded",
      owner_record_required: true,
      required_record_schema: rollbackReadinessTemplate?.schema_version ?? null,
      required_rank2_post_live_redirect_delete_rollback_readiness_record_template: rollbackReadinessTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-rollback-readiness-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<production-live-smoke-json>' --rank2-post-live-redirect-delete-approval-request-json='<approval-request-json>' --rank2-post-live-redirect-delete-approval-record-json='<approval-record-json>' --rank2-post-live-redirect-delete-execution-packet-json='<execution-packet-json>' --rank2-post-live-redirect-delete-execution-record-json='<execution-record-json>' --rank2-post-live-redirect-delete-post-execution-smoke-json='<post-execution-smoke-json>' --rank2-post-live-redirect-delete-rollback-readiness-json='<json>'",
      next_allowed_action: "record rollback readiness evidence only; this command must not run rollback, smoke, redirect/delete, deploy, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_post_live_redirect_delete_post_execution_smoke_record",
          status: packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status,
          required_status: "valid_post_live_redirect_delete_post_execution_smoke_recorded",
        },
      ],
      required_evidence: [
        "rank2_post_live_redirect_delete_post_execution_smoke_record_status=valid_post_live_redirect_delete_post_execution_smoke_recorded",
        "rank2 rollback readiness template stays record_only_rollback_readiness_no_rollback_no_deploy",
        "rollback_applied and rollback_performed_by_this_command stay false",
      ],
    };
  }

  if (packet.rank2_post_live_redirect_delete_owner_closeout_record_status !== "valid_post_live_redirect_delete_owner_closeout_recorded") {
    const ownerCloseoutTemplate = packet.rank2_post_live_redirect_delete_owner_closeout_template
      ?? rank2PostLiveRedirectDeleteOwnerCloseoutTemplate(packet);
    return {
      ...common,
      id: "rank2_post_live_redirect_delete_owner_closeout_record",
      gate: "after_valid_rollback_readiness_before_record_chain_close",
      status: ownerCloseoutTemplate?.owner_closeout_status ?? "blocked_pending_owner_closeout_record",
      current_status: packet.rank2_post_live_redirect_delete_owner_closeout_record_status,
      required_status: "valid_post_live_redirect_delete_owner_closeout_recorded",
      owner_record_required: true,
      required_record_schema: ownerCloseoutTemplate?.schema_version ?? null,
      required_rank2_post_live_redirect_delete_owner_closeout_record_template: ownerCloseoutTemplate,
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-owner-closeout-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --decision-record-json='<owner-json>' --decision-followup-record-json='<followup-json>' --rank2-pre-activation-record-json='<rank2-smoke-json>' --rank2-owner-decision-record-json='<rank2-owner-json>' --rank2-owner-followup-record-json='<rank2-followup-json>' --rank2-mutation-approval-record-json='<approval-json>' --rank2-route-diff-proposal-json='<route-diff-json>' --rank2-rollback-plan-json='<rollback-json>' --rank2-local-post-patch-smoke-plan-json='<smoke-plan-json>' --rank2-explicit-deploy-approval-json='<deploy-approval-json>' --rank2-route-execution-packet-json='<route-execution-packet-json>' --rank2-owner-runtime-release-json='<owner-runtime-release-json>' --rank2-route-patch-application-json='<route-patch-application-json>' --rank2-local-post-patch-smoke-record-json='<local-smoke-json>' --rank2-deploy-execution-json='<deploy-json>' --rank2-production-live-smoke-json='<production-live-smoke-json>' --rank2-post-live-redirect-delete-approval-request-json='<approval-request-json>' --rank2-post-live-redirect-delete-approval-record-json='<approval-record-json>' --rank2-post-live-redirect-delete-execution-packet-json='<execution-packet-json>' --rank2-post-live-redirect-delete-execution-record-json='<execution-record-json>' --rank2-post-live-redirect-delete-post-execution-smoke-json='<post-execution-smoke-json>' --rank2-post-live-redirect-delete-rollback-readiness-json='<rollback-readiness-json>' --rank2-post-live-redirect-delete-owner-closeout-json='<json>'",
      next_allowed_action: "record final owner closeout evidence only; this command must not run closeout, rollback, smoke, redirect/delete, deploy, or public file mutation",
      required_valid_records: [
        {
          id: "rank2_post_live_redirect_delete_rollback_readiness_record",
          status: packet.rank2_post_live_redirect_delete_rollback_readiness_record_status,
          required_status: "valid_post_live_redirect_delete_rollback_readiness_recorded",
        },
      ],
      required_evidence: [
        "rank2_post_live_redirect_delete_rollback_readiness_record_status=valid_post_live_redirect_delete_rollback_readiness_recorded",
        "rank2 owner closeout template stays record_only_owner_closeout_no_additional_runtime",
        "additional_runtime_required and closeout_performed_by_this_command stay false",
      ],
    };
  }

  if (packet.rank2_fresh_owner_runtime_packet_record_status === "valid_fresh_owner_runtime_packet_recorded_no_execution") {
    const runtimeExecutionPacketTemplate = packet.rank2_fresh_owner_runtime_execution_packet_template
      ?? rank2FreshOwnerRuntimeExecutionPacketTemplate(packet);
    if (packet.rank2_fresh_owner_runtime_execution_packet_record_status !== "valid_fresh_owner_runtime_execution_packet_recorded_no_execution") {
      return {
        ...common,
        id: "rank2_fresh_owner_runtime_execution_packet_record",
        gate: "after_valid_fresh_owner_packet_before_any_runtime_execution",
        status: "blocked_pending_fresh_owner_runtime_execution_packet",
        current_status: packet.rank2_fresh_owner_runtime_execution_packet_record_status,
        required_status: "valid_fresh_owner_runtime_execution_packet_recorded_no_execution",
        owner_record_required: true,
        required_record_schema: runtimeExecutionPacketTemplate?.schema_version ?? null,
        required_rank2_fresh_owner_runtime_execution_packet_record_template: runtimeExecutionPacketTemplate,
        template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-execution-packet-template",
        validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<json>'",
        next_allowed_action: "record a separate runtime execution packet only; no route patch, redirect/delete, deploy, public file mutation, or runtime execution by this command",
        required_valid_records: [
          {
            id: "rank2_fresh_owner_runtime_packet_record",
            status: packet.rank2_fresh_owner_runtime_packet_record_status,
            required_status: "valid_fresh_owner_runtime_packet_recorded_no_execution",
          },
        ],
        required_evidence: [
          "rank2_fresh_owner_runtime_packet_record_status=valid_fresh_owner_runtime_packet_recorded_no_execution",
          "rank2 fresh owner runtime execution packet template stays packet_only_no_runtime",
          "execution_allowed, execution_performed_by_this_command, route_patch_applied, redirect_delete_executed, deploy_executed, and public_files_modified stay false",
        ],
      };
    }
    const externalRuntimeExecutionEvidenceTemplate = packet.rank2_fresh_owner_external_runtime_execution_evidence_template
      ?? rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate(packet);
    if (packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status !== "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke") {
      return {
        ...common,
        id: "rank2_fresh_owner_external_runtime_execution_evidence_record",
        gate: "after_valid_fresh_owner_runtime_execution_packet_before_post_runtime_smoke",
        status: "blocked_pending_fresh_owner_external_runtime_execution_evidence",
        current_status: packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status,
        required_status: "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke",
        owner_record_required: true,
        required_record_schema: externalRuntimeExecutionEvidenceTemplate?.schema_version ?? null,
        required_rank2_fresh_owner_external_runtime_execution_evidence_record_template: externalRuntimeExecutionEvidenceTemplate,
        template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-external-runtime-execution-evidence-template",
        validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<json>'",
        next_allowed_action: "record externally performed runtime execution evidence only; this command must not execute route patch, redirect/delete, deploy, smoke, or public-file mutation",
        required_valid_records: [
          {
            id: "rank2_fresh_owner_runtime_packet_record",
            status: packet.rank2_fresh_owner_runtime_packet_record_status,
            required_status: "valid_fresh_owner_runtime_packet_recorded_no_execution",
          },
          {
            id: "rank2_fresh_owner_runtime_execution_packet_record",
            status: packet.rank2_fresh_owner_runtime_execution_packet_record_status,
            required_status: "valid_fresh_owner_runtime_execution_packet_recorded_no_execution",
          },
        ],
        required_evidence: [
          "rank2_fresh_owner_runtime_packet_record_status=valid_fresh_owner_runtime_packet_recorded_no_execution",
          "rank2_fresh_owner_runtime_execution_packet_record_status=valid_fresh_owner_runtime_execution_packet_recorded_no_execution",
          "rank2 fresh owner external runtime execution evidence template marks execution_performed_outside_this_command=true",
          "execution_performed_by_this_command, local_files_modified_by_this_command, deploy_performed_by_this_command, and public_files_modified_by_this_command stay false",
        ],
      };
    }
    const postRuntimeSmokeEvidenceTemplate = packet.rank2_fresh_owner_post_runtime_smoke_evidence_template
      ?? rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate(packet);
    if (packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status !== "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback") {
      return {
        ...common,
        id: "rank2_fresh_owner_post_runtime_smoke_evidence_record",
        gate: "after_valid_fresh_owner_external_runtime_execution_evidence_before_rollback_readiness",
        status: "blocked_pending_fresh_owner_post_runtime_smoke_evidence",
        current_status: packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status,
        required_status: "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback",
        owner_record_required: true,
        required_record_schema: postRuntimeSmokeEvidenceTemplate?.schema_version ?? null,
        required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template: postRuntimeSmokeEvidenceTemplate,
        template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-post-runtime-smoke-evidence-template",
        validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<json>'",
        next_allowed_action: "record externally performed post-runtime smoke evidence only; this command must not run smoke, execute rollback, patch routes, redirect/delete, deploy, or mutate public files",
        required_valid_records: [
          {
            id: "rank2_fresh_owner_external_runtime_execution_evidence_record",
            status: packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status,
            required_status: "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke",
          },
        ],
        required_evidence: [
          "rank2_fresh_owner_external_runtime_execution_evidence_record_status=valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke",
          "rank2 fresh owner post-runtime smoke evidence template marks smoke_performed_outside_this_command=true",
          "smoke_performed_by_this_command, rollback_performed_by_this_command, local_files_modified_by_this_command, deploy_performed_by_this_command, and public_files_modified_by_this_command stay false",
        ],
      };
    }
    const rollbackReadinessTemplate = packet.rank2_fresh_owner_rollback_readiness_template
      ?? rank2FreshOwnerRollbackReadinessTemplate(packet);
    if (packet.rank2_fresh_owner_rollback_readiness_record_status !== "valid_fresh_owner_rollback_readiness_recorded_pending_closeout") {
      return {
        ...common,
        id: "rank2_fresh_owner_rollback_readiness_record",
        gate: "after_valid_fresh_owner_post_runtime_smoke_evidence_before_owner_closeout",
        status: "blocked_pending_fresh_owner_rollback_readiness",
        current_status: packet.rank2_fresh_owner_rollback_readiness_record_status,
        required_status: "valid_fresh_owner_rollback_readiness_recorded_pending_closeout",
        owner_record_required: true,
        required_record_schema: rollbackReadinessTemplate?.schema_version ?? null,
        required_rank2_fresh_owner_rollback_readiness_record_template: rollbackReadinessTemplate,
        template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-rollback-readiness-template",
        validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<post-runtime-smoke-json>' --rank2-fresh-owner-rollback-readiness-json='<json>'",
        next_allowed_action: "record rollback readiness evidence only; this command must not execute rollback, run smoke, patch routes, redirect/delete, deploy, or mutate public files",
        required_valid_records: [
          {
            id: "rank2_fresh_owner_post_runtime_smoke_evidence_record",
            status: packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status,
            required_status: "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback",
          },
        ],
        required_evidence: [
          "rank2_fresh_owner_post_runtime_smoke_evidence_record_status=valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback",
          "rank2 fresh owner rollback readiness template stays record_only_rollback_readiness_no_rollback_no_deploy",
          "rollback_ready=true while rollback_performed_by_this_command stays false",
        ],
      };
    }
    const ownerCloseoutTemplate = packet.rank2_fresh_owner_owner_closeout_template
      ?? rank2FreshOwnerOwnerCloseoutTemplate(packet);
    if (packet.rank2_fresh_owner_owner_closeout_record_status !== "valid_fresh_owner_owner_closeout_recorded") {
      return {
        ...common,
        id: "rank2_fresh_owner_owner_closeout_record",
        gate: "after_valid_fresh_owner_rollback_readiness_before_chain_close",
        status: "blocked_pending_fresh_owner_owner_closeout",
        current_status: packet.rank2_fresh_owner_owner_closeout_record_status,
        required_status: "valid_fresh_owner_owner_closeout_recorded",
        owner_record_required: true,
        required_record_schema: ownerCloseoutTemplate?.schema_version ?? null,
        required_rank2_fresh_owner_owner_closeout_record_template: ownerCloseoutTemplate,
        template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-owner-closeout-template",
        validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<post-runtime-smoke-json>' --rank2-fresh-owner-rollback-readiness-json='<rollback-readiness-json>' --rank2-fresh-owner-owner-closeout-json='<json>'",
        next_allowed_action: "record owner closeout evidence only; this command must not execute closeout, rollback, smoke, patch routes, redirect/delete, deploy, or mutate public files",
        required_valid_records: [
          {
            id: "rank2_fresh_owner_rollback_readiness_record",
            status: packet.rank2_fresh_owner_rollback_readiness_record_status,
            required_status: "valid_fresh_owner_rollback_readiness_recorded_pending_closeout",
          },
        ],
        required_evidence: [
          "rank2_fresh_owner_rollback_readiness_record_status=valid_fresh_owner_rollback_readiness_recorded_pending_closeout",
          "rank2 fresh owner owner closeout template stays record_only_owner_closeout_no_additional_runtime",
          "owner_closeout_accepted=true while closeout_performed_by_this_command stays false",
        ],
      };
    }
    return {
      ...common,
      id: "rank2_fresh_owner_record_chain_closed",
      gate: "after_valid_fresh_owner_owner_closeout_record_chain_closed",
      status: "fresh_owner_record_chain_closed_no_additional_runtime",
      current_status: packet.rank2_fresh_owner_owner_closeout_record_status,
      required_status: "valid_fresh_owner_owner_closeout_recorded",
      owner_record_required: false,
      template_command: null,
      validation_command: null,
      next_safe_enforcement_slice: "none_record_chain_closed",
      next_allowed_action: "no additional runtime action from this command; fresh owner record chain is closed",
      required_valid_records: [
        {
          id: "rank2_fresh_owner_rollback_readiness_record",
          status: packet.rank2_fresh_owner_rollback_readiness_record_status,
          required_status: "valid_fresh_owner_rollback_readiness_recorded_pending_closeout",
        },
        {
          id: "rank2_fresh_owner_owner_closeout_record",
          status: packet.rank2_fresh_owner_owner_closeout_record_status,
          required_status: "valid_fresh_owner_owner_closeout_recorded",
        },
      ],
      required_evidence: [
        "rank2_fresh_owner_rollback_readiness_record_status=valid_fresh_owner_rollback_readiness_recorded_pending_closeout",
        "rank2_fresh_owner_owner_closeout_record_status=valid_fresh_owner_owner_closeout_recorded",
        "no closeout execution, rollback, smoke, deploy, redirect/delete, or public mutation is authorized by this command",
      ],
    };
  }

  return {
    ...common,
    id: "rank2_post_live_redirect_delete_record_chain_closed",
    gate: "after_valid_owner_closeout_record_chain_closed",
    status: "record_chain_closed_no_additional_runtime",
    current_status: packet.rank2_post_live_redirect_delete_owner_closeout_record_status,
    required_status: "valid_post_live_redirect_delete_owner_closeout_recorded",
    owner_record_required: false,
    template_command: null,
    validation_command: null,
    next_safe_enforcement_slice: "rank2_post_live_redirect_delete_fresh_owner_packet_required",
    next_required_owner_packet: {
      id: "fresh_owner_approved_packet_required_before_new_runtime",
      status: "blocked_pending_fresh_owner_approved_packet",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      required_record_schema: "rank2-fresh-owner-runtime-packet-record/v0.1",
      template_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-template",
      validation_command: "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<json>'",
      required_evidence: [
        "PRO route/IA acceptance criteria",
        "local/live-equivalence proof",
        "rollback plan",
        "explicit owner approval for any new redirect/delete/deploy/public mutation",
      ],
      required_contract: freshOwnerApprovedPacketContract(packet),
    },
    next_allowed_action: "no additional runtime action from this command; any new redirect/delete/deploy/public mutation requires a new owner-approved packet",
    required_valid_records: [
      {
        id: "rank2_post_live_redirect_delete_owner_closeout_record",
        status: packet.rank2_post_live_redirect_delete_owner_closeout_record_status,
        required_status: "valid_post_live_redirect_delete_owner_closeout_recorded",
      },
    ],
    required_evidence: [
      "rank2_post_live_redirect_delete_owner_closeout_record_status=valid_post_live_redirect_delete_owner_closeout_recorded",
      "rank2 owner closeout template next_required_runtime_gate=none_record_chain_closed",
      "no additional runtime action is authorized by this closed record chain",
    ],
  };
}

function uniqueList(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function fileLine(row) {
  if (!row?.file || typeof row.line !== "number") return null;
  return `${row.file}:${row.line}`;
}

function liveEquivalenceRowStatusSurface(rows) {
  return rows.map((row) => ({
    role: row.role,
    path: row.path,
    paired_path: row.paired_path ?? null,
    expected_http_status: row.expected_http_status,
    status: row.status,
    ok: row.ok,
  }));
}

function proRouteIaCheckStatusSurface(checks) {
  return Object.fromEntries(checks.map((check) => [check.id, check.status]));
}

function proRouteIaFileLineEvidence(checks) {
  return uniqueList(
    checks.flatMap((check) => check.evidence ?? []).filter((item) => /:\d+/.test(item)),
  );
}

function homeDashboardFileLineEvidence(rows) {
  return uniqueList(rows.map(fileLine));
}

function sourceReferenceFileLineEvidence(rows) {
  return uniqueList(
    rows.map((row) => {
      const base = fileLine(row);
      return base ? `${base}:${row.class}` : null;
    }),
  );
}

function ownerDecisionInputContract(packet) {
  const selection = packet.owner_decision_acceptance_contract?.required_decision_followup_selection_contract ?? {};
  const options = selection.required_options_by_decision ?? {};
  const reportingSummaryAck = packet.owner_decision_acceptance_contract?.required_reporting_summary_acknowledgement ?? {};
  const safeSliceAck = packet.owner_decision_acceptance_contract?.required_safe_enforcement_slice_acknowledgement ?? {};
  const decisionTemplate = packet.decision_record_template ?? {};
  const localRows = decisionTemplate.local_live_equivalence_rows ?? [];
  const proChecks = decisionTemplate.pro_route_ia_acceptance_checks ?? [];
  const decisionOptions = decisionTemplate.decision_options ?? [];
  const releaseBlockers = decisionTemplate.release_blockers_acknowledged ?? [];
  const followupPlans = decisionTemplate.decision_followup_plans ?? [];
  return {
    schema_version: "macro-owner-decision-input-contract/v0.1",
    gate: packet.next_gated_slice?.id ?? null,
    required_record_schema: packet.next_gated_slice?.required_record_schema ?? null,
    template_command: packet.next_owner_action?.template_command ?? null,
    validation_command: packet.next_owner_action?.validation_command ?? null,
    required_decisions: packet.next_gated_slice?.required_decisions ?? [],
    required_decision_option_keys: decisionOptions.map((option) => option.decision),
    required_decision_option_count: decisionOptions.length,
    required_decision_options_mutation_allowed: false,
    required_decision_options_blocked_actions: Object.fromEntries(
      decisionOptions.map((option) => [option.decision, option.blocked_actions ?? []]),
    ),
    required_release_blockers_acknowledged: releaseBlockers,
    required_release_blocker_count: releaseBlockers.length,
    required_decision_followup_plan_ids: followupPlans.map((plan) => plan.id),
    required_decision_followup_plan_count: followupPlans.length,
    required_record_fields: ownerDecisionRequiredRecordFields(),
    required_record_mutation_approved: false,
    required_record_execution_allowed: false,
    required_record_execution_by_this_command_allowed: false,
    required_owner_approved_by_placeholder: decisionTemplate.owner_approved_by ?? null,
    required_owner_approved_by_non_empty: true,
    required_decided_at_placeholder: decisionTemplate.decided_at ?? null,
    required_decided_at_format: "full ISO-8601 timestamp with timezone",
    required_decided_at_pattern: ISO_8601_TIMESTAMP_PATTERN.source,
    required_family_id: decisionTemplate.family_id ?? null,
    required_owner_route: decisionTemplate.owner_route ?? null,
    required_compatibility_route: decisionTemplate.compatibility_route ?? null,
    required_local_live_equivalence_base_url: decisionTemplate.local_live_equivalence_base_url ?? null,
    required_local_live_equivalence_proof_status: decisionTemplate.local_live_equivalence_proof_status ?? null,
    required_local_live_equivalence_rows_checked: decisionTemplate.local_live_equivalence_rows_checked ?? null,
    required_local_live_equivalence_row_count: localRows.length,
    required_local_live_equivalence_row_paths: localRows.map((row) => row.path),
    required_local_live_equivalence_row_statuses: liveEquivalenceRowStatusSurface(localRows),
    required_local_live_equivalence_rows_all_ok: true,
    required_pro_route_ia_acceptance_check_ids: proChecks.map((check) => check.id),
    required_pro_route_ia_acceptance_check_count: proChecks.length,
    required_pro_route_ia_acceptance_check_statuses: proRouteIaCheckStatusSurface(proChecks),
    required_pro_route_ia_acceptance_all_pass: true,
    required_pro_route_ia_acceptance_file_line_evidence: proRouteIaFileLineEvidence(proChecks),
    required_home_dashboard_legacy_bridge_entrypoint_count: decisionTemplate.home_dashboard_legacy_bridge_entrypoints?.length ?? 0,
    required_home_dashboard_legacy_bridge_entrypoint_file_lines: homeDashboardFileLineEvidence(decisionTemplate.home_dashboard_legacy_bridge_entrypoints ?? []),
    required_src_legacy_reference_row_count: decisionTemplate.src_legacy_reference_rows?.length ?? 0,
    required_src_legacy_reference_file_lines: sourceReferenceFileLineEvidence(decisionTemplate.src_legacy_reference_rows ?? []),
    required_acknowledgement_schemas: {
      reporting_summary: packet.owner_decision_acceptance_contract?.required_reporting_summary_acknowledgement?.schema_version ?? null,
      safe_enforcement_slices: safeSliceAck.schema_version ?? null,
      followup_selection: selection.schema_version ?? null,
    },
    required_decision_followup_selection_contract_fields: ownerDecisionFollowupSelectionContractRequiredFields(),
    required_decision_followup_selection_field: selection.selection_field ?? null,
    required_decision_followup_selection_option_keys: Object.keys(options),
    required_decision_followup_selection_mutation_allowed: false,
    required_decision_followup_selection_separate_mutation_approval_required: true,
    required_decision_followup_selection_blocked_actions: selection.blocked_actions ?? [],
    required_decision_followup_selection_options_require_blocked_actions: true,
    required_reporting_summary_acknowledgement_fields: ownerDecisionReportingSummaryAcknowledgementRequiredFields(),
    required_reporting_summary_acknowledgement_summary_command: reportingSummaryAck.summary_command ?? null,
    required_reporting_summary_acknowledgement_summary_must_be_generated_from_current_packet: true,
    required_reporting_summary_acknowledgement_current_gate_checklist_required: true,
    required_reporting_summary_acknowledgement_current_gate_checklist_schema_version: reportingSummaryAck.current_gate_checklist_schema_version ?? null,
    required_reporting_summary_acknowledgement_current_gate_checklist_must_match_current_next_required_gate: true,
    required_reporting_summary_acknowledgement_current_gate_checklist_required_checks: reportingSummaryAck.current_gate_checklist_required_checks ?? [],
    required_reporting_summary_acknowledgement_acknowledged_gate: reportingSummaryAck.acknowledged_gate ?? null,
    required_reporting_summary_acknowledgement_acknowledged_record_schema: reportingSummaryAck.acknowledged_record_schema ?? null,
    required_safe_enforcement_slice_acknowledgement_fields: ownerDecisionSafeEnforcementSliceAcknowledgementRequiredFields(),
    required_safe_enforcement_slice_acknowledgement_slice_count: safeSliceAck.slice_count ?? 0,
    required_safe_enforcement_slice_acknowledgement_slice_ids: safeSliceAck.slice_ids ?? [],
    required_safe_enforcement_slice_acknowledgement_blocked_action_map_required: true,
    required_safe_enforcement_slice_acknowledgement_blocked_action_map_keys: Object.keys(safeSliceAck.slice_blocked_actions ?? {}),
    required_safe_enforcement_slice_acknowledgement_all_slices_carry_blocked_actions: true,
    required_safe_enforcement_slice_acknowledgement_evidence_detail_surface_map_required: true,
    required_safe_enforcement_slice_acknowledgement_evidence_detail_surface_map_keys: Object.keys(safeSliceAck.slice_evidence_detail_surfaces ?? {}),
    required_safe_enforcement_slice_acknowledgement_evidence_detail_surfaces: safeSliceAck.slice_evidence_detail_surfaces ?? {},
    required_safe_enforcement_slice_acknowledgement_all_required_evidence_detail_surfaces_acknowledged: true,
    selected_followup_options: Object.fromEntries(
      Object.entries(options).map(([decision, plan]) => [decision, {
        id: plan.id,
        gate: plan.gate,
        mutation_allowed: plan.mutation_allowed,
        separate_mutation_approval_required: plan.separate_mutation_approval_required,
        blocked_actions: plan.blocked_actions,
      }]),
    ),
    safe_enforcement_slice_count: packet.safe_enforcement_slices?.length ?? 0,
    mutation_allowed: false,
    blocked_actions: packet.owner_decision_acceptance_contract?.blocked_actions ?? [],
  };
}

function ownerDecisionSafeEnforcementSliceAcknowledgementRequiredFields() {
  return [
    "schema_version",
    "required",
    "acknowledged_gate",
    "acknowledged_record_schema",
    "slice_count",
    "slice_ids",
    "all_slices_mutation",
    "all_slices_mutation_allowed",
    "all_slices_carry_blocked_actions",
    "slice_blocked_actions",
    "all_required_evidence_detail_surfaces_acknowledged",
    "slice_evidence_detail_surfaces",
    "rank_2_candidate_after_valid_record",
    "blocked_actions",
  ];
}

function ownerDecisionRequiredRecordFields() {
  return [
    "schema_version",
    "family_id",
    "owner_route",
    "compatibility_route",
    "decision",
    "owner_approved_by",
    "decided_at",
    "local_live_equivalence_base_url",
    "local_live_equivalence_proof_status",
    "local_live_equivalence_rows_checked",
    "local_live_equivalence_rows",
    "pro_screen_model_acceptance",
    "pro_route_ia_acceptance_checks",
    "home_dashboard_legacy_bridge_entrypoints",
    "src_legacy_reference_rows",
    "decision_options",
    "release_blockers_acknowledged",
    "decision_followup_plans",
    "decision_followup_selection_contract",
    "selected_decision_followup_plan",
    "reporting_summary_acknowledgement",
    "safe_enforcement_slice_acknowledgement",
    "mutation_approved",
    "execution_allowed",
    "execution_by_this_command_allowed",
  ];
}

function currentSafeEnforcementSliceId(packet) {
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

function currentSafeEnforcementSlice(packet) {
  const id = currentSafeEnforcementSliceId(packet);
  if (!id || id === "none_record_chain_closed") return null;
  return (packet.safe_enforcement_slices ?? []).find((slice) => slice.id === id) ?? null;
}

function currentGateChecklist(packet) {
  const gate = packet.current_next_required_gate ?? {};
  const blockedActions = gate.blocked_actions ?? [];
  const requiredBlockedActions = requiredBlockedActionsForGate(gate);
  const routeIaChecks = gate.required_pro_route_ia_acceptance_checks ?? [];
  const liveRows = packet.evidence?.smoke_rows ?? [];
  const liveRowsPass = packet.evidence?.local_live_equivalence_proof_status === "local_runtime_smoke_passed"
    && packet.evidence?.local_live_equivalence_rows_checked === packet.evidence?.local_live_equivalence_rows_expected
    && liveRows.length === packet.evidence?.local_live_equivalence_rows_expected
    && liveRows.every((row) => row.expected_http_status === row.status && row.ok === true);
  const safeSliceId = currentSafeEnforcementSliceId(packet);
  const safeSlice = currentSafeEnforcementSlice(packet);
  const ownerEvidenceDetailSurface = packet.next_gated_slice?.required_evidence_detail_surface ?? null;
  const gateEvidenceDetailSurface = gate.required_evidence_detail_surface
    ?? (gate.id === packet.next_gated_slice?.id ? packet.next_gated_slice?.required_evidence_detail_surface : null)
    ?? null;
  const safeSliceEvidenceDetailSurface = safeSlice?.required_evidence_detail_surface ?? null;
  const requiredEvidenceDetailSurface = gateEvidenceDetailSurface ?? safeSliceEvidenceDetailSurface ?? ownerEvidenceDetailSurface;
  const evidenceDetailSurfaceRequired = gate.id === "macro_owner_decision_record"
    || gate.id === "macro_owner_decision_followup_record"
    || safeSliceId === "owner_decision_record_validation"
    || Boolean(safeSliceEvidenceDetailSurface);
  const gateEvidenceDetailSurfaceMatches = JSON.stringify(gateEvidenceDetailSurface) === JSON.stringify(requiredEvidenceDetailSurface);
  const safeSliceEvidenceDetailSurfaceMatches = JSON.stringify(safeSliceEvidenceDetailSurface) === JSON.stringify(requiredEvidenceDetailSurface);
  const evidenceDetailSurfaceLocked = !evidenceDetailSurfaceRequired
    || (requiredEvidenceDetailSurface && gateEvidenceDetailSurfaceMatches && safeSliceEvidenceDetailSurfaceMatches);
  const currentRequiredStatus = gate.current_status === gate.required_status ? "satisfied" : "pending";
  const requiredRecordSchema = gate.required_record_schema
    ?? (gate.id === packet.next_gated_slice?.id ? packet.next_gated_slice?.required_record_schema : null);

  return {
    schema_version: "macro-owner-current-gate-checklist/v0.1",
    gate: gate.id ?? null,
    gate_status: gate.status ?? null,
    current_status: gate.current_status ?? null,
    required_status: gate.required_status ?? null,
    owner_record_required: gate.owner_record_required ?? null,
    required_record_schema: requiredRecordSchema,
    template_command: gate.template_command ?? null,
    validation_command: gate.validation_command ?? null,
    next_safe_enforcement_slice_id: safeSliceId,
    mutation: gate.mutation ?? null,
    mutation_allowed: gate.mutation_allowed ?? null,
    separate_mutation_approval_required: gate.separate_mutation_approval_required ?? null,
    blocked_actions: blockedActions,
    next_allowed_action: gate.next_allowed_action ?? null,
    required_valid_records: gate.required_valid_records ?? [],
    checks: [
      {
        id: "gate_no_mutation",
        status: gate.mutation === "none" && gate.mutation_allowed === false ? "pass" : "blocked",
        required: { mutation: "none", mutation_allowed: false },
        actual: { mutation: gate.mutation ?? null, mutation_allowed: gate.mutation_allowed ?? null },
      },
      {
        id: "separate_mutation_approval_required",
        status: gate.separate_mutation_approval_required === true ? "pass" : "blocked",
        required: true,
        actual: gate.separate_mutation_approval_required ?? null,
      },
      {
        id: "blocked_actions_locked",
        status: JSON.stringify(blockedActions) === JSON.stringify(requiredBlockedActions) ? "pass" : "blocked",
        required: requiredBlockedActions,
        actual: blockedActions,
      },
      {
        id: "local_live_equivalence_locked",
        status: liveRowsPass ? "pass" : "blocked",
        required: {
          proof_status: "local_runtime_smoke_passed",
          rows_checked: packet.evidence?.local_live_equivalence_rows_expected ?? null,
        },
        actual: {
          proof_status: packet.evidence?.local_live_equivalence_proof_status ?? null,
          rows_checked: packet.evidence?.local_live_equivalence_rows_checked ?? null,
          rows: liveRows.length,
        },
      },
      {
        id: "pro_route_ia_acceptance_locked",
        status: routeIaChecks.length > 0 && routeIaChecks.every((check) => check.status === "pass") ? "pass" : "blocked",
        required: "all_pass",
        actual: {
          checks: routeIaChecks.length,
          failing: routeIaChecks.filter((check) => check.status !== "pass").map((check) => check.id),
        },
      },
      {
        id: "evidence_detail_surface_locked",
        status: evidenceDetailSurfaceLocked ? "pass" : "blocked",
        required: evidenceDetailSurfaceRequired
          ? "current owner-decision gate and safe-slice detail surfaces match the owner evidence requirements"
          : "not_applicable",
        actual: {
          required: evidenceDetailSurfaceRequired,
          gate_has_surface: gateEvidenceDetailSurface !== null,
          safe_slice_has_surface: safeSliceEvidenceDetailSurface !== null,
          expected_surface_schema: requiredEvidenceDetailSurface?.schema_version ?? null,
          gate_matches_required: gateEvidenceDetailSurfaceMatches,
          safe_slice_matches_required: safeSliceEvidenceDetailSurfaceMatches,
        },
      },
      {
        id: "required_record_status",
        status: currentRequiredStatus,
        required: gate.required_status ?? null,
        actual: gate.current_status ?? null,
      },
      {
        id: "safe_enforcement_slice_linked",
        status: safeSliceId === "none_record_chain_closed" || safeSlice ? "pass" : "blocked",
        required: "current safe enforcement slice id is linked to the safe-slice proposal or terminal close",
        actual: safeSliceId,
      },
    ],
  };
}

function reportingSummary(packet) {
  const routeIaChecks = packet.owner_decision_acceptance_contract?.required_pro_route_ia_acceptance_checks ?? [];
  const proFileLineEvidence = proRouteIaFileLineEvidence(routeIaChecks);
  const homeDashboardFileLines = homeDashboardFileLineEvidence(
    packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows ?? [],
  );
  const sourceReferenceFileLines = sourceReferenceFileLineEvidence(packet.evidence.src_legacy_reference_rows ?? []);

  return {
    schema_version: "macro-owner-reporting-summary/v0.1",
    issue: packet.issue,
    family_id: packet.family_id,
    owner_route: packet.owner_route,
    compatibility_route: packet.compatibility_route,
    owner_decision_status: packet.owner_decision_status,
    next_gated_slice: packet.next_gated_slice?.id ?? null,
    current_next_required_gate: packet.current_next_required_gate?.id ?? null,
    current_next_required_gate_status: packet.current_next_required_gate?.status ?? null,
    current_gate_checklist: currentGateChecklist(packet),
    local_live_equivalence: {
      proof_status: packet.evidence.local_live_equivalence_proof_status,
      rows_checked: packet.evidence.local_live_equivalence_rows_checked,
      rows_expected: packet.evidence.local_live_equivalence_rows_expected,
      rows: packet.evidence.smoke_rows ?? [],
    },
    pro_route_ia_acceptance: {
      status: routeIaChecks.every((check) => check.status === "pass") ? "all_pass" : "blocked",
      checks: routeIaChecks.length,
      check_details: routeIaChecks,
      file_line_evidence: proFileLineEvidence,
    },
    home_dashboard_entrypoint_file_lines: homeDashboardFileLines,
    source_reference_file_lines: sourceReferenceFileLines,
    safe_enforcement_slice_count: packet.safe_enforcement_slices?.length ?? 0,
    safe_enforcement_slice_ids: (packet.safe_enforcement_slices ?? []).map((slice) => slice.id),
    safe_enforcement_slice_details: packet.safe_enforcement_slices ?? [],
    current_safe_enforcement_slice_id: currentSafeEnforcementSliceId(packet),
    current_safe_enforcement_slice: currentSafeEnforcementSlice(packet),
    owner_decision_input_contract: ownerDecisionInputContract(packet),
    blocked_actions: packet.owner_decision_acceptance_contract?.blocked_actions ?? [],
  };
}

function validateCurrentNextRequiredGate(packet) {
  const errors = [];
  const gate = packet.current_next_required_gate;
  if (!gate) return ["current next required gate must be present"];
  if (JSON.stringify(gate) !== JSON.stringify(currentNextRequiredGate(packet))) {
    errors.push("current next required gate does not match packet state");
  }
  if (gate.mutation !== "none" || gate.mutation_allowed !== false) {
    errors.push("current next required gate must be no-mutation");
  }
  if (gate.separate_mutation_approval_required !== true) {
    errors.push("current next required gate must require separate mutation approval");
  }
  for (const action of requiredBlockedActionsForGate(gate)) {
    if (!gate.blocked_actions?.includes(action)) {
      errors.push(`current next required gate must block ${action}`);
    }
  }
  if (JSON.stringify(gate.required_pro_route_ia_acceptance_checks) !== JSON.stringify(packet.owner_decision_acceptance_contract?.required_pro_route_ia_acceptance_checks ?? [])) {
    errors.push("current next required gate PRO route/IA checks must match owner acceptance contract");
  }
  if (gate.required_pro_route_ia_acceptance_checks?.some((check) => check.status !== "pass")) {
    errors.push("current next required gate PRO route/IA checks must all pass");
  }
  if (packet.decision_record_status !== "valid_no_mutation" && gate.id !== "macro_owner_decision_record") {
    errors.push(`current next required gate must remain macro_owner_decision_record before a valid owner record: ${gate.id}`);
  }
  if (
    packet.decision_record_status === "valid_no_mutation"
    && packet.decision_followup_record_status !== "valid_no_mutation_followup_recorded"
    && gate.id !== "macro_owner_decision_followup_record"
  ) {
    errors.push(`current next required gate must be macro_owner_decision_followup_record after a valid owner record: ${gate.id}`);
  }
  if (
    packet.decision_record_status === "valid_no_mutation"
    && packet.decision_followup_record_status !== "valid_no_mutation_followup_recorded"
  ) {
    const selectedTemplate = selectedDecisionFollowupRecordTemplate(packet);
    if (!gate.required_followup_record_template) {
      errors.push("current next required gate must carry the selected decision followup record template");
    }
    if (gate.required_record_schema !== selectedTemplate?.schema_version) {
      errors.push(`current next required gate followup record schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_followup_record_template) !== JSON.stringify(selectedTemplate)) {
      errors.push("current next required gate followup record template must match selected followup template");
    }
  }
  if (
    packet.decision_followup_record_status === "valid_no_mutation_followup_recorded"
    && packet.rank2_pre_activation_record_status !== "valid_no_mutation_pre_activation"
    && gate.id !== "rank2_pre_activation_local_smoke_record"
  ) {
    errors.push(`current next required gate must be rank2_pre_activation_local_smoke_record after a valid rank-1 follow-up: ${gate.id}`);
  }
  if (
    packet.decision_followup_record_status === "valid_no_mutation_followup_recorded"
    && packet.rank2_pre_activation_record_status !== "valid_no_mutation_pre_activation"
  ) {
    const preActivationTemplate = rank2PreActivationRecordTemplate(packet);
    if (!gate.required_rank2_pre_activation_record_template) {
      errors.push("current next required gate must carry the rank2 pre-activation record template");
    }
    if (gate.required_record_schema !== preActivationTemplate?.schema_version) {
      errors.push(`current next required gate rank2 pre-activation schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_pre_activation_record_template) !== JSON.stringify(preActivationTemplate)) {
      errors.push("current next required gate rank2 pre-activation template must match inactive candidate template");
    }
    if (JSON.stringify(gate.required_evidence_detail_surface) !== JSON.stringify(preActivationTemplate?.required_evidence_detail_surface)) {
      errors.push("current next required gate rank2 pre-activation evidence detail surface must match inactive candidate template");
    }
  }
  if (gate.id === "rank2_owner_decision_record") {
    const ownerReviewTemplate = rank2OwnerReviewPacketTemplate(packet);
    const ownerDecisionTemplate = rank2OwnerDecisionRecordTemplate(packet);
    if (!gate.required_rank2_owner_review_template) {
      errors.push("current next required gate must carry the rank2 owner review template");
    }
    if (!gate.required_rank2_owner_decision_record_template) {
      errors.push("current next required gate must carry the rank2 owner decision record template");
    }
    if (gate.required_record_schema !== ownerDecisionTemplate?.schema_version) {
      errors.push(`current next required gate rank2 owner decision schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_owner_review_template) !== JSON.stringify(ownerReviewTemplate)) {
      errors.push("current next required gate rank2 owner review template must match packet template");
    }
    if (JSON.stringify(gate.required_rank2_owner_decision_record_template) !== JSON.stringify(ownerDecisionTemplate)) {
      errors.push("current next required gate rank2 owner decision record template must match packet template");
    }
  }
  if (
    packet.rank2_owner_decision_record_status === "valid_no_mutation_owner_review_recorded"
    && packet.rank2_owner_followup_record_status !== "valid_no_mutation_owner_followup_recorded"
    && gate.id !== "rank2_owner_followup_record"
  ) {
    errors.push(`current next required gate must be rank2_owner_followup_record after a valid rank2 owner decision: ${gate.id}`);
  }
  if (gate.id === "rank2_owner_followup_record") {
    const selectedFollowupTemplate = selectedRank2OwnerFollowupRecordTemplate(packet);
    if (!gate.required_rank2_owner_followup_record_template) {
      errors.push("current next required gate must carry the selected rank2 owner followup record template");
    }
    if (gate.required_record_schema !== selectedFollowupTemplate?.schema_version) {
      errors.push(`current next required gate rank2 owner followup schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_owner_followup_record_template) !== JSON.stringify(selectedFollowupTemplate)) {
      errors.push("current next required gate rank2 owner followup record template must match selected followup template");
    }
  }
  if (
    packet.rank2_owner_followup_record_status === "valid_no_mutation_owner_followup_recorded"
    && !packet.rank2_mutation_approval_readiness?.ready_for_mutation_approval_request
    && gate.id !== "rank2_mutation_approval_readiness"
  ) {
    errors.push(`current next required gate must be rank2_mutation_approval_readiness until mutation approval readiness is available: ${gate.id}`);
  }
  if (
    packet.rank2_mutation_approval_readiness?.ready_for_mutation_approval_request
    && packet.rank2_mutation_approval_record_status !== "valid_owner_approved_no_execution"
    && gate.id !== "rank2_mutation_approval_record"
  ) {
    errors.push(`current next required gate must be rank2_mutation_approval_record after mutation approval readiness: ${gate.id}`);
  }
  if (gate.id === "rank2_mutation_approval_record") {
    const requestTemplate = rank2MutationApprovalRequestTemplate(packet);
    const approvalTemplate = rank2MutationApprovalRecordTemplate(packet);
    if (!gate.required_rank2_mutation_approval_request_template) {
      errors.push("current next required gate must carry the rank2 mutation approval request template");
    }
    if (!gate.required_rank2_mutation_approval_record_template) {
      errors.push("current next required gate must carry the rank2 mutation approval record template");
    }
    if (gate.required_record_schema !== approvalTemplate?.schema_version) {
      errors.push(`current next required gate rank2 mutation approval schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_mutation_approval_request_template) !== JSON.stringify(requestTemplate)) {
      errors.push("current next required gate rank2 mutation approval request template must match packet template");
    }
    if (JSON.stringify(gate.required_rank2_mutation_approval_record_template) !== JSON.stringify(approvalTemplate)) {
      errors.push("current next required gate rank2 mutation approval record template must match packet template");
    }
    if (
      gate.required_rank2_mutation_approval_request_template?.request_only !== true
      || gate.required_rank2_mutation_approval_request_template?.execution_allowed !== false
      || gate.required_rank2_mutation_approval_record_template?.approval_scope !== "record_only_no_execution"
      || gate.required_rank2_mutation_approval_record_template?.execution_allowed !== false
    ) {
      errors.push("current next required gate rank2 mutation approval templates must stay request/record-only with execution blocked");
    }
  }
  if (
    packet.rank2_mutation_approval_record_status === "valid_owner_approved_no_execution"
    && packet.rank2_route_diff_proposal_record_status !== "valid_no_mutation_route_diff_proposal_recorded"
    && gate.id !== "rank2_route_diff_proposal_record"
  ) {
    errors.push(`current next required gate must be rank2_route_diff_proposal_record after a valid mutation approval record: ${gate.id}`);
  }
  if (gate.id === "rank2_route_diff_proposal_record") {
    const proposalTemplate = rank2RouteDiffProposalTemplate(packet);
    if (!gate.required_rank2_route_diff_proposal_record_template) {
      errors.push("current next required gate must carry the rank2 route diff proposal record template");
    }
    if (gate.required_record_schema !== proposalTemplate?.schema_version) {
      errors.push(`current next required gate rank2 route diff proposal schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_route_diff_proposal_record_template) !== JSON.stringify(proposalTemplate)) {
      errors.push("current next required gate rank2 route diff proposal template must match packet template");
    }
    if (
      gate.required_rank2_route_diff_proposal_record_template?.proposal_status !== "draft_no_mutation"
      || gate.required_rank2_route_diff_proposal_record_template?.patch_applied !== false
      || gate.required_rank2_route_diff_proposal_record_template?.public_files_modified !== false
      || gate.required_rank2_route_diff_proposal_record_template?.redirect_config_changed !== false
      || gate.required_rank2_route_diff_proposal_record_template?.execution_allowed !== false
      || gate.required_rank2_route_diff_proposal_record_template?.deploy_approved !== false
    ) {
      errors.push("current next required gate rank2 route diff proposal template must stay draft/no-mutation/no-execution");
    }
  }
  if (
    packet.rank2_route_diff_proposal_record_status === "valid_no_mutation_route_diff_proposal_recorded"
    && packet.rank2_rollback_plan_record_status !== "valid_no_mutation_rollback_plan_recorded"
    && gate.id !== "rank2_rollback_plan_record"
  ) {
    errors.push(`current next required gate must be rank2_rollback_plan_record after a valid route diff proposal record: ${gate.id}`);
  }
  if (gate.id === "rank2_rollback_plan_record") {
    const rollbackTemplate = rank2RollbackPlanTemplate(packet);
    if (!gate.required_rank2_rollback_plan_record_template) {
      errors.push("current next required gate must carry the rank2 rollback plan record template");
    }
    if (gate.required_record_schema !== rollbackTemplate?.schema_version) {
      errors.push(`current next required gate rank2 rollback plan schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_rollback_plan_record_template) !== JSON.stringify(rollbackTemplate)) {
      errors.push("current next required gate rank2 rollback plan template must match packet template");
    }
    if (
      gate.required_rank2_rollback_plan_record_template?.rollback_plan_status !== "recorded_no_mutation"
      || gate.required_rank2_rollback_plan_record_template?.rollback_scope !== "plan_only_no_execution"
      || gate.required_rank2_rollback_plan_record_template?.patch_applied !== false
      || gate.required_rank2_rollback_plan_record_template?.rollback_applied !== false
      || gate.required_rank2_rollback_plan_record_template?.public_files_modified !== false
      || gate.required_rank2_rollback_plan_record_template?.redirect_config_changed !== false
      || gate.required_rank2_rollback_plan_record_template?.execution_allowed !== false
      || gate.required_rank2_rollback_plan_record_template?.deploy_approved !== false
    ) {
      errors.push("current next required gate rank2 rollback plan template must stay plan-only/no-rollback/no-mutation/no-execution");
    }
  }
  if (
    packet.rank2_rollback_plan_record_status === "valid_no_mutation_rollback_plan_recorded"
    && packet.rank2_local_post_patch_smoke_plan_record_status !== "valid_no_mutation_local_post_patch_smoke_plan_recorded"
    && gate.id !== "rank2_local_post_patch_smoke_plan_record"
  ) {
    errors.push(`current next required gate must be rank2_local_post_patch_smoke_plan_record after a valid rollback plan record: ${gate.id}`);
  }
  if (gate.id === "rank2_local_post_patch_smoke_plan_record") {
    const smokePlanTemplate = rank2LocalPostPatchSmokePlanTemplate(packet);
    if (!gate.required_rank2_local_post_patch_smoke_plan_record_template) {
      errors.push("current next required gate must carry the rank2 local post-patch smoke plan record template");
    }
    if (gate.required_record_schema !== smokePlanTemplate?.schema_version) {
      errors.push(`current next required gate rank2 local post-patch smoke plan schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_local_post_patch_smoke_plan_record_template) !== JSON.stringify(smokePlanTemplate)) {
      errors.push("current next required gate rank2 local post-patch smoke plan template must match packet template");
    }
    if (
      gate.required_rank2_local_post_patch_smoke_plan_record_template?.smoke_plan_status !== "planned_before_execution_no_runtime"
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.smoke_scope !== "plan_only_no_runtime"
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.patch_applied !== false
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.rollback_applied !== false
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.smoke_executed !== false
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.public_files_modified !== false
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.redirect_config_changed !== false
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.execution_allowed !== false
      || gate.required_rank2_local_post_patch_smoke_plan_record_template?.deploy_approved !== false
    ) {
      errors.push("current next required gate rank2 local post-patch smoke plan template must stay plan-only/no-runtime/no-mutation/no-execution");
    }
  }
  if (
    packet.rank2_local_post_patch_smoke_plan_record_status === "valid_no_mutation_local_post_patch_smoke_plan_recorded"
    && packet.rank2_explicit_deploy_approval_record_status !== "valid_explicit_deploy_approval_recorded_no_runtime"
    && gate.id !== "rank2_explicit_deploy_approval_record"
  ) {
    errors.push(`current next required gate must be rank2_explicit_deploy_approval_record after a valid local post-patch smoke plan record: ${gate.id}`);
  }
  if (gate.id === "rank2_explicit_deploy_approval_record") {
    const deployApprovalTemplate = rank2ExplicitDeployApprovalTemplate(packet);
    if (!gate.required_rank2_explicit_deploy_approval_record_template) {
      errors.push("current next required gate must carry the rank2 explicit deploy approval record template");
    }
    if (gate.required_record_schema !== deployApprovalTemplate?.schema_version) {
      errors.push(`current next required gate rank2 explicit deploy approval schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_explicit_deploy_approval_record_template) !== JSON.stringify(deployApprovalTemplate)) {
      errors.push("current next required gate rank2 explicit deploy approval template must match packet template");
    }
    if (
      gate.required_rank2_explicit_deploy_approval_record_template?.approval_status !== "owner_approved"
      || gate.required_rank2_explicit_deploy_approval_record_template?.approval_scope !== "record_only_no_deploy"
      || gate.required_rank2_explicit_deploy_approval_record_template?.deploy_approved !== true
      || gate.required_rank2_explicit_deploy_approval_record_template?.deploy_executed !== false
      || gate.required_rank2_explicit_deploy_approval_record_template?.production_live_smoke_executed !== false
      || gate.required_rank2_explicit_deploy_approval_record_template?.execution_allowed !== false
      || gate.required_rank2_explicit_deploy_approval_record_template?.route_patch_applied !== false
      || gate.required_rank2_explicit_deploy_approval_record_template?.rollback_applied !== false
      || gate.required_rank2_explicit_deploy_approval_record_template?.public_files_modified !== false
      || gate.required_rank2_explicit_deploy_approval_record_template?.redirect_config_changed !== false
    ) {
      errors.push("current next required gate rank2 explicit deploy approval template must stay record-only/no-deploy/no-runtime/no-mutation");
    }
  }
  if (
    packet.rank2_explicit_deploy_approval_record_status === "valid_explicit_deploy_approval_recorded_no_runtime"
    && packet.rank2_execution_readiness?.status !== "all_prerequisites_recorded_no_runtime"
    && gate.id !== "rank2_execution_readiness"
  ) {
    errors.push(`current next required gate must be rank2_execution_readiness until execution prerequisites are complete after a valid explicit deploy approval record: ${gate.id}`);
  }
  if (gate.id === "rank2_execution_readiness") {
    if (gate.current_status !== packet.rank2_execution_readiness?.status) {
      errors.push(`current next required gate execution readiness status mismatch: ${gate.current_status}`);
    }
    if (JSON.stringify(gate.missing_prerequisites ?? []) !== JSON.stringify(packet.rank2_execution_readiness?.missing_prerequisites ?? [])) {
      errors.push("current next required gate execution readiness missing prerequisites mismatch");
    }
  }
  if (
    packet.rank2_execution_readiness?.status === "all_prerequisites_recorded_no_runtime"
    && packet.rank2_route_execution_packet_record_status !== "valid_route_execution_packet_recorded_no_runtime"
    && gate.id !== "rank2_route_execution_packet_record"
  ) {
    errors.push(`current next required gate must be rank2_route_execution_packet_record after execution readiness completes: ${gate.id}`);
  }
  if (gate.id === "rank2_route_execution_packet_record") {
    const routeExecutionPacketTemplate = rank2RouteExecutionPacketTemplate(packet);
    if (!gate.required_rank2_route_execution_packet_record_template) {
      errors.push("current next required gate must carry the rank2 route execution packet record template");
    }
    if (gate.required_record_schema !== routeExecutionPacketTemplate?.schema_version) {
      errors.push(`current next required gate rank2 route execution packet schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_route_execution_packet_record_template) !== JSON.stringify(routeExecutionPacketTemplate)) {
      errors.push("current next required gate rank2 route execution packet template must match packet template");
    }
    if (
      gate.required_rank2_route_execution_packet_record_template?.execution_packet_status !== "recorded_no_runtime"
      || gate.required_rank2_route_execution_packet_record_template?.execution_scope !== "record_only_no_runtime"
      || gate.required_rank2_route_execution_packet_record_template?.owner_runtime_release_status !== "not_recorded"
      || gate.required_rank2_route_execution_packet_record_template?.route_execution_packet_recorded !== true
      || gate.required_rank2_route_execution_packet_record_template?.execution_allowed !== false
      || gate.required_rank2_route_execution_packet_record_template?.route_patch_applied !== false
      || gate.required_rank2_route_execution_packet_record_template?.post_patch_smoke_executed !== false
      || gate.required_rank2_route_execution_packet_record_template?.deploy_executed !== false
      || gate.required_rank2_route_execution_packet_record_template?.production_live_smoke_executed !== false
      || gate.required_rank2_route_execution_packet_record_template?.public_files_modified !== false
      || gate.required_rank2_route_execution_packet_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_route_execution_packet_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 route execution packet template must stay record-only/no-runtime/no-mutation/no-deploy");
    }
  }
  if (
    packet.rank2_route_execution_packet_record_status === "valid_route_execution_packet_recorded_no_runtime"
    && packet.rank2_owner_runtime_release_record_status !== "valid_owner_runtime_release_recorded_no_execution"
    && gate.id !== "rank2_owner_runtime_release_record"
  ) {
    errors.push(`current next required gate must be rank2_owner_runtime_release_record after a valid route execution packet record: ${gate.id}`);
  }
  if (gate.id === "rank2_owner_runtime_release_record") {
    const ownerRuntimeReleaseTemplate = rank2OwnerRuntimeReleaseTemplate(packet);
    if (!gate.required_rank2_owner_runtime_release_record_template) {
      errors.push("current next required gate must carry the rank2 owner runtime release record template");
    }
    if (gate.required_record_schema !== ownerRuntimeReleaseTemplate?.schema_version) {
      errors.push(`current next required gate rank2 owner runtime release schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_owner_runtime_release_record_template) !== JSON.stringify(ownerRuntimeReleaseTemplate)) {
      errors.push("current next required gate rank2 owner runtime release template must match packet template");
    }
    if (
      gate.required_rank2_owner_runtime_release_record_template?.release_status !== "owner_released"
      || gate.required_rank2_owner_runtime_release_record_template?.release_scope !== "record_only_before_runtime"
      || gate.required_rank2_owner_runtime_release_record_template?.runtime_release_recorded !== true
      || gate.required_rank2_owner_runtime_release_record_template?.execution_allowed !== false
      || gate.required_rank2_owner_runtime_release_record_template?.route_patch_applied !== false
      || gate.required_rank2_owner_runtime_release_record_template?.post_patch_smoke_executed !== false
      || gate.required_rank2_owner_runtime_release_record_template?.deploy_executed !== false
      || gate.required_rank2_owner_runtime_release_record_template?.production_live_smoke_executed !== false
      || gate.required_rank2_owner_runtime_release_record_template?.public_files_modified !== false
      || gate.required_rank2_owner_runtime_release_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_owner_runtime_release_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 owner runtime release template must stay record-only/no-runtime/no-mutation/no-deploy");
    }
  }
  if (
    packet.rank2_owner_runtime_release_record_status === "valid_owner_runtime_release_recorded_no_execution"
    && packet.rank2_route_patch_application_record_status !== "valid_route_patch_application_recorded_no_smoke_no_deploy"
    && gate.id !== "rank2_route_patch_application_record"
  ) {
    errors.push(`current next required gate must be rank2_route_patch_application_record after a valid owner runtime release record: ${gate.id}`);
  }
  if (gate.id === "rank2_route_patch_application_record") {
    const routePatchApplicationTemplate = rank2RoutePatchApplicationTemplate(packet);
    if (!gate.required_rank2_route_patch_application_record_template) {
      errors.push("current next required gate must carry the rank2 route patch application record template");
    }
    if (gate.required_record_schema !== routePatchApplicationTemplate?.schema_version) {
      errors.push(`current next required gate rank2 route patch application schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_route_patch_application_record_template) !== JSON.stringify(routePatchApplicationTemplate)) {
      errors.push("current next required gate rank2 route patch application template must match packet template");
    }
    if (
      gate.required_rank2_route_patch_application_record_template?.patch_status !== "recorded_local_patch_applied"
      || gate.required_rank2_route_patch_application_record_template?.patch_scope !== "record_only_local_patch_no_smoke_no_deploy"
      || gate.required_rank2_route_patch_application_record_template?.route_patch_application_recorded !== true
      || gate.required_rank2_route_patch_application_record_template?.route_patch_applied !== true
      || gate.required_rank2_route_patch_application_record_template?.post_patch_smoke_executed !== false
      || gate.required_rank2_route_patch_application_record_template?.deploy_executed !== false
      || gate.required_rank2_route_patch_application_record_template?.production_live_smoke_executed !== false
      || gate.required_rank2_route_patch_application_record_template?.public_files_modified !== false
      || gate.required_rank2_route_patch_application_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_route_patch_application_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 route patch application template must stay record-only/no-smoke/no-deploy/no-public-mutation");
    }
  }
  if (
    packet.rank2_route_patch_application_record_status === "valid_route_patch_application_recorded_no_smoke_no_deploy"
    && packet.rank2_local_post_patch_smoke_record_status !== "valid_local_post_patch_smoke_recorded_no_deploy"
    && gate.id !== "rank2_local_post_patch_smoke_record"
  ) {
    errors.push(`current next required gate must be rank2_local_post_patch_smoke_record after a valid route patch application record: ${gate.id}`);
  }
  if (gate.id === "rank2_local_post_patch_smoke_record") {
    const localPostPatchSmokeRecordTemplate = rank2LocalPostPatchSmokeRecordTemplate(packet);
    if (!gate.required_rank2_local_post_patch_smoke_record_template) {
      errors.push("current next required gate must carry the rank2 local post-patch smoke record template");
    }
    if (gate.required_record_schema !== localPostPatchSmokeRecordTemplate?.schema_version) {
      errors.push(`current next required gate rank2 local post-patch smoke record schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_local_post_patch_smoke_record_template) !== JSON.stringify(localPostPatchSmokeRecordTemplate)) {
      errors.push("current next required gate rank2 local post-patch smoke record template must match packet template");
    }
    if (
      gate.required_rank2_local_post_patch_smoke_record_template?.smoke_status !== "recorded_local_post_patch_smoke"
      || gate.required_rank2_local_post_patch_smoke_record_template?.smoke_scope !== "local_runtime_only_no_deploy"
      || gate.required_rank2_local_post_patch_smoke_record_template?.route_patch_applied !== true
      || gate.required_rank2_local_post_patch_smoke_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_local_post_patch_smoke_record_template?.deploy_executed !== false
      || gate.required_rank2_local_post_patch_smoke_record_template?.production_live_smoke_executed !== false
      || gate.required_rank2_local_post_patch_smoke_record_template?.public_files_modified !== false
      || gate.required_rank2_local_post_patch_smoke_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_local_post_patch_smoke_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 local post-patch smoke record template must stay local-smoke-only/no-deploy/no-public-mutation");
    }
  }
  if (
    packet.rank2_local_post_patch_smoke_record_status === "valid_local_post_patch_smoke_recorded_no_deploy"
    && packet.rank2_deploy_execution_record_status !== "valid_deploy_execution_recorded_no_live_smoke"
    && gate.id !== "rank2_deploy_execution_record"
  ) {
    errors.push(`current next required gate must be rank2_deploy_execution_record after a valid local post-patch smoke record: ${gate.id}`);
  }
  if (gate.id === "rank2_deploy_execution_record") {
    const deployExecutionTemplate = rank2DeployExecutionTemplate(packet);
    if (!gate.required_rank2_deploy_execution_record_template) {
      errors.push("current next required gate must carry the rank2 deploy execution record template");
    }
    if (gate.required_record_schema !== deployExecutionTemplate?.schema_version) {
      errors.push(`current next required gate rank2 deploy execution record schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_deploy_execution_record_template) !== JSON.stringify(deployExecutionTemplate)) {
      errors.push("current next required gate rank2 deploy execution record template must match packet template");
    }
    if (
      gate.required_rank2_deploy_execution_record_template?.deploy_status !== "recorded_deploy_executed"
      || gate.required_rank2_deploy_execution_record_template?.deploy_scope !== "record_only_deploy_no_live_smoke"
      || gate.required_rank2_deploy_execution_record_template?.route_patch_applied !== true
      || gate.required_rank2_deploy_execution_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_deploy_execution_record_template?.deploy_executed !== true
      || gate.required_rank2_deploy_execution_record_template?.production_live_smoke_executed !== false
      || gate.required_rank2_deploy_execution_record_template?.public_files_modified !== false
      || gate.required_rank2_deploy_execution_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_deploy_execution_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 deploy execution record template must stay deploy-record-only/no-live-smoke/no-public-mutation");
    }
  }
  if (
    packet.rank2_deploy_execution_record_status === "valid_deploy_execution_recorded_no_live_smoke"
    && packet.rank2_production_live_smoke_record_status !== "valid_production_live_smoke_recorded_no_redirect_no_delete"
    && gate.id !== "rank2_production_live_smoke_record"
  ) {
    errors.push(`current next required gate must be rank2_production_live_smoke_record after a valid deploy execution record: ${gate.id}`);
  }
  if (gate.id === "rank2_production_live_smoke_record") {
    const productionLiveSmokeTemplate = rank2ProductionLiveSmokeTemplate(packet);
    if (!gate.required_rank2_production_live_smoke_record_template) {
      errors.push("current next required gate must carry the rank2 production live smoke record template");
    }
    if (gate.required_record_schema !== productionLiveSmokeTemplate?.schema_version) {
      errors.push(`current next required gate rank2 production live smoke record schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_production_live_smoke_record_template) !== JSON.stringify(productionLiveSmokeTemplate)) {
      errors.push("current next required gate rank2 production live smoke record template must match packet template");
    }
    if (
      gate.required_rank2_production_live_smoke_record_template?.production_live_smoke_status !== "recorded_production_live_smoke"
      || gate.required_rank2_production_live_smoke_record_template?.smoke_scope !== "production_live_smoke_only_no_redirect_no_delete"
      || gate.required_rank2_production_live_smoke_record_template?.route_patch_applied !== true
      || gate.required_rank2_production_live_smoke_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_production_live_smoke_record_template?.deploy_executed !== true
      || gate.required_rank2_production_live_smoke_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_production_live_smoke_record_template?.public_files_modified !== false
      || gate.required_rank2_production_live_smoke_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_production_live_smoke_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 production live smoke record template must stay live-smoke-only/no-redirect-delete/no-public-mutation");
    }
  }
  if (
    packet.rank2_production_live_smoke_record_status === "valid_production_live_smoke_recorded_no_redirect_no_delete"
    && packet.rank2_post_live_redirect_delete_approval_request_record_status !== "valid_post_live_redirect_delete_approval_requested_no_execution"
    && gate.id !== "rank2_post_live_redirect_delete_approval_request"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_approval_request after a valid production live smoke record: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_approval_request") {
    const postLiveApprovalRequestTemplate = rank2PostLiveRedirectDeleteApprovalRequestTemplate(packet);
    if (!gate.required_rank2_post_live_redirect_delete_approval_request_record_template) {
      errors.push("current next required gate must carry the rank2 post-live redirect/delete approval request record template");
    }
    if (gate.required_record_schema !== postLiveApprovalRequestTemplate?.schema_version) {
      errors.push(`current next required gate rank2 post-live redirect/delete approval request schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_post_live_redirect_delete_approval_request_record_template) !== JSON.stringify(postLiveApprovalRequestTemplate)) {
      errors.push("current next required gate rank2 post-live redirect/delete approval request template must match packet template");
    }
    if (
      gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.request_status !== "requested_no_execution"
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.request_scope !== "post_live_request_only_no_redirect_no_delete"
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.route_patch_applied !== true
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.deploy_executed !== true
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.redirect_delete_approval_requested !== true
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.redirect_delete_executed !== false
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.public_files_modified !== false
      || gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_post_live_redirect_delete_approval_request_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 post-live redirect/delete approval request template must stay request-only/no-execution/no-public-mutation");
    }
  }
  if (
    packet.rank2_post_live_redirect_delete_approval_request_record_status === "valid_post_live_redirect_delete_approval_requested_no_execution"
    && packet.rank2_post_live_redirect_delete_approval_record_status !== "valid_post_live_redirect_delete_approved_no_execution"
    && gate.id !== "rank2_post_live_redirect_delete_approval_record"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_approval_record after a valid post-live approval request record: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_approval_record") {
    const postLiveApprovalRecordTemplate = rank2PostLiveRedirectDeleteApprovalRecordTemplate(packet);
    if (!gate.required_rank2_post_live_redirect_delete_approval_record_template) {
      errors.push("current next required gate must carry the rank2 post-live redirect/delete approval record template");
    }
    if (gate.required_record_schema !== postLiveApprovalRecordTemplate?.schema_version) {
      errors.push(`current next required gate rank2 post-live redirect/delete approval record schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_post_live_redirect_delete_approval_record_template) !== JSON.stringify(postLiveApprovalRecordTemplate)) {
      errors.push("current next required gate rank2 post-live redirect/delete approval record template must match packet template");
    }
    if (
      gate.required_rank2_post_live_redirect_delete_approval_record_template?.approval_status !== "owner_approved_no_execution"
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.approval_scope !== "record_only_no_redirect_no_delete"
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.route_patch_applied !== true
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.deploy_executed !== true
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.redirect_delete_approval_requested !== true
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.redirect_delete_approved !== true
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.redirect_delete_executed !== false
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.public_files_modified !== false
      || gate.required_rank2_post_live_redirect_delete_approval_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_post_live_redirect_delete_approval_record_template?.delete_paths ?? null) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 post-live redirect/delete approval record template must stay approval-record-only/no-execution/no-public-mutation");
    }
  }
  if (
    packet.rank2_post_live_redirect_delete_approval_record_status === "valid_post_live_redirect_delete_approved_no_execution"
    && packet.rank2_post_live_redirect_delete_execution_packet_record_status !== "valid_post_live_redirect_delete_execution_packet_recorded_no_execution"
    && gate.id !== "rank2_post_live_redirect_delete_execution_packet"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_execution_packet after a valid post-live owner approval record: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_execution_packet") {
    const postLiveExecutionPacketTemplate = rank2PostLiveRedirectDeleteExecutionPacketTemplate(packet);
    if (!gate.required_rank2_post_live_redirect_delete_execution_packet_record_template) {
      errors.push("current next required gate must carry the rank2 post-live redirect/delete execution packet template");
    }
    if (gate.required_record_schema !== postLiveExecutionPacketTemplate?.schema_version) {
      errors.push(`current next required gate rank2 post-live redirect/delete execution packet schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_post_live_redirect_delete_execution_packet_record_template) !== JSON.stringify(postLiveExecutionPacketTemplate)) {
      errors.push("current next required gate rank2 post-live redirect/delete execution packet template must match packet template");
    }
    if (
      gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.execution_packet_status !== "planned_no_execution"
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.execution_scope !== "packet_only_no_redirect_no_delete"
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.route_patch_applied !== true
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.deploy_executed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.redirect_delete_approval_requested !== true
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.redirect_delete_approved !== true
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.redirect_delete_execution_planned !== true
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.redirect_delete_executed !== false
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.public_files_modified !== false
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.delete_paths ?? null) !== JSON.stringify([])
      || gate.required_rank2_post_live_redirect_delete_execution_packet_record_template?.execution_steps?.some((step) => step.executed !== false)
    ) {
      errors.push("current next required gate rank2 post-live redirect/delete execution packet template must stay packet-only/no-execution/no-public-mutation");
    }
  }
  if (
    packet.rank2_post_live_redirect_delete_execution_packet_record_status === "valid_post_live_redirect_delete_execution_packet_recorded_no_execution"
    && packet.rank2_post_live_redirect_delete_execution_record_status !== "valid_post_live_redirect_delete_execution_recorded_pending_smoke"
    && gate.id !== "rank2_post_live_redirect_delete_execution_record"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_execution_record after a valid redirect/delete execution packet: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_execution_record") {
    const postLiveExecutionRecordTemplate = rank2PostLiveRedirectDeleteExecutionRecordTemplate(packet);
    if (!gate.required_rank2_post_live_redirect_delete_execution_record_template) {
      errors.push("current next required gate must carry the rank2 post-live redirect/delete execution record template");
    }
    if (gate.required_record_schema !== postLiveExecutionRecordTemplate?.schema_version) {
      errors.push(`current next required gate rank2 post-live redirect/delete execution record schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_post_live_redirect_delete_execution_record_template) !== JSON.stringify(postLiveExecutionRecordTemplate)) {
      errors.push("current next required gate rank2 post-live redirect/delete execution record template must match packet template");
    }
    if (
      gate.required_rank2_post_live_redirect_delete_execution_record_template?.execution_record_status !== "recorded_redirect_delete_executed"
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.execution_scope !== "record_only_redirect_delete_execution_evidence"
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.route_patch_applied !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.deploy_executed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.redirect_delete_approval_requested !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.redirect_delete_approved !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.redirect_delete_execution_planned !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.redirect_delete_executed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.public_files_modified !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.redirect_config_changed !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.execution_performed_outside_this_command !== true
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.execution_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.redirect_config_changed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.delete_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_execution_record_template?.post_execution_smoke_required !== true
    ) {
      errors.push("current next required gate rank2 post-live redirect/delete execution record template must stay external-evidence-only/no-command-mutation");
    }
  }
  if (
    packet.rank2_post_live_redirect_delete_execution_record_status === "valid_post_live_redirect_delete_execution_recorded_pending_smoke"
    && packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status !== "valid_post_live_redirect_delete_post_execution_smoke_recorded"
    && gate.id !== "rank2_post_live_redirect_delete_post_execution_smoke_record"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_post_execution_smoke_record after a valid redirect/delete execution record: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_post_execution_smoke_record") {
    const postExecutionSmokeTemplate = rank2PostLiveRedirectDeletePostExecutionSmokeTemplate(packet);
    if (!gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template) {
      errors.push("current next required gate must carry the rank2 post-live redirect/delete post-execution smoke record template");
    }
    if (gate.required_record_schema !== postExecutionSmokeTemplate?.schema_version) {
      errors.push(`current next required gate rank2 post-live redirect/delete post-execution smoke schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template) !== JSON.stringify(postExecutionSmokeTemplate)) {
      errors.push("current next required gate rank2 post-live redirect/delete post-execution smoke template must match packet template");
    }
    if (
      gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.post_execution_smoke_status !== "recorded_post_execution_smoke"
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.smoke_scope !== "post_execution_smoke_only_no_additional_redirect_delete_no_deploy"
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.route_patch_applied !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.deploy_executed !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.redirect_delete_approval_requested !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.redirect_delete_approved !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.redirect_delete_execution_planned !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.redirect_delete_executed !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.post_execution_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.execution_performed_outside_this_command !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.execution_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.smoke_performed_outside_this_command !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.smoke_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.redirect_config_changed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.delete_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.rollback_readiness_record_required !== true
      || gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template?.rows?.some((row) => row.smoke_executed !== true)
    ) {
      errors.push("current next required gate rank2 post-live redirect/delete post-execution smoke template must stay smoke-evidence-only/no-additional-runtime");
    }
  }
  if (
    packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status === "valid_post_live_redirect_delete_post_execution_smoke_recorded"
    && packet.rank2_post_live_redirect_delete_rollback_readiness_record_status !== "valid_post_live_redirect_delete_rollback_readiness_recorded"
    && gate.id !== "rank2_post_live_redirect_delete_rollback_readiness_record"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_rollback_readiness_record after a valid post-execution smoke record: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_rollback_readiness_record") {
    const rollbackReadinessTemplate = rank2PostLiveRedirectDeleteRollbackReadinessTemplate(packet);
    if (!gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template) {
      errors.push("current next required gate must carry the rank2 post-live redirect/delete rollback readiness record template");
    }
    if (gate.required_record_schema !== rollbackReadinessTemplate?.schema_version) {
      errors.push(`current next required gate rank2 post-live redirect/delete rollback readiness schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template) !== JSON.stringify(rollbackReadinessTemplate)) {
      errors.push("current next required gate rank2 post-live redirect/delete rollback readiness template must match packet template");
    }
    if (
      gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.rollback_readiness_status !== "recorded_rollback_readiness"
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.rollback_scope !== "record_only_rollback_readiness_no_rollback_no_deploy"
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.route_patch_applied !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.deploy_executed !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.redirect_delete_approval_requested !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.redirect_delete_approved !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.redirect_delete_execution_planned !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.redirect_delete_executed !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.post_execution_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.rollback_ready !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.rollback_applied !== false
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.execution_performed_outside_this_command !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.execution_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.smoke_performed_outside_this_command !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.smoke_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.rollback_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.redirect_config_changed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.delete_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.owner_closeout_record_required !== true
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.next_required_runtime_gate !== "post_live_redirect_delete_owner_closeout_record"
      || gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template?.rollback_readiness_checks?.some((check) => check.rollback_ready !== true || check.rollback_applied !== false)
    ) {
      errors.push("current next required gate rank2 post-live redirect/delete rollback readiness template must stay rollback-readiness-only/no-runtime");
    }
  }
  if (
    packet.rank2_post_live_redirect_delete_rollback_readiness_record_status === "valid_post_live_redirect_delete_rollback_readiness_recorded"
    && packet.rank2_post_live_redirect_delete_owner_closeout_record_status !== "valid_post_live_redirect_delete_owner_closeout_recorded"
    && gate.id !== "rank2_post_live_redirect_delete_owner_closeout_record"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_owner_closeout_record after a valid rollback readiness record: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_owner_closeout_record") {
    const ownerCloseoutTemplate = rank2PostLiveRedirectDeleteOwnerCloseoutTemplate(packet);
    if (!gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template) {
      errors.push("current next required gate must carry the rank2 post-live redirect/delete owner closeout record template");
    }
    if (gate.required_record_schema !== ownerCloseoutTemplate?.schema_version) {
      errors.push(`current next required gate rank2 post-live redirect/delete owner closeout schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template) !== JSON.stringify(ownerCloseoutTemplate)) {
      errors.push("current next required gate rank2 post-live redirect/delete owner closeout template must match packet template");
    }
    if (
      gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.owner_closeout_status !== "recorded_owner_closeout"
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.closeout_scope !== "record_only_owner_closeout_no_additional_runtime"
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.route_patch_applied !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.post_patch_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.deploy_executed !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.production_live_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.redirect_delete_approval_requested !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.redirect_delete_approved !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.redirect_delete_execution_planned !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.redirect_delete_executed !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.post_execution_smoke_executed !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.rollback_ready !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.rollback_applied !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.owner_closeout_accepted !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.additional_runtime_required !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.execution_performed_outside_this_command !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.execution_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.smoke_performed_outside_this_command !== true
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.smoke_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.rollback_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.closeout_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.redirect_config_changed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.delete_performed_by_this_command !== false
      || gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template?.next_required_runtime_gate !== "none_record_chain_closed"
    ) {
      errors.push("current next required gate rank2 post-live redirect/delete owner closeout template must stay closeout-evidence-only/no-runtime");
    }
  }
  if (
    packet.rank2_post_live_redirect_delete_owner_closeout_record_status === "valid_post_live_redirect_delete_owner_closeout_recorded"
    && packet.rank2_fresh_owner_runtime_packet_record_status !== "valid_fresh_owner_runtime_packet_recorded_no_execution"
    && gate.id !== "rank2_post_live_redirect_delete_record_chain_closed"
  ) {
    errors.push(`current next required gate must be rank2_post_live_redirect_delete_record_chain_closed after a valid owner closeout record: ${gate.id}`);
  }
  if (gate.id === "rank2_post_live_redirect_delete_record_chain_closed") {
    if (gate.status !== "record_chain_closed_no_additional_runtime") {
      errors.push(`current next required gate chain-closed status mismatch: ${gate.status}`);
    }
    if (gate.owner_record_required !== false) {
      errors.push("current next required gate chain-closed state must not require another owner record");
    }
    if (gate.template_command !== null || gate.validation_command !== null) {
      errors.push("current next required gate chain-closed state must not expose another template/validation command");
    }
    if (gate.current_status !== "valid_post_live_redirect_delete_owner_closeout_recorded"
      || gate.required_status !== "valid_post_live_redirect_delete_owner_closeout_recorded") {
      errors.push("current next required gate chain-closed state must be backed by a valid owner closeout record");
    }
    if (gate.next_safe_enforcement_slice !== "rank2_post_live_redirect_delete_fresh_owner_packet_required") {
      errors.push("current next required gate chain-closed state must point to the fresh owner packet guard");
    }
    if (
      gate.next_required_owner_packet?.status !== "blocked_pending_fresh_owner_approved_packet"
      || gate.next_required_owner_packet?.mutation !== "none"
      || gate.next_required_owner_packet?.mutation_allowed !== false
      || gate.next_required_owner_packet?.owner_record_required !== true
      || gate.next_required_owner_packet?.separate_mutation_approval_required !== true
      || gate.next_required_owner_packet?.required_record_schema !== "rank2-fresh-owner-runtime-packet-record/v0.1"
    ) {
      errors.push("current next required gate chain-closed state must require a fresh owner-approved packet before new runtime");
    }
    if (
      gate.next_required_owner_packet?.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-template"
      || gate.next_required_owner_packet?.validation_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<json>'"
    ) {
      errors.push("current next required gate chain-closed state must expose fresh owner packet template/validation commands");
    }
    if (!Array.isArray(gate.next_required_owner_packet?.required_evidence)
      || !gate.next_required_owner_packet.required_evidence.some((item) => item.includes("PRO route/IA acceptance"))
      || !gate.next_required_owner_packet.required_evidence.some((item) => item.includes("live-equivalence proof"))
      || !gate.next_required_owner_packet.required_evidence.some((item) => item.includes("rollback plan"))
      || !gate.next_required_owner_packet.required_evidence.some((item) => item.includes("explicit owner approval"))) {
      errors.push("current next required gate chain-closed state must list fresh owner packet evidence");
    }
    const freshContract = freshOwnerApprovedPacketContract(packet);
    if (JSON.stringify(gate.next_required_owner_packet?.required_contract) !== JSON.stringify(freshContract)) {
      errors.push("current next required gate chain-closed state must carry the exact fresh owner packet contract");
    }
    const contract = gate.next_required_owner_packet?.required_contract;
    if (
      contract?.id !== "post_terminal_fresh_owner_packet_contract"
      || contract?.status !== "required_before_any_new_runtime"
      || contract?.mutation !== "none"
      || contract?.mutation_allowed !== false
      || contract?.previous_record_chain_reuse_allowed !== false
    ) {
      errors.push("fresh owner packet contract must stay required/no-mutation/no-reuse");
    }
    if (!Array.isArray(contract?.required_sections)
      || !contract.required_sections.includes("pro_route_ia_acceptance")
      || !contract.required_sections.includes("local_live_equivalence")
      || !contract.required_sections.includes("rollback_plan")
      || !contract.required_sections.includes("explicit_owner_approval")) {
      errors.push("fresh owner packet contract must require PRO IA, live-equivalence, rollback, and owner approval sections");
    }
    if (!Array.isArray(contract?.required_pro_route_ia_acceptance_checks)
      || contract.required_pro_route_ia_acceptance_checks.length === 0
      || contract.required_pro_route_ia_acceptance_checks.some((check) => check.status !== "pass")) {
      errors.push("fresh owner packet contract must carry passing PRO route/IA acceptance checks");
    }
    if (contract?.required_pro_screen_model_acceptance?.acceptance_ready !== true
      || contract.required_pro_screen_model_acceptance.home_primary_allowed !== false
      || contract.required_pro_screen_model_acceptance.mobile_primary_allowed !== false) {
      errors.push("fresh owner packet contract must keep PRO screen-model acceptance ready and out of Home/mobile primary IA");
    }
    if (contract?.required_live_equivalence?.proof_status_required !== "local_runtime_smoke_passed"
      || !Array.isArray(contract.required_live_equivalence.rows)
      || contract.required_live_equivalence.rows.length === 0
      || contract.required_live_equivalence.rows.some((row) => !row.command || row.expected_http_status !== 200)) {
      errors.push("fresh owner packet contract must require concrete local live-equivalence rows");
    }
    if (contract?.required_rollback_plan?.schema_version !== "rank2-rollback-plan-record/v0.1"
      || contract.required_rollback_plan.rollback_scope !== "plan_only_no_execution"
      || contract.required_rollback_plan.rollback_applied !== false
      || contract.required_rollback_plan.route_patch_applied !== false) {
      errors.push("fresh owner packet contract must require a no-execution rollback plan");
    }
    if (contract?.required_explicit_owner_approval?.approved_by_required !== true
      || contract.required_explicit_owner_approval.approved_at_iso8601_required !== true
      || contract.required_explicit_owner_approval.execution_by_this_command_allowed !== false
      || !contract.required_explicit_owner_approval.mutation_scope_must_name?.includes("redirect")
      || !contract.required_explicit_owner_approval.mutation_scope_must_name?.includes("delete")
      || !contract.required_explicit_owner_approval.mutation_scope_must_name?.includes("deploy")
      || !contract.required_explicit_owner_approval.mutation_scope_must_name?.includes("public_file_mutation")) {
      errors.push("fresh owner packet contract must require explicit scoped owner approval and keep command-side execution disabled");
    }
    if (!gate.required_valid_records?.some((record) => (
      record.id === "rank2_post_live_redirect_delete_owner_closeout_record"
      && record.status === "valid_post_live_redirect_delete_owner_closeout_recorded"
      && record.required_status === "valid_post_live_redirect_delete_owner_closeout_recorded"
    ))) {
      errors.push("current next required gate chain-closed state must cite the valid owner closeout record");
    }
  }
  if (
    packet.rank2_fresh_owner_runtime_packet_record_status === "valid_fresh_owner_runtime_packet_recorded_no_execution"
    && packet.rank2_fresh_owner_runtime_execution_packet_record_status !== "valid_fresh_owner_runtime_execution_packet_recorded_no_execution"
    && gate.id !== "rank2_fresh_owner_runtime_execution_packet_record"
  ) {
    errors.push(`current next required gate must be rank2_fresh_owner_runtime_execution_packet_record after a valid fresh owner packet: ${gate.id}`);
  }
  if (gate.id === "rank2_fresh_owner_runtime_execution_packet_record") {
    const runtimeExecutionPacketTemplate = rank2FreshOwnerRuntimeExecutionPacketTemplate(packet);
    if (!gate.required_rank2_fresh_owner_runtime_execution_packet_record_template) {
      errors.push("current next required gate must carry the rank2 fresh owner runtime execution packet record template");
    }
    if (gate.required_record_schema !== runtimeExecutionPacketTemplate?.schema_version) {
      errors.push(`current next required gate rank2 fresh owner runtime execution packet schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_fresh_owner_runtime_execution_packet_record_template) !== JSON.stringify(runtimeExecutionPacketTemplate)) {
      errors.push("current next required gate rank2 fresh owner runtime execution packet template must match packet template");
    }
    if (
      gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.execution_packet_status !== "planned_no_execution"
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.execution_scope !== "packet_only_no_runtime"
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.fresh_owner_packet_validated !== true
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.execution_allowed !== false
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.execution_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.route_patch_applied !== false
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.redirect_delete_executed !== false
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.deploy_executed !== false
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.public_files_modified !== false
      || gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.redirect_config_changed !== false
      || JSON.stringify(gate.required_rank2_fresh_owner_runtime_execution_packet_record_template?.delete_paths) !== JSON.stringify([])
    ) {
      errors.push("current next required gate rank2 fresh owner runtime execution packet template must stay packet-only/no-runtime/no-public-mutation");
    }
  }
  if (
    packet.rank2_fresh_owner_runtime_execution_packet_record_status === "valid_fresh_owner_runtime_execution_packet_recorded_no_execution"
    && packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status !== "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke"
    && gate.id !== "rank2_fresh_owner_external_runtime_execution_evidence_record"
  ) {
    errors.push(`current next required gate must be rank2_fresh_owner_external_runtime_execution_evidence_record after a valid runtime execution packet record: ${gate.id}`);
  }
  if (gate.id === "rank2_fresh_owner_external_runtime_execution_evidence_record") {
    const externalRuntimeExecutionEvidenceTemplate = rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate(packet);
    if (!gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template) {
      errors.push("current next required gate must carry the rank2 fresh owner external runtime execution evidence record template");
    }
    if (gate.required_record_schema !== externalRuntimeExecutionEvidenceTemplate?.schema_version) {
      errors.push(`current next required gate rank2 fresh owner external runtime execution evidence schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template) !== JSON.stringify(externalRuntimeExecutionEvidenceTemplate)) {
      errors.push("current next required gate rank2 fresh owner external runtime execution evidence template must match packet template");
    }
    if (
      gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.execution_evidence_status !== "recorded_external_runtime_execution_pending_smoke"
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.execution_scope !== "external_runtime_execution_evidence_only"
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.fresh_owner_runtime_execution_packet_record_status !== "valid_fresh_owner_runtime_execution_packet_recorded_no_execution"
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.execution_performed_outside_this_command !== true
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.execution_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.deploy_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.public_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template?.post_runtime_smoke_required !== true
    ) {
      errors.push("current next required gate rank2 fresh owner external runtime execution evidence template must stay external-evidence-only/no-command-mutation");
    }
  }
  if (
    packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status === "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke"
    && packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status !== "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback"
    && gate.id !== "rank2_fresh_owner_post_runtime_smoke_evidence_record"
  ) {
    errors.push(`current next required gate must be rank2_fresh_owner_post_runtime_smoke_evidence_record after valid external runtime execution evidence: ${gate.id}`);
  }
  if (gate.id === "rank2_fresh_owner_post_runtime_smoke_evidence_record") {
    const postRuntimeSmokeEvidenceTemplate = rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate(packet);
    if (!gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template) {
      errors.push("current next required gate must carry the rank2 fresh owner post-runtime smoke evidence record template");
    }
    if (gate.required_record_schema !== postRuntimeSmokeEvidenceTemplate?.schema_version) {
      errors.push(`current next required gate rank2 fresh owner post-runtime smoke evidence schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template) !== JSON.stringify(postRuntimeSmokeEvidenceTemplate)) {
      errors.push("current next required gate rank2 fresh owner post-runtime smoke evidence template must match packet template");
    }
    if (
      gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.post_runtime_smoke_status !== "recorded_post_runtime_smoke_pending_rollback"
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.smoke_scope !== "post_runtime_smoke_evidence_only_no_additional_runtime"
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.fresh_owner_external_runtime_execution_evidence_record_status !== "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke"
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.smoke_performed_outside_this_command !== true
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.smoke_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.rollback_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.deploy_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.public_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template?.rollback_readiness_required !== true
    ) {
      errors.push("current next required gate rank2 fresh owner post-runtime smoke evidence template must stay smoke-evidence-only/no-command-runtime");
    }
  }
  if (
    packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status === "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback"
    && packet.rank2_fresh_owner_rollback_readiness_record_status !== "valid_fresh_owner_rollback_readiness_recorded_pending_closeout"
    && gate.id !== "rank2_fresh_owner_rollback_readiness_record"
  ) {
    errors.push(`current next required gate must be rank2_fresh_owner_rollback_readiness_record after valid post-runtime smoke evidence: ${gate.id}`);
  }
  if (gate.id === "rank2_fresh_owner_rollback_readiness_record") {
    const rollbackReadinessTemplate = rank2FreshOwnerRollbackReadinessTemplate(packet);
    if (!gate.required_rank2_fresh_owner_rollback_readiness_record_template) {
      errors.push("current next required gate must carry the rank2 fresh owner rollback readiness record template");
    }
    if (gate.required_record_schema !== rollbackReadinessTemplate?.schema_version) {
      errors.push(`current next required gate rank2 fresh owner rollback readiness schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_fresh_owner_rollback_readiness_record_template) !== JSON.stringify(rollbackReadinessTemplate)) {
      errors.push("current next required gate rank2 fresh owner rollback readiness template must match packet template");
    }
    if (
      gate.required_rank2_fresh_owner_rollback_readiness_record_template?.rollback_readiness_status !== "recorded_fresh_owner_rollback_readiness_pending_closeout"
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.rollback_scope !== "record_only_rollback_readiness_no_rollback_no_deploy"
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.fresh_owner_post_runtime_smoke_evidence_record_status !== "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback"
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.rollback_ready !== true
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.rollback_applied !== false
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.rollback_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.deploy_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.public_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_rollback_readiness_record_template?.owner_closeout_required !== true
    ) {
      errors.push("current next required gate rank2 fresh owner rollback readiness template must stay rollback-readiness-only/no-command-rollback");
    }
  }
  if (
    packet.rank2_fresh_owner_rollback_readiness_record_status === "valid_fresh_owner_rollback_readiness_recorded_pending_closeout"
    && packet.rank2_fresh_owner_owner_closeout_record_status !== "valid_fresh_owner_owner_closeout_recorded"
    && gate.id !== "rank2_fresh_owner_owner_closeout_record"
  ) {
    errors.push(`current next required gate must be rank2_fresh_owner_owner_closeout_record after valid rollback readiness evidence: ${gate.id}`);
  }
  if (gate.id === "rank2_fresh_owner_owner_closeout_record") {
    const ownerCloseoutTemplate = rank2FreshOwnerOwnerCloseoutTemplate(packet);
    if (!gate.required_rank2_fresh_owner_owner_closeout_record_template) {
      errors.push("current next required gate must carry the rank2 fresh owner owner closeout record template");
    }
    if (gate.required_record_schema !== ownerCloseoutTemplate?.schema_version) {
      errors.push(`current next required gate rank2 fresh owner owner closeout schema mismatch: ${gate.required_record_schema}`);
    }
    if (JSON.stringify(gate.required_rank2_fresh_owner_owner_closeout_record_template) !== JSON.stringify(ownerCloseoutTemplate)) {
      errors.push("current next required gate rank2 fresh owner owner closeout template must match packet template");
    }
    if (
      gate.required_rank2_fresh_owner_owner_closeout_record_template?.owner_closeout_status !== "recorded_fresh_owner_owner_closeout"
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.closeout_scope !== "record_only_owner_closeout_no_additional_runtime"
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.fresh_owner_rollback_readiness_record_status !== "valid_fresh_owner_rollback_readiness_recorded_pending_closeout"
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.owner_closeout_accepted !== true
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.additional_runtime_required !== false
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.closeout_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.local_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.deploy_performed_by_this_command !== false
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.public_files_modified_by_this_command !== false
      || gate.required_rank2_fresh_owner_owner_closeout_record_template?.next_required_runtime_gate !== "none_record_chain_closed"
    ) {
      errors.push("current next required gate rank2 fresh owner owner closeout template must stay closeout-only/no-additional-runtime");
    }
  }
  if (
    packet.rank2_fresh_owner_owner_closeout_record_status === "valid_fresh_owner_owner_closeout_recorded"
    && gate.id !== "rank2_fresh_owner_record_chain_closed"
  ) {
    errors.push(`current next required gate must be rank2_fresh_owner_record_chain_closed after valid owner closeout evidence: ${gate.id}`);
  }
  if (gate.id === "rank2_fresh_owner_record_chain_closed") {
    if (gate.status !== "fresh_owner_record_chain_closed_no_additional_runtime") {
      errors.push(`current next required gate fresh owner chain closed status mismatch: ${gate.status}`);
    }
    if (gate.owner_record_required !== false) {
      errors.push("current next required gate fresh owner chain closed state must not require another owner record");
    }
    if (gate.template_command !== null || gate.validation_command !== null) {
      errors.push("current next required gate fresh owner chain closed state must not expose another template/validation command");
    }
    if (gate.next_safe_enforcement_slice !== "none_record_chain_closed") {
      errors.push("current next required gate fresh owner chain closed state must not point to another runtime slice");
    }
  }
  return errors;
}

function validateReportingSummary(packet) {
  const errors = [];
  const summary = packet.reporting_summary;
  if (!summary) return ["reporting summary must be present"];
  if (JSON.stringify(summary) !== JSON.stringify(reportingSummary(packet))) {
    errors.push("reporting summary must match current packet state");
  }
  if (summary.schema_version !== "macro-owner-reporting-summary/v0.1") {
    errors.push(`reporting summary schema mismatch: ${summary.schema_version}`);
  }
  if (summary.next_gated_slice !== packet.next_gated_slice?.id) {
    errors.push(`reporting summary next gated slice mismatch: ${summary.next_gated_slice}`);
  }
  if (summary.current_next_required_gate !== packet.current_next_required_gate?.id) {
    errors.push(`reporting summary current gate mismatch: ${summary.current_next_required_gate}`);
  }
  if (JSON.stringify(summary.current_gate_checklist) !== JSON.stringify(currentGateChecklist(packet))) {
    errors.push("reporting summary current gate checklist must match current packet state");
  }
  const gateChecklist = summary.current_gate_checklist;
  if (gateChecklist?.schema_version !== "macro-owner-current-gate-checklist/v0.1") {
    errors.push(`reporting summary current gate checklist schema mismatch: ${gateChecklist?.schema_version}`);
  }
  if (gateChecklist?.gate !== packet.current_next_required_gate?.id) {
    errors.push(`reporting summary current gate checklist gate mismatch: ${gateChecklist?.gate}`);
  }
  if (gateChecklist?.next_safe_enforcement_slice_id !== currentSafeEnforcementSliceId(packet)) {
    errors.push(`reporting summary current gate checklist safe-slice mismatch: ${gateChecklist?.next_safe_enforcement_slice_id}`);
  }
  if (JSON.stringify(gateChecklist?.blocked_actions) !== JSON.stringify(requiredBlockedActionsForGate(packet.current_next_required_gate))) {
    errors.push("reporting summary current gate checklist blocked actions must match current gate");
  }
  const gateChecklistChecks = Object.fromEntries((gateChecklist?.checks ?? []).map((check) => [check.id, check]));
  for (const id of [
    "gate_no_mutation",
    "separate_mutation_approval_required",
    "blocked_actions_locked",
    "local_live_equivalence_locked",
    "pro_route_ia_acceptance_locked",
    "evidence_detail_surface_locked",
    "safe_enforcement_slice_linked",
  ]) {
    if (gateChecklistChecks[id]?.status !== "pass") {
      errors.push(`reporting summary current gate checklist must pass ${id}`);
    }
  }
  if (!["pending", "satisfied"].includes(gateChecklistChecks.required_record_status?.status)) {
    errors.push(`reporting summary current gate checklist required record status mismatch: ${gateChecklistChecks.required_record_status?.status}`);
  }
  if (summary.local_live_equivalence?.proof_status !== "local_runtime_smoke_passed") {
    errors.push("reporting summary must carry passed local live-equivalence proof");
  }
  if (summary.local_live_equivalence?.rows_checked !== summary.local_live_equivalence?.rows_expected) {
    errors.push("reporting summary local live-equivalence row count must match");
  }
  if (JSON.stringify(summary.local_live_equivalence?.rows) !== JSON.stringify(packet.evidence.smoke_rows)) {
    errors.push("reporting summary local live-equivalence rows must match packet evidence");
  }
  if (summary.local_live_equivalence?.rows?.length !== summary.local_live_equivalence?.rows_expected) {
    errors.push("reporting summary local live-equivalence row set length must match expected rows");
  }
  if (summary.local_live_equivalence?.rows?.some((row) => row.expected_http_status !== row.status || row.ok !== true)) {
    errors.push("reporting summary local live-equivalence rows must carry passing status evidence");
  }
  if (summary.pro_route_ia_acceptance?.status !== "all_pass" || summary.pro_route_ia_acceptance?.checks < 10) {
    errors.push("reporting summary must carry all-pass PRO route/IA checks");
  }
  if (JSON.stringify(summary.pro_route_ia_acceptance?.check_details) !== JSON.stringify(
    packet.owner_decision_acceptance_contract?.required_pro_route_ia_acceptance_checks ?? [],
  )) {
    errors.push("reporting summary PRO route/IA check details must match owner acceptance contract");
  }
  if (summary.pro_route_ia_acceptance?.check_details?.some((check) => check.status !== "pass")) {
    errors.push("reporting summary PRO route/IA check details must all pass");
  }
  if (!Array.isArray(summary.pro_route_ia_acceptance?.file_line_evidence)
    || summary.pro_route_ia_acceptance.file_line_evidence.length === 0) {
    errors.push("reporting summary must carry PRO file:line evidence");
  }
  if (JSON.stringify(summary.home_dashboard_entrypoint_file_lines) !== JSON.stringify(
    uniqueList((packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows ?? []).map(fileLine)),
  )) {
    errors.push("reporting summary Home/dashboard file:line evidence must match packet evidence");
  }
  if (JSON.stringify(summary.source_reference_file_lines) !== JSON.stringify(
    uniqueList((packet.evidence.src_legacy_reference_rows ?? [])
      .map((row) => {
        const base = fileLine(row);
        return base ? `${base}:${row.class}` : null;
      })),
  )) {
    errors.push("reporting summary source-reference file:line evidence must match packet evidence");
  }
  if (summary.safe_enforcement_slice_count !== packet.safe_enforcement_slices?.length) {
    errors.push("reporting summary safe enforcement slice count mismatch");
  }
  if (summary.safe_enforcement_slice_details?.length !== summary.safe_enforcement_slice_count) {
    errors.push("reporting summary safe enforcement slice details length must match count");
  }
  if (JSON.stringify(summary.safe_enforcement_slice_details) !== JSON.stringify(packet.safe_enforcement_slices ?? [])) {
    errors.push("reporting summary safe enforcement slice details must match packet proposal");
  }
  if (JSON.stringify(summary.safe_enforcement_slice_details?.map((slice) => slice.id)) !== JSON.stringify(summary.safe_enforcement_slice_ids)) {
    errors.push("reporting summary safe enforcement slice detail ids must match id list");
  }
  if (summary.safe_enforcement_slice_details?.some((slice) => slice.mutation !== "none" || slice.mutation_allowed !== false)) {
    errors.push("reporting summary safe enforcement slice details must remain no-mutation");
  }
  if (summary.safe_enforcement_slice_details?.some((slice) => !Array.isArray(slice.blocked_actions) || slice.blocked_actions.length === 0)) {
    errors.push("reporting summary safe enforcement slice details must carry blocked actions");
  }
  if (!summary.safe_enforcement_slice_ids?.includes("owner_decision_record_validation")
    || !summary.safe_enforcement_slice_ids?.includes("rank2_fresh_owner_owner_closeout_required")) {
    errors.push("reporting summary must include first and final safe enforcement slice ids");
  }
  if (summary.current_safe_enforcement_slice_id !== currentSafeEnforcementSliceId(packet)) {
    errors.push(`reporting summary current safe enforcement slice id mismatch: ${summary.current_safe_enforcement_slice_id}`);
  }
  if (JSON.stringify(summary.current_safe_enforcement_slice) !== JSON.stringify(currentSafeEnforcementSlice(packet))) {
    errors.push("reporting summary current safe enforcement slice must match packet state");
  }
  if (summary.current_safe_enforcement_slice_id
    && summary.current_safe_enforcement_slice_id !== "none_record_chain_closed"
    && !summary.safe_enforcement_slice_ids?.includes(summary.current_safe_enforcement_slice_id)) {
    errors.push(`reporting summary current safe enforcement slice id must be present in the slice list: ${summary.current_safe_enforcement_slice_id}`);
  }
  if (summary.current_safe_enforcement_slice
    && (summary.current_safe_enforcement_slice.mutation !== "none"
      || summary.current_safe_enforcement_slice.mutation_allowed !== false)) {
    errors.push("reporting summary current safe enforcement slice must remain no-mutation");
  }
  if (summary.current_safe_enforcement_slice
    && JSON.stringify(summary.current_safe_enforcement_slice.blocked_actions) !== JSON.stringify(requiredBlockedActionsForGate(packet.current_next_required_gate))) {
    errors.push("reporting summary current safe enforcement slice blocked actions must match current gate");
  }
  if (summary.current_safe_enforcement_slice_id === "owner_decision_record_validation"
    && JSON.stringify(summary.current_safe_enforcement_slice?.required_evidence_detail_surface) !== JSON.stringify(packet.next_gated_slice?.required_evidence_detail_surface)) {
    errors.push("reporting summary current owner decision safe-slice evidence detail surface must match current gate");
  }
  const inputContract = summary.owner_decision_input_contract;
  if (JSON.stringify(inputContract) !== JSON.stringify(ownerDecisionInputContract(packet))) {
    errors.push("reporting summary owner decision input contract must match current packet requirements");
  }
  if (inputContract?.required_record_schema !== packet.next_gated_slice?.required_record_schema) {
    errors.push(`reporting summary owner decision input record schema mismatch: ${inputContract?.required_record_schema}`);
  }
  if (inputContract?.template_command !== packet.next_owner_action?.template_command) {
    errors.push(`reporting summary owner decision input template command mismatch: ${inputContract?.template_command}`);
  }
  if (JSON.stringify(inputContract?.required_record_fields) !== JSON.stringify(ownerDecisionRequiredRecordFields())) {
    errors.push("reporting summary owner decision input required fields must match canonical decision record fields");
  }
  if (inputContract?.required_record_mutation_approved !== false
    || inputContract?.required_record_execution_allowed !== false
    || inputContract?.required_record_execution_by_this_command_allowed !== false) {
    errors.push("reporting summary owner decision input contract must expose no-mutation/no-execution record values");
  }
  if (inputContract?.required_record_mutation_approved !== packet.decision_record_template?.mutation_approved
    || inputContract?.required_record_execution_allowed !== packet.decision_record_template?.execution_allowed
    || inputContract?.required_record_execution_by_this_command_allowed !== packet.decision_record_template?.execution_by_this_command_allowed) {
    errors.push("reporting summary owner decision input no-mutation/no-execution values must match decision record template");
  }
  const decisionTemplate = packet.decision_record_template ?? {};
  const templateLocalRows = decisionTemplate.local_live_equivalence_rows ?? [];
  const templateProChecks = decisionTemplate.pro_route_ia_acceptance_checks ?? [];
  const templateDecisionOptions = decisionTemplate.decision_options ?? [];
  const templateReleaseBlockers = decisionTemplate.release_blockers_acknowledged ?? [];
  const templateFollowupPlans = decisionTemplate.decision_followup_plans ?? [];
  const templateHomeDashboardFileLines = homeDashboardFileLineEvidence(decisionTemplate.home_dashboard_legacy_bridge_entrypoints ?? []);
  const templateSourceReferenceFileLines = sourceReferenceFileLineEvidence(decisionTemplate.src_legacy_reference_rows ?? []);
  const templateProFileLineEvidence = proRouteIaFileLineEvidence(templateProChecks);
  const templateDecisionOptionBlockedActions = Object.fromEntries(
    templateDecisionOptions.map((option) => [option.decision, option.blocked_actions ?? []]),
  );
  if (inputContract?.required_owner_approved_by_placeholder !== decisionTemplate.owner_approved_by
    || inputContract?.required_owner_approved_by_non_empty !== true) {
    errors.push("reporting summary owner decision input owner approval field requirements must match decision record template");
  }
  if (inputContract?.required_decided_at_placeholder !== decisionTemplate.decided_at
    || inputContract?.required_decided_at_format !== "full ISO-8601 timestamp with timezone"
    || inputContract?.required_decided_at_pattern !== ISO_8601_TIMESTAMP_PATTERN.source) {
    errors.push("reporting summary owner decision input decided_at timestamp requirements must match validator");
  }
  if (JSON.stringify(inputContract?.required_decision_option_keys) !== JSON.stringify(templateDecisionOptions.map((option) => option.decision))
    || JSON.stringify(inputContract?.required_decision_option_keys) !== JSON.stringify(packet.next_gated_slice?.required_decisions ?? [])
    || inputContract?.required_decision_option_count !== templateDecisionOptions.length) {
    errors.push("reporting summary owner decision input decision options must match decision record template and current gate");
  }
  if (inputContract?.required_decision_options_mutation_allowed !== false
    || templateDecisionOptions.some((option) => option.mutation_allowed !== false)
    || JSON.stringify(inputContract?.required_decision_options_blocked_actions) !== JSON.stringify(templateDecisionOptionBlockedActions)) {
    errors.push("reporting summary owner decision input decision option blockers must match decision record template");
  }
  if (JSON.stringify(inputContract?.required_release_blockers_acknowledged) !== JSON.stringify(templateReleaseBlockers)
    || JSON.stringify(inputContract?.required_release_blockers_acknowledged) !== JSON.stringify(packet.release_blockers)
    || inputContract?.required_release_blocker_count !== templateReleaseBlockers.length) {
    errors.push("reporting summary owner decision input release blockers must match decision record template and packet blockers");
  }
  if (JSON.stringify(inputContract?.required_decision_followup_plan_ids) !== JSON.stringify(templateFollowupPlans.map((plan) => plan.id))
    || inputContract?.required_decision_followup_plan_count !== templateFollowupPlans.length) {
    errors.push("reporting summary owner decision input follow-up plan ids must match decision record template");
  }
  if (inputContract?.required_family_id !== decisionTemplate.family_id
    || inputContract?.required_owner_route !== decisionTemplate.owner_route
    || inputContract?.required_compatibility_route !== decisionTemplate.compatibility_route) {
    errors.push("reporting summary owner decision input route identity values must match decision record template");
  }
  if (inputContract?.required_local_live_equivalence_base_url !== decisionTemplate.local_live_equivalence_base_url
    || inputContract?.required_local_live_equivalence_proof_status !== decisionTemplate.local_live_equivalence_proof_status
    || inputContract?.required_local_live_equivalence_rows_checked !== decisionTemplate.local_live_equivalence_rows_checked
    || inputContract?.required_local_live_equivalence_row_count !== templateLocalRows.length
    || inputContract?.required_local_live_equivalence_row_count !== summary.local_live_equivalence?.rows_expected) {
    errors.push("reporting summary owner decision input local live-equivalence values must match decision record template and summary");
  }
  if (JSON.stringify(inputContract?.required_local_live_equivalence_row_paths) !== JSON.stringify(templateLocalRows.map((row) => row.path))
    || JSON.stringify(inputContract?.required_local_live_equivalence_row_paths) !== JSON.stringify((summary.local_live_equivalence?.rows ?? []).map((row) => row.path))
    || JSON.stringify(inputContract?.required_local_live_equivalence_row_statuses) !== JSON.stringify(liveEquivalenceRowStatusSurface(templateLocalRows))
    || JSON.stringify(inputContract?.required_local_live_equivalence_row_statuses) !== JSON.stringify(liveEquivalenceRowStatusSurface(summary.local_live_equivalence?.rows ?? []))
    || inputContract?.required_local_live_equivalence_rows_all_ok !== true
    || templateLocalRows.some((row) => row.ok !== true)) {
    errors.push("reporting summary owner decision input local live-equivalence row identity/status surface must match template and summary");
  }
  if (JSON.stringify(inputContract?.required_pro_route_ia_acceptance_check_ids) !== JSON.stringify(templateProChecks.map((check) => check.id))
    || inputContract?.required_pro_route_ia_acceptance_check_count !== templateProChecks.length
    || inputContract?.required_pro_route_ia_acceptance_check_count !== summary.pro_route_ia_acceptance?.checks) {
    errors.push("reporting summary owner decision input PRO route/IA check values must match decision record template and summary");
  }
  if (JSON.stringify(inputContract?.required_pro_route_ia_acceptance_check_statuses) !== JSON.stringify(proRouteIaCheckStatusSurface(templateProChecks))
    || JSON.stringify(inputContract?.required_pro_route_ia_acceptance_check_statuses) !== JSON.stringify(proRouteIaCheckStatusSurface(summary.pro_route_ia_acceptance?.check_details ?? []))
    || inputContract?.required_pro_route_ia_acceptance_all_pass !== true
    || templateProChecks.some((check) => check.status !== "pass")
    || JSON.stringify(inputContract?.required_pro_route_ia_acceptance_file_line_evidence) !== JSON.stringify(templateProFileLineEvidence)
    || JSON.stringify(inputContract?.required_pro_route_ia_acceptance_file_line_evidence) !== JSON.stringify(summary.pro_route_ia_acceptance?.file_line_evidence ?? [])) {
    errors.push("reporting summary owner decision input PRO route/IA status/evidence surface must match template and summary");
  }
  if (inputContract?.required_home_dashboard_legacy_bridge_entrypoint_count !== (decisionTemplate.home_dashboard_legacy_bridge_entrypoints?.length ?? 0)
    || inputContract?.required_home_dashboard_legacy_bridge_entrypoint_count !== summary.home_dashboard_entrypoint_file_lines?.length
    || inputContract?.required_src_legacy_reference_row_count !== (decisionTemplate.src_legacy_reference_rows?.length ?? 0)
    || inputContract?.required_src_legacy_reference_row_count !== summary.source_reference_file_lines?.length) {
    errors.push("reporting summary owner decision input inventory counts must match decision record template and summary");
  }
  if (JSON.stringify(inputContract?.required_home_dashboard_legacy_bridge_entrypoint_file_lines) !== JSON.stringify(templateHomeDashboardFileLines)
    || JSON.stringify(inputContract?.required_home_dashboard_legacy_bridge_entrypoint_file_lines) !== JSON.stringify(summary.home_dashboard_entrypoint_file_lines ?? [])
    || JSON.stringify(inputContract?.required_src_legacy_reference_file_lines) !== JSON.stringify(templateSourceReferenceFileLines)
    || JSON.stringify(inputContract?.required_src_legacy_reference_file_lines) !== JSON.stringify(summary.source_reference_file_lines ?? [])) {
    errors.push("reporting summary owner decision input inventory file-line surface must match decision record template and summary");
  }
  for (const field of inputContract?.required_record_fields ?? []) {
    if (!Object.hasOwn(packet.decision_record_template ?? {}, field)) {
      errors.push(`reporting summary owner decision input required field missing from decision record template: ${field}`);
    }
  }
  for (const field of [
    "owner_approved_by",
    "decided_at",
    "decision",
    "selected_decision_followup_plan",
    "reporting_summary_acknowledgement",
    "safe_enforcement_slice_acknowledgement",
    "mutation_approved",
  ]) {
    if (!inputContract?.required_record_fields?.includes(field)) {
      errors.push(`reporting summary owner decision input contract must require ${field}`);
    }
  }
  if (inputContract?.required_acknowledgement_schemas?.reporting_summary !== "macro-owner-reporting-summary-ack/v0.1"
    || inputContract?.required_acknowledgement_schemas?.safe_enforcement_slices !== "macro-owner-safe-enforcement-slices-ack/v0.1"
    || inputContract?.required_acknowledgement_schemas?.followup_selection !== "macro-owner-decision-followup-selection/v0.1") {
    errors.push("reporting summary owner decision input contract must expose required acknowledgement schemas");
  }
  const followupSelection = packet.owner_decision_acceptance_contract?.required_decision_followup_selection_contract ?? {};
  const followupSelectionOptionKeys = Object.keys(followupSelection.required_options_by_decision ?? {});
  if (JSON.stringify(inputContract?.required_decision_followup_selection_contract_fields) !== JSON.stringify(ownerDecisionFollowupSelectionContractRequiredFields())) {
    errors.push("reporting summary owner decision input contract must expose follow-up selection required fields");
  }
  if (inputContract?.required_decision_followup_selection_field !== "decision"
    || JSON.stringify(inputContract?.required_decision_followup_selection_option_keys) !== JSON.stringify(followupSelectionOptionKeys)
    || JSON.stringify(inputContract?.required_decision_followup_selection_option_keys) !== JSON.stringify(packet.next_gated_slice?.required_decisions ?? [])) {
    errors.push("reporting summary owner decision input contract follow-up selection identity mismatch");
  }
  if (inputContract?.required_decision_followup_selection_mutation_allowed !== false
    || inputContract?.required_decision_followup_selection_separate_mutation_approval_required !== true
    || JSON.stringify(inputContract?.required_decision_followup_selection_blocked_actions) !== JSON.stringify(ownerDecisionBlockedActions())
    || inputContract?.required_decision_followup_selection_options_require_blocked_actions !== true) {
    errors.push("reporting summary owner decision input contract must expose follow-up selection blockers");
  }
  for (const [decision, option] of Object.entries(inputContract?.selected_followup_options ?? {})) {
    if (!followupSelectionOptionKeys.includes(decision)
      || option.mutation_allowed !== false
      || option.separate_mutation_approval_required !== true
      || JSON.stringify(option.blocked_actions) !== JSON.stringify(ownerDecisionBlockedActions())) {
      errors.push(`reporting summary owner decision input contract follow-up option mismatch: ${decision}`);
    }
  }
  const reportingSummaryAck = packet.owner_decision_acceptance_contract?.required_reporting_summary_acknowledgement ?? {};
  if (JSON.stringify(inputContract?.required_reporting_summary_acknowledgement_fields) !== JSON.stringify(ownerDecisionReportingSummaryAcknowledgementRequiredFields())) {
    errors.push("reporting summary owner decision input contract must expose reporting-summary acknowledgement required fields");
  }
  if (!inputContract?.required_reporting_summary_acknowledgement_fields?.includes("current_gate_checklist_required_checks")
    || !inputContract?.required_reporting_summary_acknowledgement_fields?.includes("summary_must_be_generated_from_current_packet")) {
    errors.push("reporting summary owner decision input contract must require reporting-summary current-gate acknowledgement fields");
  }
  if (inputContract?.required_reporting_summary_acknowledgement_summary_command !== reportingSummaryAck.summary_command
    || inputContract?.required_reporting_summary_acknowledgement_summary_must_be_generated_from_current_packet !== true
    || inputContract?.required_reporting_summary_acknowledgement_current_gate_checklist_required !== true
    || inputContract?.required_reporting_summary_acknowledgement_current_gate_checklist_schema_version !== reportingSummaryAck.current_gate_checklist_schema_version
    || inputContract?.required_reporting_summary_acknowledgement_current_gate_checklist_must_match_current_next_required_gate !== true
    || JSON.stringify(inputContract?.required_reporting_summary_acknowledgement_current_gate_checklist_required_checks) !== JSON.stringify(reportingSummaryAck.current_gate_checklist_required_checks ?? [])) {
    errors.push("reporting summary owner decision input contract reporting-summary acknowledgement checklist mismatch");
  }
  if (inputContract?.required_reporting_summary_acknowledgement_acknowledged_gate !== reportingSummaryAck.acknowledged_gate
    || inputContract?.required_reporting_summary_acknowledgement_acknowledged_record_schema !== reportingSummaryAck.acknowledged_record_schema) {
    errors.push("reporting summary owner decision input contract reporting-summary acknowledgement identity mismatch");
  }
  const safeSliceAck = packet.owner_decision_acceptance_contract?.required_safe_enforcement_slice_acknowledgement ?? {};
  if (JSON.stringify(inputContract?.required_safe_enforcement_slice_acknowledgement_fields) !== JSON.stringify(ownerDecisionSafeEnforcementSliceAcknowledgementRequiredFields())) {
    errors.push("reporting summary owner decision input contract must expose safe-slice acknowledgement required fields");
  }
  if (!inputContract?.required_safe_enforcement_slice_acknowledgement_fields?.includes("slice_blocked_actions")
    || !inputContract?.required_safe_enforcement_slice_acknowledgement_fields?.includes("all_slices_carry_blocked_actions")
    || !inputContract?.required_safe_enforcement_slice_acknowledgement_fields?.includes("slice_evidence_detail_surfaces")
    || !inputContract?.required_safe_enforcement_slice_acknowledgement_fields?.includes("all_required_evidence_detail_surfaces_acknowledged")) {
    errors.push("reporting summary owner decision input contract must require safe-slice blocked-action and evidence-detail acknowledgement fields");
  }
  if (inputContract?.required_safe_enforcement_slice_acknowledgement_slice_count !== safeSliceAck.slice_count
    || JSON.stringify(inputContract?.required_safe_enforcement_slice_acknowledgement_slice_ids) !== JSON.stringify(safeSliceAck.slice_ids ?? [])
    || JSON.stringify(inputContract?.required_safe_enforcement_slice_acknowledgement_blocked_action_map_keys) !== JSON.stringify(safeSliceAck.slice_ids ?? [])) {
    errors.push("reporting summary owner decision input contract safe-slice acknowledgement identity mismatch");
  }
  if (inputContract?.required_safe_enforcement_slice_acknowledgement_blocked_action_map_required !== true
    || inputContract?.required_safe_enforcement_slice_acknowledgement_all_slices_carry_blocked_actions !== true) {
    errors.push("reporting summary owner decision input contract must require per-slice blocked-action acknowledgement");
  }
  if (inputContract?.required_safe_enforcement_slice_acknowledgement_evidence_detail_surface_map_required !== true
    || JSON.stringify(inputContract?.required_safe_enforcement_slice_acknowledgement_evidence_detail_surface_map_keys) !== JSON.stringify(Object.keys(safeSliceAck.slice_evidence_detail_surfaces ?? {}))
    || JSON.stringify(inputContract?.required_safe_enforcement_slice_acknowledgement_evidence_detail_surfaces) !== JSON.stringify(safeSliceAck.slice_evidence_detail_surfaces ?? {})
    || inputContract?.required_safe_enforcement_slice_acknowledgement_all_required_evidence_detail_surfaces_acknowledged !== true
    || safeSliceAck.all_required_evidence_detail_surfaces_acknowledged !== true) {
    errors.push("reporting summary owner decision input contract must require per-slice evidence-detail acknowledgement");
  }
  if (inputContract?.selected_followup_options?.preserve?.id !== "preserve_decision_documentation_packet"
    || inputContract?.selected_followup_options?.remap?.id !== "remap_dry_run_proposal_packet"
    || inputContract?.selected_followup_options?.retire?.id !== "retire_readiness_packet") {
    errors.push("reporting summary owner decision input contract must expose preserve/remap/retire follow-up options");
  }
  for (const action of ownerDecisionBlockedActions()) {
    if (!summary.blocked_actions?.includes(action)) {
      errors.push(`reporting summary must keep ${action} blocked`);
    }
  }
  return errors;
}

function rank2OwnerReviewTemplate(packet) {
  const preview = packet.inactive_next_candidate_preview;
  const readiness = packet.rank2_review_readiness;
  const candidate = preview?.candidate ?? {};
  const blockedActions = routePatchBlockedActions();
  const ownerRoute = candidate.owner_route ?? null;
  const compatibilityRoute = candidate.compatibility_route ?? null;
  const legacySamplePaths = preview?.live_equivalence_prep?.rows
    ?.filter((row) => row.role === "legacy_sample")
    .map((row) => row.path) ?? [];
  const routeIdentity = [ownerRoute, compatibilityRoute].filter(Boolean).join(" and ") || "the corrected owner route";
  const legacyIdentity = legacySamplePaths.join(", ") || "the legacy sample path";
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
    blocked_actions: blockedActions,
    owner_route: ownerRoute,
    compatibility_route: compatibilityRoute,
    legacy_sample_paths: legacySamplePaths,
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
      readiness_status: readiness?.status ?? null,
      review_packet_status: readiness?.ready_for_rank2_owner_review ? "available_no_mutation" : "blocked_until_rank2_review_readiness",
      rank2_active: false,
      mutation: "none",
      mutation_approved: false,
      separate_mutation_approval_required: true,
      owner_route: ownerRoute,
      compatibility_route: compatibilityRoute,
      legacy_sample_paths: legacySamplePaths,
      pro_screen_model_acceptance: {
        ready: candidate.pro_screen_model_acceptance_ready ?? false,
        home_primary_allowed: candidate.home_primary_allowed ?? null,
        mobile_primary_allowed: candidate.mobile_primary_allowed ?? null,
      },
      blocked_actions: blockedActions,
      notes: "Rank-2 owner-review decision only; route patch, public mutation, rank-2 release, redirect/delete, and deploy require separate explicit approval.",
    },
    decision_options: [
      {
        decision: "preserve",
        meaning: `keep ${legacyIdentity} behind ${routeIdentity}; no route patch, public mutation, rank-2 release, redirect/delete, or deploy`,
        mutation_allowed: false,
        blocked_actions: blockedActions,
      },
      {
        decision: "remap",
        meaning: `prepare a dry-run proposal toward ${ownerRoute ?? "the corrected owner route"} without editing routes or public assets`,
        mutation_allowed: false,
        blocked_actions: blockedActions,
      },
      {
        decision: "retire",
        meaning: "prepare retire readiness only after owner-approved equivalence proof, soak, rollback, and separate mutation approval",
        mutation_allowed: false,
        blocked_actions: blockedActions,
      },
    ],
    next_allowed_action: readiness?.ready_for_rank2_owner_review
      ? "ask owner to choose preserve, remap, or retire for rank-2 review only"
      : "supply all readiness records before printing the rank-2 owner-review template",
  };
}

function validateRank2OwnerDecisionRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (!packet.rank2_review_readiness?.ready_for_rank2_owner_review) {
    return ["rank2 owner decision record requires rank2_review_readiness=ready_for_rank2_owner_review_no_mutation"];
  }
  if (!template) return ["rank2 owner decision record template is missing"];
  const allowedDecisions = new Set(["preserve", "remap", "retire"]);
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 owner decision record schema_version mismatch: ${record.schema_version}`);
  }
  if (record.candidate_family_id !== template.candidate_family_id) {
    errors.push(`rank2 owner decision record candidate mismatch: ${record.candidate_family_id}`);
  }
  if (!allowedDecisions.has(record.decision)) {
    errors.push(`rank2 owner decision record decision must be preserve, remap, or retire: ${record.decision}`);
  }
  if (typeof record.owner_approved_by !== "string" || record.owner_approved_by.trim().length === 0) {
    errors.push("rank2 owner decision record owner_approved_by is required");
  }
  if (!isIso8601Timestamp(record.decided_at)) {
    errors.push(`rank2 owner decision record decided_at must be a full ISO-8601 timestamp with timezone: ${record.decided_at}`);
  }
  if (record.readiness_status !== "ready_for_rank2_owner_review_no_mutation") {
    errors.push(`rank2 owner decision record readiness_status mismatch: ${record.readiness_status}`);
  }
  if (record.review_packet_status !== "available_no_mutation") {
    errors.push(`rank2 owner decision record review_packet_status mismatch: ${record.review_packet_status}`);
  }
  if (record.rank2_active !== false || record.mutation !== "none" || record.mutation_approved !== false) {
    errors.push("rank2 owner decision record must keep rank2 inactive and no-mutation");
  }
  if (record.separate_mutation_approval_required !== true) {
    errors.push("rank2 owner decision record must require separate mutation approval");
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 owner decision record route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 owner decision record legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 owner decision record PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 owner decision record blocked actions mismatch");
  }
  return errors;
}

function rank2OwnerFollowupPlans(packet) {
  const template = packet.rank2_owner_review_template?.decision_record_template ?? {};
  const routeIdentity = [template.owner_route, template.compatibility_route].filter(Boolean).join(" and ") || "the corrected owner route";
  const legacyIdentity = template.legacy_sample_paths?.join(", ") || "the legacy sample path";
  const common = {
    candidate_family_id: template.candidate_family_id ?? null,
    mutation: "none",
    mutation_allowed: false,
    owner_record_required: true,
    rank2_owner_decision_record_required: true,
    separate_mutation_approval_required: true,
    owner_route: template.owner_route ?? null,
    compatibility_route: template.compatibility_route ?? null,
    legacy_sample_paths: template.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: template.pro_screen_model_acceptance ?? null,
    blocked_actions: template.blocked_actions ?? ["delete", "redirect", "deploy"],
  };
  return [
    {
      ...common,
      id: "rank2_preserve_decision_documentation_packet",
      gate: "after_valid_rank2_preserve_record_before_any_route_mutation",
      decision: "preserve",
      allowed_next_action: `document the owner-approved preserve decision and keep ${legacyIdentity} behind ${routeIdentity}`,
      required_evidence: [
        "rank-2 owner decision record remains valid_no_mutation_owner_review_recorded",
        `route identity remains unchanged: ${routeIdentity}`,
        `legacy sample remains smoke-available before any mutation request: ${legacyIdentity}`,
      ],
    },
    {
      ...common,
      id: "rank2_remap_dry_run_proposal_packet",
      gate: "after_valid_rank2_remap_record_before_any_href_or_route_edit",
      decision: "remap",
      allowed_next_action: `prepare a dry-run remap proposal toward ${template.owner_route ?? "the corrected owner route"} without editing routes or public assets`,
      required_evidence: [
        "rank-2 owner decision record remains valid_no_mutation_owner_review_recorded",
        `proposed destination remains ${template.owner_route ?? "the corrected owner route"}`,
        "rollback and route smoke commands are listed before any href, redirect, or route edit",
      ],
    },
    {
      ...common,
      id: "rank2_retire_readiness_packet",
      gate: "after_valid_rank2_retire_record_before_any_delete_redirect_or_deploy",
      decision: "retire",
      allowed_next_action: "prepare retire readiness, soak, rollback, and post-change smoke evidence without deleting, redirecting, or deploying",
      required_evidence: [
        "rank-2 owner decision record remains valid_no_mutation_owner_review_recorded",
        `local live-equivalence remains green for ${routeIdentity} and ${legacyIdentity}`,
        "separate mutation approval, soak, rollback, and deployment smoke remain explicit future gates",
      ],
    },
  ];
}

function rank2OwnerFollowupRecordTemplate(plan) {
  return {
    schema_version: "rank2-owner-followup-record/v0.1",
    candidate_family_id: plan.candidate_family_id,
    decision: plan.decision,
    followup_id: plan.id,
    recorded_at: "<ISO-8601 timestamp>",
    owner_decision_record_status: "valid_no_mutation_owner_review_recorded",
    evidence_status: "recorded_no_mutation",
    required_evidence: plan.required_evidence,
    mutation_approved: false,
    separate_mutation_approval_required: true,
    route_mutation_requested: false,
    deploy_requested: false,
    owner_route: plan.owner_route,
    compatibility_route: plan.compatibility_route,
    legacy_sample_paths: plan.legacy_sample_paths,
    pro_screen_model_acceptance: plan.pro_screen_model_acceptance,
    blocked_actions: plan.blocked_actions,
    notes: "Rank-2 follow-up record only; route mutation, redirect, delete, and deploy require separate explicit approval.",
  };
}

function selectedRank2OwnerFollowup(packet) {
  const record = packet.supplied_rank2_owner_decision_record;
  if (!record || packet.rank2_owner_decision_record_status !== "valid_no_mutation_owner_review_recorded") return null;
  const plan = packet.rank2_owner_followup_plans.find((candidate) => candidate.decision === record.decision);
  if (!plan) return null;
  return {
    ...plan,
    selected_by_rank2_owner_decision_record: true,
    owner_approved_by: record.owner_approved_by,
    decided_at: record.decided_at,
    mutation_status: "not_executed",
    route_mutation_status: "blocked_until_separate_approval",
  };
}

function validateRank2OwnerFollowupRecord(record, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_owner_decision_record_status !== "valid_no_mutation_owner_review_recorded" || !packet.selected_rank2_owner_followup) {
    return ["rank2 owner followup record requires a valid rank2 owner decision record first"];
  }
  const template = packet.rank2_owner_followup_record_templates.find((item) => item.followup_id === packet.selected_rank2_owner_followup.id);
  if (!template) return [`rank2 owner followup record template missing for ${packet.selected_rank2_owner_followup.id}`];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 owner followup record schema_version mismatch: ${record.schema_version}`);
  }
  if (record.candidate_family_id !== template.candidate_family_id || record.decision !== template.decision || record.followup_id !== template.followup_id) {
    errors.push("rank2 owner followup record identity mismatch");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 owner followup record recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.owner_decision_record_status !== "valid_no_mutation_owner_review_recorded") {
    errors.push(`rank2 owner followup record owner_decision_record_status mismatch: ${record.owner_decision_record_status}`);
  }
  if (record.evidence_status !== "recorded_no_mutation") {
    errors.push(`rank2 owner followup record evidence_status mismatch: ${record.evidence_status}`);
  }
  if (JSON.stringify(record.required_evidence) !== JSON.stringify(template.required_evidence)) {
    errors.push("rank2 owner followup record required_evidence mismatch");
  }
  if (record.mutation_approved !== false || record.separate_mutation_approval_required !== true) {
    errors.push("rank2 owner followup record must stay no-mutation with separate mutation approval required");
  }
  if (record.route_mutation_requested !== false || record.deploy_requested !== false) {
    errors.push("rank2 owner followup record must not request route mutation or deploy");
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 owner followup record route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 owner followup record legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 owner followup record PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 owner followup record blocked actions mismatch");
  }
  return errors;
}

function rank2MutationApprovalReadiness(packet) {
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
    {
      id: "rank2_owner_decision_record",
      status: packet.rank2_owner_decision_record_status,
      required_status: "valid_no_mutation_owner_review_recorded",
    },
    {
      id: "rank2_owner_followup_record",
      status: packet.rank2_owner_followup_record_status,
      required_status: "valid_no_mutation_owner_followup_recorded",
    },
  ];
  const missingRecords = requiredRecords.filter((record) => record.status !== record.required_status);
  const ready = missingRecords.length === 0;
  return {
    schema_version: "rank2-mutation-approval-readiness/v0.1",
    candidate_family_id: packet.next_queue_candidate_after_owner_decision?.family_id ?? null,
    status: ready ? "ready_for_separate_owner_mutation_approval_request_no_execution" : "blocked_pending_records",
    ready_for_mutation_approval_request: ready,
    rank2_active: false,
    mutation: "none",
    mutation_allowed: false,
    execution_allowed: false,
    separate_mutation_approval_required: true,
    blocked_actions: routePatchBlockedActions(),
    required_records: requiredRecords,
    missing_records: missingRecords.map((record) => record.id),
    next_allowed_action: ready
      ? "print a request-only mutation approval packet; keep execution blocked"
      : "supply the missing valid no-mutation records before mutation approval request prep",
  };
}

function rank2MutationApprovalRequestTemplate(packet) {
  const readiness = packet.rank2_mutation_approval_readiness;
  const followup = packet.selected_rank2_owner_followup ?? {};
  const requestedActionByDecision = {
    preserve: "preserve_no_route_mutation",
    remap: "request_remap_approval",
    retire: "request_retire_approval",
  };
  return {
    schema_version: "rank2-mutation-approval-request/v0.1",
    issue: packet.issue,
    status: readiness?.ready_for_mutation_approval_request ? "available_request_only_no_execution" : "blocked_until_rank2_followup",
    approval_status: "pending_owner_approval",
    request_only: true,
    mutation_allowed: false,
    execution_allowed: false,
    candidate_family_id: followup.candidate_family_id ?? null,
    decision: followup.decision ?? null,
    followup_id: followup.id ?? null,
    requested_action: requestedActionByDecision[followup.decision] ?? null,
    owner_route: followup.owner_route ?? null,
    compatibility_route: followup.compatibility_route ?? null,
    legacy_sample_paths: followup.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: followup.pro_screen_model_acceptance ?? null,
    blocked_actions: routePatchBlockedActions(),
    required_before_execution: [
      "separate owner mutation approval record",
      "route/file diff proposal",
      "rollback plan",
      "local route smoke after patch",
      "production deploy/live smoke only after explicit deploy approval",
    ],
    notes: "Request packet only; it does not approve or execute route patch, redirect/delete, deploy, public mutation, or rank-2 release.",
  };
}

function rank2MutationApprovalRecordTemplate(packet) {
  const request = packet.rank2_mutation_approval_request_template ?? {};
  return {
    schema_version: "rank2-mutation-approval-record/v0.1",
    candidate_family_id: request.candidate_family_id ?? null,
    decision: request.decision ?? null,
    followup_id: request.followup_id ?? null,
    requested_action: request.requested_action ?? null,
    approval_status: "owner_approved",
    owner_approved_by: "<owner>",
    approved_at: "<ISO-8601 timestamp>",
    mutation_approved: true,
    approval_scope: "record_only_no_execution",
    execution_allowed: false,
    deploy_approved: false,
    route_patch_applied: false,
    separate_execution_approval_required: true,
    owner_route: request.owner_route ?? null,
    compatibility_route: request.compatibility_route ?? null,
    legacy_sample_paths: request.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: request.pro_screen_model_acceptance ?? null,
    blocked_actions: request.blocked_actions ?? routePatchBlockedActions(),
    required_before_execution: request.required_before_execution ?? [],
    route_diff_proposal_status: "required_not_supplied",
    rollback_plan_status: "required_not_supplied",
    local_post_patch_smoke_status: "not_run",
    production_live_smoke_status: "not_approved",
    notes: "Owner approval record only; route patch, redirect, delete, deploy, public mutation, rank-2 release, and production smoke still require separate execution approval.",
  };
}

function validateRank2MutationApprovalRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (!packet.rank2_mutation_approval_readiness?.ready_for_mutation_approval_request) {
    return ["rank2 mutation approval record requires rank2 mutation approval request readiness first"];
  }
  if (!template) return ["rank2 mutation approval record template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 mutation approval record schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 mutation approval record identity mismatch");
  }
  if (record.approval_status !== "owner_approved") {
    errors.push(`rank2 mutation approval record approval_status mismatch: ${record.approval_status}`);
  }
  if (typeof record.owner_approved_by !== "string" || record.owner_approved_by.trim().length === 0) {
    errors.push("rank2 mutation approval record owner_approved_by is required");
  }
  if (!isIso8601Timestamp(record.approved_at)) {
    errors.push(`rank2 mutation approval record approved_at must be a full ISO-8601 timestamp with timezone: ${record.approved_at}`);
  }
  if (record.mutation_approved !== true || record.approval_scope !== "record_only_no_execution") {
    errors.push("rank2 mutation approval record must be an owner approval record only");
  }
  if (
    record.execution_allowed !== false
    || record.deploy_approved !== false
    || record.route_patch_applied !== false
    || record.separate_execution_approval_required !== true
  ) {
    errors.push("rank2 mutation approval record must not allow execution, deploy, or route patch");
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 mutation approval record route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 mutation approval record legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 mutation approval record PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 mutation approval record blocked actions mismatch");
  }
  if (JSON.stringify(record.required_before_execution) !== JSON.stringify(template.required_before_execution)) {
    errors.push("rank2 mutation approval record required-before-execution mismatch");
  }
  if (
    record.route_diff_proposal_status !== "required_not_supplied"
    || record.rollback_plan_status !== "required_not_supplied"
    || record.local_post_patch_smoke_status !== "not_run"
    || record.production_live_smoke_status !== "not_approved"
  ) {
    errors.push("rank2 mutation approval record must keep execution prerequisites unsatisfied");
  }
  return errors;
}

function rank2RouteDiffProposedChanges(approval) {
  if (approval.requested_action === "request_remap_approval") {
    return [
      {
        change_type: "dry_run_route_alignment",
        from_route: approval.compatibility_route ?? null,
        to_route: approval.owner_route ?? null,
        patch_applied: false,
        public_files_modified: false,
        redirect_config_changed: false,
        execution_allowed: false,
        deploy_approved: false,
        notes: "Draft remap proposal only; no href, route, redirect, public file, or deploy mutation has been applied.",
      },
    ];
  }
  if (approval.requested_action === "request_retire_approval") {
    return [
      {
        change_type: "retire_readiness_only",
        owner_route: approval.owner_route ?? null,
        compatibility_route: approval.compatibility_route ?? null,
        legacy_sample_paths: approval.legacy_sample_paths ?? [],
        delete_paths: [],
        patch_applied: false,
        public_files_modified: false,
        redirect_config_changed: false,
        execution_allowed: false,
        deploy_approved: false,
        notes: "Draft retire-readiness proposal only; no delete, redirect, route, public file, or deploy mutation has been applied.",
      },
    ];
  }
  return [];
}

function rank2RouteDiffProposalTemplate(packet) {
  const approval = packet.supplied_rank2_mutation_approval_record ?? packet.rank2_mutation_approval_record_template ?? {};
  return {
    schema_version: "rank2-route-diff-proposal-record/v0.1",
    candidate_family_id: approval.candidate_family_id ?? null,
    decision: approval.decision ?? null,
    followup_id: approval.followup_id ?? null,
    requested_action: approval.requested_action ?? null,
    approval_record_status: packet.rank2_mutation_approval_record_status,
    proposal_status: "draft_no_mutation",
    owner_route: approval.owner_route ?? null,
    compatibility_route: approval.compatibility_route ?? null,
    legacy_sample_paths: approval.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: approval.pro_screen_model_acceptance ?? null,
    proposed_changes: rank2RouteDiffProposedChanges(approval),
    patch_applied: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    execution_allowed: false,
    deploy_approved: false,
    blocked_actions: approval.blocked_actions ?? routePatchBlockedActions(),
    rollback_plan_required: true,
    local_post_patch_smoke_required: true,
    production_deploy_approval_required: true,
    notes: "Route/file diff proposal record only; no route patch, public file edit, redirect, delete, deploy, or production smoke has been applied.",
  };
}

function validateRank2RouteDiffProposalRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_mutation_approval_record_status !== "valid_owner_approved_no_execution") {
    return ["rank2 route diff proposal requires a valid owner mutation approval record first"];
  }
  if (!template) return ["rank2 route diff proposal template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 route diff proposal schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 route diff proposal identity mismatch");
  }
  if (record.approval_record_status !== "valid_owner_approved_no_execution") {
    errors.push(`rank2 route diff proposal approval_record_status mismatch: ${record.approval_record_status}`);
  }
  if (record.proposal_status !== "draft_no_mutation") {
    errors.push(`rank2 route diff proposal proposal_status mismatch: ${record.proposal_status}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 route diff proposal route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 route diff proposal legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 route diff proposal PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 route diff proposal proposed changes mismatch");
  }
  if (
    record.patch_applied !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
    || record.execution_allowed !== false
    || record.deploy_approved !== false
  ) {
    errors.push("rank2 route diff proposal must not apply route/file mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 route diff proposal delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 route diff proposal blocked actions mismatch");
  }
  if (
    record.rollback_plan_required !== true
    || record.local_post_patch_smoke_required !== true
    || record.production_deploy_approval_required !== true
  ) {
    errors.push("rank2 route diff proposal must keep rollback, local smoke, and deploy approval required");
  }
  return errors;
}

function rank2RollbackSteps(proposal) {
  if (proposal.requested_action === "request_remap_approval") {
    return [
      {
        step: "restore_route_alignment_patch",
        trigger: "post-patch smoke or owner review rejects the remap",
        action: "revert the route/link diff that moved compatibility traffic toward the owner route",
        verification: "rerun local route smoke for owner_route, compatibility_route, and legacy_sample_paths",
        patch_applied: false,
        rollback_applied: false,
      },
    ];
  }
  if (proposal.requested_action === "request_retire_approval") {
    return [
      {
        step: "restore_legacy_assets_and_redirects",
        trigger: "post-patch smoke, soak, or owner review rejects retire readiness",
        action: "restore deleted legacy assets and remove any retire redirect configuration",
        verification: "rerun local route smoke for owner_route, compatibility_route, and legacy_sample_paths",
        patch_applied: false,
        rollback_applied: false,
      },
    ];
  }
  return [
    {
      step: "preserve_noop_guard",
      trigger: "unexpected route/public mutation is detected",
      action: "confirm no route, public asset, redirect, delete, or deploy mutation was applied",
      verification: "rerun local route smoke if any future mutation packet is approved",
      patch_applied: false,
      rollback_applied: false,
    },
  ];
}

function rank2RollbackPlanTemplate(packet) {
  const proposal = packet.supplied_rank2_route_diff_proposal_record ?? packet.rank2_route_diff_proposal_template ?? {};
  return {
    schema_version: "rank2-rollback-plan-record/v0.1",
    candidate_family_id: proposal.candidate_family_id ?? null,
    decision: proposal.decision ?? null,
    followup_id: proposal.followup_id ?? null,
    requested_action: proposal.requested_action ?? null,
    route_diff_proposal_record_status: packet.rank2_route_diff_proposal_record_status,
    rollback_plan_status: "recorded_no_mutation",
    recorded_at: "<ISO-8601 timestamp>",
    rollback_scope: "plan_only_no_execution",
    owner_route: proposal.owner_route ?? null,
    compatibility_route: proposal.compatibility_route ?? null,
    legacy_sample_paths: proposal.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: proposal.pro_screen_model_acceptance ?? null,
    proposed_changes: proposal.proposed_changes ?? [],
    rollback_steps: rank2RollbackSteps(proposal),
    patch_applied: false,
    rollback_applied: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    execution_allowed: false,
    deploy_approved: false,
    blocked_actions: proposal.blocked_actions ?? routePatchBlockedActions(),
    local_post_patch_smoke_required: true,
    production_deploy_approval_required: true,
    notes: "Rollback plan record only; no rollback, route patch, public file edit, redirect, delete, deploy, or production smoke has been applied.",
  };
}

function validateRank2RollbackPlanRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_route_diff_proposal_record_status !== "valid_no_mutation_route_diff_proposal_recorded") {
    return ["rank2 rollback plan requires a valid no-mutation route diff proposal first"];
  }
  if (!template) return ["rank2 rollback plan template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 rollback plan schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 rollback plan identity mismatch");
  }
  if (record.route_diff_proposal_record_status !== "valid_no_mutation_route_diff_proposal_recorded") {
    errors.push(`rank2 rollback plan route_diff_proposal_record_status mismatch: ${record.route_diff_proposal_record_status}`);
  }
  if (record.rollback_plan_status !== "recorded_no_mutation") {
    errors.push(`rank2 rollback plan rollback_plan_status mismatch: ${record.rollback_plan_status}`);
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 rollback plan recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.rollback_scope !== "plan_only_no_execution") {
    errors.push(`rank2 rollback plan rollback_scope mismatch: ${record.rollback_scope}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 rollback plan route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 rollback plan legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 rollback plan PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 rollback plan proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 rollback plan rollback steps mismatch");
  }
  if (
    record.patch_applied !== false
    || record.rollback_applied !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
    || record.execution_allowed !== false
    || record.deploy_approved !== false
  ) {
    errors.push("rank2 rollback plan must not apply rollback or route/file mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 rollback plan delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 rollback plan blocked actions mismatch");
  }
  if (
    record.local_post_patch_smoke_required !== true
    || record.production_deploy_approval_required !== true
  ) {
    errors.push("rank2 rollback plan must keep local smoke and deploy approval required");
  }
  return errors;
}

function rank2LocalPostPatchSmokeRows(rollbackPlan) {
  const rows = [];
  if (rollbackPlan.owner_route) {
    rows.push({
      role: "owner_route",
      path: rollbackPlan.owner_route,
      expected_http_status: 200,
      command: `curl -L -sS -o /dev/null -w 'status=%{http_code}\\n' http://127.0.0.1:3105${rollbackPlan.owner_route}`,
      smoke_executed: false,
      actual_http_status: null,
      ok: null,
    });
  }
  if (rollbackPlan.compatibility_route) {
    rows.push({
      role: "compatibility_route",
      path: rollbackPlan.compatibility_route,
      expected_http_status: 200,
      command: `curl -L -sS -o /dev/null -w 'status=%{http_code}\\n' http://127.0.0.1:3105${rollbackPlan.compatibility_route}`,
      smoke_executed: false,
      actual_http_status: null,
      ok: null,
    });
  }
  for (const legacyPath of rollbackPlan.legacy_sample_paths ?? []) {
    rows.push({
      role: "legacy_sample",
      path: legacyPath,
      expected_http_status: 200,
      command: `curl -L -sS -o /dev/null -w 'status=%{http_code}\\n' http://127.0.0.1:3105${legacyPath}`,
      smoke_executed: false,
      actual_http_status: null,
      ok: null,
    });
  }
  return rows;
}

function rank2LocalPostPatchSmokePlanTemplate(packet) {
  const rollbackPlan = packet.supplied_rank2_rollback_plan_record ?? packet.rank2_rollback_plan_template ?? {};
  return {
    schema_version: "rank2-local-post-patch-smoke-plan-record/v0.1",
    candidate_family_id: rollbackPlan.candidate_family_id ?? null,
    decision: rollbackPlan.decision ?? null,
    followup_id: rollbackPlan.followup_id ?? null,
    requested_action: rollbackPlan.requested_action ?? null,
    rollback_plan_record_status: packet.rank2_rollback_plan_record_status,
    smoke_plan_status: "planned_before_execution_no_runtime",
    recorded_at: "<ISO-8601 timestamp>",
    smoke_scope: "plan_only_no_runtime",
    local_live_equivalence_base_url: "http://127.0.0.1:3105",
    owner_route: rollbackPlan.owner_route ?? null,
    compatibility_route: rollbackPlan.compatibility_route ?? null,
    legacy_sample_paths: rollbackPlan.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: rollbackPlan.pro_screen_model_acceptance ?? null,
    proposed_changes: rollbackPlan.proposed_changes ?? [],
    rollback_steps: rollbackPlan.rollback_steps ?? [],
    rows: rank2LocalPostPatchSmokeRows(rollbackPlan),
    patch_applied: false,
    rollback_applied: false,
    smoke_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    execution_allowed: false,
    deploy_approved: false,
    blocked_actions: rollbackPlan.blocked_actions ?? routePatchBlockedActions(),
    production_deploy_approval_required: true,
    notes: "Local post-patch smoke plan only; no patch, rollback, runtime smoke, redirect, delete, deploy, or production smoke has been applied.",
  };
}

function validateRank2LocalPostPatchSmokePlanRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_rollback_plan_record_status !== "valid_no_mutation_rollback_plan_recorded") {
    return ["rank2 local post-patch smoke plan requires a valid no-mutation rollback plan first"];
  }
  if (!template) return ["rank2 local post-patch smoke plan template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 local post-patch smoke plan schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 local post-patch smoke plan identity mismatch");
  }
  if (record.rollback_plan_record_status !== "valid_no_mutation_rollback_plan_recorded") {
    errors.push(`rank2 local post-patch smoke plan rollback_plan_record_status mismatch: ${record.rollback_plan_record_status}`);
  }
  if (record.smoke_plan_status !== "planned_before_execution_no_runtime") {
    errors.push(`rank2 local post-patch smoke plan smoke_plan_status mismatch: ${record.smoke_plan_status}`);
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 local post-patch smoke plan recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.smoke_scope !== "plan_only_no_runtime") {
    errors.push(`rank2 local post-patch smoke plan smoke_scope mismatch: ${record.smoke_scope}`);
  }
  if (record.local_live_equivalence_base_url !== template.local_live_equivalence_base_url) {
    errors.push("rank2 local post-patch smoke plan base URL mismatch");
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 local post-patch smoke plan route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 local post-patch smoke plan legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 local post-patch smoke plan PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 local post-patch smoke plan proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 local post-patch smoke plan rollback steps mismatch");
  }
  if (JSON.stringify(record.rows) !== JSON.stringify(template.rows)) {
    errors.push("rank2 local post-patch smoke plan rows mismatch");
  }
  if (
    record.patch_applied !== false
    || record.rollback_applied !== false
    || record.smoke_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
    || record.execution_allowed !== false
    || record.deploy_approved !== false
  ) {
    errors.push("rank2 local post-patch smoke plan must not run smoke or apply route/file mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 local post-patch smoke plan delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 local post-patch smoke plan blocked actions mismatch");
  }
  if (record.production_deploy_approval_required !== true) {
    errors.push("rank2 local post-patch smoke plan must keep production deploy approval required");
  }
  return errors;
}

function rank2ExplicitDeployApprovalTemplate(packet) {
  const smokePlan = packet.supplied_rank2_local_post_patch_smoke_plan_record ?? packet.rank2_local_post_patch_smoke_plan_template ?? {};
  return {
    schema_version: "rank2-explicit-deploy-approval-record/v0.1",
    candidate_family_id: smokePlan.candidate_family_id ?? null,
    decision: smokePlan.decision ?? null,
    followup_id: smokePlan.followup_id ?? null,
    requested_action: smokePlan.requested_action ?? null,
    local_post_patch_smoke_plan_record_status: packet.rank2_local_post_patch_smoke_plan_record_status,
    approval_status: "owner_approved",
    approval_scope: "record_only_no_deploy",
    owner_approved_by: "<owner>",
    approved_at: "<ISO-8601 timestamp>",
    owner_route: smokePlan.owner_route ?? null,
    compatibility_route: smokePlan.compatibility_route ?? null,
    legacy_sample_paths: smokePlan.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: smokePlan.pro_screen_model_acceptance ?? null,
    proposed_changes: smokePlan.proposed_changes ?? [],
    rollback_steps: smokePlan.rollback_steps ?? [],
    local_smoke_plan_rows: smokePlan.rows ?? [],
    deploy_approved: true,
    deploy_executed: false,
    production_live_smoke_executed: false,
    execution_allowed: false,
    route_patch_applied: false,
    rollback_applied: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: smokePlan.blocked_actions ?? routePatchBlockedActions(),
    next_required_execution_gate: "separate_route_execution_packet",
    notes: "Deploy approval record only; no deploy, production live smoke, route patch, redirect, delete, or public file mutation has been applied.",
  };
}

function validateRank2ExplicitDeployApprovalRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_local_post_patch_smoke_plan_record_status !== "valid_no_mutation_local_post_patch_smoke_plan_recorded") {
    return ["rank2 explicit deploy approval requires a valid local post-patch smoke plan first"];
  }
  if (!template) return ["rank2 explicit deploy approval template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 explicit deploy approval schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 explicit deploy approval identity mismatch");
  }
  if (record.local_post_patch_smoke_plan_record_status !== "valid_no_mutation_local_post_patch_smoke_plan_recorded") {
    errors.push(`rank2 explicit deploy approval local_post_patch_smoke_plan_record_status mismatch: ${record.local_post_patch_smoke_plan_record_status}`);
  }
  if (record.approval_status !== "owner_approved") {
    errors.push(`rank2 explicit deploy approval approval_status mismatch: ${record.approval_status}`);
  }
  if (record.approval_scope !== "record_only_no_deploy") {
    errors.push(`rank2 explicit deploy approval approval_scope mismatch: ${record.approval_scope}`);
  }
  if (typeof record.owner_approved_by !== "string" || record.owner_approved_by.trim().length === 0) {
    errors.push("rank2 explicit deploy approval owner_approved_by is required");
  }
  if (!isIso8601Timestamp(record.approved_at)) {
    errors.push(`rank2 explicit deploy approval approved_at must be a full ISO-8601 timestamp with timezone: ${record.approved_at}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 explicit deploy approval route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 explicit deploy approval legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 explicit deploy approval PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 explicit deploy approval proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 explicit deploy approval rollback steps mismatch");
  }
  if (JSON.stringify(record.local_smoke_plan_rows) !== JSON.stringify(template.local_smoke_plan_rows)) {
    errors.push("rank2 explicit deploy approval local smoke rows mismatch");
  }
  if (record.deploy_approved !== true) {
    errors.push("rank2 explicit deploy approval must record deploy_approved=true");
  }
  if (
    record.deploy_executed !== false
    || record.production_live_smoke_executed !== false
    || record.execution_allowed !== false
    || record.route_patch_applied !== false
    || record.rollback_applied !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 explicit deploy approval must not execute deploy, live smoke, or route/file mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 explicit deploy approval delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 explicit deploy approval blocked actions mismatch");
  }
  if (record.next_required_execution_gate !== "separate_route_execution_packet") {
    errors.push(`rank2 explicit deploy approval next_required_execution_gate mismatch: ${record.next_required_execution_gate}`);
  }
  return errors;
}

function rank2RouteExecutionPacketTemplate(packet) {
  const deployApproval = packet.supplied_rank2_explicit_deploy_approval_record ?? packet.rank2_explicit_deploy_approval_template ?? {};
  return {
    schema_version: "rank2-route-execution-packet-record/v0.1",
    candidate_family_id: deployApproval.candidate_family_id ?? null,
    decision: deployApproval.decision ?? null,
    followup_id: deployApproval.followup_id ?? null,
    requested_action: deployApproval.requested_action ?? null,
    execution_readiness_status: packet.rank2_execution_readiness?.status ?? null,
    route_diff_proposal_record_status: packet.rank2_route_diff_proposal_record_status,
    rollback_plan_record_status: packet.rank2_rollback_plan_record_status,
    local_post_patch_smoke_plan_record_status: packet.rank2_local_post_patch_smoke_plan_record_status,
    explicit_deploy_approval_record_status: packet.rank2_explicit_deploy_approval_record_status,
    execution_packet_status: "recorded_no_runtime",
    execution_scope: "record_only_no_runtime",
    recorded_by: "<owner>",
    recorded_at: "<ISO-8601 timestamp>",
    owner_runtime_release_status: "not_recorded",
    owner_route: deployApproval.owner_route ?? null,
    compatibility_route: deployApproval.compatibility_route ?? null,
    legacy_sample_paths: deployApproval.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: deployApproval.pro_screen_model_acceptance ?? null,
    proposed_changes: deployApproval.proposed_changes ?? [],
    rollback_steps: deployApproval.rollback_steps ?? [],
    local_smoke_plan_rows: deployApproval.local_smoke_plan_rows ?? [],
    execution_sequence: [
      "apply the route/file diff exactly as proposed only after owner runtime release",
      "run the recorded local post-patch smoke rows after the approved route patch",
      "deploy only after the approved local post-patch smoke passes",
      "run production live smoke only after deploy completes",
      "use the recorded rollback plan if any route/local/deploy/live gate fails",
    ],
    route_execution_packet_recorded: true,
    execution_allowed: false,
    route_patch_applied: false,
    post_patch_smoke_executed: false,
    deploy_executed: false,
    production_live_smoke_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: deployApproval.blocked_actions ?? ["delete", "redirect", "deploy"],
    next_required_runtime_gate: "owner_route_execution_runtime_release",
    notes: "Route execution packet record only; no route patch, post-patch smoke, deploy, production live smoke, redirect, delete, or public file mutation has been applied.",
  };
}

function validateRank2RouteExecutionPacketRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_execution_readiness?.status !== "all_prerequisites_recorded_no_runtime") {
    return ["rank2 route execution packet requires rank2_execution_readiness=all_prerequisites_recorded_no_runtime first"];
  }
  if (!template) return ["rank2 route execution packet template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 route execution packet schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 route execution packet identity mismatch");
  }
  if (record.execution_readiness_status !== "all_prerequisites_recorded_no_runtime") {
    errors.push(`rank2 route execution packet readiness status mismatch: ${record.execution_readiness_status}`);
  }
  if (record.route_diff_proposal_record_status !== "valid_no_mutation_route_diff_proposal_recorded") {
    errors.push(`rank2 route execution packet route diff status mismatch: ${record.route_diff_proposal_record_status}`);
  }
  if (record.rollback_plan_record_status !== "valid_no_mutation_rollback_plan_recorded") {
    errors.push(`rank2 route execution packet rollback status mismatch: ${record.rollback_plan_record_status}`);
  }
  if (record.local_post_patch_smoke_plan_record_status !== "valid_no_mutation_local_post_patch_smoke_plan_recorded") {
    errors.push(`rank2 route execution packet local smoke status mismatch: ${record.local_post_patch_smoke_plan_record_status}`);
  }
  if (record.explicit_deploy_approval_record_status !== "valid_explicit_deploy_approval_recorded_no_runtime") {
    errors.push(`rank2 route execution packet deploy approval status mismatch: ${record.explicit_deploy_approval_record_status}`);
  }
  if (record.execution_packet_status !== "recorded_no_runtime" || record.execution_scope !== "record_only_no_runtime") {
    errors.push("rank2 route execution packet must stay record-only/no-runtime");
  }
  if (record.owner_runtime_release_status !== "not_recorded") {
    errors.push(`rank2 route execution packet owner runtime release must stay not_recorded: ${record.owner_runtime_release_status}`);
  }
  if (typeof record.recorded_by !== "string" || record.recorded_by.trim().length === 0) {
    errors.push("rank2 route execution packet recorded_by is required");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 route execution packet recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 route execution packet route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 route execution packet legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 route execution packet PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 route execution packet proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 route execution packet rollback steps mismatch");
  }
  if (JSON.stringify(record.local_smoke_plan_rows) !== JSON.stringify(template.local_smoke_plan_rows)) {
    errors.push("rank2 route execution packet local smoke rows mismatch");
  }
  if (JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)) {
    errors.push("rank2 route execution packet execution sequence mismatch");
  }
  if (record.route_execution_packet_recorded !== true) {
    errors.push("rank2 route execution packet must record route_execution_packet_recorded=true");
  }
  if (
    record.execution_allowed !== false
    || record.route_patch_applied !== false
    || record.post_patch_smoke_executed !== false
    || record.deploy_executed !== false
    || record.production_live_smoke_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 route execution packet must not execute route patch, post-patch smoke, deploy, live smoke, or route/file mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 route execution packet delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 route execution packet blocked actions mismatch");
  }
  if (record.next_required_runtime_gate !== "owner_route_execution_runtime_release") {
    errors.push(`rank2 route execution packet next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2OwnerRuntimeReleaseTemplate(packet) {
  const routeExecutionPacket = packet.supplied_rank2_route_execution_packet_record ?? packet.rank2_route_execution_packet_template ?? {};
  return {
    schema_version: "rank2-owner-runtime-release-record/v0.1",
    candidate_family_id: routeExecutionPacket.candidate_family_id ?? null,
    decision: routeExecutionPacket.decision ?? null,
    followup_id: routeExecutionPacket.followup_id ?? null,
    requested_action: routeExecutionPacket.requested_action ?? null,
    route_execution_packet_record_status: packet.rank2_route_execution_packet_record_status,
    release_status: "owner_released",
    release_scope: "record_only_before_runtime",
    owner_released_by: "<owner>",
    released_at: "<ISO-8601 timestamp>",
    owner_route: routeExecutionPacket.owner_route ?? null,
    compatibility_route: routeExecutionPacket.compatibility_route ?? null,
    legacy_sample_paths: routeExecutionPacket.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: routeExecutionPacket.pro_screen_model_acceptance ?? null,
    proposed_changes: routeExecutionPacket.proposed_changes ?? [],
    rollback_steps: routeExecutionPacket.rollback_steps ?? [],
    local_smoke_plan_rows: routeExecutionPacket.local_smoke_plan_rows ?? [],
    execution_sequence: routeExecutionPacket.execution_sequence ?? [],
    runtime_release_recorded: true,
    execution_allowed: false,
    route_patch_applied: false,
    post_patch_smoke_executed: false,
    deploy_executed: false,
    production_live_smoke_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: routeExecutionPacket.blocked_actions ?? ["delete", "redirect", "deploy"],
    next_required_runtime_gate: "route_patch_application_record",
    notes: "Owner runtime release record only; no route patch, post-patch smoke, deploy, production live smoke, redirect, delete, or public file mutation has been applied.",
  };
}

function validateRank2OwnerRuntimeReleaseRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_route_execution_packet_record_status !== "valid_route_execution_packet_recorded_no_runtime") {
    return ["rank2 owner runtime release requires a valid route execution packet first"];
  }
  if (!template) return ["rank2 owner runtime release template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 owner runtime release schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 owner runtime release identity mismatch");
  }
  if (record.route_execution_packet_record_status !== "valid_route_execution_packet_recorded_no_runtime") {
    errors.push(`rank2 owner runtime release route execution packet status mismatch: ${record.route_execution_packet_record_status}`);
  }
  if (record.release_status !== "owner_released") {
    errors.push(`rank2 owner runtime release release_status mismatch: ${record.release_status}`);
  }
  if (record.release_scope !== "record_only_before_runtime") {
    errors.push(`rank2 owner runtime release release_scope mismatch: ${record.release_scope}`);
  }
  if (typeof record.owner_released_by !== "string" || record.owner_released_by.trim().length === 0) {
    errors.push("rank2 owner runtime release owner_released_by is required");
  }
  if (!isIso8601Timestamp(record.released_at)) {
    errors.push(`rank2 owner runtime release released_at must be a full ISO-8601 timestamp with timezone: ${record.released_at}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 owner runtime release route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 owner runtime release legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 owner runtime release PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 owner runtime release proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 owner runtime release rollback steps mismatch");
  }
  if (JSON.stringify(record.local_smoke_plan_rows) !== JSON.stringify(template.local_smoke_plan_rows)) {
    errors.push("rank2 owner runtime release local smoke rows mismatch");
  }
  if (JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)) {
    errors.push("rank2 owner runtime release execution sequence mismatch");
  }
  if (record.runtime_release_recorded !== true) {
    errors.push("rank2 owner runtime release must record runtime_release_recorded=true");
  }
  if (
    record.execution_allowed !== false
    || record.route_patch_applied !== false
    || record.post_patch_smoke_executed !== false
    || record.deploy_executed !== false
    || record.production_live_smoke_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 owner runtime release must not execute route patch, post-patch smoke, deploy, live smoke, or route/file mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 owner runtime release delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 owner runtime release blocked actions mismatch");
  }
  if (record.next_required_runtime_gate !== "route_patch_application_record") {
    errors.push(`rank2 owner runtime release next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2RoutePatchApplicationTemplate(packet) {
  const ownerRuntimeRelease = packet.supplied_rank2_owner_runtime_release_record ?? packet.rank2_owner_runtime_release_template ?? {};
  return {
    schema_version: "rank2-route-patch-application-record/v0.1",
    candidate_family_id: ownerRuntimeRelease.candidate_family_id ?? null,
    decision: ownerRuntimeRelease.decision ?? null,
    followup_id: ownerRuntimeRelease.followup_id ?? null,
    requested_action: ownerRuntimeRelease.requested_action ?? null,
    owner_runtime_release_record_status: packet.rank2_owner_runtime_release_record_status,
    patch_status: "recorded_local_patch_applied",
    patch_scope: "record_only_local_patch_no_smoke_no_deploy",
    applied_by: "<owner>",
    applied_at: "<ISO-8601 timestamp>",
    owner_route: ownerRuntimeRelease.owner_route ?? null,
    compatibility_route: ownerRuntimeRelease.compatibility_route ?? null,
    legacy_sample_paths: ownerRuntimeRelease.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: ownerRuntimeRelease.pro_screen_model_acceptance ?? null,
    proposed_changes: ownerRuntimeRelease.proposed_changes ?? [],
    rollback_steps: ownerRuntimeRelease.rollback_steps ?? [],
    local_smoke_plan_rows: ownerRuntimeRelease.local_smoke_plan_rows ?? [],
    execution_sequence: ownerRuntimeRelease.execution_sequence ?? [],
    owner_runtime_release_recorded: true,
    route_patch_application_recorded: true,
    route_patch_applied: true,
    post_patch_smoke_executed: false,
    deploy_executed: false,
    production_live_smoke_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: ownerRuntimeRelease.blocked_actions ?? ["delete", "redirect", "deploy"],
    local_post_patch_smoke_required: true,
    next_required_runtime_gate: "local_post_patch_smoke_record",
    notes: "Route patch application record only; no post-patch smoke, deploy, production live smoke, redirect, delete, or public file mutation has been applied by this packet.",
  };
}

function validateRank2RoutePatchApplicationRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_owner_runtime_release_record_status !== "valid_owner_runtime_release_recorded_no_execution") {
    return ["rank2 route patch application requires a valid owner runtime release record first"];
  }
  if (!template) return ["rank2 route patch application template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 route patch application schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 route patch application identity mismatch");
  }
  if (record.owner_runtime_release_record_status !== "valid_owner_runtime_release_recorded_no_execution") {
    errors.push(`rank2 route patch application owner runtime release status mismatch: ${record.owner_runtime_release_record_status}`);
  }
  if (record.patch_status !== "recorded_local_patch_applied") {
    errors.push(`rank2 route patch application patch_status mismatch: ${record.patch_status}`);
  }
  if (record.patch_scope !== "record_only_local_patch_no_smoke_no_deploy") {
    errors.push(`rank2 route patch application patch_scope mismatch: ${record.patch_scope}`);
  }
  if (typeof record.applied_by !== "string" || record.applied_by.trim().length === 0) {
    errors.push("rank2 route patch application applied_by is required");
  }
  if (!isIso8601Timestamp(record.applied_at)) {
    errors.push(`rank2 route patch application applied_at must be a full ISO-8601 timestamp with timezone: ${record.applied_at}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 route patch application route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 route patch application legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 route patch application PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 route patch application proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 route patch application rollback steps mismatch");
  }
  if (JSON.stringify(record.local_smoke_plan_rows) !== JSON.stringify(template.local_smoke_plan_rows)) {
    errors.push("rank2 route patch application local smoke rows mismatch");
  }
  if (JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)) {
    errors.push("rank2 route patch application execution sequence mismatch");
  }
  if (record.owner_runtime_release_recorded !== true || record.route_patch_application_recorded !== true) {
    errors.push("rank2 route patch application must record owner runtime release and route patch application");
  }
  if (record.route_patch_applied !== true) {
    errors.push("rank2 route patch application must record route_patch_applied=true");
  }
  if (
    record.post_patch_smoke_executed !== false
    || record.deploy_executed !== false
    || record.production_live_smoke_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 route patch application must not run post-patch smoke, deploy, live smoke, redirect, delete, or public file mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 route patch application delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 route patch application blocked actions mismatch");
  }
  if (record.local_post_patch_smoke_required !== true) {
    errors.push("rank2 route patch application must require local post-patch smoke next");
  }
  if (record.next_required_runtime_gate !== "local_post_patch_smoke_record") {
    errors.push(`rank2 route patch application next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2LocalPostPatchSmokeRecordRows(routePatchApplication) {
  return (routePatchApplication.local_smoke_plan_rows ?? []).map((row) => ({
    role: row.role,
    path: row.path,
    expected_http_status: row.expected_http_status,
    command: row.command,
    smoke_executed: true,
    actual_http_status: null,
    ok: null,
  }));
}

function rank2LocalPostPatchSmokeRecordTemplate(packet) {
  const routePatchApplication = packet.supplied_rank2_route_patch_application_record ?? packet.rank2_route_patch_application_template ?? {};
  return {
    schema_version: "rank2-local-post-patch-smoke-record/v0.1",
    candidate_family_id: routePatchApplication.candidate_family_id ?? null,
    decision: routePatchApplication.decision ?? null,
    followup_id: routePatchApplication.followup_id ?? null,
    requested_action: routePatchApplication.requested_action ?? null,
    route_patch_application_record_status: packet.rank2_route_patch_application_record_status,
    smoke_status: "recorded_local_post_patch_smoke",
    smoke_scope: "local_runtime_only_no_deploy",
    recorded_by: "<owner>",
    recorded_at: "<ISO-8601 timestamp>",
    local_live_equivalence_base_url: "http://127.0.0.1:3105",
    owner_route: routePatchApplication.owner_route ?? null,
    compatibility_route: routePatchApplication.compatibility_route ?? null,
    legacy_sample_paths: routePatchApplication.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: routePatchApplication.pro_screen_model_acceptance ?? null,
    proposed_changes: routePatchApplication.proposed_changes ?? [],
    rollback_steps: routePatchApplication.rollback_steps ?? [],
    rows: rank2LocalPostPatchSmokeRecordRows(routePatchApplication),
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: false,
    production_live_smoke_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: routePatchApplication.blocked_actions ?? ["delete", "redirect", "deploy"],
    deploy_execution_required: true,
    next_required_runtime_gate: "deploy_execution_record",
    notes: "Local post-patch smoke record only; no deploy, production live smoke, redirect, delete, or public file mutation has been applied by this packet.",
  };
}

function validateRank2LocalPostPatchSmokeRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_route_patch_application_record_status !== "valid_route_patch_application_recorded_no_smoke_no_deploy") {
    return ["rank2 local post-patch smoke record requires a valid route patch application record first"];
  }
  if (!template) return ["rank2 local post-patch smoke record template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 local post-patch smoke record schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 local post-patch smoke record identity mismatch");
  }
  if (record.route_patch_application_record_status !== "valid_route_patch_application_recorded_no_smoke_no_deploy") {
    errors.push(`rank2 local post-patch smoke record route patch application status mismatch: ${record.route_patch_application_record_status}`);
  }
  if (record.smoke_status !== "recorded_local_post_patch_smoke") {
    errors.push(`rank2 local post-patch smoke record smoke_status mismatch: ${record.smoke_status}`);
  }
  if (record.smoke_scope !== "local_runtime_only_no_deploy") {
    errors.push(`rank2 local post-patch smoke record smoke_scope mismatch: ${record.smoke_scope}`);
  }
  if (typeof record.recorded_by !== "string" || record.recorded_by.trim().length === 0) {
    errors.push("rank2 local post-patch smoke record recorded_by is required");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 local post-patch smoke record recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.local_live_equivalence_base_url !== template.local_live_equivalence_base_url) {
    errors.push("rank2 local post-patch smoke record base URL mismatch");
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 local post-patch smoke record route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 local post-patch smoke record legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 local post-patch smoke record PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 local post-patch smoke record proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 local post-patch smoke record rollback steps mismatch");
  }
  if (!Array.isArray(record.rows) || record.rows.length !== template.rows.length) {
    errors.push(`rank2 local post-patch smoke record row count mismatch: ${record.rows?.length}`);
    return errors;
  }
  for (let index = 0; index < template.rows.length; index += 1) {
    const expected = template.rows[index];
    const actual = record.rows[index];
    const label = `${expected.role} ${expected.path}`;
    if (actual.role !== expected.role || actual.path !== expected.path) {
      errors.push(`rank2 local post-patch smoke record row identity mismatch: ${label}`);
    }
    if (actual.expected_http_status !== expected.expected_http_status || actual.command !== expected.command) {
      errors.push(`rank2 local post-patch smoke record row command/status mismatch: ${label}`);
    }
    if (actual.smoke_executed !== true || actual.actual_http_status !== expected.expected_http_status || actual.ok !== true) {
      errors.push(`rank2 local post-patch smoke record row must pass local smoke: ${label}`);
    }
  }
  if (record.route_patch_applied !== true || record.post_patch_smoke_executed !== true) {
    errors.push("rank2 local post-patch smoke record must record route patch and local smoke as complete");
  }
  if (
    record.deploy_executed !== false
    || record.production_live_smoke_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 local post-patch smoke record must not deploy, run live smoke, redirect, delete, or mutate public files");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 local post-patch smoke record delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 local post-patch smoke record blocked actions mismatch");
  }
  if (record.deploy_execution_required !== true) {
    errors.push("rank2 local post-patch smoke record must require deploy execution next");
  }
  if (record.next_required_runtime_gate !== "deploy_execution_record") {
    errors.push(`rank2 local post-patch smoke record next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2DeployExecutionTemplate(packet) {
  const localPostPatchSmoke = packet.supplied_rank2_local_post_patch_smoke_record ?? packet.rank2_local_post_patch_smoke_record_template ?? {};
  return {
    schema_version: "rank2-deploy-execution-record/v0.1",
    candidate_family_id: localPostPatchSmoke.candidate_family_id ?? null,
    decision: localPostPatchSmoke.decision ?? null,
    followup_id: localPostPatchSmoke.followup_id ?? null,
    requested_action: localPostPatchSmoke.requested_action ?? null,
    local_post_patch_smoke_record_status: packet.rank2_local_post_patch_smoke_record_status,
    deploy_status: "recorded_deploy_executed",
    deploy_scope: "record_only_deploy_no_live_smoke",
    deployed_by: "<owner>",
    deployed_at: "<ISO-8601 timestamp>",
    deployment_target: "100xfenok-edge",
    owner_route: localPostPatchSmoke.owner_route ?? null,
    compatibility_route: localPostPatchSmoke.compatibility_route ?? null,
    legacy_sample_paths: localPostPatchSmoke.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: localPostPatchSmoke.pro_screen_model_acceptance ?? null,
    proposed_changes: localPostPatchSmoke.proposed_changes ?? [],
    rollback_steps: localPostPatchSmoke.rollback_steps ?? [],
    local_smoke_record_rows: localPostPatchSmoke.rows ?? [],
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: ["delete", "redirect", "production_live_smoke"],
    production_live_smoke_required: true,
    next_required_runtime_gate: "production_live_smoke_record",
    notes: "Deploy execution record only; no production live smoke, redirect, delete, or public file mutation has been applied by this packet.",
  };
}

function validateRank2DeployExecutionRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_local_post_patch_smoke_record_status !== "valid_local_post_patch_smoke_recorded_no_deploy") {
    return ["rank2 deploy execution requires a valid local post-patch smoke record first"];
  }
  if (!template) return ["rank2 deploy execution template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 deploy execution schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 deploy execution identity mismatch");
  }
  if (record.local_post_patch_smoke_record_status !== "valid_local_post_patch_smoke_recorded_no_deploy") {
    errors.push(`rank2 deploy execution local post-patch smoke status mismatch: ${record.local_post_patch_smoke_record_status}`);
  }
  if (record.deploy_status !== "recorded_deploy_executed") {
    errors.push(`rank2 deploy execution deploy_status mismatch: ${record.deploy_status}`);
  }
  if (record.deploy_scope !== "record_only_deploy_no_live_smoke") {
    errors.push(`rank2 deploy execution deploy_scope mismatch: ${record.deploy_scope}`);
  }
  if (typeof record.deployed_by !== "string" || record.deployed_by.trim().length === 0) {
    errors.push("rank2 deploy execution deployed_by is required");
  }
  if (!isIso8601Timestamp(record.deployed_at)) {
    errors.push(`rank2 deploy execution deployed_at must be a full ISO-8601 timestamp with timezone: ${record.deployed_at}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 deploy execution deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 deploy execution route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 deploy execution legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 deploy execution PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 deploy execution proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 deploy execution rollback steps mismatch");
  }
  if (JSON.stringify(record.local_smoke_record_rows) !== JSON.stringify(template.local_smoke_record_rows)) {
    errors.push("rank2 deploy execution local smoke record rows mismatch");
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
  ) {
    errors.push("rank2 deploy execution must record route patch, local smoke, and deploy as complete");
  }
  if (
    record.production_live_smoke_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 deploy execution must not run live smoke, redirect, delete, or mutate public files");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 deploy execution delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 deploy execution blocked actions mismatch");
  }
  if (record.production_live_smoke_required !== true) {
    errors.push("rank2 deploy execution must require production live smoke next");
  }
  if (record.next_required_runtime_gate !== "production_live_smoke_record") {
    errors.push(`rank2 deploy execution next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2ProductionLiveSmokeRows(deployExecution) {
  return (deployExecution.local_smoke_record_rows ?? []).map((row) => ({
    role: row.role,
    path: row.path,
    expected_http_status: row.expected_http_status,
    command: `curl -fsS -o /dev/null -w "%{http_code}" ${PRODUCTION_WORKER_BASE_URL}${row.path}`,
    smoke_executed: true,
    actual_http_status: null,
    ok: null,
  }));
}

function rank2ProductionLiveSmokeTemplate(packet) {
  const deployExecution = packet.supplied_rank2_deploy_execution_record ?? packet.rank2_deploy_execution_template ?? {};
  return {
    schema_version: "rank2-production-live-smoke-record/v0.1",
    candidate_family_id: deployExecution.candidate_family_id ?? null,
    decision: deployExecution.decision ?? null,
    followup_id: deployExecution.followup_id ?? null,
    requested_action: deployExecution.requested_action ?? null,
    deploy_execution_record_status: packet.rank2_deploy_execution_record_status,
    production_live_smoke_status: "recorded_production_live_smoke",
    smoke_scope: "production_live_smoke_only_no_redirect_no_delete",
    smoked_by: "<owner>",
    smoked_at: "<ISO-8601 timestamp>",
    production_base_url: PRODUCTION_WORKER_BASE_URL,
    deployment_target: deployExecution.deployment_target ?? "100xfenok-edge",
    owner_route: deployExecution.owner_route ?? null,
    compatibility_route: deployExecution.compatibility_route ?? null,
    legacy_sample_paths: deployExecution.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: deployExecution.pro_screen_model_acceptance ?? null,
    proposed_changes: deployExecution.proposed_changes ?? [],
    rollback_steps: deployExecution.rollback_steps ?? [],
    local_smoke_record_rows: deployExecution.local_smoke_record_rows ?? [],
    rows: rank2ProductionLiveSmokeRows(deployExecution),
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: ["delete", "redirect"],
    redirect_delete_approval_required: true,
    next_required_runtime_gate: "post_live_redirect_delete_approval_request",
    notes: "Production live smoke record only; no redirect, delete, or public file mutation has been applied by this packet.",
  };
}

function validateRank2ProductionLiveSmokeRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_deploy_execution_record_status !== "valid_deploy_execution_recorded_no_live_smoke") {
    return ["rank2 production live smoke requires a valid deploy execution record first"];
  }
  if (!template) return ["rank2 production live smoke template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 production live smoke schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 production live smoke identity mismatch");
  }
  if (record.deploy_execution_record_status !== "valid_deploy_execution_recorded_no_live_smoke") {
    errors.push(`rank2 production live smoke deploy execution status mismatch: ${record.deploy_execution_record_status}`);
  }
  if (record.production_live_smoke_status !== "recorded_production_live_smoke") {
    errors.push(`rank2 production live smoke status mismatch: ${record.production_live_smoke_status}`);
  }
  if (record.smoke_scope !== "production_live_smoke_only_no_redirect_no_delete") {
    errors.push(`rank2 production live smoke scope mismatch: ${record.smoke_scope}`);
  }
  if (typeof record.smoked_by !== "string" || record.smoked_by.trim().length === 0) {
    errors.push("rank2 production live smoke smoked_by is required");
  }
  if (!isIso8601Timestamp(record.smoked_at)) {
    errors.push(`rank2 production live smoke smoked_at must be a full ISO-8601 timestamp with timezone: ${record.smoked_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 production live smoke base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 production live smoke deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 production live smoke route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 production live smoke legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 production live smoke PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 production live smoke proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 production live smoke rollback steps mismatch");
  }
  if (JSON.stringify(record.local_smoke_record_rows) !== JSON.stringify(template.local_smoke_record_rows)) {
    errors.push("rank2 production live smoke local smoke record rows mismatch");
  }
  if (!Array.isArray(record.rows) || record.rows.length !== template.rows.length) {
    errors.push(`rank2 production live smoke row count mismatch: ${record.rows?.length}`);
    return errors;
  }
  for (let index = 0; index < template.rows.length; index += 1) {
    const expected = template.rows[index];
    const actual = record.rows[index];
    const label = `${expected.role} ${expected.path}`;
    if (actual.role !== expected.role || actual.path !== expected.path) {
      errors.push(`rank2 production live smoke row identity mismatch: ${label}`);
    }
    if (actual.expected_http_status !== expected.expected_http_status || actual.command !== expected.command) {
      errors.push(`rank2 production live smoke row command/status mismatch: ${label}`);
    }
    if (actual.smoke_executed !== true || actual.actual_http_status !== expected.expected_http_status || actual.ok !== true) {
      errors.push(`rank2 production live smoke row must pass production smoke: ${label}`);
    }
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
  ) {
    errors.push("rank2 production live smoke must record route patch, local smoke, deploy, and production live smoke as complete");
  }
  if (record.public_files_modified !== false || record.redirect_config_changed !== false) {
    errors.push("rank2 production live smoke must not redirect, delete, or mutate public files");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 production live smoke delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 production live smoke blocked actions mismatch");
  }
  if (record.redirect_delete_approval_required !== true) {
    errors.push("rank2 production live smoke must require a post-live redirect/delete approval request next");
  }
  if (record.next_required_runtime_gate !== "post_live_redirect_delete_approval_request") {
    errors.push(`rank2 production live smoke next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2PostLiveRedirectDeleteApprovalRequestTemplate(packet) {
  const productionLiveSmoke = packet.supplied_rank2_production_live_smoke_record ?? packet.rank2_production_live_smoke_template ?? {};
  return {
    schema_version: "rank2-post-live-redirect-delete-approval-request/v0.1",
    candidate_family_id: productionLiveSmoke.candidate_family_id ?? null,
    decision: productionLiveSmoke.decision ?? null,
    followup_id: productionLiveSmoke.followup_id ?? null,
    requested_action: productionLiveSmoke.requested_action ?? null,
    production_live_smoke_record_status: packet.rank2_production_live_smoke_record_status,
    request_status: "requested_no_execution",
    request_scope: "post_live_request_only_no_redirect_no_delete",
    requested_by: "<owner>",
    requested_at: "<ISO-8601 timestamp>",
    production_base_url: productionLiveSmoke.production_base_url ?? PRODUCTION_WORKER_BASE_URL,
    deployment_target: productionLiveSmoke.deployment_target ?? "100xfenok-edge",
    owner_route: productionLiveSmoke.owner_route ?? null,
    compatibility_route: productionLiveSmoke.compatibility_route ?? null,
    legacy_sample_paths: productionLiveSmoke.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: productionLiveSmoke.pro_screen_model_acceptance ?? null,
    proposed_changes: productionLiveSmoke.proposed_changes ?? [],
    rollback_steps: productionLiveSmoke.rollback_steps ?? [],
    production_smoke_rows: productionLiveSmoke.rows ?? [],
    requested_actions: ["redirect_review", "delete_review"],
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    redirect_delete_approval_requested: true,
    redirect_delete_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: ["delete", "redirect"],
    owner_approval_record_required: true,
    next_required_runtime_gate: "post_live_redirect_delete_approval_record",
    notes: "Post-live redirect/delete approval request only; no redirect, delete, or public file mutation has been applied by this packet.",
  };
}

function validateRank2PostLiveRedirectDeleteApprovalRequestRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_production_live_smoke_record_status !== "valid_production_live_smoke_recorded_no_redirect_no_delete") {
    return ["rank2 post-live redirect/delete approval request requires a valid production live smoke record first"];
  }
  if (!template) return ["rank2 post-live redirect/delete approval request template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 post-live redirect/delete approval request schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 post-live redirect/delete approval request identity mismatch");
  }
  if (record.production_live_smoke_record_status !== "valid_production_live_smoke_recorded_no_redirect_no_delete") {
    errors.push(`rank2 post-live redirect/delete approval request production live smoke status mismatch: ${record.production_live_smoke_record_status}`);
  }
  if (record.request_status !== "requested_no_execution") {
    errors.push(`rank2 post-live redirect/delete approval request status mismatch: ${record.request_status}`);
  }
  if (record.request_scope !== "post_live_request_only_no_redirect_no_delete") {
    errors.push(`rank2 post-live redirect/delete approval request scope mismatch: ${record.request_scope}`);
  }
  if (typeof record.requested_by !== "string" || record.requested_by.trim().length === 0) {
    errors.push("rank2 post-live redirect/delete approval request requested_by is required");
  }
  if (!isIso8601Timestamp(record.requested_at)) {
    errors.push(`rank2 post-live redirect/delete approval request requested_at must be a full ISO-8601 timestamp with timezone: ${record.requested_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 post-live redirect/delete approval request base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 post-live redirect/delete approval request deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 post-live redirect/delete approval request route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 post-live redirect/delete approval request legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 post-live redirect/delete approval request PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 post-live redirect/delete approval request proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 post-live redirect/delete approval request rollback steps mismatch");
  }
  if (JSON.stringify(record.production_smoke_rows) !== JSON.stringify(template.production_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete approval request production smoke rows mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 post-live redirect/delete approval request actions mismatch");
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
    || record.redirect_delete_approval_requested !== true
  ) {
    errors.push("rank2 post-live redirect/delete approval request must record completed production proof and requested approval");
  }
  if (
    record.redirect_delete_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 post-live redirect/delete approval request must not redirect, delete, or mutate public files");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 post-live redirect/delete approval request delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 post-live redirect/delete approval request blocked actions mismatch");
  }
  if (record.owner_approval_record_required !== true) {
    errors.push("rank2 post-live redirect/delete approval request must require a separate owner approval record next");
  }
  if (record.next_required_runtime_gate !== "post_live_redirect_delete_approval_record") {
    errors.push(`rank2 post-live redirect/delete approval request next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2PostLiveRedirectDeleteApprovalRecordTemplate(packet) {
  const request = packet.supplied_rank2_post_live_redirect_delete_approval_request_record
    ?? packet.rank2_post_live_redirect_delete_approval_request_template
    ?? {};
  return {
    schema_version: "rank2-post-live-redirect-delete-approval-record/v0.1",
    candidate_family_id: request.candidate_family_id ?? null,
    decision: request.decision ?? null,
    followup_id: request.followup_id ?? null,
    requested_action: request.requested_action ?? null,
    post_live_redirect_delete_approval_request_status: packet.rank2_post_live_redirect_delete_approval_request_record_status,
    approval_status: "owner_approved_no_execution",
    approval_scope: "record_only_no_redirect_no_delete",
    approved_by: "<owner>",
    approved_at: "<ISO-8601 timestamp>",
    production_base_url: request.production_base_url ?? PRODUCTION_WORKER_BASE_URL,
    deployment_target: request.deployment_target ?? "100xfenok-edge",
    owner_route: request.owner_route ?? null,
    compatibility_route: request.compatibility_route ?? null,
    legacy_sample_paths: request.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: request.pro_screen_model_acceptance ?? null,
    proposed_changes: request.proposed_changes ?? [],
    rollback_steps: request.rollback_steps ?? [],
    production_smoke_rows: request.production_smoke_rows ?? [],
    requested_actions: request.requested_actions ?? ["redirect_review", "delete_review"],
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    redirect_delete_approval_requested: true,
    redirect_delete_approved: true,
    redirect_delete_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: ["delete", "redirect"],
    execution_packet_required: true,
    next_required_runtime_gate: "post_live_redirect_delete_execution_packet",
    notes: "Post-live redirect/delete owner approval record only; no redirect, delete, or public file mutation has been applied by this packet.",
  };
}

function validateRank2PostLiveRedirectDeleteApprovalRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_post_live_redirect_delete_approval_request_record_status !== "valid_post_live_redirect_delete_approval_requested_no_execution") {
    return ["rank2 post-live redirect/delete approval record requires a valid post-live approval request first"];
  }
  if (!template) return ["rank2 post-live redirect/delete approval record template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 post-live redirect/delete approval record schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 post-live redirect/delete approval record identity mismatch");
  }
  if (record.post_live_redirect_delete_approval_request_status !== "valid_post_live_redirect_delete_approval_requested_no_execution") {
    errors.push(`rank2 post-live redirect/delete approval request status mismatch: ${record.post_live_redirect_delete_approval_request_status}`);
  }
  if (record.approval_status !== "owner_approved_no_execution") {
    errors.push(`rank2 post-live redirect/delete approval status mismatch: ${record.approval_status}`);
  }
  if (record.approval_scope !== "record_only_no_redirect_no_delete") {
    errors.push(`rank2 post-live redirect/delete approval scope mismatch: ${record.approval_scope}`);
  }
  if (typeof record.approved_by !== "string" || record.approved_by.trim().length === 0) {
    errors.push("rank2 post-live redirect/delete approval approved_by is required");
  }
  if (!isIso8601Timestamp(record.approved_at)) {
    errors.push(`rank2 post-live redirect/delete approval approved_at must be a full ISO-8601 timestamp with timezone: ${record.approved_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 post-live redirect/delete approval base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 post-live redirect/delete approval deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 post-live redirect/delete approval route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 post-live redirect/delete approval legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 post-live redirect/delete approval PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 post-live redirect/delete approval proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 post-live redirect/delete approval rollback steps mismatch");
  }
  if (JSON.stringify(record.production_smoke_rows) !== JSON.stringify(template.production_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete approval production smoke rows mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 post-live redirect/delete approval actions mismatch");
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
    || record.redirect_delete_approval_requested !== true
    || record.redirect_delete_approved !== true
  ) {
    errors.push("rank2 post-live redirect/delete approval must record completed proof and owner approval");
  }
  if (
    record.redirect_delete_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 post-live redirect/delete approval must not redirect, delete, or mutate public files");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 post-live redirect/delete approval delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 post-live redirect/delete approval blocked actions mismatch");
  }
  if (record.execution_packet_required !== true) {
    errors.push("rank2 post-live redirect/delete approval must require a separate execution packet next");
  }
  if (record.next_required_runtime_gate !== "post_live_redirect_delete_execution_packet") {
    errors.push(`rank2 post-live redirect/delete approval next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2PostLiveRedirectDeleteExecutionPacketTemplate(packet) {
  const approval = packet.supplied_rank2_post_live_redirect_delete_approval_record
    ?? packet.rank2_post_live_redirect_delete_approval_record_template
    ?? {};
  return {
    schema_version: "rank2-post-live-redirect-delete-execution-packet/v0.1",
    candidate_family_id: approval.candidate_family_id ?? null,
    decision: approval.decision ?? null,
    followup_id: approval.followup_id ?? null,
    requested_action: approval.requested_action ?? null,
    post_live_redirect_delete_approval_record_status: packet.rank2_post_live_redirect_delete_approval_record_status,
    execution_packet_status: "planned_no_execution",
    execution_scope: "packet_only_no_redirect_no_delete",
    recorded_by: "<owner>",
    recorded_at: "<ISO-8601 timestamp>",
    production_base_url: approval.production_base_url ?? PRODUCTION_WORKER_BASE_URL,
    deployment_target: approval.deployment_target ?? "100xfenok-edge",
    owner_route: approval.owner_route ?? null,
    compatibility_route: approval.compatibility_route ?? null,
    legacy_sample_paths: approval.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: approval.pro_screen_model_acceptance ?? null,
    proposed_changes: approval.proposed_changes ?? [],
    rollback_steps: approval.rollback_steps ?? [],
    production_smoke_rows: approval.production_smoke_rows ?? [],
    requested_actions: approval.requested_actions ?? ["redirect_review", "delete_review"],
    execution_steps: [
      {
        step: "confirm_owner_approval_record",
        action: "verify post-live redirect/delete owner approval is valid before any execution",
        executed: false,
      },
      {
        step: "apply_redirect_delete_changes",
        action: "future execution record only; do not apply redirects, deletes, or public-file mutation from this packet",
        executed: false,
      },
      {
        step: "post_execution_smoke",
        action: "future execution record must include post-execution route smoke and rollback proof",
        executed: false,
      },
    ],
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    redirect_delete_approval_requested: true,
    redirect_delete_approved: true,
    redirect_delete_execution_planned: true,
    redirect_delete_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions: ["delete", "redirect"],
    execution_record_required: true,
    next_required_runtime_gate: "post_live_redirect_delete_execution_record",
    notes: "Post-live redirect/delete execution packet only; no redirect, delete, or public file mutation has been applied by this packet.",
  };
}

function validateRank2PostLiveRedirectDeleteExecutionPacketRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_post_live_redirect_delete_approval_record_status !== "valid_post_live_redirect_delete_approved_no_execution") {
    return ["rank2 post-live redirect/delete execution packet requires a valid post-live approval record first"];
  }
  if (!template) return ["rank2 post-live redirect/delete execution packet template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 post-live redirect/delete execution packet schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 post-live redirect/delete execution packet identity mismatch");
  }
  if (record.post_live_redirect_delete_approval_record_status !== "valid_post_live_redirect_delete_approved_no_execution") {
    errors.push(`rank2 post-live redirect/delete execution packet approval status mismatch: ${record.post_live_redirect_delete_approval_record_status}`);
  }
  if (record.execution_packet_status !== "planned_no_execution") {
    errors.push(`rank2 post-live redirect/delete execution packet status mismatch: ${record.execution_packet_status}`);
  }
  if (record.execution_scope !== "packet_only_no_redirect_no_delete") {
    errors.push(`rank2 post-live redirect/delete execution packet scope mismatch: ${record.execution_scope}`);
  }
  if (typeof record.recorded_by !== "string" || record.recorded_by.trim().length === 0) {
    errors.push("rank2 post-live redirect/delete execution packet recorded_by is required");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 post-live redirect/delete execution packet recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 post-live redirect/delete execution packet base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 post-live redirect/delete execution packet deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 post-live redirect/delete execution packet route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 post-live redirect/delete execution packet legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 post-live redirect/delete execution packet PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 post-live redirect/delete execution packet proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 post-live redirect/delete execution packet rollback steps mismatch");
  }
  if (JSON.stringify(record.production_smoke_rows) !== JSON.stringify(template.production_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete execution packet production smoke rows mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 post-live redirect/delete execution packet requested actions mismatch");
  }
  if (JSON.stringify(record.execution_steps) !== JSON.stringify(template.execution_steps)) {
    errors.push("rank2 post-live redirect/delete execution packet steps mismatch");
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
    || record.redirect_delete_approval_requested !== true
    || record.redirect_delete_approved !== true
    || record.redirect_delete_execution_planned !== true
  ) {
    errors.push("rank2 post-live redirect/delete execution packet must record completed proof, approval, and planned execution");
  }
  if (
    record.redirect_delete_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 post-live redirect/delete execution packet must not redirect, delete, or mutate public files");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 post-live redirect/delete execution packet delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 post-live redirect/delete execution packet blocked actions mismatch");
  }
  if (record.execution_record_required !== true) {
    errors.push("rank2 post-live redirect/delete execution packet must require a separate execution record next");
  }
  if (record.next_required_runtime_gate !== "post_live_redirect_delete_execution_record") {
    errors.push(`rank2 post-live redirect/delete execution packet next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2PostLiveRedirectDeleteExecutionRecordTemplate(packet) {
  const executionPacket = packet.supplied_rank2_post_live_redirect_delete_execution_packet_record
    ?? packet.rank2_post_live_redirect_delete_execution_packet_template
    ?? {};
  const deletePaths = Array.isArray(executionPacket.legacy_sample_paths)
    ? executionPacket.legacy_sample_paths
    : [];
  return {
    schema_version: "rank2-post-live-redirect-delete-execution-record/v0.1",
    candidate_family_id: executionPacket.candidate_family_id ?? null,
    decision: executionPacket.decision ?? null,
    followup_id: executionPacket.followup_id ?? null,
    requested_action: executionPacket.requested_action ?? null,
    post_live_redirect_delete_execution_packet_record_status: packet.rank2_post_live_redirect_delete_execution_packet_record_status,
    execution_record_status: "recorded_redirect_delete_executed",
    execution_scope: "record_only_redirect_delete_execution_evidence",
    executed_by: "<owner>",
    executed_at: "<ISO-8601 timestamp>",
    production_base_url: executionPacket.production_base_url ?? PRODUCTION_WORKER_BASE_URL,
    deployment_target: executionPacket.deployment_target ?? "100xfenok-edge",
    owner_route: executionPacket.owner_route ?? null,
    compatibility_route: executionPacket.compatibility_route ?? null,
    legacy_sample_paths: executionPacket.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: executionPacket.pro_screen_model_acceptance ?? null,
    proposed_changes: executionPacket.proposed_changes ?? [],
    rollback_steps: executionPacket.rollback_steps ?? [],
    production_smoke_rows: executionPacket.production_smoke_rows ?? [],
    requested_actions: executionPacket.requested_actions ?? ["redirect_review", "delete_review"],
    execution_steps: [
      {
        step: "confirm_owner_approval_record",
        action: "verify post-live redirect/delete owner approval is valid before any execution",
        executed: true,
      },
      {
        step: "apply_redirect_delete_changes",
        action: "record externally performed redirect/delete execution evidence; this command does not mutate files or redirect config",
        executed: true,
      },
      {
        step: "post_execution_smoke",
        action: "future smoke record must include post-execution route smoke and rollback proof",
        executed: false,
      },
    ],
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    redirect_delete_approval_requested: true,
    redirect_delete_approved: true,
    redirect_delete_execution_planned: true,
    redirect_delete_executed: true,
    public_files_modified: true,
    redirect_config_changed: true,
    delete_paths: deletePaths,
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    blocked_actions: ["deploy", "additional_redirect_delete"],
    post_execution_smoke_required: true,
    next_required_runtime_gate: "post_live_redirect_delete_post_execution_smoke_record",
    notes: "Post-live redirect/delete execution evidence record only; this command does not execute redirects, deletes, deploys, or public file mutation.",
  };
}

function validateRank2PostLiveRedirectDeleteExecutionRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_post_live_redirect_delete_execution_packet_record_status !== "valid_post_live_redirect_delete_execution_packet_recorded_no_execution") {
    return ["rank2 post-live redirect/delete execution record requires a valid execution packet first"];
  }
  if (!template) return ["rank2 post-live redirect/delete execution record template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 post-live redirect/delete execution record schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 post-live redirect/delete execution record identity mismatch");
  }
  if (record.post_live_redirect_delete_execution_packet_record_status !== "valid_post_live_redirect_delete_execution_packet_recorded_no_execution") {
    errors.push(`rank2 post-live redirect/delete execution record packet status mismatch: ${record.post_live_redirect_delete_execution_packet_record_status}`);
  }
  if (record.execution_record_status !== "recorded_redirect_delete_executed") {
    errors.push(`rank2 post-live redirect/delete execution record status mismatch: ${record.execution_record_status}`);
  }
  if (record.execution_scope !== "record_only_redirect_delete_execution_evidence") {
    errors.push(`rank2 post-live redirect/delete execution record scope mismatch: ${record.execution_scope}`);
  }
  if (typeof record.executed_by !== "string" || record.executed_by.trim().length === 0) {
    errors.push("rank2 post-live redirect/delete execution record executed_by is required");
  }
  if (!isIso8601Timestamp(record.executed_at)) {
    errors.push(`rank2 post-live redirect/delete execution record executed_at must be a full ISO-8601 timestamp with timezone: ${record.executed_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 post-live redirect/delete execution record base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 post-live redirect/delete execution record deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 post-live redirect/delete execution record route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 post-live redirect/delete execution record legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 post-live redirect/delete execution record PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 post-live redirect/delete execution record proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 post-live redirect/delete execution record rollback steps mismatch");
  }
  if (JSON.stringify(record.production_smoke_rows) !== JSON.stringify(template.production_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete execution record production smoke rows mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 post-live redirect/delete execution record requested actions mismatch");
  }
  if (JSON.stringify(record.execution_steps) !== JSON.stringify(template.execution_steps)) {
    errors.push("rank2 post-live redirect/delete execution record steps mismatch");
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
    || record.redirect_delete_approval_requested !== true
    || record.redirect_delete_approved !== true
    || record.redirect_delete_execution_planned !== true
    || record.redirect_delete_executed !== true
  ) {
    errors.push("rank2 post-live redirect/delete execution record must record completed proof, approval, plan, and external execution evidence");
  }
  if (record.public_files_modified !== true || record.redirect_config_changed !== true) {
    errors.push("rank2 post-live redirect/delete execution record must record redirect config/public file mutation evidence");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify(template.delete_paths)) {
    errors.push("rank2 post-live redirect/delete execution record delete_paths mismatch");
  }
  if (record.execution_performed_outside_this_command !== true) {
    errors.push("rank2 post-live redirect/delete execution record must mark execution_performed_outside_this_command=true");
  }
  if (
    record.execution_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
  ) {
    errors.push("rank2 post-live redirect/delete execution record must keep by-this-command mutation flags false");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 post-live redirect/delete execution record blocked actions mismatch");
  }
  if (record.post_execution_smoke_required !== true) {
    errors.push("rank2 post-live redirect/delete execution record must require post-execution smoke next");
  }
  if (record.next_required_runtime_gate !== "post_live_redirect_delete_post_execution_smoke_record") {
    errors.push(`rank2 post-live redirect/delete execution record next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function postExecutionSmokeCommand(baseUrl, routePath) {
  return `curl -sS -o /dev/null -w "%{http_code}" ${baseUrl}${routePath}`;
}

function rank2PostLiveRedirectDeletePostExecutionSmokeRows(executionRecord) {
  const baseUrl = executionRecord.production_base_url ?? PRODUCTION_WORKER_BASE_URL;
  const rows = [];
  if (executionRecord.owner_route) {
    rows.push({
      role: "owner_route",
      path: executionRecord.owner_route,
      expected_outcome: "owner_route_serves_pro_surface",
      allowed_http_statuses: [200],
      command: postExecutionSmokeCommand(baseUrl, executionRecord.owner_route),
      smoke_executed: true,
      actual_http_status: null,
      ok: null,
    });
  }
  if (executionRecord.compatibility_route) {
    rows.push({
      role: "compatibility_route",
      path: executionRecord.compatibility_route,
      expected_outcome: "compatibility_route_redirects_or_serves_owner_route",
      allowed_http_statuses: [200, 301, 302, 307, 308],
      command: postExecutionSmokeCommand(baseUrl, executionRecord.compatibility_route),
      smoke_executed: true,
      actual_http_status: null,
      ok: null,
    });
  }
  const deletePaths = Array.isArray(executionRecord.delete_paths) && executionRecord.delete_paths.length > 0
    ? executionRecord.delete_paths
    : executionRecord.legacy_sample_paths ?? [];
  for (const legacyPath of deletePaths) {
    rows.push({
      role: "legacy_deleted_or_redirected_path",
      path: legacyPath,
      expected_outcome: "legacy_path_deleted_or_redirected_to_owner_route",
      allowed_http_statuses: [301, 302, 307, 308, 404, 410],
      command: postExecutionSmokeCommand(baseUrl, legacyPath),
      smoke_executed: true,
      actual_http_status: null,
      ok: null,
    });
  }
  return rows;
}

function rank2PostLiveRedirectDeletePostExecutionSmokeTemplate(packet) {
  const executionRecord = packet.supplied_rank2_post_live_redirect_delete_execution_record
    ?? packet.rank2_post_live_redirect_delete_execution_record_template
    ?? {};
  return {
    schema_version: "rank2-post-live-redirect-delete-post-execution-smoke-record/v0.1",
    candidate_family_id: executionRecord.candidate_family_id ?? null,
    decision: executionRecord.decision ?? null,
    followup_id: executionRecord.followup_id ?? null,
    requested_action: executionRecord.requested_action ?? null,
    post_live_redirect_delete_execution_record_status: packet.rank2_post_live_redirect_delete_execution_record_status,
    post_execution_smoke_status: "recorded_post_execution_smoke",
    smoke_scope: "post_execution_smoke_only_no_additional_redirect_delete_no_deploy",
    smoked_by: "<owner>",
    smoked_at: "<ISO-8601 timestamp>",
    production_base_url: executionRecord.production_base_url ?? PRODUCTION_WORKER_BASE_URL,
    deployment_target: executionRecord.deployment_target ?? "100xfenok-edge",
    owner_route: executionRecord.owner_route ?? null,
    compatibility_route: executionRecord.compatibility_route ?? null,
    legacy_sample_paths: executionRecord.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: executionRecord.pro_screen_model_acceptance ?? null,
    proposed_changes: executionRecord.proposed_changes ?? [],
    rollback_steps: executionRecord.rollback_steps ?? [],
    production_smoke_rows: executionRecord.production_smoke_rows ?? [],
    requested_actions: executionRecord.requested_actions ?? ["redirect_review", "delete_review"],
    execution_steps: executionRecord.execution_steps ?? [],
    rows: rank2PostLiveRedirectDeletePostExecutionSmokeRows(executionRecord),
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    redirect_delete_approval_requested: true,
    redirect_delete_approved: true,
    redirect_delete_execution_planned: true,
    redirect_delete_executed: true,
    post_execution_smoke_executed: true,
    public_files_modified: true,
    redirect_config_changed: true,
    delete_paths: executionRecord.delete_paths ?? [],
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    smoke_performed_outside_this_command: true,
    smoke_performed_by_this_command: false,
    blocked_actions: ["deploy", "additional_redirect_delete"],
    rollback_readiness_record_required: true,
    next_required_runtime_gate: "post_live_redirect_delete_rollback_readiness_record",
    notes: "Post-execution smoke evidence record only; this command does not execute smoke, redirects, deletes, deploys, or public file mutation.",
  };
}

function validateRank2PostLiveRedirectDeletePostExecutionSmokeRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_post_live_redirect_delete_execution_record_status !== "valid_post_live_redirect_delete_execution_recorded_pending_smoke") {
    return ["rank2 post-live redirect/delete post-execution smoke requires a valid execution record first"];
  }
  if (!template) return ["rank2 post-live redirect/delete post-execution smoke template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 post-live redirect/delete post-execution smoke schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 post-live redirect/delete post-execution smoke identity mismatch");
  }
  if (record.post_live_redirect_delete_execution_record_status !== "valid_post_live_redirect_delete_execution_recorded_pending_smoke") {
    errors.push(`rank2 post-live redirect/delete post-execution smoke execution record status mismatch: ${record.post_live_redirect_delete_execution_record_status}`);
  }
  if (record.post_execution_smoke_status !== "recorded_post_execution_smoke") {
    errors.push(`rank2 post-live redirect/delete post-execution smoke status mismatch: ${record.post_execution_smoke_status}`);
  }
  if (record.smoke_scope !== "post_execution_smoke_only_no_additional_redirect_delete_no_deploy") {
    errors.push(`rank2 post-live redirect/delete post-execution smoke scope mismatch: ${record.smoke_scope}`);
  }
  if (typeof record.smoked_by !== "string" || record.smoked_by.trim().length === 0) {
    errors.push("rank2 post-live redirect/delete post-execution smoke smoked_by is required");
  }
  if (!isIso8601Timestamp(record.smoked_at)) {
    errors.push(`rank2 post-live redirect/delete post-execution smoke smoked_at must be a full ISO-8601 timestamp with timezone: ${record.smoked_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 post-live redirect/delete post-execution smoke base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 post-live redirect/delete post-execution smoke deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 post-live redirect/delete post-execution smoke route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke rollback steps mismatch");
  }
  if (JSON.stringify(record.production_smoke_rows) !== JSON.stringify(template.production_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke production smoke rows mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke requested actions mismatch");
  }
  if (JSON.stringify(record.execution_steps) !== JSON.stringify(template.execution_steps)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke execution steps mismatch");
  }
  if (!Array.isArray(record.rows) || record.rows.length !== template.rows.length) {
    errors.push(`rank2 post-live redirect/delete post-execution smoke row count mismatch: ${record.rows?.length}`);
    return errors;
  }
  for (let index = 0; index < template.rows.length; index += 1) {
    const expected = template.rows[index];
    const actual = record.rows[index];
    const label = `${expected.role} ${expected.path}`;
    if (actual.role !== expected.role || actual.path !== expected.path || actual.expected_outcome !== expected.expected_outcome) {
      errors.push(`rank2 post-live redirect/delete post-execution smoke row identity mismatch: ${label}`);
    }
    if (JSON.stringify(actual.allowed_http_statuses) !== JSON.stringify(expected.allowed_http_statuses)
      || actual.command !== expected.command) {
      errors.push(`rank2 post-live redirect/delete post-execution smoke row command/status mismatch: ${label}`);
    }
    if (
      actual.smoke_executed !== true
      || !expected.allowed_http_statuses.includes(actual.actual_http_status)
      || actual.ok !== true
    ) {
      errors.push(`rank2 post-live redirect/delete post-execution smoke row must pass allowed-status smoke: ${label}`);
    }
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
    || record.redirect_delete_approval_requested !== true
    || record.redirect_delete_approved !== true
    || record.redirect_delete_execution_planned !== true
    || record.redirect_delete_executed !== true
    || record.post_execution_smoke_executed !== true
  ) {
    errors.push("rank2 post-live redirect/delete post-execution smoke must record completed execution and smoke evidence");
  }
  if (record.public_files_modified !== true || record.redirect_config_changed !== true) {
    errors.push("rank2 post-live redirect/delete post-execution smoke must preserve redirect config/public file mutation evidence");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify(template.delete_paths)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke delete_paths mismatch");
  }
  if (
    record.execution_performed_outside_this_command !== true
    || record.smoke_performed_outside_this_command !== true
  ) {
    errors.push("rank2 post-live redirect/delete post-execution smoke must mark execution and smoke as outside-this-command evidence");
  }
  if (
    record.execution_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
    || record.smoke_performed_by_this_command !== false
  ) {
    errors.push("rank2 post-live redirect/delete post-execution smoke must keep by-this-command mutation/smoke flags false");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 post-live redirect/delete post-execution smoke blocked actions mismatch");
  }
  if (record.rollback_readiness_record_required !== true) {
    errors.push("rank2 post-live redirect/delete post-execution smoke must require rollback readiness next");
  }
  if (record.next_required_runtime_gate !== "post_live_redirect_delete_rollback_readiness_record") {
    errors.push(`rank2 post-live redirect/delete post-execution smoke next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2PostLiveRedirectDeleteRollbackReadinessTemplate(packet) {
  const postExecutionSmoke = packet.supplied_rank2_post_live_redirect_delete_post_execution_smoke_record
    ?? packet.rank2_post_live_redirect_delete_post_execution_smoke_template
    ?? {};
  const rollbackSteps = postExecutionSmoke.rollback_steps ?? [];
  return {
    schema_version: "rank2-post-live-redirect-delete-rollback-readiness-record/v0.1",
    candidate_family_id: postExecutionSmoke.candidate_family_id ?? null,
    decision: postExecutionSmoke.decision ?? null,
    followup_id: postExecutionSmoke.followup_id ?? null,
    requested_action: postExecutionSmoke.requested_action ?? null,
    post_live_redirect_delete_post_execution_smoke_record_status: packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status,
    rollback_readiness_status: "recorded_rollback_readiness",
    rollback_scope: "record_only_rollback_readiness_no_rollback_no_deploy",
    recorded_by: "<owner>",
    recorded_at: "<ISO-8601 timestamp>",
    production_base_url: postExecutionSmoke.production_base_url ?? PRODUCTION_WORKER_BASE_URL,
    deployment_target: postExecutionSmoke.deployment_target ?? "100xfenok-edge",
    owner_route: postExecutionSmoke.owner_route ?? null,
    compatibility_route: postExecutionSmoke.compatibility_route ?? null,
    legacy_sample_paths: postExecutionSmoke.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: postExecutionSmoke.pro_screen_model_acceptance ?? null,
    proposed_changes: postExecutionSmoke.proposed_changes ?? [],
    rollback_steps: rollbackSteps,
    rollback_readiness_checks: rollbackSteps.map((step, index) => ({
      check_id: `rollback_step_${index + 1}`,
      step: step.step ?? `rollback_step_${index + 1}`,
      trigger: step.trigger ?? null,
      action: step.action ?? null,
      verification: step.verification ?? null,
      rollback_ready: true,
      rollback_applied: false,
    })),
    production_smoke_rows: postExecutionSmoke.production_smoke_rows ?? [],
    post_execution_smoke_rows: postExecutionSmoke.rows ?? [],
    requested_actions: postExecutionSmoke.requested_actions ?? ["redirect_review", "delete_review"],
    execution_steps: postExecutionSmoke.execution_steps ?? [],
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    redirect_delete_approval_requested: true,
    redirect_delete_approved: true,
    redirect_delete_execution_planned: true,
    redirect_delete_executed: true,
    post_execution_smoke_executed: true,
    rollback_ready: true,
    rollback_applied: false,
    public_files_modified: true,
    redirect_config_changed: true,
    delete_paths: postExecutionSmoke.delete_paths ?? [],
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    smoke_performed_outside_this_command: true,
    smoke_performed_by_this_command: false,
    rollback_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    blocked_actions: ["deploy", "additional_redirect_delete", "rollback_execution"],
    owner_closeout_record_required: true,
    next_required_runtime_gate: "post_live_redirect_delete_owner_closeout_record",
    notes: "Rollback readiness record only; this command does not apply rollback, deploy, redirects, deletes, smoke, or public file mutation.",
  };
}

function validateRank2PostLiveRedirectDeleteRollbackReadinessRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status !== "valid_post_live_redirect_delete_post_execution_smoke_recorded") {
    return ["rank2 post-live redirect/delete rollback readiness requires a valid post-execution smoke record first"];
  }
  if (!template) return ["rank2 post-live redirect/delete rollback readiness template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 post-live redirect/delete rollback readiness schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 post-live redirect/delete rollback readiness identity mismatch");
  }
  if (record.post_live_redirect_delete_post_execution_smoke_record_status !== "valid_post_live_redirect_delete_post_execution_smoke_recorded") {
    errors.push(`rank2 post-live redirect/delete rollback readiness smoke status mismatch: ${record.post_live_redirect_delete_post_execution_smoke_record_status}`);
  }
  if (record.rollback_readiness_status !== "recorded_rollback_readiness") {
    errors.push(`rank2 post-live redirect/delete rollback readiness status mismatch: ${record.rollback_readiness_status}`);
  }
  if (record.rollback_scope !== "record_only_rollback_readiness_no_rollback_no_deploy") {
    errors.push(`rank2 post-live redirect/delete rollback readiness scope mismatch: ${record.rollback_scope}`);
  }
  if (typeof record.recorded_by !== "string" || record.recorded_by.trim().length === 0) {
    errors.push("rank2 post-live redirect/delete rollback readiness recorded_by is required");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 post-live redirect/delete rollback readiness recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 post-live redirect/delete rollback readiness base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 post-live redirect/delete rollback readiness deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 post-live redirect/delete rollback readiness route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 post-live redirect/delete rollback readiness legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 post-live redirect/delete rollback readiness PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 post-live redirect/delete rollback readiness proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 post-live redirect/delete rollback readiness rollback steps mismatch");
  }
  if (JSON.stringify(record.rollback_readiness_checks) !== JSON.stringify(template.rollback_readiness_checks)) {
    errors.push("rank2 post-live redirect/delete rollback readiness checks mismatch");
  }
  if (JSON.stringify(record.production_smoke_rows) !== JSON.stringify(template.production_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete rollback readiness production smoke rows mismatch");
  }
  if (JSON.stringify(record.post_execution_smoke_rows) !== JSON.stringify(template.post_execution_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete rollback readiness post-execution smoke rows mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 post-live redirect/delete rollback readiness requested actions mismatch");
  }
  if (JSON.stringify(record.execution_steps) !== JSON.stringify(template.execution_steps)) {
    errors.push("rank2 post-live redirect/delete rollback readiness execution steps mismatch");
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
    || record.redirect_delete_approval_requested !== true
    || record.redirect_delete_approved !== true
    || record.redirect_delete_execution_planned !== true
    || record.redirect_delete_executed !== true
    || record.post_execution_smoke_executed !== true
    || record.rollback_ready !== true
  ) {
    errors.push("rank2 post-live redirect/delete rollback readiness must record completed execution/smoke evidence and rollback readiness");
  }
  if (record.rollback_applied !== false) {
    errors.push("rank2 post-live redirect/delete rollback readiness must not apply rollback");
  }
  if (record.public_files_modified !== true || record.redirect_config_changed !== true) {
    errors.push("rank2 post-live redirect/delete rollback readiness must preserve redirect config/public file mutation evidence");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify(template.delete_paths)) {
    errors.push("rank2 post-live redirect/delete rollback readiness delete_paths mismatch");
  }
  if (
    record.execution_performed_outside_this_command !== true
    || record.smoke_performed_outside_this_command !== true
  ) {
    errors.push("rank2 post-live redirect/delete rollback readiness must mark execution and smoke as outside-this-command evidence");
  }
  if (
    record.execution_performed_by_this_command !== false
    || record.smoke_performed_by_this_command !== false
    || record.rollback_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
  ) {
    errors.push("rank2 post-live redirect/delete rollback readiness must keep by-this-command mutation/smoke/rollback flags false");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 post-live redirect/delete rollback readiness blocked actions mismatch");
  }
  if (record.owner_closeout_record_required !== true) {
    errors.push("rank2 post-live redirect/delete rollback readiness must require owner closeout next");
  }
  if (record.next_required_runtime_gate !== "post_live_redirect_delete_owner_closeout_record") {
    errors.push(`rank2 post-live redirect/delete rollback readiness next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2PostLiveRedirectDeleteOwnerCloseoutTemplate(packet) {
  const rollbackReadiness = packet.supplied_rank2_post_live_redirect_delete_rollback_readiness_record
    ?? packet.rank2_post_live_redirect_delete_rollback_readiness_template
    ?? {};
  return {
    schema_version: "rank2-post-live-redirect-delete-owner-closeout-record/v0.1",
    candidate_family_id: rollbackReadiness.candidate_family_id ?? null,
    decision: rollbackReadiness.decision ?? null,
    followup_id: rollbackReadiness.followup_id ?? null,
    requested_action: rollbackReadiness.requested_action ?? null,
    post_live_redirect_delete_rollback_readiness_record_status: packet.rank2_post_live_redirect_delete_rollback_readiness_record_status,
    owner_closeout_status: "recorded_owner_closeout",
    closeout_scope: "record_only_owner_closeout_no_additional_runtime",
    closed_by: "<owner>",
    closed_at: "<ISO-8601 timestamp>",
    production_base_url: rollbackReadiness.production_base_url ?? PRODUCTION_WORKER_BASE_URL,
    deployment_target: rollbackReadiness.deployment_target ?? "100xfenok-edge",
    owner_route: rollbackReadiness.owner_route ?? null,
    compatibility_route: rollbackReadiness.compatibility_route ?? null,
    legacy_sample_paths: rollbackReadiness.legacy_sample_paths ?? [],
    pro_screen_model_acceptance: rollbackReadiness.pro_screen_model_acceptance ?? null,
    proposed_changes: rollbackReadiness.proposed_changes ?? [],
    rollback_steps: rollbackReadiness.rollback_steps ?? [],
    rollback_readiness_checks: rollbackReadiness.rollback_readiness_checks ?? [],
    production_smoke_rows: rollbackReadiness.production_smoke_rows ?? [],
    post_execution_smoke_rows: rollbackReadiness.post_execution_smoke_rows ?? [],
    requested_actions: rollbackReadiness.requested_actions ?? ["redirect_review", "delete_review"],
    execution_steps: rollbackReadiness.execution_steps ?? [],
    route_patch_applied: true,
    post_patch_smoke_executed: true,
    deploy_executed: true,
    production_live_smoke_executed: true,
    redirect_delete_approval_requested: true,
    redirect_delete_approved: true,
    redirect_delete_execution_planned: true,
    redirect_delete_executed: true,
    post_execution_smoke_executed: true,
    rollback_ready: true,
    rollback_applied: false,
    owner_closeout_accepted: true,
    additional_runtime_required: false,
    public_files_modified: true,
    redirect_config_changed: true,
    delete_paths: rollbackReadiness.delete_paths ?? [],
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    smoke_performed_outside_this_command: true,
    smoke_performed_by_this_command: false,
    rollback_performed_by_this_command: false,
    closeout_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    blocked_actions: ["additional_deploy", "additional_redirect_delete", "rollback_execution"],
    next_required_runtime_gate: "none_record_chain_closed",
    notes: "Owner closeout record only; this command does not apply runtime, rollback, deploy, redirects, deletes, smoke, or public file mutation.",
  };
}

function validateRank2PostLiveRedirectDeleteOwnerCloseoutRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_post_live_redirect_delete_rollback_readiness_record_status !== "valid_post_live_redirect_delete_rollback_readiness_recorded") {
    return ["rank2 post-live redirect/delete owner closeout requires a valid rollback readiness record first"];
  }
  if (!template) return ["rank2 post-live redirect/delete owner closeout template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 post-live redirect/delete owner closeout schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.candidate_family_id !== template.candidate_family_id
    || record.decision !== template.decision
    || record.followup_id !== template.followup_id
    || record.requested_action !== template.requested_action
  ) {
    errors.push("rank2 post-live redirect/delete owner closeout identity mismatch");
  }
  if (record.post_live_redirect_delete_rollback_readiness_record_status !== "valid_post_live_redirect_delete_rollback_readiness_recorded") {
    errors.push(`rank2 post-live redirect/delete owner closeout rollback readiness status mismatch: ${record.post_live_redirect_delete_rollback_readiness_record_status}`);
  }
  if (record.owner_closeout_status !== "recorded_owner_closeout") {
    errors.push(`rank2 post-live redirect/delete owner closeout status mismatch: ${record.owner_closeout_status}`);
  }
  if (record.closeout_scope !== "record_only_owner_closeout_no_additional_runtime") {
    errors.push(`rank2 post-live redirect/delete owner closeout scope mismatch: ${record.closeout_scope}`);
  }
  if (typeof record.closed_by !== "string" || record.closed_by.trim().length === 0) {
    errors.push("rank2 post-live redirect/delete owner closeout closed_by is required");
  }
  if (!isIso8601Timestamp(record.closed_at)) {
    errors.push(`rank2 post-live redirect/delete owner closeout closed_at must be a full ISO-8601 timestamp with timezone: ${record.closed_at}`);
  }
  if (record.production_base_url !== template.production_base_url) {
    errors.push(`rank2 post-live redirect/delete owner closeout base URL mismatch: ${record.production_base_url}`);
  }
  if (record.deployment_target !== template.deployment_target) {
    errors.push(`rank2 post-live redirect/delete owner closeout deployment_target mismatch: ${record.deployment_target}`);
  }
  if (record.owner_route !== template.owner_route || record.compatibility_route !== template.compatibility_route) {
    errors.push("rank2 post-live redirect/delete owner closeout route identity mismatch");
  }
  if (JSON.stringify(record.legacy_sample_paths) !== JSON.stringify(template.legacy_sample_paths)) {
    errors.push("rank2 post-live redirect/delete owner closeout legacy sample paths mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)) {
    errors.push("rank2 post-live redirect/delete owner closeout PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.proposed_changes) !== JSON.stringify(template.proposed_changes)) {
    errors.push("rank2 post-live redirect/delete owner closeout proposed changes mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 post-live redirect/delete owner closeout rollback steps mismatch");
  }
  if (JSON.stringify(record.rollback_readiness_checks) !== JSON.stringify(template.rollback_readiness_checks)) {
    errors.push("rank2 post-live redirect/delete owner closeout rollback readiness checks mismatch");
  }
  if (JSON.stringify(record.production_smoke_rows) !== JSON.stringify(template.production_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete owner closeout production smoke rows mismatch");
  }
  if (JSON.stringify(record.post_execution_smoke_rows) !== JSON.stringify(template.post_execution_smoke_rows)) {
    errors.push("rank2 post-live redirect/delete owner closeout post-execution smoke rows mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 post-live redirect/delete owner closeout requested actions mismatch");
  }
  if (JSON.stringify(record.execution_steps) !== JSON.stringify(template.execution_steps)) {
    errors.push("rank2 post-live redirect/delete owner closeout execution steps mismatch");
  }
  if (
    record.route_patch_applied !== true
    || record.post_patch_smoke_executed !== true
    || record.deploy_executed !== true
    || record.production_live_smoke_executed !== true
    || record.redirect_delete_approval_requested !== true
    || record.redirect_delete_approved !== true
    || record.redirect_delete_execution_planned !== true
    || record.redirect_delete_executed !== true
    || record.post_execution_smoke_executed !== true
    || record.rollback_ready !== true
    || record.owner_closeout_accepted !== true
  ) {
    errors.push("rank2 post-live redirect/delete owner closeout must record completed evidence, rollback readiness, and owner closeout acceptance");
  }
  if (record.rollback_applied !== false || record.additional_runtime_required !== false) {
    errors.push("rank2 post-live redirect/delete owner closeout must not apply rollback or require additional runtime");
  }
  if (record.public_files_modified !== true || record.redirect_config_changed !== true) {
    errors.push("rank2 post-live redirect/delete owner closeout must preserve redirect config/public file mutation evidence");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify(template.delete_paths)) {
    errors.push("rank2 post-live redirect/delete owner closeout delete_paths mismatch");
  }
  if (
    record.execution_performed_outside_this_command !== true
    || record.smoke_performed_outside_this_command !== true
  ) {
    errors.push("rank2 post-live redirect/delete owner closeout must mark execution and smoke as outside-this-command evidence");
  }
  if (
    record.execution_performed_by_this_command !== false
    || record.smoke_performed_by_this_command !== false
    || record.rollback_performed_by_this_command !== false
    || record.closeout_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
  ) {
    errors.push("rank2 post-live redirect/delete owner closeout must keep by-this-command mutation/smoke/rollback/closeout flags false");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 post-live redirect/delete owner closeout blocked actions mismatch");
  }
  if (record.next_required_runtime_gate !== "none_record_chain_closed") {
    errors.push(`rank2 post-live redirect/delete owner closeout next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2FreshOwnerRuntimePacketTemplate(packet) {
  const gate = packet.current_next_required_gate ?? currentNextRequiredGate(packet);
  const contract = gate.next_required_owner_packet?.required_contract ?? freshOwnerApprovedPacketContract(packet);
  return {
    schema_version: "rank2-fresh-owner-runtime-packet-record/v0.1",
    contract_id: contract.id,
    contract_schema_version: contract.schema_version,
    candidate_family_id: contract.candidate_family_id,
    owner_route: contract.owner_route,
    compatibility_route: contract.compatibility_route,
    packet_status: "fresh_owner_approved_no_runtime",
    approval_scope: "fresh_owner_runtime_packet_record_only_no_execution",
    owner_approved_by: "<owner>",
    approved_at: "<ISO-8601 timestamp>",
    required_contract: contract,
    contract_sections_acknowledged: contract.required_sections,
    pro_route_ia_acceptance_checks: contract.required_pro_route_ia_acceptance_checks,
    pro_screen_model_acceptance: contract.required_pro_screen_model_acceptance,
    local_live_equivalence: {
      schema_version: contract.required_live_equivalence.schema_version,
      proof_status: "local_runtime_smoke_passed",
      base_url: contract.required_live_equivalence.base_url,
      rows: contract.required_live_equivalence.rows.map((row) => ({
        ...row,
        actual_http_status: null,
        ok: null,
      })),
    },
    rollback_plan: contract.required_rollback_plan,
    explicit_owner_approval: {
      mutation_scope: contract.required_explicit_owner_approval.mutation_scope_must_name,
      approved_by_required: contract.required_explicit_owner_approval.approved_by_required,
      approved_at_iso8601_required: contract.required_explicit_owner_approval.approved_at_iso8601_required,
      execution_by_this_command_allowed: false,
    },
    previous_record_chain_reuse_allowed: false,
    previous_record_chain_reused: false,
    mutation: "none",
    mutation_allowed: false,
    execution_allowed: false,
    execution_by_this_command_allowed: false,
    route_patch_applied: false,
    redirect_delete_executed: false,
    deploy_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions_until_valid: contract.blocked_actions_until_valid,
    next_required_gate: "separate_runtime_execution_packet_after_fresh_owner_packet",
    notes: "Fresh owner-approved packet record only; this command validates the packet but does not execute route patches, redirects, deletes, deploys, smoke, or public-file mutation.",
  };
}

function validateRank2FreshOwnerRuntimePacketRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_post_live_redirect_delete_owner_closeout_record_status !== "valid_post_live_redirect_delete_owner_closeout_recorded") {
    return ["rank2 fresh owner runtime packet requires a closed prior owner closeout record first"];
  }
  if (packet.current_next_required_gate?.id !== "rank2_post_live_redirect_delete_record_chain_closed") {
    return ["rank2 fresh owner runtime packet requires current gate rank2_post_live_redirect_delete_record_chain_closed"];
  }
  if (!template) return ["rank2 fresh owner runtime packet template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 fresh owner runtime packet schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.contract_id !== template.contract_id
    || record.contract_schema_version !== template.contract_schema_version
    || record.candidate_family_id !== template.candidate_family_id
    || record.owner_route !== template.owner_route
    || record.compatibility_route !== template.compatibility_route
  ) {
    errors.push("rank2 fresh owner runtime packet identity/contract mismatch");
  }
  if (record.packet_status !== "fresh_owner_approved_no_runtime") {
    errors.push(`rank2 fresh owner runtime packet status mismatch: ${record.packet_status}`);
  }
  if (record.approval_scope !== "fresh_owner_runtime_packet_record_only_no_execution") {
    errors.push(`rank2 fresh owner runtime packet approval_scope mismatch: ${record.approval_scope}`);
  }
  if (typeof record.owner_approved_by !== "string" || record.owner_approved_by.trim().length === 0) {
    errors.push("rank2 fresh owner runtime packet owner_approved_by is required");
  }
  if (!isIso8601Timestamp(record.approved_at)) {
    errors.push(`rank2 fresh owner runtime packet approved_at must be a full ISO-8601 timestamp with timezone: ${record.approved_at}`);
  }
  if (JSON.stringify(record.required_contract) !== JSON.stringify(template.required_contract)) {
    errors.push("rank2 fresh owner runtime packet required_contract mismatch");
  }
  if (JSON.stringify(record.contract_sections_acknowledged) !== JSON.stringify(template.contract_sections_acknowledged)) {
    errors.push("rank2 fresh owner runtime packet contract sections mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(template.pro_route_ia_acceptance_checks)
    || record.pro_route_ia_acceptance_checks?.some((check) => check.status !== "pass")) {
    errors.push("rank2 fresh owner runtime packet PRO route/IA checks mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)
    || record.pro_screen_model_acceptance?.acceptance_ready !== true
    || record.pro_screen_model_acceptance?.home_primary_allowed !== false
    || record.pro_screen_model_acceptance?.mobile_primary_allowed !== false) {
    errors.push("rank2 fresh owner runtime packet PRO screen-model acceptance mismatch");
  }
  if (
    record.local_live_equivalence?.schema_version !== template.local_live_equivalence.schema_version
    || record.local_live_equivalence?.proof_status !== "local_runtime_smoke_passed"
    || record.local_live_equivalence?.base_url !== template.local_live_equivalence.base_url
    || !Array.isArray(record.local_live_equivalence?.rows)
    || record.local_live_equivalence.rows.length !== template.local_live_equivalence.rows.length
  ) {
    errors.push("rank2 fresh owner runtime packet local live-equivalence header/row count mismatch");
  } else {
    for (let index = 0; index < template.local_live_equivalence.rows.length; index += 1) {
      const expected = template.local_live_equivalence.rows[index];
      const actual = record.local_live_equivalence.rows[index];
      const label = `${expected.role} ${expected.path}`;
      if (
        actual.role !== expected.role
        || actual.path !== expected.path
        || actual.paired_path !== expected.paired_path
        || actual.expected_http_status !== expected.expected_http_status
        || actual.command !== expected.command
      ) {
        errors.push(`rank2 fresh owner runtime packet local live-equivalence row identity mismatch: ${label}`);
      }
      if (actual.actual_http_status !== expected.expected_http_status || actual.ok !== true) {
        errors.push(`rank2 fresh owner runtime packet local live-equivalence row must pass: ${label}`);
      }
    }
  }
  if (JSON.stringify(record.rollback_plan) !== JSON.stringify(template.rollback_plan)
    || record.rollback_plan?.rollback_scope !== "plan_only_no_execution"
    || record.rollback_plan?.route_patch_applied !== false
    || record.rollback_plan?.rollback_applied !== false) {
    errors.push("rank2 fresh owner runtime packet rollback plan mismatch");
  }
  if (JSON.stringify(record.explicit_owner_approval) !== JSON.stringify(template.explicit_owner_approval)
    || record.explicit_owner_approval?.execution_by_this_command_allowed !== false
    || !record.explicit_owner_approval?.mutation_scope?.includes("redirect")
    || !record.explicit_owner_approval?.mutation_scope?.includes("delete")
    || !record.explicit_owner_approval?.mutation_scope?.includes("deploy")
    || !record.explicit_owner_approval?.mutation_scope?.includes("public_file_mutation")) {
    errors.push("rank2 fresh owner runtime packet explicit owner approval mismatch");
  }
  if (
    record.previous_record_chain_reuse_allowed !== false
    || record.previous_record_chain_reused !== false
    || record.mutation !== "none"
    || record.mutation_allowed !== false
    || record.execution_allowed !== false
    || record.execution_by_this_command_allowed !== false
    || record.route_patch_applied !== false
    || record.redirect_delete_executed !== false
    || record.deploy_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 fresh owner runtime packet must stay record-only/no-execution/no-reuse");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 fresh owner runtime packet delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions_until_valid) !== JSON.stringify(template.blocked_actions_until_valid)) {
    errors.push("rank2 fresh owner runtime packet blocked actions mismatch");
  }
  if (record.next_required_gate !== "separate_runtime_execution_packet_after_fresh_owner_packet") {
    errors.push(`rank2 fresh owner runtime packet next_required_gate mismatch: ${record.next_required_gate}`);
  }
  return errors;
}

function rank2FreshOwnerRuntimeExecutionPacketTemplate(packet) {
  const freshPacket = packet.supplied_rank2_fresh_owner_runtime_packet_record
    ?? packet.rank2_fresh_owner_runtime_packet_template
    ?? {};
  return {
    schema_version: "rank2-fresh-owner-runtime-execution-packet-record/v0.1",
    contract_id: freshPacket.contract_id ?? null,
    candidate_family_id: freshPacket.candidate_family_id ?? null,
    owner_route: freshPacket.owner_route ?? null,
    compatibility_route: freshPacket.compatibility_route ?? null,
    fresh_owner_runtime_packet_record_status: packet.rank2_fresh_owner_runtime_packet_record_status,
    execution_packet_status: "planned_no_execution",
    execution_scope: "packet_only_no_runtime",
    recorded_by: "<owner>",
    recorded_at: "<ISO-8601 timestamp>",
    required_contract: freshPacket.required_contract ?? null,
    pro_route_ia_acceptance_checks: freshPacket.pro_route_ia_acceptance_checks ?? [],
    pro_screen_model_acceptance: freshPacket.pro_screen_model_acceptance ?? null,
    local_live_equivalence: freshPacket.local_live_equivalence ?? null,
    rollback_plan: freshPacket.rollback_plan ?? null,
    explicit_owner_approval: freshPacket.explicit_owner_approval ?? null,
    requested_actions: freshPacket.explicit_owner_approval?.mutation_scope ?? [],
    execution_sequence: [
      "confirm the fresh owner runtime packet is valid and not reused from a closed chain",
      "prepare external runtime execution evidence before any route patch, redirect/delete, deploy, or public-file mutation",
      "record actual execution evidence in a separate follow-up packet; this command must not execute runtime changes",
      "keep rollback plan available before any external runtime action",
    ],
    fresh_owner_packet_validated: packet.rank2_fresh_owner_runtime_packet_record_status === "valid_fresh_owner_runtime_packet_recorded_no_execution",
    runtime_execution_packet_recorded: true,
    mutation: "none",
    mutation_allowed: false,
    execution_allowed: false,
    execution_by_this_command_allowed: false,
    execution_performed_by_this_command: false,
    route_patch_applied: false,
    redirect_delete_executed: false,
    deploy_executed: false,
    public_files_modified: false,
    redirect_config_changed: false,
    delete_paths: [],
    blocked_actions_until_external_execution_record: [
      "runtime_execution",
      "route_patch",
      "redirect",
      "delete",
      "deploy",
      "public_file_mutation",
    ],
    next_required_gate: "separate_external_runtime_execution_record_after_fresh_owner_packet",
    notes: "Runtime execution packet record only; this command validates planning evidence but does not execute route patches, redirects, deletes, deploys, smoke, or public-file mutation.",
  };
}

function validateRank2FreshOwnerRuntimeExecutionPacketRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_fresh_owner_runtime_packet_record_status !== "valid_fresh_owner_runtime_packet_recorded_no_execution") {
    return ["rank2 fresh owner runtime execution packet requires a valid fresh owner runtime packet first"];
  }
  if (!template) return ["rank2 fresh owner runtime execution packet template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 fresh owner runtime execution packet schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.contract_id !== template.contract_id
    || record.candidate_family_id !== template.candidate_family_id
    || record.owner_route !== template.owner_route
    || record.compatibility_route !== template.compatibility_route
  ) {
    errors.push("rank2 fresh owner runtime execution packet identity/contract mismatch");
  }
  if (record.fresh_owner_runtime_packet_record_status !== "valid_fresh_owner_runtime_packet_recorded_no_execution") {
    errors.push(`rank2 fresh owner runtime execution packet fresh packet status mismatch: ${record.fresh_owner_runtime_packet_record_status}`);
  }
  if (record.execution_packet_status !== "planned_no_execution") {
    errors.push(`rank2 fresh owner runtime execution packet status mismatch: ${record.execution_packet_status}`);
  }
  if (record.execution_scope !== "packet_only_no_runtime") {
    errors.push(`rank2 fresh owner runtime execution packet scope mismatch: ${record.execution_scope}`);
  }
  if (typeof record.recorded_by !== "string" || record.recorded_by.trim().length === 0) {
    errors.push("rank2 fresh owner runtime execution packet recorded_by is required");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 fresh owner runtime execution packet recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (JSON.stringify(record.required_contract) !== JSON.stringify(template.required_contract)) {
    errors.push("rank2 fresh owner runtime execution packet required_contract mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(template.pro_route_ia_acceptance_checks)
    || record.pro_route_ia_acceptance_checks?.some((check) => check.status !== "pass")) {
    errors.push("rank2 fresh owner runtime execution packet PRO route/IA checks mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)
    || record.pro_screen_model_acceptance?.acceptance_ready !== true
    || record.pro_screen_model_acceptance?.home_primary_allowed !== false
    || record.pro_screen_model_acceptance?.mobile_primary_allowed !== false) {
    errors.push("rank2 fresh owner runtime execution packet PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.local_live_equivalence) !== JSON.stringify(template.local_live_equivalence)
    || record.local_live_equivalence?.proof_status !== "local_runtime_smoke_passed") {
    errors.push("rank2 fresh owner runtime execution packet local live-equivalence mismatch");
  }
  if (JSON.stringify(record.rollback_plan) !== JSON.stringify(template.rollback_plan)
    || record.rollback_plan?.rollback_scope !== "plan_only_no_execution"
    || record.rollback_plan?.rollback_applied !== false) {
    errors.push("rank2 fresh owner runtime execution packet rollback plan mismatch");
  }
  if (JSON.stringify(record.explicit_owner_approval) !== JSON.stringify(template.explicit_owner_approval)
    || record.explicit_owner_approval?.execution_by_this_command_allowed !== false) {
    errors.push("rank2 fresh owner runtime execution packet explicit owner approval mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)
    || !record.requested_actions?.includes("redirect")
    || !record.requested_actions?.includes("delete")
    || !record.requested_actions?.includes("deploy")
    || !record.requested_actions?.includes("public_file_mutation")) {
    errors.push("rank2 fresh owner runtime execution packet requested actions mismatch");
  }
  if (JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)) {
    errors.push("rank2 fresh owner runtime execution packet execution sequence mismatch");
  }
  if (
    record.fresh_owner_packet_validated !== true
    || record.runtime_execution_packet_recorded !== true
    || record.mutation !== "none"
    || record.mutation_allowed !== false
    || record.execution_allowed !== false
    || record.execution_by_this_command_allowed !== false
    || record.execution_performed_by_this_command !== false
    || record.route_patch_applied !== false
    || record.redirect_delete_executed !== false
    || record.deploy_executed !== false
    || record.public_files_modified !== false
    || record.redirect_config_changed !== false
  ) {
    errors.push("rank2 fresh owner runtime execution packet must stay record-only/no-runtime/no-public-mutation");
  }
  if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 fresh owner runtime execution packet delete_paths must stay empty");
  }
  if (JSON.stringify(record.blocked_actions_until_external_execution_record) !== JSON.stringify(template.blocked_actions_until_external_execution_record)) {
    errors.push("rank2 fresh owner runtime execution packet blocked actions mismatch");
  }
  if (record.next_required_gate !== "separate_external_runtime_execution_record_after_fresh_owner_packet") {
    errors.push(`rank2 fresh owner runtime execution packet next_required_gate mismatch: ${record.next_required_gate}`);
  }
  return errors;
}

function rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate(packet) {
  const executionPacket = packet.supplied_rank2_fresh_owner_runtime_execution_packet_record
    ?? packet.rank2_fresh_owner_runtime_execution_packet_template
    ?? {};
  const requestedActions = executionPacket.requested_actions ?? [];
  const redirectDeleteRequested = requestedActions.includes("redirect") || requestedActions.includes("delete");
  const deleteRequested = requestedActions.includes("delete");
  return {
    schema_version: "rank2-fresh-owner-external-runtime-execution-evidence-record/v0.1",
    contract_id: executionPacket.contract_id ?? null,
    candidate_family_id: executionPacket.candidate_family_id ?? null,
    owner_route: executionPacket.owner_route ?? null,
    compatibility_route: executionPacket.compatibility_route ?? null,
    fresh_owner_runtime_execution_packet_record_status: packet.rank2_fresh_owner_runtime_execution_packet_record_status,
    execution_evidence_status: "recorded_external_runtime_execution_pending_smoke",
    execution_scope: "external_runtime_execution_evidence_only",
    executed_by: "<owner>",
    executed_at: "<ISO-8601 timestamp>",
    required_contract: executionPacket.required_contract ?? null,
    pro_route_ia_acceptance_checks: executionPacket.pro_route_ia_acceptance_checks ?? [],
    pro_screen_model_acceptance: executionPacket.pro_screen_model_acceptance ?? null,
    local_live_equivalence: executionPacket.local_live_equivalence ?? null,
    rollback_plan: executionPacket.rollback_plan ?? null,
    explicit_owner_approval: executionPacket.explicit_owner_approval ?? null,
    requested_actions: requestedActions,
    execution_sequence: executionPacket.execution_sequence ?? [],
    external_execution_summary: {
      execution_source: "outside_this_command",
      route_patch_applied: true,
      redirect_delete_executed: redirectDeleteRequested,
      deploy_executed: requestedActions.includes("deploy"),
      public_files_modified: requestedActions.includes("public_file_mutation"),
    },
    route_patch_applied: true,
    redirect_delete_executed: redirectDeleteRequested,
    deploy_executed: requestedActions.includes("deploy"),
    public_files_modified: requestedActions.includes("public_file_mutation"),
    redirect_config_changed: requestedActions.includes("redirect"),
    delete_paths: deleteRequested ? ["<deleted path>"] : [],
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    deploy_performed_by_this_command: false,
    public_files_modified_by_this_command: false,
    post_runtime_smoke_required: true,
    blocked_actions: ["additional_runtime_execution", "rollback_execution"],
    next_required_runtime_gate: "fresh_owner_post_runtime_smoke_record",
    notes: "Fresh owner external runtime execution evidence record only; this command does not execute route patches, redirects, deletes, deploys, smoke, rollback, or public-file mutation.",
  };
}

function validateRank2FreshOwnerExternalRuntimeExecutionEvidenceRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_fresh_owner_runtime_execution_packet_record_status !== "valid_fresh_owner_runtime_execution_packet_recorded_no_execution") {
    return ["rank2 fresh owner external runtime execution evidence requires a valid runtime execution packet first"];
  }
  if (!template) return ["rank2 fresh owner external runtime execution evidence template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 fresh owner external runtime execution evidence schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.contract_id !== template.contract_id
    || record.candidate_family_id !== template.candidate_family_id
    || record.owner_route !== template.owner_route
    || record.compatibility_route !== template.compatibility_route
  ) {
    errors.push("rank2 fresh owner external runtime execution evidence identity/contract mismatch");
  }
  if (record.fresh_owner_runtime_execution_packet_record_status !== "valid_fresh_owner_runtime_execution_packet_recorded_no_execution") {
    errors.push(`rank2 fresh owner external runtime execution evidence packet status mismatch: ${record.fresh_owner_runtime_execution_packet_record_status}`);
  }
  if (record.execution_evidence_status !== "recorded_external_runtime_execution_pending_smoke") {
    errors.push(`rank2 fresh owner external runtime execution evidence status mismatch: ${record.execution_evidence_status}`);
  }
  if (record.execution_scope !== "external_runtime_execution_evidence_only") {
    errors.push(`rank2 fresh owner external runtime execution evidence scope mismatch: ${record.execution_scope}`);
  }
  if (typeof record.executed_by !== "string" || record.executed_by.trim().length === 0) {
    errors.push("rank2 fresh owner external runtime execution evidence executed_by is required");
  }
  if (!isIso8601Timestamp(record.executed_at)) {
    errors.push(`rank2 fresh owner external runtime execution evidence executed_at must be a full ISO-8601 timestamp with timezone: ${record.executed_at}`);
  }
  if (JSON.stringify(record.required_contract) !== JSON.stringify(template.required_contract)) {
    errors.push("rank2 fresh owner external runtime execution evidence required_contract mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(template.pro_route_ia_acceptance_checks)
    || record.pro_route_ia_acceptance_checks?.some((check) => check.status !== "pass")) {
    errors.push("rank2 fresh owner external runtime execution evidence PRO route/IA checks mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)
    || record.pro_screen_model_acceptance?.acceptance_ready !== true
    || record.pro_screen_model_acceptance?.home_primary_allowed !== false
    || record.pro_screen_model_acceptance?.mobile_primary_allowed !== false) {
    errors.push("rank2 fresh owner external runtime execution evidence PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.local_live_equivalence) !== JSON.stringify(template.local_live_equivalence)
    || record.local_live_equivalence?.proof_status !== "local_runtime_smoke_passed") {
    errors.push("rank2 fresh owner external runtime execution evidence local live-equivalence mismatch");
  }
  if (JSON.stringify(record.rollback_plan) !== JSON.stringify(template.rollback_plan)
    || record.rollback_plan?.rollback_scope !== "plan_only_no_execution"
    || record.rollback_plan?.rollback_applied !== false) {
    errors.push("rank2 fresh owner external runtime execution evidence rollback plan mismatch");
  }
  if (JSON.stringify(record.explicit_owner_approval) !== JSON.stringify(template.explicit_owner_approval)
    || record.explicit_owner_approval?.execution_by_this_command_allowed !== false) {
    errors.push("rank2 fresh owner external runtime execution evidence explicit owner approval mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 fresh owner external runtime execution evidence requested actions mismatch");
  }
  if (JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)) {
    errors.push("rank2 fresh owner external runtime execution evidence execution sequence mismatch");
  }
  if (JSON.stringify(record.external_execution_summary) !== JSON.stringify(template.external_execution_summary)) {
    errors.push("rank2 fresh owner external runtime execution evidence summary mismatch");
  }
  const redirectDeleteRequested = template.requested_actions.includes("redirect") || template.requested_actions.includes("delete");
  const deployRequested = template.requested_actions.includes("deploy");
  const publicFileMutationRequested = template.requested_actions.includes("public_file_mutation");
  const redirectRequested = template.requested_actions.includes("redirect");
  const deleteRequested = template.requested_actions.includes("delete");
  if (
    record.route_patch_applied !== true
    || record.redirect_delete_executed !== redirectDeleteRequested
    || record.deploy_executed !== deployRequested
    || record.public_files_modified !== publicFileMutationRequested
    || record.redirect_config_changed !== redirectRequested
  ) {
    errors.push("rank2 fresh owner external runtime execution evidence must record the externally performed requested runtime actions");
  }
  if (deleteRequested) {
    if (!Array.isArray(record.delete_paths)
      || record.delete_paths.length === 0
      || record.delete_paths.some((item) => typeof item !== "string" || item.trim().length === 0 || item.trim().startsWith("<"))) {
      errors.push("rank2 fresh owner external runtime execution evidence delete_paths must list concrete externally deleted paths");
    }
  } else if (JSON.stringify(record.delete_paths) !== JSON.stringify([])) {
    errors.push("rank2 fresh owner external runtime execution evidence delete_paths must stay empty when delete was not requested");
  }
  if (record.execution_performed_outside_this_command !== true) {
    errors.push("rank2 fresh owner external runtime execution evidence must mark execution_performed_outside_this_command=true");
  }
  if (
    record.execution_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
    || record.deploy_performed_by_this_command !== false
    || record.public_files_modified_by_this_command !== false
  ) {
    errors.push("rank2 fresh owner external runtime execution evidence must keep all by-this-command mutation flags false");
  }
  if (record.post_runtime_smoke_required !== true) {
    errors.push("rank2 fresh owner external runtime execution evidence must require post-runtime smoke next");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 fresh owner external runtime execution evidence blocked actions mismatch");
  }
  if (record.next_required_runtime_gate !== "fresh_owner_post_runtime_smoke_record") {
    errors.push(`rank2 fresh owner external runtime execution evidence next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2FreshOwnerPostRuntimeSmokeEvidenceRows(externalEvidence) {
  const baseUrl = externalEvidence.local_live_equivalence?.base_url ?? PRODUCTION_WORKER_BASE_URL;
  const rows = [];
  if (externalEvidence.owner_route) {
    rows.push({
      role: "owner_route",
      path: externalEvidence.owner_route,
      expected_outcome: "owner_route_serves_pro_surface_after_runtime",
      allowed_http_statuses: [200],
      command: postExecutionSmokeCommand(baseUrl, externalEvidence.owner_route),
      smoke_executed: true,
      actual_http_status: null,
      ok: null,
    });
  }
  if (externalEvidence.compatibility_route) {
    rows.push({
      role: "compatibility_route",
      path: externalEvidence.compatibility_route,
      expected_outcome: "compatibility_route_redirects_or_serves_owner_route_after_runtime",
      allowed_http_statuses: [200, 301, 302, 307, 308],
      command: postExecutionSmokeCommand(baseUrl, externalEvidence.compatibility_route),
      smoke_executed: true,
      actual_http_status: null,
      ok: null,
    });
  }
  for (const deletePath of externalEvidence.delete_paths ?? []) {
    rows.push({
      role: "legacy_deleted_or_redirected_path",
      path: deletePath,
      expected_outcome: "legacy_path_deleted_or_redirected_after_runtime",
      allowed_http_statuses: [301, 302, 307, 308, 404, 410],
      command: postExecutionSmokeCommand(baseUrl, deletePath),
      smoke_executed: true,
      actual_http_status: null,
      ok: null,
    });
  }
  return rows;
}

function rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate(packet) {
  const externalEvidence = packet.supplied_rank2_fresh_owner_external_runtime_execution_evidence_record
    ?? packet.rank2_fresh_owner_external_runtime_execution_evidence_template
    ?? {};
  return {
    schema_version: "rank2-fresh-owner-post-runtime-smoke-evidence-record/v0.1",
    contract_id: externalEvidence.contract_id ?? null,
    candidate_family_id: externalEvidence.candidate_family_id ?? null,
    owner_route: externalEvidence.owner_route ?? null,
    compatibility_route: externalEvidence.compatibility_route ?? null,
    fresh_owner_external_runtime_execution_evidence_record_status: packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status,
    post_runtime_smoke_status: "recorded_post_runtime_smoke_pending_rollback",
    smoke_scope: "post_runtime_smoke_evidence_only_no_additional_runtime",
    smoked_by: "<owner>",
    smoked_at: "<ISO-8601 timestamp>",
    smoke_base_url: externalEvidence.local_live_equivalence?.base_url ?? PRODUCTION_WORKER_BASE_URL,
    required_contract: externalEvidence.required_contract ?? null,
    pro_route_ia_acceptance_checks: externalEvidence.pro_route_ia_acceptance_checks ?? [],
    pro_screen_model_acceptance: externalEvidence.pro_screen_model_acceptance ?? null,
    local_live_equivalence: externalEvidence.local_live_equivalence ?? null,
    rollback_plan: externalEvidence.rollback_plan ?? null,
    explicit_owner_approval: externalEvidence.explicit_owner_approval ?? null,
    requested_actions: externalEvidence.requested_actions ?? [],
    execution_sequence: externalEvidence.execution_sequence ?? [],
    external_execution_summary: externalEvidence.external_execution_summary ?? null,
    rows: rank2FreshOwnerPostRuntimeSmokeEvidenceRows(externalEvidence),
    route_patch_applied: externalEvidence.route_patch_applied ?? false,
    redirect_delete_executed: externalEvidence.redirect_delete_executed ?? false,
    deploy_executed: externalEvidence.deploy_executed ?? false,
    public_files_modified: externalEvidence.public_files_modified ?? false,
    redirect_config_changed: externalEvidence.redirect_config_changed ?? false,
    delete_paths: externalEvidence.delete_paths ?? [],
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    post_runtime_smoke_executed: true,
    smoke_performed_outside_this_command: true,
    smoke_performed_by_this_command: false,
    rollback_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    deploy_performed_by_this_command: false,
    public_files_modified_by_this_command: false,
    blocked_actions: ["additional_runtime_execution", "rollback_execution"],
    rollback_readiness_required: true,
    next_required_runtime_gate: "fresh_owner_runtime_rollback_readiness_record",
    notes: "Fresh owner post-runtime smoke evidence record only; this command does not run smoke, rollback, route patches, redirects, deletes, deploys, or public-file mutation.",
  };
}

function validateRank2FreshOwnerPostRuntimeSmokeEvidenceRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status !== "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke") {
    return ["rank2 fresh owner post-runtime smoke evidence requires a valid external runtime execution evidence record first"];
  }
  if (!template) return ["rank2 fresh owner post-runtime smoke evidence template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 fresh owner post-runtime smoke evidence schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.contract_id !== template.contract_id
    || record.candidate_family_id !== template.candidate_family_id
    || record.owner_route !== template.owner_route
    || record.compatibility_route !== template.compatibility_route
  ) {
    errors.push("rank2 fresh owner post-runtime smoke evidence identity/contract mismatch");
  }
  if (record.fresh_owner_external_runtime_execution_evidence_record_status !== "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke") {
    errors.push(`rank2 fresh owner post-runtime smoke evidence external evidence status mismatch: ${record.fresh_owner_external_runtime_execution_evidence_record_status}`);
  }
  if (record.post_runtime_smoke_status !== "recorded_post_runtime_smoke_pending_rollback") {
    errors.push(`rank2 fresh owner post-runtime smoke evidence status mismatch: ${record.post_runtime_smoke_status}`);
  }
  if (record.smoke_scope !== "post_runtime_smoke_evidence_only_no_additional_runtime") {
    errors.push(`rank2 fresh owner post-runtime smoke evidence scope mismatch: ${record.smoke_scope}`);
  }
  if (typeof record.smoked_by !== "string" || record.smoked_by.trim().length === 0) {
    errors.push("rank2 fresh owner post-runtime smoke evidence smoked_by is required");
  }
  if (!isIso8601Timestamp(record.smoked_at)) {
    errors.push(`rank2 fresh owner post-runtime smoke evidence smoked_at must be a full ISO-8601 timestamp with timezone: ${record.smoked_at}`);
  }
  if (record.smoke_base_url !== template.smoke_base_url) {
    errors.push(`rank2 fresh owner post-runtime smoke evidence base URL mismatch: ${record.smoke_base_url}`);
  }
  if (JSON.stringify(record.required_contract) !== JSON.stringify(template.required_contract)) {
    errors.push("rank2 fresh owner post-runtime smoke evidence required_contract mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(template.pro_route_ia_acceptance_checks)
    || record.pro_route_ia_acceptance_checks?.some((check) => check.status !== "pass")) {
    errors.push("rank2 fresh owner post-runtime smoke evidence PRO route/IA checks mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)
    || record.pro_screen_model_acceptance?.acceptance_ready !== true) {
    errors.push("rank2 fresh owner post-runtime smoke evidence PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.local_live_equivalence) !== JSON.stringify(template.local_live_equivalence)
    || record.local_live_equivalence?.proof_status !== "local_runtime_smoke_passed") {
    errors.push("rank2 fresh owner post-runtime smoke evidence local live-equivalence mismatch");
  }
  if (JSON.stringify(record.rollback_plan) !== JSON.stringify(template.rollback_plan)
    || record.rollback_plan?.rollback_scope !== "plan_only_no_execution"
    || record.rollback_plan?.rollback_applied !== false) {
    errors.push("rank2 fresh owner post-runtime smoke evidence rollback plan mismatch");
  }
  if (JSON.stringify(record.explicit_owner_approval) !== JSON.stringify(template.explicit_owner_approval)
    || record.explicit_owner_approval?.execution_by_this_command_allowed !== false) {
    errors.push("rank2 fresh owner post-runtime smoke evidence explicit owner approval mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)) {
    errors.push("rank2 fresh owner post-runtime smoke evidence requested actions mismatch");
  }
  if (JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)) {
    errors.push("rank2 fresh owner post-runtime smoke evidence execution sequence mismatch");
  }
  if (JSON.stringify(record.external_execution_summary) !== JSON.stringify(template.external_execution_summary)) {
    errors.push("rank2 fresh owner post-runtime smoke evidence external execution summary mismatch");
  }
  if (!Array.isArray(record.rows) || record.rows.length !== template.rows.length) {
    errors.push(`rank2 fresh owner post-runtime smoke evidence row count mismatch: ${record.rows?.length}`);
    return errors;
  }
  for (let index = 0; index < template.rows.length; index += 1) {
    const expected = template.rows[index];
    const actual = record.rows[index];
    const label = `${expected.role} ${expected.path}`;
    if (actual.role !== expected.role || actual.path !== expected.path || actual.expected_outcome !== expected.expected_outcome) {
      errors.push(`rank2 fresh owner post-runtime smoke evidence row identity mismatch: ${label}`);
    }
    if (JSON.stringify(actual.allowed_http_statuses) !== JSON.stringify(expected.allowed_http_statuses)
      || actual.command !== expected.command) {
      errors.push(`rank2 fresh owner post-runtime smoke evidence row command/status mismatch: ${label}`);
    }
    if (
      actual.smoke_executed !== true
      || !expected.allowed_http_statuses.includes(actual.actual_http_status)
      || actual.ok !== true
    ) {
      errors.push(`rank2 fresh owner post-runtime smoke evidence row must pass allowed-status smoke: ${label}`);
    }
  }
  if (
    record.route_patch_applied !== template.route_patch_applied
    || record.redirect_delete_executed !== template.redirect_delete_executed
    || record.deploy_executed !== template.deploy_executed
    || record.public_files_modified !== template.public_files_modified
    || record.redirect_config_changed !== template.redirect_config_changed
    || JSON.stringify(record.delete_paths) !== JSON.stringify(template.delete_paths)
  ) {
    errors.push("rank2 fresh owner post-runtime smoke evidence must preserve external runtime execution evidence fields");
  }
  if (
    record.execution_performed_outside_this_command !== true
    || record.execution_performed_by_this_command !== false
    || record.post_runtime_smoke_executed !== true
    || record.smoke_performed_outside_this_command !== true
    || record.smoke_performed_by_this_command !== false
    || record.rollback_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
    || record.deploy_performed_by_this_command !== false
    || record.public_files_modified_by_this_command !== false
  ) {
    errors.push("rank2 fresh owner post-runtime smoke evidence must keep smoke/evidence-only by-this-command flags");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 fresh owner post-runtime smoke evidence blocked actions mismatch");
  }
  if (record.rollback_readiness_required !== true) {
    errors.push("rank2 fresh owner post-runtime smoke evidence must require rollback readiness next");
  }
  if (record.next_required_runtime_gate !== "fresh_owner_runtime_rollback_readiness_record") {
    errors.push(`rank2 fresh owner post-runtime smoke evidence next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2FreshOwnerRollbackReadinessTemplate(packet) {
  const postRuntimeSmoke = packet.supplied_rank2_fresh_owner_post_runtime_smoke_evidence_record
    ?? packet.rank2_fresh_owner_post_runtime_smoke_evidence_template
    ?? {};
  const rollbackSteps = postRuntimeSmoke.rollback_plan?.rollback_steps ?? [];
  return {
    schema_version: "rank2-fresh-owner-rollback-readiness-record/v0.1",
    contract_id: postRuntimeSmoke.contract_id ?? null,
    candidate_family_id: postRuntimeSmoke.candidate_family_id ?? null,
    owner_route: postRuntimeSmoke.owner_route ?? null,
    compatibility_route: postRuntimeSmoke.compatibility_route ?? null,
    fresh_owner_post_runtime_smoke_evidence_record_status: packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status,
    rollback_readiness_status: "recorded_fresh_owner_rollback_readiness_pending_closeout",
    rollback_scope: "record_only_rollback_readiness_no_rollback_no_deploy",
    recorded_by: "<owner>",
    recorded_at: "<ISO-8601 timestamp>",
    smoke_base_url: postRuntimeSmoke.smoke_base_url ?? PRODUCTION_WORKER_BASE_URL,
    required_contract: postRuntimeSmoke.required_contract ?? null,
    pro_route_ia_acceptance_checks: postRuntimeSmoke.pro_route_ia_acceptance_checks ?? [],
    pro_screen_model_acceptance: postRuntimeSmoke.pro_screen_model_acceptance ?? null,
    local_live_equivalence: postRuntimeSmoke.local_live_equivalence ?? null,
    rollback_plan: postRuntimeSmoke.rollback_plan ?? null,
    rollback_steps: rollbackSteps,
    rollback_readiness_checks: rollbackSteps.map((step, index) => ({
      check_id: `fresh_owner_rollback_step_${index + 1}`,
      step: step.step ?? `rollback_step_${index + 1}`,
      trigger: step.trigger ?? null,
      action: step.action ?? null,
      verification: step.verification ?? null,
      rollback_ready: true,
      rollback_applied: false,
    })),
    explicit_owner_approval: postRuntimeSmoke.explicit_owner_approval ?? null,
    requested_actions: postRuntimeSmoke.requested_actions ?? [],
    execution_sequence: postRuntimeSmoke.execution_sequence ?? [],
    external_execution_summary: postRuntimeSmoke.external_execution_summary ?? null,
    post_runtime_smoke_rows: postRuntimeSmoke.rows ?? [],
    route_patch_applied: postRuntimeSmoke.route_patch_applied ?? false,
    redirect_delete_executed: postRuntimeSmoke.redirect_delete_executed ?? false,
    deploy_executed: postRuntimeSmoke.deploy_executed ?? false,
    public_files_modified: postRuntimeSmoke.public_files_modified ?? false,
    redirect_config_changed: postRuntimeSmoke.redirect_config_changed ?? false,
    delete_paths: postRuntimeSmoke.delete_paths ?? [],
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    post_runtime_smoke_executed: true,
    smoke_performed_outside_this_command: true,
    smoke_performed_by_this_command: false,
    rollback_ready: true,
    rollback_applied: false,
    rollback_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    deploy_performed_by_this_command: false,
    public_files_modified_by_this_command: false,
    blocked_actions: ["rollback_execution", "owner_closeout_execution"],
    owner_closeout_required: true,
    next_required_runtime_gate: "fresh_owner_owner_closeout_record",
    notes: "Fresh owner rollback readiness record only; this command does not apply rollback, run smoke, patch routes, redirect/delete, deploy, or mutate public files.",
  };
}

function validateRank2FreshOwnerRollbackReadinessRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status !== "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback") {
    return ["rank2 fresh owner rollback readiness requires a valid post-runtime smoke evidence record first"];
  }
  if (!template) return ["rank2 fresh owner rollback readiness template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 fresh owner rollback readiness schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.contract_id !== template.contract_id
    || record.candidate_family_id !== template.candidate_family_id
    || record.owner_route !== template.owner_route
    || record.compatibility_route !== template.compatibility_route
  ) {
    errors.push("rank2 fresh owner rollback readiness identity/contract mismatch");
  }
  if (record.fresh_owner_post_runtime_smoke_evidence_record_status !== "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback") {
    errors.push(`rank2 fresh owner rollback readiness smoke evidence status mismatch: ${record.fresh_owner_post_runtime_smoke_evidence_record_status}`);
  }
  if (record.rollback_readiness_status !== "recorded_fresh_owner_rollback_readiness_pending_closeout") {
    errors.push(`rank2 fresh owner rollback readiness status mismatch: ${record.rollback_readiness_status}`);
  }
  if (record.rollback_scope !== "record_only_rollback_readiness_no_rollback_no_deploy") {
    errors.push(`rank2 fresh owner rollback readiness scope mismatch: ${record.rollback_scope}`);
  }
  if (typeof record.recorded_by !== "string" || record.recorded_by.trim().length === 0) {
    errors.push("rank2 fresh owner rollback readiness recorded_by is required");
  }
  if (!isIso8601Timestamp(record.recorded_at)) {
    errors.push(`rank2 fresh owner rollback readiness recorded_at must be a full ISO-8601 timestamp with timezone: ${record.recorded_at}`);
  }
  if (record.smoke_base_url !== template.smoke_base_url) {
    errors.push(`rank2 fresh owner rollback readiness base URL mismatch: ${record.smoke_base_url}`);
  }
  if (JSON.stringify(record.required_contract) !== JSON.stringify(template.required_contract)) {
    errors.push("rank2 fresh owner rollback readiness required_contract mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(template.pro_route_ia_acceptance_checks)
    || record.pro_route_ia_acceptance_checks?.some((check) => check.status !== "pass")) {
    errors.push("rank2 fresh owner rollback readiness PRO route/IA checks mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)
    || record.pro_screen_model_acceptance?.acceptance_ready !== true) {
    errors.push("rank2 fresh owner rollback readiness PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.local_live_equivalence) !== JSON.stringify(template.local_live_equivalence)
    || record.local_live_equivalence?.proof_status !== "local_runtime_smoke_passed") {
    errors.push("rank2 fresh owner rollback readiness local live-equivalence mismatch");
  }
  if (JSON.stringify(record.rollback_plan) !== JSON.stringify(template.rollback_plan)
    || record.rollback_plan?.rollback_scope !== "plan_only_no_execution"
    || record.rollback_plan?.rollback_applied !== false) {
    errors.push("rank2 fresh owner rollback readiness rollback plan mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)) {
    errors.push("rank2 fresh owner rollback readiness rollback steps mismatch");
  }
  if (JSON.stringify(record.rollback_readiness_checks) !== JSON.stringify(template.rollback_readiness_checks)
    || record.rollback_readiness_checks?.some((check) => check.rollback_ready !== true || check.rollback_applied !== false)) {
    errors.push("rank2 fresh owner rollback readiness checks mismatch");
  }
  if (JSON.stringify(record.explicit_owner_approval) !== JSON.stringify(template.explicit_owner_approval)
    || record.explicit_owner_approval?.execution_by_this_command_allowed !== false) {
    errors.push("rank2 fresh owner rollback readiness explicit owner approval mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)
    || JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)
    || JSON.stringify(record.external_execution_summary) !== JSON.stringify(template.external_execution_summary)
    || JSON.stringify(record.post_runtime_smoke_rows) !== JSON.stringify(template.post_runtime_smoke_rows)) {
    errors.push("rank2 fresh owner rollback readiness prior evidence mismatch");
  }
  if (
    record.route_patch_applied !== template.route_patch_applied
    || record.redirect_delete_executed !== template.redirect_delete_executed
    || record.deploy_executed !== template.deploy_executed
    || record.public_files_modified !== template.public_files_modified
    || record.redirect_config_changed !== template.redirect_config_changed
    || JSON.stringify(record.delete_paths) !== JSON.stringify(template.delete_paths)
  ) {
    errors.push("rank2 fresh owner rollback readiness must preserve post-runtime smoke evidence fields");
  }
  if (
    record.execution_performed_outside_this_command !== true
    || record.execution_performed_by_this_command !== false
    || record.post_runtime_smoke_executed !== true
    || record.smoke_performed_outside_this_command !== true
    || record.smoke_performed_by_this_command !== false
    || record.rollback_ready !== true
    || record.rollback_applied !== false
    || record.rollback_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
    || record.deploy_performed_by_this_command !== false
    || record.public_files_modified_by_this_command !== false
  ) {
    errors.push("rank2 fresh owner rollback readiness must keep rollback-readiness-only by-this-command flags");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 fresh owner rollback readiness blocked actions mismatch");
  }
  if (record.owner_closeout_required !== true) {
    errors.push("rank2 fresh owner rollback readiness must require owner closeout next");
  }
  if (record.next_required_runtime_gate !== "fresh_owner_owner_closeout_record") {
    errors.push(`rank2 fresh owner rollback readiness next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2FreshOwnerOwnerCloseoutTemplate(packet) {
  const rollbackReadiness = packet.supplied_rank2_fresh_owner_rollback_readiness_record
    ?? packet.rank2_fresh_owner_rollback_readiness_template
    ?? {};
  return {
    schema_version: "rank2-fresh-owner-owner-closeout-record/v0.1",
    contract_id: rollbackReadiness.contract_id ?? null,
    candidate_family_id: rollbackReadiness.candidate_family_id ?? null,
    owner_route: rollbackReadiness.owner_route ?? null,
    compatibility_route: rollbackReadiness.compatibility_route ?? null,
    fresh_owner_rollback_readiness_record_status: packet.rank2_fresh_owner_rollback_readiness_record_status,
    owner_closeout_status: "recorded_fresh_owner_owner_closeout",
    closeout_scope: "record_only_owner_closeout_no_additional_runtime",
    closed_by: "<owner>",
    closed_at: "<ISO-8601 timestamp>",
    smoke_base_url: rollbackReadiness.smoke_base_url ?? PRODUCTION_WORKER_BASE_URL,
    required_contract: rollbackReadiness.required_contract ?? null,
    pro_route_ia_acceptance_checks: rollbackReadiness.pro_route_ia_acceptance_checks ?? [],
    pro_screen_model_acceptance: rollbackReadiness.pro_screen_model_acceptance ?? null,
    local_live_equivalence: rollbackReadiness.local_live_equivalence ?? null,
    rollback_plan: rollbackReadiness.rollback_plan ?? null,
    rollback_steps: rollbackReadiness.rollback_steps ?? [],
    rollback_readiness_checks: rollbackReadiness.rollback_readiness_checks ?? [],
    explicit_owner_approval: rollbackReadiness.explicit_owner_approval ?? null,
    requested_actions: rollbackReadiness.requested_actions ?? [],
    execution_sequence: rollbackReadiness.execution_sequence ?? [],
    external_execution_summary: rollbackReadiness.external_execution_summary ?? null,
    post_runtime_smoke_rows: rollbackReadiness.post_runtime_smoke_rows ?? [],
    route_patch_applied: rollbackReadiness.route_patch_applied ?? false,
    redirect_delete_executed: rollbackReadiness.redirect_delete_executed ?? false,
    deploy_executed: rollbackReadiness.deploy_executed ?? false,
    public_files_modified: rollbackReadiness.public_files_modified ?? false,
    redirect_config_changed: rollbackReadiness.redirect_config_changed ?? false,
    delete_paths: rollbackReadiness.delete_paths ?? [],
    post_runtime_smoke_executed: true,
    rollback_ready: true,
    rollback_applied: false,
    owner_closeout_accepted: true,
    additional_runtime_required: false,
    execution_performed_outside_this_command: true,
    execution_performed_by_this_command: false,
    smoke_performed_outside_this_command: true,
    smoke_performed_by_this_command: false,
    rollback_performed_by_this_command: false,
    closeout_performed_by_this_command: false,
    local_files_modified_by_this_command: false,
    redirect_config_changed_by_this_command: false,
    delete_performed_by_this_command: false,
    deploy_performed_by_this_command: false,
    public_files_modified_by_this_command: false,
    blocked_actions: ["additional_runtime", "rollback_execution"],
    next_required_runtime_gate: "none_record_chain_closed",
    notes: "Fresh owner closeout record only; this command does not execute closeout, apply rollback, run smoke, patch routes, redirect/delete, deploy, or mutate public files.",
  };
}

function validateRank2FreshOwnerOwnerCloseoutRecord(record, template, packet) {
  const errors = [];
  if (!record) return errors;
  if (packet.rank2_fresh_owner_rollback_readiness_record_status !== "valid_fresh_owner_rollback_readiness_recorded_pending_closeout") {
    return ["rank2 fresh owner owner closeout requires a valid rollback readiness record first"];
  }
  if (!template) return ["rank2 fresh owner owner closeout template is missing"];
  if (record.schema_version !== template.schema_version) {
    errors.push(`rank2 fresh owner owner closeout schema_version mismatch: ${record.schema_version}`);
  }
  if (
    record.contract_id !== template.contract_id
    || record.candidate_family_id !== template.candidate_family_id
    || record.owner_route !== template.owner_route
    || record.compatibility_route !== template.compatibility_route
  ) {
    errors.push("rank2 fresh owner owner closeout identity/contract mismatch");
  }
  if (record.fresh_owner_rollback_readiness_record_status !== "valid_fresh_owner_rollback_readiness_recorded_pending_closeout") {
    errors.push(`rank2 fresh owner owner closeout rollback readiness status mismatch: ${record.fresh_owner_rollback_readiness_record_status}`);
  }
  if (record.owner_closeout_status !== "recorded_fresh_owner_owner_closeout") {
    errors.push(`rank2 fresh owner owner closeout status mismatch: ${record.owner_closeout_status}`);
  }
  if (record.closeout_scope !== "record_only_owner_closeout_no_additional_runtime") {
    errors.push(`rank2 fresh owner owner closeout scope mismatch: ${record.closeout_scope}`);
  }
  if (typeof record.closed_by !== "string" || record.closed_by.trim().length === 0) {
    errors.push("rank2 fresh owner owner closeout closed_by is required");
  }
  if (!isIso8601Timestamp(record.closed_at)) {
    errors.push(`rank2 fresh owner owner closeout closed_at must be a full ISO-8601 timestamp with timezone: ${record.closed_at}`);
  }
  if (record.smoke_base_url !== template.smoke_base_url) {
    errors.push(`rank2 fresh owner owner closeout base URL mismatch: ${record.smoke_base_url}`);
  }
  if (JSON.stringify(record.required_contract) !== JSON.stringify(template.required_contract)) {
    errors.push("rank2 fresh owner owner closeout required_contract mismatch");
  }
  if (JSON.stringify(record.pro_route_ia_acceptance_checks) !== JSON.stringify(template.pro_route_ia_acceptance_checks)
    || record.pro_route_ia_acceptance_checks?.some((check) => check.status !== "pass")) {
    errors.push("rank2 fresh owner owner closeout PRO route/IA checks mismatch");
  }
  if (JSON.stringify(record.pro_screen_model_acceptance) !== JSON.stringify(template.pro_screen_model_acceptance)
    || record.pro_screen_model_acceptance?.acceptance_ready !== true) {
    errors.push("rank2 fresh owner owner closeout PRO screen-model acceptance mismatch");
  }
  if (JSON.stringify(record.local_live_equivalence) !== JSON.stringify(template.local_live_equivalence)
    || record.local_live_equivalence?.proof_status !== "local_runtime_smoke_passed") {
    errors.push("rank2 fresh owner owner closeout local live-equivalence mismatch");
  }
  if (JSON.stringify(record.rollback_plan) !== JSON.stringify(template.rollback_plan)
    || record.rollback_plan?.rollback_scope !== "plan_only_no_execution"
    || record.rollback_plan?.rollback_applied !== false) {
    errors.push("rank2 fresh owner owner closeout rollback plan mismatch");
  }
  if (JSON.stringify(record.rollback_steps) !== JSON.stringify(template.rollback_steps)
    || JSON.stringify(record.rollback_readiness_checks) !== JSON.stringify(template.rollback_readiness_checks)) {
    errors.push("rank2 fresh owner owner closeout rollback readiness evidence mismatch");
  }
  if (record.rollback_readiness_checks?.some((check) => check.rollback_ready !== true || check.rollback_applied !== false)) {
    errors.push("rank2 fresh owner owner closeout rollback readiness checks must stay ready/unapplied");
  }
  if (JSON.stringify(record.explicit_owner_approval) !== JSON.stringify(template.explicit_owner_approval)
    || record.explicit_owner_approval?.execution_by_this_command_allowed !== false) {
    errors.push("rank2 fresh owner owner closeout explicit owner approval mismatch");
  }
  if (JSON.stringify(record.requested_actions) !== JSON.stringify(template.requested_actions)
    || JSON.stringify(record.execution_sequence) !== JSON.stringify(template.execution_sequence)
    || JSON.stringify(record.external_execution_summary) !== JSON.stringify(template.external_execution_summary)
    || JSON.stringify(record.post_runtime_smoke_rows) !== JSON.stringify(template.post_runtime_smoke_rows)) {
    errors.push("rank2 fresh owner owner closeout prior evidence mismatch");
  }
  if (
    record.route_patch_applied !== template.route_patch_applied
    || record.redirect_delete_executed !== template.redirect_delete_executed
    || record.deploy_executed !== template.deploy_executed
    || record.public_files_modified !== template.public_files_modified
    || record.redirect_config_changed !== template.redirect_config_changed
    || JSON.stringify(record.delete_paths) !== JSON.stringify(template.delete_paths)
  ) {
    errors.push("rank2 fresh owner owner closeout must preserve rollback readiness evidence fields");
  }
  if (
    record.post_runtime_smoke_executed !== true
    || record.rollback_ready !== true
    || record.rollback_applied !== false
    || record.owner_closeout_accepted !== true
    || record.additional_runtime_required !== false
  ) {
    errors.push("rank2 fresh owner owner closeout must record completed evidence, rollback readiness, and closeout acceptance");
  }
  if (
    record.execution_performed_outside_this_command !== true
    || record.execution_performed_by_this_command !== false
    || record.smoke_performed_outside_this_command !== true
    || record.smoke_performed_by_this_command !== false
    || record.rollback_performed_by_this_command !== false
    || record.closeout_performed_by_this_command !== false
    || record.local_files_modified_by_this_command !== false
    || record.redirect_config_changed_by_this_command !== false
    || record.delete_performed_by_this_command !== false
    || record.deploy_performed_by_this_command !== false
    || record.public_files_modified_by_this_command !== false
  ) {
    errors.push("rank2 fresh owner owner closeout must keep closeout-only by-this-command flags false");
  }
  if (JSON.stringify(record.blocked_actions) !== JSON.stringify(template.blocked_actions)) {
    errors.push("rank2 fresh owner owner closeout blocked actions mismatch");
  }
  if (record.next_required_runtime_gate !== "none_record_chain_closed") {
    errors.push(`rank2 fresh owner owner closeout next_required_runtime_gate mismatch: ${record.next_required_runtime_gate}`);
  }
  return errors;
}

function rank2ExecutionReadiness(packet) {
  const routeDiffProposalRecorded = packet.rank2_route_diff_proposal_record_status === "valid_no_mutation_route_diff_proposal_recorded";
  const rollbackPlanRecorded = packet.rank2_rollback_plan_record_status === "valid_no_mutation_rollback_plan_recorded";
  const localPostPatchSmokePlanned = packet.rank2_local_post_patch_smoke_plan_record_status === "valid_no_mutation_local_post_patch_smoke_plan_recorded";
  const explicitDeployApprovalRecorded = packet.rank2_explicit_deploy_approval_record_status === "valid_explicit_deploy_approval_recorded_no_runtime";
  const prerequisites = [
    {
      id: "rank2_mutation_approval_record",
      status: packet.rank2_mutation_approval_record_status,
      required_status: "valid_owner_approved_no_execution",
      satisfied: packet.rank2_mutation_approval_record_status === "valid_owner_approved_no_execution",
    },
    {
      id: "route_file_diff_proposal",
      status: packet.rank2_route_diff_proposal_record_status,
      required_status: "valid_no_mutation_route_diff_proposal_recorded",
      satisfied: routeDiffProposalRecorded,
    },
    {
      id: "rollback_plan",
      status: packet.rank2_rollback_plan_record_status,
      required_status: "valid_no_mutation_rollback_plan_recorded",
      satisfied: rollbackPlanRecorded,
    },
    {
      id: "local_post_patch_smoke_plan",
      status: packet.rank2_local_post_patch_smoke_plan_record_status,
      required_status: "valid_no_mutation_local_post_patch_smoke_plan_recorded",
      satisfied: localPostPatchSmokePlanned,
    },
    {
      id: "explicit_deploy_approval",
      status: packet.rank2_explicit_deploy_approval_record_status,
      required_status: "valid_explicit_deploy_approval_recorded_no_runtime",
      satisfied: explicitDeployApprovalRecorded,
    },
  ];
  const missingPrerequisites = prerequisites.filter((item) => !item.satisfied);
  return {
    schema_version: "rank2-execution-readiness/v0.1",
    candidate_family_id: packet.next_queue_candidate_after_owner_decision?.family_id ?? null,
    status: missingPrerequisites.length === 0
      ? "all_prerequisites_recorded_no_runtime"
      : "blocked_pending_execution_prerequisites",
    ready_for_execution: false,
    rank2_active: false,
    mutation: "none",
    mutation_allowed: false,
    execution_allowed: false,
    deploy_allowed: false,
    blocked_actions: routePatchBlockedActions(),
    prerequisites,
    missing_prerequisites: missingPrerequisites.map((item) => item.id),
    next_allowed_action: missingPrerequisites.length === 0
      ? "prepare a separate route execution packet; do not mutate, deploy, or run live smoke"
      : "prepare route/file diff proposal, rollback plan, local smoke plan, and explicit deploy approval record; do not mutate",
  };
}

function buildDecisionPacket(
  inventory,
  liveProof,
  decisionRecord,
  decisionFollowupRecord,
  rank2PreActivationRecord,
  rank2OwnerDecisionRecord,
  rank2OwnerFollowupRecord,
  rank2MutationApprovalRecord,
  rank2RouteDiffProposalRecord,
  rank2RollbackPlanRecord,
  rank2LocalPostPatchSmokePlanRecord,
  rank2ExplicitDeployApprovalRecord,
  rank2RouteExecutionPacketRecord,
  rank2OwnerRuntimeReleaseRecord,
  rank2RoutePatchApplicationRecord,
  rank2LocalPostPatchSmokeRecord,
  rank2DeployExecutionRecord,
  rank2ProductionLiveSmokeRecord,
  rank2PostLiveRedirectDeleteApprovalRequestRecord,
  rank2PostLiveRedirectDeleteApprovalRecord,
  rank2PostLiveRedirectDeleteExecutionPacketRecord,
  rank2PostLiveRedirectDeleteExecutionRecord,
  rank2PostLiveRedirectDeletePostExecutionSmokeRecord,
  rank2PostLiveRedirectDeleteRollbackReadinessRecord,
  rank2PostLiveRedirectDeleteOwnerCloseoutRecord,
  rank2FreshOwnerRuntimePacketRecord,
  rank2FreshOwnerRuntimeExecutionPacketRecord,
  rank2FreshOwnerExternalRuntimeExecutionEvidenceRecord,
  rank2FreshOwnerPostRuntimeSmokeEvidenceRecord,
  rank2FreshOwnerRollbackReadinessRecord,
  rank2FreshOwnerOwnerCloseoutRecord,
) {
  const review = inventory.macro_monitor_rank1_owner_review;
  const nextCandidate = review.next_queue_candidate_after_owner_decision;
  const smokeRows = ownerDecisionLiveEquivalenceRows(liveProof);

  const followupPlans = decisionFollowupPlans(review, liveProof, nextCandidate);
  const proRouteIaAcceptanceChecks = ownerDecisionProRouteIaAcceptanceChecks(review, liveProof);
  const inactivePreview = inactiveNextCandidatePreview(inventory, review);
  const rank2PreActivationEvidenceDetailSurface = inactivePreview?.live_equivalence_prep?.required_evidence_detail_surface
    ?? inactivePreview?.live_equivalence_prep?.record_template?.required_evidence_detail_surface
    ?? null;
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
    decision_options: ownerDecisionOptions(),
    evidence: {
      canonical_root_inventory_ok: inventory.ok,
      pro_screen_model_acceptance_ready: Boolean(review.pro_screen_model_acceptance?.acceptance_ready),
      local_live_equivalence_base_url: liveProof.base_url,
      local_live_equivalence_proof_status: liveProof.proof_status,
      local_live_equivalence_rows_checked: liveProof.rows_checked,
      local_live_equivalence_rows_expected: liveProof.expected_rows,
      smoke_rows: smokeRows,
      home_dashboard_legacy_bridge_entrypoints: review.public_home_legacy_bridge_entrypoint_count,
      home_dashboard_legacy_bridge_entrypoint_rows: ownerDecisionHomeDashboardEntrypoints(review),
      src_legacy_references: review.src_legacy_reference_count,
      src_legacy_reference_rows: ownerDecisionSourceLegacyReferences(review),
    },
    release_blockers: ownerDecisionReleaseBlockers(),
    decision_record_template: decisionRecordTemplate(review, liveProof, followupPlans, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    supplied_decision_record: decisionRecord,
    supplied_decision_followup_record: decisionFollowupRecord,
    decision_followup_record_status: decisionFollowupRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_pre_activation_record: rank2PreActivationRecord,
    rank2_pre_activation_record_status: rank2PreActivationRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_owner_decision_record: rank2OwnerDecisionRecord,
    rank2_owner_decision_record_status: rank2OwnerDecisionRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_owner_followup_record: rank2OwnerFollowupRecord,
    rank2_owner_followup_record_status: rank2OwnerFollowupRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_mutation_approval_record: rank2MutationApprovalRecord,
    rank2_mutation_approval_record_status: rank2MutationApprovalRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_route_diff_proposal_record: rank2RouteDiffProposalRecord,
    rank2_route_diff_proposal_record_status: rank2RouteDiffProposalRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_rollback_plan_record: rank2RollbackPlanRecord,
    rank2_rollback_plan_record_status: rank2RollbackPlanRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_local_post_patch_smoke_plan_record: rank2LocalPostPatchSmokePlanRecord,
    rank2_local_post_patch_smoke_plan_record_status: rank2LocalPostPatchSmokePlanRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_explicit_deploy_approval_record: rank2ExplicitDeployApprovalRecord,
    rank2_explicit_deploy_approval_record_status: rank2ExplicitDeployApprovalRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_route_execution_packet_record: rank2RouteExecutionPacketRecord,
    rank2_route_execution_packet_record_status: rank2RouteExecutionPacketRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_owner_runtime_release_record: rank2OwnerRuntimeReleaseRecord,
    rank2_owner_runtime_release_record_status: rank2OwnerRuntimeReleaseRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_route_patch_application_record: rank2RoutePatchApplicationRecord,
    rank2_route_patch_application_record_status: rank2RoutePatchApplicationRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_local_post_patch_smoke_record: rank2LocalPostPatchSmokeRecord,
    rank2_local_post_patch_smoke_record_status: rank2LocalPostPatchSmokeRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_deploy_execution_record: rank2DeployExecutionRecord,
    rank2_deploy_execution_record_status: rank2DeployExecutionRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_production_live_smoke_record: rank2ProductionLiveSmokeRecord,
    rank2_production_live_smoke_record_status: rank2ProductionLiveSmokeRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_post_live_redirect_delete_approval_request_record: rank2PostLiveRedirectDeleteApprovalRequestRecord,
    rank2_post_live_redirect_delete_approval_request_record_status: rank2PostLiveRedirectDeleteApprovalRequestRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_post_live_redirect_delete_approval_record: rank2PostLiveRedirectDeleteApprovalRecord,
    rank2_post_live_redirect_delete_approval_record_status: rank2PostLiveRedirectDeleteApprovalRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_post_live_redirect_delete_execution_packet_record: rank2PostLiveRedirectDeleteExecutionPacketRecord,
    rank2_post_live_redirect_delete_execution_packet_record_status: rank2PostLiveRedirectDeleteExecutionPacketRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_post_live_redirect_delete_execution_record: rank2PostLiveRedirectDeleteExecutionRecord,
    rank2_post_live_redirect_delete_execution_record_status: rank2PostLiveRedirectDeleteExecutionRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_post_live_redirect_delete_post_execution_smoke_record: rank2PostLiveRedirectDeletePostExecutionSmokeRecord,
    rank2_post_live_redirect_delete_post_execution_smoke_record_status: rank2PostLiveRedirectDeletePostExecutionSmokeRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_post_live_redirect_delete_rollback_readiness_record: rank2PostLiveRedirectDeleteRollbackReadinessRecord,
    rank2_post_live_redirect_delete_rollback_readiness_record_status: rank2PostLiveRedirectDeleteRollbackReadinessRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_post_live_redirect_delete_owner_closeout_record: rank2PostLiveRedirectDeleteOwnerCloseoutRecord,
    rank2_post_live_redirect_delete_owner_closeout_record_status: rank2PostLiveRedirectDeleteOwnerCloseoutRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_fresh_owner_runtime_packet_record: rank2FreshOwnerRuntimePacketRecord,
    rank2_fresh_owner_runtime_packet_record_status: rank2FreshOwnerRuntimePacketRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_fresh_owner_runtime_execution_packet_record: rank2FreshOwnerRuntimeExecutionPacketRecord,
    rank2_fresh_owner_runtime_execution_packet_record_status: rank2FreshOwnerRuntimeExecutionPacketRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_fresh_owner_external_runtime_execution_evidence_record: rank2FreshOwnerExternalRuntimeExecutionEvidenceRecord,
    rank2_fresh_owner_external_runtime_execution_evidence_record_status: rank2FreshOwnerExternalRuntimeExecutionEvidenceRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_fresh_owner_post_runtime_smoke_evidence_record: rank2FreshOwnerPostRuntimeSmokeEvidenceRecord,
    rank2_fresh_owner_post_runtime_smoke_evidence_record_status: rank2FreshOwnerPostRuntimeSmokeEvidenceRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_fresh_owner_rollback_readiness_record: rank2FreshOwnerRollbackReadinessRecord,
    rank2_fresh_owner_rollback_readiness_record_status: rank2FreshOwnerRollbackReadinessRecord ? "provided_pending_validation" : "not_supplied",
    supplied_rank2_fresh_owner_owner_closeout_record: rank2FreshOwnerOwnerCloseoutRecord,
    rank2_fresh_owner_owner_closeout_record_status: rank2FreshOwnerOwnerCloseoutRecord ? "provided_pending_validation" : "not_supplied",
    next_gated_slice: nextGatedSlice(review, liveProof, nextCandidate, followupPlans, rank2PreActivationEvidenceDetailSurface),
    next_owner_action: nextOwnerAction(review, liveProof, nextCandidate, followupPlans, rank2PreActivationEvidenceDetailSurface),
    owner_decision_acceptance_contract: ownerDecisionAcceptanceContract(review, liveProof, followupPlans, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    current_next_required_gate: null,
    safe_enforcement_slices: safeEnforcementSlices(review, liveProof, nextCandidate, rank2PreActivationEvidenceDetailSurface),
    decision_followup_plans: followupPlans,
    decision_followup_record_templates: followupPlans.map((plan) => decisionFollowupRecordTemplate(plan, proRouteIaAcceptanceChecks)),
    selected_decision_followup: null,
    inactive_next_candidate_preview: inactivePreview,
    rank2_review_readiness: null,
    rank2_owner_review_template: null,
    rank2_owner_followup_plans: [],
    rank2_owner_followup_record_templates: [],
    selected_rank2_owner_followup: null,
    rank2_mutation_approval_readiness: null,
    rank2_mutation_approval_request_template: null,
    rank2_mutation_approval_record_template: null,
    rank2_route_diff_proposal_template: null,
    rank2_rollback_plan_template: null,
    rank2_local_post_patch_smoke_plan_template: null,
    rank2_explicit_deploy_approval_template: null,
    rank2_route_execution_packet_template: null,
    rank2_owner_runtime_release_template: null,
    rank2_route_patch_application_template: null,
    rank2_local_post_patch_smoke_record_template: null,
    rank2_deploy_execution_template: null,
    rank2_production_live_smoke_template: null,
    rank2_post_live_redirect_delete_approval_request_template: null,
    rank2_post_live_redirect_delete_approval_record_template: null,
    rank2_post_live_redirect_delete_execution_packet_template: null,
    rank2_post_live_redirect_delete_execution_record_template: null,
    rank2_post_live_redirect_delete_post_execution_smoke_template: null,
    rank2_post_live_redirect_delete_rollback_readiness_template: null,
    rank2_post_live_redirect_delete_owner_closeout_template: null,
    rank2_fresh_owner_runtime_packet_template: null,
    rank2_fresh_owner_runtime_execution_packet_template: null,
    rank2_fresh_owner_external_runtime_execution_evidence_template: null,
    rank2_fresh_owner_post_runtime_smoke_evidence_template: null,
    rank2_fresh_owner_rollback_readiness_template: null,
    rank2_fresh_owner_owner_closeout_template: null,
    rank2_execution_readiness: null,
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
  if (!Array.isArray(packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows)
    || packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows.length !== packet.evidence.home_dashboard_legacy_bridge_entrypoints) {
    errors.push("Home/dashboard legacy bridge entrypoint evidence rows must match the packet count");
  }
  if (packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows?.some((row) => row.class !== "home_dashboard_legacy_bridge_entrypoint")) {
    errors.push("Home/dashboard legacy bridge entrypoint evidence rows must stay scoped to dashboard entrypoints");
  }
  if (!Array.isArray(packet.evidence.src_legacy_reference_rows)
    || packet.evidence.src_legacy_reference_rows.length !== packet.evidence.src_legacy_references) {
    errors.push("source legacy reference evidence rows must match the packet count");
  }
  if (!packet.evidence.src_legacy_reference_rows?.some((row) => row.class === "home_dashboard_legacy_bridge_entrypoint")) {
    errors.push("source legacy reference evidence rows must include Home/dashboard entrypoints");
  }
  if (!packet.evidence.src_legacy_reference_rows?.some((row) => row.class === "compatibility_bridge_route")) {
    errors.push("source legacy reference evidence rows must include the compatibility bridge route");
  }
  if (!packet.next_queue_candidate_after_owner_decision) {
    errors.push("next queue candidate must stay visible after owner decision");
  }
  if (JSON.stringify(packet.decision_options) !== JSON.stringify(ownerDecisionOptions())) {
    errors.push("decision options must match the canonical owner decision semantics");
  }
  if (JSON.stringify(packet.release_blockers) !== JSON.stringify(ownerDecisionReleaseBlockers())) {
    errors.push("release blockers must match the canonical owner decision blockers");
  }
  const decisionFollowupPlanContract = ownerDecisionFollowupPlanContract(packet.decision_followup_plans);
  const decisionFollowupSelectionContract = ownerDecisionFollowupSelectionContract(packet.decision_followup_plans);
  const reportingSummaryAckContract = ownerDecisionReportingSummaryAcknowledgement();
  const safeEnforcementSliceAckContract = ownerDecisionSafeEnforcementSliceAcknowledgementForPacket(packet);
  const ownerEvidenceDetailSurface = ownerDecisionEvidenceDetailRequirementsFromRecord(packet.decision_record_template);
  if (packet.decision_record_template?.schema_version !== "macro-owner-decision-record/v0.1") {
    errors.push(`decision record template schema mismatch: ${packet.decision_record_template?.schema_version}`);
  }
  if (packet.decision_record_template?.family_id !== packet.family_id) {
    errors.push(`decision record template family mismatch: ${packet.decision_record_template?.family_id}`);
  }
  if (packet.decision_record_template?.owner_route !== packet.owner_route
    || packet.decision_record_template?.compatibility_route !== packet.compatibility_route) {
    errors.push("decision record template route identity mismatch");
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
  if (JSON.stringify(packet.decision_record_template?.local_live_equivalence_rows) !== JSON.stringify(packet.evidence.smoke_rows)) {
    errors.push("decision record template live-equivalence rows must match packet proof");
  }
  if (JSON.stringify(packet.decision_record_template?.home_dashboard_legacy_bridge_entrypoints) !== JSON.stringify(packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows)) {
    errors.push("decision record template Home/dashboard entrypoints must match packet evidence");
  }
  if (JSON.stringify(packet.decision_record_template?.src_legacy_reference_rows) !== JSON.stringify(packet.evidence.src_legacy_reference_rows)) {
    errors.push("decision record template source legacy references must match packet evidence");
  }
  if (JSON.stringify(packet.decision_record_template?.decision_options) !== JSON.stringify(packet.decision_options)) {
    errors.push("decision record template options must match packet decision options");
  }
  if (JSON.stringify(packet.decision_record_template?.release_blockers_acknowledged) !== JSON.stringify(packet.release_blockers)) {
    errors.push("decision record template release blockers must match packet release blockers");
  }
  if (JSON.stringify(packet.decision_record_template?.decision_followup_plans) !== JSON.stringify(decisionFollowupPlanContract)) {
    errors.push("decision record template follow-up plans must match packet follow-up plan contract");
  }
  if (JSON.stringify(packet.decision_record_template?.decision_followup_selection_contract) !== JSON.stringify(decisionFollowupSelectionContract)) {
    errors.push("decision record template follow-up selection contract must match packet follow-up selection contract");
  }
  if (JSON.stringify(packet.decision_record_template?.reporting_summary_acknowledgement) !== JSON.stringify(reportingSummaryAckContract)) {
    errors.push("decision record template reporting summary acknowledgement must match the canonical contract");
  }
  if (JSON.stringify(packet.decision_record_template?.safe_enforcement_slice_acknowledgement) !== JSON.stringify(safeEnforcementSliceAckContract)) {
    errors.push("decision record template safe enforcement slice acknowledgement must match the canonical contract");
  }
  if (packet.decision_record_template?.mutation_approved !== false) {
    errors.push("decision record template must keep mutation_approved=false");
  }
  if (packet.decision_record_template?.execution_allowed !== false) {
    errors.push("decision record template must keep execution_allowed=false");
  }
  if (packet.decision_record_template?.execution_by_this_command_allowed !== false) {
    errors.push("decision record template must keep execution_by_this_command_allowed=false");
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
  const nextSlice = packet.next_gated_slice;
  const nextSliceAcceptance = nextSlice?.required_pro_screen_model_acceptance;
  if (JSON.stringify(nextSlice?.required_local_live_equivalence_rows) !== JSON.stringify(packet.evidence.smoke_rows)) {
    errors.push("next gated slice live-equivalence rows must match packet proof");
  }
  if (JSON.stringify(nextSlice?.required_home_dashboard_legacy_bridge_entrypoints) !== JSON.stringify(packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows)) {
    errors.push("next gated slice Home/dashboard entrypoints must match packet evidence");
  }
  if (JSON.stringify(nextSlice?.required_src_legacy_reference_rows) !== JSON.stringify(packet.evidence.src_legacy_reference_rows)) {
    errors.push("next gated slice source legacy references must match packet evidence");
  }
  if (JSON.stringify(nextSlice?.required_evidence_detail_surface) !== JSON.stringify(ownerEvidenceDetailSurface)) {
    errors.push("next gated slice evidence detail surface must match decision record template");
  }
  if (JSON.stringify(nextSlice?.required_decision_options) !== JSON.stringify(packet.decision_options)) {
    errors.push("next gated slice options must match packet decision options");
  }
  if (JSON.stringify(nextSlice?.required_release_blockers_acknowledged) !== JSON.stringify(packet.release_blockers)) {
    errors.push("next gated slice release blockers must match packet release blockers");
  }
  if (JSON.stringify(nextSlice?.required_decision_followup_plans) !== JSON.stringify(decisionFollowupPlanContract)) {
    errors.push("next gated slice follow-up plans must match packet follow-up plan contract");
  }
  if (JSON.stringify(nextSlice?.required_decision_followup_selection_contract) !== JSON.stringify(decisionFollowupSelectionContract)) {
    errors.push("next gated slice follow-up selection contract must match packet follow-up selection contract");
  }
  if (JSON.stringify(nextSlice?.required_reporting_summary_acknowledgement) !== JSON.stringify(reportingSummaryAckContract)) {
    errors.push("next gated slice reporting summary acknowledgement must match the canonical contract");
  }
  if (JSON.stringify(nextSlice?.required_safe_enforcement_slice_acknowledgement) !== JSON.stringify(safeEnforcementSliceAckContract)) {
    errors.push("next gated slice safe enforcement slice acknowledgement must match the canonical contract");
  }
  if (nextSlice?.required_execution_by_this_command_allowed !== false) {
    errors.push("next gated slice must keep execution by this command disallowed");
  }
  if (nextSlice?.required_execution_allowed !== false) {
    errors.push("next gated slice must keep execution disallowed");
  }
  if (nextSlice?.required_owner_route !== packet.owner_route
    || nextSlice?.required_compatibility_route !== packet.compatibility_route) {
    errors.push("next gated slice route identity mismatch");
  }
  if (nextSliceAcceptance?.acceptance_ready !== true) {
    errors.push("next gated slice requires ready PRO screen-model acceptance");
  }
  if (nextSliceAcceptance?.owner_route !== packet.owner_route
    || nextSliceAcceptance?.compatibility_route !== packet.compatibility_route) {
    errors.push("next gated slice PRO acceptance route identity mismatch");
  }
  if (nextSliceAcceptance?.home_primary_allowed !== false || nextSliceAcceptance?.mobile_primary_allowed !== false) {
    errors.push("next gated slice must keep legacy HTML out of Home/mobile primary IA");
  }
  if (!Array.isArray(nextSlice?.required_blocked_actions)
    || !nextSlice.required_blocked_actions.includes("rank_2_release")
    || !nextSlice.required_blocked_actions.includes("public_file_mutation")
    || !nextSlice.required_blocked_actions.includes("redirect")
    || !nextSlice.required_blocked_actions.includes("delete")
    || !nextSlice.required_blocked_actions.includes("deploy")) {
    errors.push("next gated slice must keep rank-2 release and public mutation blocked");
  }
  if (packet.next_owner_action?.gate !== packet.next_gated_slice?.id) {
    errors.push(`next owner action gate mismatch: ${packet.next_owner_action?.gate}`);
  }
  if (packet.next_owner_action?.mutation !== "none" || packet.next_owner_action?.mutation_allowed !== false) {
    errors.push("next owner action must be no-mutation");
  }
  if (packet.next_owner_action?.owner_record_required !== true) {
    errors.push("next owner action must require owner record");
  }
  if (packet.next_owner_action?.required_record_schema !== packet.next_gated_slice?.required_record_schema) {
    errors.push("next owner action must point at the current owner decision record schema");
  }
  if (packet.next_owner_action?.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --decision-record-template") {
    errors.push(`next owner action template command mismatch: ${packet.next_owner_action?.template_command}`);
  }
  if (packet.next_owner_action?.required_local_live_equivalence?.base_url !== packet.evidence.local_live_equivalence_base_url) {
    errors.push("next owner action base URL must match packet proof");
  }
  if (packet.next_owner_action?.required_local_live_equivalence?.proof_status !== packet.evidence.local_live_equivalence_proof_status) {
    errors.push("next owner action proof status must match packet proof");
  }
  if (packet.next_owner_action?.required_local_live_equivalence?.rows_checked !== packet.evidence.local_live_equivalence_rows_checked) {
    errors.push("next owner action row count must match packet proof");
  }
  if (JSON.stringify(packet.next_owner_action?.required_local_live_equivalence?.rows) !== JSON.stringify(packet.evidence.smoke_rows)) {
    errors.push("next owner action live-equivalence rows must match packet proof");
  }
  if (JSON.stringify(packet.next_owner_action?.required_home_dashboard_legacy_bridge_entrypoints) !== JSON.stringify(packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows)) {
    errors.push("next owner action Home/dashboard entrypoints must match packet evidence");
  }
  if (JSON.stringify(packet.next_owner_action?.required_src_legacy_reference_rows) !== JSON.stringify(packet.evidence.src_legacy_reference_rows)) {
    errors.push("next owner action source legacy references must match packet evidence");
  }
  if (JSON.stringify(packet.next_owner_action?.required_evidence_detail_surface) !== JSON.stringify(ownerEvidenceDetailSurface)) {
    errors.push("next owner action evidence detail surface must match decision record template");
  }
  if (JSON.stringify(packet.next_owner_action?.required_decision_options) !== JSON.stringify(packet.decision_options)) {
    errors.push("next owner action options must match packet decision options");
  }
  if (JSON.stringify(packet.next_owner_action?.required_release_blockers_acknowledged) !== JSON.stringify(packet.release_blockers)) {
    errors.push("next owner action release blockers must match packet release blockers");
  }
  if (JSON.stringify(packet.next_owner_action?.required_decision_followup_plans) !== JSON.stringify(decisionFollowupPlanContract)) {
    errors.push("next owner action follow-up plans must match packet follow-up plan contract");
  }
  if (JSON.stringify(packet.next_owner_action?.required_decision_followup_selection_contract) !== JSON.stringify(decisionFollowupSelectionContract)) {
    errors.push("next owner action follow-up selection contract must match packet follow-up selection contract");
  }
  if (JSON.stringify(packet.next_owner_action?.required_reporting_summary_acknowledgement) !== JSON.stringify(reportingSummaryAckContract)) {
    errors.push("next owner action reporting summary acknowledgement must match the canonical contract");
  }
  if (JSON.stringify(packet.next_owner_action?.required_safe_enforcement_slice_acknowledgement) !== JSON.stringify(safeEnforcementSliceAckContract)) {
    errors.push("next owner action safe enforcement slice acknowledgement must match the canonical contract");
  }
  if (packet.next_owner_action?.required_execution_by_this_command_allowed !== false) {
    errors.push("next owner action must keep execution by this command disallowed");
  }
  if (packet.next_owner_action?.required_execution_allowed !== false) {
    errors.push("next owner action must keep execution disallowed");
  }
  if (!packet.next_owner_action?.blocked_actions?.includes("rank_2_release")
    || !packet.next_owner_action?.blocked_actions?.includes("redirect")
    || !packet.next_owner_action?.blocked_actions?.includes("delete")
    || !packet.next_owner_action?.blocked_actions?.includes("deploy")) {
    errors.push("next owner action must keep rank-2 release and redirect/delete/deploy blocked");
  }
  const ownerContract = packet.owner_decision_acceptance_contract;
  const ownerContractAcceptance = ownerContract?.required_pro_screen_model_acceptance;
  const ownerContractRouteIaChecks = ownerContract?.required_pro_route_ia_acceptance_checks ?? [];
  if (ownerContract?.gate !== packet.next_gated_slice?.id) {
    errors.push(`owner decision acceptance contract gate mismatch: ${ownerContract?.gate}`);
  }
  if (ownerContract?.mutation !== "none" || ownerContract?.mutation_allowed !== false) {
    errors.push("owner decision acceptance contract must be no-mutation");
  }
  if (ownerContract?.required_record_schema !== packet.next_gated_slice?.required_record_schema) {
    errors.push("owner decision acceptance contract must point at the current owner decision record schema");
  }
  if (ownerContract?.required_local_live_equivalence?.base_url !== packet.evidence.local_live_equivalence_base_url
    || ownerContract?.required_local_live_equivalence?.proof_status !== packet.evidence.local_live_equivalence_proof_status
    || ownerContract?.required_local_live_equivalence?.rows_checked !== packet.evidence.local_live_equivalence_rows_checked) {
    errors.push("owner decision acceptance contract local proof must match packet proof");
  }
  if (JSON.stringify(ownerContract?.required_local_live_equivalence?.rows) !== JSON.stringify(packet.evidence.smoke_rows)) {
    errors.push("owner decision acceptance contract live-equivalence rows must match packet proof");
  }
  if (JSON.stringify(ownerContract?.required_home_dashboard_legacy_bridge_entrypoints) !== JSON.stringify(packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows)) {
    errors.push("owner decision acceptance contract Home/dashboard entrypoints must match packet evidence");
  }
  if (JSON.stringify(ownerContract?.required_src_legacy_reference_rows) !== JSON.stringify(packet.evidence.src_legacy_reference_rows)) {
    errors.push("owner decision acceptance contract source legacy references must match packet evidence");
  }
  if (JSON.stringify(ownerContract?.required_evidence_detail_surface) !== JSON.stringify(ownerEvidenceDetailSurface)) {
    errors.push("owner decision acceptance contract evidence detail surface must match decision record template");
  }
  if (JSON.stringify(ownerContract?.required_decision_options) !== JSON.stringify(packet.decision_options)) {
    errors.push("owner decision acceptance contract options must match packet decision options");
  }
  if (JSON.stringify(ownerContract?.required_release_blockers_acknowledged) !== JSON.stringify(packet.release_blockers)) {
    errors.push("owner decision acceptance contract release blockers must match packet release blockers");
  }
  if (JSON.stringify(ownerContract?.required_decision_followup_plans) !== JSON.stringify(decisionFollowupPlanContract)) {
    errors.push("owner decision acceptance contract follow-up plans must match packet follow-up plan contract");
  }
  if (JSON.stringify(ownerContract?.required_decision_followup_selection_contract) !== JSON.stringify(decisionFollowupSelectionContract)) {
    errors.push("owner decision acceptance contract follow-up selection contract must match packet follow-up selection contract");
  }
  if (JSON.stringify(ownerContract?.required_reporting_summary_acknowledgement) !== JSON.stringify(reportingSummaryAckContract)) {
    errors.push("owner decision acceptance contract reporting summary acknowledgement must match the canonical contract");
  }
  if (JSON.stringify(ownerContract?.required_safe_enforcement_slice_acknowledgement) !== JSON.stringify(safeEnforcementSliceAckContract)) {
    errors.push("owner decision acceptance contract safe enforcement slice acknowledgement must match the canonical contract");
  }
  if (ownerContract?.required_execution_by_this_command_allowed !== false) {
    errors.push("owner decision acceptance contract must keep execution by this command disallowed");
  }
  if (ownerContract?.required_execution_allowed !== false) {
    errors.push("owner decision acceptance contract must keep execution disallowed");
  }
  if (JSON.stringify(nextSlice?.required_decision_followup_plans) !== JSON.stringify(ownerContract?.required_decision_followup_plans)) {
    errors.push("next gated slice and owner decision acceptance contract follow-up plans must match");
  }
  if (JSON.stringify(nextSlice?.required_decision_followup_selection_contract) !== JSON.stringify(ownerContract?.required_decision_followup_selection_contract)) {
    errors.push("next gated slice and owner decision acceptance contract follow-up selection contract must match");
  }
  if (JSON.stringify(nextSlice?.required_reporting_summary_acknowledgement) !== JSON.stringify(ownerContract?.required_reporting_summary_acknowledgement)) {
    errors.push("next gated slice and owner decision acceptance contract reporting summary acknowledgement must match");
  }
  if (JSON.stringify(nextSlice?.required_safe_enforcement_slice_acknowledgement) !== JSON.stringify(ownerContract?.required_safe_enforcement_slice_acknowledgement)) {
    errors.push("next gated slice and owner decision acceptance contract safe enforcement slice acknowledgement must match");
  }
  if (ownerContractAcceptance?.acceptance_ready !== true) {
    errors.push("owner decision acceptance contract requires ready PRO screen-model acceptance");
  }
  if (ownerContractAcceptance?.owner_route !== packet.owner_route
    || ownerContractAcceptance?.compatibility_route !== packet.compatibility_route) {
    errors.push("owner decision acceptance contract route identity mismatch");
  }
  if (!Array.isArray(ownerContractRouteIaChecks) || ownerContractRouteIaChecks.length === 0) {
    errors.push("owner decision acceptance contract must carry PRO route/IA acceptance checks");
  }
  if (ownerContractRouteIaChecks.some((check) => check.status !== "pass")) {
    errors.push("owner decision acceptance contract PRO route/IA acceptance checks must all pass");
  }
  if (JSON.stringify(packet.decision_record_template?.pro_route_ia_acceptance_checks) !== JSON.stringify(ownerContractRouteIaChecks)) {
    errors.push("decision record template PRO route/IA checks must match owner acceptance contract");
  }
  if (!packet.decision_followup_record_templates?.every((template) => JSON.stringify(template.required_evidence_detail_surface) === JSON.stringify(ownerEvidenceDetailSurface))) {
    errors.push("decision followup record templates evidence detail surfaces must match owner acceptance contract");
  }
  if (!packet.decision_followup_record_templates?.every((template) => JSON.stringify(template.pro_route_ia_acceptance_checks) === JSON.stringify(ownerContractRouteIaChecks))) {
    errors.push("decision followup record templates PRO route/IA checks must match owner acceptance contract");
  }
  if (packet.decision_followup_record_templates?.some((template) => !Array.isArray(template.pro_route_ia_acceptance_checks)
    || template.pro_route_ia_acceptance_checks.some((check) => check.status !== "pass"))) {
    errors.push("decision followup record templates PRO route/IA checks must all pass");
  }
  if (JSON.stringify(nextSlice?.required_pro_route_ia_acceptance_checks) !== JSON.stringify(ownerContractRouteIaChecks)) {
    errors.push("next gated slice PRO route/IA checks must match owner acceptance contract");
  }
  if (JSON.stringify(packet.next_owner_action?.required_pro_route_ia_acceptance_checks) !== JSON.stringify(ownerContractRouteIaChecks)) {
    errors.push("next owner action PRO route/IA checks must match owner acceptance contract");
  }
  if (ownerContractAcceptance?.home_primary_allowed !== false || ownerContractAcceptance?.mobile_primary_allowed !== false) {
    errors.push("owner decision acceptance contract must keep legacy HTML out of Home/mobile primary IA");
  }
  if (ownerContractAcceptance?.mutation_blocked_without_owner_decision !== true) {
    errors.push("owner decision acceptance contract must keep mutation blocked without owner decision");
  }
  if (!Array.isArray(ownerContractAcceptance?.screen_model_contract)
    || !ownerContractAcceptance.screen_model_contract.some((item) => item.includes("Home remains"))) {
    errors.push("owner decision acceptance contract must carry the PRO screen-model contract");
  }
  if (JSON.stringify(packet.decision_record_template?.pro_screen_model_acceptance) !== JSON.stringify(ownerContractAcceptance)) {
    errors.push("decision record template PRO screen-model acceptance must match owner acceptance contract");
  }
  if (JSON.stringify(nextSliceAcceptance) !== JSON.stringify(ownerContractAcceptance)) {
    errors.push("next gated slice PRO screen-model acceptance must match owner acceptance contract");
  }
  if (JSON.stringify(nextSlice?.required_local_live_equivalence_rows) !== JSON.stringify(ownerContract?.required_local_live_equivalence?.rows)) {
    errors.push("next gated slice live-equivalence rows must match owner acceptance contract");
  }
  if (JSON.stringify(nextSlice?.required_home_dashboard_legacy_bridge_entrypoints) !== JSON.stringify(ownerContract?.required_home_dashboard_legacy_bridge_entrypoints)) {
    errors.push("next gated slice Home/dashboard entrypoints must match owner acceptance contract");
  }
  if (JSON.stringify(nextSlice?.required_src_legacy_reference_rows) !== JSON.stringify(ownerContract?.required_src_legacy_reference_rows)) {
    errors.push("next gated slice source legacy references must match owner acceptance contract");
  }
  if (JSON.stringify(nextSlice?.required_decision_options) !== JSON.stringify(ownerContract?.required_decision_options)) {
    errors.push("next gated slice options must match owner acceptance contract");
  }
  if (JSON.stringify(nextSlice?.required_release_blockers_acknowledged) !== JSON.stringify(ownerContract?.required_release_blockers_acknowledged)) {
    errors.push("next gated slice release blockers must match owner acceptance contract");
  }
  if (JSON.stringify(nextSlice?.required_blocked_actions) !== JSON.stringify(ownerContract?.blocked_actions)) {
    errors.push("next gated slice blocked actions must match owner acceptance contract");
  }
  if (!Array.isArray(ownerContract?.blocked_actions)
    || !ownerContract.blocked_actions.includes("rank_2_release")
    || !ownerContract.blocked_actions.includes("public_file_mutation")
    || !ownerContract.blocked_actions.includes("redirect")
    || !ownerContract.blocked_actions.includes("delete")
    || !ownerContract.blocked_actions.includes("deploy")) {
    errors.push("owner decision acceptance contract must keep rank-2 release and public mutation blocked");
  }
  if (!Array.isArray(packet.safe_enforcement_slices) || packet.safe_enforcement_slices.length === 0) {
    errors.push("safe enforcement slices must be present");
  } else {
    const ownerDecisionSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "owner_decision_record_validation");
    const rank2PrepSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_pre_activation_local_smoke_prep");
    const rank2DecisionSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_owner_decision_record_validation");
    const rank2FollowupSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_owner_followup_record_validation");
    const rank2MutationRequestSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_mutation_approval_request_prep");
    const rank2MutationRecordSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_mutation_approval_record_validation");
    const rank2ExecutionReadinessSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_execution_readiness_prerequisite_map");
    const rank2RouteDiffProposalSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_route_diff_proposal_validation");
    const rank2RollbackPlanSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_rollback_plan_validation");
    const rank2LocalSmokePlanSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_local_post_patch_smoke_plan_validation");
    const rank2DeployApprovalSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_explicit_deploy_approval_record_validation");
    const rank2RouteExecutionPacketSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_route_execution_packet_validation");
    const rank2OwnerRuntimeReleaseSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_owner_runtime_release_record_validation");
    const rank2RoutePatchApplicationSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_route_patch_application_record_validation");
    const rank2LocalPostPatchSmokeRecordSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_local_post_patch_smoke_record_validation");
    const rank2DeployExecutionSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_deploy_execution_record_validation");
    const rank2ProductionLiveSmokeSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_production_live_smoke_record_validation");
    const rank2PostLiveRedirectDeleteApprovalRequestSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_approval_request_validation");
    const rank2PostLiveRedirectDeleteApprovalRecordSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_approval_record_validation");
    const rank2PostLiveRedirectDeleteExecutionPacketSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_execution_packet_validation");
    const rank2PostLiveRedirectDeleteExecutionRecordSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_execution_record_validation");
    const rank2PostLiveRedirectDeletePostExecutionSmokeSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_post_execution_smoke_record_validation");
    const rank2PostLiveRedirectDeleteRollbackReadinessSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_rollback_readiness_record_validation");
    const rank2PostLiveRedirectDeleteOwnerCloseoutSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_owner_closeout_record_validation");
    const rank2PostLiveRedirectDeleteFreshOwnerPacketSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_post_live_redirect_delete_fresh_owner_packet_required");
    const rank2FreshOwnerRuntimeExecutionPacketSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_fresh_owner_runtime_execution_packet_required");
    const rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_fresh_owner_external_runtime_execution_evidence_required");
    const rank2FreshOwnerPostRuntimeSmokeEvidenceSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_fresh_owner_post_runtime_smoke_evidence_required");
    const rank2FreshOwnerRollbackReadinessSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_fresh_owner_rollback_readiness_required");
    const rank2FreshOwnerOwnerCloseoutSlice = packet.safe_enforcement_slices.find((slice) => slice.id === "rank2_fresh_owner_owner_closeout_required");
    const ownerDecisionFollowupSlices = [
      ["preserve_bridge_documentation", "preserve"],
      ["remap_proposal_dry_run", "remap"],
      ["retire_readiness_packet", "retire"],
    ];
    for (const slice of packet.safe_enforcement_slices) {
      if (slice.mutation !== "none" || slice.mutation_allowed !== false) {
        errors.push(`safe enforcement slice must not authorize mutation: ${slice.id}`);
      }
      if (slice.owner_record_required !== true) {
        errors.push(`safe enforcement slice must require owner record: ${slice.id}`);
      }
    }
    if (!ownerDecisionSlice) {
      errors.push("safe enforcement slices must include owner_decision_record_validation");
    } else {
      if (JSON.stringify(ownerDecisionSlice.required_evidence_detail_surface) !== JSON.stringify(ownerEvidenceDetailSurface)) {
        errors.push("owner decision validation safe-slice evidence detail surface must match decision record template");
      }
      if (!Array.isArray(ownerDecisionSlice.acceptance) || !ownerDecisionSlice.acceptance.some((item) => item.includes("detailed live-equivalence"))) {
        errors.push("owner decision validation safe-slice must require detailed evidence surface validation");
      }
    }
    for (const [sliceId, decision] of ownerDecisionFollowupSlices) {
      const followupSlice = packet.safe_enforcement_slices.find((slice) => slice.id === sliceId);
      if (!followupSlice) {
        errors.push(`safe enforcement slices must include ${sliceId}`);
      } else {
        if (followupSlice.decision !== decision) {
          errors.push(`owner decision follow-up safe-slice decision mismatch: ${sliceId}`);
        }
        if (JSON.stringify(followupSlice.required_evidence_detail_surface) !== JSON.stringify(ownerEvidenceDetailSurface)) {
          errors.push(`owner decision follow-up safe-slice evidence detail surface must match decision record template: ${sliceId}`);
        }
        if (!Array.isArray(followupSlice.acceptance) || !followupSlice.acceptance.some((item) => item.includes("detailed live-equivalence"))) {
          errors.push(`owner decision follow-up safe-slice must require detailed evidence surface validation: ${sliceId}`);
        }
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
    if (!rank2DecisionSlice) {
      errors.push("safe enforcement slices must include rank2_owner_decision_record_validation");
    } else {
      if (rank2DecisionSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 owner decision slice candidate mismatch: ${rank2DecisionSlice.candidate_family_id}`);
      }
      if (rank2DecisionSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 owner decision slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2DecisionSlice.acceptance) || !rank2DecisionSlice.acceptance.some((item) => item.includes("rank-2 owner decision record"))) {
        errors.push("rank2 owner decision slice must require a rank-2 owner decision record");
      }
    }
    if (!rank2FollowupSlice) {
      errors.push("safe enforcement slices must include rank2_owner_followup_record_validation");
    } else {
      if (rank2FollowupSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 owner followup slice candidate mismatch: ${rank2FollowupSlice.candidate_family_id}`);
      }
      if (rank2FollowupSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 owner followup slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2FollowupSlice.acceptance) || !rank2FollowupSlice.acceptance.some((item) => item.includes("rank-2 owner follow-up record"))) {
        errors.push("rank2 owner followup slice must require a rank-2 owner follow-up record");
      }
    }
    if (!rank2MutationRequestSlice) {
      errors.push("safe enforcement slices must include rank2_mutation_approval_request_prep");
    } else {
      if (rank2MutationRequestSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 mutation request slice candidate mismatch: ${rank2MutationRequestSlice.candidate_family_id}`);
      }
      if (rank2MutationRequestSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 mutation request slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2MutationRequestSlice.acceptance) || !rank2MutationRequestSlice.acceptance.some((item) => item.includes("request_only=true"))) {
        errors.push("rank2 mutation request slice must require request-only/no-execution semantics");
      }
    }
    if (!rank2MutationRecordSlice) {
      errors.push("safe enforcement slices must include rank2_mutation_approval_record_validation");
    } else {
      if (rank2MutationRecordSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 mutation approval record slice candidate mismatch: ${rank2MutationRecordSlice.candidate_family_id}`);
      }
      if (rank2MutationRecordSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 mutation approval record slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2MutationRecordSlice.acceptance) || !rank2MutationRecordSlice.acceptance.some((item) => item.includes("execution_allowed=false"))) {
        errors.push("rank2 mutation approval record slice must require no-execution semantics");
      }
    }
    if (!rank2ExecutionReadinessSlice) {
      errors.push("safe enforcement slices must include rank2_execution_readiness_prerequisite_map");
    } else {
      if (rank2ExecutionReadinessSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 execution readiness slice candidate mismatch: ${rank2ExecutionReadinessSlice.candidate_family_id}`);
      }
      if (rank2ExecutionReadinessSlice.mutation_allowed !== false) {
        errors.push("rank2 execution readiness slice must not allow mutation");
      }
      if (!Array.isArray(rank2ExecutionReadinessSlice.acceptance) || !rank2ExecutionReadinessSlice.acceptance.some((item) => item.includes("execution_allowed=false"))) {
        errors.push("rank2 execution readiness slice must require no-execution semantics");
      }
    }
    if (!rank2RouteDiffProposalSlice) {
      errors.push("safe enforcement slices must include rank2_route_diff_proposal_validation");
    } else {
      if (rank2RouteDiffProposalSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 route diff proposal slice candidate mismatch: ${rank2RouteDiffProposalSlice.candidate_family_id}`);
      }
      if (rank2RouteDiffProposalSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 route diff proposal slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2RouteDiffProposalSlice.acceptance)
        || !rank2RouteDiffProposalSlice.acceptance.some((item) => item.includes("proposal_status=draft_no_mutation"))
        || !rank2RouteDiffProposalSlice.acceptance.some((item) => item.includes("patch_applied=false"))) {
        errors.push("rank2 route diff proposal slice must require draft/no-mutation semantics");
      }
    }
    if (!rank2RollbackPlanSlice) {
      errors.push("safe enforcement slices must include rank2_rollback_plan_validation");
    } else {
      if (rank2RollbackPlanSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 rollback plan slice candidate mismatch: ${rank2RollbackPlanSlice.candidate_family_id}`);
      }
      if (rank2RollbackPlanSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 rollback plan slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2RollbackPlanSlice.acceptance)
        || !rank2RollbackPlanSlice.acceptance.some((item) => item.includes("rollback_plan_status=recorded_no_mutation"))
        || !rank2RollbackPlanSlice.acceptance.some((item) => item.includes("rollback_applied=false"))) {
        errors.push("rank2 rollback plan slice must require no-rollback/no-mutation semantics");
      }
    }
    if (!rank2LocalSmokePlanSlice) {
      errors.push("safe enforcement slices must include rank2_local_post_patch_smoke_plan_validation");
    } else {
      if (rank2LocalSmokePlanSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 local post-patch smoke plan slice candidate mismatch: ${rank2LocalSmokePlanSlice.candidate_family_id}`);
      }
      if (rank2LocalSmokePlanSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 local post-patch smoke plan slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2LocalSmokePlanSlice.acceptance)
        || !rank2LocalSmokePlanSlice.acceptance.some((item) => item.includes("smoke_plan_status=planned_before_execution_no_runtime"))
        || !rank2LocalSmokePlanSlice.acceptance.some((item) => item.includes("smoke_executed=false"))) {
        errors.push("rank2 local post-patch smoke plan slice must require plan-only/no-runtime semantics");
      }
    }
    if (!rank2DeployApprovalSlice) {
      errors.push("safe enforcement slices must include rank2_explicit_deploy_approval_record_validation");
    } else {
      if (rank2DeployApprovalSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 explicit deploy approval slice candidate mismatch: ${rank2DeployApprovalSlice.candidate_family_id}`);
      }
      if (rank2DeployApprovalSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 explicit deploy approval slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2DeployApprovalSlice.acceptance)
        || !rank2DeployApprovalSlice.acceptance.some((item) => item.includes("approval_scope=record_only_no_deploy"))
        || !rank2DeployApprovalSlice.acceptance.some((item) => item.includes("deploy_executed=false"))) {
        errors.push("rank2 explicit deploy approval slice must require record-only/no-deploy semantics");
      }
    }
    if (!rank2RouteExecutionPacketSlice) {
      errors.push("safe enforcement slices must include rank2_route_execution_packet_validation");
    } else {
      if (rank2RouteExecutionPacketSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 route execution packet slice candidate mismatch: ${rank2RouteExecutionPacketSlice.candidate_family_id}`);
      }
      if (rank2RouteExecutionPacketSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 route execution packet slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2RouteExecutionPacketSlice.acceptance)
        || !rank2RouteExecutionPacketSlice.acceptance.some((item) => item.includes("execution_scope=record_only_no_runtime"))
        || !rank2RouteExecutionPacketSlice.acceptance.some((item) => item.includes("owner_runtime_release_status=not_recorded"))
        || !rank2RouteExecutionPacketSlice.acceptance.some((item) => item.includes("route_patch_applied=false"))) {
        errors.push("rank2 route execution packet slice must require record-only/no-runtime/no-route-patch semantics");
      }
    }
    if (!rank2OwnerRuntimeReleaseSlice) {
      errors.push("safe enforcement slices must include rank2_owner_runtime_release_record_validation");
    } else {
      if (rank2OwnerRuntimeReleaseSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 owner runtime release slice candidate mismatch: ${rank2OwnerRuntimeReleaseSlice.candidate_family_id}`);
      }
      if (rank2OwnerRuntimeReleaseSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 owner runtime release slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2OwnerRuntimeReleaseSlice.acceptance)
        || !rank2OwnerRuntimeReleaseSlice.acceptance.some((item) => item.includes("release_scope=record_only_before_runtime"))
        || !rank2OwnerRuntimeReleaseSlice.acceptance.some((item) => item.includes("runtime_release_recorded=true"))
        || !rank2OwnerRuntimeReleaseSlice.acceptance.some((item) => item.includes("route_patch_applied=false"))) {
        errors.push("rank2 owner runtime release slice must require record-only/no-runtime/no-route-patch semantics");
      }
    }
    if (!rank2RoutePatchApplicationSlice) {
      errors.push("safe enforcement slices must include rank2_route_patch_application_record_validation");
    } else {
      if (rank2RoutePatchApplicationSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 route patch application slice candidate mismatch: ${rank2RoutePatchApplicationSlice.candidate_family_id}`);
      }
      if (rank2RoutePatchApplicationSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 route patch application slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2RoutePatchApplicationSlice.acceptance)
        || !rank2RoutePatchApplicationSlice.acceptance.some((item) => item.includes("patch_scope=record_only_local_patch_no_smoke_no_deploy"))
        || !rank2RoutePatchApplicationSlice.acceptance.some((item) => item.includes("route_patch_applied=true"))
        || !rank2RoutePatchApplicationSlice.acceptance.some((item) => item.includes("deploy_executed=false"))) {
        errors.push("rank2 route patch application slice must require patch-record-only/no-smoke/no-deploy semantics");
      }
    }
    if (!rank2LocalPostPatchSmokeRecordSlice) {
      errors.push("safe enforcement slices must include rank2_local_post_patch_smoke_record_validation");
    } else {
      if (rank2LocalPostPatchSmokeRecordSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 local post-patch smoke record slice candidate mismatch: ${rank2LocalPostPatchSmokeRecordSlice.candidate_family_id}`);
      }
      if (rank2LocalPostPatchSmokeRecordSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 local post-patch smoke record slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2LocalPostPatchSmokeRecordSlice.acceptance)
        || !rank2LocalPostPatchSmokeRecordSlice.acceptance.some((item) => item.includes("smoke_scope=local_runtime_only_no_deploy"))
        || !rank2LocalPostPatchSmokeRecordSlice.acceptance.some((item) => item.includes("post_patch_smoke_executed=true"))
        || !rank2LocalPostPatchSmokeRecordSlice.acceptance.some((item) => item.includes("deploy_executed=false"))) {
        errors.push("rank2 local post-patch smoke record slice must require local-smoke-only/no-deploy semantics");
      }
    }
    if (!rank2DeployExecutionSlice) {
      errors.push("safe enforcement slices must include rank2_deploy_execution_record_validation");
    } else {
      if (rank2DeployExecutionSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 deploy execution slice candidate mismatch: ${rank2DeployExecutionSlice.candidate_family_id}`);
      }
      if (rank2DeployExecutionSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 deploy execution slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2DeployExecutionSlice.acceptance)
        || !rank2DeployExecutionSlice.acceptance.some((item) => item.includes("deploy_scope=record_only_deploy_no_live_smoke"))
        || !rank2DeployExecutionSlice.acceptance.some((item) => item.includes("deploy_executed=true"))
        || !rank2DeployExecutionSlice.acceptance.some((item) => item.includes("production_live_smoke_executed=false"))) {
        errors.push("rank2 deploy execution slice must require deploy-record-only/no-live-smoke semantics");
      }
    }
    if (!rank2ProductionLiveSmokeSlice) {
      errors.push("safe enforcement slices must include rank2_production_live_smoke_record_validation");
    } else {
      if (rank2ProductionLiveSmokeSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 production live smoke slice candidate mismatch: ${rank2ProductionLiveSmokeSlice.candidate_family_id}`);
      }
      if (rank2ProductionLiveSmokeSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 production live smoke slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2ProductionLiveSmokeSlice.acceptance)
        || !rank2ProductionLiveSmokeSlice.acceptance.some((item) => item.includes("smoke_scope=production_live_smoke_only_no_redirect_no_delete"))
        || !rank2ProductionLiveSmokeSlice.acceptance.some((item) => item.includes("production_live_smoke_executed=true"))
        || !rank2ProductionLiveSmokeSlice.acceptance.some((item) => item.includes("redirect/delete remain blocked"))) {
        errors.push("rank2 production live smoke slice must require live-smoke-only/no-redirect-delete semantics");
      }
    }
    if (!rank2PostLiveRedirectDeleteApprovalRequestSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_approval_request_validation");
    } else {
      if (rank2PostLiveRedirectDeleteApprovalRequestSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete approval request slice candidate mismatch: ${rank2PostLiveRedirectDeleteApprovalRequestSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeleteApprovalRequestSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete approval request slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteApprovalRequestSlice.acceptance)
        || !rank2PostLiveRedirectDeleteApprovalRequestSlice.acceptance.some((item) => item.includes("request_scope=post_live_request_only_no_redirect_no_delete"))
        || !rank2PostLiveRedirectDeleteApprovalRequestSlice.acceptance.some((item) => item.includes("redirect_delete_approval_requested=true"))
        || !rank2PostLiveRedirectDeleteApprovalRequestSlice.acceptance.some((item) => item.includes("redirect_delete_executed=false"))) {
        errors.push("rank2 post-live redirect/delete approval request slice must require request-only/no-execution semantics");
      }
    }
    if (!rank2PostLiveRedirectDeleteApprovalRecordSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_approval_record_validation");
    } else {
      if (rank2PostLiveRedirectDeleteApprovalRecordSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete approval record slice candidate mismatch: ${rank2PostLiveRedirectDeleteApprovalRecordSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeleteApprovalRecordSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete approval record slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteApprovalRecordSlice.acceptance)
        || !rank2PostLiveRedirectDeleteApprovalRecordSlice.acceptance.some((item) => item.includes("approval_scope=record_only_no_redirect_no_delete"))
        || !rank2PostLiveRedirectDeleteApprovalRecordSlice.acceptance.some((item) => item.includes("redirect_delete_approved=true"))
        || !rank2PostLiveRedirectDeleteApprovalRecordSlice.acceptance.some((item) => item.includes("redirect_delete_executed=false"))) {
        errors.push("rank2 post-live redirect/delete approval record slice must require approval-record-only/no-execution semantics");
      }
    }
    if (!rank2PostLiveRedirectDeleteExecutionPacketSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_execution_packet_validation");
    } else {
      if (rank2PostLiveRedirectDeleteExecutionPacketSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete execution packet slice candidate mismatch: ${rank2PostLiveRedirectDeleteExecutionPacketSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeleteExecutionPacketSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete execution packet slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteExecutionPacketSlice.acceptance)
        || !rank2PostLiveRedirectDeleteExecutionPacketSlice.acceptance.some((item) => item.includes("execution_scope=packet_only_no_redirect_no_delete"))
        || !rank2PostLiveRedirectDeleteExecutionPacketSlice.acceptance.some((item) => item.includes("redirect_delete_execution_planned=true"))
        || !rank2PostLiveRedirectDeleteExecutionPacketSlice.acceptance.some((item) => item.includes("redirect_delete_executed=false"))) {
        errors.push("rank2 post-live redirect/delete execution packet slice must require packet-only/no-execution semantics");
      }
    }
    if (!rank2PostLiveRedirectDeleteExecutionRecordSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_execution_record_validation");
    } else {
      if (rank2PostLiveRedirectDeleteExecutionRecordSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete execution record slice candidate mismatch: ${rank2PostLiveRedirectDeleteExecutionRecordSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeleteExecutionRecordSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete execution record slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteExecutionRecordSlice.acceptance)
        || !rank2PostLiveRedirectDeleteExecutionRecordSlice.acceptance.some((item) => item.includes("execution_scope=record_only_redirect_delete_execution_evidence"))
        || !rank2PostLiveRedirectDeleteExecutionRecordSlice.acceptance.some((item) => item.includes("redirect_delete_executed=true"))
        || !rank2PostLiveRedirectDeleteExecutionRecordSlice.acceptance.some((item) => item.includes("execution_performed_by_this_command=false"))) {
        errors.push("rank2 post-live redirect/delete execution record slice must require record-only/external-execution evidence semantics");
      }
    }
    if (!rank2PostLiveRedirectDeletePostExecutionSmokeSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_post_execution_smoke_record_validation");
    } else {
      if (rank2PostLiveRedirectDeletePostExecutionSmokeSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete post-execution smoke slice candidate mismatch: ${rank2PostLiveRedirectDeletePostExecutionSmokeSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeletePostExecutionSmokeSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete post-execution smoke slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeletePostExecutionSmokeSlice.acceptance)
        || !rank2PostLiveRedirectDeletePostExecutionSmokeSlice.acceptance.some((item) => item.includes("smoke_scope=post_execution_smoke_only_no_additional_redirect_delete_no_deploy"))
        || !rank2PostLiveRedirectDeletePostExecutionSmokeSlice.acceptance.some((item) => item.includes("ok=true"))
        || !rank2PostLiveRedirectDeletePostExecutionSmokeSlice.acceptance.some((item) => item.includes("smoke_performed_by_this_command=false"))) {
        errors.push("rank2 post-live redirect/delete post-execution smoke slice must require smoke-only/external-evidence semantics");
      }
    }
    if (!rank2PostLiveRedirectDeleteRollbackReadinessSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_rollback_readiness_record_validation");
    } else {
      if (rank2PostLiveRedirectDeleteRollbackReadinessSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete rollback readiness slice candidate mismatch: ${rank2PostLiveRedirectDeleteRollbackReadinessSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeleteRollbackReadinessSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete rollback readiness slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteRollbackReadinessSlice.acceptance)
        || !rank2PostLiveRedirectDeleteRollbackReadinessSlice.acceptance.some((item) => item.includes("rollback_scope=record_only_rollback_readiness_no_rollback_no_deploy"))
        || !rank2PostLiveRedirectDeleteRollbackReadinessSlice.acceptance.some((item) => item.includes("rollback_ready=true"))
        || !rank2PostLiveRedirectDeleteRollbackReadinessSlice.acceptance.some((item) => item.includes("rollback_performed_by_this_command=false"))) {
        errors.push("rank2 post-live redirect/delete rollback readiness slice must require rollback-readiness-only/no-command-rollback semantics");
      }
    }
    if (!rank2PostLiveRedirectDeleteOwnerCloseoutSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_owner_closeout_record_validation");
    } else {
      if (rank2PostLiveRedirectDeleteOwnerCloseoutSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete owner closeout slice candidate mismatch: ${rank2PostLiveRedirectDeleteOwnerCloseoutSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeleteOwnerCloseoutSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete owner closeout slice must require separate mutation approval");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteOwnerCloseoutSlice.acceptance)
        || !rank2PostLiveRedirectDeleteOwnerCloseoutSlice.acceptance.some((item) => item.includes("closeout_scope=record_only_owner_closeout_no_additional_runtime"))
        || !rank2PostLiveRedirectDeleteOwnerCloseoutSlice.acceptance.some((item) => item.includes("owner_closeout_accepted=true"))
        || !rank2PostLiveRedirectDeleteOwnerCloseoutSlice.acceptance.some((item) => item.includes("closeout_performed_by_this_command=false"))) {
        errors.push("rank2 post-live redirect/delete owner closeout slice must require owner-closeout-only/no-command-runtime semantics");
      }
    }
    if (!rank2PostLiveRedirectDeleteFreshOwnerPacketSlice) {
      errors.push("safe enforcement slices must include rank2_post_live_redirect_delete_fresh_owner_packet_required");
    } else {
      if (rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 post-live redirect/delete fresh owner packet slice candidate mismatch: ${rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.candidate_family_id}`);
      }
      if (rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 post-live redirect/delete fresh owner packet slice must require separate mutation approval");
      }
      if (rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.required_contract_id !== "post_terminal_fresh_owner_packet_contract") {
        errors.push("rank2 post-live redirect/delete fresh owner packet slice must reference the fresh owner packet contract");
      }
      if (rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.required_record_schema !== "rank2-fresh-owner-runtime-packet-record/v0.1") {
        errors.push("rank2 post-live redirect/delete fresh owner packet slice must expose the fresh owner packet record schema");
      }
      if (
        rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-template"
        || rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.validation_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<json>'"
      ) {
        errors.push("rank2 post-live redirect/delete fresh owner packet slice must expose template/validation commands");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.required_contract_sections)
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.required_contract_sections.includes("pro_route_ia_acceptance")
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.required_contract_sections.includes("local_live_equivalence")
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.required_contract_sections.includes("rollback_plan")
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.required_contract_sections.includes("explicit_owner_approval")) {
        errors.push("rank2 post-live redirect/delete fresh owner packet slice must list required contract sections");
      }
      if (!Array.isArray(rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.acceptance)
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.acceptance.some((item) => item.includes("terminal gate must be rank2_post_live_redirect_delete_record_chain_closed"))
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.acceptance.some((item) => item.includes("fresh owner-approved packet"))
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.acceptance.some((item) => item.includes("PRO route/IA acceptance"))
        || !rank2PostLiveRedirectDeleteFreshOwnerPacketSlice.acceptance.some((item) => item.includes("redirect/delete/deploy/public mutation remains blocked"))) {
        errors.push("rank2 post-live redirect/delete fresh owner packet slice must require fresh owner-approved packet semantics");
      }
    }
    if (!rank2FreshOwnerRuntimeExecutionPacketSlice) {
      errors.push("safe enforcement slices must include rank2_fresh_owner_runtime_execution_packet_required");
    } else {
      if (rank2FreshOwnerRuntimeExecutionPacketSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 fresh owner runtime execution packet slice candidate mismatch: ${rank2FreshOwnerRuntimeExecutionPacketSlice.candidate_family_id}`);
      }
      if (rank2FreshOwnerRuntimeExecutionPacketSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 fresh owner runtime execution packet slice must require separate mutation approval");
      }
      if (rank2FreshOwnerRuntimeExecutionPacketSlice.required_record_schema !== "rank2-fresh-owner-runtime-execution-packet-record/v0.1") {
        errors.push("rank2 fresh owner runtime execution packet slice must expose the runtime execution packet record schema");
      }
      if (
        rank2FreshOwnerRuntimeExecutionPacketSlice.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-execution-packet-template"
        || rank2FreshOwnerRuntimeExecutionPacketSlice.validation_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<json>'"
      ) {
        errors.push("rank2 fresh owner runtime execution packet slice must expose template/validation commands");
      }
      if (!Array.isArray(rank2FreshOwnerRuntimeExecutionPacketSlice.acceptance)
        || !rank2FreshOwnerRuntimeExecutionPacketSlice.acceptance.some((item) => item.includes("valid_fresh_owner_runtime_packet_recorded_no_execution"))
        || !rank2FreshOwnerRuntimeExecutionPacketSlice.acceptance.some((item) => item.includes("execution_scope=packet_only_no_runtime"))
        || !rank2FreshOwnerRuntimeExecutionPacketSlice.acceptance.some((item) => item.includes("execution_allowed=false"))
        || !rank2FreshOwnerRuntimeExecutionPacketSlice.acceptance.some((item) => item.includes("public-file mutation"))) {
        errors.push("rank2 fresh owner runtime execution packet slice must require no-runtime execution packet semantics");
      }
    }
    if (!rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice) {
      errors.push("safe enforcement slices must include rank2_fresh_owner_external_runtime_execution_evidence_required");
    } else {
      if (rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 fresh owner external runtime execution evidence slice candidate mismatch: ${rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.candidate_family_id}`);
      }
      if (rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 fresh owner external runtime execution evidence slice must require separate mutation approval");
      }
      if (rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.required_record_schema !== "rank2-fresh-owner-external-runtime-execution-evidence-record/v0.1") {
        errors.push("rank2 fresh owner external runtime execution evidence slice must expose the external runtime execution evidence record schema");
      }
      if (
        rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-external-runtime-execution-evidence-template"
        || rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.validation_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<json>'"
      ) {
        errors.push("rank2 fresh owner external runtime execution evidence slice must expose template/validation commands");
      }
      if (!Array.isArray(rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.acceptance)
        || !rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.acceptance.some((item) => item.includes("valid_fresh_owner_runtime_execution_packet_recorded_no_execution"))
        || !rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.acceptance.some((item) => item.includes("execution_scope=external_runtime_execution_evidence_only"))
        || !rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.acceptance.some((item) => item.includes("execution_performed_outside_this_command=true"))
        || !rank2FreshOwnerExternalRuntimeExecutionEvidenceSlice.acceptance.some((item) => item.includes("post-runtime smoke remains blocked"))) {
        errors.push("rank2 fresh owner external runtime execution evidence slice must require external evidence/no-command-runtime semantics");
      }
    }
    if (!rank2FreshOwnerPostRuntimeSmokeEvidenceSlice) {
      errors.push("safe enforcement slices must include rank2_fresh_owner_post_runtime_smoke_evidence_required");
    } else {
      if (rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 fresh owner post-runtime smoke evidence slice candidate mismatch: ${rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.candidate_family_id}`);
      }
      if (rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 fresh owner post-runtime smoke evidence slice must require separate mutation approval");
      }
      if (rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.required_record_schema !== "rank2-fresh-owner-post-runtime-smoke-evidence-record/v0.1") {
        errors.push("rank2 fresh owner post-runtime smoke evidence slice must expose the post-runtime smoke evidence record schema");
      }
      if (
        rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-post-runtime-smoke-evidence-template"
        || rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.validation_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<json>'"
      ) {
        errors.push("rank2 fresh owner post-runtime smoke evidence slice must expose template/validation commands");
      }
      if (!Array.isArray(rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.acceptance)
        || !rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.acceptance.some((item) => item.includes("valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke"))
        || !rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.acceptance.some((item) => item.includes("smoke_scope=post_runtime_smoke_evidence_only_no_additional_runtime"))
        || !rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.acceptance.some((item) => item.includes("smoke_performed_outside_this_command=true"))
        || !rank2FreshOwnerPostRuntimeSmokeEvidenceSlice.acceptance.some((item) => item.includes("rollback readiness remains blocked"))) {
        errors.push("rank2 fresh owner post-runtime smoke evidence slice must require smoke-evidence-only/no-command-runtime semantics");
      }
    }
    if (!rank2FreshOwnerRollbackReadinessSlice) {
      errors.push("safe enforcement slices must include rank2_fresh_owner_rollback_readiness_required");
    } else {
      if (rank2FreshOwnerRollbackReadinessSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 fresh owner rollback readiness slice candidate mismatch: ${rank2FreshOwnerRollbackReadinessSlice.candidate_family_id}`);
      }
      if (rank2FreshOwnerRollbackReadinessSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 fresh owner rollback readiness slice must require separate mutation approval");
      }
      if (rank2FreshOwnerRollbackReadinessSlice.required_record_schema !== "rank2-fresh-owner-rollback-readiness-record/v0.1") {
        errors.push("rank2 fresh owner rollback readiness slice must expose the rollback readiness record schema");
      }
      if (
        rank2FreshOwnerRollbackReadinessSlice.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-rollback-readiness-template"
        || rank2FreshOwnerRollbackReadinessSlice.validation_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<post-runtime-smoke-json>' --rank2-fresh-owner-rollback-readiness-json='<json>'"
      ) {
        errors.push("rank2 fresh owner rollback readiness slice must expose template/validation commands");
      }
      if (!Array.isArray(rank2FreshOwnerRollbackReadinessSlice.acceptance)
        || !rank2FreshOwnerRollbackReadinessSlice.acceptance.some((item) => item.includes("valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback"))
        || !rank2FreshOwnerRollbackReadinessSlice.acceptance.some((item) => item.includes("rollback_scope=record_only_rollback_readiness_no_rollback_no_deploy"))
        || !rank2FreshOwnerRollbackReadinessSlice.acceptance.some((item) => item.includes("rollback_performed_by_this_command=false"))
        || !rank2FreshOwnerRollbackReadinessSlice.acceptance.some((item) => item.includes("owner closeout remains blocked"))) {
        errors.push("rank2 fresh owner rollback readiness slice must require rollback-readiness-only/no-command-rollback semantics");
      }
    }
    if (!rank2FreshOwnerOwnerCloseoutSlice) {
      errors.push("safe enforcement slices must include rank2_fresh_owner_owner_closeout_required");
    } else {
      if (rank2FreshOwnerOwnerCloseoutSlice.candidate_family_id !== packet.next_queue_candidate_after_owner_decision?.family_id) {
        errors.push(`rank2 fresh owner owner closeout slice candidate mismatch: ${rank2FreshOwnerOwnerCloseoutSlice.candidate_family_id}`);
      }
      if (rank2FreshOwnerOwnerCloseoutSlice.separate_mutation_approval_required !== true) {
        errors.push("rank2 fresh owner owner closeout slice must require separate mutation approval");
      }
      if (rank2FreshOwnerOwnerCloseoutSlice.required_record_schema !== "rank2-fresh-owner-owner-closeout-record/v0.1") {
        errors.push("rank2 fresh owner owner closeout slice must expose the owner closeout record schema");
      }
      if (
        rank2FreshOwnerOwnerCloseoutSlice.template_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-owner-closeout-template"
        || rank2FreshOwnerOwnerCloseoutSlice.validation_command !== "node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-json='<fresh-json>' --rank2-fresh-owner-runtime-execution-packet-json='<execution-packet-json>' --rank2-fresh-owner-external-runtime-execution-evidence-json='<external-evidence-json>' --rank2-fresh-owner-post-runtime-smoke-evidence-json='<post-runtime-smoke-json>' --rank2-fresh-owner-rollback-readiness-json='<rollback-readiness-json>' --rank2-fresh-owner-owner-closeout-json='<json>'"
      ) {
        errors.push("rank2 fresh owner owner closeout slice must expose template/validation commands");
      }
      if (!Array.isArray(rank2FreshOwnerOwnerCloseoutSlice.acceptance)
        || !rank2FreshOwnerOwnerCloseoutSlice.acceptance.some((item) => item.includes("valid_fresh_owner_rollback_readiness_recorded_pending_closeout"))
        || !rank2FreshOwnerOwnerCloseoutSlice.acceptance.some((item) => item.includes("closeout_scope=record_only_owner_closeout_no_additional_runtime"))
        || !rank2FreshOwnerOwnerCloseoutSlice.acceptance.some((item) => item.includes("owner_closeout_accepted=true"))
        || !rank2FreshOwnerOwnerCloseoutSlice.acceptance.some((item) => item.includes("closeout_performed_by_this_command=false"))) {
        errors.push("rank2 fresh owner owner closeout slice must require owner-closeout-only/no-command-runtime semantics");
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
  if (JSON.stringify(packet.rank2_review_readiness.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 review readiness must keep the route-patch blocked-action contract locked");
  }
  packet.rank2_owner_review_template = rank2OwnerReviewTemplate(packet);
  packet.rank2_owner_followup_plans = rank2OwnerFollowupPlans(packet);
  packet.rank2_owner_followup_record_templates = packet.rank2_owner_followup_plans.map(rank2OwnerFollowupRecordTemplate);
  if (packet.rank2_owner_review_template.rank2_active !== false || packet.rank2_owner_review_template.mutation_allowed !== false) {
    errors.push("rank2 owner-review template must not activate rank2 or allow mutation");
  }
  if (JSON.stringify(packet.rank2_owner_review_template.blocked_actions) !== JSON.stringify(routePatchBlockedActions())
    || JSON.stringify(packet.rank2_owner_review_template.decision_record_template?.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 owner-review template must keep the route-patch blocked-action contract locked");
  }
  for (const option of packet.rank2_owner_review_template.decision_options) {
    if (option.mutation_allowed !== false) {
      errors.push(`rank2 owner-review option must not authorize mutation: ${option.decision}`);
    }
    if (JSON.stringify(option.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
      errors.push(`rank2 owner-review option blocked actions mismatch: ${option.decision}`);
    }
  }
  const rank2OwnerDecisionRecordErrors = validateRank2OwnerDecisionRecord(
    packet.supplied_rank2_owner_decision_record,
    packet.rank2_owner_review_template.decision_record_template,
    packet,
  );
  errors.push(...rank2OwnerDecisionRecordErrors);
  if (packet.supplied_rank2_owner_decision_record && rank2OwnerDecisionRecordErrors.length === 0) {
    packet.rank2_owner_decision_record_status = "valid_no_mutation_owner_review_recorded";
    packet.selected_rank2_owner_followup = selectedRank2OwnerFollowup(packet);
    if (!packet.selected_rank2_owner_followup) {
      errors.push(`valid rank2 owner decision record did not select a followup plan: ${packet.supplied_rank2_owner_decision_record.decision}`);
    }
  }
  const rank2OwnerFollowupRecordErrors = validateRank2OwnerFollowupRecord(packet.supplied_rank2_owner_followup_record, packet);
  errors.push(...rank2OwnerFollowupRecordErrors);
  if (packet.supplied_rank2_owner_followup_record && rank2OwnerFollowupRecordErrors.length === 0) {
    packet.rank2_owner_followup_record_status = "valid_no_mutation_owner_followup_recorded";
  }
  packet.rank2_mutation_approval_readiness = rank2MutationApprovalReadiness(packet);
  if (
    packet.rank2_mutation_approval_readiness.rank2_active !== false
    || packet.rank2_mutation_approval_readiness.mutation_allowed !== false
    || packet.rank2_mutation_approval_readiness.execution_allowed !== false
  ) {
    errors.push("rank2 mutation approval readiness must not allow activation, mutation, or execution");
  }
  if (packet.rank2_mutation_approval_readiness.ready_for_mutation_approval_request && packet.rank2_mutation_approval_readiness.missing_records.length > 0) {
    errors.push("rank2 mutation approval readiness cannot be ready with missing records");
  }
  if (JSON.stringify(packet.rank2_mutation_approval_readiness.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 mutation approval readiness must keep the route-patch blocked-action contract locked");
  }
  packet.rank2_mutation_approval_request_template = rank2MutationApprovalRequestTemplate(packet);
  if (
    packet.rank2_mutation_approval_request_template.request_only !== true
    || packet.rank2_mutation_approval_request_template.mutation_allowed !== false
    || packet.rank2_mutation_approval_request_template.execution_allowed !== false
    || packet.rank2_mutation_approval_request_template.approval_status !== "pending_owner_approval"
  ) {
    errors.push("rank2 mutation approval request template must stay request-only, pending, and no-execution");
  }
  if (JSON.stringify(packet.rank2_mutation_approval_request_template.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 mutation approval request template must keep the route-patch blocked-action contract locked");
  }
  packet.rank2_mutation_approval_record_template = rank2MutationApprovalRecordTemplate(packet);
  if (JSON.stringify(packet.rank2_mutation_approval_record_template.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 mutation approval record template must keep the route-patch blocked-action contract locked");
  }
  const rank2MutationApprovalRecordErrors = validateRank2MutationApprovalRecord(
    packet.supplied_rank2_mutation_approval_record,
    packet.rank2_mutation_approval_record_template,
    packet,
  );
  errors.push(...rank2MutationApprovalRecordErrors);
  if (packet.supplied_rank2_mutation_approval_record && rank2MutationApprovalRecordErrors.length === 0) {
    packet.rank2_mutation_approval_record_status = "valid_owner_approved_no_execution";
  }
  packet.rank2_route_diff_proposal_template = rank2RouteDiffProposalTemplate(packet);
  if (
    packet.rank2_route_diff_proposal_template.proposal_status !== "draft_no_mutation"
    || packet.rank2_route_diff_proposal_template.patch_applied !== false
    || packet.rank2_route_diff_proposal_template.public_files_modified !== false
    || packet.rank2_route_diff_proposal_template.redirect_config_changed !== false
    || packet.rank2_route_diff_proposal_template.execution_allowed !== false
    || packet.rank2_route_diff_proposal_template.deploy_approved !== false
  ) {
    errors.push("rank2 route diff proposal template must stay draft-only/no-mutation/no-execution");
  }
  if (JSON.stringify(packet.rank2_route_diff_proposal_template.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 route diff proposal template must keep the route-patch blocked-action contract locked");
  }
  const rank2RouteDiffProposalErrors = validateRank2RouteDiffProposalRecord(
    packet.supplied_rank2_route_diff_proposal_record,
    packet.rank2_route_diff_proposal_template,
    packet,
  );
  errors.push(...rank2RouteDiffProposalErrors);
  if (packet.supplied_rank2_route_diff_proposal_record && rank2RouteDiffProposalErrors.length === 0) {
    packet.rank2_route_diff_proposal_record_status = "valid_no_mutation_route_diff_proposal_recorded";
  }
  packet.rank2_rollback_plan_template = rank2RollbackPlanTemplate(packet);
  if (
    packet.rank2_rollback_plan_template.rollback_plan_status !== "recorded_no_mutation"
    || packet.rank2_rollback_plan_template.patch_applied !== false
    || packet.rank2_rollback_plan_template.rollback_applied !== false
    || packet.rank2_rollback_plan_template.public_files_modified !== false
    || packet.rank2_rollback_plan_template.redirect_config_changed !== false
    || packet.rank2_rollback_plan_template.execution_allowed !== false
    || packet.rank2_rollback_plan_template.deploy_approved !== false
  ) {
    errors.push("rank2 rollback plan template must stay plan-only/no-mutation/no-execution");
  }
  if (JSON.stringify(packet.rank2_rollback_plan_template.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 rollback plan template must keep the route-patch blocked-action contract locked");
  }
  const rank2RollbackPlanErrors = validateRank2RollbackPlanRecord(
    packet.supplied_rank2_rollback_plan_record,
    packet.rank2_rollback_plan_template,
    packet,
  );
  errors.push(...rank2RollbackPlanErrors);
  if (packet.supplied_rank2_rollback_plan_record && rank2RollbackPlanErrors.length === 0) {
    packet.rank2_rollback_plan_record_status = "valid_no_mutation_rollback_plan_recorded";
  }
  packet.rank2_local_post_patch_smoke_plan_template = rank2LocalPostPatchSmokePlanTemplate(packet);
  if (
    packet.rank2_local_post_patch_smoke_plan_template.smoke_plan_status !== "planned_before_execution_no_runtime"
    || packet.rank2_local_post_patch_smoke_plan_template.patch_applied !== false
    || packet.rank2_local_post_patch_smoke_plan_template.rollback_applied !== false
    || packet.rank2_local_post_patch_smoke_plan_template.smoke_executed !== false
    || packet.rank2_local_post_patch_smoke_plan_template.public_files_modified !== false
    || packet.rank2_local_post_patch_smoke_plan_template.redirect_config_changed !== false
    || packet.rank2_local_post_patch_smoke_plan_template.execution_allowed !== false
    || packet.rank2_local_post_patch_smoke_plan_template.deploy_approved !== false
  ) {
    errors.push("rank2 local post-patch smoke plan template must stay plan-only/no-runtime/no-mutation/no-execution");
  }
  if (JSON.stringify(packet.rank2_local_post_patch_smoke_plan_template.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 local post-patch smoke plan template must keep the route-patch blocked-action contract locked");
  }
  const rank2LocalPostPatchSmokePlanErrors = validateRank2LocalPostPatchSmokePlanRecord(
    packet.supplied_rank2_local_post_patch_smoke_plan_record,
    packet.rank2_local_post_patch_smoke_plan_template,
    packet,
  );
  errors.push(...rank2LocalPostPatchSmokePlanErrors);
  if (packet.supplied_rank2_local_post_patch_smoke_plan_record && rank2LocalPostPatchSmokePlanErrors.length === 0) {
    packet.rank2_local_post_patch_smoke_plan_record_status = "valid_no_mutation_local_post_patch_smoke_plan_recorded";
  }
  packet.rank2_explicit_deploy_approval_template = rank2ExplicitDeployApprovalTemplate(packet);
  if (
    packet.rank2_explicit_deploy_approval_template.approval_status !== "owner_approved"
    || packet.rank2_explicit_deploy_approval_template.approval_scope !== "record_only_no_deploy"
    || packet.rank2_explicit_deploy_approval_template.deploy_approved !== true
    || packet.rank2_explicit_deploy_approval_template.deploy_executed !== false
    || packet.rank2_explicit_deploy_approval_template.production_live_smoke_executed !== false
    || packet.rank2_explicit_deploy_approval_template.execution_allowed !== false
    || packet.rank2_explicit_deploy_approval_template.route_patch_applied !== false
    || packet.rank2_explicit_deploy_approval_template.rollback_applied !== false
    || packet.rank2_explicit_deploy_approval_template.public_files_modified !== false
    || packet.rank2_explicit_deploy_approval_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 explicit deploy approval template must stay record-only/no-runtime/no-mutation/no-execution");
  }
  if (JSON.stringify(packet.rank2_explicit_deploy_approval_template.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 explicit deploy approval template must keep the route-patch blocked-action contract locked");
  }
  const rank2ExplicitDeployApprovalErrors = validateRank2ExplicitDeployApprovalRecord(
    packet.supplied_rank2_explicit_deploy_approval_record,
    packet.rank2_explicit_deploy_approval_template,
    packet,
  );
  errors.push(...rank2ExplicitDeployApprovalErrors);
  if (packet.supplied_rank2_explicit_deploy_approval_record && rank2ExplicitDeployApprovalErrors.length === 0) {
    packet.rank2_explicit_deploy_approval_record_status = "valid_explicit_deploy_approval_recorded_no_runtime";
  }
  packet.rank2_execution_readiness = rank2ExecutionReadiness(packet);
  if (
    packet.rank2_execution_readiness.ready_for_execution !== false
    || packet.rank2_execution_readiness.mutation_allowed !== false
    || packet.rank2_execution_readiness.execution_allowed !== false
    || packet.rank2_execution_readiness.deploy_allowed !== false
  ) {
    errors.push("rank2 execution readiness must remain blocked/no-mutation/no-execution");
  }
  if (JSON.stringify(packet.rank2_execution_readiness.blocked_actions) !== JSON.stringify(routePatchBlockedActions())) {
    errors.push("rank2 execution readiness must keep the route-patch blocked-action contract locked");
  }
  if (
    packet.rank2_execution_readiness.missing_prerequisites.length === 0
    && packet.rank2_execution_readiness.status !== "all_prerequisites_recorded_no_runtime"
  ) {
    errors.push(`rank2 execution readiness status must record all prerequisites without runtime: ${packet.rank2_execution_readiness.status}`);
  }
  if (
    packet.rank2_execution_readiness.missing_prerequisites.length > 0
    && packet.rank2_execution_readiness.status !== "blocked_pending_execution_prerequisites"
  ) {
    errors.push(`rank2 execution readiness status must remain blocked while prerequisites are missing: ${packet.rank2_execution_readiness.status}`);
  }
  if (packet.rank2_explicit_deploy_approval_record_status === "valid_explicit_deploy_approval_recorded_no_runtime") {
    if (packet.rank2_execution_readiness.missing_prerequisites.includes("explicit_deploy_approval")) {
      errors.push("rank2 execution readiness must satisfy deploy approval after a valid explicit deploy approval record");
    }
  } else if (!packet.rank2_execution_readiness.missing_prerequisites.includes("explicit_deploy_approval")) {
    errors.push("rank2 execution readiness must keep deploy approval missing until a valid explicit deploy approval record exists");
  }
  if (packet.rank2_route_diff_proposal_record_status === "valid_no_mutation_route_diff_proposal_recorded") {
    if (packet.rank2_execution_readiness.missing_prerequisites.includes("route_file_diff_proposal")) {
      errors.push("rank2 execution readiness must satisfy route diff after a valid proposal record");
    }
  } else if (!packet.rank2_execution_readiness.missing_prerequisites.includes("route_file_diff_proposal")) {
    errors.push("rank2 execution readiness must keep route diff missing until a valid proposal record exists");
  }
  if (packet.rank2_rollback_plan_record_status === "valid_no_mutation_rollback_plan_recorded") {
    if (packet.rank2_execution_readiness.missing_prerequisites.includes("rollback_plan")) {
      errors.push("rank2 execution readiness must satisfy rollback after a valid rollback plan record");
    }
  } else if (!packet.rank2_execution_readiness.missing_prerequisites.includes("rollback_plan")) {
    errors.push("rank2 execution readiness must keep rollback missing until a valid rollback plan record exists");
  }
  if (packet.rank2_local_post_patch_smoke_plan_record_status === "valid_no_mutation_local_post_patch_smoke_plan_recorded") {
    if (packet.rank2_execution_readiness.missing_prerequisites.includes("local_post_patch_smoke_plan")) {
      errors.push("rank2 execution readiness must satisfy local smoke plan after a valid local smoke plan record");
    }
  } else if (!packet.rank2_execution_readiness.missing_prerequisites.includes("local_post_patch_smoke_plan")) {
    errors.push("rank2 execution readiness must keep local smoke plan missing until a valid local smoke plan record exists");
  }
  packet.rank2_route_execution_packet_template = rank2RouteExecutionPacketTemplate(packet);
  if (
    packet.rank2_route_execution_packet_template.execution_packet_status !== "recorded_no_runtime"
    || packet.rank2_route_execution_packet_template.execution_scope !== "record_only_no_runtime"
    || packet.rank2_route_execution_packet_template.owner_runtime_release_status !== "not_recorded"
    || packet.rank2_route_execution_packet_template.route_execution_packet_recorded !== true
    || packet.rank2_route_execution_packet_template.execution_allowed !== false
    || packet.rank2_route_execution_packet_template.route_patch_applied !== false
    || packet.rank2_route_execution_packet_template.post_patch_smoke_executed !== false
    || packet.rank2_route_execution_packet_template.deploy_executed !== false
    || packet.rank2_route_execution_packet_template.production_live_smoke_executed !== false
    || packet.rank2_route_execution_packet_template.public_files_modified !== false
    || packet.rank2_route_execution_packet_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 route execution packet template must stay record-only/no-runtime/no-mutation/no-deploy");
  }
  if (!packet.rank2_route_execution_packet_template.blocked_actions.includes("delete")
    || !packet.rank2_route_execution_packet_template.blocked_actions.includes("redirect")
    || !packet.rank2_route_execution_packet_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 route execution packet template must keep delete/redirect/deploy blocked");
  }
  const rank2RouteExecutionPacketErrors = validateRank2RouteExecutionPacketRecord(
    packet.supplied_rank2_route_execution_packet_record,
    packet.rank2_route_execution_packet_template,
    packet,
  );
  errors.push(...rank2RouteExecutionPacketErrors);
  if (packet.supplied_rank2_route_execution_packet_record && rank2RouteExecutionPacketErrors.length === 0) {
    packet.rank2_route_execution_packet_record_status = "valid_route_execution_packet_recorded_no_runtime";
  }
  packet.rank2_owner_runtime_release_template = rank2OwnerRuntimeReleaseTemplate(packet);
  if (
    packet.rank2_owner_runtime_release_template.release_status !== "owner_released"
    || packet.rank2_owner_runtime_release_template.release_scope !== "record_only_before_runtime"
    || packet.rank2_owner_runtime_release_template.runtime_release_recorded !== true
    || packet.rank2_owner_runtime_release_template.execution_allowed !== false
    || packet.rank2_owner_runtime_release_template.route_patch_applied !== false
    || packet.rank2_owner_runtime_release_template.post_patch_smoke_executed !== false
    || packet.rank2_owner_runtime_release_template.deploy_executed !== false
    || packet.rank2_owner_runtime_release_template.production_live_smoke_executed !== false
    || packet.rank2_owner_runtime_release_template.public_files_modified !== false
    || packet.rank2_owner_runtime_release_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 owner runtime release template must stay record-only/no-runtime/no-mutation/no-deploy");
  }
  if (!packet.rank2_owner_runtime_release_template.blocked_actions.includes("delete")
    || !packet.rank2_owner_runtime_release_template.blocked_actions.includes("redirect")
    || !packet.rank2_owner_runtime_release_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 owner runtime release template must keep delete/redirect/deploy blocked");
  }
  const rank2OwnerRuntimeReleaseErrors = validateRank2OwnerRuntimeReleaseRecord(
    packet.supplied_rank2_owner_runtime_release_record,
    packet.rank2_owner_runtime_release_template,
    packet,
  );
  errors.push(...rank2OwnerRuntimeReleaseErrors);
  if (packet.supplied_rank2_owner_runtime_release_record && rank2OwnerRuntimeReleaseErrors.length === 0) {
    packet.rank2_owner_runtime_release_record_status = "valid_owner_runtime_release_recorded_no_execution";
  }
  packet.rank2_route_patch_application_template = rank2RoutePatchApplicationTemplate(packet);
  if (
    packet.rank2_route_patch_application_template.patch_status !== "recorded_local_patch_applied"
    || packet.rank2_route_patch_application_template.patch_scope !== "record_only_local_patch_no_smoke_no_deploy"
    || packet.rank2_route_patch_application_template.route_patch_application_recorded !== true
    || packet.rank2_route_patch_application_template.route_patch_applied !== true
    || packet.rank2_route_patch_application_template.post_patch_smoke_executed !== false
    || packet.rank2_route_patch_application_template.deploy_executed !== false
    || packet.rank2_route_patch_application_template.production_live_smoke_executed !== false
    || packet.rank2_route_patch_application_template.public_files_modified !== false
    || packet.rank2_route_patch_application_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 route patch application template must stay record-only/no-smoke/no-deploy/no-public-mutation");
  }
  if (!packet.rank2_route_patch_application_template.blocked_actions.includes("delete")
    || !packet.rank2_route_patch_application_template.blocked_actions.includes("redirect")
    || !packet.rank2_route_patch_application_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 route patch application template must keep delete/redirect/deploy blocked");
  }
  const rank2RoutePatchApplicationErrors = validateRank2RoutePatchApplicationRecord(
    packet.supplied_rank2_route_patch_application_record,
    packet.rank2_route_patch_application_template,
    packet,
  );
  errors.push(...rank2RoutePatchApplicationErrors);
  if (packet.supplied_rank2_route_patch_application_record && rank2RoutePatchApplicationErrors.length === 0) {
    packet.rank2_route_patch_application_record_status = "valid_route_patch_application_recorded_no_smoke_no_deploy";
  }
  packet.rank2_local_post_patch_smoke_record_template = rank2LocalPostPatchSmokeRecordTemplate(packet);
  if (
    packet.rank2_local_post_patch_smoke_record_template.smoke_status !== "recorded_local_post_patch_smoke"
    || packet.rank2_local_post_patch_smoke_record_template.smoke_scope !== "local_runtime_only_no_deploy"
    || packet.rank2_local_post_patch_smoke_record_template.route_patch_applied !== true
    || packet.rank2_local_post_patch_smoke_record_template.post_patch_smoke_executed !== true
    || packet.rank2_local_post_patch_smoke_record_template.deploy_executed !== false
    || packet.rank2_local_post_patch_smoke_record_template.production_live_smoke_executed !== false
    || packet.rank2_local_post_patch_smoke_record_template.public_files_modified !== false
    || packet.rank2_local_post_patch_smoke_record_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 local post-patch smoke record template must stay local-smoke-only/no-deploy/no-public-mutation");
  }
  if (!packet.rank2_local_post_patch_smoke_record_template.blocked_actions.includes("delete")
    || !packet.rank2_local_post_patch_smoke_record_template.blocked_actions.includes("redirect")
    || !packet.rank2_local_post_patch_smoke_record_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 local post-patch smoke record template must keep delete/redirect/deploy blocked");
  }
  const rank2LocalPostPatchSmokeRecordErrors = validateRank2LocalPostPatchSmokeRecord(
    packet.supplied_rank2_local_post_patch_smoke_record,
    packet.rank2_local_post_patch_smoke_record_template,
    packet,
  );
  errors.push(...rank2LocalPostPatchSmokeRecordErrors);
  if (packet.supplied_rank2_local_post_patch_smoke_record && rank2LocalPostPatchSmokeRecordErrors.length === 0) {
    packet.rank2_local_post_patch_smoke_record_status = "valid_local_post_patch_smoke_recorded_no_deploy";
  }
  packet.rank2_deploy_execution_template = rank2DeployExecutionTemplate(packet);
  if (
    packet.rank2_deploy_execution_template.deploy_status !== "recorded_deploy_executed"
    || packet.rank2_deploy_execution_template.deploy_scope !== "record_only_deploy_no_live_smoke"
    || packet.rank2_deploy_execution_template.route_patch_applied !== true
    || packet.rank2_deploy_execution_template.post_patch_smoke_executed !== true
    || packet.rank2_deploy_execution_template.deploy_executed !== true
    || packet.rank2_deploy_execution_template.production_live_smoke_executed !== false
    || packet.rank2_deploy_execution_template.public_files_modified !== false
    || packet.rank2_deploy_execution_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 deploy execution template must stay deploy-record-only/no-live-smoke/no-public-mutation");
  }
  if (!packet.rank2_deploy_execution_template.blocked_actions.includes("delete")
    || !packet.rank2_deploy_execution_template.blocked_actions.includes("redirect")
    || !packet.rank2_deploy_execution_template.blocked_actions.includes("production_live_smoke")) {
    errors.push("rank2 deploy execution template must keep delete/redirect/production-live-smoke blocked");
  }
  const rank2DeployExecutionErrors = validateRank2DeployExecutionRecord(
    packet.supplied_rank2_deploy_execution_record,
    packet.rank2_deploy_execution_template,
    packet,
  );
  errors.push(...rank2DeployExecutionErrors);
  if (packet.supplied_rank2_deploy_execution_record && rank2DeployExecutionErrors.length === 0) {
    packet.rank2_deploy_execution_record_status = "valid_deploy_execution_recorded_no_live_smoke";
  }
  packet.rank2_production_live_smoke_template = rank2ProductionLiveSmokeTemplate(packet);
  if (
    packet.rank2_production_live_smoke_template.production_live_smoke_status !== "recorded_production_live_smoke"
    || packet.rank2_production_live_smoke_template.smoke_scope !== "production_live_smoke_only_no_redirect_no_delete"
    || packet.rank2_production_live_smoke_template.route_patch_applied !== true
    || packet.rank2_production_live_smoke_template.post_patch_smoke_executed !== true
    || packet.rank2_production_live_smoke_template.deploy_executed !== true
    || packet.rank2_production_live_smoke_template.production_live_smoke_executed !== true
    || packet.rank2_production_live_smoke_template.public_files_modified !== false
    || packet.rank2_production_live_smoke_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 production live smoke template must stay live-smoke-only/no-redirect-delete/no-public-mutation");
  }
  if (!packet.rank2_production_live_smoke_template.blocked_actions.includes("delete")
    || !packet.rank2_production_live_smoke_template.blocked_actions.includes("redirect")) {
    errors.push("rank2 production live smoke template must keep delete/redirect blocked");
  }
  const rank2ProductionLiveSmokeErrors = validateRank2ProductionLiveSmokeRecord(
    packet.supplied_rank2_production_live_smoke_record,
    packet.rank2_production_live_smoke_template,
    packet,
  );
  errors.push(...rank2ProductionLiveSmokeErrors);
  if (packet.supplied_rank2_production_live_smoke_record && rank2ProductionLiveSmokeErrors.length === 0) {
    packet.rank2_production_live_smoke_record_status = "valid_production_live_smoke_recorded_no_redirect_no_delete";
  }
  packet.rank2_post_live_redirect_delete_approval_request_template = rank2PostLiveRedirectDeleteApprovalRequestTemplate(packet);
  if (
    packet.rank2_post_live_redirect_delete_approval_request_template.request_status !== "requested_no_execution"
    || packet.rank2_post_live_redirect_delete_approval_request_template.request_scope !== "post_live_request_only_no_redirect_no_delete"
    || packet.rank2_post_live_redirect_delete_approval_request_template.route_patch_applied !== true
    || packet.rank2_post_live_redirect_delete_approval_request_template.post_patch_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_approval_request_template.deploy_executed !== true
    || packet.rank2_post_live_redirect_delete_approval_request_template.production_live_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_approval_request_template.redirect_delete_approval_requested !== true
    || packet.rank2_post_live_redirect_delete_approval_request_template.redirect_delete_executed !== false
    || packet.rank2_post_live_redirect_delete_approval_request_template.public_files_modified !== false
    || packet.rank2_post_live_redirect_delete_approval_request_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 post-live redirect/delete approval request template must stay request-only/no-execution/no-public-mutation");
  }
  if (!packet.rank2_post_live_redirect_delete_approval_request_template.blocked_actions.includes("delete")
    || !packet.rank2_post_live_redirect_delete_approval_request_template.blocked_actions.includes("redirect")) {
    errors.push("rank2 post-live redirect/delete approval request template must keep delete/redirect blocked");
  }
  const rank2PostLiveRedirectDeleteApprovalRequestErrors = validateRank2PostLiveRedirectDeleteApprovalRequestRecord(
    packet.supplied_rank2_post_live_redirect_delete_approval_request_record,
    packet.rank2_post_live_redirect_delete_approval_request_template,
    packet,
  );
  errors.push(...rank2PostLiveRedirectDeleteApprovalRequestErrors);
  if (
    packet.supplied_rank2_post_live_redirect_delete_approval_request_record
    && rank2PostLiveRedirectDeleteApprovalRequestErrors.length === 0
  ) {
    packet.rank2_post_live_redirect_delete_approval_request_record_status = "valid_post_live_redirect_delete_approval_requested_no_execution";
  }
  packet.rank2_post_live_redirect_delete_approval_record_template = rank2PostLiveRedirectDeleteApprovalRecordTemplate(packet);
  if (
    packet.rank2_post_live_redirect_delete_approval_record_template.approval_status !== "owner_approved_no_execution"
    || packet.rank2_post_live_redirect_delete_approval_record_template.approval_scope !== "record_only_no_redirect_no_delete"
    || packet.rank2_post_live_redirect_delete_approval_record_template.route_patch_applied !== true
    || packet.rank2_post_live_redirect_delete_approval_record_template.post_patch_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_approval_record_template.deploy_executed !== true
    || packet.rank2_post_live_redirect_delete_approval_record_template.production_live_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_approval_record_template.redirect_delete_approval_requested !== true
    || packet.rank2_post_live_redirect_delete_approval_record_template.redirect_delete_approved !== true
    || packet.rank2_post_live_redirect_delete_approval_record_template.redirect_delete_executed !== false
    || packet.rank2_post_live_redirect_delete_approval_record_template.public_files_modified !== false
    || packet.rank2_post_live_redirect_delete_approval_record_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 post-live redirect/delete approval record template must stay approval-record-only/no-execution/no-public-mutation");
  }
  if (!packet.rank2_post_live_redirect_delete_approval_record_template.blocked_actions.includes("delete")
    || !packet.rank2_post_live_redirect_delete_approval_record_template.blocked_actions.includes("redirect")) {
    errors.push("rank2 post-live redirect/delete approval record template must keep delete/redirect blocked");
  }
  const rank2PostLiveRedirectDeleteApprovalErrors = validateRank2PostLiveRedirectDeleteApprovalRecord(
    packet.supplied_rank2_post_live_redirect_delete_approval_record,
    packet.rank2_post_live_redirect_delete_approval_record_template,
    packet,
  );
  errors.push(...rank2PostLiveRedirectDeleteApprovalErrors);
  if (
    packet.supplied_rank2_post_live_redirect_delete_approval_record
    && rank2PostLiveRedirectDeleteApprovalErrors.length === 0
  ) {
    packet.rank2_post_live_redirect_delete_approval_record_status = "valid_post_live_redirect_delete_approved_no_execution";
  }
  packet.rank2_post_live_redirect_delete_execution_packet_template = rank2PostLiveRedirectDeleteExecutionPacketTemplate(packet);
  if (
    packet.rank2_post_live_redirect_delete_execution_packet_template.execution_packet_status !== "planned_no_execution"
    || packet.rank2_post_live_redirect_delete_execution_packet_template.execution_scope !== "packet_only_no_redirect_no_delete"
    || packet.rank2_post_live_redirect_delete_execution_packet_template.route_patch_applied !== true
    || packet.rank2_post_live_redirect_delete_execution_packet_template.post_patch_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_execution_packet_template.deploy_executed !== true
    || packet.rank2_post_live_redirect_delete_execution_packet_template.production_live_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_execution_packet_template.redirect_delete_approval_requested !== true
    || packet.rank2_post_live_redirect_delete_execution_packet_template.redirect_delete_approved !== true
    || packet.rank2_post_live_redirect_delete_execution_packet_template.redirect_delete_execution_planned !== true
    || packet.rank2_post_live_redirect_delete_execution_packet_template.redirect_delete_executed !== false
    || packet.rank2_post_live_redirect_delete_execution_packet_template.public_files_modified !== false
    || packet.rank2_post_live_redirect_delete_execution_packet_template.redirect_config_changed !== false
  ) {
    errors.push("rank2 post-live redirect/delete execution packet template must stay packet-only/no-execution/no-public-mutation");
  }
  if (!packet.rank2_post_live_redirect_delete_execution_packet_template.blocked_actions.includes("delete")
    || !packet.rank2_post_live_redirect_delete_execution_packet_template.blocked_actions.includes("redirect")) {
    errors.push("rank2 post-live redirect/delete execution packet template must keep delete/redirect blocked");
  }
  const rank2PostLiveRedirectDeleteExecutionPacketErrors = validateRank2PostLiveRedirectDeleteExecutionPacketRecord(
    packet.supplied_rank2_post_live_redirect_delete_execution_packet_record,
    packet.rank2_post_live_redirect_delete_execution_packet_template,
    packet,
  );
  errors.push(...rank2PostLiveRedirectDeleteExecutionPacketErrors);
  if (
    packet.supplied_rank2_post_live_redirect_delete_execution_packet_record
    && rank2PostLiveRedirectDeleteExecutionPacketErrors.length === 0
  ) {
    packet.rank2_post_live_redirect_delete_execution_packet_record_status = "valid_post_live_redirect_delete_execution_packet_recorded_no_execution";
  }
  packet.rank2_post_live_redirect_delete_execution_record_template = rank2PostLiveRedirectDeleteExecutionRecordTemplate(packet);
  if (
    packet.rank2_post_live_redirect_delete_execution_record_template.execution_record_status !== "recorded_redirect_delete_executed"
    || packet.rank2_post_live_redirect_delete_execution_record_template.execution_scope !== "record_only_redirect_delete_execution_evidence"
    || packet.rank2_post_live_redirect_delete_execution_record_template.route_patch_applied !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.post_patch_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.deploy_executed !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.production_live_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.redirect_delete_approval_requested !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.redirect_delete_approved !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.redirect_delete_execution_planned !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.redirect_delete_executed !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.public_files_modified !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.redirect_config_changed !== true
    || packet.rank2_post_live_redirect_delete_execution_record_template.execution_performed_by_this_command !== false
    || packet.rank2_post_live_redirect_delete_execution_record_template.local_files_modified_by_this_command !== false
  ) {
    errors.push("rank2 post-live redirect/delete execution record template must stay record-only/external-execution evidence");
  }
  if (!packet.rank2_post_live_redirect_delete_execution_record_template.blocked_actions.includes("additional_redirect_delete")) {
    errors.push("rank2 post-live redirect/delete execution record template must block additional redirect/delete");
  }
  const rank2PostLiveRedirectDeleteExecutionErrors = validateRank2PostLiveRedirectDeleteExecutionRecord(
    packet.supplied_rank2_post_live_redirect_delete_execution_record,
    packet.rank2_post_live_redirect_delete_execution_record_template,
    packet,
  );
  errors.push(...rank2PostLiveRedirectDeleteExecutionErrors);
  if (
    packet.supplied_rank2_post_live_redirect_delete_execution_record
    && rank2PostLiveRedirectDeleteExecutionErrors.length === 0
  ) {
    packet.rank2_post_live_redirect_delete_execution_record_status = "valid_post_live_redirect_delete_execution_recorded_pending_smoke";
  }
  packet.rank2_post_live_redirect_delete_post_execution_smoke_template = rank2PostLiveRedirectDeletePostExecutionSmokeTemplate(packet);
  if (
    packet.rank2_post_live_redirect_delete_post_execution_smoke_template.post_execution_smoke_status !== "recorded_post_execution_smoke"
    || packet.rank2_post_live_redirect_delete_post_execution_smoke_template.smoke_scope !== "post_execution_smoke_only_no_additional_redirect_delete_no_deploy"
    || packet.rank2_post_live_redirect_delete_post_execution_smoke_template.route_patch_applied !== true
    || packet.rank2_post_live_redirect_delete_post_execution_smoke_template.deploy_executed !== true
    || packet.rank2_post_live_redirect_delete_post_execution_smoke_template.redirect_delete_executed !== true
    || packet.rank2_post_live_redirect_delete_post_execution_smoke_template.post_execution_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_post_execution_smoke_template.smoke_performed_by_this_command !== false
    || packet.rank2_post_live_redirect_delete_post_execution_smoke_template.execution_performed_by_this_command !== false
  ) {
    errors.push("rank2 post-live redirect/delete post-execution smoke template must stay smoke-evidence-only/no-command-mutation");
  }
  if (!packet.rank2_post_live_redirect_delete_post_execution_smoke_template.blocked_actions.includes("additional_redirect_delete")) {
    errors.push("rank2 post-live redirect/delete post-execution smoke template must block additional redirect/delete");
  }
  const rank2PostLiveRedirectDeletePostExecutionSmokeErrors = validateRank2PostLiveRedirectDeletePostExecutionSmokeRecord(
    packet.supplied_rank2_post_live_redirect_delete_post_execution_smoke_record,
    packet.rank2_post_live_redirect_delete_post_execution_smoke_template,
    packet,
  );
  errors.push(...rank2PostLiveRedirectDeletePostExecutionSmokeErrors);
  if (
    packet.supplied_rank2_post_live_redirect_delete_post_execution_smoke_record
    && rank2PostLiveRedirectDeletePostExecutionSmokeErrors.length === 0
  ) {
    packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status = "valid_post_live_redirect_delete_post_execution_smoke_recorded";
  }
  packet.rank2_post_live_redirect_delete_rollback_readiness_template = rank2PostLiveRedirectDeleteRollbackReadinessTemplate(packet);
  if (
    packet.rank2_post_live_redirect_delete_rollback_readiness_template.rollback_readiness_status !== "recorded_rollback_readiness"
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.rollback_scope !== "record_only_rollback_readiness_no_rollback_no_deploy"
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.route_patch_applied !== true
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.deploy_executed !== true
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.redirect_delete_executed !== true
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.post_execution_smoke_executed !== true
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.rollback_ready !== true
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.rollback_applied !== false
    || packet.rank2_post_live_redirect_delete_rollback_readiness_template.rollback_performed_by_this_command !== false
  ) {
    errors.push("rank2 post-live redirect/delete rollback readiness template must stay readiness-only/no-command-rollback");
  }
  if (!packet.rank2_post_live_redirect_delete_rollback_readiness_template.blocked_actions.includes("rollback_execution")) {
    errors.push("rank2 post-live redirect/delete rollback readiness template must block rollback execution");
  }
  const rank2PostLiveRedirectDeleteRollbackReadinessErrors = validateRank2PostLiveRedirectDeleteRollbackReadinessRecord(
    packet.supplied_rank2_post_live_redirect_delete_rollback_readiness_record,
    packet.rank2_post_live_redirect_delete_rollback_readiness_template,
    packet,
  );
  errors.push(...rank2PostLiveRedirectDeleteRollbackReadinessErrors);
  if (
    packet.supplied_rank2_post_live_redirect_delete_rollback_readiness_record
    && rank2PostLiveRedirectDeleteRollbackReadinessErrors.length === 0
  ) {
    packet.rank2_post_live_redirect_delete_rollback_readiness_record_status = "valid_post_live_redirect_delete_rollback_readiness_recorded";
  }
  packet.rank2_post_live_redirect_delete_owner_closeout_template = rank2PostLiveRedirectDeleteOwnerCloseoutTemplate(packet);
  if (
    packet.rank2_post_live_redirect_delete_owner_closeout_template.owner_closeout_status !== "recorded_owner_closeout"
    || packet.rank2_post_live_redirect_delete_owner_closeout_template.closeout_scope !== "record_only_owner_closeout_no_additional_runtime"
    || packet.rank2_post_live_redirect_delete_owner_closeout_template.rollback_ready !== true
    || packet.rank2_post_live_redirect_delete_owner_closeout_template.rollback_applied !== false
    || packet.rank2_post_live_redirect_delete_owner_closeout_template.owner_closeout_accepted !== true
    || packet.rank2_post_live_redirect_delete_owner_closeout_template.additional_runtime_required !== false
    || packet.rank2_post_live_redirect_delete_owner_closeout_template.closeout_performed_by_this_command !== false
    || packet.rank2_post_live_redirect_delete_owner_closeout_template.next_required_runtime_gate !== "none_record_chain_closed"
  ) {
    errors.push("rank2 post-live redirect/delete owner closeout template must stay closeout-only/no-additional-runtime");
  }
  if (!packet.rank2_post_live_redirect_delete_owner_closeout_template.blocked_actions.includes("rollback_execution")) {
    errors.push("rank2 post-live redirect/delete owner closeout template must keep rollback execution blocked");
  }
  const rank2PostLiveRedirectDeleteOwnerCloseoutErrors = validateRank2PostLiveRedirectDeleteOwnerCloseoutRecord(
    packet.supplied_rank2_post_live_redirect_delete_owner_closeout_record,
    packet.rank2_post_live_redirect_delete_owner_closeout_template,
    packet,
  );
  errors.push(...rank2PostLiveRedirectDeleteOwnerCloseoutErrors);
  if (
    packet.supplied_rank2_post_live_redirect_delete_owner_closeout_record
    && rank2PostLiveRedirectDeleteOwnerCloseoutErrors.length === 0
  ) {
    packet.rank2_post_live_redirect_delete_owner_closeout_record_status = "valid_post_live_redirect_delete_owner_closeout_recorded";
  }
  packet.current_next_required_gate = currentNextRequiredGate(packet);
  errors.push(...validateCurrentNextRequiredGate(packet));
  packet.rank2_fresh_owner_runtime_packet_template = rank2FreshOwnerRuntimePacketTemplate(packet);
  const rank2FreshOwnerRuntimePacketErrors = validateRank2FreshOwnerRuntimePacketRecord(
    packet.supplied_rank2_fresh_owner_runtime_packet_record,
    packet.rank2_fresh_owner_runtime_packet_template,
    packet,
  );
  errors.push(...rank2FreshOwnerRuntimePacketErrors);
  if (
    packet.supplied_rank2_fresh_owner_runtime_packet_record
    && rank2FreshOwnerRuntimePacketErrors.length === 0
  ) {
    packet.rank2_fresh_owner_runtime_packet_record_status = "valid_fresh_owner_runtime_packet_recorded_no_execution";
  }
  packet.rank2_fresh_owner_runtime_execution_packet_template = rank2FreshOwnerRuntimeExecutionPacketTemplate(packet);
  const rank2FreshOwnerRuntimeExecutionPacketErrors = validateRank2FreshOwnerRuntimeExecutionPacketRecord(
    packet.supplied_rank2_fresh_owner_runtime_execution_packet_record,
    packet.rank2_fresh_owner_runtime_execution_packet_template,
    packet,
  );
  errors.push(...rank2FreshOwnerRuntimeExecutionPacketErrors);
  if (
    packet.supplied_rank2_fresh_owner_runtime_execution_packet_record
    && rank2FreshOwnerRuntimeExecutionPacketErrors.length === 0
  ) {
    packet.rank2_fresh_owner_runtime_execution_packet_record_status = "valid_fresh_owner_runtime_execution_packet_recorded_no_execution";
  }
  packet.rank2_fresh_owner_external_runtime_execution_evidence_template = rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate(packet);
  const rank2FreshOwnerExternalRuntimeExecutionEvidenceErrors = validateRank2FreshOwnerExternalRuntimeExecutionEvidenceRecord(
    packet.supplied_rank2_fresh_owner_external_runtime_execution_evidence_record,
    packet.rank2_fresh_owner_external_runtime_execution_evidence_template,
    packet,
  );
  errors.push(...rank2FreshOwnerExternalRuntimeExecutionEvidenceErrors);
  if (
    packet.supplied_rank2_fresh_owner_external_runtime_execution_evidence_record
    && rank2FreshOwnerExternalRuntimeExecutionEvidenceErrors.length === 0
  ) {
    packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status = "valid_fresh_owner_external_runtime_execution_evidence_recorded_pending_smoke";
  }
  packet.rank2_fresh_owner_post_runtime_smoke_evidence_template = rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate(packet);
  const rank2FreshOwnerPostRuntimeSmokeEvidenceErrors = validateRank2FreshOwnerPostRuntimeSmokeEvidenceRecord(
    packet.supplied_rank2_fresh_owner_post_runtime_smoke_evidence_record,
    packet.rank2_fresh_owner_post_runtime_smoke_evidence_template,
    packet,
  );
  errors.push(...rank2FreshOwnerPostRuntimeSmokeEvidenceErrors);
  if (
    packet.supplied_rank2_fresh_owner_post_runtime_smoke_evidence_record
    && rank2FreshOwnerPostRuntimeSmokeEvidenceErrors.length === 0
  ) {
    packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status = "valid_fresh_owner_post_runtime_smoke_evidence_recorded_pending_rollback";
  }
  packet.rank2_fresh_owner_rollback_readiness_template = rank2FreshOwnerRollbackReadinessTemplate(packet);
  const rank2FreshOwnerRollbackReadinessErrors = validateRank2FreshOwnerRollbackReadinessRecord(
    packet.supplied_rank2_fresh_owner_rollback_readiness_record,
    packet.rank2_fresh_owner_rollback_readiness_template,
    packet,
  );
  errors.push(...rank2FreshOwnerRollbackReadinessErrors);
  if (
    packet.supplied_rank2_fresh_owner_rollback_readiness_record
    && rank2FreshOwnerRollbackReadinessErrors.length === 0
  ) {
    packet.rank2_fresh_owner_rollback_readiness_record_status = "valid_fresh_owner_rollback_readiness_recorded_pending_closeout";
  }
  packet.rank2_fresh_owner_owner_closeout_template = rank2FreshOwnerOwnerCloseoutTemplate(packet);
  if (
    packet.rank2_fresh_owner_owner_closeout_template.owner_closeout_status !== "recorded_fresh_owner_owner_closeout"
    || packet.rank2_fresh_owner_owner_closeout_template.closeout_scope !== "record_only_owner_closeout_no_additional_runtime"
    || packet.rank2_fresh_owner_owner_closeout_template.rollback_ready !== true
    || packet.rank2_fresh_owner_owner_closeout_template.rollback_applied !== false
    || packet.rank2_fresh_owner_owner_closeout_template.owner_closeout_accepted !== true
    || packet.rank2_fresh_owner_owner_closeout_template.additional_runtime_required !== false
    || packet.rank2_fresh_owner_owner_closeout_template.closeout_performed_by_this_command !== false
    || packet.rank2_fresh_owner_owner_closeout_template.next_required_runtime_gate !== "none_record_chain_closed"
  ) {
    errors.push("rank2 fresh owner owner closeout template must stay closeout-only/no-additional-runtime");
  }
  if (!packet.rank2_fresh_owner_owner_closeout_template.blocked_actions.includes("rollback_execution")) {
    errors.push("rank2 fresh owner owner closeout template must keep rollback execution blocked");
  }
  const rank2FreshOwnerOwnerCloseoutErrors = validateRank2FreshOwnerOwnerCloseoutRecord(
    packet.supplied_rank2_fresh_owner_owner_closeout_record,
    packet.rank2_fresh_owner_owner_closeout_template,
    packet,
  );
  errors.push(...rank2FreshOwnerOwnerCloseoutErrors);
  if (
    packet.supplied_rank2_fresh_owner_owner_closeout_record
    && rank2FreshOwnerOwnerCloseoutErrors.length === 0
  ) {
    packet.rank2_fresh_owner_owner_closeout_record_status = "valid_fresh_owner_owner_closeout_recorded";
  }
  packet.current_next_required_gate = currentNextRequiredGate(packet);
  errors.push(...validateCurrentNextRequiredGate(packet));
  packet.reporting_summary = reportingSummary(packet);
  errors.push(...validateReportingSummary(packet));
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
  console.log(`rank2_owner_decision_record_status=${packet.rank2_owner_decision_record_status}`);
  console.log(`rank2_owner_followup_record_status=${packet.rank2_owner_followup_record_status}`);
  console.log(`rank2_mutation_approval_readiness=${packet.rank2_mutation_approval_readiness.status}`);
  console.log(`rank2_mutation_approval_request_template=${packet.rank2_mutation_approval_request_template.status}`);
  console.log(`rank2_mutation_approval_record_status=${packet.rank2_mutation_approval_record_status}`);
  console.log(`rank2_route_diff_proposal_record_status=${packet.rank2_route_diff_proposal_record_status}`);
  console.log(`rank2_rollback_plan_record_status=${packet.rank2_rollback_plan_record_status}`);
  console.log(`rank2_local_post_patch_smoke_plan_record_status=${packet.rank2_local_post_patch_smoke_plan_record_status}`);
  console.log(`rank2_explicit_deploy_approval_record_status=${packet.rank2_explicit_deploy_approval_record_status}`);
  console.log(`rank2_route_execution_packet_record_status=${packet.rank2_route_execution_packet_record_status}`);
  console.log(`rank2_owner_runtime_release_record_status=${packet.rank2_owner_runtime_release_record_status}`);
  console.log(`rank2_route_patch_application_record_status=${packet.rank2_route_patch_application_record_status}`);
  console.log(`rank2_local_post_patch_smoke_record_status=${packet.rank2_local_post_patch_smoke_record_status}`);
  console.log(`rank2_deploy_execution_record_status=${packet.rank2_deploy_execution_record_status}`);
  console.log(`rank2_production_live_smoke_record_status=${packet.rank2_production_live_smoke_record_status}`);
  console.log(`rank2_post_live_redirect_delete_approval_request_record_status=${packet.rank2_post_live_redirect_delete_approval_request_record_status}`);
  console.log(`rank2_post_live_redirect_delete_approval_record_status=${packet.rank2_post_live_redirect_delete_approval_record_status}`);
  console.log(`rank2_post_live_redirect_delete_execution_packet_record_status=${packet.rank2_post_live_redirect_delete_execution_packet_record_status}`);
  console.log(`rank2_post_live_redirect_delete_execution_record_status=${packet.rank2_post_live_redirect_delete_execution_record_status}`);
  console.log(`rank2_post_live_redirect_delete_post_execution_smoke_record_status=${packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status}`);
  console.log(`rank2_post_live_redirect_delete_rollback_readiness_record_status=${packet.rank2_post_live_redirect_delete_rollback_readiness_record_status}`);
  console.log(`rank2_post_live_redirect_delete_owner_closeout_record_status=${packet.rank2_post_live_redirect_delete_owner_closeout_record_status}`);
  console.log(`rank2_fresh_owner_runtime_packet_record_status=${packet.rank2_fresh_owner_runtime_packet_record_status}`);
  console.log(`rank2_fresh_owner_runtime_execution_packet_record_status=${packet.rank2_fresh_owner_runtime_execution_packet_record_status}`);
  console.log(`rank2_fresh_owner_external_runtime_execution_evidence_record_status=${packet.rank2_fresh_owner_external_runtime_execution_evidence_record_status}`);
  console.log(`rank2_fresh_owner_post_runtime_smoke_evidence_record_status=${packet.rank2_fresh_owner_post_runtime_smoke_evidence_record_status}`);
  console.log(`rank2_fresh_owner_rollback_readiness_record_status=${packet.rank2_fresh_owner_rollback_readiness_record_status}`);
  console.log(`rank2_fresh_owner_owner_closeout_record_status=${packet.rank2_fresh_owner_owner_closeout_record_status}`);
  console.log(`rank2_execution_readiness=${packet.rank2_execution_readiness.status}`);
  console.log(`local_live_equivalence=${packet.evidence.local_live_equivalence_proof_status} rows=${packet.evidence.local_live_equivalence_rows_checked}/${packet.evidence.local_live_equivalence_rows_expected}`);
  console.log(`local_live_equivalence_row_set=locked rows=${packet.evidence.smoke_rows.length}`);
  console.log(`home_dashboard_entrypoint_set=locked rows=${packet.evidence.home_dashboard_legacy_bridge_entrypoint_rows.length}`);
  console.log(`src_legacy_reference_set=locked rows=${packet.evidence.src_legacy_reference_rows.length}`);
  console.log(`decision_scope=locked options=${packet.decision_options.length} blockers=${packet.release_blockers.length}`);
  console.log(`decision_followup_plan_set=locked plans=${packet.decision_followup_plans.length}`);
  console.log(`pro_route_ia_acceptance_checks=locked checks=${packet.owner_decision_acceptance_contract.required_pro_route_ia_acceptance_checks.length}`);
  console.log(`decision_followup_pro_route_ia_checks=locked templates=${packet.decision_followup_record_templates.length}`);
  console.log(`next_gated_slice=${packet.next_gated_slice.id}`);
  console.log(`current_next_required_gate=${packet.current_next_required_gate.id}`);
  console.log(`current_next_required_gate_status=${packet.current_next_required_gate.status}`);
  console.log(`reporting_summary=${packet.reporting_summary.schema_version} next=${packet.reporting_summary.next_gated_slice} current=${packet.reporting_summary.current_next_required_gate} safe_slices=${packet.reporting_summary.safe_enforcement_slice_count}`);
  console.log(`reporting_summary_current_gate_checklist=${packet.reporting_summary.current_gate_checklist.gate} checks=${packet.reporting_summary.current_gate_checklist.checks.length}`);
  console.log(`reporting_summary_current_safe_slice=${packet.reporting_summary.current_safe_enforcement_slice_id ?? "none"}`);
  console.log(`reporting_summary_safe_slice_details=${packet.reporting_summary.safe_enforcement_slice_details.length}`);
  console.log(`reporting_summary_live_equivalence_rows=${packet.reporting_summary.local_live_equivalence.rows.length}/${packet.reporting_summary.local_live_equivalence.rows_expected}`);
  console.log(`reporting_summary_pro_check_ids=${packet.reporting_summary.pro_route_ia_acceptance.check_details.map((check) => check.id).join(",")}`);
  console.log(`reporting_summary_pro_file_lines=${packet.reporting_summary.pro_route_ia_acceptance.file_line_evidence.join(",")}`);
  console.log(`reporting_summary_home_dashboard_file_lines=${packet.reporting_summary.home_dashboard_entrypoint_file_lines.join(",")}`);
  console.log(`reporting_summary_source_reference_file_lines=${packet.reporting_summary.source_reference_file_lines.join(",")}`);
  console.log("reporting_summary_command=node scripts/build-macro-owner-decision-packet.mjs --reporting-summary");
  console.log(`reporting_summary_owner_input_contract=${packet.reporting_summary.owner_decision_input_contract.schema_version} record_schema=${packet.reporting_summary.owner_decision_input_contract.required_record_schema} required_fields=${packet.reporting_summary.owner_decision_input_contract.required_record_fields.length} template="${packet.reporting_summary.owner_decision_input_contract.template_command}"`);
  if (packet.current_next_required_gate.required_followup_record_template) {
    console.log(`current_gate_followup_template=locked followup=${packet.current_next_required_gate.required_followup_record_template.followup_id}`);
  }
  if (packet.current_next_required_gate.required_rank2_pre_activation_record_template) {
    console.log(`current_gate_rank2_pre_activation_template=locked schema=${packet.current_next_required_gate.required_rank2_pre_activation_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_owner_decision_record_template) {
    console.log(`current_gate_rank2_owner_decision_template=locked schema=${packet.current_next_required_gate.required_rank2_owner_decision_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_owner_followup_record_template) {
    console.log(`current_gate_rank2_owner_followup_template=locked followup=${packet.current_next_required_gate.required_rank2_owner_followup_record_template.followup_id}`);
  }
  if (packet.current_next_required_gate.required_rank2_mutation_approval_record_template) {
    console.log(`current_gate_rank2_mutation_approval_template=locked schema=${packet.current_next_required_gate.required_rank2_mutation_approval_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_route_diff_proposal_record_template) {
    console.log(`current_gate_rank2_route_diff_proposal_template=locked schema=${packet.current_next_required_gate.required_rank2_route_diff_proposal_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_rollback_plan_record_template) {
    console.log(`current_gate_rank2_rollback_plan_template=locked schema=${packet.current_next_required_gate.required_rank2_rollback_plan_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_local_post_patch_smoke_plan_record_template) {
    console.log(`current_gate_rank2_local_post_patch_smoke_plan_template=locked schema=${packet.current_next_required_gate.required_rank2_local_post_patch_smoke_plan_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_explicit_deploy_approval_record_template) {
    console.log(`current_gate_rank2_explicit_deploy_approval_template=locked schema=${packet.current_next_required_gate.required_rank2_explicit_deploy_approval_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_route_execution_packet_record_template) {
    console.log(`current_gate_rank2_route_execution_packet_template=locked schema=${packet.current_next_required_gate.required_rank2_route_execution_packet_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_owner_runtime_release_record_template) {
    console.log(`current_gate_rank2_owner_runtime_release_template=locked schema=${packet.current_next_required_gate.required_rank2_owner_runtime_release_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_route_patch_application_record_template) {
    console.log(`current_gate_rank2_route_patch_application_template=locked schema=${packet.current_next_required_gate.required_rank2_route_patch_application_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_local_post_patch_smoke_record_template) {
    console.log(`current_gate_rank2_local_post_patch_smoke_template=locked schema=${packet.current_next_required_gate.required_rank2_local_post_patch_smoke_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_deploy_execution_record_template) {
    console.log(`current_gate_rank2_deploy_execution_template=locked schema=${packet.current_next_required_gate.required_rank2_deploy_execution_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_production_live_smoke_record_template) {
    console.log(`current_gate_rank2_production_live_smoke_template=locked schema=${packet.current_next_required_gate.required_rank2_production_live_smoke_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_post_live_redirect_delete_approval_request_record_template) {
    console.log(`current_gate_rank2_post_live_redirect_delete_approval_request_template=locked schema=${packet.current_next_required_gate.required_rank2_post_live_redirect_delete_approval_request_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_post_live_redirect_delete_approval_record_template) {
    console.log(`current_gate_rank2_post_live_redirect_delete_approval_record_template=locked schema=${packet.current_next_required_gate.required_rank2_post_live_redirect_delete_approval_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_post_live_redirect_delete_execution_packet_record_template) {
    console.log(`current_gate_rank2_post_live_redirect_delete_execution_packet_template=locked schema=${packet.current_next_required_gate.required_rank2_post_live_redirect_delete_execution_packet_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_post_live_redirect_delete_execution_record_template) {
    console.log(`current_gate_rank2_post_live_redirect_delete_execution_record_template=locked schema=${packet.current_next_required_gate.required_rank2_post_live_redirect_delete_execution_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template) {
    console.log(`current_gate_rank2_post_live_redirect_delete_post_execution_smoke_template=locked schema=${packet.current_next_required_gate.required_rank2_post_live_redirect_delete_post_execution_smoke_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template) {
    console.log(`current_gate_rank2_post_live_redirect_delete_rollback_readiness_template=locked schema=${packet.current_next_required_gate.required_rank2_post_live_redirect_delete_rollback_readiness_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template) {
    console.log(`current_gate_rank2_post_live_redirect_delete_owner_closeout_template=locked schema=${packet.current_next_required_gate.required_rank2_post_live_redirect_delete_owner_closeout_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.next_required_owner_packet?.required_contract) {
    console.log(`current_gate_fresh_owner_packet_contract=locked id=${packet.current_next_required_gate.next_required_owner_packet.required_contract.id}`);
  }
  if (packet.current_next_required_gate.required_rank2_fresh_owner_runtime_execution_packet_record_template) {
    console.log(`current_gate_rank2_fresh_owner_runtime_execution_packet_template=locked schema=${packet.current_next_required_gate.required_rank2_fresh_owner_runtime_execution_packet_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template) {
    console.log(`current_gate_rank2_fresh_owner_external_runtime_execution_evidence_template=locked schema=${packet.current_next_required_gate.required_rank2_fresh_owner_external_runtime_execution_evidence_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template) {
    console.log(`current_gate_rank2_fresh_owner_post_runtime_smoke_evidence_template=locked schema=${packet.current_next_required_gate.required_rank2_fresh_owner_post_runtime_smoke_evidence_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_fresh_owner_rollback_readiness_record_template) {
    console.log(`current_gate_rank2_fresh_owner_rollback_readiness_template=locked schema=${packet.current_next_required_gate.required_rank2_fresh_owner_rollback_readiness_record_template.schema_version}`);
  }
  if (packet.current_next_required_gate.required_rank2_fresh_owner_owner_closeout_record_template) {
    console.log(`current_gate_rank2_fresh_owner_owner_closeout_template=locked schema=${packet.current_next_required_gate.required_rank2_fresh_owner_owner_closeout_record_template.schema_version}`);
  }
  console.log(`next_owner_action=${packet.next_owner_action.id}`);
  console.log(`next_owner_action_status=${packet.next_owner_action.status}`);
  console.log(`owner_decision_acceptance_contract=${packet.owner_decision_acceptance_contract.id}`);
  console.log(`owner_decision_acceptance_contract_status=${packet.owner_decision_acceptance_contract.status}`);
  console.log(`safe_enforcement_slices=${packet.safe_enforcement_slices.map((slice) => slice.id).join(",")}`);
  console.log(`decision_followup_plans=${packet.decision_followup_plans.map((plan) => plan.id).join(",")}`);
  console.log(`rank2_owner_followup_plans=${packet.rank2_owner_followup_plans.map((plan) => plan.id).join(",")}`);
  if (packet.selected_decision_followup) {
    console.log(`selected_decision_followup=${packet.selected_decision_followup.id}`);
  }
  if (packet.selected_rank2_owner_followup) {
    console.log(`selected_rank2_owner_followup=${packet.selected_rank2_owner_followup.id}`);
  }
  console.log(`inactive_next_candidate_preview=${packet.inactive_next_candidate_preview.candidate.family_id}`);
  console.log(`inactive_next_candidate_prep_rows=${packet.inactive_next_candidate_preview.live_equivalence_prep.rows.length}`);
  console.log(`rank2_pre_activation_record_template=${packet.inactive_next_candidate_preview.live_equivalence_prep.record_template.schema_version}`);
  console.log("decision_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --decision-record-template");
  console.log("rank2_pre_activation_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-pre-activation-template");
  console.log("rank2_owner_decision_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-owner-decision-record-template");
  console.log("rank2_owner_followup_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-owner-followup-record-template");
  console.log("rank2_mutation_approval_request_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-mutation-approval-request-template");
  console.log("rank2_mutation_approval_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-mutation-approval-record-template");
  console.log("rank2_route_diff_proposal_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-route-diff-proposal-template");
  console.log("rank2_rollback_plan_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-rollback-plan-template");
  console.log("rank2_local_post_patch_smoke_plan_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-local-post-patch-smoke-plan-template");
  console.log("rank2_explicit_deploy_approval_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-explicit-deploy-approval-template");
  console.log("rank2_route_execution_packet_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-route-execution-packet-template");
  console.log("rank2_owner_runtime_release_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-owner-runtime-release-template");
  console.log("rank2_route_patch_application_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-route-patch-application-template");
  console.log("rank2_local_post_patch_smoke_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-local-post-patch-smoke-record-template");
  console.log("rank2_deploy_execution_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-deploy-execution-template");
  console.log("rank2_production_live_smoke_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-production-live-smoke-template");
  console.log("rank2_post_live_redirect_delete_approval_request_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-approval-request-template");
  console.log("rank2_post_live_redirect_delete_approval_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-approval-record-template");
  console.log("rank2_post_live_redirect_delete_execution_packet_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-execution-packet-template");
  console.log("rank2_post_live_redirect_delete_execution_record_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-execution-record-template");
  console.log("rank2_post_live_redirect_delete_post_execution_smoke_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-post-execution-smoke-template");
  console.log("rank2_post_live_redirect_delete_rollback_readiness_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-rollback-readiness-template");
  console.log("rank2_post_live_redirect_delete_owner_closeout_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-post-live-redirect-delete-owner-closeout-template");
  console.log("rank2_fresh_owner_runtime_packet_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-packet-template");
  console.log("rank2_fresh_owner_runtime_execution_packet_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-runtime-execution-packet-template");
  console.log("rank2_fresh_owner_external_runtime_execution_evidence_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-external-runtime-execution-evidence-template");
  console.log("rank2_fresh_owner_post_runtime_smoke_evidence_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-post-runtime-smoke-evidence-template");
  console.log("rank2_fresh_owner_rollback_readiness_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-rollback-readiness-template");
  console.log("rank2_fresh_owner_owner_closeout_template_command=node scripts/build-macro-owner-decision-packet.mjs --rank2-fresh-owner-owner-closeout-template");
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
  let rank2OwnerDecisionRecord;
  let rank2OwnerFollowupRecord;
  let rank2MutationApprovalRecord;
  let rank2RouteDiffProposalRecord;
  let rank2RollbackPlanRecord;
  let rank2LocalPostPatchSmokePlanRecord;
  let rank2ExplicitDeployApprovalRecord;
  let rank2RouteExecutionPacketRecord;
  let rank2OwnerRuntimeReleaseRecord;
  let rank2RoutePatchApplicationRecord;
  let rank2LocalPostPatchSmokeRecord;
  let rank2DeployExecutionRecord;
  let rank2ProductionLiveSmokeRecord;
  let rank2PostLiveRedirectDeleteApprovalRequestRecord;
  let rank2PostLiveRedirectDeleteApprovalRecord;
  let rank2PostLiveRedirectDeleteExecutionPacketRecord;
  let rank2PostLiveRedirectDeleteExecutionRecord;
  let rank2PostLiveRedirectDeletePostExecutionSmokeRecord;
  let rank2PostLiveRedirectDeleteRollbackReadinessRecord;
  let rank2PostLiveRedirectDeleteOwnerCloseoutRecord;
  let rank2FreshOwnerRuntimePacketRecord;
  let rank2FreshOwnerRuntimeExecutionPacketRecord;
  let rank2FreshOwnerExternalRuntimeExecutionEvidenceRecord;
  let rank2FreshOwnerPostRuntimeSmokeEvidenceRecord;
  let rank2FreshOwnerRollbackReadinessRecord;
  let rank2FreshOwnerOwnerCloseoutRecord;
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
  try {
    rank2OwnerDecisionRecord = readDecisionRecord(args.rank2OwnerDecisionRecordPath, args.rank2OwnerDecisionRecordJson);
  } catch (error) {
    fail(`rank2 owner decision record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2OwnerFollowupRecord = readDecisionRecord(args.rank2OwnerFollowupRecordPath, args.rank2OwnerFollowupRecordJson);
  } catch (error) {
    fail(`rank2 owner followup record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2MutationApprovalRecord = readDecisionRecord(args.rank2MutationApprovalRecordPath, args.rank2MutationApprovalRecordJson);
  } catch (error) {
    fail(`rank2 mutation approval record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2RouteDiffProposalRecord = readDecisionRecord(args.rank2RouteDiffProposalRecordPath, args.rank2RouteDiffProposalRecordJson);
  } catch (error) {
    fail(`rank2 route diff proposal record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2RollbackPlanRecord = readDecisionRecord(args.rank2RollbackPlanRecordPath, args.rank2RollbackPlanRecordJson);
  } catch (error) {
    fail(`rank2 rollback plan record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2LocalPostPatchSmokePlanRecord = readDecisionRecord(args.rank2LocalPostPatchSmokePlanRecordPath, args.rank2LocalPostPatchSmokePlanRecordJson);
  } catch (error) {
    fail(`rank2 local post-patch smoke plan record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2ExplicitDeployApprovalRecord = readDecisionRecord(args.rank2ExplicitDeployApprovalRecordPath, args.rank2ExplicitDeployApprovalRecordJson);
  } catch (error) {
    fail(`rank2 explicit deploy approval record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2RouteExecutionPacketRecord = readDecisionRecord(args.rank2RouteExecutionPacketRecordPath, args.rank2RouteExecutionPacketRecordJson);
  } catch (error) {
    fail(`rank2 route execution packet record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2OwnerRuntimeReleaseRecord = readDecisionRecord(args.rank2OwnerRuntimeReleaseRecordPath, args.rank2OwnerRuntimeReleaseRecordJson);
  } catch (error) {
    fail(`rank2 owner runtime release record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2RoutePatchApplicationRecord = readDecisionRecord(args.rank2RoutePatchApplicationRecordPath, args.rank2RoutePatchApplicationRecordJson);
  } catch (error) {
    fail(`rank2 route patch application record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2LocalPostPatchSmokeRecord = readDecisionRecord(args.rank2LocalPostPatchSmokeRecordPath, args.rank2LocalPostPatchSmokeRecordJson);
  } catch (error) {
    fail(`rank2 local post-patch smoke record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2DeployExecutionRecord = readDecisionRecord(args.rank2DeployExecutionRecordPath, args.rank2DeployExecutionRecordJson);
  } catch (error) {
    fail(`rank2 deploy execution record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2ProductionLiveSmokeRecord = readDecisionRecord(args.rank2ProductionLiveSmokeRecordPath, args.rank2ProductionLiveSmokeRecordJson);
  } catch (error) {
    fail(`rank2 production live smoke record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PostLiveRedirectDeleteApprovalRequestRecord = readDecisionRecord(
      args.rank2PostLiveRedirectDeleteApprovalRequestRecordPath,
      args.rank2PostLiveRedirectDeleteApprovalRequestRecordJson,
    );
  } catch (error) {
    fail(`rank2 post-live redirect/delete approval request record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PostLiveRedirectDeleteApprovalRecord = readDecisionRecord(
      args.rank2PostLiveRedirectDeleteApprovalRecordPath,
      args.rank2PostLiveRedirectDeleteApprovalRecordJson,
    );
  } catch (error) {
    fail(`rank2 post-live redirect/delete approval record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PostLiveRedirectDeleteExecutionPacketRecord = readDecisionRecord(
      args.rank2PostLiveRedirectDeleteExecutionPacketRecordPath,
      args.rank2PostLiveRedirectDeleteExecutionPacketRecordJson,
    );
  } catch (error) {
    fail(`rank2 post-live redirect/delete execution packet read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PostLiveRedirectDeleteExecutionRecord = readDecisionRecord(
      args.rank2PostLiveRedirectDeleteExecutionRecordPath,
      args.rank2PostLiveRedirectDeleteExecutionRecordJson,
    );
  } catch (error) {
    fail(`rank2 post-live redirect/delete execution record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PostLiveRedirectDeletePostExecutionSmokeRecord = readDecisionRecord(
      args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordPath,
      args.rank2PostLiveRedirectDeletePostExecutionSmokeRecordJson,
    );
  } catch (error) {
    fail(`rank2 post-live redirect/delete post-execution smoke record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PostLiveRedirectDeleteRollbackReadinessRecord = readDecisionRecord(
      args.rank2PostLiveRedirectDeleteRollbackReadinessRecordPath,
      args.rank2PostLiveRedirectDeleteRollbackReadinessRecordJson,
    );
  } catch (error) {
    fail(`rank2 post-live redirect/delete rollback readiness record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2PostLiveRedirectDeleteOwnerCloseoutRecord = readDecisionRecord(
      args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordPath,
      args.rank2PostLiveRedirectDeleteOwnerCloseoutRecordJson,
    );
  } catch (error) {
    fail(`rank2 post-live redirect/delete owner closeout record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2FreshOwnerRuntimePacketRecord = readDecisionRecord(
      args.rank2FreshOwnerRuntimePacketRecordPath,
      args.rank2FreshOwnerRuntimePacketRecordJson,
    );
  } catch (error) {
    fail(`rank2 fresh owner runtime packet record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2FreshOwnerRuntimeExecutionPacketRecord = readDecisionRecord(
      args.rank2FreshOwnerRuntimeExecutionPacketRecordPath,
      args.rank2FreshOwnerRuntimeExecutionPacketRecordJson,
    );
  } catch (error) {
    fail(`rank2 fresh owner runtime execution packet record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2FreshOwnerExternalRuntimeExecutionEvidenceRecord = readDecisionRecord(
      args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordPath,
      args.rank2FreshOwnerExternalRuntimeExecutionEvidenceRecordJson,
    );
  } catch (error) {
    fail(`rank2 fresh owner external runtime execution evidence record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2FreshOwnerPostRuntimeSmokeEvidenceRecord = readDecisionRecord(
      args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordPath,
      args.rank2FreshOwnerPostRuntimeSmokeEvidenceRecordJson,
    );
  } catch (error) {
    fail(`rank2 fresh owner post-runtime smoke evidence record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2FreshOwnerRollbackReadinessRecord = readDecisionRecord(
      args.rank2FreshOwnerRollbackReadinessRecordPath,
      args.rank2FreshOwnerRollbackReadinessRecordJson,
    );
  } catch (error) {
    fail(`rank2 fresh owner rollback readiness record read/parse failed: ${errorMessage(error)}`, null, false);
  }
  try {
    rank2FreshOwnerOwnerCloseoutRecord = readDecisionRecord(
      args.rank2FreshOwnerOwnerCloseoutRecordPath,
      args.rank2FreshOwnerOwnerCloseoutRecordJson,
    );
  } catch (error) {
    fail(`rank2 fresh owner owner closeout record read/parse failed: ${errorMessage(error)}`, null, false);
  }

  const packet = buildDecisionPacket(
    inventory,
    liveProof,
    decisionRecord,
    decisionFollowupRecord,
    rank2PreActivationRecord,
    rank2OwnerDecisionRecord,
    rank2OwnerFollowupRecord,
    rank2MutationApprovalRecord,
    rank2RouteDiffProposalRecord,
    rank2RollbackPlanRecord,
    rank2LocalPostPatchSmokePlanRecord,
    rank2ExplicitDeployApprovalRecord,
    rank2RouteExecutionPacketRecord,
    rank2OwnerRuntimeReleaseRecord,
    rank2RoutePatchApplicationRecord,
    rank2LocalPostPatchSmokeRecord,
    rank2DeployExecutionRecord,
    rank2ProductionLiveSmokeRecord,
    rank2PostLiveRedirectDeleteApprovalRequestRecord,
    rank2PostLiveRedirectDeleteApprovalRecord,
    rank2PostLiveRedirectDeleteExecutionPacketRecord,
    rank2PostLiveRedirectDeleteExecutionRecord,
    rank2PostLiveRedirectDeletePostExecutionSmokeRecord,
    rank2PostLiveRedirectDeleteRollbackReadinessRecord,
    rank2PostLiveRedirectDeleteOwnerCloseoutRecord,
    rank2FreshOwnerRuntimePacketRecord,
    rank2FreshOwnerRuntimeExecutionPacketRecord,
    rank2FreshOwnerExternalRuntimeExecutionEvidenceRecord,
    rank2FreshOwnerPostRuntimeSmokeEvidenceRecord,
    rank2FreshOwnerRollbackReadinessRecord,
    rank2FreshOwnerOwnerCloseoutRecord,
  );
  const errors = validatePacket(packet);

  if (errors.length > 0) {
    fail(`failed (${errors.length} violation(s)): ${errors.join("; ")}`, packet, args.json);
  }

  if (args.reportingSummary) {
    console.log(JSON.stringify(packet.reporting_summary, null, 2));
    return;
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

  if (args.rank2OwnerDecisionRecordTemplate) {
    if (!packet.rank2_review_readiness.ready_for_rank2_owner_review) {
      fail("--rank2-owner-decision-record-template requires rank2_review_readiness=ready_for_rank2_owner_review_no_mutation", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_owner_review_template.decision_record_template, null, 2));
    return;
  }

  if (args.rank2OwnerFollowupRecordTemplate) {
    if (!packet.selected_rank2_owner_followup) {
      fail("--rank2-owner-followup-record-template requires a valid --rank2-owner-decision-record/--rank2-owner-decision-record-json", packet, args.json);
    }
    const template = packet.rank2_owner_followup_record_templates.find((item) => item.followup_id === packet.selected_rank2_owner_followup.id);
    console.log(JSON.stringify(template, null, 2));
    return;
  }

  if (args.rank2MutationApprovalRequestTemplate) {
    if (!packet.rank2_mutation_approval_readiness.ready_for_mutation_approval_request) {
      fail("--rank2-mutation-approval-request-template requires rank2_mutation_approval_readiness=ready_for_separate_owner_mutation_approval_request_no_execution", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_mutation_approval_request_template, null, 2));
    return;
  }

  if (args.rank2MutationApprovalRecordTemplate) {
    if (!packet.rank2_mutation_approval_readiness.ready_for_mutation_approval_request) {
      fail("--rank2-mutation-approval-record-template requires rank2_mutation_approval_readiness=ready_for_separate_owner_mutation_approval_request_no_execution", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_mutation_approval_record_template, null, 2));
    return;
  }

  if (args.rank2RouteDiffProposalTemplate) {
    if (packet.rank2_mutation_approval_record_status !== "valid_owner_approved_no_execution") {
      fail("--rank2-route-diff-proposal-template requires rank2_mutation_approval_record_status=valid_owner_approved_no_execution", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_route_diff_proposal_template, null, 2));
    return;
  }

  if (args.rank2RollbackPlanTemplate) {
    if (packet.rank2_route_diff_proposal_record_status !== "valid_no_mutation_route_diff_proposal_recorded") {
      fail("--rank2-rollback-plan-template requires rank2_route_diff_proposal_record_status=valid_no_mutation_route_diff_proposal_recorded", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_rollback_plan_template, null, 2));
    return;
  }

  if (args.rank2LocalPostPatchSmokePlanTemplate) {
    if (packet.rank2_rollback_plan_record_status !== "valid_no_mutation_rollback_plan_recorded") {
      fail("--rank2-local-post-patch-smoke-plan-template requires rank2_rollback_plan_record_status=valid_no_mutation_rollback_plan_recorded", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_local_post_patch_smoke_plan_template, null, 2));
    return;
  }

  if (args.rank2ExplicitDeployApprovalTemplate) {
    if (packet.rank2_local_post_patch_smoke_plan_record_status !== "valid_no_mutation_local_post_patch_smoke_plan_recorded") {
      fail("--rank2-explicit-deploy-approval-template requires rank2_local_post_patch_smoke_plan_record_status=valid_no_mutation_local_post_patch_smoke_plan_recorded", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_explicit_deploy_approval_template, null, 2));
    return;
  }

  if (args.rank2RouteExecutionPacketTemplate) {
    if (packet.rank2_execution_readiness.status !== "all_prerequisites_recorded_no_runtime") {
      fail("--rank2-route-execution-packet-template requires rank2_execution_readiness=all_prerequisites_recorded_no_runtime", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_route_execution_packet_template, null, 2));
    return;
  }

  if (args.rank2OwnerRuntimeReleaseTemplate) {
    if (packet.rank2_route_execution_packet_record_status !== "valid_route_execution_packet_recorded_no_runtime") {
      fail("--rank2-owner-runtime-release-template requires rank2_route_execution_packet_record_status=valid_route_execution_packet_recorded_no_runtime", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_owner_runtime_release_template, null, 2));
    return;
  }

  if (args.rank2RoutePatchApplicationTemplate) {
    if (packet.rank2_owner_runtime_release_record_status !== "valid_owner_runtime_release_recorded_no_execution") {
      fail("--rank2-route-patch-application-template requires rank2_owner_runtime_release_record_status=valid_owner_runtime_release_recorded_no_execution", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_route_patch_application_template, null, 2));
    return;
  }

  if (args.rank2LocalPostPatchSmokeRecordTemplate) {
    if (packet.rank2_route_patch_application_record_status !== "valid_route_patch_application_recorded_no_smoke_no_deploy") {
      fail("--rank2-local-post-patch-smoke-record-template requires rank2_route_patch_application_record_status=valid_route_patch_application_recorded_no_smoke_no_deploy", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_local_post_patch_smoke_record_template, null, 2));
    return;
  }

  if (args.rank2DeployExecutionTemplate) {
    if (packet.rank2_local_post_patch_smoke_record_status !== "valid_local_post_patch_smoke_recorded_no_deploy") {
      fail("--rank2-deploy-execution-template requires rank2_local_post_patch_smoke_record_status=valid_local_post_patch_smoke_recorded_no_deploy", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_deploy_execution_template, null, 2));
    return;
  }

  if (args.rank2ProductionLiveSmokeTemplate) {
    if (packet.rank2_deploy_execution_record_status !== "valid_deploy_execution_recorded_no_live_smoke") {
      fail("--rank2-production-live-smoke-template requires rank2_deploy_execution_record_status=valid_deploy_execution_recorded_no_live_smoke", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_production_live_smoke_template, null, 2));
    return;
  }

  if (args.rank2PostLiveRedirectDeleteApprovalRequestTemplate) {
    if (packet.rank2_production_live_smoke_record_status !== "valid_production_live_smoke_recorded_no_redirect_no_delete") {
      fail("--rank2-post-live-redirect-delete-approval-request-template requires rank2_production_live_smoke_record_status=valid_production_live_smoke_recorded_no_redirect_no_delete", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_post_live_redirect_delete_approval_request_template, null, 2));
    return;
  }

  if (args.rank2PostLiveRedirectDeleteApprovalRecordTemplate) {
    if (packet.rank2_post_live_redirect_delete_approval_request_record_status !== "valid_post_live_redirect_delete_approval_requested_no_execution") {
      fail("--rank2-post-live-redirect-delete-approval-record-template requires rank2_post_live_redirect_delete_approval_request_record_status=valid_post_live_redirect_delete_approval_requested_no_execution", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_post_live_redirect_delete_approval_record_template, null, 2));
    return;
  }

  if (args.rank2PostLiveRedirectDeleteExecutionPacketTemplate) {
    if (packet.rank2_post_live_redirect_delete_approval_record_status !== "valid_post_live_redirect_delete_approved_no_execution") {
      fail("--rank2-post-live-redirect-delete-execution-packet-template requires rank2_post_live_redirect_delete_approval_record_status=valid_post_live_redirect_delete_approved_no_execution", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_post_live_redirect_delete_execution_packet_template, null, 2));
    return;
  }

  if (args.rank2PostLiveRedirectDeleteExecutionRecordTemplate) {
    if (packet.rank2_post_live_redirect_delete_execution_packet_record_status !== "valid_post_live_redirect_delete_execution_packet_recorded_no_execution") {
      fail("--rank2-post-live-redirect-delete-execution-record-template requires rank2_post_live_redirect_delete_execution_packet_record_status=valid_post_live_redirect_delete_execution_packet_recorded_no_execution", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_post_live_redirect_delete_execution_record_template, null, 2));
    return;
  }

  if (args.rank2PostLiveRedirectDeletePostExecutionSmokeTemplate) {
    if (packet.rank2_post_live_redirect_delete_execution_record_status !== "valid_post_live_redirect_delete_execution_recorded_pending_smoke") {
      fail("--rank2-post-live-redirect-delete-post-execution-smoke-template requires rank2_post_live_redirect_delete_execution_record_status=valid_post_live_redirect_delete_execution_recorded_pending_smoke", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_post_live_redirect_delete_post_execution_smoke_template, null, 2));
    return;
  }

  if (args.rank2PostLiveRedirectDeleteRollbackReadinessTemplate) {
    if (packet.rank2_post_live_redirect_delete_post_execution_smoke_record_status !== "valid_post_live_redirect_delete_post_execution_smoke_recorded") {
      fail("--rank2-post-live-redirect-delete-rollback-readiness-template requires rank2_post_live_redirect_delete_post_execution_smoke_record_status=valid_post_live_redirect_delete_post_execution_smoke_recorded", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_post_live_redirect_delete_rollback_readiness_template, null, 2));
    return;
  }

  if (args.rank2PostLiveRedirectDeleteOwnerCloseoutTemplate) {
    if (packet.rank2_post_live_redirect_delete_rollback_readiness_record_status !== "valid_post_live_redirect_delete_rollback_readiness_recorded") {
      fail("--rank2-post-live-redirect-delete-owner-closeout-template requires rank2_post_live_redirect_delete_rollback_readiness_record_status=valid_post_live_redirect_delete_rollback_readiness_recorded", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_post_live_redirect_delete_owner_closeout_template, null, 2));
    return;
  }

  if (args.rank2FreshOwnerRuntimePacketTemplate) {
    if (packet.current_next_required_gate.id !== "rank2_post_live_redirect_delete_record_chain_closed") {
      fail("--rank2-fresh-owner-runtime-packet-template requires current_next_required_gate=rank2_post_live_redirect_delete_record_chain_closed", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_fresh_owner_runtime_packet_template, null, 2));
    return;
  }

  if (args.rank2FreshOwnerRuntimeExecutionPacketTemplate) {
    if (packet.current_next_required_gate.id !== "rank2_fresh_owner_runtime_execution_packet_record") {
      fail("--rank2-fresh-owner-runtime-execution-packet-template requires current_next_required_gate=rank2_fresh_owner_runtime_execution_packet_record", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_fresh_owner_runtime_execution_packet_template, null, 2));
    return;
  }

  if (args.rank2FreshOwnerExternalRuntimeExecutionEvidenceTemplate) {
    if (packet.current_next_required_gate.id !== "rank2_fresh_owner_external_runtime_execution_evidence_record") {
      fail("--rank2-fresh-owner-external-runtime-execution-evidence-template requires current_next_required_gate=rank2_fresh_owner_external_runtime_execution_evidence_record", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_fresh_owner_external_runtime_execution_evidence_template, null, 2));
    return;
  }

  if (args.rank2FreshOwnerPostRuntimeSmokeEvidenceTemplate) {
    if (packet.current_next_required_gate.id !== "rank2_fresh_owner_post_runtime_smoke_evidence_record") {
      fail("--rank2-fresh-owner-post-runtime-smoke-evidence-template requires current_next_required_gate=rank2_fresh_owner_post_runtime_smoke_evidence_record", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_fresh_owner_post_runtime_smoke_evidence_template, null, 2));
    return;
  }

  if (args.rank2FreshOwnerRollbackReadinessTemplate) {
    if (packet.current_next_required_gate.id !== "rank2_fresh_owner_rollback_readiness_record") {
      fail("--rank2-fresh-owner-rollback-readiness-template requires current_next_required_gate=rank2_fresh_owner_rollback_readiness_record", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_fresh_owner_rollback_readiness_template, null, 2));
    return;
  }

  if (args.rank2FreshOwnerOwnerCloseoutTemplate) {
    if (packet.current_next_required_gate.id !== "rank2_fresh_owner_owner_closeout_record") {
      fail("--rank2-fresh-owner-owner-closeout-template requires current_next_required_gate=rank2_fresh_owner_owner_closeout_record", packet, args.json);
    }
    console.log(JSON.stringify(packet.rank2_fresh_owner_owner_closeout_template, null, 2));
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
