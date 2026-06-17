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
};

type Options = {
  settings: MonaVnextSessionSettings;
  clientBuildVersion: string;
  onSessionReady?: (session: MonaVnextSessionResponse) => void;
  onServerContent?: (content: MonaVnextServerContent) => void;
  onEvent?: (event: { type: string; message: string; atIso: string; detail?: Record<string, unknown> }) => void;
};

const EMPTY_METRICS: MonaVnextSessionMetrics = {
  micPermission: "unknown",
  sessionPostMs: null,
  socketOpenMs: null,
  setupDoneMs: null,
  firstResponseMs: null,
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
  return record.status === "LIVE_TOKEN_READY"
    && typeof record.sessionId === "string"
    && typeof record.conversationId === "string"
    && typeof record.token === "string"
    && typeof record.websocketEndpoint === "string"
    && Boolean(record.setup);
}

function nowIso() {
  return new Date().toISOString();
}

export function useGeminiLiveSession({
  settings,
  clientBuildVersion,
  onSessionReady,
  onServerContent,
  onEvent,
}: Options) {
  const audioInput = useLiveAudioInput();
  const audioOutput = useLiveAudioOutput();
  const [status, setStatus] = useState<MonaVnextLiveStatus>("idle");
  const [session, setSession] = useState<MonaVnextSessionResponse | null>(null);
  const [metrics, setMetrics] = useState<MonaVnextSessionMetrics>(EMPTY_METRICS);
  const socketRef = useRef<WebSocket | null>(null);
  const startMsRef = useRef<number | null>(null);
  const firstResponseSeenRef = useRef(false);
  const dropAudioUntilTurnCompleteRef = useRef(false);
  const audioStreamEndSentRef = useRef(false);

  const emitEvent = useCallback((type: string, message: string, detail?: Record<string, unknown>) => {
    onEvent?.({ type, message, atIso: nowIso(), ...(detail ? { detail } : {}) });
  }, [onEvent]);

  const sendAudioStreamEnd = useCallback((socket = socketRef.current) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || audioStreamEndSentRef.current) return false;
    socket.send(JSON.stringify(buildAudioStreamEndInput()));
    audioStreamEndSentRef.current = true;
    return true;
  }, []);

  const stop = useCallback((finalStatus: MonaVnextLiveStatus = "stopped") => {
    setStatus("stopping");
    sendAudioStreamEnd();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "mona-vnext-stop");
    } else if (socket) {
      socket.close();
    }
    audioInput.stop((micPermission) => {
      setMetrics((current) => ({ ...current, micPermission }));
    });
    audioOutput.stop();
    audioStreamEndSentRef.current = false;
    dropAudioUntilTurnCompleteRef.current = false;
    setStatus(finalStatus);
  }, [audioInput, audioOutput, sendAudioStreamEnd]);

  const handleServerMessage = useCallback((payload: MonaVnextServerMessage) => {
    if (payload.toolCall || payload.toolCallCancellation) {
      emitEvent("unexpected-tool-message", "vNext received an unexpected tool message and ignored it.");
      return;
    }

    if (payload.setupComplete) {
      const setupDoneMs = startMsRef.current ? Math.round(performance.now() - startMsRef.current) : null;
      setMetrics((current) => ({ ...current, setupDoneMs }));
      setStatus("listening");
      emitEvent("setup-complete", "Gemini Live setup complete.");
      const socket = socketRef.current;
      if (socket) {
        void audioInput.start({
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
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "MIC_START_FAILED";
          setMetrics((current) => ({ ...current, lastError: message, micPermission: "denied" }));
          setStatus("error");
          emitEvent("mic-error", message);
        });
      }
      return;
    }

    if (payload.goAway) {
      emitEvent("go-away", "Gemini requested session replacement.");
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
  }, [audioInput, audioOutput, emitEvent, onServerContent]);

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
      setSession(liveSession);
      onSessionReady?.(liveSession);
      emitEvent("session-ready", "vNext live token ready.", {
        sessionId: liveSession.sessionId,
        conversationId: liveSession.conversationId,
      });

      const socket = new WebSocket(buildMonaVnextWebSocketUrl(liveSession.websocketEndpoint, liveSession.token));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      setStatus("setup-wait");

      socket.onopen = () => {
        const socketOpenMs = startMsRef.current ? Math.round(performance.now() - startMsRef.current) : null;
        setMetrics((current) => ({ ...current, socketOpenMs }));
        socket.send(JSON.stringify({ setup: liveSession.setup }));
        emitEvent("socket-open", "Gemini Live socket opened; setup sent.");
      };

      socket.onmessage = (event) => {
        void (async () => {
          try {
            const text = await readSocketPayload(event.data);
            handleServerMessage(JSON.parse(text) as MonaVnextServerMessage);
          } catch (error) {
            const message = error instanceof Error ? error.message : "SERVER_MESSAGE_PARSE_FAILED";
            setStatus("error");
            setMetrics((current) => ({ ...current, lastError: message }));
            emitEvent("server-message-error", message);
          }
        })();
      };

      socket.onerror = () => {
        const message = "GEMINI_SOCKET_ERROR";
        setStatus("error");
        setMetrics((current) => ({ ...current, lastError: message }));
        emitEvent("socket-error", message);
      };

      socket.onclose = (event) => {
        audioInput.stop((micPermission) => {
          setMetrics((current) => ({ ...current, micPermission }));
        });
        audioOutput.flush();
        if (event.code !== 1000) {
          const message = event.reason ? `GEMINI_SOCKET_CLOSED_${event.code}: ${event.reason}` : `GEMINI_SOCKET_CLOSED_${event.code}`;
          setStatus("error");
          setMetrics((current) => ({ ...current, lastError: message }));
          emitEvent("socket-close-error", message);
        } else {
          setStatus("stopped");
          emitEvent("socket-close", "Gemini Live socket closed.");
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SESSION_START_FAILED";
      stop(message.includes("MISSING_GEMINI_API_KEY") ? "blocked" : "error");
      setMetrics((current) => ({ ...current, lastError: message }));
      emitEvent("session-error", message);
    }
  }, [audioInput, audioOutput, clientBuildVersion, emitEvent, handleServerMessage, onSessionReady, settings, status, stop]);

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
