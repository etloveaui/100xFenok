#!/usr/bin/env node

// Fail closed before `wrangler deploy` unless the downloaded artifact was
// built by this workflow run, remains on current main, and is not older than
// the source already serving live.

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import {
  evaluateDeploySourceFence,
  isDeployProvenance,
} from "./lib/deploy-provenance.mjs";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function readProvenance(provenancePath) {
  if (!provenancePath || !fs.existsSync(provenancePath)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
    return isDeployProvenance(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isAncestor(ancestorSha, descendantSha) {
  if (!ancestorSha || !descendantSha) return null;
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestorSha, descendantSha],
    { encoding: "utf8" },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
}

const provenancePath = argValue("--provenance");
const liveProvenancePath = argValue("--live-provenance");
const currentMainSha = argValue("--current-main");
if (!provenancePath || !liveProvenancePath || !currentMainSha) {
  console.error(
    "::error::usage: node scripts/check-deploy-source-fence.mjs "
    + "--provenance <deploy-provenance.json> "
    + "--live-provenance <live-deploy-provenance.json> --current-main <sha>",
  );
  process.exit(1);
}

const artifactProvenance = readProvenance(provenancePath);
const liveProvenance = readProvenance(liveProvenancePath);
const artifactSha = artifactProvenance?.sha ?? null;
const liveSha = liveProvenance?.sha ?? null;
const result = evaluateDeploySourceFence({
  artifactSha,
  runSha: process.env.GITHUB_SHA ?? null,
  currentMainSha,
  liveSha,
  artifactRunId: artifactProvenance?.run_id ?? null,
  currentRunId: process.env.GITHUB_RUN_ID ?? null,
  artifactRunNumber: artifactProvenance?.run_number ?? null,
  currentRunNumber: Number.parseInt(process.env.GITHUB_RUN_NUMBER ?? "", 10),
  artifactRunAttempt: artifactProvenance?.run_attempt ?? null,
  currentRunAttempt: Number.parseInt(process.env.GITHUB_RUN_ATTEMPT ?? "", 10),
  liveRunNumber: liveProvenance?.run_number ?? null,
  liveRunAttempt: liveProvenance?.run_attempt ?? null,
  artifactIsAncestorOfCurrentMain: isAncestor(artifactSha, currentMainSha),
  liveIsAncestorOfArtifact: isAncestor(liveSha, artifactSha),
  artifactIsAncestorOfLive: isAncestor(artifactSha, liveSha),
});

const annotation = result.allowed ? "notice" : "error";
console.log(`::${annotation}::Deploy source fence ${result.verdict}: ${result.detail}`);
if (!result.allowed) process.exit(1);
