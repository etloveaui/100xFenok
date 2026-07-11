#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const INCOMPLETE_LABEL = "INCOMPLETE_PURE_GIT_SYNTHETIC_PROOF";
export const APPROVED_NAMESPACE = "proof/krx_daily/v1";
export const PROMOTION_PHASES = Object.freeze([
  "validate_members",
  "write_objects",
  "fsync_objects",
  "write_manifest",
  "fsync_manifest",
  "swap_active",
  "commit_event_heads",
  "reread_committed_state",
]);

const STATE_HEAD_PATH = `${APPROVED_NAMESPACE}/state-head.json`;
const NONCE_LEDGER_PATH = `${APPROVED_NAMESPACE}/nonce-ledger.jsonl`;
const ORPHAN_PATH = `${APPROVED_NAMESPACE}/orphans/bootstrap-orphan.json`;
const ZERO_DIGEST = "0".repeat(64);
const HEAD_PAYLOAD_KEYS = Object.freeze([
  "schema_version",
  "label",
  "sequence",
  "transaction_id",
  "generation_id",
  "snapshot_path",
  "ciphertext_sha256",
  "semantic_sha256",
  "lkg_sha256",
  "observation_head_sha256",
  "resolution_head_sha256",
  "predecessor_head_sha256",
  "predecessor_commit",
  "cleanup_scope",
]);
const SYNTHETIC_IDS = Object.freeze(
  Array.from({ length: 31 }, (_, index) =>
    `synthetic_api_${String(index + 1).padStart(3, "0")}`,
  ),
);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function chainedHead(events) {
  let predecessor = ZERO_DIGEST;
  for (const event of events) {
    predecessor = sha256(canonicalJson({ predecessor, event }));
  }
  return predecessor;
}

function lkgDigest(state) {
  return sha256(
    canonicalJson({
      generation_id: state.lkg.generation_id,
      member_digests: state.lkg.member_digests,
    }),
  );
}

function validateState(state) {
  if (state?.label !== INCOMPLETE_LABEL) fail("STATE_LABEL_INVALID");
  if (!Array.isArray(state?.membership?.ids) || state.membership.ids.length !== 31) {
    fail("STATE_MEMBERSHIP_COUNT_INVALID");
  }
  if (new Set(state.membership.ids).size !== 31) fail("STATE_MEMBERSHIP_DUPLICATE");
  if (canonicalJson(state.membership.ids) !== canonicalJson(SYNTHETIC_IDS)) {
    fail("STATE_MEMBERSHIP_IDS_INVALID");
  }
  if (state.membership.digest !== sha256(canonicalJson(state.membership.ids))) {
    fail("STATE_MEMBERSHIP_DIGEST_INVALID");
  }
  if (state.provider_objects.length !== 31) fail("STATE_OBJECT_COUNT_INVALID");
  for (const object of state.provider_objects) {
    if (object.sha256 !== sha256(canonicalJson(object.payload))) {
      fail("STATE_OBJECT_DIGEST_INVALID");
    }
  }
  if (state.event_heads.observation !== chainedHead(state.observations)) {
    fail("STATE_OBSERVATION_HEAD_INVALID");
  }
  if (state.event_heads.resolution !== chainedHead(state.resolutions)) {
    fail("STATE_RESOLUTION_HEAD_INVALID");
  }
  if (state.active.manifest_sha256 !== sha256(canonicalJson(state.manifest))) {
    fail("STATE_MANIFEST_DIGEST_INVALID");
  }
  if (state.lkg.member_digests_sha256 !== sha256(canonicalJson(state.lkg.member_digests))) {
    fail("STATE_LKG_DIGEST_INVALID");
  }
  return state;
}

export function buildSyntheticState({ generation, sentinel }) {
  if (!Number.isInteger(generation) || generation < 0) fail("STATE_GENERATION_INVALID");
  if (typeof sentinel !== "string" || sentinel.length < 16) fail("STATE_SENTINEL_INVALID");

  const generationId = `synthetic-g${generation}`;
  const providerObjects = SYNTHETIC_IDS.map((apiId, index) => {
    const payload = {
      api_id: apiId,
      generation: generationId,
      rows: [
        {
          ordinal: index + 1,
          synthetic_value: generation * 1000 + index + 1,
        },
      ],
    };
    return { api_id: apiId, payload, sha256: sha256(canonicalJson(payload)) };
  });
  const memberDigests = Object.fromEntries(
    providerObjects.map((object) => [object.api_id, object.sha256]),
  );
  const membership = {
    ids: [...SYNTHETIC_IDS],
    digest: sha256(canonicalJson(SYNTHETIC_IDS)),
  };
  const observations = [
    {
      generation_id: generationId,
      kind: "synthetic_fresh_observation",
      sequence: generation,
    },
  ];
  const resolutions = [
    {
      generation_id: generationId,
      kind: "synthetic_fresh_primary",
      observation_head: chainedHead(observations),
      sequence: generation,
    },
  ];
  const manifest = {
    generation_id: generationId,
    membership_digest: membership.digest,
    member_digests: memberDigests,
  };

  return validateState({
    schema_version: "krx-pure-git-synthetic-state/v1",
    label: INCOMPLETE_LABEL,
    synthetic_only: true,
    generation: generation,
    membership,
    provider_objects: providerObjects,
    manifest,
    active: {
      generation_id: generationId,
      manifest_sha256: sha256(canonicalJson(manifest)),
    },
    lkg: {
      generation_id: generationId,
      member_digests: memberDigests,
      member_digests_sha256: sha256(canonicalJson(memberDigests)),
    },
    observations,
    resolutions,
    event_heads: {
      observation: chainedHead(observations),
      resolution: chainedHead(resolutions),
    },
    synthetic_secret_sentinel: sentinel,
  });
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("AES_KEY_INVALID");
  return key;
}

export function parseAesKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail("AES_KEY_INVALID");
  }
  const key = Buffer.from(value, "base64");
  return requireKey(key);
}

