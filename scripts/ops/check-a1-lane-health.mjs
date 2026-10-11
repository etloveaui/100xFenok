#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { LANE_REGISTRY } from "../lib/lane-registry.mjs";

const resultPath = process.env.PIPELINE_JOB_HEALTH_RESULT || "pipeline-job-health-result.json";
const now = Date.now();
const health = JSON.parse(fs.readFileSync(resultPath, "utf8"));
let alarmCount = 0;
for (const lane of LANE_REGISTRY.lanes.filter((row) => row.external_status)) {
  const statusPath = lane.id === "fdic_tier1" && process.env.A1_LANE_STATUS_PATH
    ? process.env.A1_LANE_STATUS_PATH : path.join(process.cwd(), lane.external_status);
  const reasons = [];
  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch (error) {
    status = null;
    reasons.push(error.code === "ENOENT" ? "a1_status_missing" : "a1_status_invalid");
  }
  if (reasons.length === 0) {
    if (!status || typeof status !== "object" || Array.isArray(status)
      || status.schema_version !== "a1-lane-status/v1" || status.lane_id !== lane.id
      || typeof status.enabled !== "boolean" || typeof status.push_enabled !== "boolean"
      || !Number.isFinite(status.cadence_hours) || status.cadence_hours <= 0
      || !Number.isFinite(status.grace_hours) || status.grace_hours < 0
      || !Number.isInteger(status.consecutive_failures) || status.consecutive_failures < 0) {
      reasons.push("a1_status_invalid");
    } else if (status.enabled) {
      if (!status.push_enabled) reasons.push("a1_push_disabled");
      const updated = Date.parse(status.updated_at);
      const lastSuccess = status.last_success_at === null ? null : Date.parse(status.last_success_at);
      if (!Number.isFinite(updated) || updated > now + 300_000
        || (status.last_success_at !== null && (!Number.isFinite(lastSuccess) || lastSuccess > now + 300_000))) {
        reasons.push("a1_status_invalid");
      } else if (now - updated > (status.cadence_hours + status.grace_hours) * 3_600_000) {
        reasons.push("a1_status_stale");
      }
      if (status.consecutive_failures >= 2) reasons.push("a1_consecutive_failures");
    } else {
      console.log(`A1 ${lane.label} collector is staged and not active`);
      continue;
    }
  }
  if (reasons.length === 0) {
    console.log(`A1 ${lane.label} collector status is current`);
    continue;
  }
  const incident = {
    file: `a1-${lane.id.replaceAll("_", "-")}`,
    label: `A1 ${lane.label} collector`,
    status: "alarm",
    streak: Number.isInteger(status?.consecutive_failures) ? status.consecutive_failures : null,
    failure_streak_threshold: 2,
    alarm_reasons: [...new Set(reasons)].sort(),
    cadence_status: reasons.includes("a1_status_stale") ? "overdue" : "not_due",
  };
  health.workflows = [...(Array.isArray(health.workflows) ? health.workflows : []), incident];
  health.status = "alarm";
  const detail = [
    `## ${incident.label} (${incident.file})`,
    `- Alarm reasons: ${incident.alarm_reasons.join(", ")}`,
    `- Last success: ${status?.last_success_at ?? "none on record"}`,
    `- Consecutive failures: ${incident.streak ?? "unknown"} (threshold 2)`,
    `- Latest status update: ${status?.updated_at ?? "unknown"} (cadence ${status?.cadence_hours ?? "unknown"}h + grace ${status?.grace_hours ?? "unknown"}h)`,
  ].join("\n");
  health.issueBody = health.issueBody ? `${health.issueBody}\n\n${detail}` : `[alert] A1 lane health incident detected.\n\n${detail}`;
  console.error(`[alarm] ${incident.label}: ${incident.alarm_reasons.join(", ")}`);
  alarmCount += 1;
}
if (alarmCount) fs.writeFileSync(resultPath, `${JSON.stringify(health, null, 2)}\n`);
process.exit(alarmCount ? 2 : 0);
