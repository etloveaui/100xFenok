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

export function getWindDownVoiceStatusCopy(
  status: string,
  error: string | null | undefined,
) {
  if (status === "listening") return "루미가 듣고 있어";
  if (
    status === "connecting"
    || status === "setup-wait"
    || status === "stopping"
  ) {
    return "안전하게 연결하는 중";
  }

  const normalized = (error ?? "").toLowerCase();
  if (
    normalized.includes("notallowederror")
    || normalized.includes("permission")
    || normalized.includes("denied")
  ) {
    return "마이크 사용이 꺼져 있어. iPhone 설정에서 마이크를 허용해줘.";
  }
  if (
    normalized.includes("notfounderror")
    || normalized.includes("devicesnotfounderror")
  ) {
    return "마이크를 찾지 못했어. 연결 상태를 확인해줘.";
  }
  if (
    normalized.includes("notreadableerror")
    || normalized.includes("trackstarterror")
  ) {
    return "다른 앱이 마이크를 사용 중일 수 있어. 닫고 다시 시도해줘.";
  }
  if (normalized.includes("secure_context_required")) {
    return "안전한 연결에서만 마이크를 사용할 수 있어.";
  }
  if (
    normalized.includes("media_devices_unsupported")
    || normalized.includes("audio_context_unsupported")
  ) {
    return "이 브라우저에서는 음성 기능을 사용할 수 없어.";
  }
  if (normalized.includes("missing_gemini_api_key")) {
    return "음성 서비스 준비가 끝나지 않았어. 잠시 후 다시 시도해줘.";
  }
  if (status === "blocked" || status === "error") {
    return "음성 서비스 연결이 잠시 불안정해. 잠시 후 다시 시도해줘.";
  }
  return "준비되면 시작해줘";
}

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
