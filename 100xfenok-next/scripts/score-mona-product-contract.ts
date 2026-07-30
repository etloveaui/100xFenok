import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createTeacherSession,
  teacherTransition,
} from "../src/features/mona-vnext/teacher/teacherMachine";
import type { CardRef, TeacherSession } from "../src/features/mona-vnext/teacher/teacherSession";
import { isMonaTeacherRuntimeActive } from "../src/features/mona-vnext/product/productPolicy";
import {
  MONA_VNEXT_ANSWER_MATCHER_GATE,
  MONA_VNEXT_APP_OWNED_NEXT_MATERIAL_GATE,
  MONA_VNEXT_STT_GARBAGE_GATE,
  isMonaVnextFeatureEnabled,
} from "../src/features/mona-vnext/featureGates";

type Result = {
  id: string;
  ok: boolean;
  detail: string;
};

const cards: CardRef[] = [
  {
    expressionId: "first",
    ko: "오늘 생각이 많았어.",
    targetEn: "I had a lot on my mind today.",
    acceptedVariants: ["I had a lot to think about today."],
    difficulty: 2,
  },
  {
    expressionId: "second",
    ko: "그래도 잘 버텼어.",
    targetEn: "Still, I handled it well.",
    acceptedVariants: [],
    difficulty: 2,
  },
];

function check(id: string, run: () => string): Result {
  try {
    return { id, ok: true, detail: run() };
  } catch (error) {
    return {
      id,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function createReadySession() {
  const created = createTeacherSession({ mode: "drill", cards, seed: "product-contract" });
  return teacherTransition(created.session, { type: "SESSION_READY" }).session;
}

function checkMainUsesTeacherRuntime() {
  const appSource = readFileSync(
    path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx"),
    "utf8",
  );
  const productShellSource = readFileSync(
    path.join(process.cwd(), "src/components/admin-live/MonaWindDown.tsx"),
    "utf8",
  );
  assert.ok(
    appSource.includes("isMonaTeacherRuntimeActive(surface)"),
    "main product does not use the shared teacher-runtime policy",
  );
  assert.ok(
    !appSource.includes('const teacherActive = surface === "debug"'),
    "main product still disables the Teacher State Machine",
  );
  assert.equal(isMonaTeacherRuntimeActive("winddown"), true);
  assert.equal(isMonaTeacherRuntimeActive("debug"), true);
  assert.equal(isMonaVnextFeatureEnabled(MONA_VNEXT_ANSWER_MATCHER_GATE, "winddown"), true);
  assert.equal(isMonaVnextFeatureEnabled(MONA_VNEXT_STT_GARBAGE_GATE, "winddown"), true);
  assert.equal(isMonaVnextFeatureEnabled(MONA_VNEXT_APP_OWNED_NEXT_MATERIAL_GATE, "winddown"), true);
  assert.ok(appSource.includes("resumeOffer={Boolean(resumeOffer)}"));
  assert.ok(appSource.includes("onResume={resumeTeacherSession}"));
  assert.ok(productShellSource.includes("이어서 하기"));
  return "main and debug surfaces share the app-owned teacher runtime";
}

function checkWaitInvariant() {
  const ready = createReadySession();
  const waiting = teacherTransition(ready, { type: "MODEL_TURN_COMPLETE" });
  const secondModelTurn = teacherTransition(waiting.session, { type: "MODEL_TURN_COMPLETE" });
  assert.equal(waiting.session.phase, "awaiting_attempt");
  assert.equal(secondModelTurn.session.card?.expressionId, "first");
  assert.equal(secondModelTurn.session.queue.cursor, 0);
  return "model completion cannot advance the learner card";
}

function checkFiveMinuteLoop() {
  let session: TeacherSession = createReadySession();
  session = teacherTransition(session, { type: "MODEL_TURN_COMPLETE" }).session;
  session = teacherTransition(session, {
    type: "LEARNER_ATTEMPT",
    text: "I had a lot on my mind today.",
  }).session;
  const evaluated = teacherTransition(session, { type: "EVAL_RESULT", verdict: "canonical" });
  assert.equal(evaluated.session.phase, "advance_pending");
  assert.equal(evaluated.session.praiseArmed, true);
  assert.equal(evaluated.session.card?.expressionId, "first");

  const next = teacherTransition(evaluated.session, { type: "LEARNER_NEXT" });
  assert.equal(next.session.card?.expressionId, "second");
  assert.equal(next.session.visibility.english, false);
  assert.ok(next.session.stateSeq > evaluated.session.stateSeq);
  return "attempt -> verdict -> reward-ready -> learner next is deterministic";
}

function checkGarbageNeverRewards() {
  let session: TeacherSession = createReadySession();
  session = teacherTransition(session, { type: "MODEL_TURN_COMPLETE" }).session;
  session = teacherTransition(session, { type: "LEARNER_ATTEMPT", text: "아" }).session;
  const evaluated = teacherTransition(session, { type: "EVAL_RESULT", verdict: "garbage" });
  assert.equal(evaluated.session.phase, "awaiting_attempt");
  assert.equal(evaluated.session.praiseArmed, false);
  assert.equal(evaluated.effects.some((effect) => effect.type === "praise"), false);
  return "unclear iPhone input stays on the card and cannot trigger praise";
}

const results = [
  check("main-teacher-runtime", checkMainUsesTeacherRuntime),
  check("wait-invariant", checkWaitInvariant),
  check("five-minute-loop", checkFiveMinuteLoop),
  check("garbage-no-reward", checkGarbageNeverRewards),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
