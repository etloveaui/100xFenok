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
  const [lastPersistedFile, setLastPersistedFile] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<MonaVnextGeminiModel>(MONA_VNEXT_DEFAULT_GEMINI_MODEL);
  const sessionRef = useRef<{ sessionId: string; conversationId: string; startedAt: string } | null>(null);
  const lessonStateRef = useRef(lessonState);
  const metricsRef = useRef<MonaVnextSessionMetrics | null>(null);
  const sendControlTextRef = useRef<(text: string) => boolean>(() => false);

  const sessionSettings = useMemo(() => ({
    ...DEFAULT_SETTINGS,
    model: selectedModel,
  }), [selectedModel]);

  const recordPersistenceError = useCallback((target: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || "UNKNOWN_PERSISTENCE_ERROR");
    const readable = `${target}: ${message}`;
    setPersistenceError(readable);
    setEvents((current) => appendEvent(current, {
      type: "persist-error",
      message: readable.slice(0, 500),
      atIso: new Date().toISOString(),
    }));
  }, []);

  const persistPayload = useCallback((target: "/api/mona-vnext/log/" | "/api/mona-vnext/memory/", body: Record<string, unknown>) => {
    void (async () => {
      try {
        const response = await fetch(target, {
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
        setPersistenceError(null);
        setLastPersistedFile(payload.file);
      } catch (error) {
        recordPersistenceError(target, error);
      }
    })();
  }, [recordPersistenceError]);

  const persistEvent = useCallback((event: MonaVnextLogEvent) => {
    setEvents((current) => appendEvent(current, event));
    const session = sessionRef.current;
    if (!session) return;
    persistPayload("/api/mona-vnext/log/", {
      ...session,
      event,
      settings: sessionSettings,
      metrics: metricsRef.current ?? {},
    });
  }, [persistPayload, sessionSettings]);

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
    persistPayload("/api/mona-vnext/log/", {
      ...session,
      turn,
      events: controlEvent ? [event, controlEvent] : [event],
      settings: {
        ...sessionSettings,
        promptId: nextLesson.expression.id,
        englishVisible: nextLesson.englishVisible,
      },
      metrics: metricsRef.current ?? {},
    });
    persistPayload("/api/mona-vnext/memory/", {
      conversationId: session.conversationId,
      turnSeq: turn.turnSeq,
      advisory,
    });

    lessonStateRef.current = nextLesson;
    setLessonState(nextLesson);
  }, [persistPayload, sessionSettings]);

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
      persistEvent({
        type: "session-ready",
        message: "Mona vNext owner-test session ready.",
        atIso: new Date().toISOString(),
        detail: {
          sessionId: session.sessionId,
          conversationId: session.conversationId,
        },
      });
    },
    onEvent: persistEvent,
    onServerContent: (serverContent) => {
      setTranscriptState((current) => {
        const result = applyMonaVnextServerContent(current, serverContent);
        result.events.forEach((event) => {
          if (event.type === "input-partial" || event.type === "output-partial") {
            persistEvent({
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
          persistEvent({
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
    persistPayload("/api/mona-vnext/log/", {
      ...session,
      final: true,
      stoppedAt: new Date().toISOString(),
      settings: sessionSettings,
      metrics: metricsRef.current ?? {},
      event: {
        type: "session-finalized",
        message: "Mona vNext session finalized by owner/dev control.",
        atIso: new Date().toISOString(),
      },
    });
  }, [live, persistPayload, sessionSettings]);

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
      lastPersistedFile={lastPersistedFile}
      persistenceError={persistenceError}
      onStart={live.start}
      onStop={stopSession}
      onSendStart={() => live.sendText("시작. 한 문장씩 천천히 해줘.")}
    />
  );
}
