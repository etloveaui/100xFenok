import assert from "node:assert/strict";
import {
  DEFAULT_ABORT_CLEANUP_GRACE_MS,
  DEFAULT_MAX_PUBLISHED_AGE_DAYS,
  DEFAULT_MAX_SOURCE_AGE_DAYS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TOTAL_PROBE_DEADLINE_MS,
  FALLBACK_ALLOWED_FAMILIES,
  FAMILY_PUBLISHED_AGE_DAYS,
  FAMILY_SOURCE_AGE_DAYS,
  PATH_SOURCE_AGE_DAYS,
  SOURCE_AGE_UNBOUNDED_FAMILIES,
  buildReport,
  evaluateProbeResponse,
  parseLegacySourceAgeCap,
  parseRequestTimeoutMs,
  parseTotalProbeDeadlineMs,
  probeAll,
  resolvePublishedAgeDays,
  resolveSourceAgeDays,
} from "./probe-data-plane-serving.mjs";
import { ENROLLED_PATHS, ENROLLED_PREFIXES } from "../lib/cloud-data-plane-worker-read.mjs";

const NOW = "2026-08-03T12:00:00Z";
const base = {
  path: "/data/macro/fred-macro.json",
  family: "fred-macro",
  status: 200,
  nowIso: NOW,
  maxAgeDays: DEFAULT_MAX_SOURCE_AGE_DAYS,
  maxPublishedAgeDays: DEFAULT_MAX_PUBLISHED_AGE_DAYS,
};

const MS_PER_DAY = 86400000;
const daysAgo = (days, dateOnly = false) => {
  const iso = new Date(Date.parse(NOW) - days * MS_PER_DAY).toISOString();
  return dateOnly ? iso.slice(0, 10) : iso;
};
const hoursAgo = (hours) => new Date(Date.parse(NOW) - hours * 3600000).toISOString();
const sourceDateForPolicy = ({ path, family }) => {
  const sourceLimit = resolveSourceAgeDays({ path, family });
  return daysAgo(sourceLimit === null ? 365 : sourceLimit - 1, true);
};

// The exported allowlist is immutable; callers cannot broaden fallback policy.
{
  assert.throws(() => FALLBACK_ALLOWED_FAMILIES.push("slickcharts-daily"), TypeError);
  assert.equal(FALLBACK_ALLOWED_FAMILIES.includes("slickcharts-daily"), false);
}

// Healthy dynamic response: plane headers with the family prefix, a fresh
// source date, and a fresh publication heartbeat.
{
  const r = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: "2026-08-03",
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
  assert.equal(r.mode, "strict");
}

// The 2026-08-03 incident shape: valid 200, no generation header — the URL is
// silently serving the bundled copy. This MUST fail.
{
  const r = evaluateProbeResponse({ ...base, generationHeader: null, sourceAsOfHeader: null });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /silently serving the deploy-time bundled copy/);
}

// A generation from another family is a routing defect, not health.
{
  const r = evaluateProbeResponse({
    ...base,
    generationHeader: "oecd-cli-abc123",
    sourceAsOfHeader: "2026-08-03",
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /expected prefix "fred-macro-"/);
}

// Stale source date beyond the calendar tolerance alarms; within it passes
// (a Friday date read on Monday is 3 days — inside the 5-day tolerance).
{
  const stale = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: "2026-07-20",
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(stale.ok, false);
  assert.match(stale.failures[0], /days old/);
  const weekend = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: "2026-07-31",
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(weekend.ok, true);
}

// Non-200 short-circuits with the status failure alone.
{
  const r = evaluateProbeResponse({ ...base, status: 530, generationHeader: null, sourceAsOfHeader: null });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, ["HTTP 530 (expected 200)"]);
}

// probeAll walks every enrolled path and never throws on a network failure.
{
  const asked = [];
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    fetchFn: async (url) => {
      asked.push(url);
      throw new Error("connect timeout");
    },
  });
  assert.equal(asked.length, ENROLLED_PATHS.size);
  assert.equal(results.length, ENROLLED_PATHS.size);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.match(r.failures[0], /fetch failed: connect timeout/);
  }
}

// An abort-aware fetch releases asynchronously about 10 ms after seeing the
// signal. REQUEST_TIMEOUT still wins over its later AbortError, and probeAll
// waits for release before starting the next sequential request.
{
  const timeoutMs = 25;
  const asked = [];
  let inFlight = 0;
  let hangingSignal;
  let hangingRequestReleased = false;
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    requestTimeoutMs: timeoutMs,
    fetchFn: async (url, init) => {
      assert.equal(inFlight, 0, "probe must issue requests sequentially, never in parallel");
      inFlight += 1;
      asked.push(url);
      const path = new URL(url).pathname;
      if (path === "/data/macro/fred-macro.json") {
        hangingSignal = init?.signal;
        return new Promise((_, reject) => {
          hangingSignal.addEventListener("abort", () => {
            setTimeout(() => {
              hangingRequestReleased = true;
              inFlight -= 1;
              reject(new DOMException("request aborted", "AbortError"));
            }, 10);
          }, { once: true });
        });
      }
      const family = ENROLLED_PATHS.get(path);
      inFlight -= 1;
      return new Response(null, {
        status: 200,
        headers: {
          "x-data-plane-generation": `${family}-abc123`,
          "x-data-plane-source-as-of": sourceDateForPolicy({ path, family }),
          "x-data-plane-published-at": hoursAgo(1),
        },
      });
    },
  });
  assert.equal(asked.length, ENROLLED_PATHS.size, "every enrolled path is still probed after a timeout");
  assert.equal(results.length, ENROLLED_PATHS.size);
  const timedOut = results.find((r) => r.path === "/data/macro/fred-macro.json");
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.mode, "strict");
  assert.deepEqual(timedOut.failures, [`fetch timed out after ${timeoutMs} ms (no response within bound)`]);
  const others = results.filter((r) => r.path !== "/data/macro/fred-macro.json");
  const otherFailing = others.filter((r) => !r.ok);
  assert.deepEqual(otherFailing.map((r) => ({ path: r.path, failures: r.failures })), []);
  assert.equal(hangingSignal.aborted, true, "the hanging request must be aborted on timeout");
  assert.equal(hangingRequestReleased, true, "abort-aware fetch must release resources before probing continues");
}

