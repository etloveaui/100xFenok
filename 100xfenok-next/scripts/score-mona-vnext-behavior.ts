import { readFileSync } from "node:fs";
import path from "node:path";
import { buildMonaVnextLiveSetup } from "../src/features/mona-vnext/server/liveSetup";
import {
  MONA_VNEXT_SESSION_EXPRESSION_COUNT,
  buildMonaVnextSessionBankSeed,
  buildMonaVnextSessionExpressionBank,
} from "../src/features/mona-vnext/server/expressionBank";
import { MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE } from "../src/features/mona-vnext/live/generationOptions";
import {
  MONA_VNEXT_EXPRESSION_BANK,
  MONA_VNEXT_MAX_SAME_PROMPT,
  createInitialLessonState,
  recordPromptExposure,
} from "../src/features/mona-vnext/coach/coachPolicy";
import { evaluateMonaVnextAnswerAttempt } from "../src/features/mona-vnext/coach/answerMatcher";
import { applyMonaVnextLessonEvaluation } from "../src/features/mona-vnext/coach/lessonFlow";
import { evaluateMonaVnextTurn } from "../src/features/mona-vnext/coach/postTurnEvaluator";
import { containsMonaVnextControlLeakage, scrubLearnerFacingText } from "../src/features/mona-vnext/logging/voiceLogSchema";
import { MONA_VNEXT_NAMESPACE_POLICY } from "../src/features/mona-vnext/memory/monaVnextNamespace";
import { buildMonaVnextSrsAdvisory } from "../src/features/mona-vnext/memory/srsAdvisory";
import {
  applyMonaVnextServerContent,
  createMonaVnextTranscriptState,
  finalizePendingMonaVnextTurn,
} from "../src/features/mona-vnext/transcript/transcriptStore";
import { createMonaVnextConversationId } from "../src/features/mona-vnext/transcript/turnBoundary";
import {
  detectMonaVnextIntent,
  hasStrictMonaVnextStopIntent,
} from "../src/features/mona-vnext/transcript/intentHints";
import {
  createInitialPersistenceState,
  reducePersistence,
} from "../src/features/mona-vnext/logging/persistenceState";
import {
  MONA_VNEXT_ANSWER_MATCHER_GATE,
  MONA_VNEXT_APP_OWNED_NEXT_MATERIAL_GATE,
  MONA_VNEXT_AUTO_ADVANCE_ON_CANONICAL_GATE,
  MONA_VNEXT_STT_GARBAGE_GATE,
  createMonaVnextFeatureGateEvaluator,
  isMonaVnextFeatureEnabled,
  listActiveExperimentalFeatures,
} from "../src/features/mona-vnext/featureGates";

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
    activeExpressionId: "hope-that-makes-sense",
  });
  const raw = JSON.stringify(setup);
  const ok = raw.includes("\"responseModalities\":[\"AUDIO\"]")
    && raw.includes("gemini-3.1-flash-live-preview")
    && raw.includes(`"temperature":${MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE}`)
    && raw.includes("\"thinkingLevel\":\"low\"")
    && raw.includes("\"NO_INTERRUPTION\"")
    && raw.includes("\"inputAudioTranscription\"")
    && raw.includes("\"outputAudioTranscription\"")
    && raw.includes("Active Korean prompt")
    && raw.includes("내 말이 좀 말이 됐으면 좋겠어.")
    && raw.includes("I hope that makes sense.")
    && raw.includes(`Prepared expression count for direct meta questions: ${MONA_VNEXT_EXPRESSION_BANK.length}.`)
    && raw.includes("Only switch material when Mona clearly says")
    && raw.includes("teacher-friend mode")
    && raw.includes("do not auto-advance")
    && raw.includes("coachTurn") === false
    && !("tools" in setup);
  return ok
    ? pass("setup-shape", "AUDIO/default-temp/no-interrupt/active-expression/no tools/no coachTurn")
    : fail("setup-shape", "setup payload includes forbidden or missing fields");
}

