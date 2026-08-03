// Hourly proof that every enrolled data-plane asset is actually served from a
// published generation, with data young enough to trust. Born 2026-08-03: the
// enrolled URL silently served the deploy-time bundled copy (valid 200, no
// generation header, stale bytes) and nothing noticed until a human probed it.
// A missing header IS the incident this probe exists to catch — fallback is a
// designed degradation, but an unobserved one is silent staleness.
//
// The enrolled-path list is imported from the Worker read module so the probe
// can never drift from what production actually serves.

import { ENROLLED_PATHS } from "../lib/cloud-data-plane-worker-read.mjs";

export const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
// Calendar days of source-date age tolerated before the probe alarms. Macro
// families refresh on business days; 5 calendar days survives any long
// weekend while still catching a stalled publisher within the week.
export const DEFAULT_MAX_SOURCE_AGE_DAYS = 5;

export function evaluateProbeResponse({ path, family, status, generationHeader, sourceAsOfHeader, nowIso, maxAgeDays }) {
  const failures = [];
  if (status !== 200) {
    failures.push(`HTTP ${status} (expected 200)`);
    return { path, family, ok: false, failures };
  }
  if (!generationHeader || !generationHeader.startsWith(`${family}-`)) {
    failures.push(
      `x-data-plane-generation is ${generationHeader ? `"${generationHeader}" (expected prefix "${family}-")` : "absent — the URL is silently serving the deploy-time bundled copy"}`,
    );
  }
  const sourceMs = Date.parse(sourceAsOfHeader ?? "");
  if (!Number.isFinite(sourceMs)) {
    failures.push(`x-data-plane-source-as-of is ${sourceAsOfHeader ? `unparseable ("${sourceAsOfHeader}")` : "absent"}`);
  } else {
    const ageDays = (Date.parse(nowIso) - sourceMs) / 86400000;
    if (ageDays > maxAgeDays) {
      failures.push(`source date ${sourceAsOfHeader} is ${ageDays.toFixed(1)} days old (limit ${maxAgeDays})`);
    }
  }
  return { path, family, ok: failures.length === 0, failures };
}

export async function probeAll({ baseUrl, fetchFn, nowIso, maxAgeDays }) {
  const results = [];
  for (const [path, family] of ENROLLED_PATHS) {
    let response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, { redirect: "manual" });
    } catch (error) {
      results.push({ path, family, ok: false, failures: [`fetch failed: ${error?.message ?? error}`] });
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
      lines.push(`- OK ${r.path} (${r.family})`);
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
