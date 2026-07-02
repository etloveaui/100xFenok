import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createTeacherSession,
  teacherTransition,
} from "../src/features/mona-vnext/teacher/teacherMachine";
import type {
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
    expressionId: "first-card",
    ko: "아직도 비가 와.",
    targetEn: "It's still raining.",
    acceptedVariants: [],
    difficulty: 1,
    exposureCount: 0,
  },
  {
    expressionId: "second-card",
    ko: "잠깐만 기다려.",
    targetEn: "Wait a second.",
    acceptedVariants: [],
    difficulty: 1,
    exposureCount: 0,
  },
];

function types(effects: TeacherEffect[]) {
  return effects.map((effect) => effect.type);
}

function checkSocketDeadResumeRestoresHeldCard(): Result {
  try {
    let session = createTeacherSession({ cards, seed: "s2" }).session;
    session = teacherTransition(session, { type: "SESSION_READY" }).session;
    session = teacherTransition(session, { type: "LEARNER_NEXT" }).session;
    const before = teacherTransition(session, { type: "MODEL_TURN_COMPLETE" }).session;
    const dead = teacherTransition(before, { type: "SOCKET_DEAD", resumeHandle: "dead-handle" });
    const resumed = teacherTransition(dead.session, { type: "RECONNECTED", resumeHandle: "new-handle" });

    assert.equal(dead.session.card?.expressionId, "second-card");
    assert.equal(dead.session.queue.cursor, 1);
    assert.equal(dead.session.lifecycle.resumePhase, before.phase);
    assert.deepEqual(types(dead.effects), ["offer_resume"]);
    assert.equal(resumed.session.card?.expressionId, "second-card");
    assert.equal(resumed.session.queue.cursor, 1);
    assert.equal(resumed.session.phase, before.phase);
    assert.equal(resumed.session.lifecycle.resumePhase, null);
    assert.ok(resumed.session.stateSeq > before.stateSeq);
    assert.deepEqual(types(resumed.effects), ["resume_state"]);
    return pass("socket-dead-resume-restores-held-card", "SOCKET_DEAD offers resume; RECONNECTED restores same card/cursor/phase");
  } catch (error) {
    return fail("socket-dead-resume-restores-held-card", error instanceof Error ? error.message : String(error));
  }
}

function checkGoAwayQuestionContinuity(): Result {
  try {
    let session = createTeacherSession({ cards, seed: "s2-question" }).session;
    session = teacherTransition(session, { type: "SESSION_READY" }).session;
    session = teacherTransition(session, { type: "MODEL_TURN_COMPLETE" }).session;
    session = teacherTransition(session, { type: "LEARNER_QUESTION", text: "맞냐고?" }).session;
    const beforeSeq = session.stateSeq;
    const goAway = teacherTransition(session, { type: "GO_AWAY", resumeHandle: "go-away-handle" });
    const reconnected = teacherTransition(goAway.session, { type: "RECONNECTED", resumeHandle: "fresh-handle" });

    assert.equal(goAway.session.card?.expressionId, "first-card");
    assert.equal(goAway.session.phase, "digression");
    assert.equal(goAway.session.lifecycle.goAwayCount, 1);
    assert.ok(goAway.session.stateSeq > beforeSeq);
    assert.deepEqual(types(goAway.effects), ["resume_state"]);
    assert.deepEqual(types(reconnected.effects), ["answer_question", "resume_state"]);
    assert.equal(reconnected.effects[0]?.text, "맞냐고?");
    assert.equal(reconnected.session.card?.expressionId, "first-card");
    assert.equal(reconnected.session.queue.cursor, 0);
    return pass("go-away-question-continuity", "reconnect acknowledges in-flight question before re-anchoring held card");
  } catch (error) {
    return fail("go-away-question-continuity", error instanceof Error ? error.message : String(error));
  }
}

function checkS2SourceWiring(): Result {
  try {
    const app = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx"), "utf8");
    const live = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/live/useGeminiLiveSession.ts"), "utf8");
    const route = readFileSync(path.join(process.cwd(), "src/app/api/mona-vnext/session/route.ts"), "utf8");
    const writer = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/logging/voiceLogWriter.ts"), "utf8");
    const shell = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/ui/WindDownVnextShell.tsx"), "utf8");

    for (const needle of [
      "resumeOffer",
      "resumeTeacherSession",
      "SOCKET_DEAD",
      "GO_AWAY",
      "RECONNECTED",
      "resumedFromConversationId",
      "micDead",
    ]) {
      assert.ok(app.includes(needle), `MonaVoiceCoachApp missing ${needle}`);
    }
    for (const needle of [
      "token_mint_ms",
      "ws_connect_ms",
      "setup_complete_ms",
      "first_model_audio_ms",
      "resume-prewarm",
      "mic-dead",
    ]) {
      assert.ok(live.includes(needle), `useGeminiLiveSession missing ${needle}`);
    }
    assert.ok(live.includes("enableResumePrewarm?: boolean"), "useGeminiLiveSession missing explicit resume prewarm gate option");
    assert.ok(live.includes("enableResumePrewarm = false"), "resume prewarm gate must default off for main /winddown");
    assert.match(live, /if\s*\(\s*enableResumePrewarm\s*\)\s*{\s*prewarmResumeSession\("go-away"\);/s, "go-away prewarm must be gated by enableResumePrewarm");
    assert.ok(app.includes("const teacherActive = surface === \"debug\""), "teacherActive must stay staging/debug scoped");
    assert.ok(app.includes("enableResumePrewarm: teacherActive"), "only the staging/TSM path may enable resume prewarm");
    assert.ok(app.includes("onSessionResumed"), "MonaVoiceCoachApp missing dedicated prewarmed resume restore callback");
    assert.ok(live.includes("onSessionResumed?.(prewarmedSession)"), "prewarmed resume must call onSessionResumed, not raw onSessionReady");
    assert.ok(!live.includes("onSessionReady?.(prewarmedSession)"), "prewarmed resume must not refire onSessionReady lesson reset");
    assert.match(live, /const setup = prewarmedSession\s*\?\s*liveSession\.setup\s*:\s*buildResumeSetup\(liveSession\.setup,\s*handle\);/s, "prewarmed fresh-start setup must not reuse the old resumption handle");
    assert.match(live, /openSocket\(liveSession,\s*setup,\s*{\s*reconnect:\s*true,\s*prewarmedFreshStart:\s*Boolean\(prewarmedSession\),?\s*}\);/s, "resume socket must mark prewarmed fresh-start reconnects");
    assert.ok(route.includes("resumedFromConversationId"));
    assert.ok(writer.includes("resumedFromConversationId"));
    assert.ok(shell.includes("onResume"));
    return pass("s2-source-wiring", "resume UI, lifecycle events, telemetry, mic-dead, and log linkage are wired");
  } catch (error) {
    return fail("s2-source-wiring", error instanceof Error ? error.message : String(error));
  }
}

const results = [
  checkSocketDeadResumeRestoresHeldCard(),
  checkGoAwayQuestionContinuity(),
  checkS2SourceWiring(),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
