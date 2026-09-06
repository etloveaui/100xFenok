import assert from "node:assert/strict";
import { handleMonaVnextProfileCoordinatorRequest } from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyWindDownLearnAction,
  createWindDownLearnSession,
  type WindDownLearnAction,
  type WindDownLearnCard,
  type WindDownLearnState,
} from "../src/features/winddown/learn/engine";
import { buildWindDownStudyBootstrap } from "../src/features/winddown/server/studyBootstrap";
import type { WindDownLearnSessionManifest } from "../src/features/winddown/server/learnSessionProof";
import type { MonaVnextExpression } from "../src/features/mona-vnext/coach/coachPolicy";

/**
 * Stable production seam expected by this scorer:
 *
 * export type WindDownLearnResumeInput = {
 *   entries: readonly WindDownLearnCard[];
 *   manifest: unknown;
 *   state: unknown;
 *   habitKstDay: string;
 *   contentDigest: string;
 *   now: Date;
 * };
 *
 * export type WindDownLearnResume = {
 *   manifest: WindDownLearnSessionManifest;
 *   cards: WindDownLearnCard[];
 *   state: WindDownLearnState;
 * };
 *
 * export function selectWindDownLearnResume(
 *   input: WindDownLearnResumeInput,
 * ): WindDownLearnResume | null;
 *
 * The import is intentionally dynamic while Stage 1 is RED: the pure
 * resolver is the production extraction that follows this test.
 */
type WindDownLearnResumeInput = {
  entries: readonly WindDownLearnCard[];
  manifest: unknown;
  state: unknown;
  habitKstDay: string;
  contentDigest: string;
  now: Date;
};

type WindDownLearnResume = {
  manifest: WindDownLearnSessionManifest;
  cards: WindDownLearnCard[];
  state: WindDownLearnState;
};

type WindDownLearnResumeResolver = (
  input: WindDownLearnResumeInput,
) => WindDownLearnResume | null;

type ResolverModule = {
  selectWindDownLearnResume?: unknown;
};

const RESOLVER_MODULE =
  "../src/features/winddown/server/learnResume";

const now = new Date("2026-09-06T03:00:00.000Z");
const habitKstDay = "2026-09-06";
const contentDigest = "a".repeat(64);

const cards: MonaVnextExpression[] = Array.from(
  { length: 5 },
  (_, index) => ({
    id: `resume-card-${index + 1}`,
    ko: `복구 문장 ${index + 1}`,
    en: `I am ready for number ${index + 1}.`,
    state: "prompt" as const,
  }),
);

const firstBootstrap = buildWindDownStudyBootstrap({
  mode: "learn",
  seed: `${habitKstDay}:learn`,
  entries: cards,
  dueExpressionIds: [],
  deferredExpressionIds: [],
  count: 5,
});
assert.equal(
  firstBootstrap.cards.length,
  5,
  "the first Learn request must issue exactly five fresh cards",
);

const manifest: WindDownLearnSessionManifest = {
  schemaVersion: 1,
  sessionId: "winddown-resume-session-20260906",
  habitKstDay,
  seed: firstBootstrap.seed,
  cardIds: firstBootstrap.cards.map((card) => card.id),
  contentDigest,
  issuedAtIso: "2026-09-06T00:00:00.000Z",
  expiresAtIso: "2026-09-06T18:00:00.000Z",
};

function correctAction(state: WindDownLearnState): WindDownLearnAction {
  const current = state.queue[0];
  assert(current, "a fresh five-card session must have a current exercise");
  return current.kind === "meaning-choice"
    ? {
        type: "choose-meaning",
        cardId: current.card.id,
        choiceId: current.correctChoiceId,
      }
    : {
        type: "submit-sentence",
        cardId: current.card.id,
        tokenIds: [...current.canonicalTokenIds],
      };
}

const initialState = createWindDownLearnSession({
  cards: firstBootstrap.cards,
  seed: manifest.seed,
});
const firstCredit = applyWindDownLearnAction(
  initialState,
  correctAction(initialState),
);
assert.equal(firstCredit.outcome, "correct");
assert.equal(firstCredit.reward, 1);
const stateAfterOneCredit = firstCredit.state;
const creditedCardId = stateAfterOneCredit.creditedCardIds[0];
assert(creditedCardId, "the fixture must contain one credited card");
assert.equal(stateAfterOneCredit.queue.length, 4);

