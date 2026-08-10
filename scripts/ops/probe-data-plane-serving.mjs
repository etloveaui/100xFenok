// Hourly proof that every enrolled data-plane asset is actually served from a
// published generation, with data young enough to trust. Born 2026-08-03: the
// enrolled URL silently served the deploy-time bundled copy (valid 200, no
// generation header, stale bytes) and nothing noticed until a human probed it.
// A missing header IS the incident this probe exists to catch — fallback is a
// designed degradation, but an unobserved one is silent staleness.
//
// Some enrolled families are intentionally unpublished on the data plane for
// now (see FALLBACK_ALLOWED_FAMILIES). For exactly those families, a 200 with
// BOTH plane headers absent is their designed static-fallback state and passes
// as FALLBACK-ALLOWED — observable, not silent. Every other shape for those
// families, and every shape for published families, is validated strictly, so
// a real serving defect can never hide behind the allowlist.
//
// The enrolled-path list is imported from the Worker read module so the probe
// can never drift from what production actually serves.

import { ENROLLED_PATHS, ENROLLED_PREFIXES } from "../lib/cloud-data-plane-worker-read.mjs";

export const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
// Calendar days of source-date age tolerated before the probe alarms. Macro
// families refresh on business days; 5 calendar days survives any long
// weekend while still catching a stalled publisher within the week.
export const DEFAULT_MAX_SOURCE_AGE_DAYS = 5;

// Families that are enrolled but intentionally not yet published to the data
// plane. Static fallback (200 with no plane headers) is their designed serving
// mode until they are published; the probe observes it instead of alarming on
// it. Any family not listed here is strict, and stays fail-closed.
export const FALLBACK_ALLOWED_FAMILIES = Object.freeze([
  "slickcharts-history",
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
}

export function evaluateProbeResponse({ path, family, status, generationHeader, sourceAsOfHeader, nowIso, maxAgeDays }) {
  const failures = [];
  if (status !== 200) {
    failures.push(`HTTP ${status} (expected 200)`);
    return { path, family, ok: false, mode: "strict", failures };
  }
  const fallbackAllowed = FALLBACK_ALLOWED_FAMILY_SET.has(family);
  if (fallbackAllowed && generationHeader == null && sourceAsOfHeader == null) {
    // Designed static fallback for an intentionally unpublished family: the
    // URL is serving the bundled copy and that is the agreed, observed state.
    return { path, family, ok: true, mode: "fallback-allowed", failures };
  }
  if (!generationHeader || !generationHeader.startsWith(`${family}-`)) {
    failures.push(
      `x-data-plane-generation is ${generationHeader == null ? "absent — the URL is silently serving the deploy-time bundled copy" : `"${generationHeader}" (expected prefix "${family}-")`}`,
    );
  }
  const sourceMs = Date.parse(sourceAsOfHeader ?? "");
  if (!Number.isFinite(sourceMs)) {
    failures.push(`x-data-plane-source-as-of is ${sourceAsOfHeader == null ? "absent" : `unparseable ("${sourceAsOfHeader}")`}`);
  } else {
    const ageDays = (Date.parse(nowIso) - sourceMs) / 86400000;
    if (ageDays > maxAgeDays) {
      failures.push(`source date ${sourceAsOfHeader} is ${ageDays.toFixed(1)} days old (limit ${maxAgeDays})`);
    }
  }
  return { path, family, ok: failures.length === 0, mode: "strict", failures };
}

export async function probeAll({ baseUrl, fetchFn, nowIso, maxAgeDays }) {
  const results = [];
  // This enumerates exact ENROLLED_PATHS only. Prefix-enrolled EDGAR policy is
  // defined above but has no live probe coverage here; adding representative
  // prefix paths requires a separate contract and is intentionally out of scope.
  for (const [path, family] of ENROLLED_PATHS) {
    let response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, { redirect: "manual" });
    } catch (error) {
      results.push({ path, family, ok: false, mode: "strict", failures: [`fetch failed: ${error?.message ?? error}`] });
      continue;
    }
    results.push(evaluateProbeResponse({
      path,
      family,
      status: response.status,
      generationHeader: response.headers.get("x-data-plane-generation"),
      sourceAsOfHeader: response.headers.get("x-data-plane-source-as-of"),
      nowIso,
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
  const maxAgeDays = Number(process.env.PROBE_MAX_SOURCE_AGE_DAYS) || DEFAULT_MAX_SOURCE_AGE_DAYS;
  const results = await probeAll({
    baseUrl,
    fetchFn: fetch,
    nowIso: new Date().toISOString(),
    maxAgeDays,
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