export function sealSnapshot({
  state,
  key,
  sequence,
  transactionId,
  predecessorHeadSha256,
}) {
  validateState(state);
  requireKey(key);
  if (!Number.isInteger(sequence) || sequence < 0) fail("SNAPSHOT_SEQUENCE_INVALID");
  if (!/^[a-zA-Z0-9._-]{6,100}$/.test(transactionId)) {
    fail("SNAPSHOT_TRANSACTION_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(predecessorHeadSha256)) {
    fail("SNAPSHOT_PREDECESSOR_INVALID");
  }

  const plaintext = Buffer.from(canonicalJson(state), "utf8");
  const nonce = randomBytes(12);
  const aad = {
    schema_version: "krx-pure-git-synthetic-envelope/v1",
    label: INCOMPLETE_LABEL,
    sequence,
    transaction_id: transactionId,
    predecessor_head_sha256: predecessorHeadSha256,
    plaintext_sha256: sha256(plaintext),
    key_id: "synthetic-aes-v1",
  };
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(canonicalJson(aad), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = {
    ...aad,
    nonce_b64: nonce.toString("base64"),
    nonce_fingerprint: sha256(nonce),
    ciphertext_b64: ciphertext.toString("base64"),
    ciphertext_sha256: sha256(ciphertext),
    auth_tag_b64: tag.toString("base64"),
  };
  return {
    envelope,
    semantic_sha256: sha256(plaintext),
    lkg_sha256: lkgDigest(state),
  };
}

export function openSnapshot({ envelope, key }) {
  requireKey(key);
  if (envelope?.label !== INCOMPLETE_LABEL) fail("SNAPSHOT_LABEL_INVALID");
  const ciphertext = Buffer.from(envelope.ciphertext_b64 || "", "base64");
  if (sha256(ciphertext) !== envelope.ciphertext_sha256) {
    fail("SNAPSHOT_CIPHERTEXT_DIGEST_MISMATCH");
  }
  const nonce = Buffer.from(envelope.nonce_b64 || "", "base64");
  const tag = Buffer.from(envelope.auth_tag_b64 || "", "base64");
  if (nonce.length !== 12 || tag.length !== 16) fail("SNAPSHOT_ENVELOPE_INVALID");
  if (sha256(nonce) !== envelope.nonce_fingerprint) fail("SNAPSHOT_NONCE_INVALID");

  const aad = {
    schema_version: envelope.schema_version,
    label: envelope.label,
    sequence: envelope.sequence,
    transaction_id: envelope.transaction_id,
    predecessor_head_sha256: envelope.predecessor_head_sha256,
    plaintext_sha256: envelope.plaintext_sha256,
    key_id: envelope.key_id,
  };
  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(canonicalJson(aad), "utf8"));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    fail("SNAPSHOT_AUTH_FAILED");
  }
  if (sha256(plaintext) !== envelope.plaintext_sha256) {
    fail("SNAPSHOT_PLAINTEXT_DIGEST_MISMATCH");
  }
  let state;
  try {
    state = JSON.parse(plaintext.toString("utf8"));
  } catch {
    fail("SNAPSHOT_JSON_INVALID");
  }
  if (canonicalJson(state) !== plaintext.toString("utf8")) {
    fail("SNAPSHOT_JSON_NONCANONICAL");
  }
  validateState(state);
  return { state, semantic_sha256: sha256(plaintext), lkg_sha256: lkgDigest(state) };
}

export function applyFailedAndUnavailable(restoredState) {
  validateState(restoredState);
  const before = lkgDigest(restoredState);
  const failedState = structuredClone(restoredState);
  const unavailableState = structuredClone(restoredState);
  unavailableState.observations = [
    ...unavailableState.observations,
    {
      generation_id: restoredState.active.generation_id,
      kind: "synthetic_unavailable_observation",
      sequence: restoredState.generation + 1,
    },
  ];
  return {
    before_lkg_sha256: before,
    after_failed_lkg_sha256: lkgDigest(failedState),
    after_unavailable_lkg_sha256: lkgDigest(unavailableState),
    failed: { remote_save_allowed: false, reason_code: "FAILED_CANDIDATE" },
    unavailable: { remote_save_allowed: false, reason_code: "UNAVAILABLE_LKG_RETAINED" },
  };
}

export function assertPromotionComplete(receipt) {
  if (receipt?.status !== "complete") fail("PROMOTION_INCOMPLETE");
  const keys = Object.keys(receipt?.phases || {}).sort();
  if (canonicalJson(keys) !== canonicalJson([...PROMOTION_PHASES].sort())) {
    fail("PROMOTION_INCOMPLETE");
  }
  if (PROMOTION_PHASES.some((phase) => receipt.phases[phase] !== true)) {
    fail("PROMOTION_INCOMPLETE");
  }
  return receipt;
}

export function validateCleanupPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) fail("CLEANUP_PATH_REJECTED");
  const accepted = [];
  const prefix = `${APPROVED_NAMESPACE}/orphans/`;
  for (const candidate of paths) {
    if (
      typeof candidate !== "string" ||
      candidate.includes("\0") ||
      candidate.includes("\\") ||
      path.posix.isAbsolute(candidate) ||
      path.posix.normalize(candidate) !== candidate ||
      !candidate.startsWith(prefix) ||
      candidate === prefix.slice(0, -1)
    ) {
      fail("CLEANUP_PATH_REJECTED");
    }
    accepted.push(candidate);
  }
  if (new Set(accepted).size !== accepted.length) fail("CLEANUP_PATH_REJECTED");
  return accepted;
}

export function validateSnapshotPath(candidate) {
  const prefix = `${APPROVED_NAMESPACE}/snapshots/`;
  if (
    typeof candidate !== "string" ||
    candidate.includes("\0") ||
    candidate.includes("\\") ||
    path.posix.isAbsolute(candidate) ||
    path.posix.normalize(candidate) !== candidate ||
    !candidate.startsWith(prefix) ||
    !/^[A-Za-z0-9._-]{6,120}\.json$/.test(candidate.slice(prefix.length))
  ) {
    fail("SNAPSHOT_PATH_REJECTED");
  }
  return candidate;
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
}

function readJson(file, code = "JSON_READ_FAILED") {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail(code);
  }
}

