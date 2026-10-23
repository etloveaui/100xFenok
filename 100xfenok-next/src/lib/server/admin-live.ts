import {
  buildLiveToolDeclarations,
  buildLiveToolInstructions,
  normalizeLiveToolIds,
  type LiveToolId,
} from "@/lib/server/admin-live-tools";
import type { CoachSessionState } from "@/lib/server/mona-study-tools";
import { resolveModelId } from "@/lib/server/model-registry-resolver";

export const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
// Pinned fallback; kept as the literal of record for the sync test in
// scripts/mona-distill/tests/test_mona_distill.py (registry alias: gemini-live).
export const GEMINI_LIVE_MODEL_FALLBACK = "gemini-3.1-flash-live-preview";
export const GEMINI_LIVE_MODEL = resolveModelId("gemini-live", GEMINI_LIVE_MODEL_FALLBACK);
export const GEMINI_LIVE_MODEL_RESOURCE = `models/${GEMINI_LIVE_MODEL}`;
export const GEMINI_AUTH_TOKEN_ENDPOINT = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";
export const GEMINI_LIVE_WS_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export type LiveBenchMode = "fenok";
export type LiveResponseStyle = "concise" | "balanced" | "detailed";
export type LiveVadPreset = "responsive" | "balanced" | "relaxed";

type LiveProfile = {
  id: LiveBenchMode;
  label: string;
  intent: string;
  constraints: string[];
  sampleProbe: string;
  languageHints: string[];
};

export const LIVE_VOICES = [
  { id: "Kore", label: "Kore", tone: "단단하고 차분함" },
  { id: "Puck", label: "Puck", tone: "밝고 경쾌함" },
  { id: "Charon", label: "Charon", tone: "설명형" },
  { id: "Aoede", label: "Aoede", tone: "가볍고 부드러움" },
  { id: "Fenrir", label: "Fenrir", tone: "활기 있음" },
  { id: "Achernar", label: "Achernar", tone: "부드러움" },
] as const;

export const LIVE_RESPONSE_STYLES: Record<LiveResponseStyle, string> = {
  concise: "첫 답변은 두세 문장으로 짧게 답한다.",
  balanced: "필요한 맥락을 포함하되 장황하게 늘리지 않는다.",
  detailed: "사용자가 원인을 묻는 경우 근거와 한계를 함께 설명한다.",
};

const LIVE_VAD_PRESETS: Record<LiveVadPreset, {
  startOfSpeechSensitivity: "START_SENSITIVITY_LOW" | "START_SENSITIVITY_HIGH";
  endOfSpeechSensitivity: "END_SENSITIVITY_LOW" | "END_SENSITIVITY_HIGH";
  prefixPaddingMs: number;
  silenceDurationMs: number;
}> = {
  responsive: {
    startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    prefixPaddingMs: 20,
    silenceDurationMs: 600,
  },
  balanced: {
    startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    prefixPaddingMs: 40,
    silenceDurationMs: 750,
  },
  relaxed: {
    startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    // 300ms: short fillers ("어", breaths) no longer trigger barge-in mid-playback
    prefixPaddingMs: 300,
    silenceDurationMs: 1200,
  },
};

export const LIVE_PROFILES: Record<LiveBenchMode, LiveProfile> = {
  fenok: {
    id: "fenok",
    label: "일반",
    intent: "일상 대화를 자연스럽게 나누는 한국어 음성 비서입니다.",
    constraints: [
      "한국어로 자연스럽게 대화한다.",
      "질문 난이도에 맞춰 답의 깊이를 조절한다. 간단하면 짧게, 설명이 필요하면 차근차근.",
      "모르거나 실시간 확인이 안 되는 사실은 추측과 구분해 솔직히 말한다.",
      "활성화된 도구가 있으면 자연스럽게 활용하고, 없으면 아는 선에서 답한다.",
    ],
    sampleProbe: "오늘 저녁 뭐 해 먹으면 좋을지 같이 골라줘.",
    languageHints: ["ko-KR", "en-US"],
  },
};

// The Wind-Down ("mona") profile was taken down (owner decision 2026-10-23): every request opens the general profile.
export function normalizeLiveMode(_value: unknown): LiveBenchMode {
  return "fenok";
}

export function normalizeLiveVoice(value: unknown): string {
  return LIVE_VOICES.some((voice) => voice.id === value) ? String(value) : "Kore";
}

export function normalizeResponseStyle(value: unknown): LiveResponseStyle {
  return value === "balanced" || value === "detailed" ? value : "concise";
}

export function normalizeVadPreset(value: unknown, _mode: LiveBenchMode): LiveVadPreset {
  if (value === "responsive" || value === "relaxed" || value === "balanced") return value;
  return "balanced";
}

