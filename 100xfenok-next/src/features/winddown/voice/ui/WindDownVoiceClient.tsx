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
  WIND_DOWN_VOICE_CORRECTION_MAX_CHARS,
  WINDDOWN_VOICE_SCENARIOS,
  createWindDownLiveTalkDescriptor,
  createWindDownRoleplayDescriptor,
  deriveWindDownVoiceCorrectionPresentation,
  evaluateWindDownRoleplay,
  summarizeWindDownLiveTalk,
  type WindDownVoiceActivity,
  type WindDownVoiceDescriptor,
  type WindDownVoiceFinalizedTurn,
} from "@/features/winddown/voice/product";
import {
  WIND_DOWN_VOICE_DEFAULT_SETTINGS,
  getWindDownVoiceStatusCopy,
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
  windDownVoiceJourneyTargetEvidence,
} from "@/features/winddown/voice/journeyTarget";
import {
  WindDownLumi,
  type WindDownLumiState,
} from "@/features/winddown/ui/WindDownLumi";
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
  | {
      phase: "success";
      frozen: WindDownVoiceReport;
      receipt: WindDownVoiceReportReceipt;
      habitCredited: boolean;
      error: null;
    }
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
  const correctionText = extractTranscriptCorrection(turn.modelText);
  return {
    conversationId: turn.conversationId,
    turnSeq: turn.turnSeq,
    userText: turn.userText,
    modelText: turn.modelText,
    finalized: true,
    sttDrift: turn.sttDrift,
    interrupted: turn.interrupted,
    ...(correctionText ? { correctionText } : {}),
  };
}

/**
 * Keep only a complete was/now/why block spoken by the coach. Every report
 * field can then be rebuilt from the learner and coach transcripts for the
 * same provider-finalized turn.
 */
