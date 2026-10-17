// Six-hour proof that every enrolled data-plane asset is actually served from a
// published generation, with data young enough to trust. Born 2026-08-03: the
// enrolled URL silently served the deploy-time bundled copy (valid 200, no
// generation header, stale bytes) and nothing noticed until a human probed it.
// A missing header IS the incident this probe exists to catch — fallback is a
// designed degradation, but an unobserved one is silent staleness.
//
// All enrolled families have migrated. Their responses require plane headers;
// a bundled response is a serving failure.
//
// The enrolled-path list is imported from the Worker read module so the probe
// can never drift from what production actually serves.
//
// Every request is individually bounded (DEFAULT_REQUEST_TIMEOUT_MS), the
// bounded worker pool has an immutable ceiling, and the full sweep has its own
// bound (DEFAULT_TOTAL_PROBE_DEADLINE_MS).
// A URL that never answers becomes a strict FAIL for exactly that path — never
// a fallback pass. Once the total deadline is reached, every unvisited path is
// also recorded as strict FAIL without starting another network request.
//
// Each successful response is judged against a fresh wall-clock read taken
// immediately after its fetch, so a generation promoted mid-sweep cannot be
// mistaken for a future publication (issue #90).

import { ENROLLED_PATHS, ENROLLED_PREFIXES } from "../lib/cloud-data-plane-worker-read.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "../lib/data-supply-detection-config.mjs";
import { matchesDayWeekday } from "../lib/schedule-day-weekday.mjs";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { liveRequestHeaders } from "../lib/live-request-headers.mjs";
import { freshnessVerdict, policyToday, resolveSourcePolicy } from "../../100xfenok-next/src/lib/freshness-policy.mjs";

const DETECTION_CALENDARS = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL("../lib/data-supply-detection-calendars.json", import.meta.url)), "utf8",
));
const SHARED_SOURCE_PATHS = new Map([
  ...["AAPL", "AMZN", "META", "MSFT"].map((symbol) => [`/data/earnings-overview/${symbol}.json`, { laneId: "earnings_overview" }]),
  ...["daily", "weekly", "monthly", "quarterly"].map((cadence) => [`/data/macro/fred-banking-${cadence}.json`, { artifactId: `fred_banking_${cadence}` }]),
  ["/data/macro/tga.json", { laneId: "treasury_tga" }],
]);

export const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
// Milliseconds a single enrolled URL may take to answer before it is cut off
// and recorded as FAIL. Immutable default; the env override (and the probeAll
// argument) can only tighten behavior, never remove the bound.
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
// Eight parallel reads keep the 600+ path sweep short without turning a probe
// into a burst large enough to resemble publication traffic. Overrides may
// tighten this bound for deterministic tests or incident mitigation.
export const DEFAULT_PROBE_CONCURRENCY = 8;
// After abort, give a signal-aware fetch a short bounded window to settle and
// release resources before the next sequential request starts. A fetch that
// ignores the signal can never hold the report beyond this grace or the
// remaining total probe deadline, whichever is shorter.
export const DEFAULT_ABORT_CLEANUP_GRACE_MS = 250;
// Milliseconds the complete sequential sweep may run. Ten minutes is safely
// below the six-hour schedule while leaving room for report/issue handling.
// Overrides can only tighten this immutable ceiling.
export const DEFAULT_TOTAL_PROBE_DEADLINE_MS = 10 * 60_000;
// Calendar days of source-date age tolerated before the probe alarms. Macro
// families refresh on business days; 5 calendar days survives any long
// weekend while still catching a stalled publisher within the week.
export const DEFAULT_MAX_SOURCE_AGE_DAYS = 5;

// Calendar days since the plane last published (x-data-plane-published-at)
// tolerated before the probe alarms. This is the second, independent axis: a
// fresh source date served from a dead publisher is still a stale serving
// state, so the heartbeat has its own limit.
export const DEFAULT_MAX_PUBLISHED_AGE_DAYS = 7;