const reloadBootstrap = buildWindDownStudyBootstrap({
  mode: "learn",
  seed: manifest.seed,
  entries: cards,
  dueExpressionIds: [],
  deferredExpressionIds: [creditedCardId],
  count: 5,
});
assert.equal(
  reloadBootstrap.cards.length,
  4,
  "one persisted credit must leave four fresh candidates on reload",
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function resolverInput(
  overrides: Partial<WindDownLearnResumeInput> = {},
): WindDownLearnResumeInput {
  return {
    entries: cards,
    manifest,
    state: stateAfterOneCredit,
    habitKstDay,
    contentDigest,
    now,
    ...overrides,
  };
}

function expectResumed(
  result: WindDownLearnResume | null,
): asserts result is WindDownLearnResume {
  assert(result, "a valid five-card session must be resumable");
  assert.deepEqual(
    result.cards.map((card) => card.id),
    manifest.cardIds,
    "resume must use the manifest's five material IDs in manifest order",
  );
  assert.equal(result.manifest.sessionId, manifest.sessionId);
  assert.equal(result.manifest.habitKstDay, manifest.habitKstDay);
  assert.equal(result.manifest.seed, manifest.seed);
  assert.equal(result.manifest.contentDigest, manifest.contentDigest);
  assert.deepEqual(
    result.state,
    stateAfterOneCredit,
    "resume must return the validated durable state without rewriting progress",
  );
}

function expectRejected(result: WindDownLearnResume | null) {
  assert.equal(
    result,
    null,
    "an invalid or stale session must never attach its state to a new manifest",
  );
}

let resolver: WindDownLearnResumeResolver | null = null;
let resolverLoadError: unknown = null;

function callResolver(input: WindDownLearnResumeInput) {
  if (!resolver) {
    const detail = resolverLoadError instanceof Error
      ? resolverLoadError.message
      : String(resolverLoadError);
    throw new Error(
      `selectWindDownLearnResume seam unavailable (Stage 1 RED): ${detail}`,
    );
  }
  return resolver(input);
}

const routeSource = readFileSync(
  path.join(process.cwd(), "src/app/api/winddown/study/route.ts"),
  "utf8",
);
const learnClientSource = readFileSync(
  path.join(process.cwd(), "src/features/winddown/ui/WindDownLearnClient.tsx"),
  "utf8",
);

type Case = { name: string; run: () => void | Promise<void> };
async function corruptCoordinatorState(kind: "session" | "attempt") {
  const values = new Map<string, unknown>();
  type Transaction = {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
  const storage = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>) { return fn(storage); },
  };
  const state = { storage, blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn() };
  const env = { MONA_VNEXT_KV: { get: async () => null, put: async () => {} } };
  const firstState = createWindDownLearnSession({ cards: firstBootstrap.cards, seed: manifest.seed });
  const command = {
    operation: "commit-learn-attempt", manifest, cards: firstBootstrap.cards,
    attemptId: "preservation-attempt-1", action: correctAction(firstState), nowIso: now.toISOString(),
  };
  const invoke = (body: typeof command) => handleMonaVnextProfileCoordinatorRequest(state, env,
    new Request("https://winddown.internal/profile-coordinator", { method: "POST", body: JSON.stringify(body) }));
  assert.equal((await invoke(command)).status, 200);
  const key = kind === "session"
    ? `winddown-learn-session:${habitKstDay}`
    : `winddown-learn-attempt:${command.attemptId}`;
  const stored = structuredClone(values.get(key)) as { state: Record<string, unknown> };
  stored.state.queue = [];
  values.set(key, stored);
  const before = structuredClone([...values]);
  const response = await invoke(kind === "session"
    ? { ...command, attemptId: "preservation-attempt-2" }
    : command);
  assert.equal(response.status, 409, "corrupt durable state must produce a recoverable conflict");
  assert.equal((await response.json()).error, "WINDDOWN_LEARN_RESUME_UNAVAILABLE");
  assert.deepEqual([...values], before, "rejected state must remain intact for recovery");
}

function incorrectAction(state: WindDownLearnState): WindDownLearnAction {
  const exercise = state.queue[0]!;
  if (exercise.kind === "meaning-choice") {
    const wrong = exercise.choices.find((choice) => choice.id !== exercise.correctChoiceId);
    assert(wrong);
    return { type: "choose-meaning", cardId: exercise.card.id, choiceId: wrong.id };
  }
  return { type: "submit-sentence", cardId: exercise.card.id, tokenIds: [...exercise.canonicalTokenIds].reverse() };
}

