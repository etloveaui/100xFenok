#!/usr/bin/env node

// check-live-deploy-provenance — ask, before and after a deploy, whether the
// bundle the Worker is serving belongs to a run whose smokes actually passed.
//
// Modes:
//   --pre   (before wrangler deploy) classify the CURRENT live bundle and emit
//           a GitHub annotation. NEVER exits non-zero: an unverified live
//           bundle is named loudly and this run still deploys over it —
//           detection must not starve remediation (DEC-264/DEC-266).
//   --post  (after the identity-match smoke) assert the live provenance stamp
//           belongs to THIS run. A mismatch means the serving surface moved
//           under us between upload and verification — fail loudly.
//
// Env: BASE_URL (default production), GH_TOKEN (optional; enables the GitHub
// API lookup), GITHUB_REPOSITORY, GITHUB_RUN_ID, EXPECTED_BUILD_ID (--post).

import {
  DEPLOY_PROVENANCE_PUBLIC_PATH,
  classifyLiveProvenance,
  evaluatePostObservation,
  isDeployProvenance,
} from "./lib/deploy-provenance.mjs";

const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";

function parseMode(argv) {
  const mode = argv[2];
  if (mode !== "--pre" && mode !== "--post") {
    throw new Error("usage: node scripts/check-live-deploy-provenance.mjs --pre|--post");
  }
  return mode.slice(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { timeoutMs = 15000, retries = 3 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { "cache-control": "no-cache, no-store", pragma: "no-cache" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(2000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("fetch failed");
}

async function fetchLiveBundleIdentity(baseUrl, cacheBust) {
  const buildIdUrl = `${baseUrl}/BUILD_ID?cb=${cacheBust}`;
  const provenanceUrl = `${baseUrl}/${DEPLOY_PROVENANCE_PUBLIC_PATH}?cb=${cacheBust}`;
  let liveBuildId = null;
  try {
    liveBuildId = (await fetchText(buildIdUrl)).replace(/[\r\n]/g, "");
  } catch {
    liveBuildId = null;
  }
  let liveProvenance = null;
  try {
    liveProvenance = JSON.parse(await fetchText(provenanceUrl));
  } catch {
    liveProvenance = null; // missing or malformed -> legacy/unprovenanced
  }
  return { liveBuildId, liveProvenance };
}

async function fetchRunConclusion({ repository, runId, token }) {
  if (!token || !repository || !runId) return { apiAvailable: false, conclusion: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
        signal: controller.signal,
      },
    );
    if (response.status === 404) return { apiAvailable: true, conclusion: null };
    if (!response.ok) return { apiAvailable: false, conclusion: null };
    const body = await response.json();
    return { apiAvailable: true, conclusion: body?.conclusion ?? null };
  } catch {
    return { apiAvailable: false, conclusion: null };
  } finally {
    clearTimeout(timer);
  }
}

function emit(level, message) {
  console.log(`::${level}::${message}`);
}

async function runPre(env) {
  const baseUrl = env.BASE_URL ?? DEFAULT_BASE_URL;
  const currentRunId = env.GITHUB_RUN_ID ?? "";
  const expectedBuildId = env.EXPECTED_BUILD_ID ?? "";
  const cacheBust = `provenance-pre-${currentRunId}-${env.GITHUB_RUN_ATTEMPT ?? "1"}-${Date.now()}`;

  const { liveBuildId, liveProvenance } = await fetchLiveBundleIdentity(baseUrl, cacheBust);

  let apiAvailable = true;
  let liveRunConclusion = null;
  if (
    isDeployProvenance(liveProvenance)
    && liveProvenance.run_id !== currentRunId
  ) {
    const api = await fetchRunConclusion({
      repository: env.GITHUB_REPOSITORY,
      runId: liveProvenance.run_id,
      token: env.GH_TOKEN,
    });
    apiAvailable = api.apiAvailable;
    liveRunConclusion = api.conclusion;
  }

  const result = classifyLiveProvenance({
    apiAvailable,
    currentRunId,
    expectedBuildId: expectedBuildId || "unresolved",
    liveBuildId,
    liveProvenance,
    liveRunConclusion,
  });

  // Machine-greppable record first, human annotation second.
  console.log(`LIVE_DEPLOY_PROVENANCE ${JSON.stringify({
    verdict: result.verdict,
    live_build_id: liveBuildId,
    live_run_id: isDeployProvenance(liveProvenance) ? liveProvenance.run_id : null,
    live_run_conclusion: liveRunConclusion,
  })}`);
  emit(result.annotation, `Live deploy provenance: ${result.verdict} — ${result.detail}`);
  // Deliberately always exit 0 (see header): remediation proceeds.
}

async function runPost(env) {
  const baseUrl = env.BASE_URL ?? DEFAULT_BASE_URL;
  const currentRunId = env.GITHUB_RUN_ID ?? "";
  const expectedBuildId = env.EXPECTED_BUILD_ID ?? "";

  if (!expectedBuildId) {
    emit("error", "Deploy provenance post-check requires EXPECTED_BUILD_ID.");
    process.exit(1);
  }

  // Cloudflare edges roll over gradually: /BUILD_ID and the provenance asset
  // can disagree for seconds right after a deploy (run 29559387354 failed its
  // first --post on exactly that flip-flop). Poll like the sibling smokes do;
  // only a state that persists past the window is a real anomaly.
  const timeoutSeconds = Number.parseInt(env.POST_PROVENANCE_TIMEOUT_SECONDS ?? "60", 10);
  const intervalSeconds = Number.parseInt(env.POST_PROVENANCE_INTERVAL_SECONDS ?? "5", 10);
  const deadline = Date.now() + Math.max(1, timeoutSeconds) * 1000;
  const intervalMs = Math.max(1, intervalSeconds) * 1000;

  let attempt = 0;
  let lastEvaluation = null;
  for (;;) {
    attempt += 1;
    const cacheBust = `provenance-post-${currentRunId}-${env.GITHUB_RUN_ATTEMPT ?? "1"}-${attempt}-${Date.now()}`;
    const { liveBuildId, liveProvenance } = await fetchLiveBundleIdentity(baseUrl, cacheBust);
    lastEvaluation = evaluatePostObservation({
      currentRunId,
      expectedBuildId,
      liveBuildId,
      liveProvenance,
    });

    if (lastEvaluation.match) {
      emit(
        "notice",
        `DEPLOY PROVENANCE MATCH: live bundle declared by this run (run_id=${currentRunId}, `
        + `build_id=${expectedBuildId}, provenance run_attempt=${liveProvenance.run_attempt}) attempts=${attempt}`,
      );
      return;
    }

    if (Date.now() + intervalMs > deadline) {
      break;
    }
    emit(
      "warning",
      `Provenance propagation attempt ${attempt} not yet consistent: ${lastEvaluation.detail}`,
    );
    await sleep(intervalMs);
  }

  emit("error", `${lastEvaluation.detail} (still unresolved after ${timeoutSeconds}s, attempts=${attempt})`);
  process.exit(1);
}

const mode = parseMode(process.argv);
if (mode === "pre") {
  await runPre(process.env);
} else {
  await runPost(process.env);
}
