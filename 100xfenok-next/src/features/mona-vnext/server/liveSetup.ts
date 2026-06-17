import { buildMonaVnextSystemPrompt } from "@/features/mona-vnext/coach/coachPrompt";
import {
  MONA_VNEXT_DEFAULT_GEMINI_MODEL,
  MONA_VNEXT_GEMINI_MODELS,
  normalizeMonaVnextGeminiModel,
} from "@/features/mona-vnext/live/modelOptions";
import {
  MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE,
  MONA_VNEXT_LIVE_THINKING_LEVEL,
  normalizeMonaVnextLiveTemperature,
} from "@/features/mona-vnext/live/generationOptions";
import { MONA_VNEXT_NAMESPACE_POLICY } from "@/features/mona-vnext/memory/monaVnextNamespace";
import { getMonaVnextPersistenceReadiness } from "@/features/mona-vnext/storage/objectStore";

export const MONA_VNEXT_GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
export const MONA_VNEXT_GEMINI_MODEL = MONA_VNEXT_DEFAULT_GEMINI_MODEL;
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

export async function buildMonaVnextReadiness() {
  const hasKey = getMonaVnextGeminiApiKey() !== null;
  const persistence = await getMonaVnextPersistenceReadiness();
  const ready = hasKey && persistence.status === "READY";
  return {
    adapter: "gemini-live-ephemeral-vnext",
    status: ready ? "READY" : "BLOCKED",
    missingEnv: hasKey ? null : MONA_VNEXT_GEMINI_API_KEY_ENV,
    missingBinding: hasKey ? persistence.missingBinding : null,
    persistence,
    model: MONA_VNEXT_GEMINI_MODEL,
    supportedModels: MONA_VNEXT_GEMINI_MODELS,
    generation: {
      temperature: MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE,
      thinkingLevel: MONA_VNEXT_LIVE_THINKING_LEVEL,
      responseModalities: ["AUDIO"],
    },
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
  model?: unknown;
  voiceName: MonaVnextVoiceName;
  vadPreset: MonaVnextVadPreset;
  lowVoice: boolean;
  interruptionMode: MonaVnextInterruptionMode;
  englishVisible: boolean;
  temperature?: unknown;
}) {
  const vad = VAD_PRESETS[options.vadPreset];
  const model = normalizeMonaVnextGeminiModel(options.model);
  const temperature = normalizeMonaVnextLiveTemperature(options.temperature);
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      thinkingConfig: { thinkingLevel: MONA_VNEXT_LIVE_THINKING_LEVEL },
      temperature,
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