function assertValidTransition(state: WindDownLearnState) {
  const resumed = callResolver(resolverInput({ state }));
  assert(resumed, "engine-generated state must remain resumable");
  assert.deepEqual(resumed.state, state, "resuming must preserve mistakes, practice and credits");
}

const cases: Case[] = [
  {
    name: "miss, practice-only interlude and completion remain resumable",
    run: () => {
      let state = createWindDownLearnSession({ cards: firstBootstrap.cards, seed: manifest.seed });
      assertValidTransition(state);
      const miss = applyWindDownLearnAction(state, incorrectAction(state));
      assert.equal(miss.outcome, "miss");
      state = miss.state;
      assertValidTransition(state);
      while (state.creditedCardIds.length < 4) {
        state = applyWindDownLearnAction(state, correctAction(state)).state;
        assertValidTransition(state);
      }
      const finalMiss = applyWindDownLearnAction(state, incorrectAction(state));
      assert.equal(finalMiss.outcome, "miss");
      state = finalMiss.state;
      assert.equal(state.queue[0]?.creditPolicy, "practice-only");
      assertValidTransition(state);
      state = applyWindDownLearnAction(state, incorrectAction(state)).state;
      assertValidTransition(state);
      for (let turn = 0; !state.isComplete && turn < 5; turn++) {
        state = applyWindDownLearnAction(state, correctAction(state)).state;
        assertValidTransition(state);
      }
      assert.equal(state.isComplete, true);
      assert(state.completion?.mistakeRecap.length);
    },
  },
  { name: "corrupt stored session blocks without rewriting records", run: () => corruptCoordinatorState("session") },
  { name: "corrupt duplicate receipt blocks without rewriting records", run: () => corruptCoordinatorState("attempt") },
  {
    name: "valid resume wins when reload has only four fresh cards",
    run: () => {
      assert.equal(reloadBootstrap.cards.length, 4);
      const result = callResolver(resolverInput());
      expectResumed(result);
    },
  },
  {
    name: "state from another seed cannot attach to the current manifest",
    run: () => {
      const otherState = createWindDownLearnSession({
        cards: firstBootstrap.cards,
        seed: "different-learn-seed",
      });
      expectRejected(callResolver(resolverInput({ state: otherState })));
    },
  },
  {
    name: "manifest card IDs must resolve to all five current material entries",
    run: () => {
      const replacement: MonaVnextExpression = {
        id: "resume-card-replacement",
        ko: "대체 문장",
        en: "This replacement is different.",
        state: "prompt",
      };
      const changedManifest = {
        ...manifest,
        cardIds: [
          ...manifest.cardIds.slice(0, 4),
          replacement.id,
        ],
      };
      expectRejected(
        callResolver(
          resolverInput({
            manifest: changedManifest,
          }),
        ),
      );
    },
  },
  {
    name: "state from a manifest with different card IDs is rejected",
    run: () => {
      const replacement: MonaVnextExpression = {
        id: "resume-card-replacement",
        ko: "대체 문장",
        en: "This replacement is different.",
        state: "prompt",
      };
      const changedManifest = {
        ...manifest,
        cardIds: [
          ...manifest.cardIds.slice(0, 4),
          replacement.id,
        ],
      };
      expectRejected(
        callResolver(
          resolverInput({
            entries: [...cards, replacement],
            manifest: changedManifest,
          }),
        ),
      );
    },
  },
  {
    name: "empty queue state is rejected",
    run: () => {
      const malformed = clone(stateAfterOneCredit);
      malformed.queue = [];
      expectRejected(callResolver(resolverInput({ state: malformed })));
    },
  },
  {
    name: "forged queue card content is rejected",
    run: () => {
      const forged = clone(stateAfterOneCredit);
      const current = forged.queue[0];
      assert(current);
      forged.queue[0] = {
        ...current,
        card: { ...current.card, en: "forged sentence" },
      };
      expectRejected(callResolver(resolverInput({ state: forged })));
    },
  },
  {
    name: "exercise map drift is rejected",
    run: () => {
      const forged = clone(stateAfterOneCredit);
      delete forged.exerciseByCardId[creditedCardId];
      expectRejected(callResolver(resolverInput({ state: forged })));
    },
  },
  {
    name: "credited ID outside the manifest is rejected",
    run: () => {
      const outside = clone(stateAfterOneCredit);
      outside.creditedCardIds = ["outside-material"];
      outside.earnedRewards = 1;
      expectRejected(callResolver(resolverInput({ state: outside })));
    },
  },
  {
    name: "duplicate credited IDs are rejected",
    run: () => {
      const duplicate = clone(stateAfterOneCredit);
      duplicate.creditedCardIds = [creditedCardId, creditedCardId];
      duplicate.earnedRewards = 2;
      expectRejected(callResolver(resolverInput({ state: duplicate })));
    },
  },
  {
    name: "inconsistent reward count is rejected",
    run: () => {
      const malformed = clone(stateAfterOneCredit);
      malformed.earnedRewards = 0;
      expectRejected(callResolver(resolverInput({ state: malformed })));
    },
  },
  {
    name: "inconsistent mistake recap is rejected",
    run: () => {
      const malformed = clone(stateAfterOneCredit);
      malformed.mistakes = [{
        card: {
          id: "outside-material",
          ko: "외부 문장",
          en: "Outside material.",
        },
        exerciseKind: "meaning-choice",
      }];
      expectRejected(callResolver(resolverInput({ state: malformed })));
    },
  },
  {
    name: "inconsistent completion cannot be resumed",
    run: () => {
      const incompleteComplete = clone(stateAfterOneCredit);
      incompleteComplete.queue = [];
      incompleteComplete.isComplete = true;
      incompleteComplete.completion = {
        creditedCardIds: [creditedCardId],
        mistakeRecap: [],
      };
      expectRejected(
        callResolver(resolverInput({ state: incompleteComplete })),
      );
    },
  },
  {
    name: "wrong habit day fails closed",
    run: () => {
      expectRejected(
        callResolver(resolverInput({ habitKstDay: "2026-09-07" })),
      );
    },
  },
  {
    name: "wrong content digest fails closed",
    run: () => {
      expectRejected(
        callResolver(resolverInput({ contentDigest: "b".repeat(64) })),
      );
    },
  },
  {
    name: "expired manifest fails closed",
    run: () => {
      expectRejected(
        callResolver(
          resolverInput({
            now: new Date(Date.parse(manifest.expiresAtIso) + 1),
          }),
        ),
      );
    },
  },
  {
    name: "invalid active state cannot attach to a new manifest",
    run: () => {
      assert.equal(
        routeSource.includes("resumeState: activeLearn?.state ?? null"),
        false,
        "the route must not return raw active state after issuing a replacement manifest",
      );
    },
  },
  {
    name: "study route resolves resume before the fresh-card count guard",
    run: () => {
      const resolverIndex = routeSource.indexOf(
        "selectWindDownLearnResume(",
      );
      const freshCountGuardIndex = routeSource.indexOf(
        "cards.length !== WINDDOWN_LEARN_CREDIT_TARGET",
      );
      assert(
        resolverIndex >= 0,
        "the study route must use the pure resume validation seam",
      );
      assert(
        freshCountGuardIndex < 0 || resolverIndex < freshCountGuardIndex,
        "the fresh-card count guard must not reject a valid active resume first",
      );
    },
  },
  {
    name: "no-material response exposes Review, Drill, and Home destinations",
    run: () => {
      const boundarySource = `${routeSource}\n${learnClientSource}`;
      assert(
        boundarySource.includes("WINDDOWN_LEARN_NO_NEW_MATERIAL"),
        "no-new-material must be a structured Learn outcome",
      );
      for (const destination of [
        'href="/winddown/review"',
        'href="/winddown/drill"',
        'href="/winddown"',
      ]) {
        assert(
          boundarySource.includes(destination),
          `no-new-material outcome must link to ${destination}`,
        );
      }
      assert(
        learnClientSource.includes("data-winddown-learn-availability"),
        "the blocked Learn surface must expose a machine-readable availability state",
      );
    },
  },
];

async function main(): Promise<void> {
  try {
    const candidate = (await import(RESOLVER_MODULE)) as ResolverModule;
    if (typeof candidate.selectWindDownLearnResume !== "function") {
      throw new Error("selectWindDownLearnResume export is missing");
    }
    resolver = candidate.selectWindDownLearnResume as WindDownLearnResumeResolver;
  } catch (error) {
    resolverLoadError = error;
  }

  const failures: string[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${testCase.name}: ${message}`);
      console.error(`FAIL ${testCase.name} - ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `winddown-learn-resume: ${failures.length}/${cases.length} independent cases failed`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      "PASS winddown-learn-resume - five-card resume survives fresh shortage and rejects stale state",
    );
  }
}

void main().catch((error) => {
  console.error(
    `FAIL winddown-learn-resume - ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
