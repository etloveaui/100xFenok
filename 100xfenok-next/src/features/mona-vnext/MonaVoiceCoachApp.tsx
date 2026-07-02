"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MonaWindDown, { type WindDownPhase } from "@/components/admin-live/MonaWindDown";
import MonaVnextEntry from "@/components/admin-live/MonaVnextEntry";
import {
  createInitialLessonState,
  pickNextExpression,
  recordPromptExposure,
  type MonaVnextLessonState,
  type MonaVnextSessionExpressionBank,
} from "@/features/mona-vnext/coach/coachPolicy";
import type { MonaVnextAnswerMatch, MonaVnextAnswerMatchTier } from "@/features/mona-vnext/coach/answerMatcher";
import { MONA_VNEXT_BASELINE_LOG, MONA_VNEXT_BASELINE_PROMPT_POLICY } from "@/features/mona-vnext/coach/baselineEvidence";
import { applyMonaVnextLessonEvaluation } from "@/features/mona-vnext/coach/lessonFlow";
import { evaluateMonaVnextTurn, type MonaVnextPostTurnEvaluation } from "@/features/mona-vnext/coach/postTurnEvaluator";
import {
  MONA_VNEXT_DEFAULT_GEMINI_MODEL,
  MONA_VNEXT_GEMINI_MODELS,
  type MonaVnextGeminiModel,
} from "@/features/mona-vnext/live/modelOptions";
import {
  MONA_VNEXT_ANSWER_MATCHER_GATE,
  MONA_VNEXT_APP_OWNED_NEXT_MATERIAL_GATE,
  MONA_VNEXT_AUTO_ADVANCE_ON_CANONICAL_GATE,
  MONA_VNEXT_STT_GARBAGE_GATE,
  isMonaVnextFeatureEnabled,
  listActiveExperimentalFeatures,
  type MonaVoiceCoachSurface,
} from "@/features/mona-vnext/featureGates";
import { MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE } from "@/features/mona-vnext/live/generationOptions";
import { useGeminiLiveSession, type MonaVnextSessionMetrics } from "@/features/mona-vnext/live/useGeminiLiveSession";
import type { MonaVnextSessionResponse } from "@/features/mona-vnext/live/liveProtocol";
import {
  createInitialPersistenceState,
  reducePersistence,
  type MonaVnextPersistKind,
} from "@/features/mona-vnext/logging/persistenceState";
import type { MonaVnextLogEvent } from "@/features/mona-vnext/logging/voiceLogSchema";
import { MONA_VNEXT_NAMESPACE_POLICY } from "@/features/mona-vnext/memory/monaVnextNamespace";
import { buildMonaVnextSrsAdvisory } from "@/features/mona-vnext/memory/srsAdvisory";
import {
  buildCorrectionCandidate,
  buildMasteryEvent,
  type MonaVnextCorrectionCandidate,
} from "@/features/mona-vnext/memory/srsBridge";
import { buildTeacherRealtimeTextInput } from "@/features/mona-vnext/teacher/effectEmitter";
import {
  mapAnswerMatchToTeacherVerdict,
  monaExpressionToTeacherCard,
  teacherSessionToLessonState,
} from "@/features/mona-vnext/teacher/teacherAdapter";
import { shouldFlagTeacherModelDrift } from "@/features/mona-vnext/teacher/teacherDriftGuard";
import {
  createTeacherSession,
  teacherTransition,
} from "@/features/mona-vnext/teacher/teacherMachine";
import type {
  StudyMode,
  TeacherEffect,
  TeacherEvent,
  TeacherTransitionResult,
} from "@/features/mona-vnext/teacher/teacherSession";
import {
  applyMonaVnextServerContent,
  createMonaVnextTranscriptState,
  finalizePendingMonaVnextTurn,
  type MonaVnextTranscriptState,
} from "@/features/mona-vnext/transcript/transcriptStore";
import { createMonaVnextConversationId, type MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";
import { hasStrictMonaVnextStopIntent } from "@/features/mona-vnext/transcript/intentHints";
import { WindDownVnextShell } from "@/features/mona-vnext/ui/WindDownVnextShell";

const BUILD_VERSION = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 9) ?? "local-vnext";
const DEFAULT_SETTINGS = {
  model: MONA_VNEXT_DEFAULT_GEMINI_MODEL,
  voiceName: "Kore" as const,
  vadPreset: "relaxed" as const,
  lowVoice: true,
  interruptionMode: "no-interrupt" as const,
  englishVisible: true,
  temperature: MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE,
} as const;

const PRODUCT_INITIAL_ENGLISH_VISIBLE = false;

// Durable event buffer cap, matched to the writer's events.slice(-1000).
const MAX_PENDING_EVENTS = 1000;
const STUDY_MODE_OPTIONS: Array<{ mode: StudyMode; label: string }> = [
  { mode: "drill", label: "드릴" },
  { mode: "review", label: "복습" },
  { mode: "free_talk", label: "자유대화" },
  { mode: "live_talk", label: "라이브톡" },
];

type Props = {
  surface?: MonaVoiceCoachSurface;
};

type PersistResult = {
  ok?: unknown;
  file?: unknown;
  error?: unknown;
};

type FinalizeReason = "manual-stop" | "strict-stop" | "reconnect-failed" | "pagehide";

type FinalizeOptions = {
  reason: FinalizeReason;
};

type ExpressionCard = {
  state: "prompt" | "reveal" | "drill";
  ko: string;
  en?: string;
  pron?: string;
  drillHint?: string;
  updatedAt: number;
};

type ResumeOffer = {
  fromConversationId: string;
  teacherSession: TeacherTransitionResult["session"];
  expressionBank: MonaVnextSessionExpressionBank;
  lessonState: MonaVnextLessonState;
};

function normalizeStudyMode(mode: StudyMode): StudyMode {
  return mode === "winddown" ? "drill" : mode;
}

export type MonaVnextAnswerVerdict = {
  tier: MonaVnextAnswerMatchTier;
  symbol: string;
  label: string;
  detail: string;
};

function buildExpressionBankLogSettings(expressionBank: MonaVnextSessionExpressionBank) {
  return {
    ...expressionBank.metadata,
    selectedExpressionIds: expressionBank.entries.map((entry) => entry.id),
  };
}

function appendEvent(events: MonaVnextLogEvent[], event: MonaVnextLogEvent) {
  return [...events, event].slice(-40);
}

function mapWindDownPhase(status: ReturnType<typeof useGeminiLiveSession>["status"]): WindDownPhase {
  if (status === "listening") return "live";
  if (status === "connecting" || status === "setup-wait" || status === "stopping") return "connecting";
  if (status === "blocked" || status === "error") return "blocked";
  if (status === "stopped") return "stopped";
  return "ready";
}