// ---- Axis 1: immutable source-age policy (days) ----
// Exact path overrides family, then default. FDIC and the four FRED banking
// cadences publish on their own calendars: the daily banking file must be
// fresh within the week, quarterly data legitimately sits for months.
export const PATH_SOURCE_AGE_DAYS = Object.freeze({
  "/data/macro/fdic-tier1.json": 180,
  "/data/macro/fred-banking-daily.json": 7,
  "/data/macro/fred-banking-weekly.json": 14,
  "/data/macro/fred-banking-monthly.json": 100,
  "/data/macro/fred-banking-quarterly.json": 180,
});
// The computed-signals source_as_of is the minimum of heterogeneous raw
// contributor dates. Its source-age authority remains in the producer-family
// gates, so the serving probe validates presence, parseability, and chronology
// but applies no aggregate source-age ceiling. Null is an explicit policy
// value, not a claim that the source is fresh.
export const SOURCE_AGE_UNBOUNDED_FAMILIES = Object.freeze(["computed-signals"]);
const SOURCE_AGE_UNBOUNDED_FAMILY_SET = new Set(SOURCE_AGE_UNBOUNDED_FAMILIES);
// Preserve the deployed limits when a derived cadence would tighten them.
// These are migration floors, not the schedule authority: a wider declared
// schedule automatically widens either axis without a second table edit.
const SOURCE_AGE_MIGRATION_FLOORS = Object.freeze({
  "fred-yardeni": 14,
  slickcharts: 40,
  damodaran: 10,
  sentiment: 10,
  "nasdaq-giw-sox": 10,
  "us-indices-daily": 10,
});

// ---- Axis 2: immutable publication-heartbeat policy (days) ----
// Family override, then default. No exact-path overrides exist on this axis.
const PUBLISHED_AGE_MIGRATION_FLOORS = Object.freeze({
  "fred-yardeni": 10,
  slickcharts: 40,
});

// Bound each schedule by its largest interval plus declared grace across the
// calendar's known holiday years and the adjoining years. This is independent
// of today's payload age. UTC cron slots use the declared calendar for holidays
// and business-day grace, matching the detector's day/weekday semantics.
export function scheduleLimitDays(schedule, calendars = DETECTION_CALENDARS) {
  const calendar = calendars.calendars.find((row) => row.id === schedule.calendar_id);
  if (!calendar) throw new Error(`missing schedule calendar: ${schedule.id}`);
  const fields = schedule.cron.split(" ");
  if (fields.length !== 5) throw new Error(`invalid schedule: ${schedule.id}`);
  function expand(raw, min, max) {
    const values = new Set();
    for (const token of raw.split(",")) {
      if (!/^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?$/.test(token)) throw new Error(`invalid cron field: ${raw}`);
      const [base, stepText] = token.split("/");
      const step = Number(stepText ?? 1);
      const [lo, hi] = base === "*" ? [min, max] : base.includes("-") ? base.split("-").map(Number) : [Number(base), Number(base)];
      if (!Number.isInteger(step) || step < 1 || lo < min || hi > max || lo > hi) throw new Error(`invalid cron range: ${raw}`);
      for (let value = lo; value <= hi; value += step) values.add(value);
    }
    return [...values].sort((a, b) => a - b);
  }
  const [minutes, hours, days, months, weekdays] = fields.map((field, i) => expand(field, [0,0,1,1,0][i], [59,23,31,12,6][i]));
  const holidayYears = calendar.holidays.map((date) => Number(date.slice(0, 4)));
  // All current schedules recur within a month; a leap-year cycle also covers
  // calendars with no listed holidays without consulting the wall clock.
  const firstYear = holidayYears.length ? Math.min(...holidayYears) - 1 : 2024;
  const lastYear = holidayYears.length ? Math.max(...holidayYears) + 1 : 2027;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: calendar.timezone });
  const holidays = new Set(calendar.holidays);
  const dayMs = 86_400_000;
  let previous = null, maximum = 0;
  for (let day = Date.UTC(firstYear, 0, 1); day < Date.UTC(lastYear + 1, 0, 1); day += dayMs) {
    const date = new Date(day);
    if (!months.includes(date.getUTCMonth() + 1)) continue;
    for (const hour of hours) for (const minute of minutes) {
      const epoch = day + hour * 3_600_000 + minute * 60_000;
      if (!matchesDayWeekday({ dayMatch: days.includes(date.getUTCDate()), weekdayMatch: weekdays.includes(date.getUTCDay()),
        dayWildcard: fields[2] === "*", weekdayWildcard: fields[4] === "*", dayWeekdayMode: schedule.day_weekday_mode,
        isHoliday: holidays.has(formatter.format(new Date(epoch))) })) continue;
      let graceDays;
      if (schedule.grace.unit === "hours") graceDays = schedule.grace.value / 24;
      else if (schedule.grace.unit === "calendar_days") graceDays = schedule.grace.value;
      else if (schedule.grace.unit === "business_days") {
        let remaining = schedule.grace.value;
        graceDays = 0;
        while (remaining > 0 && graceDays < 400) {
          graceDays++;
          const civil = formatter.format(new Date(epoch + graceDays * dayMs));
          const weekday = new Date(`${civil}T12:00:00Z`).getUTCDay();
          if (!calendar.weekend_days.includes(weekday) && !holidays.has(civil)) remaining--;
        }
        if (remaining) throw new Error(`unbounded grace: ${schedule.id}`);
      } else throw new Error(`unsupported schedule grace: ${schedule.id}`);
      if (previous !== null) maximum = Math.max(maximum, (epoch - previous) / dayMs + graceDays);
      previous = epoch;
    }
  }
  if (maximum <= 0) throw new Error(`no recurring schedule: ${schedule.id}`);
  return Math.ceil(maximum);
}

