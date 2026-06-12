import {
  buildLiveToolDeclarations,
  buildLiveToolInstructions,
  normalizeLiveToolIds,
  type LiveToolId,
} from "@/lib/server/admin-live-tools";
import {
  buildMonaCoachDynamicBlock,
  buildMonaCoachDynamicBlockV2,
  getCanonicalMonaStudyDate,
  isLessonV2Enabled,
} from "@/lib/server/mona-study-tools";
import { callMonaStudy } from "@/lib/server/admin-live-skill-bridge";

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
  mona: {
    id: "mona",
    label: "Wind-Down",
    intent: "영어 발화 코치. 아는 단어로 문장 조립을 반복 연습시킵니다.",
    constraints: [
      "너는 모나의 영어 발화 코치다. 반말로 부드럽고 친절하게.",
      "교과서 영어 금지. 미국인이 실제로 자주 쓰는 미드/실생활 표현만.",
      "한국어 문장을 던지면 모나가 영어로 말하고, 짧게 교정하고, 진짜 쓰는 버전을 알려준 뒤 따라 말하게 시킨다. 길게 설명하지 않는다.",
      "문법은 따로 코너로 만들지 말고, 교정할 때 한 줄씩 틈새로만 짚는다.",
      "지금 단계는 아는 단어로 문장 조립이다. 어려운 단어 쓰지 말고 짧은 문장부터.",
      "단계 전환을 말로 알리지 않는다. 어느 코너 할지 묻지 말고 코치가 조용히 진행한다.",
      "주입된 복습 재료(어제 BEST3·약점노트)가 있으면 오늘 문장에 섞어 쓰고, 첫 세션이면 오늘 표현 후보만으로 간다.",
      "세션 중간 checkpoint와 끝의 오늘 BEST3를 saveStudySession으로 저장한다.",
      "섀도잉 땐 연음과 강세를 한글로 적어준다. 예: Whaddya want = 와르유원ㅌ.",
      "낮게 중얼/속삭이며 입모양 크게 하도록 안내한다.",
      "칭찬은 짧게, 교정은 정확하게. 잘한 척 넘어가지 않는다.",
      "오늘 이 말 영어로 못 했어: [한국어]가 오면 그날 테마보다 그것부터 한다.",
      "표현을 알려줄 때 교과서식이면 원어민이 실제 쓰는 버전으로 바꾸고 차이를 한 줄로만 짚는다.",
      "모나가 직역으로 막히면 문장을 고쳐주기 전에 '무슨 내용을 말하려고 했어?'부터 묻는다.",
      "비슷한 표현이 두 개 나오면 설명 대신 상황 두세 개로 차이를 보여준다.",
    ],
    sampleProbe: "시작",
    languageHints: ["en-US", "ko-KR"],
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

function prependDynamicBlock(dynamicBlock: string, systemPrompt: string) {
  const maxLength = 7000;
  const block = dynamicBlock.trim();
  if (!block) return systemPrompt.slice(0, maxLength);
  const separator = "\n\n";
  const remaining = maxLength - block.length - separator.length;
  if (remaining <= 0) return block.slice(0, maxLength);
  return `${block}${separator}${systemPrompt.slice(0, remaining)}`;
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
  },
) {
  const profile = LIVE_PROFILES[mode];
  const responseStyle = normalizeResponseStyle(options.responseStyle);
  const vadPreset = normalizeVadPreset(options.vadPreset, mode);
  const vad = LIVE_VAD_PRESETS[vadPreset];
  const interruptionMode = options.interruptionMode === "no-interrupt" || options.interruptionMode === "barge-in"
    ? options.interruptionMode
    : mode === "mona" ? "no-interrupt" : "barge-in";
  const resumeHandle = typeof options.resumeHandle === "string" && options.resumeHandle.length > 0 && options.resumeHandle.length <= 512
    ? options.resumeHandle
    : null;
  const enabledToolIds = normalizeLiveToolIds(options.enabledToolIds);
  let systemPrompt = ensureLiveToolInstructions(
    normalizeSystemPrompt(options.systemPrompt, mode, options.lowVoice, responseStyle, enabledToolIds),
    enabledToolIds,
  );
  if (mode === "mona") {
    const bridgeResult = await callMonaStudy("prepareMonaStudySnapshot", {});
    const snapshot = (bridgeResult && !("error" in bridgeResult) && bridgeResult.payload)
      ? (bridgeResult.payload as Record<string, unknown>)
      : {
          studyDate: getCanonicalMonaStudyDate(),
          loadedAt: new Date().toISOString(),
          sessions: [],
          best3: [],
          weakNotes: [],
        };
    systemPrompt = prependDynamicBlock(
      isLessonV2Enabled()
        ? await buildMonaCoachDynamicBlockV2(undefined, snapshot as any)
        : await buildMonaCoachDynamicBlock(undefined, snapshot as any),
      systemPrompt,
    );
  }
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