function buildWindDownMessage(status: ReturnType<typeof useGeminiLiveSession>["status"]) {
  if (status === "connecting" || status === "setup-wait") return "연결하고 있어. 잠깐만 기다려줘.";
  if (status === "listening") return "천천히 말하면 듣고 있어.";
  if (status === "stopping") return "대화를 정리하고 있어.";
  if (status === "stopped") return "저장까지 마쳤어. 다시 시작해도 돼.";
  if (status === "blocked" || status === "error") return "지금은 시작할 수 없어. 설정이나 권한을 확인해야 해.";
  return "마이크를 켜면 오늘 문장부터 바로 시작할게.";
}

function buildFinalEventMessage(reason: FinalizeReason) {
  if (reason === "strict-stop") return "Mona vNext session finalized by strict stop phrase.";
  if (reason === "reconnect-failed") return "Mona vNext session finalized after reconnect failure.";
  if (reason === "pagehide") return "Mona vNext session finalized by pagehide.";
  return "Mona vNext session finalized by owner/dev control.";
}

function isWindDownSettingsLocked(status: ReturnType<typeof useGeminiLiveSession>["status"]) {
  return status === "connecting"
    || status === "setup-wait"
    || status === "listening"
    || status === "stopping";
}

function buildWindDownCard(lessonState: MonaVnextLessonState): ExpressionCard {
  const isRepair = lessonState.expression.state === "repair";
  const state: ExpressionCard["state"] = isRepair
    ? "drill"
    : lessonState.englishVisible || lessonState.expression.state === "reveal"
      ? "reveal"
      : "prompt";
  return {
    state,
    ko: lessonState.expression.ko,
    ...(state !== "prompt" ? { en: lessonState.expression.en } : {}),
    ...(isRepair ? { drillHint: "천천히 다시 잡아보자" } : {}),
    updatedAt: Date.now(),
  };
}

function buildAnswerVerdict(answerMatch: MonaVnextAnswerMatch | null): MonaVnextAnswerVerdict | null {
  if (!answerMatch) return null;
  if (answerMatch.tier === "canonical") {
    return { tier: answerMatch.tier, symbol: "✓", label: "맞음", detail: answerMatch.reason };
  }
  if (answerMatch.tier === "variant") {
    return { tier: answerMatch.tier, symbol: "✓", label: "다른 정답", detail: answerMatch.reason };
  }
  if (answerMatch.tier === "close") {
    return { tier: answerMatch.tier, symbol: "≈", label: "거의", detail: answerMatch.reason };
  }
  if (answerMatch.tier === "garbage") {
    return { tier: answerMatch.tier, symbol: "✗", label: "인식오류", detail: answerMatch.reason };
  }
  return { tier: answerMatch.tier, symbol: "✗", label: "다시", detail: answerMatch.reason };
}

function shouldInjectPedagogyControl(evaluation: MonaVnextPostTurnEvaluation) {
  return evaluation.pedagogyAction === "hold"
    || evaluation.pedagogyAction === "teach_slow"
    || evaluation.pedagogyAction === "repair"
    || evaluation.pedagogyAction === "intervene"
    || evaluation.pedagogyAction === "answer_close"
    || evaluation.pedagogyAction === "answer_miss"
    || evaluation.pedagogyAction === "reject_garbage";
}

