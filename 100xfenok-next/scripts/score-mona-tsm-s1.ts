import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MONA_VNEXT_SESSION_EXPRESSION_COUNT,
} from "../src/features/mona-vnext/server/expressionBank";
import {
  buildTeacherFilteredMonaVnextSessionExpressionBank,
} from "../src/features/mona-vnext/server/teacherMaterialBank";
import { serializeTeacherEffectForLive } from "../src/features/mona-vnext/teacher/effectEmitter";
import { validateTeacherMaterial } from "../src/features/mona-vnext/teacher/materialGate";
import {
  mapAnswerMatchToTeacherVerdict,
  monaExpressionToTeacherCard,
  teacherSessionToLessonState,
} from "../src/features/mona-vnext/teacher/teacherAdapter";
import {
  shouldFlagTeacherModelDrift,
} from "../src/features/mona-vnext/teacher/teacherDriftGuard";
import {
  scoreMonaTsmSessionGates,
  type MonaTsmScoredSessionLog,
} from "../src/features/mona-vnext/teacher/teacherSessionScorer";
import {
  createTeacherSession,
  teacherTransition,
} from "../src/features/mona-vnext/teacher/teacherMachine";
import type { TeacherEffect, TeacherSessionCard } from "../src/features/mona-vnext/teacher/teacherSession";

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
    expressionId: "hope-that-makes-sense",
    ko: "내 말이 좀 말이 됐으면 좋겠어.",
    targetEn: "I hope that makes sense.",
    acceptedVariants: [],
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
];

function firstEffect(effects: TeacherEffect[], type: TeacherEffect["type"]) {
  return effects.find((effect) => effect.type === type);
}

function checkAdvancePendingPolicy(): Result {
  try {
    let session = createTeacherSession({ cards, seed: "s1" }).session;
    session = teacherTransition(session, { type: "SESSION_READY" }).session;
    session = teacherTransition(session, { type: "MODEL_TURN_COMPLETE" }).session;
    session = teacherTransition(session, { type: "LEARNER_ATTEMPT", text: "I hope that makes sense." }).session;
    const canonical = teacherTransition(session, { type: "EVAL_RESULT", verdict: "canonical" });
    const praise = firstEffect(canonical.effects, "praise");
    assert.equal(canonical.session.phase, "advance_pending");
    assert.equal(canonical.session.card?.expressionId, "hope-that-makes-sense");
    assert.equal(praise?.expectedModelAction, "praise_attempt");
    assert.match(serializeTeacherEffectForLive(praise as TeacherEffect), /다음 갈까/);

    const next = teacherTransition(canonical.session, { type: "LEARNER_NEXT" });
    assert.equal(next.session.phase, "presenting");
    assert.equal(next.session.card?.expressionId, "still-raining");
    assert.equal(firstEffect(next.effects, "present_card")?.expressionId, "still-raining");
    return pass("advance-pending-policy", "canonical arms praise and asks next; LEARNER_NEXT presents next card");
  } catch (error) {
    return fail("advance-pending-policy", error instanceof Error ? error.message : String(error));
  }
}

