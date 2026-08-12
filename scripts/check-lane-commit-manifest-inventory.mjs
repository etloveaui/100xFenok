#!/usr/bin/env node

// Repo-wide inventory gate for actual data Git writers. The inventory is
// derived from workflow commands, then enriched with the enclosing job's
// effective permissions and concurrency scope. Known helper-backed writers are
// included because their push lives outside the workflow YAML:
// persist-cloud-publish-outcome.mjs and publish-slickcharts-attempt.sh.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GLOBAL_WRITER_GROUP = "fenok-data-writer-refs/heads/main";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOB_START_RE = /^  ([A-Za-z0-9_-]+):\s*$/;
const WRITER_PATTERNS = Object.freeze([
  { kind: "direct_git_add", pattern: /\bgit\s+add\b/ },
  { kind: "direct_git_commit", pattern: /\bgit\s+commit\b/ },
  { kind: "direct_git_push", pattern: /\bgit\s+push\b/ },
  { kind: "persist_cloud_publish_outcome", pattern: /persist-cloud-publish-outcome\.mjs\s+--family=/ },
  { kind: "publish_slickcharts_attempt", pattern: /publish-slickcharts-attempt\.sh\b/ },
]);

function nonCommentCommandLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(?:echo|printf)\b/.test(trimmed)) return false;
  return true;
}

function jobBlocks(source) {
  const lines = source.split("\n");
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex === -1) return [];
  const starts = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const match = JOB_START_RE.exec(lines[index]);
    if (match) starts.push({ index, name: match[1] });
  }
  return starts.map((start, position) => {
    const end = starts[position + 1]?.index ?? lines.length;
    return { name: start.name, lines: lines.slice(start.index, end) };
  });
}

function mapValue(lines, key, indent) {
  const prefix = " ".repeat(indent);
  const line = lines.find((candidate) => candidate.startsWith(`${prefix}${key}:`));
  if (!line) return null;
  return line.slice(`${prefix}${key}:`.length).trim() || null;
}

function nestedMapValue(lines, parentKey, parentIndent, childKey) {
  const prefix = " ".repeat(parentIndent);
  const parentIndex = lines.findIndex((line) => line.startsWith(`${prefix}${parentKey}:`));
  if (parentIndex === -1) return null;
  const childPrefix = " ".repeat(parentIndent + 2);
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.match(/^\S/)) break;
    if (line.startsWith(childPrefix) && line.trimStart().startsWith(`${childKey}:`)) {
      return line.slice(`${childPrefix}${childKey}:`.length).trim() || null;
    }
  }
  return null;
}

function inlinePermissionValue(value, key) {
  if (!value) return null;
  const match = new RegExp(`${key}\\s*:\\s*([A-Za-z]+)`).exec(value);
  return match?.[1] ?? null;
}

function effectiveContentsWrite(sourceLines, jobLines) {
  const jobPermission = mapValue(jobLines, "permissions", 4);
  if (jobLines.some((line) => /^ {4}permissions:/.test(line))) {
    return inlinePermissionValue(jobPermission, "contents") === "write"
      || jobLines.some((line) => /^ {6}contents:\s*write(?:\s|#|$)/.test(line));
  }
  const workflowPermission = mapValue(sourceLines, "permissions", 0);
  return inlinePermissionValue(workflowPermission, "contents") === "write"
    || sourceLines.some((line) => /^ {2}contents:\s*write(?:\s|#|$)/.test(line));
}

function concurrencyFor(sourceLines, jobLines) {
  const jobGroup = nestedMapValue(jobLines, "concurrency", 4, "group");
  if (jobGroup !== null) {
    return {
      scope: "job",
      group: jobGroup,
      cancelInProgress: nestedMapValue(jobLines, "concurrency", 4, "cancel-in-progress"),
      queue: nestedMapValue(jobLines, "concurrency", 4, "queue"),
    };
  }
  return {
    scope: "workflow",
    group: nestedMapValue(sourceLines, "concurrency", 0, "group"),
    cancelInProgress: nestedMapValue(sourceLines, "concurrency", 0, "cancel-in-progress"),
    queue: nestedMapValue(sourceLines, "concurrency", 0, "queue"),
  };
}

function needsFor(jobLines) {
  const value = mapValue(jobLines, "needs", 4);
  if (value) {
    const inline = value.match(/\[([^\]]+)\]/)?.[1] ?? value;
    return inline.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  const needsIndex = jobLines.findIndex((line) => line.startsWith("    needs:"));
  if (needsIndex === -1) return [];
  const values = [];
  for (let index = needsIndex + 1; index < jobLines.length; index += 1) {
    const match = /^      -\s*([A-Za-z0-9_-]+)\s*$/.exec(jobLines[index]);
    if (!match) break;
    values.push(match[1]);
  }
  return values;
}

function writerKindsFor(jobLines) {
  const kinds = new Set();
  for (const line of jobLines) {
    if (!nonCommentCommandLine(line)) continue;
    for (const { kind, pattern } of WRITER_PATTERNS) {
      if (pattern.test(line)) kinds.add(kind);
    }
  }
  return [...kinds].sort();
}

export function scanWriterInventory({ repoRoot = REPO_ROOT } = {}) {
  const workflowDir = path.join(repoRoot, ".github", "workflows");
  return fs.readdirSync(workflowDir)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(workflowDir, name), "utf8");
      const sourceLines = source.split("\n");
      return jobBlocks(source).flatMap((job) => {
        const writerKinds = writerKindsFor(job.lines);
        if (writerKinds.length === 0) return [];
        const concurrency = concurrencyFor(sourceLines, job.lines);
        return [{
          workflow: `.github/workflows/${name}`,
          job: job.name,
          writerKinds,
          group: concurrency.group,
          groupScope: concurrency.scope,
          cancelInProgress: concurrency.cancelInProgress,
          queue: concurrency.queue,
          contentsWrite: effectiveContentsWrite(sourceLines, job.lines),
          needs: needsFor(job.lines),
        }];
      });
    });
}

export function assertWriterSurfaceContracts(inventory = scanWriterInventory()) {
  assert.ok(inventory.length > 0, "actual writer inventory must not be empty");
  const invalid = inventory.filter((entry) => (
    entry.group !== GLOBAL_WRITER_GROUP
    || entry.cancelInProgress !== "false"
    || entry.queue !== "max"
    || entry.contentsWrite !== true
  ));
  assert.deepEqual(
    invalid,
    [],
    `writer surfaces must use ${GLOBAL_WRITER_GROUP}, cancel-in-progress:false, queue:max, and contents:write: ${JSON.stringify(invalid)}`,
  );
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = assertWriterSurfaceContracts(scanWriterInventory());
  const workflows = new Set(inventory.map((entry) => entry.workflow));
  console.log(`check-lane-commit-manifest-inventory: ok (${workflows.size} workflows, ${inventory.length} writer jobs)`);
}
