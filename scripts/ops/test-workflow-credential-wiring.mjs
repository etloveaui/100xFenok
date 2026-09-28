#!/usr/bin/env node
// A workflow can grant a permission and still never hand over the credential.
// That happened on 2026-08-21: 8469d4e59e pointed check-alarm-liveness at the
// Actions API and added `actions: read` to its host workflow, but the step got
// no env block. GITHUB_TOKEN is not a default runner variable, so every
// invocation would have returned "unreadable", exited 1, and fired a surfacing
// step whose message - "the pipeline alarm has not run recently" - was false.
// The step that fires is not continue-on-error and nothing after it carries
// if: always(), so the host workflow would have stopped running hourly and its
// own failure_streak would have opened an incident naming the wrong cause.
//
// The unit test for that check passed the whole time. It tested the pure
// function and never the wiring, which is the vacuous-contract shape this
// program keeps finding: the thing that broke was the seam nobody asserted.
//
// So this derives the requirement instead of listing it. For every workflow
// step that runs a repo script, it reads that script for the credentials the
// script actually consults, and requires the step, its job, or the workflow to
// provide each one. A new script that reads a new secret cannot ship unwired,
// and a wiring that is removed fails here rather than in production.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

// Names that carry authority. A missing one is a silent capability loss rather
// than a crash, which is why they are worth a contract of their own.
const CREDENTIAL_RE = /^[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*$/;

// Test-injection knobs, not credentials. Tests set these themselves to force a
// controlled failure; requiring a workflow to supply one would be nonsense.
const NOT_A_CREDENTIAL = /^INPUT_/;

// Credentials a script consults but can legitimately run without. Each needs a
// reason, and the anti-rot assertion below requires the script to still read it.
const OPTIONAL_CREDENTIALS = Object.freeze({});

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Enough of a YAML walk for this question: workflow-level env, job-level env,
// step-level env, and the `run:` body of each step. No YAML library is
// available in this repo and every other workflow contract here parses by hand.
function parseWorkflow(source) {
  const lines = source.split("\n");
  const workflowEnv = new Set();
  const jobs = [];
  let inJobs = false;
  let ctx = null;          // "workflow-env" | "job-env" | "step-env" | "run"
  let ctxIndent = 0;
  let currentJob = null;
  let currentStep = null;

  const closeStep = () => {
    if (currentJob && currentStep) currentJob.steps.push(currentStep);
    currentStep = null;
  };

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = indentOf(raw);
    const line = raw.trim();

    // A block context ends as soon as indentation returns to its own level.
    if (ctx === "run") {
      if (indent > ctxIndent) { currentStep.run += "\n" + line; continue; }
      ctx = null;
    } else if (ctx && indent <= ctxIndent) {
      ctx = null;
    }
    if (ctx === "workflow-env" || ctx === "job-env" || ctx === "step-env") {
      const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
      if (key) {
        const target = ctx === "workflow-env" ? workflowEnv
          : ctx === "job-env" ? currentJob.env : currentStep.env;
        target.add(key[1]);
        continue;
      }
      ctx = null;
    }

    if (indent === 0) {
      closeStep();
      currentJob = null;
      inJobs = line === "jobs:";
      if (line.startsWith("env:")) { ctx = "workflow-env"; ctxIndent = 0; }
      continue;
    }

    if (!inJobs) continue;

    if (indent === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line)) {
      closeStep();
      currentJob = { name: line.slice(0, -1), env: new Set(), steps: [] };
      jobs.push(currentJob);
      continue;
    }
    if (!currentJob) continue;

    if (indent === 4 && line.startsWith("env:")) { ctx = "job-env"; ctxIndent = indent; continue; }
    if (indent === 6 && line.startsWith("- ")) {
      closeStep();
      currentStep = { name: "<unnamed>", env: new Set(), run: "" };
      const named = /^-\s*name:\s*(.+)$/.exec(line);
      if (named) currentStep.name = named[1].trim();
      const ran = /^-\s*run:\s*(.*)$/.exec(line);
      if (ran) { currentStep.run = ran[1].trim(); ctx = "run"; ctxIndent = 6; }
      continue;
    }
    if (!currentStep) continue;
    if (indent === 8 && line.startsWith("name:")) { currentStep.name = line.slice(5).trim(); continue; }
    if (indent === 8 && line.startsWith("env:")) { ctx = "step-env"; ctxIndent = indent; continue; }
    if (indent === 8 && line.startsWith("run:")) {
      currentStep.run = line.slice(4).trim();
      ctx = "run"; ctxIndent = indent;
      continue;
    }
  }
  closeStep();
  return { workflowEnv, jobs };
}