const scheduleLimitCache = new Map();
export const FAMILY_SCHEDULE_LIMITS = Object.freeze(Object.fromEntries(
  [...new Set([...ENROLLED_PATHS.values(), ...ENROLLED_PREFIXES.map((row) => row.family)])].map((family) => {
    const members = DATA_SUPPLY_DETECTION_CONFIG.lanes.flatMap((lane) => lane.producer_members.filter((member) =>
      lane.id === family.replaceAll("-", "_") || member.artifact_contracts.some((artifact) => ENROLLED_PATHS.get(`/${artifact.path}`) === family)));
    const schedules = [...new Set(members.flatMap((member) => member.schedule.map((cron) => {
      const matches = DETECTION_CALENDARS.schedules.filter((row) => row.cron === cron && row.calendar_id === member.cadence_calendar);
      if (matches.length !== 1) throw new Error(`${family}: missing or ambiguous schedule ${cron}`);
      return matches[0];
    })))];
    const limits = schedules.map((schedule) => {
      if (!scheduleLimitCache.has(schedule.id)) scheduleLimitCache.set(schedule.id, scheduleLimitDays(schedule));
      return scheduleLimitCache.get(schedule.id);
    });
    return [family, Object.freeze({ schedule_ids: Object.freeze(schedules.map((row) => row.id)), days: limits.length ? Math.max(...limits) : null })];
  }),
));
export const FAMILY_SOURCE_AGE_DAYS = Object.freeze(Object.fromEntries(Object.entries(FAMILY_SCHEDULE_LIMITS)
  .map(([family, row]) => [family, Math.max(DEFAULT_MAX_SOURCE_AGE_DAYS, SOURCE_AGE_MIGRATION_FLOORS[family] ?? 0, row.days ?? 0)])));
export const FAMILY_PUBLISHED_AGE_DAYS = Object.freeze(Object.fromEntries(Object.entries(FAMILY_SCHEDULE_LIMITS)
  .map(([family, row]) => [family, family === "fdic-tier1" ? 110 : Math.max(DEFAULT_MAX_PUBLISHED_AGE_DAYS, PUBLISHED_AGE_MIGRATION_FLOORS[family] ?? 0, row.days ?? 0)])));
// FDIC is the sole publication override: advancement-only quarterly output,
// 91-day cycle + 19-day release slack; its collector has separate cadence checks.