// A timeout on an intentionally unpublished family is a strict FAIL, never a
// fallback pass: an unobserved URL is silent staleness, not designed
// degradation.
{
  const timeoutMs = 25;
  const fallbackPath = "/data/slickcharts/stocks/AAPL.json";
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    requestTimeoutMs: timeoutMs,
    fetchFn: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === fallbackPath) {
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("request aborted", "AbortError"));
          }, { once: true });
        });
      }
      const family = ENROLLED_PATHS.get(path);
      return new Response(null, {
        status: 200,
        headers: {
          "x-data-plane-generation": `${family}-abc123`,
          "x-data-plane-source-as-of": sourceDateForPolicy({ path, family }),
          "x-data-plane-published-at": hoursAgo(1),
        },
      });
    },
  });
  assert.equal(results.length, ENROLLED_PATHS.size);
  const timedOut = results.find((r) => r.path === fallbackPath);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.mode, "strict");
  assert.match(timedOut.failures[0], /fetch timed out after 25 ms \(no response within bound\)/);
}

// A fast healthy response never trips the bound and never aborts its signal,
// even with a deliberately tiny timeout.
{
  let seenSignal;
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    requestTimeoutMs: 25,
    fetchFn: async (url, init) => {
      seenSignal = init?.signal;
      const path = new URL(url).pathname;
      const family = ENROLLED_PATHS.get(path);
      return new Response(null, {
        status: 200,
        headers: {
          "x-data-plane-generation": `${family}-abc123`,
          "x-data-plane-source-as-of": sourceDateForPolicy({ path, family }),
          "x-data-plane-published-at": hoursAgo(1),
        },
      });
    },
  });
  const failing = results.filter((r) => !r.ok);
  assert.deepEqual(failing.map((r) => ({ path: r.path, failures: r.failures })), []);
  assert.equal(seenSignal.aborted, false);
}

// A signal-ignoring fetch cannot hang cleanup forever. After the immutable
// cleanup grace expires, the later enrolled paths are still probed and the
// original path keeps the exact REQUEST_TIMEOUT classification.
{
  assert.equal(DEFAULT_ABORT_CLEANUP_GRACE_MS, 250);
  const asked = [];
  const timeoutMs = 5;
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    requestTimeoutMs: timeoutMs,
    fetchFn: async (url) => {
      asked.push(url);
      const path = new URL(url).pathname;
      if (path === "/data/macro/fred-macro.json") return new Promise(() => {});
      const family = ENROLLED_PATHS.get(path);
      return new Response(null, {
        status: 200,
        headers: {
          "x-data-plane-generation": `${family}-abc123`,
          "x-data-plane-source-as-of": sourceDateForPolicy({ path, family }),
          "x-data-plane-published-at": hoursAgo(1),
        },
      });
    },
  });
  assert.equal(asked.length, ENROLLED_PATHS.size);
  assert.equal(results.length, ENROLLED_PATHS.size);
  const timedOut = results[0];
  assert.equal(timedOut.mode, "strict");
  assert.deepEqual(timedOut.failures, [`fetch timed out after ${timeoutMs} ms (no response within bound)`]);
  assert.equal(results.slice(1).every((r) => r.ok), true);
}

// Cleanup waiting is also capped by the remaining total deadline. A first
// request that ignores abort consumes that deadline; no second fetch starts,
// while all 604 unvisited entries are appended as strict deadline failures.
{
  const asked = [];
  const requestTimeoutMs = 5;
  const totalDeadlineMs = 30;
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    requestTimeoutMs,
    totalDeadlineMs,
    fetchFn: async (url) => {
      asked.push(url);
      return new Promise(() => {});
    },
  });
  assert.equal(asked.length, 1, "cleanup reaching the total deadline must prevent another request");
  assert.equal(results.length, 610);
  assert.deepEqual(results[0].failures, [`fetch timed out after ${requestTimeoutMs} ms (no response within bound)`]);
  assert.equal(results[0].mode, "strict");
  for (const result of results.slice(1)) {
    assert.equal(result.mode, "strict");
    assert.deepEqual(result.failures, [`total probe deadline reached after ${totalDeadlineMs} ms; request not attempted`]);
  }
}