function extractTranscriptCorrection(modelText: string | null) {
  const text = modelText?.trim().replace(/\s+/g, " ") ?? "";
  if (!text) return null;
  const match = text.match(
    /correction\s*(?:—|-|:)\s*was\s*:\s*[^|]{1,120}?\s*\|\s*now\s*:\s*[^|]{1,120}?\s*\|\s*why\s*:\s*.{1,160}$/i,
  );
  const correction = match?.[0]?.trim() || null;
  return correction && correction.length <= WIND_DOWN_VOICE_CORRECTION_MAX_CHARS
    ? correction
    : null;
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

function reportErrorText() {
  return "대화 기록을 저장하지 못했어. 같은 기록으로 다시 시도해줘.";
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
  const journeyTargets = liveSession?.activity === "roleplay"
    ? liveSession.journeyTargets
    : [];
  const journeyTargetEvidence = useMemo(() => (
    activity === "roleplay"
      ? windDownVoiceJourneyTargetEvidence({ targets: journeyTargets, turns })
      : null
  ), [activity, journeyTargets, turns]);
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
      setReportState({
        phase: "success",
        frozen: report,
        receipt: payload.receipt,
        habitCredited: payload.habitCredited,
        error: null,
      });
    } catch {
      setReportState({ phase: "error", frozen: report, receipt: null, error: reportErrorText() });
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
      && journeyTargetEvidence
      && live.status === "listening"
      && !finalizingRef.current
    ) {
      finishAndReport("scenario-goals-complete");
    }
  }, [
    activity,
    finishAndReport,
    journeyTargetEvidence,
    live.status,
    roleplay?.completed,
  ]);

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
  const lumiState: WindDownLumiState =
    reportState.phase === "success"
      ? reportState.habitCredited
        ? "celebrate"
        : "prompt"
      : reportState.phase === "error" || reportState.phase === "build-error"
        ? "rescue"
        : reportState.phase === "pending"
          ? "thinking"
          : live.status === "blocked" || live.status === "error"
            ? "rescue"
            : live.status === "connecting"
                || live.status === "setup-wait"
                || live.status === "stopping"
              ? "thinking"
              : live.status === "listening"
                ? "listening"
                : "prompt";
  const lumiMessage =
    reportState.phase === "success"
      ? reportState.habitCredited
        ? "오늘 말하기가 1/1로 기록됐어"
        : activity === "roleplay" && journeyTargets.length === 0
          ? "Learn에서 오늘 문장을 고르면 다시 이어갈 수 있어"
          : "저장은 됐어. 한 번 더 말하면 오늘 여정에 기록돼"
      : reportState.phase === "pending"
        ? "대화 기록을 안전하게 남기는 중"
        : reportState.phase === "error"
          ? "같은 대화 기록을 다시 저장할 수 있어"
          : reportState.phase === "build-error"
            ? "완료로 표시하지 않고 기록을 지키고 있어"
            : live.status === "blocked"
              ? "마이크 권한을 확인하면 다시 이어갈 수 있어"
              : live.status === "error"
                ? "연결을 확인한 뒤 같은 장면을 다시 시작해줘"
                : live.status === "connecting" || live.status === "setup-wait"
                  ? "대화를 준비하고 있어"
                  : live.status === "stopping"
                    ? "마지막 말을 정리하고 있어"
                    : live.status === "listening"
                      ? latestCoachLine ?? "듣고 있어. 편하게 이어가 봐"
                      : activity === "roleplay"
                        ? "장면을 골랐다면 네 차례야"
                        : "주제를 골랐다면 편하게 시작해";

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[var(--wd-bg)] text-[var(--wd-text)]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),18px)]">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black tracking-[0.18em] text-[var(--wd-accent)]">
              WIND DOWN · {activity === "roleplay" ? "ROLEPLAY" : "LIVE TALK"}
            </p>
            <h1 className="mt-1 text-[24px] font-black tracking-tight">{heading}</h1>
          </div>
          <Link
            href="/winddown"
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-[var(--wd-border)] bg-[var(--wd-surface)] px-4 text-xs font-black text-[var(--wd-muted)] transition active:scale-[.98] motion-reduce:transition-none"
          >
            나가기
          </Link>
        </header>

        <main className="flex flex-1 flex-col py-6">
          {activity === "roleplay" ? (
            <section className="rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-5 shadow-2xl">
              <p className="text-[11px] font-black tracking-[.15em] text-[var(--wd-accent)]">SCENE</p>
              <h2 className="mt-2 text-xl font-black">{activeTitle}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-[var(--wd-muted)]">
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
                      className={`min-h-[64px] rounded-2xl border px-4 text-left transition active:scale-[.98] motion-reduce:transition-none ${descriptor.activity === "roleplay" && descriptor.scenarioId === scenario.id ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)]" : "border-[var(--wd-border)] bg-[var(--wd-bg)]"}`}
                    >
                      <span className="block text-sm font-black">{scenario.title}</span>
                      <span className="mt-0.5 block text-xs font-semibold text-[var(--wd-muted)]">{scenario.scene}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-5 space-y-2">
                {liveSession?.activity === "roleplay" ? (
                  journeyTargets.length > 0 ? (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
                        journeyTargetEvidence
                          ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-text)]"
                          : "border-[var(--wd-border)] bg-[var(--wd-bg)] text-[var(--wd-muted)]"
                      }`}
                    >
                      <span aria-hidden>{journeyTargetEvidence ? "✓" : "○"}</span>
                      <span className="ml-3">
                        오늘 문장: {journeyTargets.map((target) => target.en).join(" / ")}
                      </span>
                    </div>
                  ) : (
                    <p className="rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-4 py-3 text-sm font-bold text-[var(--wd-muted)]">
                      오늘 문장이 아직 없어. Learn을 마치면 이 장면이 오늘 여정에 기록돼.
                    </p>
                  )
                ) : null}
                {roleplay?.scenario.goals.map((goal) => {
                  const evidence = roleplay.evidence.find((item) => item.goalId === goal.id);
                  return (
                    <div key={goal.id} className={`flex min-h-[44px] items-center gap-3 rounded-2xl border px-4 text-sm font-bold ${evidence ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-text)]" : "border-[var(--wd-border)] bg-[var(--wd-bg)] text-[var(--wd-muted)]"}`}>
                      <span aria-hidden>{evidence ? "✓" : "○"}</span>
                      <span className="min-w-0 flex-1">{goal.label}</span>
                      {evidence ? <span className="text-[11px] tabular-nums text-[var(--wd-muted)]">turn {evidence.turnSeq}</span> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="rounded-[32px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-6 shadow-2xl">
              <p className="text-[11px] font-black tracking-[.16em] text-[var(--wd-accent)]">OPEN CONVERSATION</p>
              <h2 className="mt-3 text-[28px] font-black leading-tight">{activeTitle}</h2>
              <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-[var(--wd-muted)]">
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
                      className={`min-h-[64px] min-w-[190px] rounded-2xl border px-4 text-left transition active:scale-[.98] motion-reduce:transition-none ${descriptor.activity === "live-talk" && descriptor.topicId === topic.id ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)]" : "border-[var(--wd-border)] bg-[var(--wd-bg)]"}`}
                    >
                      <span className="block text-sm font-black">{topic.title}</span>
                      <span className="mt-1 block text-xs font-semibold text-[var(--wd-muted)]">{topic.openingLine}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-7 grid grid-cols-2 gap-2 text-center">
                <div className="min-w-0 rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[var(--wd-accent)]">대화</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{formatDuration(liveTalkSummary.durationSeconds)}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[var(--wd-accent)]">내 말</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{liveTalkSummary.cleanLearnerTurns}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[var(--wd-accent)]">끊김</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{liveTalkSummary.interruptedTurnCount}</p>
                </div>
                <div className="min-w-0 rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-2 py-3">
                  <p className="text-[10px] font-black tracking-[.1em] text-[var(--wd-accent)]">응답</p>
                  <p className="mt-1 text-lg font-black tabular-nums">{formatLatency(live.metrics.lastResponseLatencyMs)}</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-[var(--wd-muted)]">전사→첫 오디오 · {live.metrics.responseLatencySamplesMs.length}회</p>
                </div>
              </div>
            </section>
          )}

          <section className="mt-5 flex min-h-[170px] flex-1 flex-col justify-end rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-5">
            <WindDownLumi
              state={lumiState}
              message={lumiMessage}
              compact
            />
            {transcriptState.current.userText ? (
              <p className="mt-4 border-t border-[var(--wd-border)] pt-3 text-sm font-semibold leading-6 text-[var(--wd-muted)]">
                나: {transcriptState.current.userText}
              </p>
            ) : null}
          </section>

          {liveTalkSummary.highlightTurnSeqs.length > 0 && activity === "live-talk" ? (
            <p className="mt-3 text-center text-xs font-semibold text-[var(--wd-accent)]">
              다시 볼 대화 {liveTalkSummary.highlightTurns.map((turn) => `#${turn.turnSeq}`).join(" · ")}
            </p>
          ) : null}

          {reportState.phase === "success" ? (
            <section aria-live="polite" className="mt-5 rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-5">
              <p className="text-2xl" aria-hidden>
                {reportState.habitCredited ? "✓" : "○"}
              </p>
              <h2 className="mt-2 text-lg font-black">
                {!reportState.habitCredited
                  ? "대화는 저장됐지만 오늘 말하기는 아직 0/1이야."
                  : "오늘의 대화가 정리됐어."}
              </h2>
              {!reportState.habitCredited ? (
                <p className="mt-3 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-3 py-2 text-sm font-semibold text-[var(--wd-muted)]">
                  {activity === "roleplay"
                    ? journeyTargets.length > 0
                      ? "오늘 문장을 한 번 자연스럽게 말하면 여정에 기록돼."
                      : "Learn을 먼저 마치면 오늘 문장으로 말하기를 기록할 수 있어."
                    : "내 문장이 끝까지 인식되도록 한 번 더 이야기해줘."}
                </p>
              ) : null}
              {reportState.frozen.outcome.kind === "roleplay" ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-semibold text-[var(--wd-muted)]">
                    목표 {reportState.frozen.outcome.goalResults.filter((goal) => goal.completed).length}/{reportState.frozen.outcome.goalResults.length}개를 채웠어.
                  </p>
                  {reportState.frozen.outcome.goalResults.map((goal) => (
                    <div key={goal.goalId} className="rounded-xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-3 py-2 text-xs font-semibold text-[var(--wd-muted)]">
                      <p>{goal.completed ? "✓" : "○"} {goal.label}</p>
                      {goal.evidence ? (
                        <p className="mt-1 text-[11px] text-[var(--wd-accent)]">
                          “{goal.evidence.matchedPhrase}” · turn-{goal.evidence.turnSeq}
                          {reportState.frozen.conversationIds.length > 1
                            ? ` · 이어진 대화 ${reportState.frozen.conversationIds.indexOf(goal.evidence.conversationId) + 1}`
                            : ""}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px]">확인된 내 말 없음</p>
                      )}
                    </div>
                  ))}
                  <p className="rounded-xl bg-[var(--wd-accent-soft)] px-3 py-2 text-xs font-bold text-[var(--wd-text)]">
                    다음 한 번: {reportState.frozen.outcome.nextPracticeSuggestion.text}
                  </p>
                </div>
              ) : (
                <div className="mt-3 space-y-2 text-sm font-semibold text-[var(--wd-muted)]">
                  <p>깨끗하게 남은 내 말 {reportState.frozen.outcome.cleanLearnerTurns}개 · 끊김 {reportState.frozen.outcome.interruptedTurnCount}회</p>
                  <p>응답 {formatLatency(reportState.frozen.metrics.lastResponseLatencyMs ?? null)} <span className="text-xs text-[var(--wd-muted)]">전사→첫 오디오 기준 · {reportState.frozen.metrics.responseLatencySamplesMs?.length ?? 0}회</span></p>
                  {reportState.frozen.outcome.highlightTurns.length > 0 ? <p className="text-xs text-[var(--wd-muted)]">다시 볼 turn {reportState.frozen.outcome.highlightTurns.map((turn) => turn.turnSeq).join(" · ")}</p> : null}
                </div>
              )}
              <div className="mt-5 border-t border-[var(--wd-border)] pt-4">
                <h3 className="text-sm font-black">대화 증거</h3>
                <div className="mt-3 space-y-3">
                  {reportState.frozen.turns.map((turn) => (
                    <article
                      key={`${turn.conversationId}:${turn.turnSeq}`}
                      data-turn-citation={`${turn.conversationId}:${turn.turnSeq}`}
                      className="rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] p-3"
                    >
                      <p className="text-[10px] font-black tracking-[.12em] text-[var(--wd-accent)]">
                        turn-{turn.turnSeq}
                        {reportState.frozen.conversationIds.length > 1
                          ? ` · 이어진 대화 ${reportState.frozen.conversationIds.indexOf(turn.conversationId) + 1}`
                          : ""}
                      </p>
                      {turn.userText ? (
                        <p className="mt-2 rounded-xl bg-[var(--wd-accent-soft)] px-3 py-2 text-sm font-semibold leading-6">
                          나 · {turn.userText}
                        </p>
                      ) : null}
                      {turn.modelText ? (
                        <p className="mt-2 px-3 text-sm font-semibold leading-6 text-[var(--wd-muted)]">
                          루미 · {turn.modelText}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
              {reportState.frozen.outcome.corrections.length > 0 ? (
                <div className="mt-5 border-t border-[var(--wd-border)] pt-4">
                  <h3 className="text-sm font-black">교정</h3>
                  <div className="mt-3 space-y-3">
                    {reportState.frozen.outcome.corrections.map((correction) => {
                      const presentation =
                        deriveWindDownVoiceCorrectionPresentation(correction);
                      if (!presentation) {
                        return (
                          <article
                            key={`${correction.conversationId}:${correction.turnSeq}:${correction.correctionText}`}
                            className="rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] p-3 text-xs"
                          >
                            <p className="font-semibold leading-5">{correction.correctionText}</p>
                            <p className="mt-3 font-black text-[var(--wd-accent)]">
                              이전 형식 교정 · 근거 turn-{correction.turnSeq}
                              {reportState.frozen.conversationIds.length > 1
                                ? ` · 이어진 대화 ${reportState.frozen.conversationIds.indexOf(correction.conversationId) + 1}`
                                : ""}
                            </p>
                          </article>
                        );
                      }
                      return (
                        <article
                          key={`${correction.conversationId}:${correction.turnSeq}:${correction.correctionText}`}
                          className="rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] p-3 text-xs"
                        >
                          <dl className="space-y-2">
                            <div><dt className="font-black text-[var(--wd-muted)]">was</dt><dd className="mt-0.5 font-semibold">{presentation.was}</dd></div>
                            <div><dt className="font-black text-[var(--wd-muted)]">now</dt><dd className="mt-0.5 font-semibold">{presentation.now}</dd></div>
                            <div><dt className="font-black text-[var(--wd-muted)]">why</dt><dd className="mt-0.5 font-semibold">{presentation.why}</dd></div>
                          </dl>
                          <p className="mt-3 font-black text-[var(--wd-accent)]">
                            근거 · turn-{presentation.citation.turnSeq}
                            {reportState.frozen.conversationIds.length > 1
                              ? ` · 이어진 대화 ${reportState.frozen.conversationIds.indexOf(presentation.citation.conversationId) + 1}`
                              : ""}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <p className="mt-3 text-xs font-semibold text-[var(--wd-muted)]">
                {reportState.receipt.committedAtIso.slice(0, 16).replace("T", " ")}
              </p>
              {!reportState.habitCredited ? (
                activity === "roleplay" && journeyTargets.length === 0 ? (
                  <>
                    <Link href="/winddown/learn" className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)] active:scale-[.98] motion-reduce:transition-none">Learn에서 오늘 문장 고르기</Link>
                    <Link href="/winddown" className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-[var(--wd-border)] px-4 text-sm font-black text-[var(--wd-text)] active:scale-[.98] motion-reduce:transition-none">오늘 여정 보기</Link>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={start} className="mt-5 min-h-[48px] w-full rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)] active:scale-[.98] motion-reduce:transition-none">
                      {activity === "roleplay" ? "오늘 문장으로 다시 말하기" : "한 번 더 이야기하기"}
                    </button>
                    <Link href="/winddown" className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-[var(--wd-border)] px-4 text-sm font-black text-[var(--wd-text)] active:scale-[.98] motion-reduce:transition-none">오늘 여정 보기</Link>
                  </>
                )
              ) : (
                <>
                  <Link href="/winddown" className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)] active:scale-[.98] motion-reduce:transition-none">오늘 여정 보기</Link>
                  <button type="button" onClick={start} className="mt-3 min-h-[48px] w-full rounded-2xl border border-[var(--wd-border)] px-4 text-sm font-black text-[var(--wd-text)] active:scale-[.98] motion-reduce:transition-none">다른 대화 시작</button>
                </>
              )}
            </section>
          ) : null}

          {reportState.phase === "error" || reportState.phase === "build-error" ? (
            <section role="alert" className="mt-5 rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-5 text-center">
              <h2 className="text-lg font-black">
                {reportState.phase === "error" ? "대화는 끝났지만 보고를 저장하지 못했어." : "대화를 정리하지 못했어."}
              </h2>
              <p className="mt-2 text-sm font-semibold text-[var(--wd-muted)]">{reportState.error}</p>
              {reportState.phase === "error" ? (
                <button type="button" onClick={reportRetry} className="mt-5 min-h-[48px] w-full rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)] active:scale-[.98] motion-reduce:transition-none">같은 보고서 다시 저장</button>
              ) : (
                <button type="button" onClick={start} className="mt-5 min-h-[48px] w-full rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)] active:scale-[.98] motion-reduce:transition-none">대화 다시 시작</button>
              )}
            </section>
          ) : null}
        </main>

        <footer className="pt-3">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs font-bold text-[var(--wd-muted)]">
            <span>{getWindDownVoiceStatusCopy(live.status, error)}</span>
            <button
              type="button"
              onClick={() => setSettings((current) => ({
                ...current,
                vadPreset: current.vadPreset === "relaxed" ? "balanced" : "relaxed",
              }))}
              disabled={listening || busy || reportState.phase === "pending"}
              className="min-h-[44px] rounded-full border border-[var(--wd-border)] bg-[var(--wd-surface)] px-4 disabled:opacity-40"
            >
              {settings.vadPreset === "relaxed" ? "여유 있게" : "보통 속도"}
            </button>
          </div>
          {listening ? (
            <button
              type="button"
              onClick={() => finishAndReport("learner-stop")}
              disabled={reportState.phase === "pending"}
              className="min-h-[56px] w-full rounded-[22px] bg-[var(--wd-accent)] px-5 text-[15px] font-black text-[var(--wd-bg)] transition active:scale-[.98] motion-reduce:transition-none"
            >
              대화 마치고 정리하기
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={busy || reportState.phase === "pending" || reportState.phase === "success"}
              className="min-h-[56px] w-full rounded-[22px] bg-[var(--wd-accent)] px-5 text-[15px] font-black text-[var(--wd-bg)] transition active:scale-[.98] disabled:opacity-45 motion-reduce:transition-none"
            >
              {busy ? "연결하는 중" : live.status === "blocked" || live.status === "error" ? "권한 확인 후 다시 연결" : activity === "roleplay" ? "장면 시작하기" : "대화 시작하기"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
