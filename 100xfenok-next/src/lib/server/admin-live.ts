import {
  buildLiveToolDeclarations,
  buildLiveToolInstructions,
  normalizeLiveToolIds,
  type LiveToolId,
} from "@/lib/server/admin-live-tools";

export const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
export const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const GEMINI_LIVE_MODEL_RESOURCE = `models/${GEMINI_LIVE_MODEL}`;
export const GEMINI_AUTH_TOKEN_ENDPOINT = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";
export const GEMINI_LIVE_WS_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export type LiveBenchMode = "fenok" | "mona";
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
    prefixPaddingMs: 60,
    silenceDurationMs: 900,
  },
};

export const LIVE_PROFILES: Record<LiveBenchMode, LiveProfile> = {
  fenok: {
    id: "fenok",
    label: "시장 리스크 문답",
    intent: "시장 리스크를 짧게 묻고 답합니다.",
    constraints: [
      "한국어로 먼저 답한다.",
      "Cortex, 저장소, 포트폴리오 시스템을 호출하지 않는다.",
      "웹 검색과 외부 시장 데이터는 현재 연결되지 않았다고 정확히 말한다.",
      "실시간 검증이 아닌 시장 사실은 불확실성과 구분해서 말한다.",
    ],
    sampleProbe: "오늘 시장에서 가장 먼저 확인할 리스크를 짧게 정리해줘.",
    languageHints: ["ko-KR", "en-US"],
  },
  mona: {
    id: "mona",
    label: "영어 워밍업",
    intent: "짧은 영어 말하기 연습을 합니다.",
    constraints: [
      "차분하고 짧게 답한다.",
      "먼저 자연스러운 영어 문장 하나를 말하고, 필요한 경우 짧게 교정한다.",
      "개인 transcript 기록을 저장하거나 추론하지 않는다.",
      "학습 라벨은 필요할 때만 짧게 말한다.",
    ],
    sampleProbe: "오늘 너무 피곤해서 짧게만 공부하고 싶어.",
    languageHints: ["ko-KR", "en-US"],
  },
};

export function normalizeLiveMode(value: unknown): LiveBenchMode {
  return value === "mona" ? "mona" : "fenok";
}

export function normalizeLiveVoice(value: unknown): string {
  return LIVE_VOICES.some((voice) => voice.id === value) ? String(value) : "Kore";
}

export function normalizeResponseStyle(value: unknown): LiveResponseStyle {
  return value === "balanced" || value === "detailed" ? value : "concise";
}

export function normalizeVadPreset(value: unknown, mode: LiveBenchMode): LiveVadPreset {
  if (value === "responsive" || value === "relaxed" || value === "balanced") return value;
  return mode === "mona" ? "relaxed" : "balanced";
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
  const constraints = profile.constraints.filter((constraint) => !constraint.includes("외부 시장 데이터"));
  const toolInstructions = buildLiveToolInstructions(enabledToolIds);
  return [
    `Profile: ${profile.label}`,
    `Intent: ${profile.intent}`,
    `Voice: ${lowVoice ? "calm, low-energy, late-night pacing" : "normal conversational pacing"}`,
    `Response style: ${LIVE_RESPONSE_STYLES[responseStyle]}`,
    ...constraints.map((constraint) => `Constraint: ${constraint}`),
    ...(toolInstructions.length
      ? toolInstructions
      : ["Constraint: 웹 검색과 외부 시장 데이터는 현재 연결되지 않았다고 정확히 말한다."]),
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
  return trimmed.slice(0, 2400);
}

function ensureLiveToolInstructions(systemPrompt: string, enabledToolIds: LiveToolId[]) {
  const missingInstructions = buildLiveToolInstructions(enabledToolIds)
    .filter((instruction) => !systemPrompt.includes(instruction));
  if (missingInstructions.length === 0) return systemPrompt;
  return [systemPrompt, ...missingInstructions].join("\n");
}

export function buildLiveSetup(
  mode: LiveBenchMode,
  options: {
    lowVoice: boolean;
    voiceName?: unknown;
    responseStyle?: unknown;
    vadPreset?: unknown;
    systemPrompt?: unknown;
    enabledToolIds?: unknown;
  },
) {
  const profile = LIVE_PROFILES[mode];
  const responseStyle = normalizeResponseStyle(options.responseStyle);
  const vadPreset = normalizeVadPreset(options.vadPreset, mode);
  const vad = LIVE_VAD_PRESETS[vadPreset];
  const enabledToolIds = normalizeLiveToolIds(options.enabledToolIds);
  const systemPrompt = ensureLiveToolInstructions(
    normalizeSystemPrompt(options.systemPrompt, mode, options.lowVoice, responseStyle, enabledToolIds),
    enabledToolIds,
  );
  const functionDeclarations = buildLiveToolDeclarations(enabledToolIds);

  const setup: Record<string, unknown> = {
    model: GEMINI_LIVE_MODEL_RESOURCE,
    generationConfig: {
      responseModalities: ["AUDIO"],
      temperature: mode === "mona" ? 0.55 : 0.35,
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
      activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
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
    sessionResumption: {},
  };

  if (functionDeclarations.length > 0) {
    setup.tools = [
      {
        functionDeclarations,
      },
    ];
  }

  return setup;
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
