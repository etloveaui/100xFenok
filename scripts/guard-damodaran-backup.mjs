#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  buildAttemptRow,
  buildSingleLaneShard,
  libraryTuple,
  writeJsonAtomic,
} from "./lib/data-supply-attempt-shard.mjs";

export const DAMODARAN_COMBINED_CRON = "17 11,23 * * 6";

const WORKFLOW_FILE = "fetch-damodaran-shadow.yml";
const ATTEMPT_SHARD_PATH = "data/admin/data-supply-state/detection-attempts/damodaran.json";
const BACKUP_THRESHOLD_HOURS = 18;

function saturdayCycleStart(createdAt) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const daysSinceSaturday = (date.getUTCDay() + 1) % 7;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceSaturday,
  );
}

function sameRun(left, right) {
  return String(left ?? "") !== "" && String(left) === String(right);
}

export function decideDamodaranExecution({
  eventName,
  eventSchedule,
  currentRunId,
  runs,
} = {}) {
  if (eventName !== "schedule") {
    return {
      action: "run",
      reason: eventName === "workflow_dispatch" ? "manual_dispatch" : "non_schedule_event",
    };
  }
  if (eventSchedule !== DAMODARAN_COMBINED_CRON) {
    return { action: "run", reason: "schedule_contract_mismatch" };
  }
  if (!Array.isArray(runs)) return { action: "run", reason: "run_history_unavailable" };

  const currentRun = runs.find((run) => sameRun(run?.id, currentRunId));
  const currentCreatedAt = Date.parse(currentRun?.created_at);
  const cycleStart = saturdayCycleStart(currentRun?.created_at);
  if (!currentRun || !Number.isFinite(currentCreatedAt) || cycleStart === null) {
    return { action: "run", reason: "current_run_unavailable" };
  }

  const elapsedHours = (currentCreatedAt - cycleStart) / 3_600_000;
  if (elapsedHours < BACKUP_THRESHOLD_HOURS) {
    return { action: "run", reason: "primary_occurrence" };
  }

  const primary = runs
    .filter((run) => {
      const createdAt = Date.parse(run?.created_at);
      return !sameRun(run?.id, currentRunId)
        && run?.event === "schedule"
        && run?.status === "completed"
        && run?.conclusion === "success"
        && Number.isFinite(createdAt)
        && createdAt >= cycleStart
        && createdAt < currentCreatedAt;
    })
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];

  if (primary) {
    return {
      action: "skip",
      reason: "primary_succeeded",
      primaryRunId: String(primary.id),
    };
  }
  return { action: "run", reason: "primary_missing_or_failed" };
}

export async function resolveDamodaranExecution({
  eventName,
  eventSchedule,
  currentRunId,
  fetchRuns,
} = {}) {
  if (eventName !== "schedule" || eventSchedule !== DAMODARAN_COMBINED_CRON) {
    return decideDamodaranExecution({ eventName, eventSchedule, currentRunId });
  }
  let runs;
  try {
    runs = await fetchRuns();
  } catch {
    return { action: "run", reason: "run_history_unavailable" };
  }
  return decideDamodaranExecution({ eventName, eventSchedule, currentRunId, runs });
}

export async function fetchScheduledRuns({
  token,
  repository,
  apiUrl = "https://api.github.com",
  transport = fetch,
} = {}) {
  if (typeof token !== "string" || token === "") throw new Error("GitHub token is unavailable");
  const [owner, repo, ...rest] = String(repository ?? "").split("/");
  if (!owner || !repo || rest.length > 0) throw new Error("GitHub repository is invalid");
  const root = apiUrl.replace(/\/+$/, "");
  const url = new URL(
    `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      + `/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/runs`,
  );
  url.searchParams.set("event", "schedule");
  url.searchParams.set("branch", "main");
  url.searchParams.set("per_page", "50");
  const response = await transport(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response?.ok) throw new Error(`GitHub Actions API returned ${response?.status ?? "unknown"}`);
  const document = await response.json();
  if (!Array.isArray(document?.workflow_runs)) throw new Error("GitHub Actions API response is malformed");
  return document.workflow_runs;
}

export function emitBackupSkipAttempt({
  attemptShardPath = ATTEMPT_SHARD_PATH,
  observedAt = new Date().toISOString(),
  runId,
  runAttempt = 1,
  eventName = "schedule",
} = {}) {
  const normalizedRunAttempt = Number(runAttempt);
  const attemptId = `damodaran-backup-skip-${runId}-${normalizedRunAttempt}`;
  const tuple = libraryTuple({
    candidates: 0,
    retryCount: 0,
    latencyMs: 0,
    outcome: "primary_succeeded_skip",
    decode: "not_attempted",
    payload: "empty",
  });
  const row = buildAttemptRow({
    laneId: "damodaran",
    memberId: null,
    tuple,
    attemptId,
    observedAt,
    eventName,
    runId,
    runAttempt: normalizedRunAttempt,
  });
  writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: "damodaran", row }));
  return row;
}

function writeOutputs(decision, outputPath) {
  if (typeof outputPath !== "string" || outputPath === "") {
    throw new Error("GITHUB_OUTPUT is unavailable");
  }
  fs.appendFileSync(outputPath, `action=${decision.action}\nreason=${decision.reason}\n`);
}

export async function runDamodaranBackupGate({ env = process.env } = {}) {
  const decision = await resolveDamodaranExecution({
    eventName: env.GITHUB_EVENT_NAME,
    eventSchedule: env.GITHUB_EVENT_SCHEDULE,
    currentRunId: env.GITHUB_RUN_ID,
    fetchRuns: () => fetchScheduledRuns({
      token: env.GH_TOKEN,
      repository: env.GITHUB_REPOSITORY,
      apiUrl: env.GITHUB_API_URL,
    }),
  });
  if (decision.action === "skip") {
    emitBackupSkipAttempt({
      attemptShardPath: env.DAMODARAN_ATTEMPT_SHARD || ATTEMPT_SHARD_PATH,
      observedAt: new Date().toISOString(),
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT || 1,
      eventName: env.GITHUB_EVENT_NAME,
    });
  }
  writeOutputs(decision, env.GITHUB_OUTPUT);
  console.log(JSON.stringify({ action: decision.action, reason: decision.reason }));
  return decision;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runDamodaranBackupGate();
  } catch (error) {
    console.error(`Damodaran backup gate failed open: ${error?.message ?? "unexpected error"}`);
    process.exitCode = 1;
  }
}
