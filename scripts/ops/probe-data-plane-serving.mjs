// Six-hour proof that every enrolled data-plane asset is actually served from a
// published generation, with data young enough to trust. Born 2026-08-03: the
// enrolled URL silently served the deploy-time bundled copy (valid 200, no
// generation header, stale bytes) and nothing noticed until a human probed it.
// A missing header IS the incident this probe exists to catch — fallback is a
// designed degradation, but an unobserved one is silent staleness.
//
// Some enrolled families are intentionally unpublished on the data plane for
// now (see FALLBACK_ALLOWED_FAMILIES). For exactly those families, a 200 with
// ALL THREE plane headers absent (generation, source-as-of, published-at) is
// their designed static-fallback state and passes as FALLBACK-ALLOWED —
// observable, not silent. Every other shape for those families, and every
// shape for published families, is validated strictly, so a real serving
// defect can never hide behind the allowlist.
//
// The enrolled-path list is imported from the Worker read module so the probe
// can never drift from what production actually serves.
//
// Every request is individually bounded (DEFAULT_REQUEST_TIMEOUT_MS), and the
// full sequential sweep has its own bound (DEFAULT_TOTAL_PROBE_DEADLINE_MS).
// A URL that never answers becomes a strict FAIL for exactly that path — never
// a fallback pass. Once the total deadline is reached, every unvisited path is
// also recorded as strict FAIL without starting another network request.
//
// Each successful response is judged against a fresh wall-clock read taken
// immediately after its fetch, so a generation promoted mid-sweep cannot be
// mistaken for a future publication (issue #90).

import { ENROLLED_PATHS, ENROLLED_PREFIXES } from "../lib/cloud-data-plane-worker-read.mjs";
import { performance } from "node:perf_hooks";

export const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
// Milliseconds a single enrolled URL may take to answer before it is cut off
// and recorded as FAIL. Immutable default; the env override (and the probeAll
// argument) can only tighten behavior, never remove the bound.
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
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
export const FAMILY_SOURCE_AGE_DAYS = Object.freeze({
  "fred-yardeni": 14,
  "slickcharts-monthly": 40,
});

// ---- Axis 2: immutable publication-heartbeat policy (days) ----
// Family override, then default. No exact-path overrides exist on this axis.
export const FAMILY_PUBLISHED_AGE_DAYS = Object.freeze({
  "fred-yardeni": 10,
  "slickcharts-weekly": 10,
  "slickcharts-monthly": 40,
});

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

// Families that are enrolled but intentionally not yet published to the data
// plane. Static fallback (200 with no plane headers) is their designed serving
// mode until they are published; the probe observes it instead of alarming on
// it. Any family not listed here is strict, and stays fail-closed.
export const FALLBACK_ALLOWED_FAMILIES = Object.freeze([
  "slickcharts-symbols",
  "edgar-korean-summaries",
]);
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
  let requestPromise;
  try {
    requestPromise = Promise.resolve(fetchFn(url, { redirect: "manual", signal: controller.signal }));
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
  monotonicNowFn = () => performance.now(),
}) {
  const results = [];
  const effectiveTimeoutMs = parseRequestTimeoutMs(requestTimeoutMs);
  const effectiveTotalDeadlineMs = parseTotalProbeDeadlineMs(totalDeadlineMs);
  const probeStartedAtMs = monotonicNowFn();
  const remainingTotalMs = () => effectiveTotalDeadlineMs - (monotonicNowFn() - probeStartedAtMs);
  const enrolledEntries = [...ENROLLED_PATHS];
  // This enumerates exact ENROLLED_PATHS only. Prefix-enrolled EDGAR policy is
  // defined above but has no live probe coverage here; adding representative
  // prefix paths requires a separate contract and is intentionally out of scope.
  for (let index = 0; index < enrolledEntries.length; index += 1) {
    const [path, family] = enrolledEntries[index];
    const remainingBeforeRequestMs = remainingTotalMs();
    if (remainingBeforeRequestMs <= 0) {
      const failure = totalDeadlineFailure(effectiveTotalDeadlineMs);
      for (const [unvisitedPath, unvisitedFamily] of enrolledEntries.slice(index)) {
        results.push({ path: unvisitedPath, family: unvisitedFamily, ok: false, mode: "strict", failures: [failure] });
      }
      break;
    }
    let response;
    try {
      response = await fetchWithTimeout(
        fetchFn,
        `${baseUrl}${path}`,
        Math.min(effectiveTimeoutMs, remainingBeforeRequestMs),
        remainingTotalMs,
      );
    } catch (error) {
      results.push({
        path,
        family,
        ok: false,
        mode: "strict",
        failures: [error?.code === "REQUEST_TIMEOUT" ? error.message : `fetch failed: ${error?.message ?? error}`],
      });
      if (error?.totalProbeDeadlineReached) {
        const failure = totalDeadlineFailure(effectiveTotalDeadlineMs);
        for (const [unvisitedPath, unvisitedFamily] of enrolledEntries.slice(index + 1)) {
          results.push({ path: unvisitedPath, family: unvisitedFamily, ok: false, mode: "strict", failures: [failure] });
        }
        break;
      }
      continue;
    }
    // Judge against the instant the response actually arrived: a generation
    // promoted while this request was in flight (issue #90) must not look like
    // a future publication against the run-start time. An explicit nowIso
    // still pins every evaluation for deterministic callers; only its absence
    // reads the wall clock fresh here, and an explicit invalid value stays
    // invalid instead of silently falling back.
    const evaluationNowIso = nowIso === undefined ? wallClockNowFn() : nowIso;
    results.push(evaluateProbeResponse({
      path,
      family,
      status: response.status,
      generationHeader: response.headers.get("x-data-plane-generation"),
      sourceAsOfHeader: response.headers.get("x-data-plane-source-as-of"),
      publishedAtHeader: response.headers.get("x-data-plane-published-at"),
      nowIso: evaluationNowIso,
      maxAgeDays,
    }));
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
  const results = await probeAll({
    baseUrl,
    fetchFn: fetch,
    maxAgeDays,
    requestTimeoutMs,
    totalDeadlineMs,
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
