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
  const result = applyMonaVnextServerContent(createMonaVnextTranscriptState(conversationId), {
    inputTranscription: { text: "지금 왜 뛰어넘냐고 묻잖아" },
    outputTranscription: { text: "미안, 먼저 확인할게." },
    turnComplete: true,
  }, "2026-06-17T00:00:02.000Z");
  const turn = result.finalizedTurn;
  const ok = turn?.intent === "repair";
  return ok
    ? pass("skip-complaint-repair", "why-skip complaint is classified as repair, not next")
    : fail("skip-complaint-repair", JSON.stringify(turn));
}

function checkLessonAttemptExposure(): Result {
  const makeTurn = (turnSeq: number) => ({
    conversationId: "c",
    turnSeq,
    userText: "잘 모르겠어",
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
    && lesson.expression.id !== firstExpression;
  return ok
    ? pass("lesson-attempt-exposure", `promptHistory ${firstExpression}: 1 -> ${afterOne} -> ${afterTwo} -> advance`)
    : fail("lesson-attempt-exposure", JSON.stringify({ afterOne, afterTwo, beforeAdvance, lesson }));
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
  checkLessonAttemptExposure(),
  checkEnglishVisibilityIntent(),
  checkRepeatLimit(),
  checkControlLeakage(),
  checkRepairIntent(),
  checkInterruptionFlushSource(),
  checkNamespace(),
  checkPersistenceFailureVisibility(),
  checkPersistenceSeveritySplit(),
];

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