export function resolveSourceAgeDays({ path, family }) {
  if (SOURCE_AGE_UNBOUNDED_FAMILY_SET.has(family)) return null;
  return PATH_SOURCE_AGE_DAYS[path] ?? FAMILY_SOURCE_AGE_DAYS[family] ?? DEFAULT_MAX_SOURCE_AGE_DAYS;
}

export function resolvePublishedAgeDays({ path, family }) {
  return FAMILY_PUBLISHED_AGE_DAYS[family] ?? DEFAULT_MAX_PUBLISHED_AGE_DAYS;
}

function tightenPolicyLimit(policyLimit, override) {
  if (policyLimit === null) return null;
  return Number.isFinite(override) && override > 0
    ? Math.min(policyLimit, override)
    : policyLimit;
}

function parseRealIsoDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed.getTime()
    : null;
}

export function parseLegacySourceAgeCap(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseRequestTimeoutMs(value) {
  if (value === undefined) return DEFAULT_REQUEST_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, DEFAULT_REQUEST_TIMEOUT_MS)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

export function parseTotalProbeDeadlineMs(value) {
  if (value === undefined) return DEFAULT_TOTAL_PROBE_DEADLINE_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, DEFAULT_TOTAL_PROBE_DEADLINE_MS)
    : DEFAULT_TOTAL_PROBE_DEADLINE_MS;
}

export function parseProbeConcurrency(value) {
  if (value === undefined) return DEFAULT_PROBE_CONCURRENCY;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, DEFAULT_PROBE_CONCURRENCY)
    : DEFAULT_PROBE_CONCURRENCY;
}

// Every enrolled family now requires its promoted generation.
export const FALLBACK_ALLOWED_FAMILIES = Object.freeze([]);
const FALLBACK_ALLOWED_FAMILY_SET = new Set(FALLBACK_ALLOWED_FAMILIES);

// Self-check: the allowlist may only name families production actually
// enrolls, as an exact entry or a prefix declaration. A typo here must fail
// the probe at startup, not silently exempt a stranger.
{
  const enrolledFamilies = new Set([
    ...ENROLLED_PATHS.values(),
    ...ENROLLED_PREFIXES.map(({ family }) => family),
  ]);
  for (const family of FALLBACK_ALLOWED_FAMILIES) {
    if (!enrolledFamilies.has(family)) {
      throw new Error(
        `FALLBACK_ALLOWED_FAMILIES names "${family}", which is not declared in ENROLLED_PATHS or ENROLLED_PREFIXES`,
      );
    }
  }
  // Same guard for the immutable policies: an override may only name what
  // production actually enrolls, so a typo fails at startup.
  for (const path of Object.keys(PATH_SOURCE_AGE_DAYS)) {
    if (!ENROLLED_PATHS.has(path)) {
      throw new Error(`PATH_SOURCE_AGE_DAYS names "${path}", which is not in ENROLLED_PATHS`);
    }
  }
  for (const family of [...Object.keys(FAMILY_SOURCE_AGE_DAYS), ...Object.keys(FAMILY_PUBLISHED_AGE_DAYS)]) {
    if (!enrolledFamilies.has(family)) {
      throw new Error(
        `A freshness policy names family "${family}", which is not declared in ENROLLED_PATHS or ENROLLED_PREFIXES`,
      );
    }
  }
  for (const family of SOURCE_AGE_UNBOUNDED_FAMILIES) {
    if (!enrolledFamilies.has(family)) {
      throw new Error(
        `A freshness policy names family "${family}", which is not declared in ENROLLED_PATHS or ENROLLED_PREFIXES`,
      );
    }
  }
}

