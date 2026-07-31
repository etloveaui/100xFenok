"use client";

import { useCallback } from "react";
import type {
  MonaVnextServerContent,
  MonaVnextSessionResponse,
} from "@/features/mona-vnext/live/liveProtocol";
import type { MonaVnextGeminiModel } from "@/features/mona-vnext/live/modelOptions";
import type { MonaVnextLiveTemperature } from "@/features/mona-vnext/live/generationOptions";
import {
  useGeminiLiveTransport,
  type GeminiLiveTransportMetrics,
  type GeminiLiveTransportRequest,
} from "@/features/mona-vnext/live/useGeminiLiveTransport";

export type MonaVnextSessionMetrics = GeminiLiveTransportMetrics;

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
  enableResumePrewarm?: boolean;
  onSessionReady?: (session: MonaVnextSessionResponse) => void;
  onSessionResumed?: (session: MonaVnextSessionResponse) => void;
  onServerContent?: (content: MonaVnextServerContent) => void;
  onEvent?: (event: {
    type: string;
    message: string;
    atIso: string;
    detail?: Record<string, unknown>;
  }) => void;
  onRecoverFailed?: (reason: string) => void;
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

export function useGeminiLiveSession({
  settings,
  clientBuildVersion,
  enableResumePrewarm = false,
  onSessionReady,
  onSessionResumed,
  onServerContent,
  onEvent,
  onRecoverFailed,
}: Options) {
  const requestSession = useCallback<GeminiLiveTransportRequest<
    MonaVnextSessionSettings,
    MonaVnextSessionResponse
  >>(async ({
    settings: requestSettings,
    resumedFromConversationId,
  }: {
    settings: MonaVnextSessionSettings;
    resumedFromConversationId?: string | null;
  }) => {
    const response = await fetch("/api/mona-vnext/session/", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...requestSettings,
        clientBuildVersion,
        ...(resumedFromConversationId
          ? { resumedFromConversationId }
          : {}),
      }),
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || !isSessionResponse(payload)) {
      const errorPayload = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as { error?: string; missingEnv?: string }
        : null;
      const code = errorPayload?.error ?? `HTTP_${response.status}`;
      const missing = errorPayload?.missingEnv ? ` ${errorPayload.missingEnv}` : "";
      throw new Error(`${code}${missing}`);
    }
    return payload;
  }, [clientBuildVersion]);

  return useGeminiLiveTransport({
    settings,
    requestSession,
    enableResumePrewarm,
    onSessionReady,
    onSessionResumed,
    onServerContent,
    onEvent,
    onRecoverFailed,
  });
}
