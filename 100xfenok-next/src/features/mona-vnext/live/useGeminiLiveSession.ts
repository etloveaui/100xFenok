"use client";

import { useCallback, useRef, useState } from "react";
import {
  buildAudioStreamEndInput,
  buildMonaVnextWebSocketUrl,
  buildRealtimeTextInput,
  readSocketPayload,
  type MonaVnextLiveStatus,
  type MonaVnextServerContent,
  type MonaVnextServerMessage,
  type MonaVnextSessionResponse,
} from "@/features/mona-vnext/live/liveProtocol";
import { useLiveAudioInput } from "@/features/mona-vnext/live/useLiveAudioInput";
import { useLiveAudioOutput } from "@/features/mona-vnext/live/useLiveAudioOutput";
import type { MonaVnextGeminiModel } from "@/features/mona-vnext/live/modelOptions";
import type { MonaVnextLiveTemperature } from "@/features/mona-vnext/live/generationOptions";

export type MonaVnextSessionMetrics = {
  micPermission: "unknown" | "granted" | "denied" | "prompt" | "stopped";
  sessionPostMs: number | null;
  socketOpenMs: number | null;
  setupDoneMs: number | null;
  firstResponseMs: number | null;
  reconnectCount: number;
  lastReconnectMs: number | null;
  audioFramesSent: number;
  lastAudioRms: number | null;
  lastAudioPeak: number | null;
  inputSampleRate: number | null;
  turnCount: number;
  interruptionCount: number;
  lastError: string | null;
};

export type MonaVnextSessionSettings = {
  model: MonaVnextGeminiModel;
  voiceName: string;
  vadPreset: string;
  lowVoice: boolean;
  interruptionMode: "no-interrupt" | "barge-in";
  englishVisible: boolean;
  temperature: MonaVnextLiveTemperature;
  activeExpressionId: string;
};

type Options = {
  settings: MonaVnextSessionSettings;
  clientBuildVersion: string;
  onSessionReady?: (session: MonaVnextSessionResponse) => void;
  onServerContent?: (content: MonaVnextServerContent) => void;
  onEvent?: (event: { type: string; message: string; atIso: string; detail?: Record<string, unknown> }) => void;
  onRecoverFailed?: (reason: string) => void;
};

const EMPTY_METRICS: MonaVnextSessionMetrics = {
  micPermission: "unknown",
  sessionPostMs: null,
  socketOpenMs: null,
  setupDoneMs: null,
  firstResponseMs: null,
  reconnectCount: 0,
  lastReconnectMs: null,
  audioFramesSent: 0,
  lastAudioRms: null,
  lastAudioPeak: null,
  inputSampleRate: null,
  turnCount: 0,
  interruptionCount: 0,
  lastError: null,
};

function isSessionResponse(value: unknown): value is MonaVnextSessionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<MonaVnextSessionResponse>;
  const expressionBank = record.expressionBank;
  return record.status === "LIVE_TOKEN_READY"
    && typeof record.sessionId === "string"
    && typeof record.conversationId === "string"
    && typeof record.token === "string"
    && typeof record.websocketEndpoint === "string"
    && Boolean(expressionBank)
    && Array.isArray(expressionBank?.entries)
    && expressionBank.entries.length > 0
    && Boolean(record.setup);
}

function nowIso() {
  return new Date().toISOString();
}

const GO_AWAY_RECONNECT_MARGIN_MS = 1500;
const GO_AWAY_RECONNECT_MAX_DELAY_MS = 15000;
const MAX_RESUME_ATTEMPTS = 3;

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDurationMs(value: unknown): number | null {
  const directNumber = parseFiniteNumber(value);
  if (directNumber !== null) {
    return directNumber > 1000 ? Math.round(directNumber) : Math.round(directNumber * 1000);
  }
  if (typeof value === "string") {
    const match = /^\s*([0-9.]+)s\s*$/.exec(value);
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as { seconds?: unknown; nanos?: unknown };
    const seconds = parseFiniteNumber(record.seconds) ?? 0;
    const nanos = parseFiniteNumber(record.nanos) ?? 0;
    return Math.max(0, Math.round(seconds * 1000 + nanos / 1_000_000));
  }
  return null;
}

function parseGoAwayTimeLeftMs(goAway: MonaVnextServerMessage["goAway"]) {
  if (!goAway || typeof goAway !== "object" || Array.isArray(goAway)) return null;
  return parseDurationMs(goAway.timeLeft);
}