// Request and total timeout parsing are tighten-only: positive finite lower
// values apply, larger values clamp to the immutable defaults, and invalid
// values fall back to those defaults.
{
  assert.equal(Number.isFinite(DEFAULT_REQUEST_TIMEOUT_MS) && DEFAULT_REQUEST_TIMEOUT_MS > 0, true);
  assert.equal(parseRequestTimeoutMs(undefined), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(parseRequestTimeoutMs(250), 250);
  assert.equal(parseRequestTimeoutMs("250"), 250);
  assert.equal(parseRequestTimeoutMs(DEFAULT_REQUEST_TIMEOUT_MS + 1), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(parseRequestTimeoutMs(1e12), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(parseRequestTimeoutMs("1000000000000"), DEFAULT_REQUEST_TIMEOUT_MS);
  for (const value of [0, -1, NaN, Infinity, "0", "-5", "not-a-number", ""]) {
    assert.equal(parseRequestTimeoutMs(value), DEFAULT_REQUEST_TIMEOUT_MS, `invalid timeout ${String(value)} must use the default`);
  }

  assert.equal(Number.isFinite(DEFAULT_TOTAL_PROBE_DEADLINE_MS) && DEFAULT_TOTAL_PROBE_DEADLINE_MS > 0, true);
  assert.equal(DEFAULT_TOTAL_PROBE_DEADLINE_MS < 60 * 60_000, true, "total deadline must stay below one hour");
  assert.equal(parseTotalProbeDeadlineMs(undefined), DEFAULT_TOTAL_PROBE_DEADLINE_MS);
  assert.equal(parseTotalProbeDeadlineMs(5_000), 5_000);
  assert.equal(parseTotalProbeDeadlineMs("5000"), 5_000);
  assert.equal(parseTotalProbeDeadlineMs(DEFAULT_TOTAL_PROBE_DEADLINE_MS + 1), DEFAULT_TOTAL_PROBE_DEADLINE_MS);
  assert.equal(parseTotalProbeDeadlineMs(1e12), DEFAULT_TOTAL_PROBE_DEADLINE_MS);
  assert.equal(parseTotalProbeDeadlineMs("1000000000000"), DEFAULT_TOTAL_PROBE_DEADLINE_MS);
  for (const value of [0, -1, NaN, Infinity, "0", "-5", "not-a-number", ""]) {
    assert.equal(parseTotalProbeDeadlineMs(value), DEFAULT_TOTAL_PROBE_DEADLINE_MS, `invalid total deadline ${String(value)} must use the default`);
  }
}

// Deterministic total-outage proof: every started request hangs until aborted.
// The injected monotonic clock advances only when an abort releases a request,
// so exactly three sequential requests start before the 25 ms total deadline;
// all remaining enrolled paths become strict deadline failures without fetch.
{
  let monotonicMs = 0;
  let inFlight = 0;
  const requestStarts = [];
  const totalDeadlineMs = 25;
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    requestTimeoutMs: 1,
    totalDeadlineMs,
    monotonicNowFn: () => monotonicMs,
    fetchFn: async (url, init) => {
      assert.equal(inFlight, 0, "total-outage requests must remain sequential");
      assert.equal(monotonicMs < totalDeadlineMs, true, "no request may start at or after the total deadline");
      inFlight += 1;
      requestStarts.push({ path: new URL(url).pathname, startedAtMs: monotonicMs });
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          monotonicMs += 10;
          inFlight -= 1;
          reject(new DOMException("request aborted", "AbortError"));
        }, { once: true });
      });
    },
  });
  assert.equal(requestStarts.length, 3);
  assert.deepEqual(requestStarts.map(({ startedAtMs }) => startedAtMs), [0, 10, 20]);
  assert.equal(inFlight, 0);
  assert.equal(results.length, ENROLLED_PATHS.size);
  assert.equal(results.length, 610);
  assert.equal(results.every((r) => !r.ok && r.mode === "strict"), true);
  for (const result of results.slice(requestStarts.length)) {
    assert.deepEqual(result.failures, [`total probe deadline reached after ${totalDeadlineMs} ms; request not attempted`]);
  }
  const report = buildReport(results);
  assert.equal(report.ok, false);
  assert.equal(report.failingCount, ENROLLED_PATHS.size);
  assert.equal((report.body.match(/^- FAIL /gm) ?? []).length, ENROLLED_PATHS.size);
}

// Report aggregates: one failing asset flips the whole probe.
{
  const report = buildReport([
    { path: "/a", family: "x", ok: true, failures: [] },
    { path: "/b", family: "y", ok: false, failures: ["boom"] },
  ]);
  assert.equal(report.ok, false);
  assert.equal(report.failingCount, 1);
  assert.match(report.body, /- OK \/a/);
  assert.match(report.body, /- FAIL \/b/);
  assert.match(report.body, /  - boom/);
}

// Fallback mode: an intentionally unpublished family serving its static copy
// (200 with BOTH plane headers absent) passes, labelled FALLBACK-ALLOWED.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/symbols.json",
    family: "slickcharts-symbols",
    generationHeader: null,
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "fallback-allowed");
}

// A fully published response for an allowlisted family validates strictly and
// reports OK — fallback applies only to the no-header state.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/symbols.json",
    family: "slickcharts-symbols",
    generationHeader: "slickcharts-symbols-abc123",
    sourceAsOfHeader: "2026-08-03",
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "strict");
}

