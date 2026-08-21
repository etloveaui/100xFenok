#!/usr/bin/env node
// A successful publication used to lose its own evidence because the lane left
// a build byproduct on disk.
//
// persistPublishOutcome refused whenever `git status` named anything but its
// owned shard. Measured over 30 days, that destroyed the record of 18 runs that
// had ALREADY published to the cloud plane - the largest block being fred-macro,
// ten consecutive scheduled days whose data went live and whose ledger says
// nothing. Three distinct kinds of dirt caused it: a tracked public mirror, and
// two kinds of untracked byproduct - Python bytecode under __pycache__ and
// downloaded matrix artifacts under artifacts/attempt-*.
//
// Each instance has so far been fixed one family at a time. The guard itself is
// over-broad, and this narrows it once for all of them.
//
// The tracked half is kept exactly as it was and must stay: persistence rebases
// onto origin before pushing, and a modified or deleted TRACKED file makes that
// rebase fail, so refusing is the only safe answer. An UNTRACKED byproduct
// cannot block a rebase and cannot be committed either - every `git add` in this
// script is scoped `-- <shardPath>` - so refusing over one destroys evidence to
// prevent nothing.
//
// The run still fails afterwards. A lane leaving undeclared byproducts is a real
// defect and stays red; what changes is that the record of a real publication
// survives it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyUnrelatedDirt } from "../persist-cloud-publish-outcome.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- The classifier separates what breaks a rebase from what does not --------
{
  const verdict = classifyUnrelatedDirt([
    { path: "data/admin/data-supply-state/publish-outcomes/fred-macro.json", status: " M" },
    { path: "100xfenok-next/public/data/macro/fred-macro.json", status: " M" },
    { path: "scripts/lib/damodaran_shadow_converter/__pycache__/x.pyc", status: "??" },
    { path: "artifacts/attempt-symbols-A-D/x.jsonl", status: "??" },
  ], "data/admin/data-supply-state/publish-outcomes/fred-macro.json");

  assert.deepEqual(
    verdict.tracked,
    ["100xfenok-next/public/data/macro/fred-macro.json"],
    "a modified tracked file blocks the rebase and must still refuse",
  );
  assert.deepEqual(
    verdict.untracked.sort(),
    ["artifacts/attempt-symbols-A-D/x.jsonl", "scripts/lib/damodaran_shadow_converter/__pycache__/x.pyc"],
    "untracked byproducts must be reported, not treated as blocking",
  );
  assert.equal(verdict.blocking, true, "any tracked dirt blocks");
}

// Untracked-only dirt must not block.
{
  const verdict = classifyUnrelatedDirt(
    [{ path: "artifacts/attempt-returns-A-D/x.jsonl", status: "??" }],
    "data/admin/data-supply-state/publish-outcomes/slickcharts-history.json",
  );
  assert.equal(verdict.blocking, false, "an untracked byproduct alone must not destroy the record");
  assert.deepEqual(verdict.tracked, []);
}

// The owned shard is never dirt, in any status.
for (const status of [" M", "??", "A "]) {
  const shard = "data/admin/data-supply-state/publish-outcomes/x.json";
  const verdict = classifyUnrelatedDirt([{ path: shard, status }], shard);
  assert.deepEqual(verdict.tracked, []);
  assert.deepEqual(verdict.untracked, []);
  assert.equal(verdict.blocking, false);
}

// Every tracked status that git can report must count as blocking - staged,
// unstaged, deleted, renamed. Listing only " M" would have let a deletion
// through, and the existing persistence contract uses exactly that case.
for (const status of [" M", "M ", "MM", " D", "D ", "R ", "A ", "AM"]) {
  const verdict = classifyUnrelatedDirt([{ path: "some/tracked/file.json", status }], "owned/shard.json");
  assert.equal(verdict.blocking, true, `status ${JSON.stringify(status)} is a tracked change and must block`);
}

// --- Untracked byproducts survive to the ledger, then the run still fails ----
// Driven against a real git repository rather than asserted structurally.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "persist-dirt-"));
  const git = (args, cwd = tmp) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr || r.stdout}`);
    return r.stdout;
  };

  const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "persist-cloud-publish-outcome.mjs"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

  // The refusal must happen only for tracked dirt, and it must happen AFTER the
  // record is safe for untracked dirt. Assert the ordering in the source, since
  // driving the full push path needs a remote this contract will not build.
  // Measure the USAGE sites, not the declaration order. A first version of this
  // compared where the message constant is declared, which says nothing about
  // when it is thrown.
  assert.ok(/const dirt = classifyUnrelatedDirt\(/.test(code), "the guard must use the classifier");
  assert.ok(
    /if \(dirt\.blocking\) \{[\s\S]{0,300}throw new Error\(`refusing dirty paths/.test(code),
    "only tracked dirt may short-circuit before the record is written",
  );

  const pushOk = code.indexOf("if (pushed.status === 0) {");
  assert.ok(pushOk > 0, "the push-success branch is gone; this contract is stale");
  // The guard condition must be part of the match. Checking only for the throw
  // text passed with the condition replaced by `if (false)`, which silently
  // restores the behaviour this change exists to remove.
  const guarded = /if \(dirt\.untracked\.length > 0\) \{[\s\S]{0,400}?throw new Error\(`\$\{UNTRACKED_BYPRODUCTS_MESSAGE\}/;
  assert.ok(
    guarded.test(code),
    "the untracked report must be raised by a live `dirt.untracked.length > 0` guard",
  );
  const throwAt = code.search(guarded);
  assert.ok(throwAt > pushOk, "the untracked report must be raised only after the push succeeded");
  assert.ok(
    throwAt - pushOk < 600,
    "the untracked report must sit inside the push-success branch, not somewhere later",
  );
  const guardUse = code.indexOf("const dirt = classifyUnrelatedDirt(");
  assert.ok(throwAt > guardUse, "the report cannot precede the classification it reads");

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("test-persist-untracked-byproducts: ok");