function checkTemperatureOverride(): Result {
  const setup = buildMonaVnextLiveSetup({
    model: "gemini-3.1-flash-live-preview",
    voiceName: "Kore",
    vadPreset: "relaxed",
    lowVoice: true,
    interruptionMode: "no-interrupt",
    englishVisible: true,
    temperature: 0.55,
  });
  const raw = JSON.stringify(setup);
  const ok = raw.includes("\"temperature\":0.55");
  return ok
    ? pass("temperature-override", "0.55 remains available only as an explicit A/B override")
    : fail("temperature-override", "temperature override was not reflected in setup");
}

function checkDynamicExpressionBank(): Result {
  const seed = buildMonaVnextSessionBankSeed({
    startedAt: new Date("2026-06-18T00:00:00.000Z"),
    conversationId: "mona-vnext-test",
  });
  const bank = buildMonaVnextSessionExpressionBank({ seed });
  const sameBank = buildMonaVnextSessionExpressionBank({ seed });
  const otherBank = buildMonaVnextSessionExpressionBank({ seed: `${seed}:other` });
  const ids = bank.entries.map((entry) => entry.id);
  const sameIds = sameBank.entries.map((entry) => entry.id);
  const otherIds = otherBank.entries.map((entry) => entry.id);
  const selected = new Set(ids);
  const fallbackIds = new Set(MONA_VNEXT_EXPRESSION_BANK.map((entry) => entry.id));
  const lesson = createInitialLessonState({
    expressionBank: bank.entries,
    activeExpressionId: bank.entries[0]?.id,
  });
  const next = applyMonaVnextLessonEvaluation(lesson, evaluateMonaVnextTurn({
    conversationId: "c",
    turnSeq: 1,
    userText: "다음 문장 넘어가",
    modelText: "좋아.",
    intent: "next_material",
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-18T00:00:00.000Z",
    completedAtIso: "2026-06-18T00:00:01.000Z",
  }, lesson));
  const setup = buildMonaVnextLiveSetup({
    voiceName: "Kore",
    vadPreset: "relaxed",
    lowVoice: true,
    interruptionMode: "no-interrupt",
    englishVisible: true,
    activeExpressionId: lesson.expression.id,
    expressionBank: bank.entries,
  });
  const setupRaw = JSON.stringify(setup);
  const routeSource = readFileSync(path.join(process.cwd(), "src/app/api/mona-vnext/session/route.ts"), "utf8");
  const appSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx"), "utf8");
  const protocolSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/live/liveProtocol.ts"), "utf8");
  const ok = ids.length === MONA_VNEXT_SESSION_EXPRESSION_COUNT
    && selected.size === ids.length
    && sameIds.join("|") === ids.join("|")
    && otherIds.join("|") !== ids.join("|")
    && bank.metadata.seed === seed
    && bank.metadata.selectedCount === MONA_VNEXT_SESSION_EXPRESSION_COUNT
    && bank.metadata.eligibleEntryCount > MONA_VNEXT_SESSION_EXPRESSION_COUNT
    && ids.some((id) => !fallbackIds.has(id))
    && lesson.expressionBank.length === MONA_VNEXT_SESSION_EXPRESSION_COUNT
    && selected.has(next.expression.id)
    && setupRaw.includes(`Prepared expression count for direct meta questions: ${MONA_VNEXT_SESSION_EXPRESSION_COUNT}.`)
    && setupRaw.includes(lesson.expression.ko)
    && routeSource.includes("buildMonaVnextSessionExpressionBank")
    && routeSource.includes("expressionBank,")
    && appSource.includes("session.expressionBank.entries")
    && appSource.includes("selectedExpressionIds")
    && protocolSource.includes("expressionBank: MonaVnextSessionExpressionBank");
  return ok
    ? pass("dynamic-expression-bank", `${bank.metadata.eligibleEntryCount} eligible -> ${ids.length} deterministic session expressions`)
    : fail("dynamic-expression-bank", JSON.stringify({
      ids: ids.length,
      unique: selected.size,
      seed: bank.metadata.seed,
      first: bank.entries[0],
      next: next.expression,
    }));
}

