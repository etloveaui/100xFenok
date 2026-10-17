#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepare, apply, git } from "./prepare-lane-commit.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lane-commit-test-"));
const env = { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2" };
const workflow = "fetch-yahoo-ticker.yml";
const output = "data/macro/yahoo-ticker.json";
const recovery = "data/admin/yahoo-hourly-ticker/index.json";
const g = (...args) => git(args, { cwd: root }).toString().trim();
const write = (name, body) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body); };
const commit = (name) => { g("add", "--", name); g("commit", "-qm", "fixture"); };
const candidate = () => prepare({ root, workflow, success: true, env });
const admit = (artifact) => apply({ root, workflow, artifact, env });
const copied = (a) => JSON.parse(JSON.stringify(a));
try {
  g("init", "-q", "--initial-branch=main");
  g("config", "user.name", "Fixture"); g("config", "user.email", "fixture@example.invalid");
  write(output, '{"value":1}\n'); commit(output);
  write(recovery, '{"status":"old"}\n'); commit(recovery);
  write("scripts/input.mjs", "// v1\n"); commit("scripts/input.mjs");
  const baseline = g("rev-parse", "HEAD");
  assert.equal(candidate().entries.length, 0, "no-op produces no transfer or writer job");
  write(output, '{"value":2}\n'); g("add", "--", output);
  const a = candidate();
  assert.equal(a.entries.length, 1);
  g("restore", "--staged", "--worktree", "--", output);
  write("unrelated.txt", "concurrent commit\n"); commit("unrelated.txt");
  assert.equal(admit(a), "applied", "an unrelated main commit must not discard a valid candidate");
  assert.equal(g("show", `:${output}`), '{"value":2}');
  assert.equal(fs.readFileSync(path.join(root, output), "utf8"), '{"value":1}\n', "writer changes index only");
  g("commit", "-qm", "candidate");
  g("restore", "--worktree", "--", output);
  assert.equal(admit(a), "unchanged", "already-landed candidate must never create another commit");
  write(output, '{"value":3}\n'); commit(output);
  assert.equal(admit(a), "stale_output", "older provider data cannot overwrite a newer main output");
  g("checkout", "-q", baseline, "--", output); g("commit", "-qm", "restore fixture output");
  write("scripts/input.mjs", "// v2\n"); commit("scripts/input.mjs");
  assert.equal(admit(a), "stale_input", "changed producer code or source inputs requires regeneration");
  const tampered = copied(a); tampered.entries[0].body = Buffer.from("wrong").toString("base64");
  assert.throws(() => admit(tampered), /digest\/size/, "corrupt payload fails before staging");
  const rebound = copied(a); rebound.run_attempt = "3";
  assert.throws(() => admit(rebound), /binding mismatch/, "another run attempt cannot supply a candidate");
  const pathEscape = copied(a); pathEscape.entries[0].path = "../escape.json";
  assert.throws(() => admit(pathEscape), /invalid path/);
  const duplicate = copied(a); duplicate.entries.push(duplicate.entries[0]);
  assert.throws(() => admit(duplicate), /duplicate/);
  const fakeBaseline = copied(a); fakeBaseline.inputs.scripts = null;
  assert.throws(() => admit(fakeBaseline), /input baseline mismatch/, "artifact metadata is checked against its real base commit");
  assert.equal(g("diff", "--cached", "--name-only"), "", "all refusals leave the index untouched");
  write("unrelated.txt", "dirty\n"); g("add", "--", "unrelated.txt");
  assert.throws(() => admit(a), /index already contains changes/, "mixed staging cannot be committed");
  assert.throws(() => candidate(), /outside lane/, "preparation cannot smuggle unrelated paths");
  g("restore", "--staged", "--worktree", "--", "unrelated.txt");
  write(recovery, '{"status":"failed"}\n'); g("add", "--", recovery);
  const failed = prepare({ root, workflow, success: false, env });
  assert.deepEqual(failed.entries.map((e) => e.path), [recovery], "failed provider attempt keeps recovery staging");
  write(output, '{"value":9}\n'); g("add", "--", output);
  assert.throws(() => prepare({ root, workflow, success: false, env }), /outside lane/, "failure cannot publish success-only payload");
  g("restore", "--staged", "--worktree", "--", recovery, output);
  fs.unlinkSync(path.join(root, output)); fs.symlinkSync("/etc/hosts", path.join(root, output)); g("add", "--", output);
  assert.throws(() => candidate(), /regular/, "candidate symlinks are rejected");
  g("restore", "--staged", "--worktree", "--", output);

  // A hanging Git child is killed by the actual subprocess timeout.
  const oldPath = process.env.PATH;
  const bin = path.join(root, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "git"), "#!/bin/sh\nexec sleep 3\n", { mode: 0o755 });
  process.env.PATH = `${bin}:${oldPath}`;
  try { assert.throws(() => git(["status"], { cwd: root, timeout: 30 }), (e) => e.code === "ETIMEDOUT"); }
  finally { process.env.PATH = oldPath; }

  // Verify ordinary fast-forward publication rejects a competing main update.
  const remote = path.join(root, "remote.git");
  g("init", "--bare", "-q", remote); g("remote", "add", "origin", remote); g("push", "-q", "origin", "HEAD:main");
  write(output, '{"value":4}\n'); commit(output); const newer = g("rev-parse", "HEAD");
  g("push", "-q", "origin", "HEAD:main");
  g("checkout", "-q", "-b", "older-writer", baseline);
  write(output, '{"value":5}\n'); commit(output);
  assert.throws(() => g("push", "origin", "HEAD:main"), /failed to push|non-fast-forward|fetch first/);
  assert.equal(g("--git-dir", remote, "rev-parse", "main"), newer, "rejected push preserves the winning main revision");
  g("checkout", "-q", "main");
  write(output, '{"value":6}\n'); g("add", "--", output);
  const sparseCandidate = candidate();
  g("restore", "--staged", "--worktree", "--", output);
  const writer = path.join(root, "writer");
  g("clone", "-q", "--no-checkout", "--branch", "main", remote, writer);
  const wg = (...args) => git(args, { cwd: writer }).toString().trim();
  wg("config", "user.name", "Writer"); wg("config", "user.email", "writer@example.invalid");
  wg("sparse-checkout", "init", "--no-cone"); wg("sparse-checkout", "set", "--no-cone", "/scripts/input.mjs"); wg("checkout", "-q", "main");
  assert.equal(fs.existsSync(path.join(writer, output)), false, "writer does not download the canonical payload tree");
  assert.equal(apply({ root: writer, workflow, artifact: sparseCandidate, env }), "applied");
  wg("commit", "-qm", "sparse candidate");
  assert.equal(wg("diff", "--name-only"), "", "index-only publication leaves the sparse worktree clean");
  write("unrelated.txt", "second concurrent writer\n"); commit("unrelated.txt"); g("push", "-q", "origin", "HEAD:main");
  assert.throws(() => wg("push", "origin", "HEAD:main"), /failed to push|non-fast-forward|fetch first/);
  wg("fetch", "-q", "--depth=1", "origin", "+main:refs/remotes/origin/main");
  wg("checkout", "-q", "-B", "main", "origin/main");
  assert.equal(apply({ root: writer, workflow, artifact: sparseCandidate, env }), "applied", "sparse retry rechecks the candidate on the winning main");
  wg("commit", "-qm", "retry sparse candidate");
  wg("push", "-q", "origin", "HEAD:main");
  assert.equal(g("--git-dir", remote, "show", `main:${output}`), '{"value":6}', "the actual sparse writer publishes the exact prepared bytes");
  console.log("lane commit: no-op, unrelated concurrency, stale input/output, binding, tamper, staging, recovery, timeout and rejected push passed");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