// Partial header on an allowlisted family escapes fallback and is strict: a
// present generation with no source date fails.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/symbols.json",
    family: "slickcharts-symbols",
    generationHeader: "slickcharts-symbols-abc123",
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, "strict");
  assert.match(r.failures[0], /x-data-plane-source-as-of is absent/);
}

// Only true header absence enables fallback. Empty header values are present
// but malformed, including when both are empty or the other header is absent.
{
  const bothEmpty = evaluateProbeResponse({
    ...base,
    family: "slickcharts-history",
    generationHeader: "",
    sourceAsOfHeader: "",
  });
  assert.equal(bothEmpty.ok, false);
  assert.equal(bothEmpty.mode, "strict");
  assert.match(bothEmpty.failures[0], /is "" \(expected prefix/);
  assert.match(bothEmpty.failures[1], /invalid \(""; expected a real YYYY-MM-DD calendar day\)/);

  const generationEmpty = evaluateProbeResponse({
    ...base,
    family: "slickcharts-symbols",
    generationHeader: "",
    sourceAsOfHeader: null,
  });
  assert.equal(generationEmpty.ok, false);
  assert.equal(generationEmpty.mode, "strict");

  const sourceEmpty = evaluateProbeResponse({
    ...base,
    family: "slickcharts-symbols",
    generationHeader: null,
    sourceAsOfHeader: "",
  });
  assert.equal(sourceEmpty.ok, false);
  assert.equal(sourceEmpty.mode, "strict");
}

// Wrong-family generation on an allowlisted family is a routing defect.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/edgar-korean-summaries/2026-08-03.json",
    family: "edgar-korean-summaries",
    generationHeader: "slickcharts-daily-abc123",
    sourceAsOfHeader: "2026-08-03",
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, "strict");
  assert.match(r.failures[0], /expected prefix "edgar-korean-summaries-"/);
}

// Stale generated response on an allowlisted family still alarms: headers
// present means the plane is publishing, so full freshness applies.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/stocks/TSLA.json",
    family: "slickcharts-history",
    generationHeader: "slickcharts-history-abc123",
    sourceAsOfHeader: "2026-07-20",
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /days old/);
}

// ---- Two-axis freshness policy ----

// Axis 1 source-age resolution: every exact-path override, every family
// override, the unbounded computed-signals family, the default, and
// path-over-family precedence.
{
  assert.equal(resolveSourceAgeDays({ path: "/data/macro/fdic-tier1.json", family: "fdic-tier1" }), 180);
  assert.equal(resolveSourceAgeDays({ path: "/data/macro/fred-banking-daily.json", family: "fred-banking" }), 7);
  assert.equal(resolveSourceAgeDays({ path: "/data/macro/fred-banking-weekly.json", family: "fred-banking" }), 14);
  assert.equal(resolveSourceAgeDays({ path: "/data/macro/fred-banking-monthly.json", family: "fred-banking" }), 100);
  assert.equal(resolveSourceAgeDays({ path: "/data/macro/fred-banking-quarterly.json", family: "fred-banking" }), 180);
  assert.equal(resolveSourceAgeDays({ path: "/data/yardney/yardney_model.json", family: "fred-yardeni" }), 14);
  assert.deepEqual(SOURCE_AGE_UNBOUNDED_FAMILIES, ["computed-signals"]);
  assert.equal(resolveSourceAgeDays({ path: "/data/computed/signals.json", family: "computed-signals" }), null);
  assert.equal(resolveSourceAgeDays({ path: "/data/slickcharts/sp500-returns.json", family: "slickcharts-monthly" }), 40);
  // Exact path beats family when both have overrides.
  assert.equal(resolveSourceAgeDays({ path: "/data/macro/fdic-tier1.json", family: "fred-yardeni" }), 180);
  // No override on either axis falls back to the default.
  assert.equal(resolveSourceAgeDays({ path: "/data/macro/fred-macro.json", family: "fred-macro" }), DEFAULT_MAX_SOURCE_AGE_DAYS);
  assert.equal(resolveSourceAgeDays({ path: "/nonexistent.json", family: "nobody" }), DEFAULT_MAX_SOURCE_AGE_DAYS);
}