export function evaluateProbeResponse({ path, family, status, generationHeader, sourceAsOfHeader, publishedAtHeader, nowIso, maxAgeDays, maxPublishedAgeDays }) {
  const failures = [];
  if (status !== 200) {
    failures.push(`HTTP ${status} (expected 200)`);
    return { path, family, ok: false, mode: "strict", failures };
  }
  const nowMs = Date.parse(nowIso ?? "");
  const nowIsValid = Number.isFinite(nowMs);
  if (!nowIsValid) {
    failures.push(`nowIso is unparseable (${nowIso == null ? "absent" : `"${nowIso}"`})`);
  }
  const allPlaneHeadersAbsent = generationHeader == null && sourceAsOfHeader == null && publishedAtHeader == null;
  if (nowIsValid && FALLBACK_ALLOWED_FAMILY_SET.has(family) && allPlaneHeadersAbsent) {
    // Designed static fallback for an intentionally unpublished family: the
    // URL is serving the bundled copy and that is the agreed, observed state.
    return { path, family, ok: true, mode: "fallback-allowed", failures };
  }
  // Any present-but-empty or partial header set lands here: strict mode. The
  // heartbeat is mandatory in strict mode — a generation and source date with
  // no publication instant cannot prove the plane is actually serving.
  if (!generationHeader || !generationHeader.startsWith(`${family}-`)) {
    failures.push(
      `x-data-plane-generation is ${generationHeader == null ? "absent — the URL is silently serving the deploy-time bundled copy" : `"${generationHeader}" (expected prefix "${family}-")`}`,
    );
  }
  const effectiveSourceAgeDays = tightenPolicyLimit(resolveSourceAgeDays({ path, family }), maxAgeDays);
  const effectivePublishedAgeDays = tightenPolicyLimit(resolvePublishedAgeDays({ path, family }), maxPublishedAgeDays);
  const sharedSource = SHARED_SOURCE_PATHS.get(path);
  const sourceMs = parseRealIsoDay(sourceAsOfHeader);
  if (sourceMs === null) {
    failures.push(
      `x-data-plane-source-as-of is ${sourceAsOfHeader == null
        ? "absent"
        : `invalid ("${sourceAsOfHeader}"; expected a real YYYY-MM-DD calendar day)`}`,
    );
  } else if (nowIsValid) {
    if (sourceMs > nowMs) {
      failures.push(`source date ${sourceAsOfHeader} is in the future relative to now ${nowIso}`);
    } else if (sharedSource) {
      const policy = resolveSourcePolicy(sharedSource);
      const verdict = freshnessVerdict(sourceAsOfHeader, policy, policyToday(nowIso, policy), { calendars: DETECTION_CALENDARS });
      if (verdict.state !== "fresh") {
        failures.push(`source date ${sourceAsOfHeader} has ${verdict.state} content age under ${policy.label} policy`);
      }
      const rawAgeDays = (nowMs - sourceMs) / 86400000;
      if (Number.isFinite(maxAgeDays) && maxAgeDays > 0 && rawAgeDays > maxAgeDays) {
        failures.push(`source date ${sourceAsOfHeader} is ${rawAgeDays.toFixed(1)} days old (tightened limit ${maxAgeDays})`);
      }
    } else {
      const ageDays = (nowMs - sourceMs) / 86400000;
      if (effectiveSourceAgeDays !== null && ageDays > effectiveSourceAgeDays) {
        failures.push(`source date ${sourceAsOfHeader} is ${ageDays.toFixed(1)} days old (limit ${effectiveSourceAgeDays})`);
      }
    }
  }
  const publishedMs = Date.parse(publishedAtHeader ?? "");
  if (!Number.isFinite(publishedMs)) {
    failures.push(`x-data-plane-published-at is ${publishedAtHeader == null ? "absent" : `unparseable ("${publishedAtHeader}")`}`);
  } else if (nowIsValid) {
    if (publishedMs > nowMs) {
      failures.push(`published at ${publishedAtHeader} is in the future relative to now ${nowIso}`);
    } else {
      const heartbeatDays = (nowMs - publishedMs) / 86400000;
      if (heartbeatDays > effectivePublishedAgeDays) {
        failures.push(`published at ${publishedAtHeader} is ${heartbeatDays.toFixed(1)} days old (heartbeat limit ${effectivePublishedAgeDays})`);
      }
    }
  }
  return { path, family, ok: failures.length === 0, mode: "strict", failures };
}

