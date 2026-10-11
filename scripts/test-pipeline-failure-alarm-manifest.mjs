#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  pipeline: ".github/workflows/pipeline-failure-alarm.yml",
  probe: ".github/workflows/data-plane-serving-probe.yml",
  budget: ".github/workflows/worker-request-budget-alarm.yml",
};

function parseSteps(source) {
  const lines = source.split("\n");
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)-\s+name:\s*(.+?)\s*$/.exec(lines[index]);
    if (match) starts.push({ index, indent: match[1].length, name: match[2] });
  }
  return starts.map((start, position) => {
    const next = starts.slice(position + 1).find((candidate) => candidate.indent === start.indent);
    const bodyLines = lines.slice(start.index, next?.index ?? lines.length);
    const fields = {};
    for (const line of bodyLines.slice(1)) {
      const leading = line.match(/^\s*/)[0].length;
      if (leading !== start.indent + 2) continue;
      const field = /^\s*([\w-]+):(?:\s*(.*))?$/.exec(line);
      if (field) fields[field[1]] = field[2] ?? "";
    }
    return {
      name: start.name,
      id: fields.id,
      condition: fields.if,
      bestEffort: fields["continue-on-error"] === "true",
      run: fields.run,
      raw: bodyLines.join("\n"),
    };
  });
}

function parseJobs(source) {
  const lines = source.split("\n");
  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsStart === -1) return [];
  const starts = [];
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    const match = /^  ([A-Za-z0-9_-]+):\s*$/.exec(lines[index]);
    if (match) starts.push({ index, name: match[1] });
  }
  return starts.map((start, position) => {
    const next = starts[position + 1]?.index ?? lines.length;
    const raw = lines.slice(start.index, next).join("\n");
    return { name: start.name, raw, steps: parseSteps(raw) };
  });
}

const workflows = Object.fromEntries(Object.entries(files).map(([key, file]) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  return [key, { file, source, jobs: parseJobs(source) }];
}));

// Execute the exact transfer shell with unchanged, changed, first-state and
// missing-state inputs. Only a real prepared difference can enter persistence.
{
  const transfer = workflows.pipeline.jobs.find((j) => j.name === "check").steps
    .find((s) => s.name === "Prepare alarm state for persistence");
  const shell = transfer.raw.split("        run: |\n")[1].split("\n")
    .map((line) => line.replace(/^          /, "")).join("\n");
  for (const kind of ["unchanged", "changed", "first", "missing"]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-transfer-"));
    try {
      fs.mkdirSync(path.join(temp, "data/admin"), { recursive: true });
      fs.mkdirSync(path.join(temp, "pipeline-alarm-state-transfer"));
      const state = '{"status":"clear"}\n';
      if (kind !== "missing") fs.writeFileSync(path.join(temp, "data/admin/alarm-state.json"), state);
      const fingerprint = kind === "unchanged" ? crypto.createHash("sha256").update(state).digest("hex")
        : kind === "first" ? "missing" : "a".repeat(64);
      fs.writeFileSync(path.join(temp, "pipeline-alarm-state-transfer/base.sha256"), fingerprint + "\n");
      const output = path.join(temp, "outputs");
      const run = () => execFileSync("bash", ["-c", shell], { cwd: temp, env: { ...process.env, GITHUB_OUTPUT: output }, stdio: "pipe" });
      if (kind === "missing") { assert.throws(run, "missing emitted state must fail before persistence"); continue; }
      run();
      const changed = kind !== "unchanged";
      assert.equal(fs.readFileSync(output, "utf8"), `changed=${changed}\n`);
      assert.equal(fs.existsSync(path.join(temp, "pipeline-alarm-state-transfer/alarm-state.json")), changed);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
}

console.log("test-pipeline-failure-alarm-manifest: ok");
