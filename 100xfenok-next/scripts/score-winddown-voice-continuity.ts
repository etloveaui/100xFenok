import assert from "node:assert/strict";
import {
  WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY,
  WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY,
  WIND_DOWN_VOICE_OUTBOX_MAX_BYTES,
  acknowledgeWindDownVoiceOutbox,
  buildWindDownVoiceReportFromCheckpoint,
  clearWindDownVoiceCheckpoint,
  createWindDownVoiceRecoveryDraft,
  readWindDownVoiceCheckpoint,
  readWindDownVoiceOutbox,
  saveWindDownVoiceCheckpoint,
  saveWindDownVoiceOutbox,
  verifyOutboxEntryDigest,
  type StorageLike,
  type WindDownVoiceOutboxEntry,
  type WindDownVoiceSessionCheckpoint,
} from "../src/features/winddown/voice/pendingStorage";
import {
  buildWindDownVoicePracticeUrl,
  extractWindDownVoicePracticeSeeds,
  parseWindDownVoicePracticeUrl,
} from "../src/features/winddown/voice/practiceSeed";
import {
  buildWindDownVoiceReport,
  isWindDownVoiceReport,
  WIND_DOWN_VOICE_REPORT_KEEPALIVE_MAX_BYTES,
  WIND_DOWN_VOICE_REPORT_NORMAL_MAX_BYTES,
} from "../src/features/winddown/voice/report";
import {
  createWindDownRoleplayDescriptor,
  type WindDownVoiceFinalizedTurn,
} from "../src/features/winddown/voice/product";
import { serializeWindDownVoiceKeepaliveBody } from "../src/features/winddown/voice/ui/mobileVoiceSafety";
import { type WindDownVoiceReportReceipt } from "../src/features/mona-vnext/memory/learningProfileCoordinator";

class MemoryStorage implements StorageLike {
  public map = new Map<string, string>();
  public shouldFailSet = false;
  public shouldFailGet = false;
  public shouldFailRemove = false;