// The computed-signals aggregate carries the minimum component source date.
// A quarterly floor older than 120 days must still serve when publication is
// recent: source-age authority remains in the producer-family gates, not this
// aggregate serving probe. Presence, validity, future-date checks, and the
// independent seven-day publication heartbeat remain strict.
{
  const sourceAsOfHeader = "2025-10-01";
  const computedBase = {
    path: "/data/computed/signals.json",
    family: "computed-signals",
    status: 200,
    generationHeader: "computed-signals-abc123",
    sourceAsOfHeader,
  };
  const normal = evaluateProbeResponse({
    ...computedBase,
    nowIso: NOW,
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(normal.ok, true, JSON.stringify(normal.failures));

  const validLeapDay = evaluateProbeResponse({
    ...computedBase,
    sourceAsOfHeader: "2024-02-29",
    nowIso: NOW,
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(validLeapDay.ok, true, JSON.stringify(validLeapDay.failures));

  for (const sourceAsOfHeader of ["2025-02-30", "2025-10-01T00:00:00Z", "10/01/2025"]) {
    const invalidSource = evaluateProbeResponse({
      ...computedBase,
      sourceAsOfHeader,
      nowIso: NOW,
      publishedAtHeader: hoursAgo(1),
    });
    assert.equal(invalidSource.ok, false, sourceAsOfHeader);
    assert.match(
      invalidSource.failures[0],
      /x-data-plane-source-as-of is invalid .*expected a real YYYY-MM-DD calendar day/,
    );
  }

  const staleHeartbeat = evaluateProbeResponse({
    ...computedBase,
    nowIso: NOW,
    publishedAtHeader: daysAgo(8),
  });
  assert.equal(staleHeartbeat.ok, false);
  assert.match(staleHeartbeat.failures[0], /published at .* days old \(heartbeat limit 7\)/);

  const missingSource = evaluateProbeResponse({
    ...computedBase,
    sourceAsOfHeader: null,
    nowIso: NOW,
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(missingSource.ok, false);
  assert.match(missingSource.failures[0], /x-data-plane-source-as-of is absent/);
}

// Axis 2 heartbeat resolution: every family override and the default.
{
  assert.equal(
    resolvePublishedAgeDays({ path: "/data/computed/signals.json", family: "computed-signals" }),
    DEFAULT_MAX_PUBLISHED_AGE_DAYS,
  );
  assert.equal(resolvePublishedAgeDays({ path: "/data/yardney/yardney_model.json", family: "fred-yardeni" }), 10);
  assert.equal(resolvePublishedAgeDays({ path: "/data/slickcharts/sp500.json", family: "slickcharts-weekly" }), 10);
  assert.equal(resolvePublishedAgeDays({ path: "/data/slickcharts/sp500-returns.json", family: "slickcharts-monthly" }), 40);
  assert.equal(resolvePublishedAgeDays({ path: "/data/macro/fred-macro.json", family: "fred-macro" }), DEFAULT_MAX_PUBLISHED_AGE_DAYS);
  assert.equal(resolvePublishedAgeDays({ path: "/nonexistent.json", family: "nobody" }), DEFAULT_MAX_PUBLISHED_AGE_DAYS);
}

// The policy tables are immutable: callers cannot mutate them.
{
  for (const table of [PATH_SOURCE_AGE_DAYS, FAMILY_SOURCE_AGE_DAYS, FAMILY_PUBLISHED_AGE_DAYS, SOURCE_AGE_UNBOUNDED_FAMILIES]) {
    assert.equal(Object.isFrozen(table), true);
  }
  assert.throws(() => { PATH_SOURCE_AGE_DAYS["/data/macro/extra.json"] = 1; }, TypeError);
  assert.throws(() => { FAMILY_SOURCE_AGE_DAYS["nobody"] = 1; }, TypeError);
  assert.throws(() => { FAMILY_PUBLISHED_AGE_DAYS["nobody"] = 1; }, TypeError);
  assert.throws(() => { SOURCE_AGE_UNBOUNDED_FAMILIES.push("nobody"); }, TypeError);
  assert.equal(PATH_SOURCE_AGE_DAYS["/data/macro/extra.json"], undefined);
  assert.equal(FAMILY_PUBLISHED_AGE_DAYS["nobody"], undefined);
}

// Missing, empty, unparseable, and stale published-at all fail strict mode.
{
  for (const publishedAtHeader of [null, "", "not-a-date"]) {
    const r = evaluateProbeResponse({
      ...base,
      generationHeader: "fred-macro-abc123",
      sourceAsOfHeader: daysAgo(1, true),
      publishedAtHeader,
    });
    assert.equal(r.ok, false, JSON.stringify({ publishedAtHeader, failures: r.failures }));
    assert.equal(r.mode, "strict");
    if (publishedAtHeader === null) {
      assert.match(r.failures[0], /x-data-plane-published-at is absent/);
    } else {
      assert.match(r.failures[0], /x-data-plane-published-at is unparseable/);
    }
  }
  // A fresh source date cannot hide a dead publisher: stale heartbeat fails.
  const staleHeartbeat = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: daysAgo(1, true),
    publishedAtHeader: daysAgo(30),
  });
  assert.equal(staleHeartbeat.ok, false);
  assert.match(staleHeartbeat.failures[0], /published at .* days old \(heartbeat limit 7\)/);
}

// Generation and source present without the publication header is a strict
// partial response, never fallback.
{
  const r = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: daysAgo(1, true),
    publishedAtHeader: undefined,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, "strict");
  assert.match(r.failures[0], /x-data-plane-published-at is absent/);
}

// The evaluator always derives immutable policy internally. Omitting limits
// cannot skip age checks, and oversized overrides cannot loosen policy.
{
  const omittedLimits = evaluateProbeResponse({
    path: "/data/macro/fred-macro.json",
    family: "fred-macro",
    status: 200,
    nowIso: NOW,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: daysAgo(6, true),
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(omittedLimits.ok, false);
  assert.match(omittedLimits.failures[0], /days old \(limit 5\)/);

  const cannotLoosenSource = evaluateProbeResponse({
    ...base,
    path: "/data/macro/fred-banking-quarterly.json",
    family: "fred-banking",
    generationHeader: "fred-banking-abc123",
    sourceAsOfHeader: daysAgo(313, true),
    publishedAtHeader: hoursAgo(1),
    maxAgeDays: 999,
  });
  assert.equal(cannotLoosenSource.ok, false);
  assert.match(cannotLoosenSource.failures[0], /days old \(limit 180\)/);

  const cannotLoosenHeartbeat = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/sp500-returns.json",
    family: "slickcharts-monthly",
    generationHeader: "slickcharts-monthly-abc123",
    sourceAsOfHeader: daysAgo(1, true),
    publishedAtHeader: daysAgo(41),
    maxPublishedAgeDays: 999,
  });
  assert.equal(cannotLoosenHeartbeat.ok, false);
  assert.match(cannotLoosenHeartbeat.failures[0], /heartbeat limit 40/);

  const tightenSource = evaluateProbeResponse({
    ...base,
    path: "/data/macro/fdic-tier1.json",
    family: "fdic-tier1",
    generationHeader: "fdic-tier1-abc123",
    sourceAsOfHeader: daysAgo(132, true),
    publishedAtHeader: hoursAgo(1),
    maxAgeDays: 100,
  });
  assert.equal(tightenSource.ok, false);
  assert.match(tightenSource.failures[0], /days old \(limit 100\)/);

  for (const maxAgeDays of [0, -1, NaN, Infinity, "1"]) {
    const invalidOverride = evaluateProbeResponse({
      ...base,
      path: "/data/macro/fdic-tier1.json",
      family: "fdic-tier1",
      generationHeader: "fdic-tier1-abc123",
      sourceAsOfHeader: daysAgo(132, true),
      publishedAtHeader: hoursAgo(1),
      maxAgeDays,
    });
    assert.equal(invalidOverride.ok, true, `invalid override ${String(maxAgeDays)} must use policy`);
  }
}

// Invalid reference time and future source/publication timestamps fail with
// explicit reasons. An invalid now also rejects an otherwise allowed fallback.
{
  const invalidNow = evaluateProbeResponse({
    ...base,
    nowIso: "not-a-time",
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: daysAgo(1, true),
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(invalidNow.ok, false);
  assert.match(invalidNow.failures[0], /nowIso is unparseable \("not-a-time"\)/);

  const invalidFallbackNow = evaluateProbeResponse({
    path: "/data/slickcharts/symbols.json",
    family: "slickcharts-symbols",
    status: 200,
    nowIso: "not-a-time",
    generationHeader: null,
    sourceAsOfHeader: null,
    publishedAtHeader: null,
  });
  assert.equal(invalidFallbackNow.ok, false);
  assert.equal(invalidFallbackNow.mode, "strict");
  assert.match(invalidFallbackNow.failures[0], /nowIso is unparseable/);

  const futureSource = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: "2026-08-04",
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(futureSource.ok, false);
  assert.match(futureSource.failures[0], /source date .* is in the future relative to now/);

  const futurePublished = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: daysAgo(1, true),
    publishedAtHeader: "2026-08-04T12:00:00Z",
  });
  assert.equal(futurePublished.ok, false);
  assert.match(futurePublished.failures[0], /published at .* is in the future relative to now/);
}

// Regression (issue #90): a generation promoted after the probe started but
// before a later response is evaluated must not be flagged future. Production
// judges each response against a fresh wall-clock read taken immediately
// after its fetch; deterministic callers that pin nowIso keep the old
// behavior, including strict future-date rejection.
{
  const probeStart = "2026-08-11T22:23:14.274Z"; // run-start capture of the failing run
  const promotionInstant = "2026-08-11T22:25:47.138Z"; // slickcharts-history promoted mid-sweep
  const evaluationInstant = "2026-08-11T22:26:00.000Z"; // when the later responses were evaluated
  const sourceDateForInstant = (days) =>
    new Date(Date.parse(probeStart) - days * MS_PER_DAY).toISOString().slice(0, 10);
  let fetchCount = 0;
  let clockReads = 0;
  const wallClockNowFn = () => {
    clockReads += 1;
    return clockReads === 1 ? probeStart : evaluationInstant;
  };
  const results = await probeAll({
    baseUrl: "https://example.test",
    wallClockNowFn,
    fetchFn: async (url) => {
      fetchCount += 1;
      const path = new URL(url).pathname;
      const family = ENROLLED_PATHS.get(path);
      return new Response(null, {
        status: 200,
        headers: {
          "x-data-plane-generation": `${family}-abc123`,
          "x-data-plane-source-as-of": sourceDateForInstant(1),
          "x-data-plane-published-at": fetchCount === 1 ? "2026-08-11T22:00:00.000Z" : promotionInstant,
        },
      });
    },
  });
  assert.equal(fetchCount, ENROLLED_PATHS.size);
  assert.equal(clockReads, ENROLLED_PATHS.size, "every successful fetch gets its own fresh wall-clock read");
  assert.equal(results.length, ENROLLED_PATHS.size);
  const failing = results.filter((r) => !r.ok);
  assert.deepEqual(
    failing.map((r) => ({ path: r.path, failures: r.failures })),
    [],
    "a mid-sweep promotion must not be flagged future",
  );
  assert.equal(results.every((r) => r.mode === "strict"), true);

  // The future-date check itself is unchanged: the same post-start publication
  // still fails when the caller pins the reference to the run start.
  const pinned = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: sourceDateForInstant(1),
    publishedAtHeader: promotionInstant,
    nowIso: probeStart,
  });
  assert.equal(pinned.ok, false);
  assert.match(pinned.failures[0], /published at .* is in the future relative to now/);
}

// Legacy environment parsing preserves the old input while rejecting zero or
// invalid values; the resulting cap is still clamped against immutable policy.
{
  assert.equal(parseLegacySourceAgeCap(undefined), undefined);
  assert.equal(parseLegacySourceAgeCap("3"), 3);
  for (const value of ["0", "-1", "not-a-number", "Infinity", ""]) {
    assert.equal(parseLegacySourceAgeCap(value), undefined);
  }
}

// All three plane headers absent on a known fallback family passes as
// FALLBACK-ALLOWED; any single present header escapes fallback.
{
  const allAbsent = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/symbols.json",
    family: "slickcharts-symbols",
    generationHeader: null,
    sourceAsOfHeader: null,
    publishedAtHeader: null,
  });
  assert.equal(allAbsent.ok, true);
  assert.equal(allAbsent.mode, "fallback-allowed");

  const publishedAtOnly = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/symbols.json",
    family: "slickcharts-symbols",
    generationHeader: null,
    sourceAsOfHeader: null,
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(publishedAtOnly.ok, false);
  assert.equal(publishedAtOnly.mode, "strict");
  assert.match(publishedAtOnly.failures[0], /silently serving the deploy-time bundled copy/);
}

