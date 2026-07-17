#!/usr/bin/env node

// check-deploy-supersession — queued-supersession guard for the serialized
// deploy job (cancel-in-progress:false). If a NEWER run of this workflow is
// already active, this run's deploy is redundant: skip BEFORE any upload,
// never after. Writes SUPERSEDED=true|false to $GITHUB_ENV.
//
// Fail-open toward progress: any API failure means "not superseded" (the worst
// case of a wrong "not superseded" is one extra verified deploy; the worst
// case of a wrong "superseded" is a bundle that never ships).
//
// Env: GH_TOKEN (optional), GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_NUMBER,
// GITHUB_WORKFLOW_FILE_NAME (set by the workflow; default deploy-worker.yml).

import fs from "node:fs";

import { filterRunsByHeadBranch, selectNewerActiveRun } from "./lib/deploy-provenance.mjs";

function setSuperseded(value, env) {
  const line = `SUPERSEDED=${value}`;
  if (env.GITHUB_ENV) {
    fs.appendFileSync(env.GITHUB_ENV, `${line}\n`);
  }
  console.log(line);
}

async function fetchWorkflowRuns({ repository, workflowFile, token }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/runs?per_page=30`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: token ? `Bearer ${token}` : "",
          "x-github-api-version": "2022-11-28",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body?.workflow_runs) ? body.workflow_runs : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const env = process.env;
const currentRunNumber = Number.parseInt(env.GITHUB_RUN_NUMBER ?? "", 10);

if (!env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID || !Number.isFinite(currentRunNumber)) {
  console.log("::warning::Supersession check lacks run identity; treating as not superseded.");
  setSuperseded("false", env);
  process.exit(0);
}

const runs = await fetchWorkflowRuns({
  repository: env.GITHUB_REPOSITORY,
  workflowFile: env.GITHUB_WORKFLOW_FILE_NAME ?? "deploy-worker.yml",
  token: env.GH_TOKEN,
});

if (runs === null) {
  console.log("::warning::Supersession check could not list workflow runs; treating as not superseded.");
  setSuperseded("false", env);
  process.exit(0);
}

const newer = selectNewerActiveRun({
  currentRunId: env.GITHUB_RUN_ID,
  currentRunNumber,
  runs: filterRunsByHeadBranch(runs, "main"),
});

if (newer) {
  console.log(
    `::notice::Deploy superseded by newer active run ${newer.id} `
    + `(run_number ${newer.run_number} > ${currentRunNumber}); skipping before upload.`,
  );
  setSuperseded("true", env);
} else {
  setSuperseded("false", env);
}