function git(args, cwd, { allowFailure = false, env = {} } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) fail("GIT_PROCESS_FAILED");
  const output = {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
  if (!allowFailure && output.status !== 0) fail("GIT_COMMAND_FAILED");
  return output;
}

function configureGit(repo) {
  git(["config", "user.name", "Fenok Synthetic Proof"], repo);
  git(["config", "user.email", "synthetic-proof@invalid.example"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
}

function validateBranch(branch) {
  if (!/^proof\/krx-daily\/[A-Za-z0-9._-]{1,100}$/.test(branch)) {
    fail("PROOF_BRANCH_INVALID");
  }
  return branch;
}

function cloneBranch({ remote, branch, destination, env = {} }) {
  validateBranch(branch);
  fs.rmSync(destination, { recursive: true, force: true });
  ensureDir(path.dirname(destination));
  git(
    ["clone", "--quiet", "--no-tags", "--single-branch", "--branch", branch, remote, destination],
    path.dirname(destination),
    { env },
  );
  configureGit(destination);
  return destination;
}

function trackedFileDigest(repo, relativePath) {
  const file = path.join(repo, relativePath);
  return fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
}

function scanTrackedTree(repo, forbiddenValues) {
  const listed = git(["ls-files", "-z"], repo).stdout.split("\0").filter(Boolean);
  for (const relativePath of listed) {
    const bytes = fs.readFileSync(path.join(repo, relativePath));
    const text = bytes.toString("utf8");
    for (const forbidden of forbiddenValues) {
      if (forbidden && text.includes(forbidden)) fail("PLAINTEXT_LEAK_DETECTED");
    }
  }
  return listed.length;
}

function readRemoteState(repo) {
  const head = readJson(path.join(repo, STATE_HEAD_PATH), "REMOTE_HEAD_INVALID");
  if (!head?.payload || typeof head.payload !== "object") fail("REMOTE_HEAD_INVALID");
  if (canonicalJson(Object.keys(head.payload).sort()) !== canonicalJson([...HEAD_PAYLOAD_KEYS].sort())) {
    fail("REMOTE_HEAD_SCHEMA_INVALID");
  }
  const expectedTopLevel = ["payload", "head_sha256", ...HEAD_PAYLOAD_KEYS].sort();
  if (canonicalJson(Object.keys(head).sort()) !== canonicalJson(expectedTopLevel)) {
    fail("REMOTE_HEAD_SCHEMA_INVALID");
  }
  for (const key of HEAD_PAYLOAD_KEYS) {
    if (canonicalJson(head[key]) !== canonicalJson(head.payload[key])) {
      fail("REMOTE_HEAD_PAYLOAD_DIVERGENCE");
    }
  }
  if (
    head.label !== INCOMPLETE_LABEL ||
    head.schema_version !== "krx-pure-git-synthetic-head/v1" ||
    !Number.isInteger(head.sequence) ||
    head.sequence < 0 ||
    !/^[A-Za-z0-9._-]{6,100}$/.test(head.transaction_id) ||
    !/^synthetic-g[0-9]+$/.test(head.generation_id) ||
    head.cleanup_scope !== `${APPROVED_NAMESPACE}/orphans/` ||
    !/^[a-f0-9]{40}$/.test(head.predecessor_commit)
  ) {
    fail("REMOTE_HEAD_SCHEMA_INVALID");
  }
  for (const key of [
    "ciphertext_sha256",
    "semantic_sha256",
    "lkg_sha256",
    "observation_head_sha256",
    "resolution_head_sha256",
    "predecessor_head_sha256",
    "head_sha256",
  ]) {
    if (!/^[a-f0-9]{64}$/.test(head[key])) fail("REMOTE_HEAD_SCHEMA_INVALID");
  }
  validateSnapshotPath(head.snapshot_path);
  if (head.head_sha256 !== sha256(canonicalJson(head.payload))) {
    fail("REMOTE_HEAD_DIGEST_INVALID");
  }
  const envelope = readJson(path.join(repo, head.snapshot_path), "REMOTE_SNAPSHOT_INVALID");
  if (
    envelope.label !== head.label ||
    envelope.sequence !== head.sequence ||
    envelope.transaction_id !== head.transaction_id ||
    envelope.predecessor_head_sha256 !== head.predecessor_head_sha256 ||
    envelope.ciphertext_sha256 !== head.ciphertext_sha256 ||
    envelope.plaintext_sha256 !== head.semantic_sha256
  ) {
    fail("REMOTE_SNAPSHOT_HEAD_MISMATCH");
  }
  let ledgerLines;
  try {
    ledgerLines = fs
      .readFileSync(path.join(repo, NONCE_LEDGER_PATH), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    fail("NONCE_LEDGER_INVALID");
  }
  const matches = ledgerLines.filter(
    (entry) =>
      entry.transaction_id === head.transaction_id &&
      entry.nonce_fingerprint === envelope.nonce_fingerprint &&
      entry.snapshot_path === head.snapshot_path,
  );
  if (matches.length !== 1) fail("NONCE_LEDGER_MISMATCH");
  return { head, envelope, ledgerLines };
}

function writeCandidateCommit({
  repo,
  state,
  key,
  sequence,
  predecessorCommit,
  transactionId,
  seedOrphan = false,
  cleanupPaths = [],
}) {
  validateState(state);
  const previousHeadPath = path.join(repo, STATE_HEAD_PATH);
  const previousHead = fs.existsSync(previousHeadPath) ? readJson(previousHeadPath) : null;
  const predecessorHeadSha256 = previousHead?.head_sha256 || ZERO_DIGEST;
  const sealed = sealSnapshot({
    state,
    key,
    sequence,
    transactionId,
    predecessorHeadSha256,
  });
  const snapshotPath = `${APPROVED_NAMESPACE}/snapshots/${transactionId}.json`;
  const snapshotAbsolute = path.join(repo, snapshotPath);
  writeJson(snapshotAbsolute, sealed.envelope);

  const ledgerPath = path.join(repo, NONCE_LEDGER_PATH);
  ensureDir(path.dirname(ledgerPath));
  const priorLedger = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8") : "";
  const ledgerEntry = {
    label: INCOMPLETE_LABEL,
    key_id: sealed.envelope.key_id,
    nonce_fingerprint: sealed.envelope.nonce_fingerprint,
    transaction_id: transactionId,
    snapshot_path: snapshotPath,
  };
  fs.writeFileSync(ledgerPath, `${priorLedger}${canonicalJson(ledgerEntry)}\n`, { mode: 0o600 });

  if (seedOrphan) {
    writeJson(path.join(repo, ORPHAN_PATH), {
      label: INCOMPLETE_LABEL,
      synthetic_orphan: true,
    });
  }
  for (const cleanupPath of validateCleanupPaths(cleanupPaths.length ? cleanupPaths : [ORPHAN_PATH])) {
    if (!seedOrphan || cleanupPath !== ORPHAN_PATH) {
      fs.rmSync(path.join(repo, cleanupPath), { force: true });
    }
  }

  const headPayload = {
    schema_version: "krx-pure-git-synthetic-head/v1",
    label: INCOMPLETE_LABEL,
    sequence,
    transaction_id: transactionId,
    generation_id: state.active.generation_id,
    snapshot_path: snapshotPath,
    ciphertext_sha256: sealed.envelope.ciphertext_sha256,
    semantic_sha256: sealed.semantic_sha256,
    lkg_sha256: sealed.lkg_sha256,
    observation_head_sha256: state.event_heads.observation,
    resolution_head_sha256: state.event_heads.resolution,
    predecessor_head_sha256: predecessorHeadSha256,
    predecessor_commit: predecessorCommit,
    cleanup_scope: `${APPROVED_NAMESPACE}/orphans/`,
  };
  const head = { payload: headPayload, ...headPayload, head_sha256: sha256(canonicalJson(headPayload)) };
  writeJson(previousHeadPath, head);

  git(["add", "--", APPROVED_NAMESPACE], repo);
  git(["commit", "--quiet", "-m", `synthetic proof sequence ${sequence}`], repo);
  const commit = git(["rev-parse", "HEAD"], repo).stdout.trim();
  const parent = git(["rev-parse", "HEAD^"], repo).stdout.trim();
  if (parent !== predecessorCommit) fail("COMMIT_PARENT_MISMATCH");
  return { commit, head, sealed, snapshotPath };
}

function makePromotionReceipt() {
  return {
    status: "complete",
    phases: Object.fromEntries(PROMOTION_PHASES.map((phase) => [phase, true])),
  };
}

function safeEvidenceBase() {
  return { label: INCOMPLETE_LABEL, synthetic_only: true, production_claim: false };
}

function writeEvidence(file, evidence) {
  if (!file) return;
  writeJson(file, evidence);
}

function initLocalRemote(root) {
  ensureDir(root);
  const remote = path.join(root, "proof-remote.git");
  const seed = path.join(root, "seed");
  git(["init", "--bare", "--quiet", remote], root);
  git(["clone", "--quiet", remote, seed], root);
  configureGit(seed);
  fs.writeFileSync(
    path.join(seed, "README.md"),
    "# synthetic-only proof remote\nNO real KRX data.\n",
  );
  git(["add", "--", "README.md"], seed);
  git(["commit", "--quiet", "-m", "seed synthetic proof remote"], seed);
  git(["branch", "-M", "main"], seed);
  git(["push", "--quiet", "origin", "main"], seed);
  git(["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"], root);
  return remote;
}

export function bootstrapPhase({ remote, branch, root, key, gitEnv = {} }) {
  validateBranch(branch);
  ensureDir(root);
  const existing = git(["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${branch}`], root, {
    allowFailure: true,
    env: gitEnv,
  });
  if (existing.status === 0) fail("PROOF_BRANCH_ALREADY_EXISTS");
  if (existing.status !== 2) fail("PROOF_BRANCH_PREFLIGHT_FAILED");

  const repo = path.join(root, "bootstrap");
  fs.rmSync(repo, { recursive: true, force: true });
  git(["clone", "--quiet", "--no-tags", "--single-branch", "--branch", "main", remote, repo], root, {
    env: gitEnv,
  });
  configureGit(repo);
  git(["switch", "--quiet", "-c", branch], repo);
  const predecessorCommit = git(["rev-parse", "HEAD"], repo).stdout.trim();
  const sentinel = `synthetic-secret-${randomBytes(24).toString("hex")}`;
  const state = buildSyntheticState({ generation: 0, sentinel });
  const candidate = writeCandidateCommit({
    repo,
    state,
    key,
    sequence: 0,
    predecessorCommit,
    transactionId: `bootstrap-${randomBytes(12).toString("hex")}`,
    seedOrphan: true,
    cleanupPaths: [ORPHAN_PATH],
  });
  scanTrackedTree(repo, [sentinel, key.toString("base64")]);
  git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], repo, { env: gitEnv });
  return {
    ...safeEvidenceBase(),
    command: "bootstrap",
    branch,
    commit: candidate.commit,
    semantic_sha256: candidate.sealed.semantic_sha256,
    lkg_sha256: candidate.sealed.lkg_sha256,
    head_sha256: candidate.head.head_sha256,
  };
}

export function restorePhase({
  remote,
  branch,
  root,
  stage,
  key,
  gitEnv = {},
  expectReadOnly = false,
}) {
  const repo = cloneBranch({ remote, branch, destination: path.join(root, "restore"), env: gitEnv });
  const restoreOrder = ["AUTHENTICATED_RESTORE_START"];
  const commit = git(["rev-parse", "HEAD"], repo).stdout.trim();
  const readmeSha256 = trackedFileDigest(repo, "README.md");
  const remoteState = readRemoteState(repo);
  const opened = openSnapshot({ envelope: remoteState.envelope, key });
  if (opened.semantic_sha256 !== remoteState.head.semantic_sha256) {
    fail("RESTORE_SEMANTIC_DIGEST_MISMATCH");
  }
  if (opened.lkg_sha256 !== remoteState.head.lkg_sha256) {
    fail("RESTORE_LKG_DIGEST_MISMATCH");
  }
  restoreOrder.push("RESTORE_DIGESTS_VERIFIED");
  scanTrackedTree(repo, [opened.state.synthetic_secret_sentinel, key.toString("base64")]);

  let readOnlyPushRejected = null;
  if (expectReadOnly) {
    const negativeRef = `refs/heads/${branch}-ro-negative`;
    const negative = git(["push", "--dry-run", "origin", `HEAD:${negativeRef}`], repo, {
      allowFailure: true,
      env: gitEnv,
    });
    if (negative.status === 0) fail("READ_ONLY_KEY_WRITE_UNEXPECTEDLY_ALLOWED");
    readOnlyPushRejected = true;
  }

  restoreOrder.push("RESTORE_SECRET_SCOPE_END", "RESOLUTION_ALLOWED");
  ensureDir(stage);
  writeJson(path.join(stage, "restored-state.json"), opened.state);
  writeJson(path.join(stage, "restore-context.json"), {
    branch,
    commit,
    head: remoteState.head,
    readme_sha256: readmeSha256,
    restore_order: restoreOrder,
  });
  return {
    ...safeEvidenceBase(),
    command: "restore",
    branch,
    commit,
    semantic_sha256: opened.semantic_sha256,
    lkg_sha256: opened.lkg_sha256,
    observation_head_sha256: opened.state.event_heads.observation,
    resolution_head_sha256: opened.state.event_heads.resolution,
    restore_before_resolution: restoreOrder.indexOf("RESTORE_DIGESTS_VERIFIED") < restoreOrder.indexOf("RESOLUTION_ALLOWED"),
    read_only_push_rejected: readOnlyPushRejected,
  };
}

export function prepareBootstrapWorkspace({ repo, branch, stage }) {
  validateBranch(branch);
  configureGit(repo);
  git(["switch", "--quiet", "-c", branch], repo);
  const predecessorCommit = git(["rev-parse", "HEAD"], repo).stdout.trim();
  const state = buildSyntheticState({
    generation: 0,
    sentinel: `synthetic-secret-${randomBytes(24).toString("hex")}`,
  });
  const receipt = makePromotionReceipt();
  assertPromotionComplete(receipt);
  ensureDir(stage);
  writeJson(path.join(stage, "candidate-state.json"), state);
  writeJson(path.join(stage, "promotion-receipt.json"), receipt);
  writeJson(path.join(stage, "bootstrap-context.json"), {
    branch,
    predecessor_commit: predecessorCommit,
    readme_sha256: trackedFileDigest(repo, "README.md"),
  });
  return {
    ...safeEvidenceBase(),
    command: "prepare-bootstrap",
    promotion_complete: true,
    candidate_generation_id: state.active.generation_id,
  };
}

export function packBootstrapWorkspace({ repo, stage, key }) {
  const state = readJson(path.join(stage, "candidate-state.json"), "CANDIDATE_STATE_MISSING");
  const receipt = readJson(path.join(stage, "promotion-receipt.json"), "PROMOTION_RECEIPT_MISSING");
  const context = readJson(path.join(stage, "bootstrap-context.json"), "BOOTSTRAP_CONTEXT_MISSING");
  assertPromotionComplete(receipt);
  validateState(state);
  const candidate = writeCandidateCommit({
    repo,
    state,
    key,
    sequence: 0,
    predecessorCommit: context.predecessor_commit,
    transactionId: `bootstrap-${randomBytes(12).toString("hex")}`,
    seedOrphan: true,
    cleanupPaths: [ORPHAN_PATH],
  });
  scanTrackedTree(repo, [state.synthetic_secret_sentinel, key.toString("base64")]);
  const evidence = {
    ...safeEvidenceBase(),
    command: "pack-bootstrap",
    commit: candidate.commit,
    semantic_sha256: candidate.sealed.semantic_sha256,
    lkg_sha256: candidate.sealed.lkg_sha256,
    head_sha256: candidate.head.head_sha256,
  };
  writeJson(path.join(stage, "pack-evidence.json"), evidence);
  return evidence;
}

export function pushBootstrapWorkspace({ repo, branch }) {
  validateBranch(branch);
  const commit = git(["rev-parse", "HEAD"], repo).stdout.trim();
  git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], repo);
  const remoteLine = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], repo)
    .stdout.trim();
  const remoteCommit = remoteLine.split(/\s+/)[0];
  if (remoteCommit !== commit) fail("BOOTSTRAP_REMOTE_RECONCILE_FAILED");
  return {
    ...safeEvidenceBase(),
    command: "push-bootstrap",
    commit,
    remote_reconciled: true,
  };
}