// Policy-backed limits: FDIC tier-1 tolerates a 132-day-old source date with a
// fresh heartbeat (path override 180).
{
  const fdicPath = "/data/macro/fdic-tier1.json";
  const r = evaluateProbeResponse({
    ...base,
    path: fdicPath,
    family: "fdic-tier1",
    generationHeader: "fdic-tier1-abc123",
    sourceAsOfHeader: daysAgo(132, true),
    publishedAtHeader: hoursAgo(1),
    maxAgeDays: resolveSourceAgeDays({ path: fdicPath, family: "fdic-tier1" }),
    maxPublishedAgeDays: resolvePublishedAgeDays({ path: fdicPath, family: "fdic-tier1" }),
  });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
}

// Banking cadence overrides: daily 4d, weekly 12d, monthly 70d all pass;
// quarterly 313d exceeds its 180-day limit and fails.
{
  const passes = [
    { path: "/data/macro/fred-banking-daily.json", sourceDays: 4 },
    { path: "/data/macro/fred-banking-weekly.json", sourceDays: 12 },
    { path: "/data/macro/fred-banking-monthly.json", sourceDays: 70 },
  ];
  for (const { path, sourceDays } of passes) {
    const r = evaluateProbeResponse({
      ...base,
      path,
      family: "fred-banking",
      generationHeader: "fred-banking-abc123",
      sourceAsOfHeader: daysAgo(sourceDays, true),
      publishedAtHeader: hoursAgo(1),
      maxAgeDays: resolveSourceAgeDays({ path, family: "fred-banking" }),
      maxPublishedAgeDays: resolvePublishedAgeDays({ path, family: "fred-banking" }),
    });
    assert.equal(r.ok, true, `${path}: ${JSON.stringify(r.failures)}`);
  }
  const quarterlyPath = "/data/macro/fred-banking-quarterly.json";
  const quarterly = evaluateProbeResponse({
    ...base,
    path: quarterlyPath,
    family: "fred-banking",
    generationHeader: "fred-banking-abc123",
    sourceAsOfHeader: daysAgo(313, true),
    publishedAtHeader: hoursAgo(1),
    maxAgeDays: resolveSourceAgeDays({ path: quarterlyPath, family: "fred-banking" }),
    maxPublishedAgeDays: resolvePublishedAgeDays({ path: quarterlyPath, family: "fred-banking" }),
  });
  assert.equal(quarterly.ok, false);
  assert.match(quarterly.failures[0], /days old \(limit 180\)/);
}

