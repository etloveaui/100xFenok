import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  applyMonaVnextLearningEvents,
  createEmptyMonaVnextLearningProfile,
} from "../src/features/mona-vnext/memory/fsrsLearningProfile";
import { buildLearningEvent } from "../src/features/mona-vnext/memory/srsBridge";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorState,
} from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import {
  WindDownReviewCycleError,
  buildWindDownReviewCards,
  commitWindDownReviewCycleState,
  createWindDownReviewCycleId,
  normalizeWindDownReviewCycleReceipt,
  normalizeWindDownReviewCycleInput,
  summarizeWindDownReviewQueue,
  type WindDownReviewCycleInput,
} from "../src/features/winddown/server/reviewCycle";

async function main() {
const digest = "a".repeat(64);
const material = {
  id: "material-a",
  en: "I am ready.",
  acceptedVariants: ["I'm ready."],
};
const learnedAt = "2026-07-01T00:00:00.000Z";
const learned = buildLearningEvent({
  expressionId: material.id,
  verdict: "canonical",
  atIso: learnedAt,
  sessionId: "review-cycle-fixture",
});
assert(learned);
const dueProfile = applyMonaVnextLearningEvents(
  createEmptyMonaVnextLearningProfile(),
  [learned],
);
const dueRecord = dueProfile.records[material.id];
assert(dueRecord);
const nowIso = new Date(
  Date.parse(dueRecord.card.dueAtIso) + 60_000,
).toISOString();
const dueAtMs = Date.parse(dueRecord.card.dueAtIso);
const dueAtKstIso = new Date(dueAtMs + 9 * 60 * 60 * 1000)
  .toISOString()
  .replace("Z", "+09:00");
assert.equal(
  (
    await buildWindDownReviewCards({
      cards: [material],
      profile: dueProfile,
      contentDigest: digest,
      nowIso: new Date(dueAtMs - 1).toISOString(),
    })
  ).length,
  0,
  "a review card must remain unavailable one millisecond before its due instant",
);
assert.equal(
  (
    await buildWindDownReviewCards({
      cards: [material],
      profile: dueProfile,
      contentDigest: digest,
      nowIso: dueAtKstIso,
    })
  ).length,
  1,
  "the same due instant expressed in KST must make the review card available",
);
assert.equal(
  summarizeWindDownReviewQueue({
    profile: dueProfile,
    nowIso: dueAtKstIso,
  }).remainingDueCount,
  1,
  "queue summaries must use the same absolute due boundary across time zones",
);
const reviewCycleId = await createWindDownReviewCycleId({
  materialId: material.id,
  contentDigest: digest,
  record: dueRecord,
});

function input(
  attempts: WindDownReviewCycleInput["attempts"],
  inputMode: WindDownReviewCycleInput["inputMode"] = "typed",
): WindDownReviewCycleInput {
  return {
    schemaVersion: 1,
    activity: "review",
    reviewCycleId,
    materialId: material.id,
    contentDigest: digest,
    inputMode,
    attempts,
  };
}

const firstPassInput = input([
  { answer: "I am ready.", revealedBefore: false },
]);
const firstPass = await commitWindDownReviewCycleState({
  profile: dueProfile,
  existingReceipt: null,
  input: firstPassInput,
  material,
  currentContentDigest: digest,
  nowIso,
});
assert.equal(firstPass.receipt.rating, "good");
assert.equal(firstPass.receipt.reward, 1);
assert.equal(firstPass.receipt.inputMode, "typed");
assert.equal(firstPass.duplicate, false);
assert.equal(firstPass.profile.records[material.id].lastInputMode, "typed");
assert.equal(
  normalizeWindDownReviewCycleReceipt({
    ...firstPass.receipt,
    inputMode: "chips",
  }),
  null,
  "a chips receipt can never claim Good",
);
assert.equal(
  firstPass.profile.records[material.id].card.reps,
  dueRecord.card.reps + 1,
);

const duplicate = await commitWindDownReviewCycleState({
  profile: firstPass.profile,
  existingReceipt: firstPass.receipt,
  input: firstPassInput,
  material,
  currentContentDigest: digest,
  nowIso: new Date(Date.parse(nowIso) + 5_000).toISOString(),
});
assert.equal(duplicate.duplicate, true);
assert.deepEqual(duplicate.receipt, firstPass.receipt);
assert.deepEqual(duplicate.profile, firstPass.profile);

const chipsFirst = await commitWindDownReviewCycleState({
  profile: dueProfile,
  existingReceipt: null,
  input: input([
    { answer: "I am ready.", revealedBefore: false },
  ], "chips"),
  material,
  currentContentDigest: digest,
  nowIso,
});
assert.equal(chipsFirst.receipt.rating, "hard");
assert.equal(chipsFirst.receipt.reward, 1);
assert.equal(chipsFirst.receipt.inputMode, "chips");
assert.equal(chipsFirst.profile.records[material.id].lastInputMode, "chips");

async function expectError(
  args: Parameters<typeof commitWindDownReviewCycleState>[0],
  code: WindDownReviewCycleError["code"],
) {
  await assert.rejects(
    () => commitWindDownReviewCycleState(args),
    (error) => error instanceof WindDownReviewCycleError && error.code === code,
  );
}

await expectError(
  {
    profile: firstPass.profile,
    existingReceipt: firstPass.receipt,
    input: input([{ answer: "different", revealedBefore: false }]),
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "REVIEW_CYCLE_CONFLICT",
);
await expectError(
  {
    profile: firstPass.profile,
    existingReceipt: firstPass.receipt,
    input: input([
      { answer: "I am ready.", revealedBefore: false },
    ], "chips"),
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "REVIEW_CYCLE_CONFLICT",
);
await expectError(
  {
    profile: firstPass.profile,
    existingReceipt: firstPass.receipt,
    input: input([{ answer: " I am ready. ", revealedBefore: false }]),
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "REVIEW_CYCLE_CONFLICT",
);

const recovered = await commitWindDownReviewCycleState({
  profile: dueProfile,
  existingReceipt: null,
  input: input([
    { answer: "not yet", revealedBefore: false },
    { answer: "I'm ready.", revealedBefore: false },
  ]),
  material,
  currentContentDigest: digest,
  nowIso,
});
assert.equal(recovered.receipt.rating, "hard");
assert.equal(recovered.receipt.reward, 1);
assert.equal(recovered.receipt.inputMode, "typed");

const revealed = await commitWindDownReviewCycleState({
  profile: dueProfile,
  existingReceipt: null,
  input: input([
    { answer: "", revealedBefore: true },
    { answer: "I am ready.", revealedBefore: true },
  ]),
  material,
  currentContentDigest: digest,
  nowIso,
});
assert.equal(revealed.receipt.rating, "again");
assert.equal(revealed.receipt.reward, 0);

const revealBypass = await commitWindDownReviewCycleState({
  profile: dueProfile,
  existingReceipt: null,
  input: input([
    { answer: "", revealedBefore: true },
    { answer: "I am ready.", revealedBefore: false },
  ]),
  material,
  currentContentDigest: digest,
  nowIso,
});
assert.equal(revealBypass.receipt.rating, "again");
assert.equal(revealBypass.receipt.reward, 0);

const extraWords = await commitWindDownReviewCycleState({
  profile: dueProfile,
  existingReceipt: null,
  input: input([
    { answer: "Please, I am ready.", revealedBefore: false },
  ]),
  material,
  currentContentDigest: digest,
  nowIso,
});
assert.equal(
  extraWords.receipt.rating,
  "again",
  "typed recall must not inherit the speech matcher's permissive token-in-order pass",
);
assert.equal(extraWords.receipt.reward, 0);

assert.equal(
  normalizeWindDownReviewCycleInput({
    schemaVersion: 1,
    activity: "review",
    reviewCycleId,
    materialId: material.id,
    contentDigest: digest,
    attempts: [{ answer: "I am ready.", revealedBefore: false }],
  }).inputMode,
  "typed",
  "legacy review input without inputMode must normalize to typed",
);

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const legacyReceipt = {
  schemaVersion: firstPass.receipt.schemaVersion,
  reviewCycleId: firstPass.receipt.reviewCycleId,
  requestDigest: await sha256(JSON.stringify({
    schemaVersion: firstPassInput.schemaVersion,
    activity: firstPassInput.activity,
    reviewCycleId: firstPassInput.reviewCycleId,
    materialId: firstPassInput.materialId,
    contentDigest: firstPassInput.contentDigest,
    attempts: firstPassInput.attempts,
  })),
  materialId: firstPass.receipt.materialId,
  reviewedAt: firstPass.receipt.reviewedAt,
  rating: firstPass.receipt.rating,
  reward: firstPass.receipt.reward,
};
const legacyDuplicate = await commitWindDownReviewCycleState({
  profile: firstPass.profile,
  existingReceipt: legacyReceipt,
  input: firstPassInput,
  material,
  currentContentDigest: digest,
  nowIso,
});
assert.equal(legacyDuplicate.duplicate, true);
assert.equal(legacyDuplicate.receipt.inputMode, "typed");
await expectError(
  {
    profile: firstPass.profile,
    existingReceipt: legacyReceipt,
    input: input(firstPassInput.attempts, "chips"),
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "REVIEW_CYCLE_CONFLICT",
);

class MemoryDurableState implements WindDownReviewCoordinatorState {
  private readonly values = new Map<string, unknown>();
  private chain = Promise.resolve();

  readonly storage = {
    get: async <T>(key: string) => this.values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => {
      this.values.set(key, value);
    },
    transaction: async <T>(
      callback: (transaction: {
        get<U>(key: string): Promise<U | undefined>;
        put<U>(key: string, value: U): Promise<void>;
      }) => Promise<T>,
    ) => callback(this.storage),
  };

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const current = this.chain.then(callback);
    this.chain = current.then(() => undefined, () => undefined);
    return current;
  }
}

const coordinatorState = new MemoryDurableState();
let mirroredProfile = JSON.stringify(dueProfile);
const coordinatorEnv = {
  MONA_VNEXT_KV: {
    get: async () => mirroredProfile,
    put: async (_key: string, value: string) => {
      mirroredProfile = value;
    },
  },
};
const coordinatorCommand = {
  operation: "commit-review-cycle",
  input: firstPassInput,
  material,
  activeMaterialIds: [material.id],
  currentContentDigest: digest,
  nowIso,
};
const coordinatorRequest = (command: Record<string, unknown> = coordinatorCommand) =>
  new Request("https://winddown.internal/profile-coordinator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
const coordinatorResponses = await Promise.all([
  coordinatorState.blockConcurrencyWhile(() =>
    handleMonaVnextProfileCoordinatorRequest(
      coordinatorState,
      coordinatorEnv,
      coordinatorRequest(),
    )
  ),
  coordinatorState.blockConcurrencyWhile(() =>
    handleMonaVnextProfileCoordinatorRequest(
      coordinatorState,
      coordinatorEnv,
      coordinatorRequest(),
    )
  ),
]);
const coordinatorBodies = await Promise.all(
  coordinatorResponses.map((response) => response.json()) as Promise<
    Record<string, unknown>
  >[],
);
assert.deepEqual(
  coordinatorBodies.map((body) => body.duplicate),
  [false, true],
);
assert.deepEqual(
  coordinatorBodies[1]?.receipt,
  coordinatorBodies[0]?.receipt,
);
const mirrored = JSON.parse(mirroredProfile);
assert.equal(
  mirrored.records[material.id].card.reps,
  dueRecord.card.reps + 1,
  "concurrent duplicate requests must leave one FSRS mutation",
);
const bootstrapErrorState = new MemoryDurableState();
await assert.rejects(
  () =>
    bootstrapErrorState.blockConcurrencyWhile(() =>
      handleMonaVnextProfileCoordinatorRequest(
        bootstrapErrorState,
        {
          MONA_VNEXT_KV: {
            get: async () => {
              throw new Error("LEGACY_PROFILE_READ_FAILED");
            },
            put: async () => undefined,
          },
        },
        coordinatorRequest(),
      )
    ),
  /LEGACY_PROFILE_READ_FAILED/,
  "a transient legacy-profile read failure must not initialize an empty authoritative profile",
);
assert.equal(
  await bootstrapErrorState.storage.get("mona-vnext-learning-profile"),
  undefined,
);

const staleMirrorState = new MemoryDurableState();
let staleMirrorReadCount = 0;
const staleMirrorEnv = {
  MONA_VNEXT_KV: {
    get: async () => {
      staleMirrorReadCount += 1;
      return JSON.stringify(dueProfile);
    },
    put: async () => {
      throw new Error("KV_MIRROR_WRITE_FAILED");
    },
  },
};
await assert.rejects(
  () =>
    staleMirrorState.blockConcurrencyWhile(() =>
      handleMonaVnextProfileCoordinatorRequest(
        staleMirrorState,
        staleMirrorEnv,
        coordinatorRequest(),
      )
    ),
  /KV_MIRROR_WRITE_FAILED/,
);
const authoritativeReadResponse = await staleMirrorState.blockConcurrencyWhile(() =>
  handleMonaVnextProfileCoordinatorRequest(
    staleMirrorState,
    staleMirrorEnv,
    coordinatorRequest({ operation: "read-learning-profile" }),
  )
);
assert.equal(authoritativeReadResponse.ok, true);
const authoritativeRead = await authoritativeReadResponse.json() as {
  profile?: typeof dueProfile;
};
assert.equal(
  authoritativeRead.profile?.records[material.id]?.card.reps,
  dueRecord.card.reps + 1,
  "DO read must return the committed profile even when the KV mirror remains stale",
);
assert.equal(
  staleMirrorReadCount,
  1,
  "authoritative reads must not return to the legacy KV after DO bootstrap",
);

await expectError(
  {
    profile: dueProfile,
    existingReceipt: null,
    input: { ...firstPassInput, contentDigest: "b".repeat(64) },
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "MATERIAL_VERSION_CHANGED",
);
await expectError(
  {
    profile: dueProfile,
    existingReceipt: null,
    input: { ...firstPassInput, materialId: "forged-material" },
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "MATERIAL_NOT_ACTIVE",
);
await expectError(
  {
    profile: dueProfile,
    existingReceipt: null,
    input: { ...firstPassInput, reviewCycleId: `winddown-review:${"f".repeat(64)}` },
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "REVIEW_CYCLE_STALE",
);
await expectError(
  {
    profile: dueProfile,
    existingReceipt: null,
    input: firstPassInput,
    material,
    currentContentDigest: digest,
    nowIso: new Date(Date.parse(dueRecord.card.dueAtIso) - 1).toISOString(),
  },
  "REVIEW_CYCLE_NOT_DUE",
);
await expectError(
  {
    profile: dueProfile,
    existingReceipt: null,
    input: {
      ...firstPassInput,
      attempts: [
        { answer: "one", revealedBefore: false },
        { answer: "two", revealedBefore: false },
        { answer: "three", revealedBefore: false },
      ],
    },
    material,
    currentContentDigest: digest,
    nowIso,
  },
  "INVALID_REVIEW_CYCLE",
);

const wrangler = readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8");
const wranglerConfig = JSON.parse(wrangler) as {
  observability?: {
    enabled?: boolean;
    logs?: {
      enabled?: boolean;
      invocation_logs?: boolean;
      persist?: boolean;
    };
  };
};
assert.deepEqual(
  wranglerConfig.observability,
  {
    enabled: true,
    logs: {
      enabled: true,
      invocation_logs: true,
      persist: true,
    },
  },
  "Workers invocation logs must remain enabled for physical-device attribution",
);
const workerMain = wrangler.match(/"main"\s*:\s*"([^"]+)"/)?.[1];
assert.equal(
  workerMain,
  "worker.ts",
  "the custom deploy entry must stay outside src/**/*.ts so Next typecheck does not resolve the post-build OpenNext worker",
);
const worker = readFileSync(
  path.join(process.cwd(), workerMain),
  "utf8",
);
const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
assert.equal(tsconfig.error, undefined);
const nextTypeRoots = ts.parseJsonConfigFileContent(
  tsconfig.config,
  ts.sys,
  process.cwd(),
).fileNames;
assert.equal(
  nextTypeRoots.includes(path.join(process.cwd(), workerMain)),
  false,
  "Next typecheck must not inspect the deploy entry before OpenNext generates worker.js",
);
const repository = readFileSync(
  path.join(
    process.cwd(),
    "src/features/mona-vnext/memory/monaMemoryRepository.ts",
  ),
  "utf8",
);
const coordinatorClient = readFileSync(
  path.join(
    process.cwd(),
    "src/features/mona-vnext/memory/learningProfileCoordinatorClient.ts",
  ),
  "utf8",
);
assert.match(wrangler, /WINDDOWN_REVIEW_COORDINATOR/);
assert.match(wrangler, /new_sqlite_classes/);
assert.match(worker, /extends DurableObject/);
assert.match(worker, /blockConcurrencyWhile/);
assert.match(
  repository,
  /appendMonaVnextLearningEventsThroughCoordinator/,
  "Cloudflare Learn writes must share the same profile single-writer",
);
assert.match(repository, /readMonaVnextLearningProfileThroughCoordinator/);
assert.match(coordinatorClient, /operation: "read-learning-profile"/);

console.log(
  "PASS winddown-review-cycle - server grading, atomic receipt idempotency, and fail-closed review cycles",
);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
