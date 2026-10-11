#!/usr/bin/env node
// A workflow that checks out part of the tree must declare every directory the
// scripts it runs actually import. Nothing enforced this, so 2026-08-17
// e1f7c9f072 colocated the cloud-data-plane read runtime under 100xfenok-next
// and silently disarmed several lanes at once: the data-plane serving probe
// died at module load on 15 consecutive runs, the SEC 13F private-route smoke
// died the same way and left its alarm issue stuck open because a
// continue-on-error step reports success, and fetch-oecd-cli was left primed to
// die on its next run. Each failure looked like a different incident.
//
// The requirement is derived from the real module graph rather than maintained
// by hand, so the next move of a shared module fails here instead of in
// production.

import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

// Directories that exist only at build time or are produced by an earlier step
// are not import targets and never need declaring.
const IMPORT_PATTERN = /from\s+["'](\.[^"']+)["']/g;
const SCRIPT_INVOCATION = /node\s+((?:100xfenok-next\/)?scripts\/[\w./-]+\.mjs)/g;

export function importedDirectories(entryRelativePath, repoRoot = REPO_ROOT) {
  const seen = new Set();
  const directories = new Set();
  const visit = (absolutePath) => {
    if (seen.has(absolutePath) || !fs.existsSync(absolutePath)) return;
    seen.add(absolutePath);
    directories.add(path.relative(repoRoot, path.dirname(absolutePath)));
    for (const match of fs.readFileSync(absolutePath, "utf8").matchAll(IMPORT_PATTERN)) {
      visit(path.resolve(path.dirname(absolutePath), match[1]));
    }
  };
  visit(path.join(repoRoot, entryRelativePath));
  return [...directories].sort();
}

// Cone mode takes bare directories; non-cone mode takes leading-slash patterns
// and may name a single file. Normalise both to a comparable prefix.
export function declaredPrefixes(workflowSource) {
  const block = /sparse-checkout:\s*\|\n([\s\S]*?)\n(?=\s{0,10}[a-z-]+:|\s*- )/.exec(workflowSource);
  if (!block) return null;
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[a-z-]+:/.test(line))
    .map((line) => line.replace(/^\/+/, "").replace(/\/+$/, ""));
}

// Cone mode materialises the files sitting directly in each selected path's
// leading directories, so declaring 100xfenok-next/scripts also brings the
// files in 100xfenok-next itself. Non-cone mode has no such implication and
// takes only what it is given.
export function coversDirectory(prefixes, directory, coneMode = true) {
  return prefixes.some((prefix) => {
    if (prefix === "" || directory === prefix || directory.startsWith(`${prefix}/`)) return true;
    // A single declared file implies its own directory is present.
    if (prefix.endsWith(".mjs") && path.dirname(prefix) === directory) return true;
    return coneMode && `${prefix}/`.startsWith(`${directory}/`);
  });
}