export function restoreExistingWorkspace({ repo, stage, key }) {
  configureGit(repo);
  const restoreOrder = ["AUTHENTICATED_GIT_RESTORE_COMPLETE"];
  const commit = git(["rev-parse", "HEAD"], repo).stdout.trim();
  const remoteState = readRemoteState(repo);
  const opened = openSnapshot({ envelope: remoteState.envelope, key });
  if (
    opened.semantic_sha256 !== remoteState.head.semantic_sha256 ||
    opened.lkg_sha256 !== remoteState.head.lkg_sha256
  ) {
    fail("RESTORE_DIGEST_MISMATCH");
  }
  restoreOrder.push("RESTORE_DIGESTS_VERIFIED", "AES_SCOPE_END", "RESOLUTION_ALLOWED");
  scanTrackedTree(repo, [opened.state.synthetic_secret_sentinel, key.toString("base64")]);
  ensureDir(stage);
  writeJson(path.join(stage, "restored-state.json"), opened.state);
  writeJson(path.join(stage, "restore-context.json"), {
    commit,
    head: remoteState.head,
    readme_sha256: trackedFileDigest(repo, "README.md"),
    restore_order: restoreOrder,
  });
  return {
    ...safeEvidenceBase(),
    command: "restore-existing",
    commit,
    semantic_sha256: opened.semantic_sha256,
    lkg_sha256: opened.lkg_sha256,
    observation_head_sha256: opened.state.event_heads.observation,
    resolution_head_sha256: opened.state.event_heads.resolution,
    restore_before_resolution: true,
  };
}