  getItem(key: string): string | null {
    if (this.shouldFailGet) {
      throw new Error("SecurityError: storage access denied");
    }
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.shouldFailSet) {
      throw new Error("QuotaExceededError: quota exceeded");
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    if (this.shouldFailRemove) {
      throw new Error("InvalidStateError: failed to delete key");
    }
    this.map.delete(key);
  }
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createSampleTurn(
  conversationId: string,
  turnSeq: number,
  userText: string,
  modelText: string,
  correctionText?: string | null,
): WindDownVoiceFinalizedTurn {
  return {
    conversationId,
    turnSeq,
    userText,
    modelText,
    finalized: true,
    sttDrift: false,
    interrupted: false,
    ...(correctionText ? { correctionText } : {}),
  };
}

async function main() {
  // --------------------------------------------------------------------------
  // Fixture 1: outbox roundtrip & measured digest validation
  // --------------------------------------------------------------------------
  {
    const storage = new MemoryStorage();
    const report = buildWindDownVoiceReport({
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-roleplay-session-001",
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["conv-test-001"],
      sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
      startedAtIso: "2026-07-31T00:00:00.000Z",
      stoppedAtIso: "2026-07-31T00:01:00.000Z",
      completionReason: "learner-stop",
      turns: [createSampleTurn("conv-test-001", 1, "I'd like a decaf coffee.", "Sure.")],
      metrics: { turnCount: 1, interruptionCount: 0 },
    });

    const finalDigest = await sha256Hex(report);
    const entry: WindDownVoiceOutboxEntry = {
      schemaVersion: 1,
      productSessionId: report.productSessionId,
      activity: report.activity,
      finalDigest,
      report,
      stagedAtIso: "2026-07-31T00:01:00.000Z",
      attempts: 0,
    };

    const saveResult = saveWindDownVoiceOutbox(storage, entry);
    assert.deepEqual(saveResult, { ok: true }, "outbox save should succeed");

    const readResult = readWindDownVoiceOutbox(storage);
    assert.equal(readResult.status, "valid", "outbox read should be valid");
    if (readResult.status === "valid") {
      assert.deepEqual(
        readResult.entry,
        entry,
        "outbox roundtrip must match original entry exactly",
      );
      // Measured digest verification seam
      const isDigestValid = await verifyOutboxEntryDigest(readResult.entry);
      assert.equal(isDigestValid, true, "measured digest must match report body");

      // Tampered report body must fail measured digest
      const tamperedEntry = {
        ...readResult.entry,
        report: {
          ...readResult.entry.report,
          turns: [createSampleTurn("conv-test-001", 1, "Tampered text", "Sure.")],
        },
      };
      const isTamperedDigestValid = await verifyOutboxEntryDigest(tamperedEntry);
      assert.equal(isTamperedDigestValid, false, "tampered report must fail measured digest verification");
    }

    // Whole-entry validation: reject invalid outbox entry format
    const invalidEntry = {
      ...entry,
      productSessionId: "short", // invalid: < 8 chars
    };
    const invalidSaveResult = saveWindDownVoiceOutbox(storage, invalidEntry as unknown as WindDownVoiceOutboxEntry);
    assert.equal(invalidSaveResult.ok, false);
    if (!invalidSaveResult.ok) {
      assert.equal(invalidSaveResult.code, "INVALID_OUTBOX_ENTRY");
    }
  }

  // --------------------------------------------------------------------------
  // Fixture 2: no-overwrite, corrupt bytes refusal, and same-session digest conflict
  // --------------------------------------------------------------------------
  {
    const storage = new MemoryStorage();
    const reportA = buildWindDownVoiceReport({
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-session-A-001",
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["conv-test-001"],
      sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
      startedAtIso: "2026-07-31T00:00:00.000Z",
      stoppedAtIso: "2026-07-31T00:01:00.000Z",
      completionReason: "learner-stop",
      turns: [createSampleTurn("conv-test-001", 1, "I'd like an iced americano.", "Got it.")],
      metrics: { turnCount: 1, interruptionCount: 0 },
    });
    const entryA: WindDownVoiceOutboxEntry = {
      schemaVersion: 1,
      productSessionId: reportA.productSessionId,
      activity: reportA.activity,
      finalDigest: await sha256Hex(reportA),
      report: reportA,
      stagedAtIso: "2026-07-31T00:01:00.000Z",
      attempts: 0,
    };
    saveWindDownVoiceOutbox(storage, entryA);

    // 2A: Different session cannot overwrite pending session A
    const reportB = buildWindDownVoiceReport({
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-session-B-002",
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["conv-test-001"],
      sessionProofs: [`${"B".repeat(80)}.${"b".repeat(64)}`],
      startedAtIso: "2026-07-31T00:02:00.000Z",
      stoppedAtIso: "2026-07-31T00:03:00.000Z",
      completionReason: "learner-stop",
      turns: [createSampleTurn("conv-test-001", 1, "Hot tea please.", "Certainly.")],
      metrics: { turnCount: 1, interruptionCount: 0 },
    });
    const entryB: WindDownVoiceOutboxEntry = {
      schemaVersion: 1,
      productSessionId: reportB.productSessionId,
      activity: reportB.activity,
      finalDigest: await sha256Hex(reportB),
      report: reportB,
      stagedAtIso: "2026-07-31T00:03:00.000Z",
      attempts: 0,
    };

    const conflictResult = saveWindDownVoiceOutbox(storage, entryB);
    assert.deepEqual(
      conflictResult,
      {
        ok: false,
        code: "OUTBOX_OCCUPIED_BY_DIFFERENT_SESSION",
        existingSessionId: "wd-session-A-001",
      },
      "outbox must reject saving a different pending session",
    );

    // 2B: Same session with DIFFERENT finalDigest cannot overwrite frozen report
    const entryADifferentDigest: WindDownVoiceOutboxEntry = {
      ...entryA,
      finalDigest: "1111111111111111111111111111111111111111111111111111111111111111",
    };
    const digestConflictResult = saveWindDownVoiceOutbox(storage, entryADifferentDigest);
    assert.equal(digestConflictResult.ok, false);
    if (!digestConflictResult.ok) {
      assert.equal(digestConflictResult.code, "OUTBOX_DIGEST_CONFLICT");
    }

    // 2C: Corrupt bytes in outbox must refuse overwrite and preserve raw bytes
    const corruptStorage = new MemoryStorage();
    corruptStorage.setItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY, "{corrupt:json:payload");
    const corruptSaveResult = saveWindDownVoiceOutbox(corruptStorage, entryA);
    assert.equal(corruptSaveResult.ok, false);
    if (!corruptSaveResult.ok) {
      assert.equal(corruptSaveResult.code, "OUTBOX_CORRUPT_BYTES_RETAINED");
    }
    assert.equal(
      corruptStorage.getItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY),
      "{corrupt:json:payload",
      "corrupt bytes must not be overwritten",
    );
  }

  // --------------------------------------------------------------------------
  // Fixture 3: exact acknowledgment & blocked-remove reporting
  // --------------------------------------------------------------------------
  {
    const storage = new MemoryStorage();
    const report = buildWindDownVoiceReport({
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-session-ack-test",
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["conv-test-001"],
      sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
      startedAtIso: "2026-07-31T00:00:00.000Z",
      stoppedAtIso: "2026-07-31T00:01:00.000Z",
      completionReason: "learner-stop",
      turns: [createSampleTurn("conv-test-001", 1, "Water please.", "Here you go.")],
      metrics: { turnCount: 1, interruptionCount: 0 },
    });
    const finalDigest = await sha256Hex(report);
    const entry: WindDownVoiceOutboxEntry = {
      schemaVersion: 1,
      productSessionId: report.productSessionId,
      activity: report.activity,
      finalDigest,
      report,
      stagedAtIso: "2026-07-31T00:01:00.000Z",
      attempts: 0,
    };
    saveWindDownVoiceOutbox(storage, entry);

    // Mismatched session ID
    const badSessionAck = acknowledgeWindDownVoiceOutbox(storage, {
      productSessionId: "wd-session-wrong",
      activity: "roleplay",
      finalDigest,
    });
    assert.equal(badSessionAck.ok, false);
    assert.equal(badSessionAck.code, "ACKNOWLEDGMENT_MISMATCH");

    // Blocked removeItem must NOT claim success
    storage.shouldFailRemove = true;
    const blockedRemoveAck = acknowledgeWindDownVoiceOutbox(storage, {
      productSessionId: "wd-session-ack-test",
      activity: "roleplay",
      finalDigest,
    });
    assert.equal(blockedRemoveAck.ok, false);
    if (!blockedRemoveAck.ok) {
      assert.equal(blockedRemoveAck.code, "CLEANUP_FAILED");
    }
    storage.shouldFailRemove = false;

    // Matching acknowledgment succeeds
    const matchAck = acknowledgeWindDownVoiceOutbox(storage, {
      productSessionId: "wd-session-ack-test",
      activity: "roleplay",
      finalDigest,
    });
    assert.deepEqual(matchAck, { ok: true }, "exact acknowledgment must clear outbox");
    assert.equal(readWindDownVoiceOutbox(storage).status, "empty");
  }

  // --------------------------------------------------------------------------
  // Fixture 4: corrupt retention, storage-unavailable vs corrupt, and draft recovery
  // --------------------------------------------------------------------------
  {
    const storage = new MemoryStorage();

    // Malformed JSON is retained
    const corruptPayload = "{corrupt:json:truncated";
    storage.setItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY, corruptPayload);

    const corruptRead = readWindDownVoiceOutbox(storage);
    assert.equal(corruptRead.status, "corrupt");
    if (corruptRead.status === "corrupt") {
      assert.equal(corruptRead.raw, corruptPayload);
    }

    // Storage read failure returns storage-unavailable (not pretending empty or corrupt raw)
    storage.shouldFailGet = true;
    const unavailableRead = readWindDownVoiceOutbox(storage);
    assert.equal(unavailableRead.status, "storage-unavailable");
    storage.shouldFailGet = false;

    // Blocked storage set returns STORAGE_UNAVAILABLE and permits draft export
    storage.shouldFailSet = true;
    const report = buildWindDownVoiceReport({
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-session-quota-test",
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["conv-test-001"],
      sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
      startedAtIso: "2026-07-31T00:00:00.000Z",
      stoppedAtIso: "2026-07-31T00:01:00.000Z",
      completionReason: "learner-stop",
      turns: [createSampleTurn("conv-test-001", 1, "Hi.", "Hello.")],
      metrics: { turnCount: 1, interruptionCount: 0 },
    });
    const entry: WindDownVoiceOutboxEntry = {
      schemaVersion: 1,
      productSessionId: report.productSessionId,
      activity: report.activity,
      finalDigest: await sha256Hex(report),
      report,
      stagedAtIso: "2026-07-31T00:01:00.000Z",
      attempts: 0,
    };

    const blockedResult = saveWindDownVoiceOutbox(storage, entry);
    assert.equal(blockedResult.ok, false);
    assert.equal(blockedResult.code, "STORAGE_UNAVAILABLE");

    const draftJson = createWindDownVoiceRecoveryDraft(entry);
    const parsedDraft = JSON.parse(draftJson);
    assert.equal(parsedDraft.format, "winddown-voice-recovery-draft-v1");
    assert.equal(parsedDraft.payload.productSessionId, "wd-session-quota-test");
  }

  // --------------------------------------------------------------------------
  // Fixture 5: multibyte 256KiB normal vs 48KiB keepalive & envelope overhead
  // --------------------------------------------------------------------------
  {
    const storage = new MemoryStorage();

    // 24 turns of Korean text with BOTH userText and modelText at 600 characters each
    // Each Hangul character is 3 UTF-8 bytes: 600 * 3 = 1,800 bytes per speaker
    // 3,600+ bytes per turn * 24 turns = ~86 KiB, cleanly establishing > 48 KiB keepalive
    const koreanUserText = "오늘 저녁에 따뜻한 디카페인 커피 한 잔과 편안하게 쉴 수 있는 자리를 부탁드립니다. 감사합니다. ".repeat(8).slice(0, 600);
    const koreanModelText = "네, 주문하신 따뜻한 디카페인 커피를 준비해 드리겠습니다. 편안한 자리에서 좋은 시간 보내세요. 언제든 말씀하세요. ".repeat(8).slice(0, 600);
    assert.equal(koreanUserText.length, 600, "user text must be exactly 600 characters");
    assert.equal(koreanModelText.length, 600, "model text must be exactly 600 characters");

    const turns: WindDownVoiceFinalizedTurn[] = [];
    for (let i = 1; i <= 24; i++) {
      turns.push(
        createSampleTurn(
          "conv-test-001",
          i,
          koreanUserText,
          koreanModelText,
        ),
      );
    }

    const largeReport = buildWindDownVoiceReport({
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-session-large-multibyte",
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["conv-test-001"],
      sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
      startedAtIso: "2026-07-31T00:00:00.000Z",
      stoppedAtIso: "2026-07-31T00:10:00.000Z",
      completionReason: "session-limit",
      turns,
      metrics: { turnCount: 24, interruptionCount: 0 },
    });

    const utf8Bytes = new TextEncoder().encode(JSON.stringify(largeReport)).byteLength;
    assert.equal(
      utf8Bytes > WIND_DOWN_VOICE_REPORT_KEEPALIVE_MAX_BYTES,
      true,
      `fixture must exceed 48 KiB keepalive cap (${utf8Bytes} > ${WIND_DOWN_VOICE_REPORT_KEEPALIVE_MAX_BYTES})`,
    );
    assert.equal(
      utf8Bytes <= WIND_DOWN_VOICE_REPORT_NORMAL_MAX_BYTES,
      true,
      `fixture must fit within 256 KiB normal report cap (${utf8Bytes} <= ${WIND_DOWN_VOICE_REPORT_NORMAL_MAX_BYTES})`,
    );

    assert.equal(isWindDownVoiceReport(largeReport), true);

    // Keepalive serializer must reject >48 KiB on pagehide
    assert.throws(
      () => serializeWindDownVoiceKeepaliveBody(largeReport),
      /winddown_voice_report_keepalive_too_large/,
    );

    // Outbox envelope overhead: outbox entry with metadata fits in 264 KiB cap
    const largeEntry: WindDownVoiceOutboxEntry = {
      schemaVersion: 1,
      productSessionId: largeReport.productSessionId,
      activity: largeReport.activity,
      finalDigest: await sha256Hex(largeReport),
      report: largeReport,
      stagedAtIso: "2026-07-31T00:10:00.000Z",
      attempts: 0,
    };

    const outboxResult = saveWindDownVoiceOutbox(storage, largeEntry);
    assert.deepEqual(outboxResult, { ok: true }, "outbox must store >48 KiB multibyte report with envelope allowance");
    assert.equal(WIND_DOWN_VOICE_OUTBOX_MAX_BYTES, 264 * 1024);
  }

  // --------------------------------------------------------------------------
  // Fixture 6: private-ID-only practice links, turn sequence beyond 24, and receipt extraction
  // --------------------------------------------------------------------------
  {
    // Canonical material IDs permit colon and turn sequence can be positive integer > 24
    const citation = {
      conversation: "wd-session-practice-001",
      turn: 42,
      source: "conv-local-source-777",
      material: "material:cafe:decaf-01",
    };

    const url = buildWindDownVoicePracticeUrl(citation);
    assert.equal(
      url,
      "/winddown/drill?conversation=wd-session-practice-001&turn=42&source=conv-local-source-777&material=material%3Acafe%3Adecaf-01",
    );

    // Zero learner transcript in URL
    assert.equal(url.includes("coffee"), false);
    assert.equal(url.includes("learner"), false);

    // Parse valid URL with turn 42
    const parsed = parseWindDownVoicePracticeUrl(url);
    assert.deepEqual(parsed, citation);

    // Parser rejects duplicate parameters
    assert.equal(
      parseWindDownVoicePracticeUrl("/winddown/drill?conversation=wd-session-001&conversation=wd-session-002&turn=1&source=conv-1"),
      null,
    );

    // Parser rejects non-positive safe integer turns (0, negative, floating point)
    assert.equal(
      parseWindDownVoicePracticeUrl("/winddown/drill?conversation=wd-session-001&turn=0&source=conv-1"),
      null,
    );
    assert.equal(
      parseWindDownVoicePracticeUrl("/winddown/drill?conversation=wd-session-001&turn=-5&source=conv-1"),
      null,
    );
    assert.equal(
      parseWindDownVoicePracticeUrl("/winddown/drill?conversation=wd-session-001&turn=1.5&source=conv-1"),
      null,
    );

    // Parser rejects unknown injected query params
    assert.equal(
      parseWindDownVoicePracticeUrl("/winddown/drill?conversation=wd-session-001&turn=1&source=conv-1&injected=true"),
      null,
    );

    // Extraction from real report with modelText containing correctionText literally
    const reportWithCorrection = buildWindDownVoiceReport({
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-session-practice-001",
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["conv-test-001"],
      sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
      startedAtIso: "2026-07-31T00:00:00.000Z",
      stoppedAtIso: "2026-07-31T00:01:00.000Z",
      completionReason: "learner-stop",
      turns: [
        createSampleTurn(
          "conv-test-001",
          1,
          "I want coffee.",
          "Sure! A more polite way is: I'd like a coffee, please.",
          "I'd like a coffee, please.",
        ),
      ],
      metrics: { turnCount: 1, interruptionCount: 0 },
    });

    assert.equal(reportWithCorrection.outcome.corrections.length, 1);
    assert.equal(
      reportWithCorrection.outcome.corrections[0].correctionText,
      "I'd like a coffee, please.",
    );

    const receipt: WindDownVoiceReportReceipt = {
      schemaVersion: 1,
      activity: "roleplay",
      productSessionId: "wd-session-practice-001",
      finalDigest: await sha256Hex(reportWithCorrection),
      committedAtIso: "2026-07-31T00:01:00.000Z",
      report: reportWithCorrection,
      journeyTargets: [
        {
          materialId: "material:cafe:decaf-01",
          en: "I want coffee.",
          acceptedVariants: [],
        },
      ],
    };

    const seeds = extractWindDownVoicePracticeSeeds(receipt);
    assert.equal(seeds.length, 1);
    assert.equal(seeds[0].materialId, "material:cafe:decaf-01");
    assert.equal(seeds[0].citation.turn, 1);
    assert.equal(
      seeds[0].practiceUrl,
      "/winddown/drill?conversation=wd-session-practice-001&turn=1&source=conv-test-001&material=material%3Acafe%3Adecaf-01",
    );
  }

  // --------------------------------------------------------------------------
  // Fixture 7: checkpoint deep validation, two-conversation repeated-turnSeq roundtrip
  // --------------------------------------------------------------------------
  {
    const storage = new MemoryStorage();
    const descriptor = createWindDownRoleplayDescriptor("cafe-order");

    // Two-conversation reconnected chain with repeated turnSeq across distinct conversationIds
    const twoConvCheckpoint: WindDownVoiceSessionCheckpoint = {
      schemaVersion: 1,
      productSessionId: "wd-session-checkpoint-reconnect-001",
      activity: "roleplay",
      conversationIds: ["conv-chain-001", "conv-chain-002"],
      sessionProofs: [
        `${"A".repeat(80)}.${"a".repeat(64)}`,
        `${"B".repeat(80)}.${"b".repeat(64)}`,
      ],
      descriptor,
      startedAtIso: "2026-07-31T00:00:00.000Z",
      turns: [
        createSampleTurn("conv-chain-001", 1, "Hi there.", "Hello!"),
        createSampleTurn("conv-chain-001", 2, "I'd like a latte.", "Hot or iced?"),
        // Reconnection restarts turnSeq at 1 under new conversationId
        createSampleTurn("conv-chain-002", 1, "Are you there?", "Yes, still here!"),
      ],
      metrics: { turnCount: 3, interruptionCount: 0 },
      checkpointAtIso: "2026-07-31T00:01:00.000Z",
    };

    const saveResult = saveWindDownVoiceCheckpoint(storage, twoConvCheckpoint);
    assert.deepEqual(saveResult, { ok: true }, "checkpoint with reconnected conversation turns must succeed");

    const readBack = readWindDownVoiceCheckpoint(storage);
    assert.equal(readBack.status, "valid");
    if (readBack.status === "valid") {
      assert.equal(readBack.checkpoint.turns.length, 3);
      assert.equal(readBack.checkpoint.turns[0].turnSeq, 1);
      assert.equal(readBack.checkpoint.turns[2].turnSeq, 1); // repeated sequence in conv-chain-002

      const rebuiltReport = buildWindDownVoiceReportFromCheckpoint(
        readBack.checkpoint,
        "learner-stop",
        "2026-07-31T00:01:15.000Z",
      );
      assert.equal(rebuiltReport.productSessionId, "wd-session-checkpoint-reconnect-001");
      assert.equal(rebuiltReport.turns.length, 3);
      assert.equal(isWindDownVoiceReport(rebuiltReport), true);
    }

    // Duplicate (conversationId, turnSeq) must be rejected
    const duplicateTurnCheckpoint: WindDownVoiceSessionCheckpoint = {
      ...twoConvCheckpoint,
      turns: [
        createSampleTurn("conv-chain-001", 1, "Hi there.", "Hello!"),
        createSampleTurn("conv-chain-001", 1, "Duplicate turnSeq 1 in same conversation!", "Hello!"),
      ],
      metrics: { turnCount: 2, interruptionCount: 0 },
    };
    const duplicateResult = saveWindDownVoiceCheckpoint(storage, duplicateTurnCheckpoint);
    assert.equal(duplicateResult.ok, false);
    if (!duplicateResult.ok) {
      assert.equal(duplicateResult.code, "CHECKPOINT_INVALID");
    }

    // Checkpoint regression rejected (attempting to replace 3 turns with 2 turns)
    const regressedCheckpoint: WindDownVoiceSessionCheckpoint = {
      ...twoConvCheckpoint,
      turns: twoConvCheckpoint.turns.slice(0, 2),
      metrics: { turnCount: 2, interruptionCount: 0 },
    };
    const regressionResult = saveWindDownVoiceCheckpoint(storage, regressedCheckpoint);
    assert.equal(regressionResult.ok, false);
    if (!regressionResult.ok) {
      assert.equal(regressionResult.code, "CHECKPOINT_REGRESSION_REJECTED");
    }

    // Checkpoint divergence rejected (earlier turn modified)
    const divergedCheckpoint: WindDownVoiceSessionCheckpoint = {
      ...twoConvCheckpoint,
      turns: [
        createSampleTurn("conv-chain-001", 1, "Diverged user text.", "Hello!"),
        twoConvCheckpoint.turns[1],
        twoConvCheckpoint.turns[2],
      ],
    };
    const divergenceResult = saveWindDownVoiceCheckpoint(storage, divergedCheckpoint);
    assert.equal(divergenceResult.ok, false);
    if (!divergenceResult.ok) {
      assert.equal(divergenceResult.code, "CHECKPOINT_HISTORY_DIVERGED");
    }

    clearWindDownVoiceCheckpoint(storage, "wd-session-checkpoint-reconnect-001");
    assert.equal(readWindDownVoiceCheckpoint(storage).status, "empty");
  }

  console.log(
    "PASS winddown-voice-continuity - durable outbox, no-overwrite, exact ack, multibyte 256KiB cap, and private practice links",
  );
}

void main();
