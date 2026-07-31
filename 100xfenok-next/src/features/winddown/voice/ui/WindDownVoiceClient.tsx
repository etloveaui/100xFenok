"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGeminiLiveTransport } from "@/features/mona-vnext/live/useGeminiLiveTransport";
import type { MonaVnextServerContent } from "@/features/mona-vnext/live/liveProtocol";
import {
  applyMonaVnextServerContent,
  createMonaVnextTranscriptState,
  discardPendingMonaVnextTranscript,
  type MonaVnextTranscriptState,
} from "@/features/mona-vnext/transcript/transcriptStore";
import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";
import {
  WIND_DOWN_LIVE_TALK_TOPICS,
  WINDDOWN_VOICE_SCENARIOS,
  createWindDownLiveTalkDescriptor,
  createWindDownRoleplayDescriptor,
  evaluateWindDownRoleplay,
  summarizeWindDownLiveTalk,
  type WindDownVoiceActivity,
  type WindDownVoiceDescriptor,
  type WindDownVoiceFinalizedTurn,
} from "@/features/winddown/voice/product";
import {
  WIND_DOWN_VOICE_DEFAULT_SETTINGS,
  requestWindDownVoiceSession,
  type WindDownVoiceClientSettings,
  type WindDownVoiceSessionRequestOptions,
} from "@/features/winddown/voice/clientContract";
import type { WindDownVoiceSessionResponse } from "@/features/winddown/voice/sessionContract";
import {
  buildWindDownVoiceReport,
  isWindDownVoiceReportResponse,
  type WindDownVoiceCompletionReason,
  type WindDownVoiceReport,
  type WindDownVoiceReportReceipt,
} from "@/features/winddown/voice/report";
import {
  hasReachedWindDownVoiceTurnLimit,
  serializeWindDownVoiceKeepaliveBody,
  shouldFinalizeWindDownVoiceForVisibility,
  windDownVoiceTimeoutDelays,
} from "@/features/winddown/voice/ui/mobileVoiceSafety";

const REPORT_ENDPOINT = "/api/winddown/live/report/" as const;

type Props = {
  activity: WindDownVoiceActivity;
};

type ReportState =
  | { phase: "idle"; frozen: null; receipt: null; error: null }
  | { phase: "pending"; frozen: WindDownVoiceReport; receipt: null; error: null }
  | { phase: "success"; frozen: WindDownVoiceReport; receipt: WindDownVoiceReportReceipt; error: null }
  | { phase: "error"; frozen: WindDownVoiceReport; receipt: null; error: string }
  | { phase: "build-error"; frozen: null; receipt: null; error: string };

function createProductSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `winddown-voice-${crypto.randomUUID()}`;
  }
  return `winddown-voice-${Date.now().toString(36)}`;
}

function startConversationId() {
  return `winddown-local-${Date.now().toString(36)}`;
}

function toFinalizedTurn(turn: MonaVnextTurn): WindDownVoiceFinalizedTurn {
  return {
    conversationId: turn.conversationId,
    turnSeq: turn.turnSeq,
    userText: turn.userText,
    modelText: turn.modelText,
    finalized: true,
    sttDrift: turn.sttDrift,
    interrupted: turn.interrupted,
    ...(extractTranscriptCorrection(turn.modelText) ? { correctionText: extractTranscriptCorrection(turn.modelText) } : {}),
  };
}

/** The correction remains a literal model-transcript excerpt for this turn. */
function extractTranscriptCorrection(modelText: string | null) {
  const text = modelText?.trim().replace(/\s+/g, " ") ?? "";
  if (!text) return null;
  const match = text.match(/(?:try saying|say|instead|자연스럽게는|이렇게 말해)[^.!?]{0,180}[.!?]?/i);
  return match?.[0]?.trim() || null;
}

function mergeTurn(
  current: readonly WindDownVoiceFinalizedTurn[],
  next: WindDownVoiceFinalizedTurn,
) {
  const key = `${next.conversationId}:${next.turnSeq}`;
  const priorIndex = current.findIndex((turn) => `${turn.conversationId}:${turn.turnSeq}` === key);
  if (priorIndex < 0) return [...current, next];
  return current.map((turn, index) => index === priorIndex ? next : turn);
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatLatency(milliseconds: number | null | undefined) {
  return milliseconds === null ? "—" : `${milliseconds}ms`;
}

function reportErrorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "보고서를 저장하지 못했어.";
}