export function packRaceWorkspaces({ writerA, writerB, stage, key }) {
  const restored = readJson(path.join(stage, "restored-state.json"), "RESTORED_STATE_MISSING");
  const context = readJson(path.join(stage, "restore-context.json"), "RESTORE_CONTEXT_MISSING");
  validateState(restored);
  const exercised = applyFailedAndUnavailable(restored);
  if (
    exercised.before_lkg_sha256 !== exercised.after_failed_lkg_sha256 ||
    exercised.before_lkg_sha256 !== exercised.after_unavailable_lkg_sha256
  ) {
    fail("LKG_MUTATED_BY_REJECTED_INPUT");
  }
  const candidateState = buildSyntheticState({
    generation: restored.generation + 1,
    sentinel: restored.synthetic_secret_sentinel,
  });
  const receipt = makePromotionReceipt();
  assertPromotionComplete(receipt);
  for (const repo of [writerA, writerB]) configureGit(repo);
  const baseA = git(["rev-parse", "HEAD"], writerA).stdout.trim();
  const baseB = git(["rev-parse", "HEAD"], writerB).stdout.trim();
  if (baseA !== baseB || baseA !== context.commit) fail("RACE_BASE_MISMATCH");
  const sequence = context.head.sequence + 1;
  const candidateA = writeCandidateCommit({
    repo: writerA,
    state: candidateState,
    key,
    sequence,
    predecessorCommit: baseA,
    transactionId: `writer-a-${randomBytes(12).toString("hex")}`,
    cleanupPaths: [ORPHAN_PATH],
  });
  const candidateB = writeCandidateCommit({
    repo: writerB,
    state: candidateState,
    key,
    sequence,
    predecessorCommit: baseB,
    transactionId: `writer-b-${randomBytes(12).toString("hex")}`,
    cleanupPaths: [ORPHAN_PATH],
  });
  scanTrackedTree(writerA, [candidateState.synthetic_secret_sentinel, key.toString("base64")]);
  scanTrackedTree(writerB, [candidateState.synthetic_secret_sentinel, key.toString("base64")]);
  const evidence = {
    ...safeEvidenceBase(),
    command: "pack-race",
    writer_a_commit: candidateA.commit,
    writer_b_commit: candidateB.commit,
    semantic_sha256: candidateA.sealed.semantic_sha256,
    lkg_sha256: candidateA.sealed.lkg_sha256,
    failed_lkg_preserved: true,
    unavailable_lkg_preserved: true,
    promotion_complete: true,
  };
  writeJson(path.join(stage, "pack-race-evidence.json"), evidence);
  return evidence;
}