// Default source limit: a 6-day-old source fails the 5-day default even with
// a fresh heartbeat.
{
  const r = evaluateProbeResponse({
    ...base,
    generationHeader: "fred-macro-abc123",
    sourceAsOfHeader: daysAgo(6, true),
    publishedAtHeader: hoursAgo(1),
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /days old \(limit 5\)/);
}

// probeAll end-to-end: reads x-data-plane-published-at and applies per-path
// policy limits — every enrolled path passes with policy-aged data and a
// fresh heartbeat.
{
  const healthyHeadersFor = (path) => {
    const family = ENROLLED_PATHS.get(path);
    return {
      "x-data-plane-generation": `${family}-abc123`,
      "x-data-plane-source-as-of": sourceDateForPolicy({ path, family }),
      "x-data-plane-published-at": hoursAgo(1),
    };
  };
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    fetchFn: async (url) => new Response(null, { status: 200, headers: healthyHeadersFor(new URL(url).pathname) }),
  });
  assert.equal(results.length, ENROLLED_PATHS.size);
  const failing = results.filter((r) => !r.ok);
  assert.deepEqual(failing.map((r) => ({ path: r.path, failures: r.failures })), []);
  assert.equal(results.every((r) => r.mode === "strict"), true);
}

// probeAll end-to-end: a stale heartbeat fails even when the source date is
// well within its (generous) path override.
{
  const quarterlyPath = "/data/macro/fred-banking-quarterly.json";
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    fetchFn: async (url) => {
      const path = new URL(url).pathname;
      const family = ENROLLED_PATHS.get(path);
      if (path === quarterlyPath) {
        return new Response(null, {
          status: 200,
          headers: {
            "x-data-plane-generation": `${family}-abc123`,
            "x-data-plane-source-as-of": daysAgo(1, true),
            "x-data-plane-published-at": daysAgo(50),
          },
        });
      }
      return new Response(null, {
        status: 200,
        headers: {
          "x-data-plane-generation": `${family}-abc123`,
          "x-data-plane-source-as-of": sourceDateForPolicy({ path, family }),
          "x-data-plane-published-at": hoursAgo(1),
        },
      });
    },
  });
  const failing = results.filter((r) => !r.ok);
  assert.equal(failing.length, 1);
  assert.equal(failing[0].path, quarterlyPath);
  assert.match(failing[0].failures[0], /published at .* days old \(heartbeat limit 7\)/);
}