function statusCopy(status: string, error: string | null | undefined) {
  if (status === "listening") return "루미가 듣고 있어";
  if (status === "connecting" || status === "setup-wait" || status === "stopping") return "안전하게 연결하는 중";
  if (status === "blocked") return "마이크 권한 또는 보안 연결을 확인해줘";
  if (status === "error") return error ?? "연결이 잠시 멈췄어";
  return "준비되면 시작해줘";
}

export default function WindDownVoiceClient({ activity }: Props) {
  const defaultDescriptor = useMemo<WindDownVoiceDescriptor>(() => (
    activity === "roleplay"
      ? createWindDownRoleplayDescriptor(WINDDOWN_VOICE_SCENARIOS[0].id)
      : createWindDownLiveTalkDescriptor(WIND_DOWN_LIVE_TALK_TOPICS[0].id)
  ), [activity]);
  const [descriptor, setDescriptor] = useState<WindDownVoiceDescriptor>(defaultDescriptor);
  const [settings, setSettings] = useState<WindDownVoiceClientSettings>(WIND_DOWN_VOICE_DEFAULT_SETTINGS);
  const [transcriptState, setTranscriptState] = useState<MonaVnextTranscriptState>(
    () => createMonaVnextTranscriptState(startConversationId()),
  );
  const transcriptRef = useRef(transcriptState);
  const [turns, setTurns] = useState<WindDownVoiceFinalizedTurn[]>([]);
  const turnsRef = useRef<WindDownVoiceFinalizedTurn[]>([]);
  const conversationIdsRef = useRef<string[]>([]);
  const sessionProofsRef = useRef<string[]>([]);
  const startedAtRef = useRef<string | null>(null);
  const listeningStartedAtMsRef = useRef<number | null>(null);
  const lastMeaningfulInputAtMsRef = useRef<number | null>(null);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionLimitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [meaningfulInputEpoch, setMeaningfulInputEpoch] = useState(0);
  const hasStartedVoiceSessionRef = useRef(false);
  const productSessionIdRef = useRef(createProductSessionId());
  const finalizingRef = useRef(false);
  const finishAndReportRef = useRef<(reason: WindDownVoiceCompletionReason, keepalive?: boolean) => void>(() => undefined);
  const autoBeginConversationRef = useRef<string | null>(null);
  const [reportState, setReportState] = useState<ReportState>({
    phase: "idle",
    frozen: null,
    receipt: null,
    error: null,
  });

  useEffect(() => {
    setDescriptor(defaultDescriptor);
  }, [defaultDescriptor]);

  const appendTurn = useCallback((turn: MonaVnextTurn) => {
    const normalized = toFinalizedTurn(turn);
    const next = mergeTurn(turnsRef.current, normalized);
    turnsRef.current = next;
    setTurns(next);
    if (hasReachedWindDownVoiceTurnLimit(next.length)) {
      queueMicrotask(() => finishAndReportRef.current("session-limit"));
    }
  }, []);

  const onServerContent = useCallback((content: MonaVnextServerContent) => {
    // Partial STT may keep the active conversation alive, but it is never
    // persisted as a learner turn. Only applyMonaVnextServerContent's
    // provider-confirmed turnComplete result reaches appendTurn below.
    if (content.inputTranscription?.text?.trim()) {
      lastMeaningfulInputAtMsRef.current = Date.now();
      setMeaningfulInputEpoch((current) => current + 1);
    }
    const result = applyMonaVnextServerContent(transcriptRef.current, content);
    transcriptRef.current = result.state;
    setTranscriptState(result.state);
    if (result.finalizedTurn) appendTurn(result.finalizedTurn);
  }, [appendTurn]);

  const registerTransportSession = useCallback((session: WindDownVoiceSessionResponse) => {
    const conversationId = session.conversationId;
    if (!conversationIdsRef.current.includes(conversationId)) {
      conversationIdsRef.current = [...conversationIdsRef.current, conversationId];
      sessionProofsRef.current = [...sessionProofsRef.current, session.reportProof];
    }
    startedAtRef.current ??= session.startedAt;
    hasStartedVoiceSessionRef.current = true;
    const current = transcriptRef.current;
    if (current.conversationId !== conversationId) {
      // A replacement/resume must discard incomplete provider text. It has not
      // received Gemini's turnComplete and is therefore not report evidence.
      const next = createMonaVnextTranscriptState(conversationId);
      transcriptRef.current = next;
      setTranscriptState(next);
    }
    autoBeginConversationRef.current = null;
  }, []);

  const discardPendingTranscript = useCallback((session: WindDownVoiceSessionResponse) => {
    // A resumed socket is a provider boundary even when Gemini reuses the
    // conversation id. Never let pre-reconnect partial STT cross that boundary
    // and become evidence after a later turnComplete.
    const current = transcriptRef.current;
    const next = current.conversationId === session.conversationId
      ? discardPendingMonaVnextTranscript(current)
      : createMonaVnextTranscriptState(session.conversationId);
    transcriptRef.current = next;
    setTranscriptState(next);
    autoBeginConversationRef.current = null;
  }, []);

  const requestSession = useCallback((options: WindDownVoiceSessionRequestOptions) => {
    return requestWindDownVoiceSession({
      descriptor,
      settings: options.settings,
      productSessionId: options.productSessionId,
      resumedFromConversationId: options.resumedFromConversationId,
    });
  }, [descriptor]);
  const getSessionRequestContext = useCallback(() => ({
    productSessionId: productSessionIdRef.current,
  }), []);

  const live = useGeminiLiveTransport<
    WindDownVoiceClientSettings,
    WindDownVoiceSessionResponse,
    Pick<WindDownVoiceSessionRequestOptions, "productSessionId">
  >({
    settings,
    requestSession,
    getSessionRequestContext,
    onServerContent,
    onSessionReady: registerTransportSession,
    onSessionResuming: discardPendingTranscript,
    onSessionResumed: registerTransportSession,
    onRecoverFailed: () => {
      queueMicrotask(() => finishAndReportRef.current("reconnect-failed"));
    },
    onFatalError: () => {
      queueMicrotask(() => finishAndReportRef.current("session-error"));
    },
  });

  const liveStatus = live.status;
  const liveSession = live.session;
  const sendLiveText = live.sendText;

  useEffect(() => {
    if (liveStatus !== "listening" || !liveSession) return;
    if (autoBeginConversationRef.current === liveSession.conversationId) return;
    if (sendLiveText("Begin now.")) autoBeginConversationRef.current = liveSession.conversationId;
  }, [liveSession, liveStatus, sendLiveText]);

  const roleplay = useMemo(() => {
    if (descriptor.activity !== "roleplay") return null;
    const scenario = WINDDOWN_VOICE_SCENARIOS.find((item) => item.id === descriptor.scenarioId);
    return scenario ? evaluateWindDownRoleplay(scenario, turns) : null;
  }, [descriptor, turns]);
  const liveTalkSummary = useMemo(() => summarizeWindDownLiveTalk({
    turns,
    startedAtIso: startedAtRef.current,
    endedAtIso: live.status === "stopped" ? new Date().toISOString() : null,
  }), [live.status, turns]);

  const submitFrozenReport = useCallback(async (
    report: WindDownVoiceReport,
    serialized: { body: string; byteLength: number },
    keepalive = false,
  ) => {
    setReportState({ phase: "pending", frozen: report, receipt: null, error: null });
    try {
      const response = await fetch(REPORT_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        keepalive,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: serialized.body,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isWindDownVoiceReportResponse(payload)) {
        throw new Error(`WIND_DOWN_VOICE_REPORT_HTTP_${response.status}`);
      }
      setReportState({ phase: "success", frozen: report, receipt: payload.receipt, error: null });
    } catch (error) {
      setReportState({ phase: "error", frozen: report, receipt: null, error: reportErrorText(error) });
    }
  }, []);

  const finishAndReport = useCallback((completionReason: WindDownVoiceCompletionReason, keepalive = false) => {
    if (
      finalizingRef.current
      || reportState.phase === "pending"
      || !hasStartedVoiceSessionRef.current
      || !startedAtRef.current
      || conversationIdsRef.current.length === 0
    ) return;
    finalizingRef.current = true;
    try {
      const stoppedAtIso = new Date().toISOString();
      // Do not flush transcriptState.current here: it can contain only a
      // partial STT packet when the learner stops, the page hides, or a socket
      // changes. `turnsRef` contains provider-confirmed turnComplete turns.
      const finalTurns = turnsRef.current;
      const report = buildWindDownVoiceReport({
        schemaVersion: 1,
        productSessionId: productSessionIdRef.current,
        activity,
        descriptor,
        conversationIds: conversationIdsRef.current,
        sessionProofs: sessionProofsRef.current,
        startedAtIso: startedAtRef.current,
        stoppedAtIso,
        completionReason,
        turns: finalTurns,
        metrics: {
          sessionPostMs: live.metrics.sessionPostMs,
          socketOpenMs: live.metrics.socketOpenMs,
          setupDoneMs: live.metrics.setupDoneMs,
          firstResponseMs: live.metrics.firstResponseMs,
          lastResponseLatencyMs: live.metrics.lastResponseLatencyMs,
          responseLatencySamplesMs: live.metrics.responseLatencySamplesMs,
          reconnectCount: live.metrics.reconnectCount,
          audioFramesSent: live.metrics.audioFramesSent,
          inputSampleRate: live.metrics.inputSampleRate,
          turnCount: live.metrics.turnCount,
          interruptionCount: live.metrics.interruptionCount,
        },
      });
      const serialized = serializeWindDownVoiceKeepaliveBody(report);
      live.stop("stopped");
      void submitFrozenReport(report, serialized, keepalive).finally(() => {
        finalizingRef.current = false;
      });
    } catch {
      finalizingRef.current = false;
      live.stop("error");
      setReportState({
        phase: "build-error",
        frozen: null,
        receipt: null,
        error: "대화 기록을 안전하게 정리하지 못했어. 다시 시작해줘.",
      });
    }
  }, [activity, descriptor, live, reportState.phase, submitFrozenReport]);

  useEffect(() => {
    finishAndReportRef.current = finishAndReport;
  }, [finishAndReport]);

  useEffect(() => {
    const onPageHide = () => finishAndReportRef.current("pagehide", true);
    const onVisibilityChange = () => {
      if (shouldFinalizeWindDownVoiceForVisibility(document.visibilityState)) {
        finishAndReportRef.current("pagehide", true);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const clearTimeouts = () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
      if (sessionLimitTimeoutRef.current) clearTimeout(sessionLimitTimeoutRef.current);
      idleTimeoutRef.current = null;
      sessionLimitTimeoutRef.current = null;
    };
    clearTimeouts();
    if (live.status !== "listening" || reportState.phase !== "idle") return clearTimeouts;

    const nowMs = Date.now();
    listeningStartedAtMsRef.current ??= nowMs;
    lastMeaningfulInputAtMsRef.current ??= nowMs;
    const delays = windDownVoiceTimeoutDelays({
      nowMs,
      listeningStartedAtMs: listeningStartedAtMsRef.current,
      lastMeaningfulInputAtMs: lastMeaningfulInputAtMsRef.current,
    });
    idleTimeoutRef.current = setTimeout(() => {
      finishAndReportRef.current("idle-timeout");
    }, delays.idleDelayMs);
    sessionLimitTimeoutRef.current = setTimeout(() => {
      finishAndReportRef.current("session-limit");
    }, delays.sessionLimitDelayMs);
    return clearTimeouts;
  }, [live.status, meaningfulInputEpoch, reportState.phase]);

  useEffect(() => {
    if (
      activity === "roleplay"
      && roleplay?.completed
      && live.status === "listening"
      && !finalizingRef.current
    ) {
      finishAndReport("scenario-goals-complete");
    }
  }, [activity, finishAndReport, live.status, roleplay?.completed]);

  const start = useCallback(() => {
    if (live.status === "listening" || live.status === "connecting" || live.status === "setup-wait") return;
    finalizingRef.current = false;
    turnsRef.current = [];
    setTurns([]);
    conversationIdsRef.current = [];
    sessionProofsRef.current = [];
    startedAtRef.current = null;
    listeningStartedAtMsRef.current = null;
    lastMeaningfulInputAtMsRef.current = null;
    hasStartedVoiceSessionRef.current = false;
    productSessionIdRef.current = createProductSessionId();
    autoBeginConversationRef.current = null;
    const freshTranscript = createMonaVnextTranscriptState(startConversationId());
    transcriptRef.current = freshTranscript;
    setTranscriptState(freshTranscript);
    setReportState({ phase: "idle", frozen: null, receipt: null, error: null });
    void live.start();
  }, [live]);

  const reportRetry = useCallback(() => {
    if (reportState.phase !== "error") return;
    try {
      void submitFrozenReport(
        reportState.frozen,
        serializeWindDownVoiceKeepaliveBody(reportState.frozen),
      );
    } catch {
      setReportState({
        phase: "build-error",
        frozen: null,
        receipt: null,
        error: "보고서 크기를 안전한 전송 한도 안에 넣지 못했어. 저장되었다고 표시하지 않을게.",
      });
    }
  }, [reportState, submitFrozenReport]);

  const error = live.metrics.lastError;
  const listening = live.status === "listening";
  const busy = live.status === "connecting" || live.status === "setup-wait" || live.status === "stopping";
  const heading = activity === "roleplay" ? "작은 장면을 끝까지" : "그냥, 오늘을 말해도 돼";
  const activeTitle = descriptor.activity === "roleplay"
    ? WINDDOWN_VOICE_SCENARIOS.find((scenario) => scenario.id === descriptor.scenarioId)?.title
    : WIND_DOWN_LIVE_TALK_TOPICS.find((topic) => topic.id === descriptor.topicId)?.title;
  const latestCoachLine = transcriptState.current.modelText
    || [...transcriptState.turns].reverse().find((turn) => turn.modelText)?.modelText
    || null;

  return (
    <div className={`min-h-[100dvh] overflow-x-hidden ${activity === "roleplay" ? "bg-[#171322] text-white" : "bg-[#102622] text-[#f4fff7]"}`}>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),18px)]">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-[11px] font-black tracking-[0.18em] ${activity === "roleplay" ? "text-[#d8b4fe]" : "text-[#9ee7c4]"}`}>
              WIND DOWN · {activity === "roleplay" ? "ROLEPLAY" : "LIVE TALK"}
            </p>
            <h1 className="mt-1 text-[24px] font-black tracking-tight">{heading}</h1>
          </div>
          <Link
            href="/winddown"
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/20 px-4 text-xs font-black text-white/75 transition active:scale-[.98] motion-reduce:transition-none"
          >
            나가기
          </Link>
        </header>

        <main className="flex flex-1 flex-col py-6">
          {activity === "roleplay" ? (
            <section className="rounded-[28px] border border-white/10 bg-white/[.07] p-5 shadow-2xl">
              <p className="text-[11px] font-black tracking-[.15em] text-[#d8b4fe]">SCENE</p>
              <h2 className="mt-2 text-xl font-black">{activeTitle}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/70">
                {roleplay?.scenario.scene}
              </p>
              {!listening && !busy && reportState.phase === "idle" ? (
                <div className="mt-5 grid gap-2">
                  {WINDDOWN_VOICE_SCENARIOS.map((scenario) => (
                    <button
                      key={scenario.id}
                      type="button"
                      aria-pressed={descriptor.activity === "roleplay" && descriptor.scenarioId === scenario.id}
                      onClick={() => setDescriptor(createWindDownRoleplayDescriptor(scenario.id))}
                      className={`min-h-[64px] rounded-2xl border px-4 text-left transition active:scale-[.98] motion-reduce:transition-none ${descriptor.activity === "roleplay" && descriptor.scenarioId === scenario.id ? "border-[#d8b4fe] bg-[#a855f7]/25" : "border-white/10 bg-black/10"}`}
                    >
                      <span className="block text-sm font-black">{scenario.title}</span>
                      <span className="mt-0.5 block text-xs font-semibold text-white/60">{scenario.scene}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-5 space-y-2">
                {roleplay?.scenario.goals.map((goal) => {
                  const evidence = roleplay.evidence.find((item) => item.goalId === goal.id);
                  return (
                    <div key={goal.id} className={`flex min-h-[44px] items-center gap-3 rounded-2xl px-4 text-sm font-bold ${evidence ? "bg-[#a855f7]/30 text-white" : "bg-black/15 text-white/60"}`}>
                      <span aria-hidden>{evidence ? "✓" : "○"}</span>
                      <span className="min-w-0 flex-1">{goal.label}</span>
                      {evidence ? <span className="text-[11px] tabular-nums text-white/70">turn {evidence.turnSeq}</span> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="rounded-[32px] border border-[#9ee7c4]/25 bg-[radial-gradient(circle_at_top,#2f6c57,transparent_62%),#173831] p-6 shadow-2xl">
              <p className="text-[11px] font-black tracking-[.16em] text-[#9ee7c4]">OPEN CONVERSATION</p>
              <h2 className="mt-3 text-[28px] font-black leading-tight">{activeTitle}</h2>
              <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-[#d7f7e4]/75">
                {descriptor.activity === "live-talk" && WIND_DOWN_LIVE_TALK_TOPICS.find((topic) => topic.id === descriptor.topicId)?.scene}
              </p>
              {!listening && !busy && reportState.phase === "idle" ? (
                <div className="mt-6 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {WIND_DOWN_LIVE_TALK_TOPICS.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      aria-pressed={descriptor.activity === "live-talk" && descriptor.topicId === topic.id}
                      onClick={() => setDescriptor(createWindDownLiveTalkDescriptor(topic.id))}
                      className={`min-h-[64px] min-w-[190px] rounded-2xl border px-4 text-left transition active:scale-[.98] motion-reduce:transition-none ${descriptor.activity === "live-talk" && descriptor.topicId === topic.id ? "border-[#9ee7c4] bg-[#9ee7c4]/15" : "border-white/10 bg-black/10"}`}
                    >
                      <span className="block text-sm font-black">{topic.title}</span>
                      <span className="mt-1 block text-xs font-semibold text-[#d7f7e4]/65">{topic.openingLine}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-7 grid grid-cols-2 gap-2 text-center">
                <div className="min-w-0 rounded-2xl bg-black/15 px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[#9ee7c4]">대화</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{formatDuration(liveTalkSummary.durationSeconds)}</p>
                </div>
                <div className="min-w-0 rounded-2xl bg-black/15 px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[#9ee7c4]">내 말</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{liveTalkSummary.cleanLearnerTurns}</p>
                </div>
                <div className="min-w-0 rounded-2xl bg-black/15 px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[#9ee7c4]">끊김</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{liveTalkSummary.interruptedTurnCount}</p>
                </div>
                <div className="min-w-0 rounded-2xl bg-black/15 px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[#9ee7c4]">응답</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{formatLatency(live.metrics.lastResponseLatencyMs)}</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-[#d7f7e4]/55">전사→첫 오디오 · {live.metrics.responseLatencySamplesMs.length}회</p>
                </div>
              </div>
            </section>
          )}

          <section className="mt-5 flex min-h-[170px] flex-1 flex-col justify-end rounded-[28px] border border-white/10 bg-black/15 p-5">
            <p className="text-[11px] font-black tracking-[.14em] text-white/45">LUMI</p>
            <p aria-live="polite" className="mt-2 text-[17px] font-bold leading-relaxed">
              {latestCoachLine ?? statusCopy(live.status, error)}
            </p>
            {transcriptState.current.userText ? (
              <p className="mt-4 border-t border-white/10 pt-3 text-sm font-semibold leading-6 text-white/60">
                나: {transcriptState.current.userText}
              </p>
            ) : null}
          </section>

          {liveTalkSummary.highlightTurnSeqs.length > 0 && activity === "live-talk" ? (
            <p className="mt-3 text-center text-xs font-semibold text-[#b5e9cd]">
              다시 볼 대화 {liveTalkSummary.highlightTurns.map((turn) => `#${turn.turnSeq}`).join(" · ")}
            </p>
          ) : null}

          {reportState.phase === "success" ? (
            <section aria-live="polite" className="mt-5 rounded-[28px] border border-[#9ee7c4]/35 bg-[#9ee7c4]/10 p-5">
              <p className="text-2xl" aria-hidden>✓</p>
              <h2 className="mt-2 text-lg font-black">오늘의 대화가 정리됐어.</h2>
              {reportState.frozen.outcome.kind === "roleplay" ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-semibold text-white/75">
                    목표 {reportState.frozen.outcome.goalResults.filter((goal) => goal.completed).length}/{reportState.frozen.outcome.goalResults.length}개를 채웠어.
                  </p>
                  {reportState.frozen.outcome.evidence.map((evidence) => (
                    <p key={`${evidence.conversationId}:${evidence.turnSeq}:${evidence.goalId}`} className="rounded-xl bg-black/15 px-3 py-2 text-xs font-semibold text-white/75">
                      {evidence.matchedPhrase} · turn {evidence.turnSeq}
                    </p>
                  ))}
                  {reportState.frozen.outcome.corrections.map((correction) => (
                    <p key={`${correction.conversationId}:${correction.turnSeq}:${correction.correctionText}`} className="rounded-xl bg-black/15 px-3 py-2 text-xs font-semibold text-white/75">
                      turn {correction.turnSeq} · {correction.correctionText}
                    </p>
                  ))}
                  <p className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white/85">
                    다음 한 번: {reportState.frozen.outcome.nextPracticeSuggestion.text}
                  </p>
                </div>
              ) : (
                <div className="mt-3 space-y-2 text-sm font-semibold text-white/75">
                  <p>깨끗하게 남은 내 말 {reportState.frozen.outcome.cleanLearnerTurns}개 · 끊김 {reportState.frozen.outcome.interruptedTurnCount}회</p>
                  <p>응답 {formatLatency(reportState.frozen.metrics.lastResponseLatencyMs ?? null)} <span className="text-xs text-white/55">전사→첫 오디오 기준 · {reportState.frozen.metrics.responseLatencySamplesMs?.length ?? 0}회</span></p>
                  {reportState.frozen.outcome.highlightTurns.length > 0 ? <p className="text-xs text-white/60">다시 볼 turn {reportState.frozen.outcome.highlightTurns.map((turn) => turn.turnSeq).join(" · ")}</p> : null}
                </div>
              )}
              <p className="mt-3 text-xs font-semibold text-white/50">
                {reportState.receipt.committedAtIso.slice(0, 16).replace("T", " ")}
              </p>
              <button type="button" onClick={start} className="mt-5 min-h-[48px] w-full rounded-2xl bg-white px-4 text-sm font-black text-[#173831] active:scale-[.98] motion-reduce:transition-none">다른 대화 시작</button>
            </section>
          ) : null}

          {reportState.phase === "error" || reportState.phase === "build-error" ? (
            <section role="alert" className="mt-5 rounded-[28px] border border-[#f6b2a4]/45 bg-[#8f2e27]/30 p-5 text-center">
              <h2 className="text-lg font-black">
                {reportState.phase === "error" ? "대화는 끝났지만 보고를 저장하지 못했어." : "대화를 정리하지 못했어."}
              </h2>
              <p className="mt-2 text-sm font-semibold text-white/75">{reportState.error}</p>
              {reportState.phase === "error" ? (
                <button type="button" onClick={reportRetry} className="mt-5 min-h-[48px] w-full rounded-2xl bg-white px-4 text-sm font-black text-[#8f2e27] active:scale-[.98] motion-reduce:transition-none">같은 보고서 다시 저장</button>
              ) : (
                <button type="button" onClick={start} className="mt-5 min-h-[48px] w-full rounded-2xl bg-white px-4 text-sm font-black text-[#8f2e27] active:scale-[.98] motion-reduce:transition-none">대화 다시 시작</button>
              )}
            </section>
          ) : null}
        </main>

        <footer className="pt-3">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs font-bold text-white/55">
            <span>{statusCopy(live.status, error)}</span>
            <button
              type="button"
              onClick={() => setSettings((current) => ({
                ...current,
                vadPreset: current.vadPreset === "relaxed" ? "balanced" : "relaxed",
              }))}
              disabled={listening || busy || reportState.phase === "pending"}
              className="min-h-[44px] rounded-full border border-white/15 px-4 disabled:opacity-40"
            >
              {settings.vadPreset === "relaxed" ? "여유 있게" : "보통 속도"}
            </button>
          </div>
          {listening ? (
            <button
              type="button"
              onClick={() => finishAndReport("learner-stop")}
              disabled={reportState.phase === "pending"}
              className={`min-h-[56px] w-full rounded-[22px] px-5 text-[15px] font-black transition active:scale-[.98] motion-reduce:transition-none ${activity === "roleplay" ? "bg-[#d8b4fe] text-[#2a133f]" : "bg-[#9ee7c4] text-[#123328]"}`}
            >
              대화 마치고 정리하기
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={busy || reportState.phase === "pending" || reportState.phase === "success"}
              className={`min-h-[56px] w-full rounded-[22px] px-5 text-[15px] font-black transition active:scale-[.98] motion-reduce:transition-none disabled:opacity-45 ${activity === "roleplay" ? "bg-[#d8b4fe] text-[#2a133f]" : "bg-[#9ee7c4] text-[#123328]"}`}
            >
              {busy ? "연결하는 중" : live.status === "blocked" || live.status === "error" ? "권한 확인 후 다시 연결" : activity === "roleplay" ? "장면 시작하기" : "대화 시작하기"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
