import {
  evaluateAttemptCadence,
  evaluateFreshness,
  classifyAttempt,
} from "../build-data-supply-detection-floor.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "../lib/data-supply-detection-config.mjs";
import { LANE_REGISTRY } from "../lib/lane-registry.mjs";
import { OUTCOME_WATCHDOG_CADENCE_HOURS, OUTCOME_WATCHDOG_THRESHOLD_MULTIPLIER } from "../lib/kpi-contract-constants.mjs";
import { isRealCalendarDate } from "../lib/market-calendar.mjs";
import {
  DETECTION_CALENDARS,
} from "../lib/fenok-data-health-freshness.mjs";
import {
  FRESHNESS_CLASSES,
  freshnessVerdict,
  policyToday,
  resolveSourcePolicy,
} from "../../100xfenok-next/src/lib/freshness-policy.mjs";

export const OUTCOME_WATCHDOG_SCHEMA = "lane-outcome-watchdog/v1";
const OUTCOME_ADVANCE_BASES = Object.freeze([
  "canonical_file_source_as_of",
  "verified_poll_observed_at",
  "publish_outcome",
  "canonical_file_generated_at",
]);
const PUBLISH_OUTCOME_SUCCESS_RESULTS = new Set(["published", "resumed"]);
const PUBLISH_OUTCOME_SHARD_PATTERN = /^data\/admin\/data-supply-state\/publish-outcomes\/([a-z][a-z0-9_-]{0,95})\.json$/;
const OUTCOME_ADVANCE_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ATTEMPT_STATUS_SEVERITY = Object.freeze({ ready: 0, unobserved: 1, stale: 2, drift: 3, unavailable: 4 });

function publicationFamiliesByName(publication) {
  const families = Array.isArray(publication?.families) ? publication.families : [];
  return new Map(families
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.family === "string")
    .map((entry) => [entry.family, entry]));
}

function publishOutcomeFamilyForLane(registryLane) {
  const shards = Array.isArray(registryLane?.commit_shards) ? registryLane.commit_shards : [];
  for (const shard of shards) {
    const match = typeof shard === "string" ? shard.match(PUBLISH_OUTCOME_SHARD_PATTERN) : null;
    if (match) return match[1];
  }
  return null;
}

function observedAdvanceMs(value, nowMs) {
  if (typeof value !== "string" || !OUTCOME_ADVANCE_STAMP.test(value)) return null;
  if (!isRealCalendarDate(value.slice(0, 10))) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms <= nowMs && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : null;
}

function sourceAdvanceMs(value, nowMs, freshness, calendars) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (!isRealCalendarDate(value)) return null;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return null;
    if (ms > nowMs && freshness?.calendar !== "kr_trading") return null;
    if (freshness && evaluateFreshness(value, freshness, new Date(nowMs).toISOString(), calendars).reason === "future_source") return null;
    return ms;
  }
  return observedAdvanceMs(value, nowMs);
}

function detailScheduleContract(calendars) {
  const member = DATA_SUPPLY_DETECTION_CONFIG.lanes
    .find((lane) => lane.id === "stockanalysis_etf_detail")?.producer_members?.[0];
  if (!member || member.cadence_calendar !== "utc" || !Array.isArray(member.schedule) || member.schedule.length === 0) {
    throw new Error("stockanalysis_etf_detail schedule declaration is missing");
  }
  return {
    calendar: member.cadence_calendar,
    schedules: member.schedule.map((cron) => {
      const matches = calendars.schedules.filter((row) => row.cron === cron && row.calendar_id === member.cadence_calendar);
      if (matches.length !== 1) throw new Error(`stockanalysis_etf_detail schedule binding is not unique: ${cron}`);
      return { id: matches[0].id, cron, grace: matches[0].grace };
    }),
  };
}