function checkAdapterAndCloseVerdict(): Result {
  try {
    const card = monaExpressionToTeacherCard({
      id: "mona-life-02bfaede05df",
      ko: "옷에 뭐가 묻었어.",
      en: "You have something on your shirt.",
      state: "prompt",
    });
    assert.deepEqual(card, {
      expressionId: "mona-life-02bfaede05df",
      ko: "옷에 뭐가 묻었어.",
      targetEn: "You have something on your shirt.",
      acceptedVariants: [],
      difficulty: 1,
      exposureCount: 0,
    });
    assert.equal(mapAnswerMatchToTeacherVerdict({ tier: "close" }), "close");

    let session = createTeacherSession({ cards: [card], seed: "s1-adapter" }).session;
    session = teacherTransition(session, { type: "SESSION_READY" }).session;
    const lesson = teacherSessionToLessonState(session, [{ id: card.expressionId, ko: card.ko, en: card.targetEn, state: "prompt" }]);
    assert.equal(lesson.expression.id, card.expressionId);
    assert.equal(lesson.expression.en, card.targetEn);
    assert.equal(lesson.englishVisible, false);

    session = teacherTransition(session, { type: "LEARNER_ATTEMPT", text: "Something's on your shirt." }).session;
    const close = teacherTransition(session, { type: "EVAL_RESULT", verdict: "close" });
    const coaching = firstEffect(close.effects, "coach_close_attempt");
    assert.equal(close.session.praiseArmed, true);
    assert.match(serializeTeacherEffectForLive(coaching as TeacherEffect), /그 말도 통해/);
    return pass("adapter-close-verdict", "expression adapter is deterministic and close verdict acknowledges before canonical");
  } catch (error) {
    return fail("adapter-close-verdict", error instanceof Error ? error.message : String(error));
  }
}

function checkDriftGuard(): Result {
  try {
    const effect: TeacherEffect = {
      type: "reveal_target",
      stateSeq: 3,
      expressionId: "hope-that-makes-sense",
      expectedModelAction: "reveal_target",
      targetEn: "I hope that makes sense.",
    };
    assert.equal(shouldFlagTeacherModelDrift(effect, "I hope that makes sense!"), false);
    assert.equal(shouldFlagTeacherModelDrift(effect, "I hope that sense."), true);
    assert.equal(shouldFlagTeacherModelDrift({ ...effect, expectedModelAction: "wait_for_attempt" }, "I hope that sense."), false);
    return pass("drift-guard", "target-moment output mismatch is flagged and non-target effects are ignored");
  } catch (error) {
    return fail("drift-guard", error instanceof Error ? error.message : String(error));
  }
}

function checkSessionGateScorer(): Result {
  const oldLog: MonaTsmScoredSessionLog = {
    cardsServed: [
      { expressionId: "malformed", ko: "우리 어떻게 지내세요?", targetEn: "How are you?", difficulty: 1 },
    ],
    events: [
      { type: "manual-next", expressionId: "hope-that-makes-sense", nextExpressionId: "hope-that-makes-sense" },
      { type: "teacher_effect", effectType: "praise", expressionId: "hope-that-makes-sense", praiseArmed: false },
      { type: "coach_line", expressionId: "hope-that-makes-sense", text: "좋아, 다시 해보자." },
      { type: "coach_line", expressionId: "hope-that-makes-sense", text: "좋아, 다시 해보자." },
      { type: "coach_line", expressionId: "hope-that-makes-sense", text: "좋아, 다시 해보자." },
      { type: "model_drift", expressionId: "hope-that-makes-sense", flagged: false },
    ],
  };
  const newLog: MonaTsmScoredSessionLog = {
    cardsServed: [
      { expressionId: "hope-that-makes-sense", ko: "내 말이 좀 말이 됐으면 좋겠어.", targetEn: "I hope that makes sense.", difficulty: 1 },
    ],
    events: [
      { type: "manual-next", expressionId: "hope-that-makes-sense", nextExpressionId: "still-raining" },
      { type: "teacher_effect", effectType: "present_card", expressionId: "still-raining", priorTrigger: "LEARNER_NEXT" },
      { type: "teacher_effect", effectType: "reveal_target", expressionId: "still-raining", priorTrigger: "LEARNER_REVEAL", effectOffset: 0 },
      { type: "teacher_effect", effectType: "praise", expressionId: "still-raining", praiseArmed: true },
      { type: "model_drift", expressionId: "still-raining", flagged: true },
      { type: "coach_line", expressionId: "still-raining", text: "짧게 한 번만 다시 해보자." },
    ],
  };
  const warningOnlyLog: MonaTsmScoredSessionLog = {
    cardsServed: [
      { expressionId: "semantic-warning", ko: "이해가 됐으면 좋겠네요.", targetEn: "Hope that makes sense.", difficulty: 1 },
    ],
    events: [],
  };

  try {
    const oldScore = scoreMonaTsmSessionGates(oldLog);
    const newScore = scoreMonaTsmSessionGates(newLog);
    const warningScore = scoreMonaTsmSessionGates(warningOnlyLog);
    assert.equal(oldScore.ok, false);
    assert.ok(oldScore.results.some((result) => result.gate === "G1" && !result.ok));
    assert.ok(oldScore.results.some((result) => result.gate === "G5" && !result.ok));
    assert.ok(oldScore.results.some((result) => result.gate === "G7" && !result.ok));
    assert.ok(oldScore.results.some((result) => result.gate === "G10" && !result.ok));
    assert.equal(newScore.ok, true);
    assert.ok(warningScore.results.some((result) => result.gate === "G10" && result.ok && result.detail === "quarantine=0"));
    return pass("session-gate-scorer", "old-style failure log is red; warning-only material stays green for G10");
  } catch (error) {
    return fail("session-gate-scorer", error instanceof Error ? error.message : String(error));
  }
}

