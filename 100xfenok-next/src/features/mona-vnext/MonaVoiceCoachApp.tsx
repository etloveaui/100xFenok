"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MonaWindDown, { type WindDownPhase } from "@/components/admin-live/MonaWindDown";
import MonaVnextEntry from "@/components/admin-live/MonaVnextEntry";
import type { ExpressionCard } from "@/components/admin-live/AdminLiveBench";
import {
  createInitialLessonState,
  type MonaVnextLessonState,
  type MonaVnextSessionExpressionBank,
} from "@/features/mona-vnext/coach/coachPolicy";
import { MONA_VNEXT_BASELINE_LOG, MONA_VNEXT_BASELINE_PROMPT_POLICY } from "@/features/mona-vnext/coach/baselineEvidence";
import { applyMonaVnextLessonEvaluation } from "@/features/mona-vnext/coach/lessonFlow";
import { evaluateMonaVnextTurn, type MonaVnextPostTurnEvaluation } from "@/features/mona-vnext/coach/postTurnEvaluator";
import {
  MONA_VNEXT_DEFAULT_GEMINI_MODEL,
  MONA_VNEXT_GEMINI_MODELS,
  type MonaVnextGeminiModel,
} from "@/features/mona-vnext/live/modelOptions";
import { MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE } from "@/features/mona-vnext/live/generationOptions";
import { useGeminiLiveSession, type MonaVnextSessionMetrics } from "@/features/mona-vnext/live/useGeminiLiveSession";
import {
  createInitialPersistenceState,
  reducePersistence,
  type MonaVnextPersistKind,
} from "@/features/mona-vnext/logging/persistenceState";
import type { MonaVnextLogEvent } from "@/features/mona-vnext/logging/voiceLogSchema";
import { MONA_VNEXT_NAMESPACE_POLICY } from "@/features/mona-vnext/memory/monaVnextNamespace";
import { buildMonaVnextSrsAdvisory } from "@/features/mona-vnext/memory/srsAdvisory";
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

type MonaVoiceCoachSurface = "winddown" | "debug";

type Props = {
  surface?: MonaVoiceCoachSurface;
};

type PersistResult = {
  ok?: unknown;
  file?: unknown;
  error?: unknown;
};

type FinalizeReason = "manual-stop" | "strict-stop";