export function pushRaceWorkspaces({ writerA, writerB, branch, stage }) {
  validateBranch(branch);
  const packed = readJson(path.join(stage, "pack-race-evidence.json"), "PACK_RACE_EVIDENCE_MISSING");
  const context = readJson(path.join(stage, "restore-context.json"), "RESTORE_CONTEXT_MISSING");
  const pushA = git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], writerA, {
    allowFailure: true,
  });
  if (pushA.status !== 0) fail("RACE_FIRST_WRITER_FAILED");
  const pushB = git(["push", "origin", `HEAD:refs/heads/${branch}`], writerB, {
    allowFailure: true,
  });
  if (pushB.status === 0) fail("RACE_TWO_WRITERS_SUCCEEDED");
  if (!/rejected|non-fast-forward|fetch first/i.test(`${pushB.stdout}\n${pushB.stderr}`)) {
    fail("RACE_LOSER_REASON_UNEXPECTED");
  }
  git(["fetch", "--quiet", "origin", branch], writerA);
  const remoteCommit = git(["rev-parse", "FETCH_HEAD"], writerA).stdout.trim();
  if (remoteCommit !== packed.writer_a_commit) fail("UNKNOWN_RECONCILIATION_FAILED");
  if (trackedFileDigest(writerA, "README.md") !== context.readme_sha256) {
    fail("FOREIGN_SENTINEL_CHANGED");
  }
  if (fs.existsSync(path.join(writerA, ORPHAN_PATH))) fail("CLEANUP_CURRENT_TREE_FAILED");
  const evidence = {
    ...safeEvidenceBase(),
    command: "push-race",
    commit: remoteCommit,
    semantic_sha256: packed.semantic_sha256,
    lkg_sha256: packed.lkg_sha256,
    failed_lkg_preserved: packed.failed_lkg_preserved,
    unavailable_lkg_preserved: packed.unavailable_lkg_preserved,
    race_winner_count: 1,
    stale_writer_rejected: true,
    unknown_reconciled: true,
    cleanup_current_tree_only: true,
    history_retention_proved: false,
    foreign_sentinel_preserved: true,
  };
  writeJson(path.join(stage, "save-evidence.json"), evidence);
  return evidence;
}

export function promotePhase({ stage }) {
  const restored = readJson(path.join(stage, "restored-state.json"), "RESTORED_STATE_MISSING");
  validateState(restored);
  const exercised = applyFailedAndUnavailable(restored);
  if (
    exercised.before_lkg_sha256 !== exercised.after_failed_lkg_sha256 ||
    exercised.before_lkg_sha256 !== exercised.after_unavailable_lkg_sha256
  ) {
    fail("LKG_MUTATED_BY_REJECTED_INPUT");
  }
  const candidate = buildSyntheticState({
    generation: restored.generation + 1,
    sentinel: restored.synthetic_secret_sentinel,
  });
  const receipt = makePromotionReceipt();
  assertPromotionComplete(receipt);
  writeJson(path.join(stage, "candidate-state.json"), candidate);
  writeJson(path.join(stage, "promotion-receipt.json"), receipt);
  return {
    ...safeEvidenceBase(),
    command: "promote",
    failed_lkg_preserved: true,
    unavailable_lkg_preserved: true,
    promotion_complete: true,
    candidate_generation_id: candidate.active.generation_id,
  };
}