function checkMaterialWarningPolicy(): Result {
  try {
    const result = validateTeacherMaterial([
      {
        expressionId: "semantic-warning",
        ko: "이해가 됐으면 좋겠네요.",
        targetEn: "Hope that makes sense.",
        acceptedVariants: [],
        difficulty: 1,
        exposureCount: 0,
        grounded: true,
        verifiedInSource: true,
        tried: [],
      },
    ]);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.quarantine.length, 0);
    assert.ok(result.warnings.some((entry) => (
      entry.expressionId === "semantic-warning"
        && entry.reasons.some((reason) => reason.startsWith("semantic_"))
    )));
    return pass("material-warning-policy", "semantic parity heuristic is metadata warning, not quarantine");
  } catch (error) {
    return fail("material-warning-policy", error instanceof Error ? error.message : String(error));
  }
}

function checkFilteredBankFullSize(): Result {
  try {
    const bank = buildTeacherFilteredMonaVnextSessionExpressionBank({ seed: "s1-filtered-bank" });
    assert.equal(bank.entries.length, MONA_VNEXT_SESSION_EXPRESSION_COUNT);
    assert.ok((bank.metadata.materialQuarantine?.length ?? 0) > 0);
    assert.ok((bank.metadata.materialWarnings?.length ?? 0) > 0);
    return pass("filtered-bank-full-size", "teacher material filtering happens before sampling and still serves a full bank");
  } catch (error) {
    return fail("filtered-bank-full-size", error instanceof Error ? error.message : String(error));
  }
}

function checkSourceWiring(): Result {
  try {
    const appSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx"), "utf8");
    const routeSource = readFileSync(path.join(process.cwd(), "src/app/api/mona-vnext/session/route.ts"), "utf8");
    assert.equal(appSource.includes("@/components/admin-live/AdminLiveBench"), false);
    assert.equal(appSource.includes("onSendStart={() => live.sendText"), false);
    assert.equal(appSource.includes("teacherTransition"), true);
    assert.equal(appSource.includes("buildTeacherRealtimeTextInput"), true);
    assert.equal(routeSource.includes("buildTeacherFilteredMonaVnextSessionExpressionBank"), true);
    assert.equal(routeSource.includes("materialQuarantine"), true);
    return pass("source-wiring", "debug surface imports teacher wiring and route pre-filters material gate");
  } catch (error) {
    return fail("source-wiring", error instanceof Error ? error.message : String(error));
  }
}

const results = [
  checkAdvancePendingPolicy(),
  checkAdapterAndCloseVerdict(),
  checkDriftGuard(),
  checkSessionGateScorer(),
  checkMaterialWarningPolicy(),
  checkFilteredBankFullSize(),
  checkSourceWiring(),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
