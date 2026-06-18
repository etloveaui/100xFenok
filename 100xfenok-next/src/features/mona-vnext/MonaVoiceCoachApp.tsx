"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createInitialLessonState,
  type MonaVnextLessonState,
} from "@/features/mona-vnext/coach/coachPolicy";
import { MONA_VNEXT_BASELINE_LOG, MONA_VNEXT_BASELINE_PROMPT_POLICY } from "@/features/mona-vnext/coach/baselineEvidence";
import { applyMonaVnextLessonEvaluation } from "@/features/mona-vnext/coach/lessonFlow";
import { evaluateMonaVnextTurn } from "@/features/mona-vnext/coach/postTurnEvaluator";
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
  type MonaVnextTranscriptState,
} from "@/features/mona-vnext/transcript/transcriptStore";
import { createMonaVnextConversationId, type MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";
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

// Durable event buffer cap, matched to the writer's events.slice(-1000).
const MAX_PENDING_EVENTS = 1000;

type PersistResult = {
  ok?: unknown;
  file?: unknown;
  error?: unknown;
};

function appendEvent(events: MonaVnextLogEvent[], event: MonaVnextLogEvent) {
  return [...events, event].slice(-40);
}

export default function MonaVoiceCoachApp() {
  const [transcriptState, setTranscriptState] = useState<MonaVnextTranscriptState>(
    () => createMonaVnextTranscriptState(createMonaVnextConversationId()),
  );
  const [lessonState, setLessonState] = useState<MonaVnextLessonState>(() => createInitialLessonState());
  const [events, setEvents] = useState<MonaVnextLogEvent[]>([]);
  // Single source of truth for the "저장 실패" banner. Only turn/final
  // conversation saves can set it; partial-event logging never does.
  const [persistenceState, setPersistenceState] = useState(() => createInitialPersistenceState());
  const [selectedModel, setSelectedModel] = useState<MonaVnextGeminiModel>(MONA_VNEXT_DEFAULT_GEMINI_MODEL);
  const sessionRef = useRef<{ sessionId: string; conversationId: string; startedAt: string } | null>(null);
  const lessonStateRef = useRef(lessonState);
  const metricsRef = useRef<MonaVnextSessionMetrics | null>(null);
  const sendControlTextRef = useRef<(text: string) => boolean>(() => false);
  // Best-effort events (partials, lifecycle) accumulate here and are flushed
  // into the next turn/final log POST, instead of one POST per partial.
  const pendingEventsRef = useRef<MonaVnextLogEvent[]>([]);

  const sessionSettings = useMemo(() => ({
    ...DEFAULT_SETTINGS,
    model: selectedModel,
  }), [selectedModel]);

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

  const persistTurn = useCallback((
    turn: MonaVnextTurn,
    currentLesson: MonaVnextLessonState,
  ) => {
    const session = sessionRef.current;
    if (!session) return;
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
        promptId: evaluation.promptId,
        nextPromptId: nextLesson.expression.id,
        materialChanged: nextLesson.expression.id !== currentLesson.expression.id,
        samePromptCount: evaluation.samePromptCount,
        sttDrift: evaluation.sttDrift,
      },
    };
    const controlEvent: MonaVnextLogEvent | null = evaluation.repairRequested
      ? {
        type: "repair-control-injected",
        message: "사용자 불만/무시/인식오류 신호 감지. 다음 진행 금지, 들은 내용 확인 후 다시 시도하도록 Live 모델에 주입.",
        atIso: new Date().toISOString(),
        detail: {
          turnSeq: turn.turnSeq,
          userText: turn.userText,
          modelText: turn.modelText,
        },
      }
      : null;
    setEvents((current) => appendEvent(current, event));
    if (controlEvent) {
      setEvents((current) => appendEvent(current, controlEvent));
      sendControlTextRef.current(
        [
          "[CONTROL]",
          "사용자가 방금 진행을 무시했다고 지적했다.",
          "새 문장으로 넘어가지 말고, 네가 들은 한국어 내용을 짧게 확인한 뒤 다시 한 번 말해달라고 해라.",
          "절대 '해 볼래?', '어때?'처럼 진행하지 마라.",
        ].join(" "),
      );
    }
    // Flush buffered partial/lifecycle events together with this turn into a
    // single durable log POST. The writer accumulates events server-side.
    const flushed = drainPendingEvents();
    const turnEvents = controlEvent ? [...flushed, event, controlEvent] : [...flushed, event];
    postConversationLog("turn", {
      ...session,
      turn,
      events: turnEvents,
      settings: {
        ...sessionSettings,
        promptId: nextLesson.expression.id,
        englishVisible: nextLesson.englishVisible,
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
  }, [drainPendingEvents, postConversationLog, postMemoryAdvisory, sessionSettings]);

  const live = useGeminiLiveSession({
    settings: sessionSettings,
    clientBuildVersion: BUILD_VERSION,
    onSessionReady: (session) => {
      sessionRef.current = {
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        startedAt: session.startedAt,
      };
      setTranscriptState(createMonaVnextTranscriptState(session.conversationId));
      const nextLesson = createInitialLessonState();
      lessonStateRef.current = nextLesson;
      setLessonState(nextLesson);
      pendingEventsRef.current = [];
      setPersistenceState(createInitialPersistenceState());
      bufferEvent({
        type: "session-ready",
        message: "Mona vNext owner-test session ready.",
        atIso: new Date().toISOString(),
        detail: {
          sessionId: session.sessionId,
          conversationId: session.conversationId,
        },
      });
    },
    onEvent: bufferEvent,
    onServerContent: (serverContent) => {
      setTranscriptState((current) => {
        const result = applyMonaVnextServerContent(current, serverContent);
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
    metricsRef.current = live.metrics;
  }, [live.metrics]);

  const stopSession = useCallback(() => {
    const session = sessionRef.current;
    live.stop("stopped");
    if (!session) return;
    const finalEvent: MonaVnextLogEvent = {
      type: "session-finalized",
      message: "Mona vNext session finalized by owner/dev control.",
      atIso: new Date().toISOString(),
    };
    const flushed = drainPendingEvents();
    postConversationLog("final", {
      ...session,
      final: true,
      stoppedAt: new Date().toISOString(),
      settings: sessionSettings,
      metrics: metricsRef.current ?? {},
      events: [...flushed, finalEvent],
    });
  }, [drainPendingEvents, live, postConversationLog, sessionSettings]);

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