export default function MonaVoiceCoachApp({ surface = "debug" }: Props = {}) {
  const teacherActive = surface === "debug";
  const activeExperimentalFeatures = useMemo(() => listActiveExperimentalFeatures(surface), [surface]);
  const p15Gates = useMemo(() => ({
    answerMatcher: isMonaVnextFeatureEnabled(MONA_VNEXT_ANSWER_MATCHER_GATE, surface),
    autoAdvanceOnCanonical: isMonaVnextFeatureEnabled(MONA_VNEXT_AUTO_ADVANCE_ON_CANONICAL_GATE, surface),
    sttGarbageGate: isMonaVnextFeatureEnabled(MONA_VNEXT_STT_GARBAGE_GATE, surface),
    appOwnedNextMaterial: isMonaVnextFeatureEnabled(MONA_VNEXT_APP_OWNED_NEXT_MATERIAL_GATE, surface),
  }), [surface]);
  const [transcriptState, setTranscriptState] = useState<MonaVnextTranscriptState>(
    () => createMonaVnextTranscriptState(createMonaVnextConversationId()),
  );
  const [lessonState, setLessonState] = useState<MonaVnextLessonState>(() => createInitialLessonState({
    englishVisible: surface === "winddown" ? PRODUCT_INITIAL_ENGLISH_VISIBLE : DEFAULT_SETTINGS.englishVisible,
  }));
  const [events, setEvents] = useState<MonaVnextLogEvent[]>([]);
  // Single source of truth for the "저장 실패" banner. Only turn/final
  // conversation saves can set it; partial-event logging never does.
  const [persistenceState, setPersistenceState] = useState(() => createInitialPersistenceState());
  const [answerVerdict, setAnswerVerdict] = useState<MonaVnextAnswerVerdict | null>(null);
  const [resumeOffer, setResumeOffer] = useState<ResumeOffer | null>(null);
  const [studyMode, setStudyMode] = useState<StudyMode>("drill");
  const [correctionCandidates, setCorrectionCandidates] = useState<MonaVnextCorrectionCandidate[]>([]);
  const [selectedModel, setSelectedModel] = useState<MonaVnextGeminiModel>(MONA_VNEXT_DEFAULT_GEMINI_MODEL);
  const [voiceName, setVoiceName] = useState<string>(DEFAULT_SETTINGS.voiceName);
  const [vadPreset, setVadPreset] = useState<"relaxed" | "balanced">(DEFAULT_SETTINGS.vadPreset);
  const sessionRef = useRef<{
    sessionId: string;
    conversationId: string;
    resumedFromConversationId?: string;
    startedAt: string;
    expressionBank: MonaVnextSessionExpressionBank;
  } | null>(null);
  const lessonStateRef = useRef(lessonState);
  const teacherSessionRef = useRef<TeacherTransitionResult["session"] | null>(null);
  const pendingTeacherEffectsRef = useRef<TeacherEffect[]>([]);
  const lastTeacherTargetEffectRef = useRef<TeacherEffect | null>(null);
  const transcriptStateRef = useRef(transcriptState);
  const metricsRef = useRef<MonaVnextSessionMetrics | null>(null);
  const sendControlTextRef = useRef<(text: string) => boolean>(() => false);
  const finalizeSessionRef = useRef<(options: FinalizeOptions) => void>(() => undefined);
  const sessionFinalizedRef = useRef(false);
  const hardStopHandledRef = useRef(false);
  const autoStartConversationRef = useRef<string | null>(null);
  const resumeOfferRef = useRef<ResumeOffer | null>(null);
  const lastReconnectedConversationRef = useRef<string | null>(null);
  // Best-effort events (partials, lifecycle) accumulate here and are flushed
  // into the next turn/final log POST, instead of one POST per partial.
  const pendingEventsRef = useRef<MonaVnextLogEvent[]>([]);

  const sessionSettings = useMemo(() => ({
    ...DEFAULT_SETTINGS,
    model: selectedModel,
    voiceName,
    vadPreset,
    englishVisible: lessonState.englishVisible,
    activeExpressionId: lessonState.expression.id,
  }), [lessonState.englishVisible, lessonState.expression.id, selectedModel, vadPreset, voiceName]);

  const applyPersistOutcome = useCallback((
    kind: MonaVnextPersistKind,
    ok: boolean,
    opts?: { file?: string; error?: string },
  ) => {
    setPersistenceState((current) => reducePersistence(current, { kind, ok, ...opts }));
  }, []);

  // Durable conversation save (turn/final). This is the only POST whose
  // success/failure drives the user-facing banner.
  const postConversationLog = useCallback((kind: "turn" | "final", body: Record<string, unknown>) => {
    void (async () => {
      try {
        const response = await fetch("/api/mona-vnext/log/", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as PersistResult | null;
        if (!response.ok || payload?.ok !== true) {
          const error = typeof payload?.error === "string" ? payload.error : `HTTP_${response.status}`;
          throw new Error(error);
        }
        if (typeof payload.file !== "string" || !payload.file) {
          throw new Error("PERSISTED_FILE_MISSING");
        }
        applyPersistOutcome(kind, true, { file: payload.file });
      } catch (error) {
        applyPersistOutcome(kind, false, {
          error: error instanceof Error ? error.message : String(error || "UNKNOWN_PERSISTENCE_ERROR"),
        });
      }
    })();
  }, [applyPersistOutcome]);

  // SRS advisory checkpoint. Best-effort: a failure here is NOT a conversation
  // save failure and must never raise the banner (advisory can be retried).
  const postMemoryAdvisory = useCallback((body: Record<string, unknown>) => {
    void (async () => {
      try {
        await fetch("/api/mona-vnext/memory/", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // Advisory is best-effort; swallow without surfacing a save error.
      }
    })();
  }, []);

  // Buffer an event for the UI panel + the durable flush. No per-event POST.
  const bufferEvent = useCallback((event: MonaVnextLogEvent) => {
    setEvents((current) => appendEvent(current, event));
    pendingEventsRef.current = [...pendingEventsRef.current, event].slice(-MAX_PENDING_EVENTS);
  }, []);

  const drainPendingEvents = useCallback(() => {
    const drained = pendingEventsRef.current;
    pendingEventsRef.current = [];
    return drained;
  }, []);

  const sendTeacherEffects = useCallback((effects: TeacherEffect[]) => {
    let allSent = true;
    for (const effect of effects) {
      bufferEvent({
        type: "teacher_effect",
        message: `TSM effect: ${effect.type}`,
        atIso: new Date().toISOString(),
        detail: {
          effectType: effect.type,
          stateSeq: effect.stateSeq,
          expressionId: effect.expressionId,
          targetEn: effect.targetEn ?? null,
          expectedModelAction: effect.expectedModelAction,
          praiseArmed: teacherSessionRef.current?.praiseArmed ?? null,
        },
      });
      if (effect.expectedModelAction === "log_only") continue;
      const sent = sendControlTextRef.current(buildTeacherRealtimeTextInput(effect).realtimeInput.text);
      allSent = allSent && sent;
      if (
        sent
        && effect.targetEn
        && (
          effect.expectedModelAction === "speak_target"
          || effect.expectedModelAction === "reveal_target"
          || effect.expectedModelAction === "present_card"
        )
      ) {
        lastTeacherTargetEffectRef.current = effect;
      }
    }
    return allSent;
  }, [bufferEvent]);

  const commitTeacherResult = useCallback((
    result: TeacherTransitionResult,
    options: { sendEffects?: boolean; queueEffects?: boolean; trigger?: string } = {},
  ) => {
    teacherSessionRef.current = result.session;
    const expressionBank = sessionRef.current?.expressionBank.entries ?? lessonStateRef.current.expressionBank;
    const nextLesson = teacherSessionToLessonState(result.session, expressionBank);
    lessonStateRef.current = nextLesson;
    setLessonState(nextLesson);
    if (options.trigger) {
      bufferEvent({
        type: "teacher_transition",
        message: `TSM transition: ${options.trigger}`,
        atIso: new Date().toISOString(),
        detail: {
          trigger: options.trigger,
          phase: result.session.phase,
          stateSeq: result.session.stateSeq,
          expressionId: result.session.card?.expressionId ?? null,
        },
      });
    }
    if (options.queueEffects && result.effects.length > 0) {
      pendingTeacherEffectsRef.current = [...pendingTeacherEffectsRef.current, ...result.effects];
    } else if (options.sendEffects !== false && result.effects.length > 0) {
      sendTeacherEffects(result.effects);
    }
    return nextLesson;
  }, [bufferEvent, sendTeacherEffects]);

  const dispatchTeacherEvent = useCallback((
    event: TeacherEvent,
    options: { sendEffects?: boolean; trigger?: string } = {},
  ) => {
    const current = teacherSessionRef.current;
    if (!current) return null;
    return commitTeacherResult(teacherTransition(current, event), {
      sendEffects: options.sendEffects,
      trigger: options.trigger ?? event.type,
    });
  }, [commitTeacherResult]);

  const changeStudyMode = useCallback((mode: StudyMode) => {
    const nextMode = normalizeStudyMode(mode);
    setStudyMode(nextMode);
    bufferEvent({
      type: "study-mode-change",
      message: `Mona vNext study mode changed to ${nextMode}.`,
      atIso: new Date().toISOString(),
      detail: { mode: nextMode },
    });
    if (!teacherActive || !teacherSessionRef.current) return;
    dispatchTeacherEvent({ type: "LEARNER_MODE_CHANGE", mode }, {
      trigger: `LEARNER_MODE_CHANGE_${nextMode}`,
    });
  }, [bufferEvent, dispatchTeacherEvent, teacherActive]);

  const flushPendingTeacherEffects = useCallback(() => {
    const pending = pendingTeacherEffectsRef.current;
    if (pending.length === 0) return true;
    const sent = sendTeacherEffects(pending);
    if (sent) pendingTeacherEffectsRef.current = [];
    return sent;
  }, [sendTeacherEffects]);

  const sendTeacherStart = useCallback(() => {
    if (flushPendingTeacherEffects()) return;
    const current = teacherSessionRef.current;
    if (!current) return;
    commitTeacherResult(teacherTransition(current, { type: "SESSION_READY" }), {
      sendEffects: true,
      trigger: "SESSION_READY",
    });
  }, [commitTeacherResult, flushPendingTeacherEffects]);

  const handleTeacherOutputDrift = useCallback((observedText: string | null | undefined) => {
    if (!teacherActive) return;
    const expected = lastTeacherTargetEffectRef.current;
    if (!shouldFlagTeacherModelDrift(expected, observedText)) return;
    lastTeacherTargetEffectRef.current = null;
    bufferEvent({
      type: "model_drift",
      message: "Teacher target speech drift detected.",
      atIso: new Date().toISOString(),
      detail: {
        kind: "word_drop",
        expressionId: expected?.expressionId ?? null,
        targetEn: expected?.targetEn ?? null,
        observedText: observedText ?? null,
        flagged: true,
      },
    });
    dispatchTeacherEvent({
      type: "MODEL_DRIFT",
      kind: "word_drop",
      observedText: observedText ?? undefined,
    }, { trigger: "MODEL_DRIFT" });
  }, [bufferEvent, dispatchTeacherEvent, teacherActive]);

  const buildPostTurnArtifacts = useCallback((
    turn: MonaVnextTurn,
    currentLesson: MonaVnextLessonState,
  ) => {
    const evaluation = evaluateMonaVnextTurn(turn, currentLesson, {
      answerMatcherEnabled: p15Gates.answerMatcher,
      autoAdvanceOnCanonical: p15Gates.autoAdvanceOnCanonical,
      sttGarbageGateEnabled: p15Gates.sttGarbageGate,
    });
    const advisory = buildMonaVnextSrsAdvisory(turn, evaluation);
    const nextLesson = applyMonaVnextLessonEvaluation(currentLesson, evaluation);
    const event: MonaVnextLogEvent = {
      type: "post-turn-evaluation",
      message: evaluation.advisory,
      atIso: new Date().toISOString(),
      detail: {
        turnSeq: turn.turnSeq,
        intent: evaluation.intent,
        pedagogyAction: evaluation.pedagogyAction,
        promptId: evaluation.promptId,
        nextPromptId: nextLesson.expression.id,
        materialChanged: nextLesson.expression.id !== currentLesson.expression.id,
        samePromptCount: evaluation.samePromptCount,
        sttDrift: evaluation.sttDrift,
        answerMatch: evaluation.answerMatch ? {
          tier: evaluation.answerMatch.tier,
          confidence: evaluation.answerMatch.confidence,
          reason: evaluation.answerMatch.reason,
        } : null,
      },
    };
    const controlEvent: MonaVnextLogEvent | null = shouldInjectPedagogyControl(evaluation)
      ? {
        type: "pedagogy-control-injected",
        message: `Mona vNext pedagogy action injected: ${evaluation.pedagogyAction}.`,
        atIso: new Date().toISOString(),
        detail: {
          turnSeq: turn.turnSeq,
          pedagogyAction: evaluation.pedagogyAction,
          userText: turn.userText,
          modelText: turn.modelText,
        },
      }
      : null;
    return { evaluation, advisory, nextLesson, event, controlEvent };
  }, [p15Gates]);

  const buildMetaQuestionAnswer = useCallback((currentLesson: MonaVnextLessonState) => (
    [
      `지금 준비된 문장은 ${currentLesson.expressionBank.length}개야.`,
      `현재 문장은 "${currentLesson.expression.ko}"이고, 영어 목표는 "${currentLesson.expression.en}"야.`,
      "짧게 직접 답한 뒤 이 문장으로 돌아와.",
    ].join(" ")
  ), []);

  const buildNextLessonPrompt = useCallback((nextLesson: MonaVnextLessonState, appOwnedNextMaterial = false) => (
    [
      appOwnedNextMaterial
        ? "앱이 고른 아래 새 문장만 사용해. 방금 다른 새 문장을 말했으면 짧게 정정하고 아래 문장으로 돌아와."
        : "새 문장으로 자연스럽게 넘어가.",
      `한국어로 먼저 물어볼 문장: "${nextLesson.expression.ko}"`,
      `모나가 시도한 뒤 알려줄 자연스러운 영어: "${nextLesson.expression.en}"`,
      "한 턴에 하나만 묻고, 모나가 답할 때까지 기다려.",
    ].join(" ")
  ), []);

  const buildPedagogyControlPrompt = useCallback((
    evaluation: MonaVnextPostTurnEvaluation,
    currentLesson: MonaVnextLessonState,
  ) => {
    const current = currentLesson.expression;
    const firstHint = current.en.split(/\s+/).slice(0, 2).join(" ");
    const base = [
      "[CONTROL]",
      `현재 문장을 유지해: "${current.ko}" / "${current.en}"`,
      "새 문장으로 넘어가지 마. 한 번에 하나만 말하고 모나의 대답을 기다려.",
    ];
    if (evaluation.pedagogyAction === "hold") {
      return [
        ...base,
        "모나가 아직 하지 않았거나 넘어가지 말라고 했다. 짧게 인정하고 기다려.",
      ].join(" ");
    }
    if (evaluation.pedagogyAction === "teach_slow") {
      return [
        ...base,
        `선생님처럼 아주 천천히 쪼개. 첫 힌트는 "${firstHint}" 정도만 주고 기다려.`,
      ].join(" ");
    }
    if (evaluation.pedagogyAction === "intervene") {
      return [
        ...base,
        `반복 한계에 닿았다. 자동으로 넘기지 말고 "${firstHint}" 힌트만 아주 짧게 주고 기다려. 계속할지 다음으로 갈지 묻지 마.`,
      ].join(" ");
    }
    if (evaluation.pedagogyAction === "reject_garbage") {
      return [
        ...base,
        "방금 발화는 인식 오류로 보고 채점하지 마. 칭찬하지 말고 아주 짧게 다시 말해달라고 해.",
      ].join(" ");
    }
    if (evaluation.pedagogyAction === "answer_close") {
      return [
        ...base,
        `모나 답은 비슷하지만 자동 통과시키지 마. 자연스러운 목표 문장 "${current.en}"을 짧게 보여주고 한 번만 따라 하게 해.`,
      ].join(" ");
    }
    if (evaluation.pedagogyAction === "answer_miss") {
      return [
        ...base,
        `정답으로 칭찬하지 마. "${firstHint}" 힌트만 주고 현재 문장을 다시 시도하게 해.`,
      ].join(" ");
    }
    return [
      ...base,
      "불만이나 인식오류를 먼저 수습해. 사과는 짧게, 현재 문장으로 다시 잡아줘.",
    ].join(" ");
  }, []);

  const persistTurn = useCallback((
    turn: MonaVnextTurn,
    currentLesson: MonaVnextLessonState,
  ) => {
    const session = sessionRef.current;
    if (!session || sessionFinalizedRef.current) return;
    const { evaluation, advisory, nextLesson, event, controlEvent } = buildPostTurnArtifacts(turn, currentLesson);

    if (teacherActive && teacherSessionRef.current) {
      setAnswerVerdict(p15Gates.answerMatcher ? buildAnswerVerdict(evaluation.answerMatch) : null);
      const activeMode = teacherSessionRef.current.mode;
      let masteryEvent: ReturnType<typeof buildMasteryEvent> = null;
      let correctionCandidate: MonaVnextCorrectionCandidate | null = null;
      if (evaluation.stopRequested) {
        dispatchTeacherEvent({ type: "LEARNER_STOP" }, { trigger: "LEARNER_STOP" });
      } else if (evaluation.nextMaterialRequested) {
        dispatchTeacherEvent({ type: "LEARNER_NEXT" }, { trigger: "LEARNER_NEXT" });
      } else if (evaluation.englishVisibilityRequested) {
        dispatchTeacherEvent({ type: "LEARNER_REVEAL" }, { trigger: "LEARNER_REVEAL" });
      } else if (
        evaluation.metaQuestionRequested
        || evaluation.holdCurrentRequested
        || evaluation.difficultyRequested
        || evaluation.repairRequested
      ) {
        dispatchTeacherEvent({
          type: "LEARNER_QUESTION",
          text: turn.userText ?? undefined,
        }, { trigger: "LEARNER_QUESTION" });
      } else if (evaluation.lessonAttempt) {
        const learnerText = turn.userText ?? "";
        dispatchTeacherEvent({
          type: "LEARNER_ATTEMPT",
          text: learnerText,
        }, {
          sendEffects: activeMode === "free_talk" || activeMode === "live_talk",
          trigger: "LEARNER_ATTEMPT",
        });
        if (activeMode === "drill" || activeMode === "review") {
          const verdict = mapAnswerMatchToTeacherVerdict(evaluation.answerMatch);
          dispatchTeacherEvent({
            type: "EVAL_RESULT",
            verdict,
          }, { trigger: `EVAL_RESULT_${evaluation.answerMatch?.tier ?? "miss"}` });
          masteryEvent = buildMasteryEvent({
            expressionId: currentLesson.expression.id,
            verdict,
            atIso: new Date().toISOString(),
            sessionId: session.sessionId,
          });
        } else if (activeMode === "free_talk" && learnerText.trim()) {
          correctionCandidate = buildCorrectionCandidate({
            expressionId: currentLesson.expression.id,
            learnerText,
            suggestion: turn.modelText || evaluation.advisory,
            atIso: new Date().toISOString(),
            sessionId: session.sessionId,
          });
          setCorrectionCandidates((current) => [correctionCandidate as MonaVnextCorrectionCandidate, ...current].slice(0, 8));
          bufferEvent({
            type: "correction_candidate",
            message: "Free-talk correction candidate captured.",
            atIso: new Date().toISOString(),
            detail: {
              expressionId: correctionCandidate.expressionId,
              learnerText: correctionCandidate.learnerText,
              suggestion: correctionCandidate.suggestion,
            },
          });
        }
      } else {
        dispatchTeacherEvent({ type: "MODEL_TURN_COMPLETE" }, { trigger: "MODEL_TURN_COMPLETE" });
      }

      const teacherLesson = lessonStateRef.current;
      const teacherEvent: MonaVnextLogEvent = {
        ...event,
        detail: {
          ...event.detail,
          nextPromptId: teacherLesson.expression.id,
          materialChanged: teacherLesson.expression.id !== currentLesson.expression.id,
          teacherPhase: teacherSessionRef.current.phase,
          teacherStateSeq: teacherSessionRef.current.stateSeq,
        },
      };
      bufferEvent(teacherEvent);
      const flushed = drainPendingEvents();
      postConversationLog("turn", {
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        resumedFromConversationId: session.resumedFromConversationId,
        startedAt: session.startedAt,
        turn,
        events: flushed,
        settings: {
          ...sessionSettings,
          activeExpressionId: teacherLesson.expression.id,
          promptId: teacherLesson.expression.id,
          englishVisible: teacherLesson.englishVisible,
          expressionBank: buildExpressionBankLogSettings(session.expressionBank),
        },
        metrics: metricsRef.current ?? {},
      });
      postMemoryAdvisory({
        conversationId: session.conversationId,
        turnSeq: turn.turnSeq,
        advisory: {
          ...advisory,
          ...(masteryEvent ? { masteryEvents: [masteryEvent] } : {}),
          ...(correctionCandidate ? { correctionCandidates: [correctionCandidate] } : {}),
        },
      });
      if (evaluation.stopRequested) {
        queueMicrotask(() => {
          finalizeSessionRef.current({ reason: "strict-stop" });
        });
      }
      return;
    }

    setAnswerVerdict(p15Gates.answerMatcher ? buildAnswerVerdict(evaluation.answerMatch) : null);
    setEvents((current) => appendEvent(current, event));
    if (controlEvent) {
      setEvents((current) => appendEvent(current, controlEvent));
      sendControlTextRef.current(buildPedagogyControlPrompt(evaluation, currentLesson));
    }
    // Flush buffered partial/lifecycle events together with this turn into a
    // single durable log POST. The writer accumulates events server-side.
    const flushed = drainPendingEvents();
    const turnEvents = controlEvent ? [...flushed, event, controlEvent] : [...flushed, event];
    postConversationLog("turn", {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      resumedFromConversationId: session.resumedFromConversationId,
      startedAt: session.startedAt,
      turn,
      events: turnEvents,
      settings: {
        ...sessionSettings,
        activeExpressionId: nextLesson.expression.id,
        promptId: nextLesson.expression.id,
        englishVisible: nextLesson.englishVisible,
        expressionBank: buildExpressionBankLogSettings(session.expressionBank),
      },
      metrics: metricsRef.current ?? {},
    });
    postMemoryAdvisory({
      conversationId: session.conversationId,
      turnSeq: turn.turnSeq,
      advisory,
    });

    lessonStateRef.current = nextLesson;
    setLessonState(nextLesson);
    if (evaluation.metaQuestionRequested) {
      sendControlTextRef.current(buildMetaQuestionAnswer(currentLesson));
      return;
    }
    if (
      nextLesson.expression.id !== currentLesson.expression.id
      && !evaluation.stopRequested
    ) {
      sendControlTextRef.current(buildNextLessonPrompt(nextLesson, p15Gates.appOwnedNextMaterial));
    }
  }, [
    buildMetaQuestionAnswer,
    buildNextLessonPrompt,
    buildPedagogyControlPrompt,
    buildPostTurnArtifacts,
    bufferEvent,
    dispatchTeacherEvent,
    drainPendingEvents,
    postConversationLog,
    postMemoryAdvisory,
    p15Gates,
    sessionSettings,
    teacherActive,
  ]);

  const handleLiveEvent = useCallback((event: MonaVnextLogEvent) => {
    bufferEvent(event);
    if (!teacherActive || !teacherSessionRef.current) return;

    if (event.type === "go-away") {
      commitTeacherResult(teacherTransition(teacherSessionRef.current, { type: "GO_AWAY" }), {
        trigger: "GO_AWAY",
      });
      return;
    }

    if (
      event.type === "setup-complete-resumed"
      && sessionRef.current?.conversationId !== lastReconnectedConversationRef.current
    ) {
      commitTeacherResult(teacherTransition(teacherSessionRef.current, { type: "RECONNECTED" }), {
        trigger: "RECONNECTED",
      });
      lastReconnectedConversationRef.current = sessionRef.current?.conversationId ?? null;
      return;
    }

    if (event.type === "socket-close-error" || event.type === "session-reconnect-failed") {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const result = teacherTransition(teacherSessionRef.current, { type: "SOCKET_DEAD" });
      commitTeacherResult(result, {
        queueEffects: true,
        trigger: "SOCKET_DEAD",
      });
      const offer: ResumeOffer = {
        fromConversationId: activeSession.conversationId,
        teacherSession: result.session,
        expressionBank: activeSession.expressionBank,
        lessonState: lessonStateRef.current,
      };
      resumeOfferRef.current = offer;
      setResumeOffer(offer);
    }
  }, [bufferEvent, commitTeacherResult, teacherActive]);

  const restorePrewarmedTeacherSession = useCallback((session: MonaVnextSessionResponse) => {
    if (!teacherActive) return;
    const activeResumeOffer = resumeOfferRef.current;
    const baseTeacherSession = activeResumeOffer?.teacherSession ?? teacherSessionRef.current;
    if (!baseTeacherSession) return;

    const previousConversationId = activeResumeOffer?.fromConversationId
      ?? sessionRef.current?.conversationId
      ?? session.resumedFromConversationId
      ?? null;
    const expressionBank = activeResumeOffer?.expressionBank
      ?? sessionRef.current?.expressionBank
      ?? session.expressionBank;
    sessionRef.current = {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      ...(previousConversationId ? { resumedFromConversationId: previousConversationId } : {}),
      startedAt: session.startedAt,
      expressionBank,
    };
    const nextTranscript = createMonaVnextTranscriptState(session.conversationId);
    transcriptStateRef.current = nextTranscript;
    setTranscriptState(nextTranscript);

    const reconnected = teacherTransition(baseTeacherSession, { type: "RECONNECTED" });
    teacherSessionRef.current = reconnected.session;
    pendingTeacherEffectsRef.current = reconnected.effects;
    lastReconnectedConversationRef.current = session.conversationId;
    resumeOfferRef.current = null;
    setResumeOffer(null);

    const nextLesson = teacherSessionToLessonState(reconnected.session, expressionBank.entries);
    lessonStateRef.current = nextLesson;
    setLessonState(nextLesson);
    sessionFinalizedRef.current = false;
    hardStopHandledRef.current = false;
    autoStartConversationRef.current = null;
    bufferEvent({
      type: "session-resumed",
      message: "Teacher session resumed on a pre-warmed Live session.",
      atIso: new Date().toISOString(),
      detail: {
        conversationId: session.conversationId,
        resumedFromConversationId: previousConversationId,
        stateSeq: reconnected.session.stateSeq,
        expressionId: reconnected.session.card?.expressionId ?? null,
      },
    });
  }, [bufferEvent, teacherActive]);

  const live = useGeminiLiveSession({
    settings: sessionSettings,
    clientBuildVersion: BUILD_VERSION,
    enableResumePrewarm: teacherActive,
    onSessionReady: (session) => {
      const activeResumeOffer = resumeOfferRef.current;
      const activeExpressionBank = activeResumeOffer?.expressionBank ?? session.expressionBank;
      pendingEventsRef.current = [];
      sessionRef.current = {
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        ...(session.resumedFromConversationId ? { resumedFromConversationId: session.resumedFromConversationId } : {}),
        startedAt: session.startedAt,
        expressionBank: activeExpressionBank,
      };
      const nextTranscript = createMonaVnextTranscriptState(session.conversationId);
      transcriptStateRef.current = nextTranscript;
      setTranscriptState(nextTranscript);
      const nextLesson = teacherActive
        ? (() => {
          const expressionBank = activeResumeOffer?.expressionBank ?? session.expressionBank;
          if (activeResumeOffer) {
            teacherSessionRef.current = activeResumeOffer.teacherSession;
            const reconnected = teacherTransition(activeResumeOffer.teacherSession, { type: "RECONNECTED" });
            teacherSessionRef.current = reconnected.session;
            pendingTeacherEffectsRef.current = reconnected.effects;
            lastReconnectedConversationRef.current = session.conversationId;
            resumeOfferRef.current = null;
            setResumeOffer(null);
            bufferEvent({
              type: "session-resumed",
              message: "Teacher session resumed on a new Live session.",
              atIso: new Date().toISOString(),
              detail: {
                conversationId: session.conversationId,
                resumedFromConversationId: activeResumeOffer.fromConversationId,
                stateSeq: reconnected.session.stateSeq,
                expressionId: reconnected.session.card?.expressionId ?? null,
              },
            });
            return teacherSessionToLessonState(reconnected.session, expressionBank.entries);
          }
          const created = createTeacherSession({
            mode: studyMode,
            cards: expressionBank.entries.map(monaExpressionToTeacherCard),
            seed: expressionBank.metadata.seed,
          });
          const ready = teacherTransition(created.session, { type: "SESSION_READY" });
          teacherSessionRef.current = ready.session;
          pendingTeacherEffectsRef.current = ready.effects;
          return teacherSessionToLessonState(ready.session, expressionBank.entries);
        })()
        : createInitialLessonState({
          expressionBank: session.expressionBank.entries,
          activeExpressionId: session.settings.activeExpressionId,
          englishVisible: surface === "winddown" ? PRODUCT_INITIAL_ENGLISH_VISIBLE : DEFAULT_SETTINGS.englishVisible,
        });
      lessonStateRef.current = nextLesson;
      setLessonState(nextLesson);
      sessionFinalizedRef.current = false;
      hardStopHandledRef.current = false;
      setAnswerVerdict(null);
      setPersistenceState(createInitialPersistenceState());
      autoStartConversationRef.current = null;
      bufferEvent({
        type: "session-ready",
        message: "Mona vNext owner-test session ready.",
        atIso: new Date().toISOString(),
        detail: {
          sessionId: session.sessionId,
          conversationId: session.conversationId,
          expressionBank: buildExpressionBankLogSettings(activeExpressionBank),
        },
      });
      const materialQuarantine = activeExpressionBank.metadata.materialQuarantine ?? [];
      const materialWarnings = activeExpressionBank.metadata.materialWarnings ?? [];
      if (materialQuarantine.length > 0) {
        bufferEvent({
          type: "material_quarantine",
          message: "Teacher material gate quarantined session-bank entries.",
          atIso: new Date().toISOString(),
          detail: {
            count: materialQuarantine.length,
            entries: materialQuarantine,
          },
        });
      }
      if (materialWarnings.length > 0) {
        bufferEvent({
          type: "material_warning",
          message: "Teacher material gate flagged non-blocking session-bank warnings.",
          atIso: new Date().toISOString(),
          detail: {
            count: materialWarnings.length,
            entries: materialWarnings,
          },
        });
      }
    },
    onSessionResumed: restorePrewarmedTeacherSession,
    onEvent: handleLiveEvent,
    onRecoverFailed: (reason) => {
      bufferEvent({
        type: "session-reconnect-failed",
        message: reason,
        atIso: new Date().toISOString(),
      });
      if (teacherActive) return;
      queueMicrotask(() => {
        finalizeSessionRef.current({ reason: "reconnect-failed" });
      });
    },
    onServerContent: (serverContent) => {
      handleTeacherOutputDrift(serverContent.outputTranscription?.text);
      setTranscriptState((current) => {
        const result = applyMonaVnextServerContent(current, serverContent);
        transcriptStateRef.current = result.state;
        const shouldHardStop = !hardStopHandledRef.current
          && hasStrictMonaVnextStopIntent(result.state.current.userText);
        result.events.forEach((event) => {
          if (event.type === "input-partial" || event.type === "output-partial") {
            bufferEvent({
              type: event.type,
              message: event.text,
              atIso: event.atIso,
            });
            return;
          }
          if (event.type === "turn-complete") {
            persistTurn(event.turn, lessonStateRef.current);
            return;
          }
          bufferEvent({
            type: event.type,
            message: event.type,
            atIso: event.atIso,
          });
        });
        if (shouldHardStop) {
          hardStopHandledRef.current = true;
          queueMicrotask(() => {
            finalizeSessionRef.current({ reason: "strict-stop" });
          });
        }
        return result.state;
      });
    },
  });

  useEffect(() => {
    sendControlTextRef.current = live.sendText;
  }, [live.sendText]);

  useEffect(() => {
    lessonStateRef.current = lessonState;
  }, [lessonState]);

  useEffect(() => {
    transcriptStateRef.current = transcriptState;
  }, [transcriptState]);

  useEffect(() => {
    metricsRef.current = live.metrics;
  }, [live.metrics]);

  const finalizeSession = useCallback(({ reason }: FinalizeOptions) => {
    const session = sessionRef.current;
    if (!session) {
      live.stop("stopped");
      return;
    }
    if (sessionFinalizedRef.current) {
      live.stop("stopped");
      return;
    }
    sessionFinalizedRef.current = true;
    const stoppedAt = new Date().toISOString();
    const pendingTurnResult = finalizePendingMonaVnextTurn(transcriptStateRef.current, stoppedAt);
    transcriptStateRef.current = pendingTurnResult.state;
    setTranscriptState(pendingTurnResult.state);

    const finalTurns = pendingTurnResult.finalizedTurn ? [pendingTurnResult.finalizedTurn] : [];
    const finalTurnEvents: MonaVnextLogEvent[] = [];
    const currentLesson = lessonStateRef.current;
    let finalLesson = currentLesson;

    if (pendingTurnResult.finalizedTurn) {
      const { advisory, nextLesson, event } = buildPostTurnArtifacts(pendingTurnResult.finalizedTurn, currentLesson);
      finalTurnEvents.push(event);
      finalLesson = nextLesson;
      lessonStateRef.current = nextLesson;
      setLessonState(nextLesson);
      const activeSession = sessionRef.current;
      if (activeSession) {
        postMemoryAdvisory({
          conversationId: activeSession.conversationId,
          turnSeq: pendingTurnResult.finalizedTurn.turnSeq,
          advisory,
        });
      }
    }

    live.stop("stopped");
    const finalEvent: MonaVnextLogEvent = {
      type: "session-finalized",
      message: buildFinalEventMessage(reason),
      atIso: stoppedAt,
      detail: { reason },
    };
    const flushed = drainPendingEvents();
    postConversationLog("final", {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      resumedFromConversationId: session.resumedFromConversationId,
      startedAt: session.startedAt,
      final: true,
      stoppedAt,
      ...(finalTurns.length > 0 ? { turns: finalTurns } : {}),
      settings: {
        ...sessionSettings,
        activeExpressionId: finalLesson.expression.id,
        promptId: finalLesson.expression.id,
        englishVisible: finalLesson.englishVisible,
        expressionBank: buildExpressionBankLogSettings(session.expressionBank),
      },
      metrics: metricsRef.current ?? {},
      events: [...flushed, ...finalTurnEvents, finalEvent],
    });
  }, [
    buildPostTurnArtifacts,
    drainPendingEvents,
    live,
    postConversationLog,
    postMemoryAdvisory,
    sessionSettings,
  ]);

  useEffect(() => {
    finalizeSessionRef.current = finalizeSession;
  }, [finalizeSession]);

  useEffect(() => {
    const handlePageHide = () => {
      if (!sessionRef.current || sessionFinalizedRef.current) return;
      finalizeSessionRef.current({ reason: "pagehide" });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  const stopSession = useCallback(() => {
    finalizeSession({ reason: "manual-stop" });
  }, [finalizeSession]);

  const resumeTeacherSession = useCallback(() => {
    const offer = resumeOfferRef.current;
    if (!offer) return;
    bufferEvent({
      type: "resume-requested",
      message: "Learner requested TeacherSession resume on a new Live session.",
      atIso: new Date().toISOString(),
      detail: {
        resumedFromConversationId: offer.fromConversationId,
        expressionId: offer.teacherSession.card?.expressionId ?? offer.lessonState.expression.id,
        stateSeq: offer.teacherSession.stateSeq,
      },
    });
    void live.start({ resumedFromConversationId: offer.fromConversationId });
  }, [bufferEvent, live]);

  const revealAnswer = useCallback(() => {
    const session = sessionRef.current;
    if (!session || sessionFinalizedRef.current) return;
    if (teacherActive) {
      dispatchTeacherEvent({ type: "LEARNER_REVEAL" }, { trigger: "LEARNER_REVEAL" });
      bufferEvent({
        type: "manual-answer-reveal",
        message: "Mona vNext answer reveal button pressed.",
        atIso: new Date().toISOString(),
        detail: {
          promptId: teacherSessionRef.current?.card?.expressionId ?? lessonStateRef.current.expression.id,
          englishVisible: true,
          teacherStateSeq: teacherSessionRef.current?.stateSeq ?? null,
        },
      });
      return;
    }
    const currentLesson = lessonStateRef.current;
    const nextLesson: MonaVnextLessonState = {
      ...currentLesson,
      englishVisible: true,
      expression: {
        ...currentLesson.expression,
        state: "reveal",
      },
    };
    lessonStateRef.current = nextLesson;
    setLessonState(nextLesson);
    bufferEvent({
      type: "manual-answer-reveal",
      message: "Mona vNext answer reveal button pressed.",
      atIso: new Date().toISOString(),
      detail: {
        promptId: currentLesson.expression.id,
        englishVisible: true,
      },
    });
    sendControlTextRef.current([
      "정답은 화면에 보여줬어.",
      `자연스러운 영어는 "${currentLesson.expression.en}"야.`,
      "짧게 한 번 따라 말하게 도와줘.",
    ].join(" "));
  }, [bufferEvent, dispatchTeacherEvent, teacherActive]);

  const advanceLesson = useCallback(() => {
    const session = sessionRef.current;
    if (!session || sessionFinalizedRef.current) return;
    if (teacherActive) {
      const before = teacherSessionRef.current?.card?.expressionId ?? lessonStateRef.current.expression.id;
      dispatchTeacherEvent({ type: "LEARNER_NEXT" }, { trigger: "LEARNER_NEXT" });
      const after = teacherSessionRef.current?.card?.expressionId ?? lessonStateRef.current.expression.id;
      setAnswerVerdict(null);
      bufferEvent({
        type: "manual-next",
        message: "Mona vNext next button advanced prompt.",
        atIso: new Date().toISOString(),
        detail: {
          promptId: before,
          nextPromptId: after,
          materialChanged: after !== before,
          teacherStateSeq: teacherSessionRef.current?.stateSeq ?? null,
        },
      });
      return;
    }
    const currentLesson = lessonStateRef.current;
    const nextExpression = pickNextExpression(
      currentLesson.expression.id,
      currentLesson.promptHistory,
      currentLesson.expressionBank,
    );
    const nextLesson = recordPromptExposure({
      ...currentLesson,
      englishVisible: surface === "winddown" ? PRODUCT_INITIAL_ENGLISH_VISIBLE : currentLesson.englishVisible,
    }, {
      ...nextExpression,
      state: "prompt",
    });
    lessonStateRef.current = nextLesson;
    setLessonState(nextLesson);
    setAnswerVerdict(null);
    bufferEvent({
      type: "manual-next",
      message: "Mona vNext next button advanced prompt.",
      atIso: new Date().toISOString(),
      detail: {
        promptId: currentLesson.expression.id,
        nextPromptId: nextLesson.expression.id,
        materialChanged: nextLesson.expression.id !== currentLesson.expression.id,
      },
    });
    sendControlTextRef.current(buildNextLessonPrompt(nextLesson, p15Gates.appOwnedNextMaterial));
  }, [bufferEvent, buildNextLessonPrompt, dispatchTeacherEvent, p15Gates.appOwnedNextMaterial, surface, teacherActive]);

  useEffect(() => {
    if (teacherActive) {
      if (live.status !== "listening" || !live.session) return;
      if (autoStartConversationRef.current === live.session.conversationId) return;
      if (flushPendingTeacherEffects()) {
        autoStartConversationRef.current = live.session.conversationId;
      }
      return;
    }
    if (surface !== "winddown") return;
    if (live.status !== "listening" || !live.session) return;
    if (autoStartConversationRef.current === live.session.conversationId) return;
    if (live.sendText("시작. 한 문장씩 천천히 해줘.")) {
      autoStartConversationRef.current = live.session.conversationId;
    }
  }, [flushPendingTeacherEffects, live, surface, teacherActive]);

  const windDownCard = useMemo(() => buildWindDownCard(lessonState), [lessonState]);
  const studyModeControls = useMemo(() => ({
    mode: studyMode,
    options: STUDY_MODE_OPTIONS,
    onChange: changeStudyMode,
  }), [changeStudyMode, studyMode]);
  const latestCoachLine = transcriptState.current.modelText
    || [...transcriptState.turns].reverse().find((turn) => Boolean(turn.modelText))?.modelText
    || null;
  const micDeadWarning = live.metrics.micDead ? "마이크가 안 들려. 입력 장치나 권한을 확인해줘." : null;
  const windDownError = persistenceState.conversationSaveError ?? micDeadWarning ?? live.metrics.lastError;

  if (surface === "winddown") {
    const settingsLocked = isWindDownSettingsLocked(live.status);
    return (
      <MonaWindDown
        phase={mapWindDownPhase(live.status)}
        modeLabel="메인"
        message={buildWindDownMessage(live.status)}
        card={live.session ? windDownCard : null}
        coachLine={latestCoachLine}
        errorText={windDownError}
        answerVisible={lessonState.englishVisible}
        voiceName={voiceName}
        vadPreset={vadPreset}
        onVoiceChange={setVoiceName}
        onVadChange={setVadPreset}
        settingsSlot={<MonaVnextEntry locked={settingsLocked} />}
        onStart={live.start}
        onStop={stopSession}
        onRevealAnswer={revealAnswer}
        onNext={advanceLesson}
      />
    );
  }

  return (
    <WindDownVnextShell
      baseline={MONA_VNEXT_BASELINE_LOG}
      promptPolicy={MONA_VNEXT_BASELINE_PROMPT_POLICY}
      namespacePolicy={MONA_VNEXT_NAMESPACE_POLICY}
      status={live.status}
      metrics={live.metrics}
      modelOptions={MONA_VNEXT_GEMINI_MODELS}
      selectedModel={selectedModel}
      onSelectModel={setSelectedModel}
      session={live.session}
      lessonState={lessonState}
      transcriptState={transcriptState}
      events={events}
      lastPersistedFile={persistenceState.lastPersistedFile}
      persistenceError={persistenceState.conversationSaveError}
      modeLabel="실험판"
      activeExperimentalFeatures={activeExperimentalFeatures}
      answerVerdict={p15Gates.answerMatcher ? answerVerdict : null}
      resumeOffer={resumeOffer ? { fromConversationId: resumeOffer.fromConversationId } : null}
      studyModeControls={studyModeControls}
      correctionCandidates={correctionCandidates}
      onStart={live.start}
      onStop={stopSession}
      onResume={resumeTeacherSession}
      onSendStart={sendTeacherStart}
      onRevealAnswer={revealAnswer}
      onNext={advanceLesson}
    />
  );
}
