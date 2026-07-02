import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { evaluateMonaVnextAnswerAttempt } from "../src/features/mona-vnext/coach/answerMatcher";
import { mapAnswerMatchToTeacherVerdict } from "../src/features/mona-vnext/teacher/teacherAdapter";
import {
  createTeacherSession,
  teacherTransition,
} from "../src/features/mona-vnext/teacher/teacherMachine";
import type {
  CardRef,
  TeacherEffect,
  TeacherSessionCard,
} from "../src/features/mona-vnext/teacher/teacherSession";

type Result = {
  id: string;
  ok: boolean;
  detail: string;
};

function pass(id: string, detail: string): Result {
  return { id, ok: true, detail };
}

function fail(id: string, detail: string): Result {
  return { id, ok: false, detail };
}

const cards: TeacherSessionCard[] = [
  {
    expressionId: "rain-heavy",
    ko: "비가 많이 와.",
    targetEn: "It's raining heavily.",
    acceptedVariants: ["It's raining cats and dogs."],
    difficulty: 1,
    exposureCount: 0,
  },
  {
    expressionId: "still-raining",
    ko: "아직도 비가 와.",
    targetEn: "It's still raining.",
    acceptedVariants: [],
    difficulty: 1,
    exposureCount: 0,
  },
  {
    expressionId: "wait-second",
    ko: "잠깐만 기다려.",
    targetEn: "Wait a second.",
    acceptedVariants: [],
    difficulty: 1,
    exposureCount: 0,
  },
];

function firstEffect(effects: TeacherEffect[], type: TeacherEffect["type"]) {
  return effects.find((effect) => effect.type === type);
}

function checkModeSwitchLegality(): Result {
  try {
    let session = createTeacherSession({ mode: "drill", cards, seed: "s3-mode" }).session;
    session = teacherTransition(session, { type: "SESSION_READY" }).session;
    session = teacherTransition(session, { type: "MODEL_TURN_COMPLETE" }).session;
    const beforeCard = session.card?.expressionId;
    const switched = teacherTransition(session, { type: "LEARNER_MODE_CHANGE", mode: "free_talk" });
    const effect = firstEffect(switched.effects, "mode_changed");

    assert.equal(switched.session.mode, "free_talk");
    assert.equal(switched.session.card?.expressionId, beforeCard);
    assert.equal(switched.session.phase, "awaiting_attempt");
    assert.equal(switched.session.visibility.english, true);
    assert.equal(effect?.expectedModelAction, "set_study_mode");
    assert.equal(effect?.text, "free_talk");

    const winddownAlias = teacherTransition(switched.session, { type: "LEARNER_MODE_CHANGE", mode: "winddown" });
    assert.equal(winddownAlias.session.mode, "drill");
    assert.equal(winddownAlias.session.card?.expressionId, beforeCard);
    return pass("mode-switch-legality", "mode changes are deterministic, card-held, and winddown aliases drill");
  } catch (error) {
    return fail("mode-switch-legality", error instanceof Error ? error.message : String(error));
  }
}

function checkLiveTalkSuspendsDrillScoring(): Result {
  try {
    let session = createTeacherSession({ mode: "live_talk", cards, seed: "s3-live" }).session;
    session = teacherTransition(session, { type: "SESSION_READY" }).session;
    const attempted = teacherTransition(session, { type: "LEARNER_ATTEMPT", text: "So, is this phrase casual?" });
    const prompt = firstEffect(attempted.effects, "live_talk_prompt");

    assert.equal(attempted.session.mode, "live_talk");
    assert.equal(attempted.session.phase, "digression");
    assert.equal(attempted.session.attempt.verdict, null);
    assert.equal(prompt?.expectedModelAction, "guided_conversation");
    assert.equal(prompt?.targetEn, "It's raining heavily.");
    return pass("live-talk-scoring-suspended", "live_talk holds the card and routes learner turns as guided conversation, not miss scoring");
  } catch (error) {
    return fail("live-talk-scoring-suspended", error instanceof Error ? error.message : String(error));
  }
}

async function checkSrsMasteryBridge(): Promise<Result> {
  try {
    const mod = await import("../src/features/mona-vnext/memory/srsBridge");
    const filtered = mod.filterRecentlyMasteredCards(
      cards,
      [{ expressionId: "rain-heavy", verdict: "canonical", atIso: "2026-07-01T00:00:00.000Z", sessionId: "s2" }],
      { recentSessionIds: ["s2"], minCount: 2 },
    );
    const fallback = mod.filterRecentlyMasteredCards(
      cards,
      [{ expressionId: "rain-heavy", verdict: "canonical", atIso: "2026-07-01T00:00:00.000Z", sessionId: "s2" }],
      { recentSessionIds: ["s2"], minCount: 3 },
    );

    assert.deepEqual(filtered.map((card: CardRef) => card.expressionId), ["still-raining", "wait-second"]);
    assert.deepEqual(fallback.map((card: CardRef) => card.expressionId), ["rain-heavy", "still-raining", "wait-second"]);
    return pass("srs-mastery-bridge", "recent mastered cards are excluded unless the bank would fall below the minimum");
  } catch (error) {
    return fail("srs-mastery-bridge", error instanceof Error ? error.message : String(error));
  }
}