// Race a single fetch against a hard bound. The timeout outcome is selected
// before aborting, so an abort-aware fetch cannot replace REQUEST_TIMEOUT with
// its own AbortError. The normalized request outcome never rejects, keeping
// handlers attached for delayed settlement. After abort, a compliant request
// gets a bounded chance to settle before the next sequential request starts;
// an injected fetchFn that ignores init.signal cannot hang report completion.
async function fetchWithTimeout(fetchFn, url, timeoutMs, remainingTotalMsFn) {
  const controller = new AbortController();
  const headers = liveRequestHeaders();
  const init = Object.keys(headers).length > 0
    ? { redirect: "manual", signal: controller.signal, headers }
    : { redirect: "manual", signal: controller.signal };
  let requestPromise;
  try {
    requestPromise = Promise.resolve(fetchFn(url, init));
  } catch (error) {
    throw error;
  }
  const requestOutcomePromise = requestPromise.then(
    (response) => ({ kind: "response", response }),
    (error) => ({ kind: "error", error }),
  );
  let timeoutTimer;
  const timeoutOutcomePromise = new Promise((resolve) => {
    timeoutTimer = setTimeout(() => {
      const error = new Error(`fetch timed out after ${timeoutMs} ms (no response within bound)`);
      error.code = "REQUEST_TIMEOUT";
      resolve({ kind: "timeout", error });
    }, timeoutMs);
  });
  const outcome = await Promise.race([requestOutcomePromise, timeoutOutcomePromise]);
  clearTimeout(timeoutTimer);
  if (outcome.kind === "timeout") {
    // The timeout outcome is already fixed before abort can synchronously make
    // requestOutcomePromise resolve with an AbortError.
    controller.abort();
    const remainingAfterAbortMs = Math.max(0, remainingTotalMsFn());
    const cleanupWaitMs = Math.min(
      DEFAULT_ABORT_CLEANUP_GRACE_MS,
      remainingAfterAbortMs,
    );
    if (cleanupWaitMs > 0) {
      let cleanupTimer;
      const cleanupGracePromise = new Promise((resolve) => {
        cleanupTimer = setTimeout(() => resolve("grace"), cleanupWaitMs);
      });
      const cleanupOutcome = await Promise.race([
        requestOutcomePromise.then(() => "settled"),
        cleanupGracePromise,
      ]);
      clearTimeout(cleanupTimer);
      if (cleanupOutcome === "grace" && remainingAfterAbortMs <= DEFAULT_ABORT_CLEANUP_GRACE_MS) {
        outcome.error.totalProbeDeadlineReached = true;
      }
    } else {
      outcome.error.totalProbeDeadlineReached = true;
    }
    throw outcome.error;
  }
  if (outcome.kind === "error") throw outcome.error;
  return outcome.response;
}

function totalDeadlineFailure(totalDeadlineMs) {
  return `total probe deadline reached after ${totalDeadlineMs} ms; request not attempted`;
}

