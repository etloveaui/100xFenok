import { readFileSync } from "node:fs";
import path from "node:path";
import { buildMonaVnextLiveSetup } from "../src/features/mona-vnext/server/liveSetup";
import {
  MONA_VNEXT_MAX_SAME_PROMPT,
  createInitialLessonState,
  recordPromptExposure,
} from "../src/features/mona-vnext/coach/coachPolicy";
import { applyMonaVnextLessonEvaluation } from "../src/features/mona-vnext/coach/lessonFlow";
import { evaluateMonaVnextTurn } from "../src/features/mona-vnext/coach/postTurnEvaluator";
import { containsMonaVnextControlLeakage, scrubLearnerFacingText } from "../src/features/mona-vnext/logging/voiceLogSchema";
import { MONA_VNEXT_NAMESPACE_POLICY } from "../src/features/mona-vnext/memory/monaVnextNamespace";
import {
  applyMonaVnextServerContent,
  createMonaVnextTranscriptState,
} from "../src/features/mona-vnext/transcript/transcriptStore";
import { createMonaVnextConversationId } from "../src/features/mona-vnext/transcript/turnBoundary";

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

function checkSetupShape(): Result {
  const setup = buildMonaVnextLiveSetup({
    voiceName: "Kore",
    vadPreset: "relaxed",
    lowVoice: true,
    interruptionMode: "no-interrupt",
    englishVisible: true,
  });
  const raw = JSON.stringify(setup);
  const ok = raw.includes("\"responseModalities\":[\"AUDIO\"]")
    && raw.includes("\"NO_INTERRUPTION\"")
    && raw.includes("\"inputAudioTranscription\"")
    && raw.includes("\"outputAudioTranscription\"")
    && raw.includes("coachTurn") === false
    && !("tools" in setup);
  return ok
    ? pass("setup-shape", "AUDIO/no-interrupt/no tools/no coachTurn")
    : fail("setup-shape", "setup payload includes forbidden or missing fields");
}

function checkTranscriptCollapse(): Result {
  const conversationId = createMonaVnextConversationId(new Date("2026-06-15T00:00:00Z"));
  let state = createMonaVnextTranscriptState(conversationId);
  state = applyMonaVnextServerContent(state, {
    inputTranscription: { text: "다음" },
  }, "2026-06-15T00:00:01.000Z").state;
  const result = applyMonaVnextServerContent(state, {
    inputTranscription: { text: "다음 문장 넘어가" },
    outputTranscription: { text: "좋아, 새 문장으로 갈게." },
    turnComplete: true,
  }, "2026-06-15T00:00:02.000Z");
  const turn = result.finalizedTurn;
  const ok = result.state.turns.length === 1
    && turn?.turnSeq === 1
    && turn.userText === "다음 문장 넘어가"
    && turn.intent === "next_material";
  return ok
    ? pass("transcript-collapse", "cumulative input collapsed to one final user utterance")
    : fail("transcript-collapse", JSON.stringify(result.state.turns));
}

function checkNextIntent(): Result {
  const lesson = createInitialLessonState();
  const turn = {
    conversationId: "c",
    turnSeq: 1,
    userText: "다음 문장 넘어가",
    modelText: "좋아.",
    intent: "next_material" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-15T00:00:00.000Z",
    completedAtIso: "2026-06-15T00:00:01.000Z",
  };
  const evaluation = evaluateMonaVnextTurn(turn, lesson);
  const next = applyMonaVnextLessonEvaluation(lesson, evaluation);
  const ok = evaluation.shouldAdvancePrompt && next.expression.id !== lesson.expression.id;
  return ok
    ? pass("next-intent", `${lesson.expression.id} -> ${next.expression.id}`)
    : fail("next-intent", "next/new intent did not advance material");
}