function checkModelAllowlist(): Result {
  const setup = buildMonaVnextLiveSetup({
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    voiceName: "Kore",
    vadPreset: "relaxed",
    lowVoice: true,
    interruptionMode: "no-interrupt",
    englishVisible: true,
  });
  const raw = JSON.stringify(setup);
  const ok = !raw.includes("gemini-2.5-flash-native-audio-preview-12-2025")
    && raw.includes("gemini-3.1-flash-live-preview")
    && raw.includes("\"thinkingLevel\":\"low\"")
    && raw.includes("\"inputAudioTranscription\"")
    && raw.includes("\"outputAudioTranscription\"");
  return ok
    ? pass("model-allowlist", "2.5 native audio is removed and normalized to 3.1 live")
    : fail("model-allowlist", "2.5 native audio is still accepted by setup");
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

function checkChunkedTranscriptMerge(): Result {
  const conversationId = createMonaVnextConversationId(new Date("2026-06-17T00:00:00Z"));
  let state = createMonaVnextTranscriptState(conversationId);
  const inputChunks = ["아", ",", "준", "비", "된", "문", "장", "말", "해", "봐."];
  for (const chunk of inputChunks) {
    state = applyMonaVnextServerContent(state, {
      inputTranscription: { text: chunk },
    }).state;
  }
  for (const chunk of ["알겠어. 다시", "천천히", "해보자.", "\"I had", "a good", "day.\""]) {
    state = applyMonaVnextServerContent(state, {
      outputTranscription: { text: chunk },
    }).state;
  }
  const result = applyMonaVnextServerContent(state, {
    turnComplete: true,
  }, "2026-06-17T00:00:02.000Z");
  const turn = result.finalizedTurn;
  const compactUser = turn?.userText?.replace(/\s+/g, "") ?? "";
  const ok = compactUser.includes("준비된문장말해봐")
    && turn?.modelText?.includes("I had a good day.");
  return ok
    ? pass("chunked-transcript-merge", "chunked transcript pieces are accumulated before turnComplete")
    : fail("chunked-transcript-merge", JSON.stringify(turn));
}

function checkCumulativeTranscriptMerge(): Result {
  const conversationId = createMonaVnextConversationId(new Date("2026-06-17T00:00:00Z"));
  let state = createMonaVnextTranscriptState(conversationId);
  state = applyMonaVnextServerContent(state, {
    inputTranscription: { text: "쉬운 문장" },
  }).state;
  const result = applyMonaVnextServerContent(state, {
    inputTranscription: { text: "쉬운 문장 하지 말고 좀 난이도 있는 문장으로 말해." },
    turnComplete: true,
  }, "2026-06-17T00:00:02.000Z");
  const turn = result.finalizedTurn;
  const ok = turn?.userText === "쉬운 문장 하지 말고 좀 난이도 있는 문장으로 말해.";
  return ok
    ? pass("cumulative-transcript-merge", "3.x-style cumulative transcript replaces the shorter partial")
    : fail("cumulative-transcript-merge", JSON.stringify(turn));
}

function checkFinalPendingFlush(): Result {
  const conversationId = createMonaVnextConversationId(new Date("2026-06-18T00:00:00Z"));
  const pending = applyMonaVnextServerContent(createMonaVnextTranscriptState(conversationId), {
    inputTranscription: { text: "지금 영어 문장들이 우리가 준비했던 것들이 맞는지 확인해" },
  }, "2026-06-18T00:00:01.000Z").state;
  const flushed = finalizePendingMonaVnextTurn(pending, "2026-06-18T00:00:02.000Z");
  const secondFlush = finalizePendingMonaVnextTurn(flushed.state, "2026-06-18T00:00:03.000Z");
  const ok = flushed.finalizedTurn?.intent === "meta_question"
    && flushed.finalizedTurn.userText?.includes("준비했던")
    && flushed.state.turns.length === 1
    && secondFlush.finalizedTurn === null
    && secondFlush.state.turns.length === 1;
  return ok
    ? pass("final-pending-flush", "pending input becomes one final turn and second flush dedupes")
    : fail("final-pending-flush", JSON.stringify({ flushed, secondFlush }));
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

function checkMetaQuestionIntent(): Result {
  const lesson = createInitialLessonState();
  const result = applyMonaVnextServerContent(createMonaVnextTranscriptState("c"), {
    inputTranscription: { text: "오늘 준비된 문장은 수가 몇 개야?" },
    outputTranscription: { text: "5개야." },
    turnComplete: true,
  }, "2026-06-18T00:00:02.000Z");
  const turn = result.finalizedTurn;
  if (!turn) return fail("meta-question-intent", "turn did not finalize");
  const evaluation = evaluateMonaVnextTurn(turn, lesson);
  const next = applyMonaVnextLessonEvaluation(lesson, evaluation);
  const srs = buildMonaVnextSrsAdvisory(turn, evaluation);
  const writerSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/logging/voiceLogWriter.ts"), "utf8");
  const ok = turn.intent === "meta_question"
    && evaluation.metaQuestionRequested
    && !evaluation.lessonAttempt
    && next.expression.id === lesson.expression.id
    && next.promptHistory[lesson.expression.id] === lesson.promptHistory[lesson.expression.id]
    && writerSource.includes('value.intent === "meta_question"')
    && srs.best3Candidates.length === 0
    && srs.weakNoteCandidates.length === 0
    && srs.nextSessionSuggestions.length === 0;
  return ok
    ? pass("meta-question-intent", "counts/log/prompt questions classify as no-advance meta_question")
    : fail("meta-question-intent", JSON.stringify({ turn, evaluation, next }));
}

function checkStrictStopIntent(): Result {
  const ok = hasStrictMonaVnextStopIntent("그만")
    && hasStrictMonaVnextStopIntent("그만할래.")
    && hasStrictMonaVnextStopIntent("stop")
    && !hasStrictMonaVnextStopIntent("끝나면 뭐해")
    && !hasStrictMonaVnextStopIntent("끝내주게 좋다")
    && detectMonaVnextIntent("그만") === "stop"
    && detectMonaVnextIntent("오늘 준비된 문장은 몇 개야?") === "meta_question";
  return ok
    ? pass("strict-stop-intent", "partial guard has high-confidence subset; meta beats broad stop fallback")
    : fail("strict-stop-intent", "strict stop or meta intent classification is unsafe");
}

function checkSkipComplaintIntent(): Result {
  const conversationId = createMonaVnextConversationId(new Date("2026-06-17T00:00:00Z"));
  const lesson = createInitialLessonState();
  const result = applyMonaVnextServerContent(createMonaVnextTranscriptState(conversationId), {
    inputTranscription: { text: "지금 왜 뛰어넘냐고 묻잖아" },
    outputTranscription: { text: "미안, 먼저 확인할게." },
    turnComplete: true,
  }, "2026-06-17T00:00:02.000Z");
  const turn = result.finalizedTurn;
  if (!turn) return fail("skip-complaint-hold", "turn did not finalize");
  const evaluation = evaluateMonaVnextTurn(turn, lesson);
  const next = applyMonaVnextLessonEvaluation(lesson, evaluation);
  const ok = turn.intent === "hold_current"
    && evaluation.pedagogyAction === "hold"
    && next.expression.id === lesson.expression.id
    && next.expression.state === "repair";
  return ok
    ? pass("skip-complaint-hold", "why-skip complaint holds current material instead of advancing")
    : fail("skip-complaint-hold", JSON.stringify({ turn, evaluation, next }));
}

function checkDifficultyIntent(): Result {
  const lesson = createInitialLessonState();
  const turn = {
    conversationId: "c",
    turnSeq: 1,
    userText: "어렵다. 천천히 힌트 줘.",
    modelText: "좋아, 쪼개볼게.",
    intent: detectMonaVnextIntent("어렵다. 천천히 힌트 줘."),
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-18T00:00:00.000Z",
    completedAtIso: "2026-06-18T00:00:01.000Z",
  };
  const evaluation = evaluateMonaVnextTurn(turn, lesson);
  const next = applyMonaVnextLessonEvaluation(lesson, evaluation);
  const srs = buildMonaVnextSrsAdvisory(turn, evaluation);
  const explicitNextIntent = detectMonaVnextIntent("어렵지만 다음 문장으로 넘어가자");
  const ok = turn.intent === "difficulty"
    && explicitNextIntent === "next_material"
    && evaluation.pedagogyAction === "teach_slow"
    && !evaluation.shouldAdvancePrompt
    && !evaluation.lessonAttempt
    && next.expression.id === lesson.expression.id
    && next.expression.state === "repair"
    && srs.best3Candidates.length === 0
    && srs.weakNoteCandidates.length === 0;
  return ok
    ? pass("difficulty-teacher-mode", "difficulty intent keeps current sentence and requests slow chunking")
    : fail("difficulty-teacher-mode", JSON.stringify({ turn, evaluation, next, srs }));
}

function checkLessonAttemptExposure(): Result {
  const makeTurn = (turnSeq: number) => ({
    conversationId: "c",
    turnSeq,
    userText: "I hope it makes sense.",
    modelText: "다시 해보자.",
    intent: "lesson_attempt" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-15T00:00:00.000Z",
    completedAtIso: "2026-06-15T00:00:01.000Z",
  });

  let lesson = createInitialLessonState();
  const firstExpression = lesson.expression.id;
  lesson = applyMonaVnextLessonEvaluation(lesson, evaluateMonaVnextTurn(makeTurn(1), lesson));
  const afterOne = lesson.promptHistory[firstExpression];
  lesson = applyMonaVnextLessonEvaluation(lesson, evaluateMonaVnextTurn(makeTurn(2), lesson));
  const afterTwo = lesson.promptHistory[firstExpression];
  const beforeAdvance = lesson;
  lesson = applyMonaVnextLessonEvaluation(lesson, evaluateMonaVnextTurn(makeTurn(3), lesson));

  const ok = afterOne === 2
    && afterTwo === MONA_VNEXT_MAX_SAME_PROMPT
    && beforeAdvance.expression.id === firstExpression
    && lesson.expression.id === firstExpression
    && lesson.expression.state === "repair";
  return ok
    ? pass("lesson-attempt-exposure", `promptHistory ${firstExpression}: 1 -> ${afterOne} -> ${afterTwo} -> intervention`)
    : fail("lesson-attempt-exposure", JSON.stringify({ afterOne, afterTwo, beforeAdvance, lesson }));
}

function checkAnswerMatcher(): Result {
  const exact = evaluateMonaVnextAnswerAttempt("I see what you mean.", "I see what you mean.");
  const close = evaluateMonaVnextAnswerAttempt("I hope it makes sense.", "I hope that makes sense.");
  const japaneseGarbage = evaluateMonaVnextAnswerAttempt("夜 を", "You look like you could use a break.");
  const numericGarbage = evaluateMonaVnextAnswerAttempt("1 2 3 4 아이가", "From now on.");
  const miss = evaluateMonaVnextAnswerAttempt("정답 알려줘", "You look like you could use a break.");
  const ok = exact.tier === "canonical"
    && close.tier === "close"
    && japaneseGarbage.tier === "garbage"
    && numericGarbage.tier === "garbage"
    && miss.tier === "miss";
  return ok
    ? pass("answer-matcher", "canonical/close/garbage/miss tiers classify conservatively")
    : fail("answer-matcher", JSON.stringify({ exact, close, japaneseGarbage, numericGarbage, miss }));
}

function checkAnswerMatcherEvaluation(): Result {
  const lesson = createInitialLessonState();
  const baseTurn = {
    conversationId: "c",
    turnSeq: 1,
    userText: lesson.expression.en,
    modelText: "좋아.",
    intent: "lesson_attempt" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-21T00:00:00.000Z",
    completedAtIso: "2026-06-21T00:00:01.000Z",
  };
  const gated = {
    answerMatcherEnabled: true,
    autoAdvanceOnCanonical: true,
    sttGarbageGateEnabled: true,
  };
  const canonical = evaluateMonaVnextTurn(baseTurn, lesson, gated);
  const canonicalNext = applyMonaVnextLessonEvaluation(lesson, canonical);
  const close = evaluateMonaVnextTurn({
    ...baseTurn,
    userText: "I hope it makes sense.",
  }, lesson, gated);
  const closeNext = applyMonaVnextLessonEvaluation(lesson, close);
  let repeatedLesson = recordPromptExposure(lesson, lesson.expression);
  repeatedLesson = recordPromptExposure(repeatedLesson, repeatedLesson.expression);
  const garbage = evaluateMonaVnextTurn({
    ...baseTurn,
    userText: "夜 を",
    sttDrift: true,
  }, repeatedLesson, gated);
  const ok = canonical.answerMatch?.tier === "canonical"
    && canonical.pedagogyAction === "advance"
    && canonicalNext.expression.id !== lesson.expression.id
    && close.answerMatch?.tier === "close"
    && close.pedagogyAction === "answer_close"
    && closeNext.expression.id === lesson.expression.id
    && garbage.pedagogyAction === "reject_garbage"
    && garbage.samePromptCount >= MONA_VNEXT_MAX_SAME_PROMPT;
  return ok
    ? pass("answer-matcher-evaluation", "canonical advances; close holds; garbage beats repeat intervention")
    : fail("answer-matcher-evaluation", JSON.stringify({ canonical, close, garbage, canonicalNext, closeNext }));
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

function checkProductCardFlow(): Result {
  const initial = createInitialLessonState({ englishVisible: false });
  const attemptTurn = {
    conversationId: "c",
    turnSeq: 1,
    userText: "I hope that makes sense.",
    modelText: "좋아, 자연스럽게는 이렇게 말해.",
    intent: "lesson_attempt" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-19T00:00:00.000Z",
    completedAtIso: "2026-06-19T00:00:01.000Z",
  };
  const afterAttempt = applyMonaVnextLessonEvaluation(initial, evaluateMonaVnextTurn(attemptTurn, initial));
  const nextTurn = {
    ...attemptTurn,
    turnSeq: 2,
    userText: "다음 문장으로 넘어가자",
    modelText: "좋아, 다음 문장 갈게.",
    intent: "next_material" as const,
  };
  const afterNext = applyMonaVnextLessonEvaluation(afterAttempt, evaluateMonaVnextTurn(nextTurn, afterAttempt));

  const ok = !initial.englishVisible
    && initial.expression.state === "prompt"
    && afterAttempt.englishVisible
    && afterAttempt.expression.state === "reveal"
    && afterNext.expression.id !== afterAttempt.expression.id
    && !afterNext.englishVisible
    && afterNext.expression.state === "prompt";
  return ok
    ? pass("product-card-flow", "hidden prompt -> attempt reveal -> next hidden prompt")
    : fail("product-card-flow", JSON.stringify({ initial, afterAttempt, afterNext }));
}

function checkRepeatLimit(): Result {
  let lesson = createInitialLessonState();
  lesson = recordPromptExposure(lesson, lesson.expression);
  lesson = recordPromptExposure(lesson, lesson.expression);
  const turn = {
    conversationId: "c",
    turnSeq: 3,
    userText: "I hope it makes sense.",
    modelText: "다시 해보자.",
    intent: "lesson_attempt" as const,
    sttDrift: false,
    interrupted: false,
    startedAtIso: "2026-06-15T00:00:00.000Z",
    completedAtIso: "2026-06-15T00:00:01.000Z",
  };
  const evaluation = evaluateMonaVnextTurn(turn, lesson);
  const next = applyMonaVnextLessonEvaluation(lesson, evaluation);
  const explicitNext = {
    ...turn,
    turnSeq: 4,
    userText: "다음 문장으로 넘어가자",
    intent: "next_material" as const,
  };
  const advanced = applyMonaVnextLessonEvaluation(next, evaluateMonaVnextTurn(explicitNext, next));
  const ok = evaluation.samePromptCount >= MONA_VNEXT_MAX_SAME_PROMPT
    && evaluation.pedagogyAction === "intervene"
    && !evaluation.shouldAdvancePrompt
    && next.expression.id === lesson.expression.id
    && next.expression.state === "repair"
    && advanced.expression.id !== lesson.expression.id;
  return ok
    ? pass("repeat-limit", `samePromptCount=${evaluation.samePromptCount}; intervention then explicit next advances`)
    : fail("repeat-limit", JSON.stringify({ evaluation, next, advanced }));
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
  return evaluation.repairRequested
    && evaluation.pedagogyAction === "repair"
    && next.expression.id === lesson.expression.id
    && next.expression.state === "repair"
    ? pass("repair-intent", "frustration/profanity repairs current material without auto-switching")
    : fail("repair-intent", JSON.stringify({ evaluation, next }));
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

function checkPersistenceFailureVisibility(): Result {
  const appSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx"), "utf8");
  const shellSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/ui/WindDownVnextShell.tsx"), "utf8");
  const logRouteSource = readFileSync(path.join(process.cwd(), "src/app/api/mona-vnext/log/route.ts"), "utf8");
  const memoryRouteSource = readFileSync(path.join(process.cwd(), "src/app/api/mona-vnext/memory/route.ts"), "utf8");
  const sessionRouteSource = readFileSync(path.join(process.cwd(), "src/app/api/mona-vnext/session/route.ts"), "utf8");
  const storageSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/storage/objectStore.ts"), "utf8");
  const wranglerSource = readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8");
  const ok = appSource.includes("reducePersistence")
    && appSource.includes("postConversationLog")
    && appSource.includes("bufferEvent")
    && !appSource.includes("persistEvent")
    && appSource.includes("conversationSaveError")
    && appSource.includes("PERSISTED_FILE_MISSING")
    && appSource.includes("!response.ok")
    && !appSource.includes(".catch(() => undefined)")
    && shellSource.includes("persistenceError")
    && shellSource.includes("저장 실패:")
    && logRouteSource.includes("MONA_VNEXT_LOG_WRITE_FAILED")
    && memoryRouteSource.includes("MONA_VNEXT_MEMORY_WRITE_FAILED")
    && sessionRouteSource.includes("MONA_VNEXT_PERSISTENCE_NOT_READY")
    && storageSource.includes("MONA_VNEXT_KV")
    && storageSource.includes("cloudflare-kv-missing")
    && !storageSource.startsWith("import { mkdir")
    && wranglerSource.includes("\"binding\": \"MONA_VNEXT_KV\"")
    && wranglerSource.includes("9ca9cc74a4f341aeaa231fa67db65302");
  return ok
    ? pass("persistence-failure-visible", "turn/final save failures surface via reducer; partials buffered (no per-partial POST)")
    : fail("persistence-failure-visible", "severity split missing or conversation-save failure can be silent");
}

function checkPersistenceSeveritySplit(): Result {
  // A partial-event log POST failure must NOT surface as a conversation-save failure.
  const afterPartialFail = reducePersistence(createInitialPersistenceState(), {
    kind: "partial",
    ok: false,
    error: "NETWORK_BLIP",
  });
  if (afterPartialFail.conversationSaveError !== null) {
    return fail("persistence-severity-split", "partial log failure surfaced as conversation save failure");
  }

  // A turn-save failure MUST surface (this is real conversation data).
  const afterTurnFail = reducePersistence(createInitialPersistenceState(), {
    kind: "turn",
    ok: false,
    error: "HTTP_500",
  });
  if (!afterTurnFail.conversationSaveError || !afterTurnFail.conversationSaveError.includes("HTTP_500")) {
    return fail("persistence-severity-split", "turn-save failure did not surface as conversation save failure");
  }

  // Regression gate (d): 80 partial failures then a successful final save = green banner.
  let state = createInitialPersistenceState();
  for (let i = 0; i < 80; i += 1) {
    state = reducePersistence(state, { kind: "partial", ok: false, error: "NETWORK_BLIP" });
  }
  state = reducePersistence(state, { kind: "final", ok: true, file: "data/voice-logs-vnext/owner-test/x.json" });
  if (state.conversationSaveError !== null) {
    return fail("persistence-severity-split", "80 partial drops + successful final did not clear conversation-save banner");
  }
  if (state.lastPersistedFile !== "data/voice-logs-vnext/owner-test/x.json") {
    return fail("persistence-severity-split", "successful final save did not record lastPersistedFile");
  }

  return pass(
    "persistence-severity-split",
    "partial log drops never surface; turn/final govern the conversation-save banner",
  );
}

function checkFeatureGates(): Result {
  const activeDebugFeatures = listActiveExperimentalFeatures("debug");
  const expectedP15Gates = [
    MONA_VNEXT_ANSWER_MATCHER_GATE,
    MONA_VNEXT_APP_OWNED_NEXT_MATERIAL_GATE,
    MONA_VNEXT_AUTO_ADVANCE_ON_CANONICAL_GATE,
    MONA_VNEXT_STT_GARBAGE_GATE,
  ].sort();
  const gates = createMonaVnextFeatureGateEvaluator({
    promoted: new Set(["promoted-feature"]),
    experimental: new Set(["experimental-feature"]),
  });
  const ok = gates.isEnabled("promoted-feature", "winddown")
    && gates.isEnabled("promoted-feature", "debug")
    && !gates.isEnabled("experimental-feature", "winddown")
    && gates.isEnabled("experimental-feature", "debug")
    && !gates.isEnabled("unknown-feature", "winddown")
    && !gates.isEnabled("unknown-feature", "debug")
    && gates.listActiveExperimentalFeatures("winddown").length === 0
    && gates.listActiveExperimentalFeatures("debug").join(",") === "experimental-feature"
    && !isMonaVnextFeatureEnabled("future-feature", "winddown")
    && !isMonaVnextFeatureEnabled("future-feature", "debug")
    && !isMonaVnextFeatureEnabled(MONA_VNEXT_ANSWER_MATCHER_GATE, "winddown")
    && isMonaVnextFeatureEnabled(MONA_VNEXT_ANSWER_MATCHER_GATE, "debug")
    && !isMonaVnextFeatureEnabled(MONA_VNEXT_AUTO_ADVANCE_ON_CANONICAL_GATE, "winddown")
    && isMonaVnextFeatureEnabled(MONA_VNEXT_AUTO_ADVANCE_ON_CANONICAL_GATE, "debug")
    && listActiveExperimentalFeatures("winddown").length === 0
    && activeDebugFeatures.join(",") === expectedP15Gates.join(",");
  return ok
    ? pass("feature-gates", "promoted hits both surfaces; P1.5 experimental gates hit debug only")
    : fail("feature-gates", "feature gate isolation semantics regressed");
}

function checkDebugOnlyAnswerVerdictSource(): Result {
  const appSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/MonaVoiceCoachApp.tsx"), "utf8");
  const shellSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/ui/WindDownVnextShell.tsx"), "utf8");
  const cardSource = readFileSync(path.join(process.cwd(), "src/features/mona-vnext/ui/ExpressionCard.tsx"), "utf8");
  const ok = appSource.includes("answerVerdict={p15Gates.answerMatcher ? answerVerdict : null}")
    && !appSource.includes("answerVerdict={answerVerdict}")
    && appSource.includes("buildNextLessonPrompt(nextLesson, p15Gates.appOwnedNextMaterial)")
    && shellSource.includes("answerVerdict: MonaVnextAnswerVerdict | null")
    && shellSource.includes("verdict={answerVerdict}")
    && cardSource.includes("verdict.symbol")
    && cardSource.includes("verdict.label");
  return ok
    ? pass("debug-only-answer-verdict", "matcher verdict chip is wired only through the debug vNext shell")
    : fail("debug-only-answer-verdict", "answer verdict can leak outside the debug shell or app-owned next guard is missing");
}

const results = [
  checkSetupShape(),
  checkTemperatureOverride(),
  checkDynamicExpressionBank(),
  checkModelAllowlist(),
  checkTranscriptCollapse(),
  checkChunkedTranscriptMerge(),
  checkCumulativeTranscriptMerge(),
  checkFinalPendingFlush(),
  checkNextIntent(),
  checkMetaQuestionIntent(),
  checkStrictStopIntent(),
  checkSkipComplaintIntent(),
  checkDifficultyIntent(),
  checkLessonAttemptExposure(),
  checkAnswerMatcher(),
  checkAnswerMatcherEvaluation(),
  checkEnglishVisibilityIntent(),
  checkProductCardFlow(),
  checkRepeatLimit(),
  checkControlLeakage(),
  checkRepairIntent(),
  checkInterruptionFlushSource(),
  checkNamespace(),
  checkPersistenceFailureVisibility(),
  checkPersistenceSeveritySplit(),
  checkFeatureGates(),
  checkDebugOnlyAnswerVerdictSource(),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
