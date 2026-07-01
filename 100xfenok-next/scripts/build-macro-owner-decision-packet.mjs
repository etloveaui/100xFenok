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
    {
      id: "rank2_owner_decision_record_validation",
      gate: "after_rank2_review_readiness_before_any_rank2_route_mutation",
      decision: "pending_rank2_owner_review",
      mutation: "none",
      mutation_allowed: false,
      owner_record_required: true,
      separate_mutation_approval_required: true,
      candidate_family_id: nextCandidate?.family_id ?? null,
      allowed_next_action: "validate a rank-2 owner decision record for preserve/remap/retire; do not mutate routes or public assets",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rank-2 owner decision record schema is rank2-owner-decision-record/v0.1",
        "record stays tied to /market-valuation owner route and /market compatibility route",
        "record keeps rank2_active=false, mutation=none, mutation_approved=false",
        "redirect/delete/deploy remain blocked until separate explicit owner approval",
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
      allowed_next_action: "validate the selected rank-2 no-mutation follow-up packet before any route mutation request",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rank-2 owner follow-up record schema is rank2-owner-followup-record/v0.1",
        "selected preserve/remap/retire follow-up stays tied to the rank-2 owner decision",
        "record keeps route_mutation_requested=false and deploy_requested=false",
        "redirect/delete/deploy remain blocked until separate explicit owner approval",
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
      allowed_next_action: "prepare a request-only mutation approval packet; do not execute redirect/delete/deploy",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "request packet schema is rank2-mutation-approval-request/v0.1",
        "approval_status remains pending_owner_approval",
        "request_only=true, mutation_allowed=false, execution_allowed=false",
        "redirect/delete/deploy remain blocked until a separate owner approval record is supplied",
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
      allowed_next_action: "validate an owner mutation approval record; keep execution, deploy, redirect, and delete blocked",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "approval record schema is rank2-mutation-approval-record/v0.1",
        "mutation_approved=true is only an approval record, not an execution permit",
        "execution_allowed=false, deploy_approved=false, route_patch_applied=false",
        "redirect/delete/deploy remain blocked until a future execution packet is approved",
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
      allowed_next_action: "map the execution prerequisites for route/file diff, rollback, local smoke, and deploy approval without applying them",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "valid owner mutation approval record is necessary but not sufficient for execution",
        "route/file diff proposal is still required before any patch",
        "rollback plan, post-patch local smoke, and explicit deploy approval remain unsatisfied",
        "execution_allowed=false and redirect/delete/deploy remain blocked",
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
      allowed_next_action: "validate a draft route/file diff proposal without applying a patch, redirect, delete, or deploy",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "proposal schema is rank2-route-diff-proposal-record/v0.1",
        "proposal_status=draft_no_mutation and patch_applied=false",
        "public_files_modified=false, redirect_config_changed=false, and delete_paths=[]",
        "execution_allowed=false, deploy_approved=false, and redirect/delete/deploy remain blocked",
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
      allowed_next_action: "validate a rollback plan record without applying rollback, route patches, redirects, deletes, or deploys",
      acceptance: [
        `rank 2 candidate remains ${nextCandidate?.family_id ?? "unavailable"}`,
        "rollback plan schema is rank2-rollback-plan-record/v0.1",
        "route diff proposal must already be valid_no_mutation_route_diff_proposal_recorded",
        "rollback_plan_status=recorded_no_mutation and rollback_applied=false",
        "patch_applied=false, public_files_modified=false, redirect_config_changed=false, and delete_paths=[]",
        "execution_allowed=false, deploy_approved=false, and redirect/delete/deploy remain blocked",
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
      readiness_status: readiness?.status ?? null,
      review_packet_status: readiness?.ready_for_rank2_owner_review ? "available_no_mutation" : "blocked_until_rank2_review_readiness",
      rank2_active: false,
      mutation: "none",
      mutation_approved: false,
      separate_mutation_approval_required: true,
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
      blocked_actions: ["delete", "redirect", "deploy"],
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
      allowed_next_action: "document the owner-approved preserve decision and keep /market compatibility behind /market-valuation",
      required_evidence: [
        "rank-2 owner decision record remains valid_no_mutation_owner_review_recorded",
        "owner route /market-valuation and compatibility route /market remain unchanged",
        "legacy sample /100x/100x-main.html remains smoke-available before any mutation request",
      ],
    },
    {
      ...common,
      id: "rank2_remap_dry_run_proposal_packet",
      gate: "after_valid_rank2_remap_record_before_any_href_or_route_edit",
      decision: "remap",
      allowed_next_action: "prepare a dry-run remap proposal from /market compatibility toward /market-valuation without editing routes or public assets",
      required_evidence: [
        "rank-2 owner decision record remains valid_no_mutation_owner_review_recorded",
        "proposed destination remains /market-valuation",
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
        "local live-equivalence remains green for /market-valuation, /market, and /100x/100x-main.html",
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
    blocked_actions: ["delete", "redirect", "deploy"],
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
    blocked_actions: ["delete", "redirect", "deploy"],
    required_before_execution: [
      "separate owner mutation approval record",
      "route/file diff proposal",
      "rollback plan",
      "local route smoke after patch",
      "production deploy/live smoke only after explicit deploy approval",
    ],
    notes: "Request packet only; it does not approve or execute redirect/delete/deploy.",
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
    blocked_actions: request.blocked_actions ?? ["delete", "redirect", "deploy"],
    required_before_execution: request.required_before_execution ?? [],
    route_diff_proposal_status: "required_not_supplied",
    rollback_plan_status: "required_not_supplied",
    local_post_patch_smoke_status: "not_run",
    production_live_smoke_status: "not_approved",
    notes: "Owner approval record only; route patch, redirect, delete, deploy, and production smoke still require separate execution approval.",
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
    blocked_actions: approval.blocked_actions ?? ["delete", "redirect", "deploy"],
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
    blocked_actions: proposal.blocked_actions ?? ["delete", "redirect", "deploy"],
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
    blocked_actions: rollbackPlan.blocked_actions ?? ["delete", "redirect", "deploy"],
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
    blocked_actions: smokePlan.blocked_actions ?? ["delete", "redirect", "deploy"],
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
    blocked_actions: ["delete", "redirect", "deploy"],
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
) {
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
    next_gated_slice: nextGatedSlice(review, nextCandidate),
    safe_enforcement_slices: safeEnforcementSlices(review, nextCandidate),
    decision_followup_plans: followupPlans,
    decision_followup_record_templates: followupPlans.map(decisionFollowupRecordTemplate),
    selected_decision_followup: null,
    inactive_next_candidate_preview: inactiveNextCandidatePreview(inventory, review),
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
  packet.rank2_owner_followup_plans = rank2OwnerFollowupPlans(packet);
  packet.rank2_owner_followup_record_templates = packet.rank2_owner_followup_plans.map(rank2OwnerFollowupRecordTemplate);
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
  if (!packet.rank2_mutation_approval_readiness.blocked_actions.includes("delete")
    || !packet.rank2_mutation_approval_readiness.blocked_actions.includes("redirect")
    || !packet.rank2_mutation_approval_readiness.blocked_actions.includes("deploy")) {
    errors.push("rank2 mutation approval readiness must keep delete/redirect/deploy blocked");
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
  if (!packet.rank2_mutation_approval_request_template.blocked_actions.includes("delete")
    || !packet.rank2_mutation_approval_request_template.blocked_actions.includes("redirect")
    || !packet.rank2_mutation_approval_request_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 mutation approval request template must keep delete/redirect/deploy blocked");
  }
  packet.rank2_mutation_approval_record_template = rank2MutationApprovalRecordTemplate(packet);
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
  if (!packet.rank2_route_diff_proposal_template.blocked_actions.includes("delete")
    || !packet.rank2_route_diff_proposal_template.blocked_actions.includes("redirect")
    || !packet.rank2_route_diff_proposal_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 route diff proposal template must keep delete/redirect/deploy blocked");
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
  if (!packet.rank2_rollback_plan_template.blocked_actions.includes("delete")
    || !packet.rank2_rollback_plan_template.blocked_actions.includes("redirect")
    || !packet.rank2_rollback_plan_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 rollback plan template must keep delete/redirect/deploy blocked");
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
  if (!packet.rank2_local_post_patch_smoke_plan_template.blocked_actions.includes("delete")
    || !packet.rank2_local_post_patch_smoke_plan_template.blocked_actions.includes("redirect")
    || !packet.rank2_local_post_patch_smoke_plan_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 local post-patch smoke plan template must keep delete/redirect/deploy blocked");
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
  if (!packet.rank2_explicit_deploy_approval_template.blocked_actions.includes("delete")
    || !packet.rank2_explicit_deploy_approval_template.blocked_actions.includes("redirect")
    || !packet.rank2_explicit_deploy_approval_template.blocked_actions.includes("deploy")) {
    errors.push("rank2 explicit deploy approval template must keep delete/redirect/deploy blocked");
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
  if (!packet.rank2_execution_readiness.blocked_actions.includes("delete")
    || !packet.rank2_execution_readiness.blocked_actions.includes("redirect")
    || !packet.rank2_execution_readiness.blocked_actions.includes("deploy")) {
    errors.push("rank2 execution readiness must keep delete/redirect/deploy blocked");
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
  console.log(`rank2_execution_readiness=${packet.rank2_execution_readiness.status}`);
  console.log(`local_live_equivalence=${packet.evidence.local_live_equivalence_proof_status} rows=${packet.evidence.local_live_equivalence_rows_checked}/${packet.evidence.local_live_equivalence_rows_expected}`);
  console.log(`next_gated_slice=${packet.next_gated_slice.id}`);
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
  );
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