// The credentials a script actually consults, followed one import deep so a
// thin wrapper does not hide the requirement.
const scriptCache = new Map();
function credentialsRequiredBy(scriptPath) {
  const key = scriptPath;
  if (scriptCache.has(key)) return scriptCache.get(key);
  const abs = path.join(REPO_ROOT, scriptPath);
  const found = new Set();
  if (!fs.existsSync(abs)) { scriptCache.set(key, found); return found; }
  const source = fs.readFileSync(abs, "utf8");
  const code = source.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  for (const m of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    if (CREDENTIAL_RE.test(m[1]) && !NOT_A_CREDENTIAL.test(m[1])) found.add(m[1]);
  }
  for (const m of code.matchAll(/process\.env\[["']([A-Z0-9_]+)["']\]/g)) {
    if (CREDENTIAL_RE.test(m[1]) && !NOT_A_CREDENTIAL.test(m[1])) found.add(m[1]);
  }
  // Deliberately NOT following imports. A wrapper's requirement belongs to the
  // step that invokes the wrapper, and following them produced false positives:
  // check-pipeline-job-health imports the FAMILIES table from the publisher,
  // which reads Cloudflare credentials the health check never uses.
  scriptCache.set(key, found);
  return found;
}

const workflows = fs.readdirSync(WORKFLOW_DIR).filter((n) => n.endsWith(".yml")).sort();
assert.ok(workflows.length > 0, "no workflows found; the contract would be vacuous");

const violations = [];
let stepsChecked = 0;
let requirementsChecked = 0;

for (const name of workflows) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8");
  const { workflowEnv, jobs } = parseWorkflow(source);
  for (const job of jobs) {
    for (const step of job.steps) {
      if (!step.run) continue;
      // Contract scripts are excluded: they run in CI to assert things and
      // stub whatever they need. A contract that genuinely required a live
      // secret would be a different and worse problem than this one.
      const scripts = [...step.run.matchAll(/\bnode\s+(scripts\/[A-Za-z0-9._/-]+\.mjs)/g)]
        .map((m) => m[1])
        .filter((f) => !path.basename(f).startsWith("test-"));
      if (scripts.length === 0) continue;
      stepsChecked += 1;
      const provided = new Set([...workflowEnv, ...job.env, ...step.env]);
      for (const script of scripts) {
        for (const credential of credentialsRequiredBy(script)) {
          if (OPTIONAL_CREDENTIALS[`${script}:${credential}`]) continue;
          requirementsChecked += 1;
          if (!provided.has(credential)) {
            violations.push(
              `${name} :: job ${job.name} :: step "${step.name}" runs ${script}, `
              + `which consults ${credential}, but neither the step, the job, nor the workflow provides it`,
            );
          }
        }
      }
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `workflow steps run scripts whose credentials are never wired:\n  - ${violations.join("\n  - ")}`,
);

// --- Anti-rot: an optional-credential entry must still describe reality ------
for (const [entryKey, reason] of Object.entries(OPTIONAL_CREDENTIALS)) {
  const [script, credential] = entryKey.split(":");
  assert.ok(
    credentialsRequiredBy(script).has(credential),
    `${entryKey} is recorded as optional but ${script} no longer consults ${credential}`,
  );
  assert.ok(
    typeof reason === "string" && reason.trim().length >= 40,
    `${entryKey} needs a real reason, not ${JSON.stringify(reason)}`,
  );
}

// --- The parser must actually see things, or every assertion above is vacuous -
assert.ok(stepsChecked >= 20, `only ${stepsChecked} script-running steps parsed; the walk is not seeing the workflows`);
assert.ok(requirementsChecked >= 5, `only ${requirementsChecked} credential requirements found; the extractor is not reading scripts`);

console.log(
  `test-workflow-credential-wiring: ok (${workflows.length} workflows, `
  + `${stepsChecked} script steps, ${requirementsChecked} credential requirements)`,
);
