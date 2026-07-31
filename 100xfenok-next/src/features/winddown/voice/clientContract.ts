import {
  WIND_DOWN_VOICE_SESSION_ENDPOINT,
  WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION,
  isWindDownVoiceSessionResponse,
  type WindDownVoiceSessionRequest,
  type WindDownVoiceSessionResponse,
} from "@/features/winddown/voice/sessionContract";
import type { WindDownVoiceDescriptor } from "@/features/winddown/voice/product";

export type WindDownVoiceClientSettings = {
  voiceName: "Kore" | "Aoede" | "Puck" | "Charon" | "Achernar";
  vadPreset: "relaxed" | "balanced";
};

/** The narrow callback shape consumed by useGeminiLiveTransport. */
export type WindDownVoiceSessionRequestOptions = {
  settings: WindDownVoiceClientSettings;
  productSessionId: string;
  resumedFromConversationId?: string | null;
};

export const WIND_DOWN_VOICE_DEFAULT_SETTINGS: WindDownVoiceClientSettings = {
  voiceName: "Kore",
  vadPreset: "relaxed",
};

export function buildWindDownVoiceSessionRequest(args: {
  descriptor: WindDownVoiceDescriptor;
  settings: WindDownVoiceClientSettings;
  productSessionId: string;
  resumedFromConversationId?: string | null;
}): WindDownVoiceSessionRequest {
  const common = {
    schemaVersion: WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION,
    productSessionId: args.productSessionId,
    voiceName: args.settings.voiceName,
    vadPreset: args.settings.vadPreset,
    ...(args.resumedFromConversationId
      ? { resumedFromConversationId: args.resumedFromConversationId }
      : {}),
  } as const;
  return args.descriptor.activity === "roleplay"
    ? {
      ...common,
      activity: "roleplay",
      scenarioId: args.descriptor.scenarioId,
      policyVersion: args.descriptor.policyVersion,
    }
    : {
      ...common,
      activity: "live-talk",
      topicId: args.descriptor.topicId,
      policyVersion: args.descriptor.policyVersion,
    };
}

export async function requestWindDownVoiceSession(args: {
  descriptor: WindDownVoiceDescriptor;
  settings: WindDownVoiceClientSettings;
  productSessionId: string;
  resumedFromConversationId?: string | null;
}): Promise<WindDownVoiceSessionResponse> {
  const response = await fetch(WIND_DOWN_VOICE_SESSION_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildWindDownVoiceSessionRequest(args)),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isWindDownVoiceSessionResponse(payload)) {
    const error = payload && typeof payload === "object" && !Array.isArray(payload)
      && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `WIND_DOWN_VOICE_SESSION_HTTP_${response.status}`;
    throw new Error(error);
  }
  return payload;
}
