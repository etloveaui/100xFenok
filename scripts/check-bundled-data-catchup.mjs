#!/usr/bin/env node
// X7b: one marked hourly catch-up; no deployment without changed bundle inputs.
// Admission only. The existing pre-upload provenance/ancestry and live smokes
// remain the authoritative deployment fence.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isDeployProvenance } from "./lib/deploy-provenance.mjs";
import { liveRequestHeaders } from "./lib/live-request-headers.mjs";

export function isBundleInput(file, publicFiles = new Set()) {
  if (/^(100xfenok-next|100x|alpha-scout|tools|ib|admin|posts)\//.test(file)) return true;
  if (file.startsWith("data/admin/")) {
    // Most admin state is not served. Retain actual public status counterparts
    // and the ETF resolver journal from which bundled selected payloads derive.
    return publicFiles.has(`100xfenok-next/public/${file}`)
      || file.startsWith("data/admin/data-supply-state/");
  }
  // Canonical inputs are rebuilt into public fallbacks, including the private
  // Yahoo ETF source used by the selected-payload materializer. R2 enrollment
  // does not remove the ASSETS fallback, so it cannot exclude these inputs.
  if (file.startsWith("data/")) return true;
  return /^scripts\/(lib\/|build-|materialize-|materialize_|export-computed-signals|update-manifest)/.test(file);
}

export function catchupDecision({ codeRuns = [], live, buildId, files, publicFiles }) {
  if (codeRuns.some((run) => run.event === "push" && run.status !== "completed")) {
    return "skip-code-deploy";
  }
  if (!isDeployProvenance(live) || live.build_id !== buildId?.trim()) {
    throw new Error("Live provenance/BUILD_ID is unavailable or inconsistent");
  }
  if (!Array.isArray(files)) throw new Error("Bundle input diff is unavailable");
  return files.some((file) => isBundleInput(file, publicFiles)) ? "proceed" : "skip-unchanged";
}

export async function checkCatchup({ head = process.env.GITHUB_SHA, repo = process.env.GITHUB_REPOSITORY,
  command = execFileSync, fetchImpl = globalThis.fetch } = {}) {
  if (!/^[0-9a-f]{40}$/i.test(head ?? "") || repo !== "etloveaui/100xFenok") {
    throw new Error("Catch-up requires the pinned main revision and canonical repository");
  }
  const codeRuns = [];
  for (const status of ["queued", "requested", "waiting", "pending", "in_progress"]) {
    const rows = JSON.parse(command("gh", ["run", "list", "--repo", repo,
      "--workflow", "deploy-worker.yml", "--branch", "main", "--event", "push",
      "--status", status, "--limit", "1", "--json", "event,status"], { encoding: "utf8" }));
    if (!Array.isArray(rows)) throw new Error("Code deploy queue is unreadable");
    codeRuns.push(...rows);
  }
  if (codeRuns.length) return catchupDecision({ codeRuns });
  const base = "https://100xfenok.etloveaui.workers.dev";
  const suffix = `?cb=hourly-catchup-${Date.now()}`;
  const read = async (pathname) => {
    const response = await fetchImpl(base + pathname + suffix, {
      headers: { "cache-control": "no-cache, no-store", ...liveRequestHeaders() },
      redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) throw new Error(`${pathname}: HTTP ${response.status}`);
    return response.text();
  };
  const [raw, buildId] = await Promise.all([read("/deploy-provenance.json"), read("/BUILD_ID")]);
  const live = JSON.parse(raw);
  if (!isDeployProvenance(live)) throw new Error("Live provenance is malformed");
  // Endpoint tree comparison, not a capped 300-file compare API response.
  // The gate's partial clone has the full graph/trees, without data blobs.
  const files = command("git", ["diff", "--name-only", "-z", live.sha, head, "--"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
  const publicFiles = new Set(command("git", ["ls-tree", "-r", "--name-only", "-z", head,
    "--", "100xfenok-next/public/data"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean));
  return catchupDecision({ codeRuns, live, buildId, files, publicFiles });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkCatchup().then((decision) => console.log(decision))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
