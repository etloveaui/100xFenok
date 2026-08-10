#!/usr/bin/env node

// Fail closed before `wrangler deploy` unless the downloaded artifact was
// built by this workflow run, remains on current main, and is not older than
// the source already serving live. Remediation mode independently proves the
// canonical Worker is live but exposes neither recognized provenance surface.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED,
  DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID,
  DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH,
  DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  DEPLOY_SOURCE_FENCE_MODE_STRICT,
  evaluateDeploySourceFence,
  isDeployProvenance,
} from "./lib/deploy-provenance.mjs";

export const DEPLOY_SOURCE_FENCE_CANONICAL_LIVE_BASE_URL = "https://100xfenok.etloveaui.workers.dev";

const LIVE_PROBE_HEADERS = Object.freeze({
  "cache-control": "no-cache, no-store",
  pragma: "no-cache",
});

function argValue(name, argv) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function readProvenance(provenancePath) {
  if (!provenancePath || !fs.existsSync(provenancePath)) {
    return { payload: null, state: "absent" };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
    return isDeployProvenance(payload)
      ? { payload, state: "present-valid" }
      : { payload: null, state: "present-invalid" };
  } catch {
    return { payload: null, state: "present-invalid" };
  }
}

function isAncestor(ancestorSha, descendantSha, cwd) {
  if (!ancestorSha || !descendantSha) return null;
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestorSha, descendantSha],
    { cwd, encoding: "utf8" },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
}

function probeUrl(baseUrl, publicPath, cacheBust) {
  const url = new URL(publicPath, `${baseUrl}/`);
  url.searchParams.set("cb", cacheBust);
  return url.toString();
}

async function fetchProbeResponse(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: LIVE_PROBE_HEADERS,
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response || !Number.isInteger(response.status)) {
      return { error: "response status unavailable", response: null };
    }
    return { error: null, response };
  } catch {
    return { error: "transport failure", response: null };
  } finally {
    clearTimeout(timer);
  }
}

function blockedProbe(verdict, detail) {
  return { allowed: false, verdict, detail, liveBuildId: null };
}

// Testable pure-I/O boundary for the one remediation exception. Production CLI
// calls this without a baseUrl override, so proof is always against the fixed
// canonical Worker. Tests may inject fetchImpl and a deterministic cache bust.
export async function probeUnprovenancedLive({
  fetchImpl = globalThis.fetch,
  baseUrl = DEPLOY_SOURCE_FENCE_CANONICAL_LIVE_BASE_URL,
  cacheBust = `deploy-remediation-${Date.now()}`,
  timeoutMs = 15000,
} = {}) {
  if (baseUrl !== DEPLOY_SOURCE_FENCE_CANONICAL_LIVE_BASE_URL) {
    return blockedProbe("live-base-not-canonical", "remediation proof must target the canonical Worker base URL");
  }
  if (typeof fetchImpl !== "function") {
    return blockedProbe("live-probe-transport", "native fetch is unavailable");
  }

  const buildProbe = await fetchProbeResponse(
    fetchImpl,
    probeUrl(baseUrl, "/BUILD_ID", cacheBust),
    timeoutMs,
  );
  if (buildProbe.error) {
    return blockedProbe("live-probe-transport", `BUILD_ID ${buildProbe.error}`);
  }
  if (buildProbe.response.status !== 200) {
    return blockedProbe(
      "live-build-id-http",
      `BUILD_ID must return HTTP 200, observed ${buildProbe.response.status}`,
    );
  }

  let liveBuildId;
  try {
    liveBuildId = (await buildProbe.response.text()).replace(/[\r\n]/g, "").trim();
  } catch {
    return blockedProbe("live-probe-transport", "BUILD_ID body read failed");
  }
  if (!liveBuildId) {
    return blockedProbe("live-build-id-empty", "BUILD_ID returned HTTP 200 but no nonempty identity");
  }

  const freshProbe = await fetchProbeResponse(
    fetchImpl,
    probeUrl(baseUrl, "/deploy-provenance.json", cacheBust),
    timeoutMs,
  );
  if (freshProbe.error) {
    return blockedProbe("live-probe-transport", `fresh provenance ${freshProbe.error}`);
  }
  if (freshProbe.response.status !== 404) {
    return blockedProbe(
      "fresh-provenance-present-or-unavailable",
      `fresh provenance must return HTTP 404, observed ${freshProbe.response.status}`,
    );
  }

  const legacyProbe = await fetchProbeResponse(
    fetchImpl,
    probeUrl(baseUrl, "/data/admin/deploy-provenance.json", cacheBust),
    timeoutMs,
  );
  if (legacyProbe.error) {
    return blockedProbe("live-probe-transport", `legacy provenance ${legacyProbe.error}`);
  }
  if (legacyProbe.response.status !== 404) {
    return blockedProbe(
      "legacy-provenance-present-or-unavailable",
      `legacy provenance must return HTTP 404, observed ${legacyProbe.response.status}`,
    );
  }

  return {
    allowed: true,
    verdict: DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED,
    detail: "canonical live BUILD_ID is present and both recognized provenance surfaces return exact HTTP 404",
    liveBuildId,
  };
}