function evaluateOutcomeWatchdogRow({ registryLane, laneEntry, publicationFamily, nowIso, calendars }) {
  const nowMs = new Date(nowIso).getTime();
  const freshness = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === registryLane.id)?.freshness ?? null;
  const sourceAsOf = laneEntry?.artifact?.source_as_of ?? null;
  let lastAdvance = null;
  let advanceBasis = null;
  let advanceMs = Number.NaN;
  const sourceMs = sourceAdvanceMs(sourceAsOf, nowMs, freshness, calendars);
  const pollOnlyEdgar = registryLane.id === "edgar_filings"
    && freshness?.unit === "due_window" && freshness?.due_policy?.kind === "poll_only";
  const poll = laneEntry?.details?.poll_endpoint;
  const pollMs = pollOnlyEdgar && poll?.lane_id === registryLane.id
    && poll.status === "ready" && poll.reason === "ok"
    && laneEntry?.details?.detection_reason === "ok"
    ? observedAdvanceMs(poll.observed_at, nowMs) : null;
  if (pollOnlyEdgar) {
    if (pollMs !== null) {
      lastAdvance = poll.observed_at;
      advanceBasis = "verified_poll_observed_at";
      advanceMs = pollMs;
    }
  } else if (sourceMs !== null) {
    lastAdvance = sourceAsOf;
    advanceBasis = "canonical_file_source_as_of";
    advanceMs = sourceMs;
  } else {
    const publishedMs = publicationFamily && PUBLISH_OUTCOME_SUCCESS_RESULTS.has(publicationFamily.result)
      ? observedAdvanceMs(publicationFamily.observed_at, nowMs)
      : null;
    const generatedMs = publishedMs === null ? observedAdvanceMs(laneEntry?.artifact?.generated_at, nowMs) : null;
    if (publishedMs !== null) {
      lastAdvance = publicationFamily.observed_at;
      advanceBasis = "publish_outcome";
      advanceMs = publishedMs;
    } else if (generatedMs !== null) {
      lastAdvance = laneEntry.artifact.generated_at;
      advanceBasis = "canonical_file_generated_at";
      advanceMs = generatedMs;
    }
  }
  const cadenceHours = OUTCOME_WATCHDOG_CADENCE_HOURS[registryLane.cadence.kind];
  const sourcePolicy = advanceBasis === "canonical_file_source_as_of"
    ? resolveSourcePolicy({ laneId: registryLane.id, cadence: registryLane.cadence.kind, calendar: freshness?.calendar }) : null;
  const sourceVerdict = sourcePolicy
    ? freshnessVerdict(lastAdvance, sourcePolicy, policyToday(nowIso, sourcePolicy), { calendars }) : null;
  const sourceClass = sourcePolicy ? FRESHNESS_CLASSES[sourcePolicy.cadence] : null;
  const detailSchedule = registryLane.id === "stockanalysis_etf_detail" ? detailScheduleContract(calendars) : null;
  const thresholdHours = detailSchedule && advanceBasis !== "canonical_file_source_as_of" ? null : sourceVerdict
    ? (sourceClass.cycleDays + sourceClass.graceDays + sourcePolicy.releaseLagDays) * 24
    : cadenceHours * OUTCOME_WATCHDOG_THRESHOLD_MULTIPLIER;
  let ageHours = null;
  if (sourceVerdict) {
    ageHours = sourceVerdict.ageDays === null ? null : sourceVerdict.ageDays * 24;
  } else if (Number.isFinite(advanceMs) && Number.isFinite(nowMs)) {
    if (freshness?.unit === "business_days") {
      const folded = evaluateFreshness(lastAdvance, freshness, nowIso, calendars);
      ageHours = Number.isFinite(folded.age) ? folded.age * 24 : null;
    } else {
      ageHours = Math.round(((nowMs - advanceMs) / 3_600_000) * 100) / 100;
    }
  }
  const detailAttempt = detailSchedule && advanceBasis !== "canonical_file_source_as_of" && lastAdvance !== null
    ? evaluateAttemptCadence(lastAdvance, detailSchedule.schedules.map((row) => row.cron), detailSchedule.calendar, nowIso, calendars) : null;
  const state = pollOnlyEdgar && pollMs === null ? (poll?.status === "stale" ? "overdue" : "unobservable")
    : detailSchedule && advanceBasis !== "canonical_file_source_as_of"
      ? detailAttempt?.reason === "ok" ? "current" : detailAttempt?.reason === "stale" ? "overdue" : "unobservable"
      : sourceVerdict ? (sourceVerdict.state === "fresh" ? "current" : "overdue") : ageHours === null
        ? "unobservable"
        : ageHours > thresholdHours ? "overdue" : "current";
  return {
    lane_id: registryLane.id,
    cadence_kind: registryLane.cadence.kind,
    cadence_hours: cadenceHours,
    threshold_hours: thresholdHours,
    last_advance: lastAdvance,
    age_hours: ageHours,
    state,
    source_as_of: sourceAsOf,
    advance_basis: advanceBasis,
    calendar: freshness?.calendar ?? null,
    ...(detailSchedule ? { schedule_contract: detailSchedule } : {}),
  };
}

