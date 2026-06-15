"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialLessonState,
  type MonaVnextLessonState,
} from "@/features/mona-vnext/coach/coachPolicy";
import { MONA_VNEXT_BASELINE_LOG, MONA_VNEXT_BASELINE_PROMPT_POLICY } from "@/features/mona-vnext/coach/baselineEvidence";
import { applyMonaVnextLessonEvaluation } from "@/features/mona-vnext/coach/lessonFlow";
import { evaluateMonaVnextTurn } from "@/features/mona-vnext/coach/postTurnEvaluator";
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
  voiceName: "Kore",
  vadPreset: "relaxed",
  lowVoice: true,
  interruptionMode: "no-interrupt" as const,
  englishVisible: true,
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
  const sessionRef = useRef<{ sessionId: string; conversationId: string; startedAt: string } | null>(null);
  const lessonStateRef = useRef(lessonState);
  const metricsRef = useRef<MonaVnextSessionMetrics | null>(null);

  const persistEvent = useCallback((event: MonaVnextLogEvent) => {
    setEvents((current) => appendEvent(current, event));
    const session = sessionRef.current;
    if (!session) return;
    void fetch("/api/mona-vnext/log/", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...session,
        event,
        settings: DEFAULT_SETTINGS,
        metrics: metricsRef.current ?? {},
      }),
    }).then((response) => response.json())
      .then((payload: unknown) => {
        if (payload && typeof payload === "object" && "file" in payload && typeof payload.file === "string") {
          setLastPersistedFile(payload.file);
        }
      })
      .catch(() => undefined);
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
    persistEvent(event);
    void fetch("/api/mona-vnext/log/", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...session,
        turn,
        events: [event],
        settings: {
          ...DEFAULT_SETTINGS,
          promptId: nextLesson.expression.id,
          englishVisible: nextLesson.englishVisible,
        },
        metrics: metricsRef.current ?? {},
      }),
    }).then((response) => response.json())
      .then((payload: unknown) => {
        if (payload && typeof payload === "object" && "file" in payload && typeof payload.file === "string") {
          setLastPersistedFile(payload.file);
        }
      })
      .catch(() => undefined);
    void fetch("/api/mona-vnext/memory/", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        conversationId: session.conversationId,
        turnSeq: turn.turnSeq,
        advisory,
      }),
    }).catch(() => undefined);

    lessonStateRef.current = nextLesson;
    setLessonState(nextLesson);
  }, [persistEvent]);

  const live = useGeminiLiveSession({
    settings: DEFAULT_SETTINGS,
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
          if (event.type === "input-partial" || event.type === "output-partial") return;
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
    lessonStateRef.current = lessonState;
  }, [lessonState]);

  useEffect(() => {
    metricsRef.current = live.metrics;
  }, [live.metrics]);

  const stopSession = useCallback(() => {
    const session = sessionRef.current;
    live.stop("stopped");
    if (!session) return;
    void fetch("/api/mona-vnext/log/", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...session,
        final: true,
        stoppedAt: new Date().toISOString(),
        settings: DEFAULT_SETTINGS,
        metrics: metricsRef.current ?? {},
        event: {
          type: "session-finalized",
          message: "Mona vNext session finalized by owner/dev control.",
          atIso: new Date().toISOString(),
        },
      }),
    }).then((response) => response.json())
      .then((payload: unknown) => {
        if (payload && typeof payload === "object" && "file" in payload && typeof payload.file === "string") {
          setLastPersistedFile(payload.file);
        }
      })
      .catch(() => undefined);
  }, [live]);

  return (
    <WindDownVnextShell
      baseline={MONA_VNEXT_BASELINE_LOG}
      promptPolicy={MONA_VNEXT_BASELINE_PROMPT_POLICY}
      namespacePolicy={MONA_VNEXT_NAMESPACE_POLICY}
      status={live.status}
      metrics={live.metrics}
      session={live.session}
      lessonState={lessonState}
      transcriptState={transcriptState}
      events={events}
      lastPersistedFile={lastPersistedFile}
      onStart={live.start}
      onStop={stopSession}
      onSendStart={() => live.sendText("시작. 한 문장씩 천천히 해줘.")}
    />
  );
}
