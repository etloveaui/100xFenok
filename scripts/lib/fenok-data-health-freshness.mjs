import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRESHNESS_CLASSES,
  dateOnly,
  freshnessVerdict,
  policyToday,
  resolveSourcePolicy,
} from "../../100xfenok-next/src/lib/freshness-policy.mjs";

export const DETECTION_CALENDARS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "data-supply-detection-calendars.json",
);
export const DETECTION_CALENDARS = JSON.parse(fs.readFileSync(DETECTION_CALENDARS_PATH, "utf8"));

const STATUS_SEVERITY = Object.freeze({ fresh: 0, delayed: 1, stopped: 2 });

function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function policyLimit(policy) {
  const cadence = policy ? FRESHNESS_CLASSES[policy.cadence] : null;
  return cadence ? cadence.cycleDays + (policy.releaseLagDays ?? 0) + cadence.graceDays : null;
}

function policyForPath(lane, output) {
  return resolveSourcePolicy({
    laneId: lane.id,
    cadence: lane.cadence?.kind,
    path: `/${output}`,
  });
}

function widestPolicy(lane, policies) {
  const usable = policies.filter(Boolean);
  if (usable.length === 0) return resolveSourcePolicy({ laneId: lane.id, cadence: lane.cadence?.kind });
  return usable.reduce((widest, policy) => (
    (policyLimit(policy) ?? -1) > (policyLimit(widest) ?? -1) ? policy : widest
  ));
}

function verdictForSource(sourceValue, policy, nowIso, calendars) {
  const sourceDate = dateOnly(sourceValue);
  if (!policy || !validCalendarDate(sourceDate)) return { date: null, status: "stopped" };
  const today = policyToday(nowIso, policy);
  if (!today || sourceDate > today) return { date: null, status: "stopped" };
  const verdict = freshnessVerdict(sourceDate, policy, today, { calendars });
  return {
    date: sourceDate,
    status: Object.hasOwn(STATUS_SEVERITY, verdict.state) ? verdict.state : "stopped",
  };
}

function perArtifactFreshness(lane, floorRow, nowIso, calendars) {
  const outputs = lane.roots?.canonical_outputs ?? [];
  const evidence = Array.isArray(floorRow?.source_artifacts) ? floorRow.source_artifacts : [];
  if (lane.id !== "fred_banking" || outputs.length === 0 || evidence.length === 0) return null;

  return outputs.map((output) => {
    const artifact = evidence.find((row) => row?.path === output) ?? null;
    const policy = policyForPath(lane, output);
    return {
      ...verdictForSource(artifact?.source_as_of, policy, nowIso, calendars),
      limit: policyLimit(policy),
    };
  });
}

export function summarizeDataSetFreshness(lane, floorRow, nowIso, calendars = DETECTION_CALENDARS) {
  const outputs = lane.roots?.canonical_outputs ?? [];
  const outputPolicies = outputs.map((output) => policyForPath(lane, output));
  const policy = widestPolicy(lane, outputPolicies);
  const perArtifact = perArtifactFreshness(lane, floorRow, nowIso, calendars);

  if (lane.id === "fred_banking") {
    const limits = outputPolicies.map(policyLimit).filter(Number.isFinite);
    const dates = perArtifact?.map((part) => part.date).filter(Boolean) ?? [];
    const status = perArtifact === null || perArtifact.length !== outputs.length
      ? "stopped"
      : perArtifact.reduce((worst, part) => (
        STATUS_SEVERITY[part.status] > STATUS_SEVERITY[worst] ? part.status : worst
      ), "fresh");
    return {
      newest_source_date: dates.length > 0 ? dates.sort().at(-1) : null,
      max_age: limits.length > 0 ? `${Math.min(...limits)}d` : null,
      status,
    };
  }

  const result = verdictForSource(floorRow?.artifact?.source_as_of, policy, nowIso, calendars);
  const limit = policyLimit(policy);
  return {
    newest_source_date: result.date,
    max_age: limit === null ? null : `${limit}d`,
    status: result.status,
  };
}

export function readDetectionFloorRows(dataRoot) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(path.join(dataRoot, "admin", "data-supply-detection-floor.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.lanes)) {
    throw new Error("malformed data supply detection floor");
  }
  const rows = new Map();
  for (const row of document.lanes) {
    if (typeof row?.id !== "string" || rows.has(row.id)) {
      throw new Error("malformed or duplicate detection floor lane");
    }
    rows.set(row.id, row);
  }
  return rows;
}