// probeAll preserves the legacy maxAgeDays argument as a tightening cap. It
// can tighten a generous path policy but cannot loosen the immutable default.
{
  const runWithLegacyCap = async (maxAgeDays, sourceDaysForPath) => probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    maxAgeDays,
    fetchFn: async (url) => {
      const path = new URL(url).pathname;
      const family = ENROLLED_PATHS.get(path);
      const sourceDays = sourceDaysForPath(path);
      return new Response(null, {
        status: 200,
        headers: {
          "x-data-plane-generation": `${family}-abc123`,
          "x-data-plane-source-as-of": daysAgo(sourceDays, true),
          "x-data-plane-published-at": hoursAgo(1),
        },
      });
    },
  });

  const tightened = await runWithLegacyCap(30, (path) => path === "/data/macro/fdic-tier1.json" ? 40 : 1);
  const tightenedFdic = tightened.find((r) => r.path === "/data/macro/fdic-tier1.json");
  assert.equal(tightenedFdic.ok, false);
  assert.match(tightenedFdic.failures[0], /days old \(limit 30\)/);

  const cannotLoosen = await runWithLegacyCap(999, (path) => path === "/data/macro/fred-macro.json" ? 6 : 1);
  const defaultPath = cannotLoosen.find((r) => r.path === "/data/macro/fred-macro.json");
  assert.equal(defaultPath.ok, false);
  assert.match(defaultPath.failures[0], /days old \(limit 5\)/);

  const zeroUsesPolicy = await runWithLegacyCap(0, (path) => path === "/data/macro/fdic-tier1.json" ? 132 : 1);
  const zeroFdic = zeroUsesPolicy.find((r) => r.path === "/data/macro/fdic-tier1.json");
  assert.equal(zeroFdic.ok, true, JSON.stringify(zeroFdic.failures));
}

// A published family is NOT allowlisted: the 2026-08-03 incident shape (200,
// no headers) still fails for slickcharts-daily.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/gainers.json",
    family: "slickcharts-daily",
    generationHeader: null,
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, "strict");
  assert.match(r.failures[0], /silently serving the deploy-time bundled copy/);
}

// Non-200 fails even for an allowlisted family — fallback never excuses a
// broken serving status.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/stocks/A.json",
    family: "slickcharts-history",
    status: 503,
    generationHeader: null,
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, ["HTTP 503 (expected 200)"]);
}

// Report labels fallback success FALLBACK-ALLOWED, never OK.
{
  const report = buildReport([
    { path: "/data/slickcharts/symbols.json", family: "slickcharts-symbols", ok: true, mode: "fallback-allowed", failures: [] },
    { path: "/data/macro/fred-macro.json", family: "fred-macro", ok: true, mode: "strict", failures: [] },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.failingCount, 0);
  assert.match(report.body, /- FALLBACK-ALLOWED \/data\/slickcharts\/symbols\.json \(slickcharts-symbols\)/);
  assert.match(report.body, /- OK \/data\/macro\/fred-macro\.json \(fred-macro\)/);
  assert.doesNotMatch(report.body, /FALLBACK-ALLOWED .*\(fred-macro\)/);
}

// The fallback allowlist only names families production actually enrolls
// (exact entries or prefix declarations) — enforced at module load.
{
  const enrolledFamilies = new Set([
    ...ENROLLED_PATHS.values(),
    ...ENROLLED_PREFIXES.map(({ family }) => family),
  ]);
  for (const family of FALLBACK_ALLOWED_FAMILIES) {
    assert.equal(enrolledFamilies.has(family), true, `family ${family} must be enrolled`);
  }
}

// Known limitation: EDGAR is prefix-enrolled, while probeAll enumerates exact
// ENROLLED_PATHS only. This patch defines its fallback policy but does not
// claim live EDGAR coverage.
{
  assert.equal([...ENROLLED_PATHS.values()].includes("edgar-korean-summaries"), false);
  assert.equal(ENROLLED_PREFIXES.some(({ family }) => family === "edgar-korean-summaries"), true);
}

console.log("probe-data-plane-serving tests passed");