export async function runDeploySourceFenceCli({
  argv = process.argv,
  env = process.env,
  fetchImpl = globalThis.fetch,
  gitCwd = process.cwd(),
  now = () => Date.now(),
  emit = (message) => console.log(message),
  emitError = (message) => console.error(message),
} = {}) {
  const provenancePath = argValue("--provenance", argv);
  const liveProvenancePath = argValue("--live-provenance", argv);
  const expectedBuildId = argValue("--expected-build-id", argv);
  const mode = argValue("--mode", argv) ?? DEPLOY_SOURCE_FENCE_MODE_STRICT;
  const callerLiveBuildId = argValue("--live-build-id", argv);
  const currentMainSha = argValue("--current-main", argv);
  if (!provenancePath || !liveProvenancePath || !expectedBuildId || !currentMainSha) {
    emitError(
      "::error::usage: node scripts/check-deploy-source-fence.mjs "
      + "--provenance <deploy-provenance.json> --expected-build-id <BUILD_ID> "
      + "--live-provenance <live-deploy-provenance.json> --current-main <sha>",
    );
    return 1;
  }

  const artifactPayload = readProvenance(provenancePath).payload;
  let liveProvenance = null;
  let liveProvenanceState = "absent";
  let liveBuildId = callerLiveBuildId;

  if (mode === DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE) {
    if (
      env.DEPLOY_EVENT_NAME !== "workflow_dispatch"
      || env.DEPLOY_REMEDIATION_INPUT !== "true"
    ) {
      emitError(
        "::error::Deploy remediation mode requires this workflow_dispatch run's explicit owner input.",
      );
      return 1;
    }
    const probe = await probeUnprovenancedLive({
      fetchImpl,
      cacheBust:
        `source-fence-cli-${env.GITHUB_RUN_ID ?? "run"}-${env.GITHUB_RUN_ATTEMPT ?? "1"}-${now()}`,
    });
    if (!probe.allowed) {
      emitError(`::error::Deploy remediation live probe ${probe.verdict}: ${probe.detail}`);
      return 1;
    }
    // Authoritative probe result: caller state/build arguments and any stale
    // live-provenance temp file cannot establish or alter remediation state.
    liveProvenanceState = DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED;
    liveBuildId = probe.liveBuildId;
    emit(
      `::warning::Deploy remediation live probe verified exact unprovenanced state: live BUILD_ID=${liveBuildId}`,
    );
  } else {
    const liveProvenanceRead = readProvenance(liveProvenancePath);
    liveProvenance = liveProvenanceRead.payload;
    liveProvenanceState = liveProvenanceRead.state;
    if (liveProvenanceRead.state === "present-invalid") {
      liveProvenanceState = DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID;
    } else if (
      liveProvenance
      && typeof callerLiveBuildId === "string"
      && callerLiveBuildId.length > 0
      && liveProvenance.build_id !== callerLiveBuildId
    ) {
      liveProvenanceState = DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH;
    }
  }

  const artifactSha = artifactPayload?.sha ?? null;
  const liveSha = liveProvenance?.sha ?? null;
  const result = evaluateDeploySourceFence({
    artifactSha,
    runSha: env.GITHUB_SHA ?? null,
    currentMainSha,
    liveSha,
    artifactRunId: artifactPayload?.run_id ?? null,
    currentRunId: env.GITHUB_RUN_ID ?? null,
    artifactRunNumber: artifactPayload?.run_number ?? null,
    currentRunNumber: Number.parseInt(env.GITHUB_RUN_NUMBER ?? "", 10),
    artifactRunAttempt: artifactPayload?.run_attempt ?? null,
    currentRunAttempt: Number.parseInt(env.GITHUB_RUN_ATTEMPT ?? "", 10),
    liveRunNumber: liveProvenance?.run_number ?? null,
    liveRunAttempt: liveProvenance?.run_attempt ?? null,
    artifactIsAncestorOfCurrentMain: isAncestor(artifactSha, currentMainSha, gitCwd),
    liveIsAncestorOfArtifact: isAncestor(liveSha, artifactSha, gitCwd),
    artifactIsAncestorOfLive: isAncestor(artifactSha, liveSha, gitCwd),
    artifactBuildId: artifactPayload?.build_id ?? null,
    expectedBuildId,
    mode,
    liveProvenanceState,
    liveBuildId,
  });

  const annotation = result.allowed ? "notice" : "error";
  emit(`::${annotation}::Deploy source fence ${result.verdict}: ${result.detail}`);
  return result.allowed ? 0 : 1;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsMain) {
  try {
    process.exitCode = await runDeploySourceFenceCli();
  } catch {
    console.error("::error::Deploy source fence terminated unexpectedly.");
    process.exitCode = 1;
  }
}
