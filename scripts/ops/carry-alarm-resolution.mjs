#!/usr/bin/env node
// Stand down from a compare-and-swap refusal without losing the one field that
// cannot be recomputed.
//
// The alarm's persist job queues on the global writer lock while its check job
// does not, so two runs overlap routinely and the later one can land first. The
// earlier run then finds the base fingerprint changed and refuses, correctly.
// Everything it was about to write is recomputed from the live GitHub API on
// every run - status, open incidents, streaks, first-failing run, slot counts -
// and the OPS issue was already written by the check job before persist ran.
//
// One field is different. `last_resolved_at` is the only value emit-alarm-state
// carries forward from the prior document rather than deriving, so if a
// discarded run were the sole observer of an open -> clear transition, that
// timestamp would vanish. This carries it forward, and only it.
//
// Fails closed everywhere: an unreadable document, a missing one, or an
// unparseable timestamp stands down rather than writing a guess into the one
// value the mechanism exists to protect.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parsedInstant(value) {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined; // undefined = present but unreadable
}

export function decideResolutionCarry({ artifact, current } = {}) {
  const stand = (reason) => ({ carry: false, last_resolved_at: null, reason });
  if (!artifact || typeof artifact !== "object") return stand("artifact state is unreadable");
  if (!current || typeof current !== "object") return stand("state on main is unreadable");

  const mine = parsedInstant(artifact.last_resolved_at);
  const theirs = parsedInstant(current.last_resolved_at);
  if (mine === undefined) return stand(`artifact last_resolved_at is not a timestamp: ${artifact.last_resolved_at}`);
  if (theirs === undefined) return stand(`last_resolved_at on main is not a timestamp: ${current.last_resolved_at}`);
  if (mine === null) return stand("this run observed no resolution");
  if (theirs !== null && theirs >= mine) return stand("main already carries a resolution at least as new");

  return { carry: true, last_resolved_at: artifact.last_resolved_at, reason: null };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// CLI: carry-alarm-resolution.mjs <artifact.json> <current.json>
// Writes the merged document over <current.json> and prints "carried" when it
// changed anything; prints "stood-down: <reason>" otherwise. Always exits 0 -
// the caller is already standing down and this must not turn that into a fault.
function main() {
  const [artifactPath, currentPath] = process.argv.slice(2);
  if (!artifactPath || !currentPath) {
    process.stdout.write("stood-down: usage is <artifact.json> <current.json>\n");
    return;
  }
  const artifact = readJson(artifactPath);
  const current = readJson(currentPath);
  const verdict = decideResolutionCarry({ artifact, current });
  if (!verdict.carry) {
    process.stdout.write(`stood-down: ${verdict.reason}\n`);
    return;
  }
  const merged = { ...current, last_resolved_at: verdict.last_resolved_at };
  fs.writeFileSync(currentPath, `${JSON.stringify(merged, null, 2)}\n`);
  process.stdout.write("carried\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
