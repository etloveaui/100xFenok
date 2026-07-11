import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  INCOMPLETE_LABEL,
  PROMOTION_PHASES,
  applyFailedAndUnavailable,
  assertPromotionComplete,
  buildSyntheticState,
  canonicalJson,
  openSnapshot,
  runLocalProof,
  sealSnapshot,
  sha256,
  validateCleanupPaths,
  validateSnapshotPath,
} from "./krx-persistence-pure-git-proof.mjs";

const TEST_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef",
  "utf8",
);
const TEST_SENTINEL = "synthetic-secret-sentinel-for-hermetic-test";

test("canonicalJson recursively sorts object keys", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ z: 2, a: 1 }] }),
    '{"a":{"b":3,"y":2},"list":[{"a":1,"z":2}],"z":1}',
  );
});

test("synthetic state has exactly 31 members and two digest-bound event heads", () => {
  const state = buildSyntheticState({
    generation: 0,
    sentinel: TEST_SENTINEL,
  });

  assert.equal(state.label, INCOMPLETE_LABEL);
  assert.equal(state.membership.ids.length, 31);
  assert.equal(new Set(state.membership.ids).size, 31);
  assert.equal(
    state.membership.digest,
    sha256(canonicalJson(state.membership.ids)),
  );
  assert.match(state.event_heads.observation, /^[a-f0-9]{64}$/);
  assert.match(state.event_heads.resolution, /^[a-f0-9]{64}$/);
  assert.equal(state.active.generation_id, "synthetic-g0");
  assert.equal(state.lkg.generation_id, "synthetic-g0");
});

test("AES-256-GCM snapshot round-trips and tampering fails closed", () => {
  const state = buildSyntheticState({
    generation: 0,
    sentinel: TEST_SENTINEL,
  });
  const sealed = sealSnapshot({
    state,
    key: TEST_KEY,
    sequence: 0,
    transactionId: "tx-hermetic-0",
    predecessorHeadSha256: "0".repeat(64),
  });

  assert.ok(!canonicalJson(sealed.envelope).includes(TEST_SENTINEL));
  assert.deepEqual(
    openSnapshot({ envelope: sealed.envelope, key: TEST_KEY }).state,
    state,
  );

  const tampered = structuredClone(sealed.envelope);
  const bytes = Buffer.from(tampered.ciphertext_b64, "base64");
  bytes[0] ^= 1;
  tampered.ciphertext_b64 = bytes.toString("base64");
  assert.throws(
    () => openSnapshot({ envelope: tampered, key: TEST_KEY }),
    /SNAPSHOT_CIPHERTEXT_DIGEST_MISMATCH|SNAPSHOT_AUTH_FAILED/,
  );
});

test("failed and unavailable injections preserve retained LKG bytes", () => {
  const restored = buildSyntheticState({
    generation: 0,
    sentinel: TEST_SENTINEL,
  });
  const exercised = applyFailedAndUnavailable(restored);

  assert.equal(exercised.failed.remote_save_allowed, false);
  assert.equal(exercised.unavailable.remote_save_allowed, false);
  assert.equal(exercised.before_lkg_sha256, exercised.after_failed_lkg_sha256);
  assert.equal(
    exercised.before_lkg_sha256,
    exercised.after_unavailable_lkg_sha256,
  );
});

test("save gate accepts only a complete ordered atomic promotion receipt", () => {
  const complete = Object.fromEntries(PROMOTION_PHASES.map((phase) => [phase, true]));
  assert.doesNotThrow(() =>
    assertPromotionComplete({ status: "complete", phases: complete }),
  );

  for (const phase of PROMOTION_PHASES) {
    const incomplete = { ...complete, [phase]: false };
    assert.throws(
      () => assertPromotionComplete({ status: "complete", phases: incomplete }),
      /PROMOTION_INCOMPLETE/,
    );
  }
  assert.throws(
    () => assertPromotionComplete({ status: "failed", phases: complete }),
    /PROMOTION_INCOMPLETE/,
  );
});

test("cleanup accepts exact approved paths and rejects traversal or lookalikes", () => {
  assert.deepEqual(
    validateCleanupPaths([
      "proof/krx_daily/v1/orphans/synthetic-orphan.json",
    ]),
    ["proof/krx_daily/v1/orphans/synthetic-orphan.json"],
  );

  for (const candidate of [
    "../proof/krx_daily/v1/orphans/x",
    "/proof/krx_daily/v1/orphans/x",
    "proof/krx_daily/v10/orphans/x",
    "proof/krx_daily/v1/../foreign/x",
    "proof/krx_daily/v1/orphans",
  ]) {
    assert.throws(() => validateCleanupPaths([candidate]), /CLEANUP_PATH_REJECTED/);
  }
});

test("snapshot path is locked to the approved immutable snapshot namespace", () => {
  assert.equal(
    validateSnapshotPath("proof/krx_daily/v1/snapshots/writer-a-123456.json"),
    "proof/krx_daily/v1/snapshots/writer-a-123456.json",
  );
  for (const candidate of [
    "../proof/krx_daily/v1/snapshots/x.json",
    "proof/krx_daily/v1/snapshots/../state-head.json",
    "proof/krx_daily/v10/snapshots/writer-a-123456.json",
    "proof/krx_daily/v1/snapshots/x",
    "/proof/krx_daily/v1/snapshots/writer-a-123456.json",
  ]) {
    assert.throws(() => validateSnapshotPath(candidate), /SNAPSHOT_PATH_REJECTED/);
  }
});

test("local bare-repo proof restores, rejects stale writer, and cold-restores winner", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krx-pure-git-proof-test-"));
  try {
    const evidence = await runLocalProof({ root, key: TEST_KEY });
    assert.equal(evidence.label, INCOMPLETE_LABEL);
    assert.equal(evidence.bootstrap_restore_verified, true);
    assert.equal(evidence.failed_lkg_preserved, true);
    assert.equal(evidence.unavailable_lkg_preserved, true);
    assert.equal(evidence.race_winner_count, 1);
    assert.equal(evidence.stale_writer_rejected, true);
    assert.equal(evidence.unknown_reconciled, true);
    assert.equal(evidence.cleanup_current_tree_only, true);
    assert.equal(evidence.foreign_sentinel_preserved, true);
    assert.equal(evidence.second_cold_restore_verified, true);
    assert.equal(evidence.offline_selection_match, true);
    assert.match(evidence.effective_state_sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
