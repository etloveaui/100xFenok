import assert from "node:assert/strict";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorEnv,
  type WindDownReviewCoordinatorState,
  type WindDownVoiceReportReceipt,
} from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import {
  createWindDownRoleplayDescriptor,
} from "../src/features/winddown/voice/product";
import {
  buildWindDownVoiceReport,
} from "../src/features/winddown/voice/report";

async function sha256Hex(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function main() {
  const values = new Map<string, unknown>();
  let kvReads = 0;
  let kvWrites = 0;
  const storage = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, value);
    },
    async transaction<T>(
      callback: (transaction: {
        get<U>(key: string): Promise<U | undefined>;
        put<U>(key: string, value: U): Promise<void>;
      }) => Promise<T>,
    ) {
      return callback(storage);
    },
  };
  const state: WindDownReviewCoordinatorState = {
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  };
  const env: WindDownReviewCoordinatorEnv = {
    MONA_VNEXT_KV: {
      async get() {
        kvReads += 1;
        return null;
      },
      async put() {
        kvWrites += 1;
      },
    },
  };
  const report = buildWindDownVoiceReport({
    schemaVersion: 1,
    activity: "roleplay",
    productSessionId: "wd-roleplay-session-001",
    descriptor: createWindDownRoleplayDescriptor("cafe-order"),
    conversationIds: ["winddown-roleplay-cafe-order-conversation-001"],
    sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
    startedAtIso: "2026-07-31T00:00:00.000Z",
    stoppedAtIso: "2026-07-31T00:01:00.000Z",
    completionReason: "learner-stop",
    turns: [
      {
        conversationId: "winddown-roleplay-cafe-order-conversation-001",
        turnSeq: 1,
        userText: "I'd like a decaf coffee, thank you.",
        modelText: "Sure.",
        finalized: true,
        sttDrift: false,
        interrupted: false,
      },
    ],
    metrics: { turnCount: 1, interruptionCount: 0 },
  });
  const digestBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(report)),
  );
  const finalDigest = [...new Uint8Array(digestBytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const receipt: WindDownVoiceReportReceipt = {
    schemaVersion: 1,
    activity: "roleplay",
    productSessionId: "wd-roleplay-session-001",
    finalDigest,
    committedAtIso: "2026-07-31T00:00:00.000Z",
    report,
    journeyTargets: [{
      materialId: "material-tonight",
      en: "I'd like a decaf coffee",
      acceptedVariants: [],
    }],
  };

  async function commit(candidate: unknown) {
    return handleMonaVnextProfileCoordinatorRequest(
      state,
      env,
      new Request("https://winddown.internal/profile-coordinator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "commit-voice-report",
          receipt: candidate,
        }),
      }),
    );
  }

  const firstResponse = await commit(receipt);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json() as Record<string, unknown>;
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.habitCredited, true);

  const duplicateResponse = await commit(receipt);
  assert.equal(duplicateResponse.status, 200);
  const duplicate = await duplicateResponse.json() as Record<string, unknown>;
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.habitCredited, true);
  assert.deepEqual(duplicate.receipt, first.receipt);

  const unqualifiedReport = {
    ...report,
    productSessionId: "wd-roleplay-session-unqualified",
  };
  const unqualifiedResponse = await commit({
    schemaVersion: 1,
    activity: "roleplay",
    productSessionId: unqualifiedReport.productSessionId,
    finalDigest: await sha256Hex(unqualifiedReport),
    committedAtIso: "2026-07-31T00:01:00.000Z",
    report: unqualifiedReport,
  });
  assert.equal(unqualifiedResponse.status, 200);
  const unqualified = await unqualifiedResponse.json() as Record<string, unknown>;
  assert.equal(unqualified.habitCredited, false);

  const conflictResponse = await commit({
    ...receipt,
    report: {
      ...report,
      stoppedAtIso: "2026-07-31T00:02:00.000Z",
    },
    finalDigest: await (async () => {
      const changed = JSON.stringify({
        ...report,
        stoppedAtIso: "2026-07-31T00:02:00.000Z",
      });
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(changed),
      );
      return [...new Uint8Array(bytes)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    })(),
  });
  assert.equal(conflictResponse.status, 409);
  assert.deepEqual(await conflictResponse.json(), {
    error: "WINDDOWN_VOICE_REPORT_CONFLICT",
  });

  const invalidResponse = await commit({
    ...receipt,
    productSessionId: "../unsafe",
  });
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "INVALID_WINDDOWN_VOICE_REPORT_RECEIPT",
  });

  const extraReceiptFieldResponse = await commit({
    ...receipt,
    internalOverride: true,
  });
  assert.equal(extraReceiptFieldResponse.status, 400);

  for (const injectedReport of [
    { ...report, internalOverride: true },
    {
      ...report,
      metrics: { ...report.metrics, internalMetric: 1 },
    },
    {
      ...report,
      turns: [{ ...report.turns[0], internalTurnField: true }],
    },
    {
      ...report,
      outcome: { ...report.outcome, internalOutcomeField: true },
    },
  ]) {
    const injectedResponse = await commit({
      ...receipt,
      report: injectedReport,
      finalDigest: await sha256Hex(injectedReport),
    });
    assert.equal(
      injectedResponse.status,
      400,
      "coordinator must reject unknown canonical-report fields",
    );
  }

  const digestMismatchResponse = await commit({
    ...receipt,
    productSessionId: "wd-roleplay-session-002",
    report: {
      ...report,
      productSessionId: "wd-roleplay-session-002",
    },
  });
  assert.equal(digestMismatchResponse.status, 400);
  assert.deepEqual(await digestMismatchResponse.json(), {
    error: "WINDDOWN_VOICE_REPORT_DIGEST_MISMATCH",
  });

  assert.equal(kvReads, 0, "voice reports must not initialize or read the learning profile");
  assert.equal(kvWrites, 0, "voice reports must not mutate the learning-profile mirror");
  console.log(
    "PASS winddown-voice-report-coordinator - atomic duplicate and conflict receipts without FSRS/KV mutation",
  );
}

void main();