// Checkout state belongs to a job and changes in step order. A small admission
// job cannot restrict a separate full-checkout worker. Compare actual files:
// including one file in a directory does not include its imported siblings.
export function importedFiles(entry, repoRoot = REPO_ROOT) {
  const seen = new Set();
  function visit(relative) {
    if (seen.has(relative) || !fs.existsSync(path.join(repoRoot, relative))) return;
    seen.add(relative);
    const text = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    const imports = /(?:from\s+|import\s*\(|require\s*\(|import\s+)["'](\.[^"']+)["']/g;
    for (const match of text.matchAll(imports)) visit(path.normalize(path.join(path.dirname(relative), match[1])));
  }
  visit(entry);
  return [...seen].sort();
}

export function coversFile(prefixes, file, coneMode = true) {
  let covered = coneMode && !file.includes("/");
  for (const raw of prefixes) {
    const negative = raw.startsWith("!");
    const prefix = raw.replace(/^!/, "").replace(/^\/+|\/+$/g, "");
    const glob = prefix.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
    const matches = !prefix || new RegExp(`^${glob}(?:/|$)`).test(file)
      || (coneMode && `${prefix}/`.startsWith(`${path.dirname(file)}/`));
    if (matches) covered = !negative;
  }
  return covered;
}

export function workflowViolations(workflow, file, repoRoot = REPO_ROOT) {
  const violations = [];
  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    let prefixes = null;
    let coneMode = true;
    for (const step of job.steps ?? []) {
      if (/^actions\/checkout@/.test(step.uses ?? "")) {
        const withOptions = step.with ?? {};
        prefixes = withOptions["sparse-checkout"] == null ? null
          : String(withOptions["sparse-checkout"]).split("\n").map((x) => x.trim()).filter(Boolean);
        coneMode = ![false, "false"].includes(withOptions["sparse-checkout-cone-mode"]);
      }
      const run = String(step.run ?? "");
      // The deploy deliberately restores the bulk tree after the early type gate.
      if (/^\s*git sparse-checkout disable\s*$/m.test(run)) prefixes = null;
      const set = /^\s*git sparse-checkout set (--no-cone|--cone) (.+)$/m.exec(run);
      if (set) {
        const tokens = set[2].match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
        if (tokens.some((token) => /[$`;&|]/.test(token))) throw new Error(`${file}:${jobId}: dynamic sparse set requires an explicit coverage rule`);
        prefixes = tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
        coneMode = set[1] === "--cone";
      }
      if (!prefixes) continue;
      const cwd = step["working-directory"] ?? job.defaults?.run?.["working-directory"]
        ?? workflow.defaults?.run?.["working-directory"] ?? ".";
      for (const match of run.matchAll(SCRIPT_INVOCATION)) {
        const entry = path.normalize(path.join(cwd, match[1]));
        for (const imported of importedFiles(entry, repoRoot)) {
          if (!coversFile(prefixes, imported, coneMode)) {
            violations.push(`${file}:${jobId}: ${entry} requires ${imported}, absent from this step's checkout`);
          }
        }
      }
    }
  }
  return violations;
}

// Ruby/Psych is already the preceding required YAML validator in hosted CI.
// Parse YAML instead of associating a workflow's first sparse block with all jobs.
const parseYaml = (source) => JSON.parse(execFileSync("ruby", ["-rjson", "-rpsych", "-rdate", "-e",
  "puts JSON.generate(Psych.safe_load(STDIN.read, permitted_classes: [Date, Time], aliases: true))"],
  { input: source, encoding: "utf8" }));
const violations = fs.readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith(".yml")).sort()
  .flatMap((file) => workflowViolations(parseYaml(fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8")), file));
assert.deepEqual(violations, [], `sparse-checkout must cover every imported file in its job:\n  ${violations.join("\n  ")}`);

const sparse = { uses: "actions/checkout@v4", with: { "sparse-checkout-cone-mode": false,
  "sparse-checkout": "/scripts/check-external-clock-slot.mjs\n/ops/a1-lanes/external-clock.mjs" } };
const admission = { steps: [sparse, { run: "node scripts/check-external-clock-slot.mjs" }] };
const full = { steps: [{ uses: "actions/checkout@v4" }, { run: "node scripts/ops/check-pipeline-job-health.mjs" }] };
assert.deepEqual(workflowViolations({ jobs: { admission, full } }, "multi-job-control"), []);
const missing = { steps: [sparse, { run: "node scripts/ops/check-pipeline-job-health.mjs" }] };
assert.ok(workflowViolations({ jobs: { missing } }, "missing-import-fire").some((x) => x.includes("cloud-data-plane")));
assert.equal(coversFile(["/scripts/a.mjs"], "scripts/b.mjs", false), false);
assert.equal(coversFile(["/scripts/", "!/scripts/lib/"], "scripts/lib/a.mjs", false), false);
assert.equal(coversFile(["/*", "!/docs/", "!/ops/"], "scripts/ops/check.mjs", false), true);
assert.equal(coversFile(["/*", "!/docs/", "!/ops/"], "ops/a1-lanes/external-clock.mjs", false), false);
assert.equal(coversFile(["scripts/ops"], "scripts/root-file.mjs", true), true);
assert.deepEqual(workflowViolations({ jobs: { ordered: { steps: [sparse,
  { run: "node scripts/check-external-clock-slot.mjs" }, { uses: "actions/checkout@v4" },
  { run: "node scripts/ops/check-pipeline-job-health.mjs" }] } } }, "second-checkout"), []);

// The recogniser must be able to fail, or it silently green-lights everything.
assert.equal(coversDirectory(["scripts/ops"], "100xfenok-next/scripts/cloud-data-plane"), false);
assert.equal(coversDirectory(["scripts"], "scripts/lib"), true);
assert.equal(coversDirectory(["scripts/test-x.mjs"], "scripts"), true);
assert.equal(coversDirectory(["100xfenok-next/scripts"], "100xfenok-next", true), true);
assert.equal(coversDirectory(["100xfenok-next/scripts"], "100xfenok-next", false), false);

console.log("sparse-checkout import coverage: ok");