function checkEnglishVisibilityIntent(): Result {
  const lesson = createInitialLessonState();
  const hidden = { ...lesson, englishVisible: false };
  const turn = {
    conversationId: "c",
    turnSeq: 1,
    userText: "영어 왜 밑에 안 보여줘",
    modelText: "보이게 할게.",
    intent: "english_visibility" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-15T00:00:00.000Z",
    completedAtIso: "2026-06-15T00:00:01.000Z",
  };
  const evaluation = evaluateMonaVnextTurn(turn, hidden);
  const next = applyMonaVnextLessonEvaluation(hidden, evaluation);
  return next.englishVisible && next.expression.state === "reveal"
    ? pass("english-display-contract", "English visibility request reveals the English card")
    : fail("english-display-contract", "English visibility request was not treated as UI/control intent");
}

function checkRepeatLimit(): Result {
  let lesson = createInitialLessonState();
  lesson = recordPromptExposure(lesson, lesson.expression);
  lesson = recordPromptExposure(lesson, lesson.expression);
  const turn = {
    conversationId: "c",
    turnSeq: 3,
    userText: "잘 모르겠어",
    modelText: "다시 해보자.",
    intent: "lesson_attempt" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-15T00:00:00.000Z",
    completedAtIso: "2026-06-15T00:00:01.000Z",
  };
  const evaluation = evaluateMonaVnextTurn(turn, lesson);
  const next = applyMonaVnextLessonEvaluation(lesson, evaluation);
  const ok = evaluation.samePromptCount >= MONA_VNEXT_MAX_SAME_PROMPT && next.expression.id !== lesson.expression.id;
  return ok
    ? pass("repeat-limit", `samePromptCount=${evaluation.samePromptCount}`)
    : fail("repeat-limit", "same prompt limit did not force prompt advance");
}

function checkControlLeakage(): Result {
  const unsafe = "RAW serverContent coachTurn arg keep state=prompt";
  const ok = containsMonaVnextControlLeakage(unsafe) && scrubLearnerFacingText(unsafe) === null;
  return ok
    ? pass("control-log-leakage", "control/debug text scrubbed from learner-facing transcript")
    : fail("control-log-leakage", "unsafe control/debug text was not blocked");
}

function checkRepairIntent(): Result {
  const lesson = createInitialLessonState();
  const turn = {
    conversationId: "c",
    turnSeq: 1,
    userText: "왜 계속 반복해 짜증나",
    modelText: "미안, 새 걸로 바꿀게.",
    intent: "repair" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-15T00:00:00.000Z",
    completedAtIso: "2026-06-15T00:00:01.000Z",
  };
  const evaluation = evaluateMonaVnextTurn(turn, lesson);
  const next = applyMonaVnextLessonEvaluation(lesson, evaluation);
  return evaluation.repairRequested && next.expression.id !== lesson.expression.id
    ? pass("repair-intent", "frustration/profanity repair switches material")
    : fail("repair-intent", "repair/frustration was not handled as control intent");
}

function checkInterruptionFlushSource(): Result {
  const source = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/live/useGeminiLiveSession.ts"), "utf8");
  const ok = source.includes("serverContent.interrupted")
    && source.includes("audioOutput.flush()")
    && source.includes("dropAudioUntilTurnCompleteRef.current = true");
  return ok
    ? pass("interruption-flush", "interrupted serverContent flushes queued playback")
    : fail("interruption-flush", "interruption flush source guard missing");
}

function checkNamespace(): Result {
  const ok = MONA_VNEXT_NAMESPACE_POLICY.productionWriteEnabled === false
    && MONA_VNEXT_NAMESPACE_POLICY.logRoot.includes("voice-logs-vnext")
    && MONA_VNEXT_NAMESPACE_POLICY.dataRoot.includes("mona-vnext");
  return ok
    ? pass("namespace-separation", "voice-logs-vnext + mona-vnext owner namespace")
    : fail("namespace-separation", JSON.stringify(MONA_VNEXT_NAMESPACE_POLICY));
}

const results = [
  checkSetupShape(),
  checkTranscriptCollapse(),
  checkNextIntent(),
  checkEnglishVisibilityIntent(),
  checkRepeatLimit(),
  checkControlLeakage(),
  checkRepairIntent(),
  checkInterruptionFlushSource(),
  checkNamespace(),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