export async function probeAll({
  baseUrl,
  fetchFn,
  nowIso,
  wallClockNowFn = () => new Date().toISOString(),
  maxAgeDays,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  totalDeadlineMs = DEFAULT_TOTAL_PROBE_DEADLINE_MS,
  concurrency = DEFAULT_PROBE_CONCURRENCY,
  monotonicNowFn = () => performance.now(),
}) {
  const effectiveTimeoutMs = parseRequestTimeoutMs(requestTimeoutMs);
  const effectiveTotalDeadlineMs = parseTotalProbeDeadlineMs(totalDeadlineMs);
  const effectiveConcurrency = parseProbeConcurrency(concurrency);
  const probeStartedAtMs = monotonicNowFn();
  const remainingTotalMs = () => effectiveTotalDeadlineMs - (monotonicNowFn() - probeStartedAtMs);
  const enrolledEntries = [...ENROLLED_PATHS];
  const results = new Array(enrolledEntries.length);
  let nextIndex = 0;
  let totalDeadlineReached = false;
  // This enumerates exact ENROLLED_PATHS only. Prefix-enrolled EDGAR policy is
  // defined above but has no live probe coverage here; adding representative
  // prefix paths requires a separate contract and is intentionally out of scope.
  async function worker() {
    for (;;) {
      // No await between admission and increment: each index is owned by one
      // worker, and no request starts once the total deadline is exhausted.
      if (totalDeadlineReached || nextIndex >= enrolledEntries.length || remainingTotalMs() <= 0) return;
      const index = nextIndex;
      nextIndex += 1;
      const [path, family] = enrolledEntries[index];
      const remainingBeforeRequestMs = remainingTotalMs();
      if (remainingBeforeRequestMs <= 0) return;
      let response;
      try {
        response = await fetchWithTimeout(
          fetchFn,
          `${baseUrl}${path}`,
          Math.min(effectiveTimeoutMs, remainingBeforeRequestMs),
          remainingTotalMs,
        );
      } catch (error) {
        // A cleanup timer can fire with a fractional monotonic remainder.
        // Its explicit deadline signal closes admission for every worker.
        if (error?.totalProbeDeadlineReached) totalDeadlineReached = true;
        results[index] = {
          path,
          family,
          ok: false,
          mode: "strict",
          failures: [error?.code === "REQUEST_TIMEOUT" ? error.message : `fetch failed: ${error?.message ?? error}`],
        };
        continue;
      }
      // Judge against the instant the response actually arrived: a generation
      // promoted while this request was in flight (issue #90) must not look like
      // a future publication against the run-start time. An explicit nowIso
      // still pins every evaluation for deterministic callers.
      const evaluationNowIso = nowIso === undefined ? wallClockNowFn() : nowIso;
      results[index] = evaluateProbeResponse({
        path,
        family,
        status: response.status,
        generationHeader: response.headers.get("x-data-plane-generation"),
        sourceAsOfHeader: response.headers.get("x-data-plane-source-as-of"),
        publishedAtHeader: response.headers.get("x-data-plane-published-at"),
        nowIso: evaluationNowIso,
        maxAgeDays,
      });
    }
  }
  const workerCount = Math.min(effectiveConcurrency, enrolledEntries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const deadlineFailure = totalDeadlineFailure(effectiveTotalDeadlineMs);
  for (let index = 0; index < enrolledEntries.length; index += 1) {
    if (results[index]) continue;
    const [path, family] = enrolledEntries[index];
    results[index] = { path, family, ok: false, mode: "strict", failures: [deadlineFailure] };
  }
  return results;
}

export function buildReport(results) {
  const failing = results.filter((r) => !r.ok);
  const lines = [];
  for (const r of results) {
    if (r.ok) {
      if (r.mode === "fallback-allowed") {
        lines.push(`- FALLBACK-ALLOWED ${r.path} (${r.family})`);
      } else {
        lines.push(`- OK ${r.path} (${r.family})`);
      }
    } else {
      lines.push(`- FAIL ${r.path} (${r.family})`);
      for (const failure of r.failures) lines.push(`  - ${failure}`);
    }
  }
  return { ok: failing.length === 0, failingCount: failing.length, body: lines.join("\n") };
}

async function main() {
  const baseUrl = process.env.PROBE_BASE_URL || DEFAULT_BASE_URL;
  const maxAgeDays = parseLegacySourceAgeCap(process.env.PROBE_MAX_SOURCE_AGE_DAYS);
  const requestTimeoutMs = parseRequestTimeoutMs(process.env.PROBE_REQUEST_TIMEOUT_MS);
  const totalDeadlineMs = parseTotalProbeDeadlineMs(process.env.PROBE_TOTAL_DEADLINE_MS);
  const concurrency = parseProbeConcurrency(process.env.PROBE_CONCURRENCY);
  const results = await probeAll({
    baseUrl,
    fetchFn: fetch,
    maxAgeDays,
    requestTimeoutMs,
    totalDeadlineMs,
    concurrency,
  });
  const report = buildReport(results);
  const outPath = process.env.PROBE_REPORT_PATH;
  if (outPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, `${report.body}\n`);
  }
  console.log(report.body);
  if (!report.ok) {
    console.error(`[alarm] ${report.failingCount} enrolled asset(s) failing the serving probe.`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  await main();
}