function attemptEndpoint(attempt, member, nowIso, calendars) {
  if (!attempt) return { status: "unobserved", reason: "workflow_unobserved", observed_at: null };
  const result = classifyAttempt(attempt);
  const cadence = evaluateAttemptCadence(attempt.observed_at, member.schedule, member.cadence_calendar, nowIso, calendars);
  const worst = ATTEMPT_STATUS_SEVERITY[cadence.status] > ATTEMPT_STATUS_SEVERITY[result.status] ? cadence : result;
  return {
    status: worst.status,
    reason: worst.reason,
    observed_at: result.observed_at ?? null,
  };
}

export function buildLaneOutcomeWatchdog({
  detectionFloor,
  attempts,
  publication = null,
  nowIso,
  calendars = DETECTION_CALENDARS,
  registry = LANE_REGISTRY,
  config = DATA_SUPPLY_DETECTION_CONFIG,
} = {}) {
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(nowMs)) throw new Error(`outcome watchdog now is invalid: ${nowIso}`);
  const attemptsByKey = new Map((attempts?.attempts ?? []).map((row) => [
    `${row.lane_id}:${row.member_id ?? "_lane"}`,
    row,
  ]));
  const configById = new Map(config.lanes.map((lane) => [lane.id, lane]));
  const laneRows = (Array.isArray(detectionFloor?.lanes) ? detectionFloor.lanes : []).map((row) => {
    const laneConfig = configById.get(row?.id);
    const member = laneConfig?.producer_members?.[0];
    const attempt = attemptsByKey.get(`${row?.id}:_lane`);
    const poll = row?.id === "edgar_filings" && member
      ? attemptEndpoint(attempt, member, nowIso, calendars)
      : null;
    return {
      ...row,
      details: {
        detection_reason: row?.reason,
        ...(poll ? { poll_endpoint: { lane_id: row.id, ...poll } } : {}),
      },
    };
  });
  const lanesById = new Map(laneRows.map((row) => [row?.id, row]));
  const familiesByName = publicationFamiliesByName(publication);
  const rows = registry.lanes
    .filter((entry) => entry.enforcement === "live"
      && entry.lane_class === "detection_floor"
      && Object.hasOwn(OUTCOME_WATCHDOG_CADENCE_HOURS, entry.cadence?.kind))
    .flatMap((entry) => {
      const laneEntry = lanesById.get(entry.id);
      if (!laneEntry) return [];
      const family = publishOutcomeFamilyForLane(entry);
      return [evaluateOutcomeWatchdogRow({
        registryLane: entry,
        laneEntry,
        publicationFamily: family ? familiesByName.get(family) ?? null : null,
        nowIso,
        calendars,
      })];
    });
  const counts = rows.reduce((acc, row) => {
    acc[row.state] += 1;
    return acc;
  }, { current: 0, overdue: 0, unobservable: 0 });
  const advanceBases = rows.reduce((acc, row) => {
    if (row.advance_basis !== null) acc[row.advance_basis] += 1;
    return acc;
  }, Object.fromEntries(OUTCOME_ADVANCE_BASES.map((basis) => [basis, 0])));
  return {
    schema_version: OUTCOME_WATCHDOG_SCHEMA,
    evaluated_at: nowIso,
    basis: "per_row_advance_basis",
    threshold_multiplier: OUTCOME_WATCHDOG_THRESHOLD_MULTIPLIER,
    status: counts.overdue > 0 ? "overdue" : "ready",
    counts: {
      monitored: rows.length,
      current: counts.current,
      overdue: counts.overdue,
      unobservable: counts.unobservable,
    },
    advance_bases: advanceBases,
    rows,
  };
}
