import { buildMonaVnextSystemPrompt } from "@/features/mona-vnext/coach/coachPrompt";
import { MONA_VNEXT_NAMESPACE_POLICY } from "@/features/mona-vnext/memory/monaVnextNamespace";

export const MONA_VNEXT_GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
export const MONA_VNEXT_GEMINI_MODEL = "gemini-3.1-flash-live-preview";
export const MONA_VNEXT_GEMINI_MODEL_RESOURCE = `models/${MONA_VNEXT_GEMINI_MODEL}`;
export const MONA_VNEXT_AUTH_TOKEN_ENDPOINT = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";
export const MONA_VNEXT_LIVE_WS_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export type MonaVnextVoiceName = "Kore" | "Aoede" | "Puck" | "Charon" | "Achernar";
export type MonaVnextVadPreset = "relaxed" | "balanced";
export type MonaVnextInterruptionMode = "no-interrupt" | "barge-in";

const VAD_PRESETS: Record<MonaVnextVadPreset, {
  startOfSpeechSensitivity: "START_SENSITIVITY_LOW" | "START_SENSITIVITY_HIGH";
  endOfSpeechSensitivity: "END_SENSITIVITY_LOW" | "END_SENSITIVITY_HIGH";
  prefixPaddingMs: number;
  silenceDurationMs: number;
}> = {
  relaxed: {
    startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    prefixPaddingMs: 300,
    silenceDurationMs: 1200,
  },
  balanced: {
    startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    prefixPaddingMs: 80,
    silenceDurationMs: 800,
  },
};

export function getMonaVnextGeminiApiKey() {
  const value = process.env[MONA_VNEXT_GEMINI_API_KEY_ENV];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeMonaVnextVoice(value: unknown): MonaVnextVoiceName {
  return value === "Aoede" || value === "Puck" || value === "Charon" || value === "Achernar" ? value : "Kore";
}

export function normalizeMonaVnextVadPreset(value: unknown): MonaVnextVadPreset {
  return value === "balanced" ? "balanced" : "relaxed";
}

export function normalizeMonaVnextInterruptionMode(value: unknown): MonaVnextInterruptionMode {
  return value === "barge-in" ? "barge-in" : "no-interrupt";
}

export function buildMonaVnextReadiness() {
  const hasKey = getMonaVnextGeminiApiKey() !== null;
  return {
    adapter: "gemini-live-ephemeral-vnext",
    status: hasKey ? "READY" : "BLOCKED",
    missingEnv: hasKey ? null : MONA_VNEXT_GEMINI_API_KEY_ENV,
    model: MONA_VNEXT_GEMINI_MODEL,
    websocketEndpoint: MONA_VNEXT_LIVE_WS_ENDPOINT,
    tokenEndpoint: "server-only:v1alpha/auth_tokens",
    namespace: MONA_VNEXT_NAMESPACE_POLICY,
    requiredClient: {
      secureContext: true,
      microphone: true,
      audioInput: "raw 16-bit PCM audio, 16kHz, little-endian",
      audioOutput: "raw 16-bit PCM audio, 24kHz, little-endian",
    },
  };
}

export function buildMonaVnextLiveSetup(options: {
  voiceName: MonaVnextVoiceName;
  vadPreset: MonaVnextVadPreset;
  lowVoice: boolean;
  interruptionMode: MonaVnextInterruptionMode;
  englishVisible: boolean;
}) {
  const vad = VAD_PRESETS[options.vadPreset];
  return {
    model: MONA_VNEXT_GEMINI_MODEL_RESOURCE,
    generationConfig: {
      responseModalities: ["AUDIO"],
      thinkingConfig: { thinkingLevel: "low" },
      temperature: 0.55,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: options.voiceName,
          },
        },
      },
    },
    systemInstruction: {
      parts: [
        {
          text: buildMonaVnextSystemPrompt({
            lowVoice: options.lowVoice,
            englishVisible: options.englishVisible,
          }),
        },
      ],
    },
    realtimeInputConfig: {
      activityHandling: options.interruptionMode === "no-interrupt"
        ? "NO_INTERRUPTION"
        : "START_OF_ACTIVITY_INTERRUPTS",
      automaticActivityDetection: {
        disabled: false,
        ...vad,
      },
    },
    inputAudioTranscription: {
      languageHints: {
        languageCodes: ["ko-KR", "en-US"],
      },
    },
    outputAudioTranscription: {
      languageHints: {
        languageCodes: ["ko-KR", "en-US"],
      },
    },
    sessionResumption: {},
    contextWindowCompression: { slidingWindow: {} },
  };
}