async function checkReviewDueQueue(): Promise<Result> {
  try {
    const mod = await import("../src/features/mona-vnext/memory/srsBridge");
    const due = mod.buildReviewDueQueue(cards, [
      { expressionId: "still-raining", box: 2, dueAtIso: "2026-07-01T00:00:00.000Z" },
      { expressionId: "rain-heavy", box: 3, dueAtIso: "2026-07-04T00:00:00.000Z" },
    ], "2026-07-02T00:00:00.000Z");
    const empty = mod.buildReviewDueQueue(cards, [
      { expressionId: "rain-heavy", box: 3, dueAtIso: "2026-07-04T00:00:00.000Z" },
    ], "2026-07-02T00:00:00.000Z");

    assert.deepEqual(due.map((card: CardRef) => card.expressionId), ["still-raining"]);
    assert.deepEqual(empty, []);
    return pass("review-due-queue", "review mode serves due items and returns an empty queue without error");
  } catch (error) {
    return fail("review-due-queue", error instanceof Error ? error.message : String(error));
  }
}

async function checkCorrectionCandidatesStayOutOfSrs(): Promise<Result> {
  try {
    const mod = await import("../src/features/mona-vnext/memory/srsBridge");
    const next = mod.applyOwnerTestMemoryPatch({
      masteryEvents: [],
      reviewRecords: [],
      correctionCandidates: [],
    }, {
      correctionCandidate: mod.buildCorrectionCandidate({
        expressionId: "free-talk",
        learnerText: "I went to there yesterday.",
        suggestion: "I went there yesterday.",
        atIso: "2026-07-02T00:00:00.000Z",
        sessionId: "owner-s3",
      }),
    });

    assert.equal(next.correctionCandidates.length, 1);
    assert.equal(next.masteryEvents.length, 0);
    assert.equal(next.reviewRecords.length, 0);
    return pass("correction-candidates-not-srs", "free_talk corrections are staged as candidates only");
  } catch (error) {
    return fail("correction-candidates-not-srs", error instanceof Error ? error.message : String(error));
  }
}

function checkVariantVerdictPath(): Result {
  try {
    const match = evaluateMonaVnextAnswerAttempt(
      "It's raining cats and dogs.",
      "It's raining heavily.",
      ["It's raining cats and dogs."],
    );
    assert.equal(match.tier, "variant");
    assert.equal(mapAnswerMatchToTeacherVerdict(match), "variant");
    assert.ok(existsSync(path.join(process.cwd(), "src/features/mona-vnext/coach/acceptedVariants.curated.json")));
    return pass("variant-verdict-path", "owner-curated acceptedVariants can produce a variant verdict");
  } catch (error) {
    return fail("variant-verdict-path", error instanceof Error ? error.message : String(error));
  }
}

function checkS3SourceGates(): Result {
  try {
    const app = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx"), "utf8");
    const shell = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/ui/WindDownVnextShell.tsx"), "utf8");
    const memory = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/memory/srsBridge.ts"), "utf8");
    const repo = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/memory/monaMemoryRepository.ts"), "utf8");
    const monaSources = [
      "src/features/mona-vnext/MonaVoiceCoachApp.tsx",
      "src/features/mona-vnext/memory/monaMemoryRepository.ts",
      "src/features/mona-vnext/memory/srsBridge.ts",
      "src/app/api/mona-vnext/session/route.ts",
    ].map((file) => readFileSync(path.join(process.cwd(), file), "utf8"));

    const mainBranchStart = app.indexOf("if (surface === \"winddown\")");
    const debugShellStart = app.indexOf("<WindDownVnextShell");
    const mainBranch = app.slice(mainBranchStart, debugShellStart);
    assert.ok(mainBranchStart > -1 && debugShellStart > mainBranchStart, "MonaVoiceCoachApp branch shape changed");
    assert.equal(mainBranch.includes("studyModeControls"), false, "main winddown branch must not expose study mode controls");
    assert.ok(app.includes("studyModeControls={studyModeControls}"), "debug branch must wire study mode controls");
    assert.ok(shell.includes("오늘의 교정"), "debug shell must list correction candidates");
    assert.ok(memory.includes("owner-test"), "SRS bridge must stay in owner-test namespace");
    assert.ok(repo.includes("productionWriteEnabled: false"));
    assert.equal(monaSources.some((source) => source.includes("productionWriteEnabled: true")), false);
    assert.equal(monaSources.some((source) => source.includes("saveStudySession")), false);
    assert.equal(monaSources.some((source) => source.includes("data/mona-english")), false);
    return pass("s3-source-gates", "debug-only mode controls, owner-test writes, and production-write gates are enforced");
  } catch (error) {
    return fail("s3-source-gates", error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  const results = [
    checkModeSwitchLegality(),
    checkLiveTalkSuspendsDrillScoring(),
    await checkSrsMasteryBridge(),
    await checkReviewDueQueue(),
    await checkCorrectionCandidatesStayOutOfSrs(),
    checkVariantVerdictPath(),
    checkS3SourceGates(),
  ];

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

void main();