export function getGeminiApiKey(): string | null {
  const value = process.env[GEMINI_API_KEY_ENV];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildDefaultSystemPrompt(
  mode: LiveBenchMode,
  lowVoice: boolean,
  responseStyle: LiveResponseStyle,
  enabledToolIds: LiveToolId[] = [],
) {
  const profile = LIVE_PROFILES[mode];
  const toolInstructions = buildLiveToolInstructions(enabledToolIds);
  return [
    `Profile: ${profile.label}`,
    `Intent: ${profile.intent}`,
    `Voice: ${lowVoice ? "calm, low-energy, late-night pacing" : "normal conversational pacing"}`,
    `Response style: ${LIVE_RESPONSE_STYLES[responseStyle]}`,
    ...profile.constraints.map((constraint) => `Constraint: ${constraint}`),
    ...(toolInstructions.length
      ? toolInstructions
      : ["Constraint: 사용자가 켜지 않은 도구는 연결된 것처럼 말하지 않는다."]),
  ].join("\n");
}

function normalizeSystemPrompt(
  value: unknown,
  mode: LiveBenchMode,
  lowVoice: boolean,
  responseStyle: LiveResponseStyle,
  enabledToolIds: LiveToolId[],
) {
  if (typeof value !== "string") return buildDefaultSystemPrompt(mode, lowVoice, responseStyle, enabledToolIds);
  const trimmed = value.trim();
  if (!trimmed) return buildDefaultSystemPrompt(mode, lowVoice, responseStyle, enabledToolIds);
  return trimmed.slice(0, 4000);
}

function ensureLiveToolInstructions(systemPrompt: string, enabledToolIds: LiveToolId[]) {
  const missingInstructions = buildLiveToolInstructions(enabledToolIds)
    .filter((instruction) => !systemPrompt.includes(instruction));
  if (missingInstructions.length === 0) return systemPrompt;
  return [systemPrompt, ...missingInstructions].join("\n");
}

export async function buildLiveSetup(
  mode: LiveBenchMode,
  options: {
    lowVoice: boolean;
    voiceName?: unknown;
    responseStyle?: unknown;
    vadPreset?: unknown;
    interruptionMode?: unknown;
    resumeHandle?: unknown;
    systemPrompt?: unknown;
    enabledToolIds?: unknown;
    coachConfig?: unknown;
    sessionId?: unknown;
  },
): Promise<{ setup: Record<string, unknown>; coachSessionState: CoachSessionState | null }> {
  const profile = LIVE_PROFILES[mode];
  const responseStyle = normalizeResponseStyle(options.responseStyle);
  const vadPreset = normalizeVadPreset(options.vadPreset, mode);
  const vad = LIVE_VAD_PRESETS[vadPreset];
  const interruptionMode = options.interruptionMode === "no-interrupt" || options.interruptionMode === "barge-in"
    ? options.interruptionMode
    : "barge-in";
  const resumeHandle = typeof options.resumeHandle === "string" && options.resumeHandle.length > 0 && options.resumeHandle.length <= 512
    ? options.resumeHandle
    : null;
  const enabledToolIds = normalizeLiveToolIds(options.enabledToolIds);
  let systemPrompt = ensureLiveToolInstructions(
    normalizeSystemPrompt(options.systemPrompt, mode, options.lowVoice, responseStyle, enabledToolIds),
    enabledToolIds,
  );
  let coachSessionState: CoachSessionState | null = null;
  const functionDeclarations = buildLiveToolDeclarations(enabledToolIds);

  const setup: Record<string, unknown> = {
    model: GEMINI_LIVE_MODEL_RESOURCE,
    generationConfig: {
      responseModalities: ["AUDIO"],
      temperature: 0.35,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: normalizeLiveVoice(options.voiceName),
          },
        },
      },
    },
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    realtimeInputConfig: {
      activityHandling: interruptionMode === "no-interrupt" ? "NO_INTERRUPTION" : "START_OF_ACTIVITY_INTERRUPTS",
      automaticActivityDetection: {
        disabled: false,
        ...vad,
      },
    },
    inputAudioTranscription: {
      languageHints: {
        languageCodes: profile.languageHints,
      },
    },
    outputAudioTranscription: {
      languageHints: {
        languageCodes: profile.languageHints,
      },
    },
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    contextWindowCompression: { slidingWindow: {} },
  };

  if (functionDeclarations.length > 0) {
    setup.tools = [
      {
        functionDeclarations,
      },
    ];
  }

  return { setup, coachSessionState };
}

export function buildReadiness() {
  const hasKey = getGeminiApiKey() !== null;
  return {
    adapter: "gemini-live-ephemeral",
    status: hasKey ? "READY" : "BLOCKED",
    missingEnv: hasKey ? null : GEMINI_API_KEY_ENV,
    model: GEMINI_LIVE_MODEL,
    websocketEndpoint: GEMINI_LIVE_WS_ENDPOINT,
    tokenEndpoint: "server-only:v1alpha/auth_tokens",
    requiredClient: {
      secureContext: true,
      microphone: true,
      audioInput: "raw 16-bit PCM audio, 16kHz, little-endian",
    },
  };
}