export function saveRacePhase({
  remote,
  branch,
  root,
  stage,
  key,
  gitEnv = {},
  unrelatedRemote = null,
}) {
  const receipt = readJson(path.join(stage, "promotion-receipt.json"), "PROMOTION_RECEIPT_MISSING");
  assertPromotionComplete(receipt);
  const candidateState = readJson(path.join(stage, "candidate-state.json"), "CANDIDATE_STATE_MISSING");
  validateState(candidateState);
  const restoreContext = readJson(path.join(stage, "restore-context.json"), "RESTORE_CONTEXT_MISSING");
  const writerA = cloneBranch({ remote, branch, destination: path.join(root, "writer-a"), env: gitEnv });
  const writerB = cloneBranch({ remote, branch, destination: path.join(root, "writer-b"), env: gitEnv });
  const baseA = git(["rev-parse", "HEAD"], writerA).stdout.trim();
  const baseB = git(["rev-parse", "HEAD"], writerB).stdout.trim();
  if (baseA !== baseB || baseA !== restoreContext.commit) fail("RACE_BASE_MISMATCH");
  const readmeBefore = restoreContext.readme_sha256;
  const sequence = restoreContext.head.sequence + 1;
  const candidateA = writeCandidateCommit({
    repo: writerA,
    state: candidateState,
    key,
    sequence,
    predecessorCommit: baseA,
    transactionId: `writer-a-${randomBytes(12).toString("hex")}`,
    cleanupPaths: [ORPHAN_PATH],
  });
  const candidateB = writeCandidateCommit({
    repo: writerB,
    state: candidateState,
    key,
    sequence,
    predecessorCommit: baseB,
    transactionId: `writer-b-${randomBytes(12).toString("hex")}`,
    cleanupPaths: [ORPHAN_PATH],
  });
  scanTrackedTree(writerA, [candidateState.synthetic_secret_sentinel, key.toString("base64")]);
  scanTrackedTree(writerB, [candidateState.synthetic_secret_sentinel, key.toString("base64")]);

  const pushA = git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], writerA, {
    allowFailure: true,
    env: gitEnv,
  });
  if (pushA.status !== 0) fail("RACE_FIRST_WRITER_FAILED");
  const pushB = git(["push", "origin", `HEAD:refs/heads/${branch}`], writerB, {
    allowFailure: true,
    env: gitEnv,
  });
  if (pushB.status === 0) fail("RACE_TWO_WRITERS_SUCCEEDED");
  if (!/rejected|non-fast-forward|fetch first/i.test(`${pushB.stdout}\n${pushB.stderr}`)) {
    fail("RACE_LOSER_REASON_UNEXPECTED");
  }

  git(["fetch", "--quiet", "origin", branch], writerA, { env: gitEnv });
  const remoteCommit = git(["rev-parse", "FETCH_HEAD"], writerA).stdout.trim();
  if (remoteCommit !== candidateA.commit) fail("UNKNOWN_RECONCILIATION_FAILED");

  let unrelatedWriteRejected = null;
  if (unrelatedRemote) {
    const negative = git(
      [
        "push",
        "--dry-run",
        unrelatedRemote,
        `HEAD:refs/heads/krx-proof-negative-${randomBytes(6).toString("hex")}`,
      ],
      writerA,
      { allowFailure: true, env: gitEnv },
    );
    if (negative.status === 0) fail("WRITE_KEY_REACHED_UNRELATED_REPOSITORY");
    unrelatedWriteRejected = true;
  }

  const readmeAfter = trackedFileDigest(writerA, "README.md");
  if (!readmeBefore || readmeBefore !== readmeAfter) fail("FOREIGN_SENTINEL_CHANGED");
  if (fs.existsSync(path.join(writerA, ORPHAN_PATH))) fail("CLEANUP_CURRENT_TREE_FAILED");
  const evidence = {
    ...safeEvidenceBase(),
    command: "save-race",
    branch,
    commit: candidateA.commit,
    semantic_sha256: candidateA.sealed.semantic_sha256,
    lkg_sha256: candidateA.sealed.lkg_sha256,
    head_sha256: candidateA.head.head_sha256,
    race_winner_count: 1,
    stale_writer_rejected: true,
    unknown_reconciled: true,
    unrelated_write_rejected: unrelatedWriteRejected,
    cleanup_current_tree_only: true,
    history_retention_proved: false,
    foreign_sentinel_preserved: true,
  };
  writeJson(path.join(stage, "save-evidence.json"), evidence);
  return evidence;
}

function installNetworkDeny() {
  let calls = 0;
  const denied = () => {
    calls += 1;
    fail("OFFLINE_SELECTION_NETWORK_CALL");
  };
  globalThis.fetch = denied;
  net.connect = denied;
  net.createConnection = denied;
  http.request = denied;
  http.get = denied;
  https.request = denied;
  https.get = denied;
  return () => calls;
}

export function offlineSelectPhase({ stage, expectedSemanticSha256 }) {
  const state = readJson(path.join(stage, "restored-state.json"), "RESTORED_STATE_MISSING");
  validateState(state);
  const calls = installNetworkDeny();
  const effectiveStateSha256 = sha256(Buffer.from(canonicalJson(state), "utf8"));
  if (effectiveStateSha256 !== expectedSemanticSha256) fail("OFFLINE_SELECTION_MISMATCH");
  if (calls() !== 0) fail("OFFLINE_SELECTION_NETWORK_CALL");
  fs.rmSync(path.join(stage, "restored-state.json"), { force: true });
  return {
    ...safeEvidenceBase(),
    command: "offline-select",
    effective_state_sha256: effectiveStateSha256,
    krx_network_calls: 0,
    offline_selection_match: true,
  };
}