function buildResumeSetup(setup: Record<string, unknown>, handle: string) {
  return {
    ...setup,
    sessionResumption: { handle },
    contextWindowCompression: { slidingWindow: {} },
  };
}

export function useGeminiLiveSession({
  settings,
  clientBuildVersion,
  onSessionReady,
  onServerContent,
  onEvent,
  onRecoverFailed,
}: Options) {
  const audioInput = useLiveAudioInput();
  const audioOutput = useLiveAudioOutput();
  const [status, setStatus] = useState<MonaVnextLiveStatus>("idle");
  const [session, setSession] = useState<MonaVnextSessionResponse | null>(null);
  const [metrics, setMetrics] = useState<MonaVnextSessionMetrics>(EMPTY_METRICS);
  const socketRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<MonaVnextSessionResponse | null>(null);
  const startMsRef = useRef<number | null>(null);
  const firstResponseSeenRef = useRef(false);
  const dropAudioUntilTurnCompleteRef = useRef(false);
  const audioStreamEndSentRef = useRef(false);
  const latestResumeHandleRef = useRef<string | null>(null);
  const socketGenerationRef = useRef(0);
  const reconnectingRef = useRef(false);
  const reconnectStartedMsRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAttemptCountRef = useRef(0);
  const expectedCloseSocketsRef = useRef<WeakSet<WebSocket>>(new WeakSet());
  const pendingReplacedSocketRef = useRef<WebSocket | null>(null);
  const resumeSocketRef = useRef<(handle: string) => void>(() => undefined);

  const emitEvent = useCallback((type: string, message: string, detail?: Record<string, unknown>) => {
    onEvent?.({ type, message, atIso: nowIso(), ...(detail ? { detail } : {}) });
  }, [onEvent]);

  const sendAudioStreamEnd = useCallback((socket = socketRef.current) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || audioStreamEndSentRef.current) return false;
    socket.send(JSON.stringify(buildAudioStreamEndInput()));
    audioStreamEndSentRef.current = true;
    return true;
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (!reconnectTimerRef.current) return;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const closeExpectedSocket = useCallback((socket: WebSocket | null, reason: string) => {
    if (!socket) return;
    expectedCloseSocketsRef.current.add(socket);
    try {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, reason);
      } else {
        socket.close();
      }
    } catch {
      // Socket may already be closed by the browser.
    }
  }, []);

  const failRecovery = useCallback((message: string) => {
    clearReconnectTimer();
    reconnectingRef.current = false;
    reconnectStartedMsRef.current = null;
    setStatus("error");
    setMetrics((current) => ({ ...current, lastError: message }));
    emitEvent("session-reconnect-failed", message);
    onRecoverFailed?.(message);
  }, [clearReconnectTimer, emitEvent, onRecoverFailed]);

  const stop = useCallback((finalStatus: MonaVnextLiveStatus = "stopped") => {
    setStatus("stopping");
    clearReconnectTimer();
    socketGenerationRef.current += 1;
    reconnectingRef.current = false;
    reconnectStartedMsRef.current = null;
    resumeAttemptCountRef.current = 0;
    sendAudioStreamEnd();
    const socket = socketRef.current;
    const pendingSocket = pendingReplacedSocketRef.current;
    socketRef.current = null;
    pendingReplacedSocketRef.current = null;
    closeExpectedSocket(socket, "mona-vnext-stop");
    if (pendingSocket && pendingSocket !== socket) closeExpectedSocket(pendingSocket, "mona-vnext-stop");
    audioInput.stop((micPermission) => {
      setMetrics((current) => ({ ...current, micPermission }));
    });
    audioOutput.stop();
    activeSessionRef.current = null;
    latestResumeHandleRef.current = null;
    audioStreamEndSentRef.current = false;
    dropAudioUntilTurnCompleteRef.current = false;
    setStatus(finalStatus);
  }, [audioInput, audioOutput, clearReconnectTimer, closeExpectedSocket, sendAudioStreamEnd]);

  const beginAudioInput = useCallback(async (socket: WebSocket) => {
    await audioInput.start({
      socket,
      onFrameSent: () => {
        setMetrics((current) => ({
          ...current,
          audioFramesSent: current.audioFramesSent + 1,
        }));
      },
      onAudioStats: (stats) => {
        setMetrics((current) => ({
          ...current,
          lastAudioRms: stats.rms,
          lastAudioPeak: stats.peak,
          inputSampleRate: stats.inputSampleRate,
        }));
      },
      onPermission: (micPermission) => {
        setMetrics((current) => ({ ...current, micPermission }));
      },
    });
  }, [audioInput]);

  const scheduleReconnect = useCallback((goAway: MonaVnextServerMessage["goAway"]) => {
    const handle = latestResumeHandleRef.current;
    if (!handle) {
      failRecovery("SESSION_RESUMPTION_HANDLE_MISSING");
      return;
    }
    if (!activeSessionRef.current) {
      failRecovery("SESSION_RESUMPTION_SESSION_MISSING");
      return;
    }
    if (reconnectTimerRef.current || reconnectingRef.current) return;
    const timeLeftMs = parseGoAwayTimeLeftMs(goAway);
    const delayMs = timeLeftMs === null
      ? 0
      : Math.max(0, Math.min(timeLeftMs - GO_AWAY_RECONNECT_MARGIN_MS, GO_AWAY_RECONNECT_MAX_DELAY_MS));
    emitEvent("go-away", "Gemini requested session replacement.", {
      timeLeftMs,
      delayMs,
      handleLength: handle.length,
    });
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      resumeSocketRef.current(handle);
    }, delayMs);
  }, [emitEvent, failRecovery]);

  const handleServerMessage = useCallback((
    payload: MonaVnextServerMessage,
    socket: WebSocket,
    generation: number,
  ) => {
    if (generation !== socketGenerationRef.current || socket !== socketRef.current) return;
    if (payload.toolCall || payload.toolCallCancellation) {
      emitEvent("unexpected-tool-message", "vNext received an unexpected tool message and ignored it.");
      return;
    }

    const resumptionUpdate = payload.sessionResumptionUpdate;
    if (resumptionUpdate?.resumable && resumptionUpdate.newHandle) {
      latestResumeHandleRef.current = resumptionUpdate.newHandle;
      emitEvent("session-resumption-handle", "Gemini Live resumption handle received.", {
        resumable: true,
        handleLength: resumptionUpdate.newHandle.length,
      });
    }

    if (payload.setupComplete) {
      const setupDoneMs = startMsRef.current ? Math.round(performance.now() - startMsRef.current) : null;
      const wasReconnecting = reconnectingRef.current;
      const reconnectMs = wasReconnecting && reconnectStartedMsRef.current
        ? Math.round(performance.now() - reconnectStartedMsRef.current)
        : null;
      setMetrics((current) => ({
        ...current,
        setupDoneMs,
        ...(wasReconnecting
          ? {
            reconnectCount: current.reconnectCount + 1,
            lastReconnectMs: reconnectMs,
          }
          : {}),
      }));
      setStatus("listening");
      audioStreamEndSentRef.current = false;
      emitEvent(
        wasReconnecting ? "setup-complete-resumed" : "setup-complete",
        wasReconnecting ? "Gemini Live setup complete after resume." : "Gemini Live setup complete.",
        wasReconnecting ? { reconnectMs } : undefined,
      );
      void beginAudioInput(socket).then(() => {
        const replacedSocket = pendingReplacedSocketRef.current;
        pendingReplacedSocketRef.current = null;
        if (replacedSocket && replacedSocket !== socket) {
          closeExpectedSocket(replacedSocket, "mona-vnext-resumed");
        }
        if (wasReconnecting) {
          reconnectingRef.current = false;
          reconnectStartedMsRef.current = null;
          resumeAttemptCountRef.current = 0;
        }
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "MIC_START_FAILED";
        setMetrics((current) => ({ ...current, lastError: message, micPermission: "denied" }));
        if (wasReconnecting) {
          failRecovery(`SESSION_RESUME_MIC_FAILED: ${message}`);
          return;
        }
        setStatus("error");
        emitEvent("mic-error", message);
      });
      return;
    }

    if (payload.goAway) {
      scheduleReconnect(payload.goAway);
      return;
    }

    const serverContent = payload.serverContent;
    if (!serverContent) return;

    if (serverContent.interrupted) {
      dropAudioUntilTurnCompleteRef.current = true;
      audioOutput.flush();
      setMetrics((current) => ({
        ...current,
        interruptionCount: current.interruptionCount + 1,
      }));
      emitEvent("interrupted", "Model generation interrupted; playback queue flushed.");
    }

    let playedAudio = false;
    serverContent.modelTurn?.parts?.forEach((part) => {
      const data = part.inlineData?.data;
      if (!data || dropAudioUntilTurnCompleteRef.current) return;
      playedAudio = audioOutput.play(data, part.inlineData?.mimeType) || playedAudio;
    });

    if (playedAudio && !firstResponseSeenRef.current) {
      firstResponseSeenRef.current = true;
      const firstResponseMs = startMsRef.current ? Math.round(performance.now() - startMsRef.current) : null;
      setMetrics((current) => ({ ...current, firstResponseMs }));
    }

    if (serverContent.turnComplete) {
      dropAudioUntilTurnCompleteRef.current = false;
      setMetrics((current) => ({
        ...current,
        turnCount: current.turnCount + 1,
      }));
    }

    onServerContent?.(serverContent);
  }, [audioOutput, beginAudioInput, closeExpectedSocket, emitEvent, failRecovery, onServerContent, scheduleReconnect]);

  const openSocket = useCallback((
    liveSession: MonaVnextSessionResponse,
    setup: Record<string, unknown>,
    options: { reconnect?: boolean } = {},
  ) => {
    const socket = new WebSocket(buildMonaVnextWebSocketUrl(liveSession.websocketEndpoint, liveSession.token));
    socket.binaryType = "arraybuffer";
    const generation = socketGenerationRef.current + 1;
    socketGenerationRef.current = generation;
    socketRef.current = socket;
    setStatus("setup-wait");

    socket.onopen = () => {
      if (generation !== socketGenerationRef.current || socket !== socketRef.current) return;
      const socketOpenMs = startMsRef.current ? Math.round(performance.now() - startMsRef.current) : null;
      setMetrics((current) => ({ ...current, socketOpenMs }));
      try {
        socket.send(JSON.stringify({ setup }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "SETUP_SEND_FAILED";
        if (options.reconnect) {
          failRecovery(`SESSION_RESUME_SETUP_SEND_FAILED: ${message}`);
          return;
        }
        setStatus("error");
        setMetrics((current) => ({ ...current, lastError: message }));
        emitEvent("socket-setup-send-error", message);
        return;
      }
      emitEvent(
        options.reconnect ? "socket-reopen" : "socket-open",
        options.reconnect ? "Gemini Live resume socket opened; setup sent." : "Gemini Live socket opened; setup sent.",
        options.reconnect ? { generation } : undefined,
      );
    };

    socket.onmessage = (event) => {
      void (async () => {
        try {
          const text = await readSocketPayload(event.data);
          handleServerMessage(JSON.parse(text) as MonaVnextServerMessage, socket, generation);
        } catch (error) {
          if (generation !== socketGenerationRef.current || socket !== socketRef.current) return;
          const message = error instanceof Error ? error.message : "SERVER_MESSAGE_PARSE_FAILED";
          if (options.reconnect) {
            failRecovery(`SESSION_RESUME_MESSAGE_PARSE_FAILED: ${message}`);
            return;
          }
          setStatus("error");
          setMetrics((current) => ({ ...current, lastError: message }));
          emitEvent("server-message-error", message);
        }
      })();
    };

    socket.onerror = () => {
      if (generation !== socketGenerationRef.current || socket !== socketRef.current) return;
      const message = "GEMINI_SOCKET_ERROR";
      if (options.reconnect) {
        failRecovery(`SESSION_RESUME_SOCKET_ERROR: ${message}`);
        return;
      }
      setStatus("error");
      setMetrics((current) => ({ ...current, lastError: message }));
      emitEvent("socket-error", message);
    };

    socket.onclose = (event) => {
      if (expectedCloseSocketsRef.current.has(socket)) {
        expectedCloseSocketsRef.current.delete(socket);
        emitEvent("socket-close-expected", "Gemini Live socket closed as expected.", { code: event.code });
        return;
      }
      if (generation !== socketGenerationRef.current || socket !== socketRef.current) return;
      audioInput.stop((micPermission) => {
        setMetrics((current) => ({ ...current, micPermission }));
      });
      audioOutput.flush();
      if (event.code !== 1000) {
        const handle = latestResumeHandleRef.current;
        if (handle && activeSessionRef.current && !reconnectingRef.current) {
          emitEvent("socket-close-resume", "Gemini Live socket closed unexpectedly; attempting handle resume.", {
            code: event.code,
            handleLength: handle.length,
          });
          resumeSocketRef.current(handle);
          return;
        }
        const message = event.reason
          ? `GEMINI_SOCKET_CLOSED_${event.code}: ${event.reason}`
          : `GEMINI_SOCKET_CLOSED_${event.code}`;
        if (options.reconnect || reconnectingRef.current) {
          failRecovery(`SESSION_RESUME_SOCKET_CLOSED: ${message}`);
          return;
        }
        setStatus("error");
        setMetrics((current) => ({ ...current, lastError: message }));
        emitEvent("socket-close-error", message);
      } else {
        setStatus("stopped");
        emitEvent("socket-close", "Gemini Live socket closed.");
      }
    };

    return socket;
  }, [audioInput, audioOutput, emitEvent, failRecovery, handleServerMessage]);

  const resumeSocket = useCallback((handle: string) => {
    const liveSession = activeSessionRef.current;
    if (!liveSession) {
      failRecovery("SESSION_RESUMPTION_SESSION_MISSING");
      return;
    }
    if (reconnectingRef.current) return;
    if (resumeAttemptCountRef.current >= MAX_RESUME_ATTEMPTS) {
      failRecovery("SESSION_RESUME_ATTEMPT_LIMIT");
      return;
    }

    clearReconnectTimer();
    resumeAttemptCountRef.current += 1;
    reconnectingRef.current = true;
    reconnectStartedMsRef.current = performance.now();
    pendingReplacedSocketRef.current = socketRef.current;
    dropAudioUntilTurnCompleteRef.current = false;
    audioStreamEndSentRef.current = false;
    setStatus("setup-wait");
    emitEvent("session-reconnect-start", "Gemini Live resume socket starting.", {
      attempt: resumeAttemptCountRef.current,
      handleLength: handle.length,
    });

    try {
      openSocket(liveSession, buildResumeSetup(liveSession.setup, handle), { reconnect: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SESSION_RESUME_SOCKET_OPEN_FAILED";
      failRecovery(message);
    }
  }, [clearReconnectTimer, emitEvent, failRecovery, openSocket]);

  resumeSocketRef.current = resumeSocket;

  const start = useCallback(async () => {
    if (status === "connecting" || status === "setup-wait" || status === "listening") return;
    if (!window.isSecureContext) {
      setStatus("blocked");
      setMetrics((current) => ({ ...current, lastError: "SECURE_CONTEXT_REQUIRED" }));
      emitEvent("blocked", "SECURE_CONTEXT_REQUIRED");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("blocked");
      setMetrics((current) => ({ ...current, lastError: "MEDIA_DEVICES_UNSUPPORTED" }));
      emitEvent("blocked", "MEDIA_DEVICES_UNSUPPORTED");
      return;
    }

    stop("idle");
    setMetrics(EMPTY_METRICS);
    setSession(null);
    activeSessionRef.current = null;
    latestResumeHandleRef.current = null;
    resumeAttemptCountRef.current = 0;
    firstResponseSeenRef.current = false;
    dropAudioUntilTurnCompleteRef.current = false;
    audioStreamEndSentRef.current = false;

    try {
      await audioOutput.ensure();
      setStatus("connecting");
      startMsRef.current = performance.now();
      const response = await fetch("/api/mona-vnext/session/", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ...settings,
          clientBuildVersion,
        }),
      });
      const sessionPostMs = startMsRef.current ? Math.round(performance.now() - startMsRef.current) : null;
      setMetrics((current) => ({ ...current, sessionPostMs }));
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isSessionResponse(payload)) {
        const errorPayload = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as { error?: string; missingEnv?: string }
          : null;
        const error = errorPayload?.error ?? `HTTP_${response.status}`;
        const missing = errorPayload?.missingEnv ? ` ${errorPayload.missingEnv}` : "";
        throw new Error(`${error ?? "SESSION_START_FAILED"}${missing}`);
      }

      const liveSession = payload;
      activeSessionRef.current = liveSession;
      setSession(liveSession);
      onSessionReady?.(liveSession);
      emitEvent("session-ready", "vNext live token ready.", {
        sessionId: liveSession.sessionId,
        conversationId: liveSession.conversationId,
      });

      openSocket(liveSession, liveSession.setup);
    } catch (error) {
      const message = error instanceof Error ? error.message : "SESSION_START_FAILED";
      stop(message.includes("MISSING_GEMINI_API_KEY") ? "blocked" : "error");
      setMetrics((current) => ({ ...current, lastError: message }));
      emitEvent("session-error", message);
    }
  }, [audioOutput, clientBuildVersion, emitEvent, onSessionReady, openSocket, settings, status, stop]);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    const socket = socketRef.current;
    if (!trimmed || !socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(buildRealtimeTextInput(trimmed)));
    emitEvent("text-input", "Manual realtime text sent.");
    return true;
  }, [emitEvent]);

  return {
    status,
    session,
    metrics,
    start,
    stop,
    sendText,
  };
}