type FinalizeOptions = {
  reason: FinalizeReason;
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

export default function MonaVoiceCoachApp({ surface = "debug" }: Props = {}) {
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
  const [selectedModel, setSelectedModel] = useState<MonaVnextGeminiModel>(MONA_VNEXT_DEFAULT_GEMINI_MODEL);
  const [voiceName, setVoiceName] = useState<string>(DEFAULT_SETTINGS.voiceName);
  const [vadPreset, setVadPreset] = useState<"relaxed" | "balanced">(DEFAULT_SETTINGS.vadPreset);
  const sessionRef = useRef<{
    sessionId: string;
    conversationId: string;
    startedAt: string;
    expressionBank: MonaVnextSessionExpressionBank;
  } | null>(null);
  const lessonStateRef = useRef(lessonState);
  const transcriptStateRef = useRef(transcriptState);
  const metricsRef = useRef<MonaVnextSessionMetrics | null>(null);
  const sendControlTextRef = useRef<(text: string) => boolean>(() => false);
  const finalizeSessionRef = useRef<(options: FinalizeOptions) => void>(() => undefined);
  const sessionFinalizedRef = useRef(false);
  const hardStopHandledRef = useRef(false);
  const autoStartConversationRef = useRef<string | null>(null);
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

  const buildPostTurnArtifacts = useCallback((
    turn: MonaVnextTurn,
    currentLesson: MonaVnextLessonState,
  ) => {
    const evaluation = evaluateMonaVnextTurn(turn, currentLesson);
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
      },
    };
    const controlEvent: MonaVnextLogEvent | null = evaluation.pedagogyAction === "hold"
      || evaluation.pedagogyAction === "teach_slow"
      || evaluation.pedagogyAction === "repair"
      || evaluation.pedagogyAction === "intervene"
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
  }, []);

  const buildMetaQuestionAnswer = useCallback((currentLesson: MonaVnextLessonState) => (
    [
      `지금 준비된 문장은 ${currentLesson.expressionBank.length}개야.`,
      `현재 문장은 "${currentLesson.expression.ko}"이고, 영어 목표는 "${currentLesson.expression.en}"야.`,
      "짧게 직접 답한 뒤 이 문장으로 돌아와.",
    ].join(" ")
  ), []);

  const buildNextLessonPrompt = useCallback((nextLesson: MonaVnextLessonState) => (
    [
      "새 문장으로 자연스럽게 넘어가.",
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
        `반복 한계에 닿았다. 자동으로 넘기지 말고 "${firstHint}" 힌트만 주고, 계속할지 다음으로 갈지 모나가 직접 말하게 해.`,
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
      sendControlTextRef.current(buildNextLessonPrompt(nextLesson));
    }
  }, [
    buildMetaQuestionAnswer,
    buildNextLessonPrompt,
    buildPedagogyControlPrompt,
    buildPostTurnArtifacts,
    drainPendingEvents,
    postConversationLog,
    postMemoryAdvisory,
    sessionSettings,
  ]);

  const live = useGeminiLiveSession({
    settings: sessionSettings,
    clientBuildVersion: BUILD_VERSION,
    onSessionReady: (session) => {
      sessionRef.current = {
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        startedAt: session.startedAt,
        expressionBank: session.expressionBank,
      };
      const nextTranscript = createMonaVnextTranscriptState(session.conversationId);
      transcriptStateRef.current = nextTranscript;
      setTranscriptState(nextTranscript);
      const nextLesson = createInitialLessonState({
        expressionBank: session.expressionBank.entries,
        activeExpressionId: session.settings.activeExpressionId,
        englishVisible: surface === "winddown" ? PRODUCT_INITIAL_ENGLISH_VISIBLE : DEFAULT_SETTINGS.englishVisible,
      });
      lessonStateRef.current = nextLesson;
      setLessonState(nextLesson);
      pendingEventsRef.current = [];
      sessionFinalizedRef.current = false;
      hardStopHandledRef.current = false;
      setPersistenceState(createInitialPersistenceState());
      autoStartConversationRef.current = null;
      bufferEvent({
        type: "session-ready",
        message: "Mona vNext owner-test session ready.",
        atIso: new Date().toISOString(),
        detail: {
          sessionId: session.sessionId,
          conversationId: session.conversationId,
          expressionBank: buildExpressionBankLogSettings(session.expressionBank),
        },
      });
    },
    onEvent: bufferEvent,
    onServerContent: (serverContent) => {
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
      message: reason === "strict-stop"
        ? "Mona vNext session finalized by strict stop phrase."
        : "Mona vNext session finalized by owner/dev control.",
      atIso: stoppedAt,
      detail: { reason },
    };
    const flushed = drainPendingEvents();
    postConversationLog("final", {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
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

  const stopSession = useCallback(() => {
    finalizeSession({ reason: "manual-stop" });
  }, [finalizeSession]);

  useEffect(() => {
    if (surface !== "winddown") return;
    if (live.status !== "listening" || !live.session) return;
    if (autoStartConversationRef.current === live.session.conversationId) return;
    if (live.sendText("시작. 한 문장씩 천천히 해줘.")) {
      autoStartConversationRef.current = live.session.conversationId;
    }
  }, [live, surface]);

  const windDownCard = useMemo(() => buildWindDownCard(lessonState), [lessonState]);
  const latestCoachLine = transcriptState.current.modelText
    || [...transcriptState.turns].reverse().find((turn) => Boolean(turn.modelText))?.modelText
    || null;
  const windDownError = persistenceState.conversationSaveError ?? live.metrics.lastError;

  if (surface === "winddown") {
    const settingsLocked = isWindDownSettingsLocked(live.status);
    return (
      <MonaWindDown
        phase={mapWindDownPhase(live.status)}
        message={buildWindDownMessage(live.status)}
        card={live.session ? windDownCard : null}
        coachLine={latestCoachLine}
        errorText={windDownError}
        voiceName={voiceName}
        vadPreset={vadPreset}
        onVoiceChange={setVoiceName}
        onVadChange={setVadPreset}
        settingsSlot={<MonaVnextEntry locked={settingsLocked} />}
        onStart={live.start}
        onStop={stopSession}
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
      onStart={live.start}
      onStop={stopSession}
      onSendStart={() => live.sendText("시작. 한 문장씩 천천히 해줘.")}
    />
  );
}