export async function runLocalProof({ root, key }) {
  requireKey(key);
  const remote = initLocalRemote(root);
  const branch = "proof/krx-daily/local-hermetic";
  const bootstrapRepo = path.join(root, "split-bootstrap-repo");
  git(["clone", "--quiet", "--branch", "main", remote, bootstrapRepo], root);
  const bootstrapStage = path.join(root, "split-bootstrap-stage");
  prepareBootstrapWorkspace({ repo: bootstrapRepo, branch, stage: bootstrapStage });
  const bootstrap = packBootstrapWorkspace({ repo: bootstrapRepo, stage: bootstrapStage, key });
  pushBootstrapWorkspace({ repo: bootstrapRepo, branch });
  const stageOne = path.join(root, "stage-one");
  const restoreOneRepo = path.join(root, "split-restore-one");
  const writerA = path.join(root, "split-writer-a");
  const writerB = path.join(root, "split-writer-b");
  for (const destination of [restoreOneRepo, writerA, writerB]) {
    git(["clone", "--quiet", "--branch", branch, remote, destination], root);
  }
  const restoreOne = restoreExistingWorkspace({ repo: restoreOneRepo, stage: stageOne, key });
  const packed = packRaceWorkspaces({ writerA, writerB, stage: stageOne, key });
  const saved = pushRaceWorkspaces({ writerA, writerB, branch, stage: stageOne });
  const stageTwo = path.join(root, "stage-two");
  const restoreTwoRepo = path.join(root, "split-restore-two");
  git(["clone", "--quiet", "--branch", branch, remote, restoreTwoRepo], root);
  const restoreTwo = restoreExistingWorkspace({ repo: restoreTwoRepo, stage: stageTwo, key });
  const selected = offlineSelectPhase({
    stage: stageTwo,
    expectedSemanticSha256: saved.semantic_sha256,
  });
  return {
    ...safeEvidenceBase(),
    bootstrap_restore_verified: restoreOne.semantic_sha256 === bootstrap.semantic_sha256,
    failed_lkg_preserved: packed.failed_lkg_preserved,
    unavailable_lkg_preserved: packed.unavailable_lkg_preserved,
    race_winner_count: saved.race_winner_count,
    stale_writer_rejected: saved.stale_writer_rejected,
    unknown_reconciled: saved.unknown_reconciled,
    cleanup_current_tree_only: saved.cleanup_current_tree_only,
    foreign_sentinel_preserved: saved.foreign_sentinel_preserved,
    second_cold_restore_verified: restoreTwo.semantic_sha256 === saved.semantic_sha256,
    offline_selection_match: selected.offline_selection_match,
    effective_state_sha256: selected.effective_state_sha256,
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail("CLI_ARGUMENT_INVALID");
    const name = token.slice(2).replaceAll("-", "_");
    if (name === "expect_read_only") {
      args[name] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) fail("CLI_ARGUMENT_INVALID");
    args[name] = value;
    index += 1;
  }
  return args;
}

function required(args, name) {
  if (!args[name]) fail("CLI_ARGUMENT_MISSING");
  return args[name];
}

function safePrint(evidence) {
  const fields = [
    `command=${evidence.command || "local-proof"}`,
    `label=${INCOMPLETE_LABEL}`,
    evidence.semantic_sha256 ? `semantic_sha256=${evidence.semantic_sha256}` : null,
    evidence.effective_state_sha256
      ? `effective_state_sha256=${evidence.effective_state_sha256}`
      : null,
  ].filter(Boolean);
  process.stdout.write(`proof_result ${fields.join(" ")}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.command;
  let evidence;
  if (command === "prepare-bootstrap") {
    evidence = prepareBootstrapWorkspace({
      repo: required(args, "repo"),
      branch: required(args, "branch"),
      stage: required(args, "stage"),
    });
  } else if (command === "pack-bootstrap") {
    evidence = packBootstrapWorkspace({
      repo: required(args, "repo"),
      stage: required(args, "stage"),
      key: parseAesKey(required(process.env, "KRX_PERSIST_PROOF_AES_KEY_V1")),
    });
  } else if (command === "push-bootstrap") {
    evidence = pushBootstrapWorkspace({
      repo: required(args, "repo"),
      branch: required(args, "branch"),
    });
  } else if (command === "restore-existing") {
    evidence = restoreExistingWorkspace({
      repo: required(args, "repo"),
      stage: required(args, "stage"),
      key: parseAesKey(required(process.env, "KRX_PERSIST_PROOF_AES_KEY_V1")),
    });
  } else if (command === "pack-race") {
    evidence = packRaceWorkspaces({
      writerA: required(args, "writer_a"),
      writerB: required(args, "writer_b"),
      stage: required(args, "stage"),
      key: parseAesKey(required(process.env, "KRX_PERSIST_PROOF_AES_KEY_V1")),
    });
  } else if (command === "push-race") {
    evidence = pushRaceWorkspaces({
      writerA: required(args, "writer_a"),
      writerB: required(args, "writer_b"),
      branch: required(args, "branch"),
      stage: required(args, "stage"),
    });
  } else if (command === "bootstrap") {
    evidence = bootstrapPhase({
      remote: required(args, "remote"),
      branch: required(args, "branch"),
      root: required(args, "root"),
      key: parseAesKey(required(process.env, "KRX_PERSIST_PROOF_AES_KEY_V1")),
    });
  } else if (command === "restore") {
    evidence = restorePhase({
      remote: required(args, "remote"),
      branch: required(args, "branch"),
      root: required(args, "root"),
      stage: required(args, "stage"),
      key: parseAesKey(required(process.env, "KRX_PERSIST_PROOF_AES_KEY_V1")),
      expectReadOnly: Boolean(args.expect_read_only),
    });
  } else if (command === "promote") {
    evidence = promotePhase({ stage: required(args, "stage") });
  } else if (command === "save-race") {
    evidence = saveRacePhase({
      remote: required(args, "remote"),
      branch: required(args, "branch"),
      root: required(args, "root"),
      stage: required(args, "stage"),
      key: parseAesKey(required(process.env, "KRX_PERSIST_PROOF_AES_KEY_V1")),
      unrelatedRemote: args.unrelated_remote || null,
    });
  } else if (command === "offline-select") {
    evidence = offlineSelectPhase({
      stage: required(args, "stage"),
      expectedSemanticSha256: required(args, "expected"),
    });
  } else if (command === "local-proof") {
    evidence = await runLocalProof({
      root: required(args, "root"),
      key: parseAesKey(required(process.env, "KRX_PERSIST_PROOF_AES_KEY_V1")),
    });
  } else {
    fail("CLI_COMMAND_INVALID");
  }
  writeEvidence(args.evidence, evidence);
  safePrint(evidence);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    const code = typeof error?.code === "string" ? error.code : "UNCLASSIFIED_FAILURE";
    process.stderr.write(`proof_error reason_code=${code}\n`);
    process.exitCode = 1;
  });
}
