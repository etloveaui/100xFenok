'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import MonaWindDown, { type WindDownPhase } from "@/components/admin-live/MonaWindDown";
import {
  DEFAULT_COACH_CONFIG,
  normalizeCoachConfig,
  type CoachConfig,
  type CoachDifficulty,
  type CoachReviewMode,
  type CoachTester,
} from "@/lib/admin-live-coach-config";

type BenchMode = "fenok" | "mona";
type SessionStatus = "idle" | "checking" | "blocked" | "ready" | "connecting" | "listening" | "stopped";
type ConnectionState = "not-started" | "blocked" | "token-ready" | "socket-opening" | "setup-wait" | "live" | "closed" | "error";
type MicState = "unknown" | "unsupported" | "prompt" | "granted" | "denied" | "active" | "stopped";
type Rating = "useful" | "not-useful" | null;
type ResponseStyle = "concise" | "balanced" | "detailed";
type VadPreset = "responsive" | "balanced" | "relaxed";
type InterruptionMode = "barge-in" | "no-interrupt";
type LiveToolCategory = "data" | "search" | "vision" | "dialog-mode" | "study";
type LiveToolStatus = "available" | "locked" | "soon";
type SearchSelectionPolicy = "single" | "multi";
type LessonMaterialIntent = "new" | "easier" | "harder" | "again" | "switch_theme";
type LessonMaterialSource = "buffer" | "tool";

type CoachSessionState = {
  sessionId: string | null;
  currentItemKey: string | null;
  seenItemKeys: string[];
  bufferedItemKeys: string[];
  lastLearnerIntent: string | null;
  lastToolIntent: string | null;
  reviewCountActual: number;
  newCountActual: number;
};

type LiveToolMetadata = {
  id: string;
  label: string;
  category: LiveToolCategory;
  status: LiveToolStatus;
  description: string;
  reason?: string;
};

type BenchLog = {
  id: string;
  seq?: number;
  role: "system" | "user" | "bench" | "tool" | "error";
  text: string;
  at: string;
  atIso?: string;
};

export type ExpressionCard = {
  state: "prompt" | "reveal" | "drill";
  ko: string;
  en?: string;
  pron?: string;
  drillHint?: string;
  updatedAt: number;
};

type BenchMetrics = {
  micPermission: MicState;
  connectionState: ConnectionState;
  firstResponseMs: number | null;
  sessionPostMs: number | null;
  socketOpenMs: number | null;
  setupDoneMs: number | null;
  transcriptLatencyMs: number | null;
  turnCount: number;
  interruptionCount: number;
  audioFramesSent: number;
  sessionDurationSec: number;
  lowVoice: boolean;
  lastError: string | null;
  rating: Rating;
  appendFailureCount: number;
  lastAppendError: string | null;
  resumeCount: number;
  lessonMaterialToolCalls: number;
  lessonMaterialLastReturnedCount: number | null;
  lessonMaterialLastLatencyMs: number | null;
  lessonMaterialLastSource: LessonMaterialSource | null;
  clientIntentHint: string | null;
  modelToolIntent: string | null;
  intentHintMatched: boolean | null;
};

type ReadinessResponse = {
  readiness: {
    status: "READY" | "BLOCKED";
    missingEnv: string | null;
    model: string;
    adapter: string;
    websocketEndpoint: string;
  };
  profiles: Array<{
    id: BenchMode;
    label: string;
    intent: string;
    constraints: string[];
    sampleProbe: string;
    languageHints: string[];
    defaultSystemPrompt?: string;
  }>;
  voices?: Array<{
    id: string;
    label: string;
    tone: string;
  }>;
  defaults?: {
    voiceName?: string;
    responseStyle?: ResponseStyle;
    vadPreset?: VadPreset;
    coachConfig?: CoachConfig;
    tools?: {
      enabledToolIds?: string[];
      enabledToolIdsByMode?: Partial<Record<BenchMode, string[]>>;
      registry?: LiveToolMetadata[];
      searchSelectionPolicy?: SearchSelectionPolicy;
    };
  };
};

type SessionResponse = {
  sessionId: string;
  status: "LIVE_TOKEN_READY";
  startedAt: string;
  adapter: "gemini-live-ephemeral";
  mode: BenchMode;
  token: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  websocketEndpoint: string;
  setup: Record<string, unknown>;
  profile: {
    id: BenchMode;
    label: string;
    intent: string;
    constraints: string[];
    sampleProbe: string;
  };
  metrics: Partial<BenchMetrics>;
  settings?: {
    voiceName?: string;
    responseStyle?: ResponseStyle;
    vadPreset?: VadPreset;
    interruptionMode?: InterruptionMode;
    coachConfig?: CoachConfig;
    coachSessionState?: CoachSessionState | null;
    enabledToolIds?: string[];
  };
};

type AudioRuntime = {
  context: AudioContext;
  outputGain: GainNode;
  inputMonitorGain: GainNode;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode | AudioWorkletNode;
  stream: MediaStream;
};

type AudioOutput = {
  context: AudioContext;
  gain: GainNode;
};

type WakeLockHandle = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};

type LiveFunctionCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

const PROFILE_FALLBACK: ReadinessResponse["profiles"] = [
  {
    id: "fenok",
    label: "일반",
    intent: "일상 대화를 자연스럽게 나누는 한국어 음성 비서입니다.",
    constraints: ["한국어 자연 대화", "질문 난이도에 맞춘 깊이", "모르는 사실은 솔직히 구분"],
    sampleProbe: "오늘 저녁 뭐 해 먹으면 좋을지 같이 골라줘.",
    languageHints: ["ko-KR", "en-US"],
    defaultSystemPrompt: [
      "Profile: 일반",
      "Intent: 일상 대화를 자연스럽게 나누는 한국어 음성 비서입니다.",
      "Voice: calm, low-energy, late-night pacing",
      "Response style: 첫 답변은 두세 문장으로 짧게 답한다.",
      "Constraint: 한국어로 자연스럽게 대화한다.",
      "Constraint: 질문 난이도에 맞춰 답의 깊이를 조절한다.",
      "Constraint: 사용자가 켜지 않은 도구는 연결된 것처럼 말하지 않는다.",
    ].join("\n"),
  },
  {
    id: "mona",
    label: "Wind-Down",
    intent: "자기 전 영어 발화 코치입니다. 아는 단어로 문장 조립을 반복 연습시킵니다.",
    constraints: ["자기 전 low voice", "한→영 즉답", "BEST3와 약점 노트 저장"],
    sampleProbe: "시작",
    languageHints: ["en-US", "ko-KR"],
    defaultSystemPrompt: [
      "Profile: Wind-Down",
      "Intent: 자기 전 영어 발화 코치입니다.",
      "Voice: calm, low-energy, late-night pacing",
      "Response style: 첫 답변은 두세 문장으로 짧게 답한다.",
      "Constraint: 교과서 영어 금지. 미국인이 실제로 자주 쓰는 표현만.",
      "Constraint: 단계 전환을 말로 알리지 말고, 어느 코너 할지 묻지 않는다.",
      "Constraint: 중간 checkpoint와 끝의 BEST3를 저장한다.",
    ].join("\n"),
  },
];

const VOICE_FALLBACK = [
  { id: "Kore", label: "Kore", tone: "단단하고 차분함" },
  { id: "Puck", label: "Puck", tone: "밝고 경쾌함" },
  { id: "Charon", label: "Charon", tone: "설명형" },
  { id: "Aoede", label: "Aoede", tone: "가볍고 부드러움" },
  { id: "Fenrir", label: "Fenrir", tone: "활기 있음" },
  { id: "Achernar", label: "Achernar", tone: "부드러움" },
];

const RESPONSE_STYLE_LABEL: Record<ResponseStyle, string> = {
  concise: "짧게",
  balanced: "균형",
  detailed: "상세",
};

const VAD_PRESET_LABEL: Record<VadPreset, string> = {
  responsive: "빠른 끼어들기",
  balanced: "기본",
  relaxed: "느긋함",
};

const INTERRUPTION_MODE_LABEL: Record<InterruptionMode, string> = {
  "barge-in": "말하면 멈춤",
  "no-interrupt": "끝까지 말함",
};

const COACH_REVIEW_LABEL: Record<CoachReviewMode, string> = {
  "new-first": "새 문장 중심",
  balanced: "균형",
  "review-first": "복습 중심",
  soft: "균형",
  hard: "레거시 복습",
  off: "복습 끔",
};

const COACH_REVIEW_PRESETS: CoachReviewMode[] = ["new-first", "balanced", "review-first"];

const COACH_DIFFICULTY_LABEL: Record<CoachDifficulty, string> = {
  easy: "쉬움",
  normal: "보통",
  challenge: "조금 도전",
};

const COACH_TESTER_LABEL: Record<CoachTester, string> = {
  mona: "모나 학습",
  owner: "테스트",
};

const MODE_PRESETS: Record<BenchMode, { voiceName: string; vadPreset: VadPreset; lowVoice: boolean }> = {
  fenok: { voiceName: "Kore", vadPreset: "balanced", lowVoice: false },
  mona: { voiceName: "Achernar", vadPreset: "relaxed", lowVoice: true },
};

const TOOL_CATEGORY_LABEL: Record<LiveToolCategory, string> = {
  data: "데이터",
  study: "학습",
  search: "검색",
  vision: "비전",
  "dialog-mode": "대화 모드",
};

const TOOL_CATEGORY_ORDER: LiveToolCategory[] = ["study", "data", "search", "vision", "dialog-mode"];

const TOOL_STATUS_TEXT: Record<LiveToolStatus, string> = {
  available: "사용 가능",
  locked: "잠김",
  soon: "준비중",
};

const TOOL_REGISTRY_FALLBACK: LiveToolMetadata[] = [
  {
    id: "mona-save-session",
    label: "세션 저장",
    category: "study",
    status: "available",
    description: "Mona Wind-Down BEST3/weak-note checkpoint",
  },
  {
    id: "mona-yesterday",
    label: "어제 세션",
    category: "study",
    status: "available",
    description: "Yesterday BEST3 and weak-note warmup",
  },
  {
    id: "mona-memory",
    label: "표현집·약점",
    category: "study",
    status: "available",
    description: "Mona cumulative BEST3 and weak notes",
  },
  {
    id: "mona-weekly-test",
    label: "주간 테스트",
    category: "study",
    status: "available",
    description: "Sunday random recall set from memory",
  },
  {
    id: "mona-lesson-material",
    label: "요청형 문장",
    category: "study",
    status: "available",
    description: "New/easier/harder Mona material picker",
  },
  {
    id: "feno-data",
    label: "Feno Data",
    category: "data",
    status: "available",
    description: "Global Scouter, computed signals, SEC 13F local context",
  },
  {
    id: "feno-search",
    label: "Feno Search",
    category: "search",
    status: "soon",
    description: "Brave/Tavily search skill bridge",
    reason: "서버 skill bridge 연결 후 활성화",
  },
  {
    id: "google-search",
    label: "Google",
    category: "search",
    status: "locked",
    description: "Google/Gemini search path",
    reason: "Gemini Live grounding은 현재 보류",
  },
  {
    id: "naver-search",
    label: "Naver",
    category: "search",
    status: "soon",
    description: "Naver search skill bridge",
    reason: "서버 skill bridge 연결 후 활성화",
  },
  {
    id: "kakao-search",
    label: "Kakao",
    category: "search",
    status: "soon",
    description: "Kakao/Daum search skill bridge",
    reason: "서버 skill bridge 연결 후 활성화",
  },
  {
    id: "camera",
    label: "카메라",
    category: "vision",
    status: "soon",
    description: "모바일 카메라/이미지 입력",
    reason: "Android/iOS capture flow 설계 후 활성화",
  },
];

const EMPTY_METRICS: BenchMetrics = {
  micPermission: "unknown",
  connectionState: "not-started",
  firstResponseMs: null,
  sessionPostMs: null,
  socketOpenMs: null,
  setupDoneMs: null,
  transcriptLatencyMs: null,
  turnCount: 0,
  interruptionCount: 0,
  audioFramesSent: 0,
  sessionDurationSec: 0,
  lowVoice: true,
  lastError: null,
  rating: null,
  appendFailureCount: 0,
  lastAppendError: null,
  resumeCount: 0,
  lessonMaterialToolCalls: 0,
  lessonMaterialLastReturnedCount: null,
  lessonMaterialLastLatencyMs: null,
  lessonMaterialLastSource: null,
  clientIntentHint: null,
  modelToolIntent: null,
  intentHintMatched: null,
};

const STATUS_TEXT: Record<SessionStatus, string> = {
  idle: "대기",
  checking: "준비 확인 중",
  blocked: "시작 불가",
  ready: "준비됨",
  connecting: "연결 중",
  listening: "듣는 중",
  stopped: "멈춤",
};

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  "not-started": "아직 시작하지 않음",
  blocked: "막힘",
  "token-ready": "토큰 받는 중",
  "socket-opening": "Gemini 연결 중",
  "setup-wait": "대화방 준비 중",
  live: "연결됨",
  closed: "닫힘",
  error: "오류",
};

const MIC_TEXT: Record<MicState, string> = {
  unknown: "확인 전",
  unsupported: "지원 안 됨",
  prompt: "권한 필요",
  granted: "허용됨",
  denied: "거부됨",
  active: "사용 중",
  stopped: "꺼짐",
};

const LOG_ROLE_TEXT: Record<BenchLog["role"], string> = {
  system: "상태",
  user: "내 말",
  bench: "Gemini",
  tool: "도구",
  error: "오류",
};

const LIVE_OUTPUT_SAMPLE_RATE = 24_000;
const MAX_LOG_ENTRIES = 24;
const MIC_WORKLET_SOURCE = `
class GeminiMicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;
    const outputRate = 16000;
    const ratio = sampleRate / outputRate;
    const length = Math.floor(input.length / ratio);
    if (length <= 0) return true;
    const result = new Int16Array(length);
    let inputOffset = 0;

    for (let outputOffset = 0; outputOffset < length; outputOffset += 1) {
      const nextInputOffset = Math.round((outputOffset + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let i = inputOffset; i < nextInputOffset && i < input.length; i += 1) {
        sum += input[i];
        count += 1;
      }
      const sample = Math.max(-1, Math.min(1, count ? sum / count : 0));
      result[outputOffset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      inputOffset = nextInputOffset;
    }

    this.port.postMessage(result.buffer, [result.buffer]);
    return true;
  }
}

registerProcessor("gemini-mic-processor", GeminiMicProcessor);
`;

function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "-";
  return `${value}${unit}`;
}

function formatClock(seconds: number): string {
  const min = Math.floor(seconds / 60).toString().padStart(2, "0");
  const sec = (seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowLabel(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate = 16000): Int16Array {
  if (inputRate <= outputRate) {
    const direct = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      direct[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return direct;
  }

  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const result = new Int16Array(length);
  let inputOffset = 0;

  for (let outputOffset = 0; outputOffset < length; outputOffset += 1) {
    const nextInputOffset = Math.round((outputOffset + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let i = inputOffset; i < nextInputOffset && i < input.length; i += 1) {
      sum += input[i];
      count += 1;
    }

    const sample = Math.max(-1, Math.min(1, count ? sum / count : 0));
    result[outputOffset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    inputOffset = nextInputOffset;
  }

  return result;
}

function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToPcmFloat32(value: string): Float32Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

function getSampleRate(mimeType?: string): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : LIVE_OUTPUT_SAMPLE_RATE;
}

function mergeTranscriptText(previous: string, next: string): string {
  const cleanNext = next.trim();
  if (!previous) return cleanNext;
  if (!cleanNext) return previous;
  if (previous.endsWith(cleanNext)) return previous;
  return `${previous.trimEnd()} ${cleanNext}`;
}

function normalizeEnabledToolIds(value: unknown, registry: LiveToolMetadata[]): string[] {
  if (!Array.isArray(value)) return [];
  const availableIds = new Set(
    registry
      .filter((tool) => tool.status === "available")
      .map((tool) => tool.id),
  );
  const seen = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== "string") return;
    if (!availableIds.has(item)) return;
    seen.add(item);
  });
  return [...seen];
}

function getModeDefaultToolIds(
  mode: BenchMode,
  registry: LiveToolMetadata[],
  byMode?: Partial<Record<BenchMode, string[]>>,
) {
  const fallback = mode === "mona"
    ? registry
      .filter((tool) => tool.category === "study" && tool.status === "available")
      .map((tool) => tool.id)
    : [];
  return normalizeEnabledToolIds(byMode?.[mode] ?? fallback, registry);
}

function toolTokenHint(count: number): string {
  if (count === 0) return "도구 0개";
  if (count === 1) return "도구 1개 · 토큰 낮음";
  if (count <= 3) return `도구 ${count}개 · 토큰 보통`;
  return `도구 ${count}개 · 토큰 높음`;
}

function buildPromptPreview(
  profile: ReadinessResponse["profiles"][number],
  lowVoice: boolean,
  responseStyle: ResponseStyle,
  enabledToolIds: string[],
): string {
  const responseStyleText = {
    concise: "첫 답변은 두세 문장으로 짧게 답한다.",
    balanced: "필요한 맥락을 포함하되 장황하게 늘리지 않는다.",
    detailed: "사용자가 원인을 묻는 경우 근거와 한계를 함께 설명한다.",
  } satisfies Record<ResponseStyle, string>;
  const toolInstructions = [
    enabledToolIds.some((id) => id.startsWith("mona-"))
      ? "Tool: Mona study tools are enabled. Use saveStudySession for checkpoints and BEST3, getYesterdaySession/getStudyMemory/getWeeklyTestSet only when needed. Do not invent dates or files."
      : null,
    enabledToolIds.includes("feno-data")
      ? "Tool: Feno Data is enabled. Use it for ticker context from local Global Scouter, computed signals, and SEC 13F data; state source dates and missing coverage."
      : null,
    enabledToolIds.some((id) => id === "feno-search" || id === "naver-search" || id === "kakao-search")
      ? "Tool: Search bridge tools are enabled. Use them for live verification through the Mac mini bridge, cite returned sources, and say plainly when a bridge call fails."
      : null,
  ].filter((instruction): instruction is string => Boolean(instruction));

  return [
    `Profile: ${profile.label}`,
    `Intent: ${profile.intent}`,
    `Voice: ${lowVoice ? "calm, low-energy, late-night pacing" : "normal conversational pacing"}`,
    `Response style: ${responseStyleText[responseStyle]}`,
    ...profile.constraints.map((constraint) => `Constraint: ${constraint}`),
    ...(toolInstructions.length
      ? toolInstructions
      : ["Constraint: 사용자가 켜지 않은 도구는 연결된 것처럼 말하지 않는다."]),
  ].join("\n");
}

function normalizeCoachItemKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  return key ? key.slice(0, 160) : null;
}

function normalizeCoachKeyArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const item of value) {
    const key = normalizeCoachItemKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= 24) break;
  }
  return keys;
}

function normalizeCoachSessionState(value: unknown, fallbackSessionId: string | null): CoachSessionState | null {
  if (!isRecord(value)) return fallbackSessionId ? {
    sessionId: fallbackSessionId,
    currentItemKey: null,
    seenItemKeys: [],
    bufferedItemKeys: [],
    lastLearnerIntent: null,
    lastToolIntent: null,
    reviewCountActual: 0,
    newCountActual: 0,
  } : null;
  return {
    sessionId: typeof value.sessionId === "string" ? value.sessionId : fallbackSessionId,
    currentItemKey: normalizeCoachItemKey(value.currentItemKey),
    seenItemKeys: normalizeCoachKeyArray(value.seenItemKeys),
    bufferedItemKeys: normalizeCoachKeyArray(value.bufferedItemKeys),
    lastLearnerIntent: typeof value.lastLearnerIntent === "string" ? value.lastLearnerIntent.slice(0, 40) : null,
    lastToolIntent: typeof value.lastToolIntent === "string" ? value.lastToolIntent.slice(0, 40) : null,
    reviewCountActual: typeof value.reviewCountActual === "number" && Number.isFinite(value.reviewCountActual)
      ? Math.max(0, Math.round(value.reviewCountActual))
      : 0,
    newCountActual: typeof value.newCountActual === "number" && Number.isFinite(value.newCountActual)
      ? Math.max(0, Math.round(value.newCountActual))
      : 0,
  };
}

function detectCoachLearnerIntent(text: string): string | null {
  const lower = text.toLowerCase();
  if (/그만|끝|stop|done/.test(lower)) return "stop";
  if (/쉬운|쉽게|too hard|easier|어려워/.test(lower)) return "easier";
  if (/어려운|더 어렵|harder/.test(lower)) return "harder";
  if (/다시|again|repeat/.test(lower)) return "again";
  if (/새로운|새 문장|다음|더 해|더줘|더 줘|more|next|different/.test(lower)) return "new";
  return null;
}

function toLessonMaterialIntent(value: unknown): LessonMaterialIntent | null {
  if (
    value === "new" ||
    value === "easier" ||
    value === "harder" ||
    value === "again" ||
    value === "switch_theme"
  ) return value;
  return null;
}

function toLessonMaterialSource(value: unknown): LessonMaterialSource | null {
  return value === "buffer" || value === "tool" ? value : null;
}

function toCoachIntentHint(intent: string | null): string | null {
  if (intent === "new") return "new_material";
  if (intent === "easier") return "easier_material";
  if (intent === "harder") return "harder_material";
  if (intent === "again") return "repeat_current";
  if (intent === "stop") return "stop";
  return null;
}

function unwrapToolResult(response: unknown): Record<string, unknown> | null {
  if (!isRecord(response)) return null;
  const result = response.result;
  return isRecord(result) ? result : null;
}

function getLessonMaterialItems(result: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(result.items) ? result.items.filter(isRecord) : [];
}

async function readSocketData(data: MessageEvent["data"]): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}

type AdminLiveBenchProps = {
  initialMode?: BenchMode;
  simpleUi?: boolean;
};

export default function AdminLiveBench({ initialMode = "fenok", simpleUi = false }: AdminLiveBenchProps = {}) {
  const [mode, setMode] = useState<BenchMode>(initialMode);
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [lowVoice, setLowVoice] = useState(true);
  const [metrics, setMetrics] = useState<BenchMetrics>(EMPTY_METRICS);
  const [logs, setLogs] = useState<BenchLog[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse["readiness"] | null>(null);
  const [profiles, setProfiles] = useState(PROFILE_FALLBACK);
  const [voices, setVoices] = useState(VOICE_FALLBACK);
  const [textProbe, setTextProbe] = useState(PROFILE_FALLBACK[0].sampleProbe);
  const [voiceName, setVoiceName] = useState("Kore");
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>("concise");
  const [vadPreset, setVadPreset] = useState<VadPreset>("balanced");
  const [interruptionMode, setInterruptionMode] = useState<InterruptionMode>(initialMode === "mona" ? "no-interrupt" : "barge-in");
  const [coachConfig, setCoachConfig] = useState<CoachConfig>(DEFAULT_COACH_CONFIG);
  const [systemPrompt, setSystemPrompt] = useState(PROFILE_FALLBACK[0].defaultSystemPrompt ?? "");
  const [promptEdited, setPromptEdited] = useState(false);
  const [toolRegistry, setToolRegistry] = useState<LiveToolMetadata[]>(TOOL_REGISTRY_FALLBACK);
  const [enabledToolIds, setEnabledToolIds] = useState<string[]>([]);
  const [searchSelectionPolicy, setSearchSelectionPolicy] = useState<SearchSelectionPolicy>("multi");
  const [isSendingText, setIsSendingText] = useState(false);
  const [card, setCard] = useState<ExpressionCard | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<AudioOutput | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const runtimeRef = useRef<AudioRuntime | null>(null);
  const logsRef = useRef<BenchLog[]>([]);
  const startRequestMsRef = useRef<number | null>(null);
  const firstResponseSeenRef = useRef(false);
  const lastAudioSentMsRef = useRef<number | null>(null);
  const playbackCursorRef = useRef(0);
  const audioChunkSeenRef = useRef(false);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const dropAudioUntilTurnCompleteRef = useRef(false);
  const dropAudioResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logSeqRef = useRef(0);
  const pendingRef = useRef<BenchLog[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(2500);
  const sessionIdRef = useRef<string | null>(null);
  const coachSessionStateRef = useRef<CoachSessionState | null>(null);
  const kickoffSentRef = useRef(false);
  const resumeHandleRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);
  const statusRef = useRef<SessionStatus>("checking");
  const resumeCountRef = useRef(0);
  const sentMetaRef = useRef(false);
  const audioFramesSentRef = useRef(0);
  const resumeReadyLoggedRef = useRef(false);
  const isSecure = typeof window === "undefined" ? true : window.isSecureContext;

  const PENDING_LOG_KEY = "fenok.adminlive.pendinglog.v1";

  const persistPending = () => {
    try {
      const sid = sessionIdRef.current;
      if (!sid || typeof localStorage === "undefined") return;
      if (pendingRef.current.length === 0) {
        localStorage.removeItem(PENDING_LOG_KEY);
        return;
      }
      localStorage.setItem(PENDING_LOG_KEY, JSON.stringify({
        sessionId: sid,
        mode,
        startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : new Date().toISOString(),
        tester: normalizedCoachConfig.tester,
        settings: buildLiveSettings(),
        entries: pendingRef.current,
      }));
    } catch {
      setMetrics((m) => ({
        ...m,
        appendFailureCount: m.appendFailureCount + 1,
        lastAppendError: "STORAGE_WRITE_FAILED",
      }));
    }
  };

  const statusLabel = useMemo(() => STATUS_TEXT[status], [status]);
  const activeProfile = useMemo(() => profiles.find((profile) => profile.id === mode) ?? profiles[0] ?? PROFILE_FALLBACK[0], [mode, profiles]);
  const settingsLocked = status === "connecting" || status === "listening";
  const activeToolCount = enabledToolIds.length;
  const normalizedCoachConfig = useMemo(() => normalizeCoachConfig(coachConfig), [coachConfig]);

  const updateCoachConfig = (patch: Partial<CoachConfig>) => {
    setCoachConfig((current) => {
      const next: Record<string, unknown> = { ...current, ...patch };
      if (patch.reviewMode && patch.reviewRatio === undefined) delete next.reviewRatio;
      if (patch.difficulty && patch.difficultyCap === undefined) delete next.difficultyCap;
      return normalizeCoachConfig(next);
    });
  };

  const buildLiveSettings = () => ({
    lowVoice,
    voiceName,
    responseStyle,
    vadPreset,
    interruptionMode,
    enabledToolIds,
    coachConfig: normalizedCoachConfig,
    tester: normalizedCoachConfig.tester,
    coachSessionState: coachSessionStateRef.current,
    bufferedItemKeys: coachSessionStateRef.current?.bufferedItemKeys ?? [],
  });

  const patchCoachSessionState = (patch: Partial<CoachSessionState>) => {
    if (mode !== "mona") return;
    const current = coachSessionStateRef.current ?? normalizeCoachSessionState(null, sessionIdRef.current);
    if (!current) return;
    coachSessionStateRef.current = { ...current, ...patch };
  };

  const markCoachItemSeen = (key: string | null) => {
    if (!key || mode !== "mona") return;
    const current = coachSessionStateRef.current ?? normalizeCoachSessionState(null, sessionIdRef.current);
    if (!current) return;
    const alreadySeen = current.seenItemKeys.includes(key);
    const fromBuffer = current.bufferedItemKeys.includes(key);
    coachSessionStateRef.current = {
      ...current,
      currentItemKey: key,
      seenItemKeys: alreadySeen ? current.seenItemKeys : [...current.seenItemKeys, key].slice(-24),
      bufferedItemKeys: fromBuffer ? current.bufferedItemKeys.filter((item) => item !== key) : current.bufferedItemKeys,
      newCountActual: !alreadySeen && fromBuffer ? current.newCountActual + 1 : current.newCountActual,
    };
  };

  const sendCoachIntentHint = (intent: string | null) => {
    if (mode !== "mona" || !normalizedCoachConfig.honorLiveRequests) return;
    const hint = toCoachIntentHint(intent);
    if (!hint) return;
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      realtimeInput: {
        text: `[coach_control] likely learner intent: ${hint}. Advisory only; infer from conversation and call requestLessonMaterial only if needed.`,
      },
    }));
    setMetrics((current) => ({
      ...current,
      clientIntentHint: hint,
      intentHintMatched: current.modelToolIntent ? current.modelToolIntent === hint : null,
    }));
  };

  const patchLessonMaterialMetrics = (result: Record<string, unknown>, toolIntent: LessonMaterialIntent | null) => {
    const log = isRecord(result.log) ? result.log : {};
    const returnedCount = typeof log.returnedCount === "number" && Number.isFinite(log.returnedCount)
      ? Math.max(0, Math.round(log.returnedCount))
      : getLessonMaterialItems(result).length;
    const latencyMs = typeof log.latencyMs === "number" && Number.isFinite(log.latencyMs)
      ? Math.max(0, Math.round(log.latencyMs))
      : null;
    const source = toLessonMaterialSource(log.source);
    const modelHint = toCoachIntentHint(toolIntent);
    setMetrics((current) => ({
      ...current,
      lessonMaterialToolCalls: current.lessonMaterialToolCalls + 1,
      lessonMaterialLastReturnedCount: returnedCount,
      lessonMaterialLastLatencyMs: latencyMs,
      lessonMaterialLastSource: source,
      modelToolIntent: modelHint,
      intentHintMatched: current.clientIntentHint && modelHint ? current.clientIntentHint === modelHint : current.intentHintMatched,
    }));
  };

  const applyLessonMaterialToolResult = (response: unknown, toolIntent: LessonMaterialIntent | null) => {
    if (mode !== "mona") return;
    const result = unwrapToolResult(response);
    if (!result) return;
    patchLessonMaterialMetrics(result, toolIntent);
    const firstItem = getLessonMaterialItems(result)[0];
    const key = normalizeCoachItemKey(firstItem?.en ?? firstItem?.id);
    if (!key) return;
    const current = coachSessionStateRef.current ?? normalizeCoachSessionState(null, sessionIdRef.current);
    if (!current) return;
    const alreadySeen = current.seenItemKeys.includes(key);
    const fromBuffer = current.bufferedItemKeys.includes(key);
    coachSessionStateRef.current = {
      ...current,
      currentItemKey: key,
      seenItemKeys: alreadySeen ? current.seenItemKeys : [...current.seenItemKeys, key].slice(-24),
      bufferedItemKeys: fromBuffer ? current.bufferedItemKeys.filter((item) => item !== key) : current.bufferedItemKeys,
      lastToolIntent: toolIntent,
      newCountActual: !alreadySeen && toolIntent !== "again" ? current.newCountActual + 1 : current.newCountActual,
    };
  };

  const mainMessage = useMemo(() => {
    if (metrics.lastError) return "연결이 막혔어요";
    if (status === "checking") return "준비 확인 중";
    if (status === "connecting") return "준비 중이에요… (코치 깨우는 중)";
    if (status === "listening") return "지금 말하면 돼요";
    if (status === "stopped") return "대화를 멈췄어요";
    if (status === "blocked") return "시작할 수 없어요";
    return "마이크를 켜고 바로 말하기";
  }, [metrics.lastError, status]);

  const subMessage = useMemo(() => {
    if (metrics.lastError) return metrics.lastError;
    if (!isSecure) return "이 주소에서는 브라우저가 마이크를 막을 수 있어요.";
    if (readiness?.status === "BLOCKED") return `${readiness.missingEnv} 설정이 필요해요.`;
    if (status === "connecting") return CONNECTION_TEXT[metrics.connectionState];
    if (status === "listening") return "한 문장씩 편하게 말하면 됩니다.";
    return mode === "mona" ? "자기 전 영어 코치" : "일반 음성 대화";
  }, [isSecure, metrics.connectionState, metrics.lastError, mode, readiness, status]);

  useEffect(() => {
    if (!promptEdited) {
      setSystemPrompt(buildPromptPreview(activeProfile, lowVoice, responseStyle, enabledToolIds));
    }
  }, [activeProfile, enabledToolIds, lowVoice, promptEdited, responseStyle]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el || logs.length === 0) return;
    if (el.scrollTop < 40) {
      el.scrollTop = 0;
    }
  }, [logs]);

  const flushOrphanedPending = async () => {
    try {
      if (typeof localStorage === "undefined") return;
      const raw = localStorage.getItem(PENDING_LOG_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { sessionId?: string; mode?: string; startedAt?: string; tester?: string; settings?: unknown; entries?: unknown[] };
      if (!stored.sessionId || !Array.isArray(stored.entries) || stored.entries.length === 0) {
        localStorage.removeItem(PENDING_LOG_KEY);
        return;
      }
      if (stored.sessionId === sessionIdRef.current) return;
      const body = {
        op: "append",
        sessionId: stored.sessionId,
        mode: stored.mode ?? "fenok",
        startedAt: stored.startedAt ?? new Date().toISOString(),
        tester: stored.tester ?? (isRecord(stored.settings) && stored.settings.tester === "owner" ? "owner" : "mona"),
        settings: stored.settings,
        entries: stored.entries,
      };
      const response = await fetch("/api/admin/live/log/", {
        method: "POST",
        keepalive: true,
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        localStorage.removeItem(PENDING_LOG_KEY);
      } else {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (payload?.error === "ALREADY_FINALIZED") {
          localStorage.removeItem(PENDING_LOG_KEY);
        }
      }
    } catch {
      // network fail — keep key for next visit
    }
  };

  useEffect(() => {
    void flushOrphanedPending();
  }, []);

  const addLog = (role: BenchLog["role"], text: string) => {
    const seq = ++logSeqRef.current;
    const entry: BenchLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      seq,
      role,
      text,
      at: nowLabel(),
      atIso: new Date().toISOString(),
    };
    setLogs((current) => [entry, ...current].slice(0, MAX_LOG_ENTRIES));
    pendingRef.current.push(entry);
    persistPending();
    scheduleFlush();
  };

  const appendTranscriptLog = (role: "user" | "bench", text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    if (role === "user" && mode === "mona") {
      const learnerIntent = detectCoachLearnerIntent(cleanText);
      if (learnerIntent) {
        patchCoachSessionState({ lastLearnerIntent: learnerIntent });
        sendCoachIntentHint(learnerIntent);
      }
    }

    setLogs((current) => {
      const first = current[0];
      if (first?.role === role) {
        const merged = {
          ...first,
          text: mergeTranscriptText(first.text, cleanText),
          at: nowLabel(),
          atIso: new Date().toISOString(),
        };
        const pendingFirst = pendingRef.current[0];
        if (pendingFirst && pendingFirst.role === role) {
          pendingFirst.text = merged.text;
          pendingFirst.at = merged.at;
        }
        return [merged, ...current.slice(1)];
      }

      const seq = ++logSeqRef.current;
      const entry: BenchLog = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        seq,
        role,
        text: cleanText,
        at: nowLabel(),
        atIso: new Date().toISOString(),
      };
      pendingRef.current.push(entry);
      persistPending();
      scheduleFlush();
      return [entry, ...current].slice(0, MAX_LOG_ENTRIES);
    });
  };

  const setLastError = (message: string | null) => {
    setMetrics((current) => ({
      ...current,
      lastError: message,
      connectionState: message ? "error" : current.connectionState,
    }));
  };

  const clearSocketTimeout = () => {
    if (socketTimeoutRef.current) {
      clearTimeout(socketTimeoutRef.current);
      socketTimeoutRef.current = null;
    }
  };

  const clearDropAudioTimeout = () => {
    if (dropAudioResetTimeoutRef.current) {
      clearTimeout(dropAudioResetTimeoutRef.current);
      dropAudioResetTimeoutRef.current = null;
    }
  };

  const clearFlushTimer = () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  };

  const flushAppends = async (useBeacon = false) => {
    clearFlushTimer();
    const sid = sessionIdRef.current;
    if (!sid || pendingRef.current.length === 0) return;

    if (pendingRef.current.length > 600) {
      pendingRef.current = pendingRef.current.slice(pendingRef.current.length - 600);
      persistPending();
      setMetrics((m) => ({
        ...m,
        appendFailureCount: m.appendFailureCount + 1,
        lastAppendError: "PENDING_QUEUE_CAPPED_600",
      }));
    }

    const sentCount = Math.min(pendingRef.current.length, 60);
    const capped = pendingRef.current.slice(0, sentCount);

    const body: Record<string, unknown> = {
      op: "append",
      sessionId: sid,
      mode,
      startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : new Date().toISOString(),
      tester: normalizedCoachConfig.tester,
      entries: capped.map((e) => ({ seq: e.seq, role: e.role, text: e.text, at: e.at, atIso: e.atIso })),
    };

    if (!sentMetaRef.current || useBeacon) {
      body.settings = buildLiveSettings();
      body.client = typeof window === "undefined" ? {} : {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      };
    }

    if (useBeacon) {
      body.stoppedAt = new Date().toISOString();
      body.metrics = metrics;
    }

    const json = JSON.stringify(body);

    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([json], { type: "application/json" });
      const sent = navigator.sendBeacon("/api/admin/live/log/", blob);
      if (sent) {
        pendingRef.current = pendingRef.current.slice(sentCount);
        sentMetaRef.current = true;
        persistPending();
        return;
      }
    }

    try {
      const response = await fetch("/api/admin/live/log/", {
        method: "POST",
        keepalive: true,
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: json,
      });
      if (response.ok) {
        pendingRef.current = pendingRef.current.slice(sentCount);
        sentMetaRef.current = true;
        backoffRef.current = 2500;
        persistPending();
        if (pendingRef.current.length > 0) {
          flushTimerRef.current = setTimeout(() => void flushAppends(), 0);
        }
      } else {
        setMetrics((m) => ({
          ...m,
          appendFailureCount: m.appendFailureCount + 1,
          lastAppendError: `HTTP_${response.status}`,
        }));
        flushTimerRef.current = setTimeout(() => void flushAppends(), backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 10000);
      }
    } catch (error) {
      setMetrics((m) => ({
        ...m,
        appendFailureCount: m.appendFailureCount + 1,
        lastAppendError: error instanceof Error ? error.message : "FETCH_FAILED",
      }));
      flushTimerRef.current = setTimeout(() => void flushAppends(), backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, 10000);
    }
  };

  const scheduleFlush = () => {
    if (flushTimerRef.current || !sessionIdRef.current) return;
    flushTimerRef.current = setTimeout(() => void flushAppends(), 2500);
  };

  const requestWakeLock = async () => {
    if (typeof navigator === "undefined" || typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> };
    }).wakeLock;
    if (!wakeLock || wakeLockRef.current) return;

    try {
      const lock = await wakeLock.request("screen");
      wakeLockRef.current = lock;
      lock.addEventListener?.("release", () => {
        if (wakeLockRef.current === lock) {
          wakeLockRef.current = null;
        }
      });
    } catch {
      wakeLockRef.current = null;
    }
  };

  const releaseWakeLock = () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) {
      void lock.release().catch(() => undefined);
    }
  };

  const updateMicPermission = async () => {
    if (typeof navigator === "undefined" || !("mediaDevices" in navigator)) {
      setMetrics((current) => ({ ...current, micPermission: "unsupported" }));
      return;
    }

    if (!("permissions" in navigator)) {
      setMetrics((current) => ({ ...current, micPermission: "prompt" }));
      return;
    }

    try {
      const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
      setMetrics((current) => ({
        ...current,
        micPermission: result.state === "granted" ? "granted" : result.state === "denied" ? "denied" : "prompt",
      }));
    } catch {
      setMetrics((current) => ({ ...current, micPermission: "prompt" }));
    }
  };

  const getAudioContextCtor = () =>
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  const ensureAudioOutput = async () => {
    const existing = outputRef.current;
    if (existing && existing.context.state !== "closed") {
      await existing.context.resume().catch(() => undefined);
      return existing;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    }

    const context = new AudioContextCtor();
    const gain = context.createGain();
    gain.gain.value = 1.25;
    gain.connect(context.destination);
    outputRef.current = { context, gain };

    await context.resume();

    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start();

    return outputRef.current;
  };

  const playTestTone = async () => {
    try {
      const output = await ensureAudioOutput();
      const oscillator = output.context.createOscillator();
      const gain = output.context.createGain();
      gain.gain.value = 0.09;
      oscillator.frequency.value = 660;
      oscillator.connect(gain);
      gain.connect(output.gain);
      const now = output.context.currentTime;
      oscillator.start(now);
      oscillator.stop(now + 0.25);
      addLog("system", `소리 테스트를 재생했어요. WebAudio=${output.context.state}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AUDIO_TEST_FAILED";
      addLog("error", message);
    }
  };

  const stopAudioRuntime = () => {
    flushPlayback();
    releaseWakeLock();
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    const output = outputRef.current;
    outputRef.current = null;

    if (!runtime) {
      if (output) {
        output.gain.disconnect();
        void output.context.close().catch(() => undefined);
      }
      return;
    }

    runtime.processor.disconnect();
    runtime.source.disconnect();
    runtime.inputMonitorGain.disconnect();
    runtime.outputGain.disconnect();
    runtime.stream.getTracks().forEach((track) => track.stop());
    void runtime.context.close().catch(() => undefined);
    setMetrics((current) => ({ ...current, micPermission: "stopped" }));
  };

  const flushPlayback = () => {
    const output = outputRef.current;
    const sources = [...scheduledSourcesRef.current];
    scheduledSourcesRef.current = [];
    sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may already have ended; stopping again is harmless.
      }
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect races during interrupt/reset.
      }
    });
    if (output && output.context.state !== "closed") {
      playbackCursorRef.current = output.context.currentTime;
    } else {
      playbackCursorRef.current = 0;
    }
    audioChunkSeenRef.current = false;
  };

  const playOutputAudio = (data: string, mimeType?: string) => {
    const output = outputRef.current;
    if (!output || output.context.state === "closed") return false;

    try {
      void output.context.resume().catch(() => undefined);
      const pcm = base64ToPcmFloat32(data);
      if (pcm.length === 0) return false;

      const sampleRate = getSampleRate(mimeType);
      const buffer = output.context.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i += 1) {
        channel[i] = Math.max(-1, Math.min(1, pcm[i]));
      }

      const source = output.context.createBufferSource();
      source.buffer = buffer;
      source.connect(output.gain);
      const isQueueAhead = playbackCursorRef.current > output.context.currentTime;
      const leadTimeSec = isQueueAhead ? 0.02 : 0.16;
      const startAt = Math.max(output.context.currentTime + leadTimeSec, playbackCursorRef.current || 0);
      source.start(startAt);
      scheduledSourcesRef.current.push(source);
      source.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter((item) => item !== source);
        try {
          source.disconnect();
        } catch {
          // Already disconnected by an interrupt/reset flush.
        }
      };
      playbackCursorRef.current = startAt + buffer.duration;
      return true;
    } catch {
      return false;
    }
  };

  const closeSocket = () => {
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      socket.close(1000, "admin-live-stop");
    } else if (socket) {
      socket.close();
    }
  };

  const executeLiveToolCall = async (call: LiveFunctionCall) => {
    const name = typeof call.name === "string" ? call.name : "";
    const id = typeof call.id === "string" ? call.id : "";
    const args = call.args && typeof call.args === "object" ? call.args : {};
    const toolIntent = toLessonMaterialIntent(args.intent);
    if (toolIntent) patchCoachSessionState({ lastToolIntent: toolIntent });

    try {
      const response = await fetch("/api/admin/live/tool/", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          id,
          name,
          args,
          sessionId: sessionIdRef.current,
          context: {
            mode,
            coachConfig: normalizedCoachConfig,
            coachSessionState: coachSessionStateRef.current,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { response?: unknown }
        | null;
      const toolResponse = payload?.response ?? { error: `TOOL_HTTP_${response.status}` };
      if (name === "requestLessonMaterial") {
        applyLessonMaterialToolResult(toolResponse, toolIntent);
      }
      return {
        id,
        name,
        response: toolResponse,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "TOOL_EXECUTION_FAILED";
      return {
        id,
        name,
        response: { error: message },
      };
    }
  };

  const handleToolCall = (toolCall: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const functionCalls = (toolCall as { functionCalls?: unknown }).functionCalls;
    if (!Array.isArray(functionCalls) || functionCalls.length === 0) return;

    addLog("tool", `도구 요청 ${functionCalls.length}개 수신`);

    const localResponses: Array<{ id: string; name: string; response: unknown }> = [];
    const remoteCalls: LiveFunctionCall[] = [];

    for (const call of functionCalls as LiveFunctionCall[]) {
      if (call.name === "showCard") {
        const id = typeof call.id === "string" ? call.id : "";
        const args = call.args && typeof call.args === "object" ? call.args : {};
        const state = typeof args.state === "string" ? args.state : "";
        if (state === "clear") {
          setCard(null);
          localResponses.push({ id, name: "showCard", response: { ok: true } });
        } else if (state === "prompt" || state === "reveal" || state === "drill") {
          const ko = typeof args.ko === "string" ? args.ko : "";
          if (state === "prompt" && !ko) {
            localResponses.push({ id, name: "showCard", response: { ok: false, error: "INVALID_CARD" } });
          } else {
            setCard({
              state,
              ko,
              en: typeof args.en === "string" ? args.en : undefined,
              pron: typeof args.pron === "string" ? args.pron : undefined,
              drillHint: typeof args.drillHint === "string" ? args.drillHint : undefined,
              updatedAt: Date.now(),
            });
            markCoachItemSeen(normalizeCoachItemKey(typeof args.en === "string" ? args.en : ko));
            localResponses.push({ id, name: "showCard", response: { ok: true } });
          }
        } else {
          const id = typeof call.id === "string" ? call.id : "";
          localResponses.push({ id, name: "showCard", response: { ok: false, error: "INVALID_CARD" } });
        }
      } else {
        remoteCalls.push(call);
      }
    }

    if (localResponses.length > 0) {
      socket.send(JSON.stringify({ toolResponse: { functionResponses: localResponses } }));
    }

    if (remoteCalls.length === 0) return;

    void Promise.all(remoteCalls.map((call) => executeLiveToolCall(call)))
      .then((functionResponses) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
          toolResponse: {
            functionResponses,
          },
        }));
        addLog("tool", `도구 응답 전송: ${functionResponses.map((item) => item.name || "unknown").join(", ")}`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "TOOL_RESPONSE_FAILED";
        addLog("error", message);
      });
  };

  const resetRuntime = () => {
    clearSocketTimeout();
    closeSocket();
    stopAudioRuntime();
    clearDropAudioTimeout();
    firstResponseSeenRef.current = false;
    lastAudioSentMsRef.current = null;
    startRequestMsRef.current = null;
    playbackCursorRef.current = 0;
    audioChunkSeenRef.current = false;
    dropAudioUntilTurnCompleteRef.current = false;
  };

  useEffect(() => {
    let cancelled = false;

    async function loadReadiness() {
      setStatus("checking");
      await updateMicPermission();

      try {
        const response = await fetch("/api/admin/live/session/", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`READINESS_HTTP_${response.status}`);
        }

        const payload = (await response.json()) as ReadinessResponse;
        if (cancelled) return;

        setReadiness(payload.readiness);
        setProfiles(payload.profiles.length ? payload.profiles : PROFILE_FALLBACK);
        setVoices(payload.voices?.length ? payload.voices : VOICE_FALLBACK);
        const nextToolRegistry = payload.defaults?.tools?.registry?.length
          ? payload.defaults.tools.registry
          : TOOL_REGISTRY_FALLBACK;
        setToolRegistry(nextToolRegistry);
        setEnabledToolIds(getModeDefaultToolIds(initialMode, nextToolRegistry, payload.defaults?.tools?.enabledToolIdsByMode));
        setSearchSelectionPolicy(payload.defaults?.tools?.searchSelectionPolicy ?? "multi");
        setResponseStyle(payload.defaults?.responseStyle ?? "concise");
        setCoachConfig(normalizeCoachConfig(payload.defaults?.coachConfig ?? DEFAULT_COACH_CONFIG));
        const initPreset = MODE_PRESETS[initialMode];
        setVoiceName(initialMode === "mona" ? initPreset.voiceName : (payload.defaults?.voiceName ?? initPreset.voiceName));
        setVadPreset(initialMode === "mona" ? initPreset.vadPreset : (payload.defaults?.vadPreset ?? initPreset.vadPreset));
        setLowVoice(initPreset.lowVoice);
        setStatus(payload.readiness.status === "READY" ? "ready" : "blocked");
        setMetrics((current) => ({
          ...current,
          connectionState: payload.readiness.status === "READY" ? "not-started" : "blocked",
          lastError: payload.readiness.missingEnv ? `MISSING ${payload.readiness.missingEnv}` : null,
        }));
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "READINESS_FAILED";
        setStatus("blocked");
        setReadiness(null);
        setLastError(message);
        addLog("error", message);
      }
    }

    void loadReadiness();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }

    if (status !== "listening" || !startedAtMs) return;

    tickRef.current = setInterval(() => {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      setMetrics((current) => ({
        ...current,
        sessionDurationSec: elapsedSec,
        audioFramesSent: audioFramesSentRef.current,
      }));
    }, 1000);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [startedAtMs, status]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (status !== "listening") return;

      void outputRef.current?.context.resume().catch(() => undefined);
      playbackCursorRef.current = outputRef.current?.context.currentTime ?? 0;
      void requestWakeLock();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status]);

  useEffect(() => {
    const handlePageHide = () => void flushAppends(true);
    const handleVisibilityHidden = () => {
      if (document.visibilityState === "hidden") void flushAppends(true);
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityHidden);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityHidden);
    };
  }, [sessionId, mode, lowVoice, voiceName, responseStyle, vadPreset, interruptionMode, enabledToolIds, metrics]);

  useEffect(() => {
    return () => {
      clearFlushTimer();
      void flushAppends(true);
      clearSocketTimeout();
      clearDropAudioTimeout();
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket) {
        socket.close();
      }
      releaseWakeLock();

      scheduledSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Source may already have ended.
        }
        try {
          source.disconnect();
        } catch {
          // Ignore teardown races.
        }
      });
      scheduledSourcesRef.current = [];

      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) {
        runtime.processor.disconnect();
        runtime.source.disconnect();
        runtime.inputMonitorGain.disconnect();
        runtime.outputGain.disconnect();
        runtime.stream.getTracks().forEach((track) => track.stop());
        void runtime.context.close().catch(() => undefined);
      }
      const output = outputRef.current;
      outputRef.current = null;
      if (output && output.context !== runtime?.context) {
        output.gain.disconnect();
        void output.context.close().catch(() => undefined);
      }
      playbackCursorRef.current = 0;
      audioChunkSeenRef.current = false;
    };
  }, []);

  const createMicProcessor = async (context: AudioContext, socket: WebSocket) => {
    const sendPcm = (pcm: Int16Array) => {
      if (socket.readyState !== WebSocket.OPEN || pcm.length === 0) return;

      socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: pcm16ToBase64(pcm),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        }),
      );
      lastAudioSentMsRef.current = performance.now();
      audioFramesSentRef.current += 1;
    };

    if ("audioWorklet" in context) {
      let workletUrl: string | null = null;
      try {
        workletUrl = URL.createObjectURL(new Blob([MIC_WORKLET_SOURCE], { type: "text/javascript" }));
        await context.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(context, "gemini-mic-processor");
        node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          sendPcm(new Int16Array(event.data));
        };
        return node;
      } catch {
        // Fall back to ScriptProcessor on browsers that reject dynamic worklets.
      } finally {
        if (workletUrl) {
          URL.revokeObjectURL(workletUrl);
        }
      }
    }

    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      const pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate);
      sendPcm(pcm);
    };
    return processor;
  };

  const beginAudioStream = async (socket: WebSocket) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MIC_UNSUPPORTED");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const output = await ensureAudioOutput();
    const context = output.context;
    await context.resume();
    playbackCursorRef.current = context.currentTime;
    await requestWakeLock();

    const source = context.createMediaStreamSource(stream);
    const processor = await createMicProcessor(context, socket);
    const inputMonitorGain = context.createGain();
    inputMonitorGain.gain.value = 0;

    source.connect(processor);
    processor.connect(inputMonitorGain);
    inputMonitorGain.connect(context.destination);
    runtimeRef.current = { context, outputGain: output.gain, inputMonitorGain, source, processor, stream };
    setMetrics((current) => ({ ...current, micPermission: "active", connectionState: "live" }));
    setStatus("listening");
    addLog("system", "마이크가 켜졌어요. 이제 말하면 됩니다.");
  };

  const handleServerMessage = (payload: Record<string, unknown>) => {
    if ("setupComplete" in payload) {
      clearSocketTimeout();
      const setupDoneMs = startRequestMsRef.current ? Math.round(performance.now() - startRequestMsRef.current) : null;
      setMetrics((current) => ({ ...current, setupDoneMs }));
      if (reconnectingRef.current) {
        addLog("system", "다시 연결됐어요. 이어서 진행해.");
        resumeCountRef.current += 1;
        setMetrics((current) => ({ ...current, resumeCount: resumeCountRef.current }));
        reconnectingRef.current = false;
      } else {
        addLog("system", "연결됐어요. 코치가 먼저 인사할 거예요.");
      }
      const socket = wsRef.current;
      if (socket) {
        void beginAudioStream(socket).then(() => {
          if (mode === "mona" && !kickoffSentRef.current && !reconnectingRef.current) {
            kickoffSentRef.current = true;
            socket.send(JSON.stringify({ realtimeInput: { text: "시작" } }));
          }
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "MIC_START_FAILED";
          setStatus("ready");
          setLastError(message);
          addLog("error", message);
        });
      }
      return;
    }

    if ("toolCall" in payload) {
      handleToolCall(payload.toolCall);
      return;
    }

    if ("sessionResumptionUpdate" in payload) {
      const resUpdate = payload.sessionResumptionUpdate as { resumable?: boolean; newHandle?: string } | undefined;
      if (resUpdate?.resumable && resUpdate.newHandle) {
        resumeHandleRef.current = resUpdate.newHandle;
        if (!reconnectingRef.current && !resumeReadyLoggedRef.current) {
          addLog("system", "이어가기 준비됨");
          resumeReadyLoggedRef.current = true;
        }
      }
      return;
    }

    if ("goAway" in payload) {
      addLog("system", "연결 교체 예정");
      void resumeSession();
      return;
    }

    const serverContent = payload.serverContent as
      | {
          interrupted?: boolean;
          turnComplete?: boolean;
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
          modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
        }
      | undefined;

    if (!serverContent) return;

    if (serverContent.interrupted) {
      dropAudioUntilTurnCompleteRef.current = true;
      clearDropAudioTimeout();
      dropAudioResetTimeoutRef.current = setTimeout(() => {
        dropAudioUntilTurnCompleteRef.current = false;
        dropAudioResetTimeoutRef.current = null;
      }, 2000);
      flushPlayback();
      setMetrics((current) => ({ ...current, interruptionCount: current.interruptionCount + 1 }));
      addLog("system", "말 끊김 감지");
    }

    if (serverContent.inputTranscription?.text) {
      const latency = lastAudioSentMsRef.current ? Math.round(performance.now() - lastAudioSentMsRef.current) : null;
      setMetrics((current) => ({
        ...current,
        transcriptLatencyMs: latency ?? current.transcriptLatencyMs,
      }));
      appendTranscriptLog("user", serverContent.inputTranscription.text);
    }

    if (serverContent.outputTranscription?.text) {
      if (!firstResponseSeenRef.current) {
        firstResponseSeenRef.current = true;
        const firstResponseMs = startRequestMsRef.current ? Math.round(performance.now() - startRequestMsRef.current) : null;
        setMetrics((current) => ({
          ...current,
          firstResponseMs,
        }));
      }
      appendTranscriptLog("bench", serverContent.outputTranscription.text);
    }

    let hasAudio = false;
    serverContent.modelTurn?.parts?.forEach((part) => {
      const data = part.inlineData?.data;
      if (!data) return;
      if (dropAudioUntilTurnCompleteRef.current) return;
      hasAudio = playOutputAudio(data, part.inlineData?.mimeType) || hasAudio;
    });

    if (hasAudio && !firstResponseSeenRef.current) {
      firstResponseSeenRef.current = true;
      const firstResponseMs = startRequestMsRef.current ? Math.round(performance.now() - startRequestMsRef.current) : null;
      setMetrics((current) => ({
        ...current,
        firstResponseMs,
      }));
    }

    if (hasAudio && !audioChunkSeenRef.current) {
      audioChunkSeenRef.current = true;
      addLog("system", "Gemini 음성 재생 중");
    }

    if (serverContent.turnComplete) {
      setMetrics((current) => ({ ...current, turnCount: current.turnCount + 1 }));
      audioChunkSeenRef.current = false;
      clearDropAudioTimeout();
      dropAudioUntilTurnCompleteRef.current = false;
    }
  };

  const startSession = async () => {
    if (status === "connecting" || status === "listening") return;
    if (!isSecure) {
      const message = "SECURE_CONTEXT_REQUIRED";
      setStatus("blocked");
      setLastError(message);
      addLog("error", message);
      return;
    }

    resetRuntime();
    void flushOrphanedPending();
    pendingRef.current = [];
    sentMetaRef.current = false;
    logSeqRef.current = 0;
    kickoffSentRef.current = false;
    resumeCountRef.current = 0;
    audioFramesSentRef.current = 0;
    resumeReadyLoggedRef.current = false;
    coachSessionStateRef.current = null;
    clearFlushTimer();
    persistPending();
    setCard(null);

    try {
      await ensureAudioOutput();
      setStatus("connecting");
      setLastError(null);
      setMetrics({
        ...EMPTY_METRICS,
        lowVoice,
        micPermission: metrics.micPermission,
        connectionState: "token-ready",
      });
      startRequestMsRef.current = performance.now();

      const response = await fetch("/api/admin/live/session/", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          mode,
          lowVoice,
          voiceName,
          responseStyle,
          vadPreset,
          interruptionMode,
          coachConfig: normalizedCoachConfig,
          systemPrompt,
          enabledToolIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as SessionResponse | { error?: string; missingEnv?: string } | null;
      const sessionPostMs = startRequestMsRef.current ? Math.round(performance.now() - startRequestMsRef.current) : null;
      setMetrics((current) => ({ ...current, sessionPostMs }));

      if (!response.ok) {
        const error = payload && "error" in payload ? payload.error : `HTTP_${response.status}`;
        const missing = payload && "missingEnv" in payload ? ` ${payload.missingEnv}` : "";
        throw new Error(`${error ?? "SESSION_START_FAILED"}${missing}`);
      }

      const session = payload as SessionResponse;
      const startedAt = Date.parse(session.startedAt);
      setSessionId(session.sessionId);
      sessionIdRef.current = session.sessionId;
      coachSessionStateRef.current = normalizeCoachSessionState(session.settings?.coachSessionState, session.sessionId);
      setStartedAtMs(Number.isFinite(startedAt) ? startedAt : Date.now());
      addLog("system", `대화 토큰 준비 완료. 만료 ${new Date(session.expiresAt).toLocaleTimeString("ko-KR")}`);
      addLog("bench", `${session.profile.label}: ${session.profile.intent}`);

      const websocketUrl = `${session.websocketEndpoint}?access_token=${encodeURIComponent(session.token)}`;
      const socket = new WebSocket(websocketUrl);
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;
      setMetrics((current) => ({ ...current, connectionState: "socket-opening" }));
      socketTimeoutRef.current = setTimeout(() => {
        if (wsRef.current !== socket || socket.readyState === WebSocket.CLOSED) return;
        const message = "Gemini가 15초 동안 응답하지 않았어요. 멈추기 후 다시 시작해 주세요.";
        setStatus("ready");
        setLastError(message);
        addLog("error", message);
        socket.close();
      }, 15000);

      socket.onopen = () => {
        const socketOpenMs = startRequestMsRef.current ? Math.round(performance.now() - startRequestMsRef.current) : null;
        setMetrics((current) => ({ ...current, connectionState: "setup-wait", socketOpenMs }));
        socket.send(JSON.stringify({ setup: session.setup }));
        addLog("system", "Gemini 연결 열림. 대화 준비 중");
      };

      socket.onmessage = (event) => {
        void (async () => {
          try {
            const text = await readSocketData(event.data);
            handleServerMessage(JSON.parse(text) as Record<string, unknown>);
          } catch (error) {
            const message = error instanceof Error ? error.message : "SERVER_MESSAGE_PARSE_FAILED";
            setStatus("ready");
            setLastError(`Gemini 응답 해석 실패: ${message}`);
            addLog("error", `Gemini 응답 해석 실패: ${message}`);
          }
        })();
      };

      socket.onerror = () => {
        clearSocketTimeout();
        const message = "Gemini 연결 오류. 멈추기 후 다시 시작해 주세요.";
        setStatus("ready");
        setLastError(message);
        addLog("error", message);
      };

      socket.onclose = (event) => {
        clearSocketTimeout();
        stopAudioRuntime();
        setMetrics((current) => ({
          ...current,
          connectionState: current.connectionState === "error" ? "error" : "closed",
        }));
        if (event.code !== 1000) {
          if (statusRef.current === "listening" && resumeHandleRef.current && !reconnectingRef.current) {
            void resumeSession();
          } else {
            const reason = event.reason ? `: ${event.reason}` : "";
            const message = `Gemini 연결 종료 ${event.code}${reason}`;
            setStatus("ready");
            setLastError(message);
            addLog("error", message);
          }
        } else {
          addLog("system", "Gemini 연결 종료");
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SESSION_START_FAILED";
      resetRuntime();
      setStatus(message.includes("MISSING_GEMINI_API_KEY") ? "blocked" : "ready");
      setLastError(message);
      addLog("error", message);
    }
  };

  const resumeSession = async () => {
    const handle = resumeHandleRef.current;
    if (!handle || reconnectingRef.current) return;
    if (resumeCountRef.current >= 5) {
      setStatus("stopped");
      setLastError("연결을 잃었어요. 다시 시작해 주세요.");
      addLog("error", "연결을 잃었어요. 다시 시작해 주세요.");
      return;
    }
    reconnectingRef.current = true;
    setStatus("connecting");
    addLog("system", "다시 연결 중… (대화는 이어집니다)");

    const doResume = async (attempt: number): Promise<boolean> => {
      try {
        const response = await fetch("/api/admin/live/session/", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            mode,
            lowVoice,
            voiceName,
            responseStyle,
            vadPreset,
            interruptionMode,
            coachConfig: normalizedCoachConfig,
            resumeHandle: handle,
            systemPrompt,
            enabledToolIds,
          }),
        });
        if (!response.ok) throw new Error(`RESUME_HTTP_${response.status}`);
        const payload = (await response.json().catch(() => null)) as SessionResponse | { error?: string } | null;
        if (!payload || "error" in payload) throw new Error("RESUME_FAILED");

        const session = payload as SessionResponse;
        setSessionId(session.sessionId);
        sessionIdRef.current = session.sessionId;
        coachSessionStateRef.current = normalizeCoachSessionState(session.settings?.coachSessionState, session.sessionId);
        setStartedAtMs(Date.parse(session.startedAt));

        closeSocket();
        stopAudioRuntime();

        const websocketUrl = `${session.websocketEndpoint}?access_token=${encodeURIComponent(session.token)}`;
        const socket = new WebSocket(websocketUrl);
        socket.binaryType = "arraybuffer";
        wsRef.current = socket;
        setMetrics((current) => ({ ...current, connectionState: "socket-opening" }));
        socketTimeoutRef.current = setTimeout(() => {
          if (wsRef.current !== socket || socket.readyState === WebSocket.CLOSED) return;
          setStatus("stopped");
          setLastError("다시 연결 실패");
          addLog("error", "다시 연결 타임아웃");
          socket.close();
          reconnectingRef.current = false;
        }, 15000);

        socket.onopen = () => {
          setMetrics((current) => ({ ...current, connectionState: "setup-wait" }));
          socket.send(JSON.stringify({ setup: session.setup }));
        };
        socket.onmessage = (event) => {
          void (async () => {
            try {
              const text = await readSocketData(event.data);
              handleServerMessage(JSON.parse(text) as Record<string, unknown>);
            } catch (error) {
              const message = error instanceof Error ? error.message : "PARSE_FAILED";
              setStatus("stopped");
              setLastError(`다시 연결 응답 해석 실패: ${message}`);
              addLog("error", `다시 연결 응답 해석 실패: ${message}`);
              reconnectingRef.current = false;
            }
          })();
        };
        socket.onerror = () => {
          clearSocketTimeout();
          setStatus("stopped");
          setLastError("다시 연결 오류");
          addLog("error", "다시 연결 오류");
          reconnectingRef.current = false;
        };
        socket.onclose = (event) => {
          clearSocketTimeout();
          stopAudioRuntime();
          setMetrics((current) => ({
            ...current,
            connectionState: current.connectionState === "error" ? "error" : "closed",
          }));
          if (event.code !== 1000) {
            const message = `다시 연결 종료 ${event.code}`;
            setStatus("stopped");
            setLastError(message);
            addLog("error", message);
          }
          reconnectingRef.current = false;
        };

        return true;
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 2000));
          return doResume(attempt + 1);
        }
        return false;
      }
    };

    const success = await doResume(1);
    if (!success) {
      setStatus("stopped");
      setLastError("연결을 잃었어요. 다시 시작해 주세요.");
      addLog("error", "연결을 잃었어요. 다시 시작해 주세요.");
      reconnectingRef.current = false;
    }
  };

  const stopSession = async () => {
    const currentSessionId = sessionId;
    const stoppedAt = new Date().toISOString();
    const stopSeq = ++logSeqRef.current;
    const stopLog: BenchLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      seq: stopSeq,
      role: "system",
      text: "대화를 멈췄어요",
      at: nowLabel(),
      atIso: new Date().toISOString(),
    };
    const finalMetrics: BenchMetrics = {
      ...metrics,
      connectionState: "closed",
      micPermission: "stopped",
      audioFramesSent: audioFramesSentRef.current,
    };
    const currentLogs = [stopLog, ...logsRef.current].slice(0, MAX_LOG_ENTRIES);
    pendingRef.current.push(stopLog);
    persistPending();
    await flushAppends();
    resetRuntime();
    setStatus("stopped");
    setMetrics(finalMetrics);
    setLogs(currentLogs);

    if (currentSessionId) {
      await fetch("/api/admin/live/session/", {
        method: "DELETE",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ sessionId: currentSessionId }),
      }).catch(() => undefined);

      const saved = await saveConversationLog(currentSessionId, stoppedAt, currentLogs, finalMetrics);
      if (saved) {
        try { localStorage.removeItem(PENDING_LOG_KEY); } catch {}
      }
    }

    sessionIdRef.current = null;
    coachSessionStateRef.current = null;
    resumeHandleRef.current = null;
  };

  const saveConversationLog = async (
    currentSessionId: string,
    stoppedAt: string,
    currentLogs: BenchLog[],
    finalMetrics: BenchMetrics,
  ): Promise<boolean> => {
    const startedAt = startedAtMs ? new Date(startedAtMs).toISOString() : null;
    const client = typeof window === "undefined" ? {} : {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    };

    try {
      const response = await fetch("/api/admin/live/log/", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          mode,
          tester: normalizedCoachConfig.tester,
          startedAt,
          stoppedAt,
          settings: buildLiveSettings(),
          metrics: finalMetrics,
          client,
          logs: currentLogs.slice().reverse(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; payload?: { file?: string } } | null;
      if (!response.ok) {
        const error = payload?.error ?? "LOG_SAVE_FAILED";
        throw new Error(error);
      }
      const file = payload?.payload?.file;
      addLog("system", file ? `대화 로그 저장 완료: ${file}` : "대화 로그 저장 완료");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "LOG_SAVE_FAILED";
      addLog("error", `대화 로그 저장 실패: ${message}`);
      return false;
    }
  };

  const resetBench = () => {
    resetRuntime();
    pendingRef.current = [];
    sentMetaRef.current = false;
    logSeqRef.current = 0;
    clearFlushTimer();
    persistPending();
    setCard(null);
    setStatus(readiness?.status === "BLOCKED" ? "blocked" : "ready");
    setSessionId(null);
    sessionIdRef.current = null;
    coachSessionStateRef.current = null;
    resumeHandleRef.current = null;
    reconnectingRef.current = false;
    kickoffSentRef.current = false;
    resumeCountRef.current = 0;
    audioFramesSentRef.current = 0;
    resumeReadyLoggedRef.current = false;
    setStartedAtMs(null);
    setMetrics({
      ...EMPTY_METRICS,
      lowVoice,
      micPermission: metrics.micPermission,
      connectionState: readiness?.status === "BLOCKED" ? "blocked" : "not-started",
      lastError: readiness?.missingEnv ? `MISSING ${readiness.missingEnv}` : null,
    });
    setLogs([]);
  };

  const copyConversationLog = async () => {
    const body = logs
      .slice()
      .reverse()
      .map((log) => `[${log.at}] ${LOG_ROLE_TEXT[log.role]}: ${log.text}`)
      .join("\n");

    if (!body) return;

    try {
      await navigator.clipboard.writeText(body);
      addLog("system", "대화 기록을 복사했어요.");
    } catch {
      addLog("error", "대화 기록 복사 실패");
    }
  };

  const sendTextProbe = () => {
    const socket = wsRef.current;
    const text = textProbe.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN || isSendingText) return;

    setIsSendingText(true);
    socket.send(JSON.stringify({ realtimeInput: { text } }));
    addLog("user", text);
    window.setTimeout(() => setIsSendingText(false), 500);
  };

  const setRating = (rating: Exclude<Rating, null>) => {
    setMetrics((current) => ({
      ...current,
      rating,
    }));
    addLog("system", rating === "useful" ? "평가: 괜찮음" : "평가: 별로");
  };

  const toggleTool = (tool: LiveToolMetadata) => {
    if (settingsLocked || tool.status !== "available") return;

    setEnabledToolIds((current) => {
      if (current.includes(tool.id)) {
        return current.filter((id) => id !== tool.id);
      }

      if (tool.category === "search" && searchSelectionPolicy === "single") {
        const searchIds = new Set(
          toolRegistry
            .filter((item) => item.category === "search")
            .map((item) => item.id),
        );
        return [...current.filter((id) => !searchIds.has(id)), tool.id];
      }

      return [...current, tool.id];
    });
  };

  if (simpleUi) {
    const phase: WindDownPhase = status === "listening"
      ? "live"
      : status === "connecting"
        ? "connecting"
        : status === "checking"
          ? "boot"
          : status === "blocked"
            ? "blocked"
            : status === "stopped"
              ? "stopped"
              : "ready";
    const lastCoachLine = logs.find((entry) => entry.role === "bench")?.text ?? null;
    return (
      <MonaWindDown
        phase={phase}
        message={mainMessage}
        card={card}
        coachLine={lastCoachLine}
        errorText={metrics.lastError}
        voiceName={voiceName}
        vadPreset={vadPreset}
        onVoiceChange={setVoiceName}
        onVadChange={setVadPreset}
        onStart={() => void startSession()}
        onStop={() => void stopSession()}
      />
    );
  }

  return (
    <main className="min-h-[calc(100vh-80px)] bg-slate-50 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-5">
      <section className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-500">Voice Lab</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Voice Lab</h1>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700">
            <span className={`size-2 rounded-full ${status === "listening" ? "bg-emerald-500" : metrics.lastError || status === "blocked" ? "bg-red-500" : status === "connecting" ? "bg-amber-500" : "bg-slate-400"}`} />
            {statusLabel}
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-1">
          {profiles.map((profile) => {
            const active = mode === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setMode(profile.id);
                  setTextProbe(profile.sampleProbe);
                  const preset = MODE_PRESETS[profile.id];
                  setVoiceName(preset.voiceName);
                  setVadPreset(preset.vadPreset);
                  setLowVoice(preset.lowVoice);
                  setInterruptionMode(profile.id === "mona" ? "no-interrupt" : "barge-in");
                  setMetrics((current) => ({ ...current, lowVoice: preset.lowVoice }));
                  const nextEnabledToolIds = getModeDefaultToolIds(profile.id, toolRegistry);
                  setEnabledToolIds(nextEnabledToolIds);
                  setSystemPrompt(buildPromptPreview(profile, preset.lowVoice, responseStyle, nextEnabledToolIds));
                  setPromptEdited(false);
                }}
                disabled={status === "connecting" || status === "listening"}
                className={`min-h-11 rounded-md px-3 text-sm font-black transition ${
                  active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {profile.label}
              </button>
            );
          })}
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm">
          <div className="mx-auto flex items-center justify-center gap-3">
            <div className="flex size-24 items-center justify-center rounded-full bg-slate-950 text-xl font-black text-white">
              LIVE
            </div>
            <button
              type="button"
              disabled
              className="flex size-14 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-black text-slate-400"
              title="카메라/이미지 입력 준비중"
            >
              CAM
            </button>
          </div>
          <h2 className="mt-4 text-2xl font-black text-slate-950">{mainMessage}</h2>
          <p className={`mt-2 text-sm font-semibold ${metrics.lastError ? "text-red-700" : "text-slate-500"}`} role={metrics.lastError ? "alert" : undefined}>
            {subMessage}
          </p>

          {readiness?.status === "BLOCKED" ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
              서버 키가 없어서 시작할 수 없어요: {readiness.missingEnv}
            </p>
          ) : null}

          {!isSecure ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
              마이크는 localhost 또는 HTTPS 주소에서만 열립니다.
            </p>
          ) : null}

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px]">
            <button
              type="button"
              onClick={() => void startSession()}
              disabled={status === "checking" || status === "blocked" || status === "connecting" || status === "listening" || !isSecure}
              className="min-h-14 rounded-lg bg-brand-navy px-4 text-base font-black text-white transition hover:bg-brand-interactive disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "checking" ? "확인 중" : status === "connecting" ? "연결 중" : status === "listening" ? "대화 중" : "마이크 켜기"}
            </button>
            <button
              type="button"
              onClick={() => void stopSession()}
              disabled={status !== "connecting" && status !== "listening"}
              className="min-h-14 rounded-lg border border-slate-300 bg-white px-4 text-base font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              멈추기
            </button>
            <button
              type="button"
              onClick={() => void playTestTone()}
              className="min-h-14 rounded-lg border border-slate-300 bg-white px-4 text-base font-black text-slate-700 transition hover:bg-slate-50"
            >
              소리 테스트
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={lowVoice}
                onChange={(event) => {
                  setLowVoice(event.target.checked);
                  setMetrics((current) => ({
                    ...current,
                    lowVoice: event.target.checked,
                  }));
                }}
                className="size-4 accent-slate-950"
                disabled={settingsLocked}
              />
              조용한 목소리로 답변
            </label>
            <span className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-700">
              {toolTokenHint(activeToolCount)}
            </span>
          </div>
        </section>

        <ToolBoard
          tools={toolRegistry}
          enabledToolIds={enabledToolIds}
          locked={settingsLocked}
          onToggle={toggleTool}
          activeCount={activeToolCount}
        />

        <details className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-base font-black text-slate-950">세션 설정</summary>
          <div className="mt-4 grid gap-4">
            <label className="block text-left">
              <span className="text-sm font-black text-slate-700">목소리</span>
              <select
                value={voiceName}
                onChange={(event) => setVoiceName(event.target.value)}
                disabled={settingsLocked}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base font-bold text-slate-900 outline-none transition focus:border-brand-interactive focus:ring-2 focus:ring-brand-interactive/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label} · {voice.tone}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset className="text-left">
                <legend className="text-sm font-black text-slate-700">응답 길이</legend>
                <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {(Object.keys(RESPONSE_STYLE_LABEL) as ResponseStyle[]).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setResponseStyle(style)}
                      disabled={settingsLocked}
                      className={`min-h-10 rounded-md px-2 text-sm font-black transition ${
                        responseStyle === style ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {RESPONSE_STYLE_LABEL[style]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="text-left">
                <legend className="text-sm font-black text-slate-700">끼어들기</legend>
                <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {(Object.keys(VAD_PRESET_LABEL) as VadPreset[]).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setVadPreset(preset)}
                      disabled={settingsLocked}
                      className={`min-h-10 rounded-md px-2 text-xs font-black transition ${
                        vadPreset === preset ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {VAD_PRESET_LABEL[preset]}
                    </button>
                  ))}
                </div>
              </fieldset>

	              <fieldset className="text-left">
	                <legend className="text-sm font-black text-slate-700">코치 말 끊기</legend>
	                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
	                  {(Object.keys(INTERRUPTION_MODE_LABEL) as InterruptionMode[]).map((im) => (
                    <button
                      key={im}
                      type="button"
                      onClick={() => setInterruptionMode(im)}
                      disabled={settingsLocked}
                      className={`min-h-10 rounded-md px-2 text-xs font-black transition ${
                        interruptionMode === im ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {INTERRUPTION_MODE_LABEL[im]}
                    </button>
                  ))}
	                </div>
	              </fieldset>
	            </div>

	            {mode === "mona" ? (
	              <>
	                <div className="grid gap-3 sm:grid-cols-2">
	                  <fieldset className="text-left">
	                    <legend className="text-sm font-black text-slate-700">학습 비율</legend>
	                    <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
	                      {COACH_REVIEW_PRESETS.map((reviewMode) => (
	                        <button
	                          key={reviewMode}
	                          type="button"
	                          onClick={() => updateCoachConfig({ reviewMode })}
	                          disabled={settingsLocked}
	                          className={`min-h-10 rounded-md px-2 text-xs font-black transition ${
	                            normalizedCoachConfig.reviewMode === reviewMode ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
	                          } disabled:cursor-not-allowed disabled:opacity-50`}
	                        >
	                          {COACH_REVIEW_LABEL[reviewMode]}
	                        </button>
	                      ))}
	                    </div>
	                  </fieldset>

	                  <fieldset className="text-left">
	                    <legend className="text-sm font-black text-slate-700">난이도</legend>
	                    <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
	                      {(Object.keys(COACH_DIFFICULTY_LABEL) as CoachDifficulty[]).map((difficulty) => (
	                        <button
	                          key={difficulty}
	                          type="button"
	                          onClick={() => updateCoachConfig({ difficulty })}
	                          disabled={settingsLocked}
	                          className={`min-h-10 rounded-md px-2 text-xs font-black transition ${
	                            normalizedCoachConfig.difficulty === difficulty ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
	                          } disabled:cursor-not-allowed disabled:opacity-50`}
	                        >
	                          {COACH_DIFFICULTY_LABEL[difficulty]}
	                        </button>
	                      ))}
	                    </div>
	                  </fieldset>
	                </div>

	                <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
	                  <summary className="cursor-pointer text-sm font-black text-amber-950">테스트/고급</summary>
	                  <div className="mt-3 grid gap-3">
	                    <fieldset>
	                      <legend className="text-sm font-black text-amber-950">세션 대상</legend>
	                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-amber-200 bg-white/70 p-1">
	                        {(Object.keys(COACH_TESTER_LABEL) as CoachTester[]).map((tester) => (
	                          <button
	                            key={tester}
	                            type="button"
	                            onClick={() => updateCoachConfig({ tester })}
	                            disabled={settingsLocked}
	                            className={`min-h-10 rounded-md px-2 text-xs font-black transition ${
	                              normalizedCoachConfig.tester === tester ? "bg-amber-950 text-white" : "text-amber-900 hover:bg-white"
	                            } disabled:cursor-not-allowed disabled:opacity-50`}
	                          >
	                            {COACH_TESTER_LABEL[tester]}
	                          </button>
	                        ))}
	                      </div>
	                    </fieldset>

	                    <div className="grid gap-2 sm:grid-cols-2">
	                      <label className="flex min-h-11 items-center gap-2 rounded-lg border border-amber-200 bg-white/70 px-3 text-sm font-bold text-amber-950">
	                        <input
	                          type="checkbox"
	                          checked={normalizedCoachConfig.honorLiveRequests}
	                          onChange={(event) => updateCoachConfig({ honorLiveRequests: event.target.checked })}
	                          disabled={settingsLocked}
	                          className="size-4 accent-amber-950"
	                        />
	                        요청 즉시 반영
	                      </label>
	                      <label className="flex min-h-11 items-center gap-2 rounded-lg border border-amber-200 bg-white/70 px-3 text-sm font-bold text-amber-950">
	                        <input
	                          type="checkbox"
	                          checked={normalizedCoachConfig.emptyPraiseGuard}
	                          onChange={(event) => updateCoachConfig({ emptyPraiseGuard: event.target.checked })}
	                          disabled={settingsLocked}
	                          className="size-4 accent-amber-950"
	                        />
	                        빈말 칭찬 방지
	                      </label>
	                    </div>
	                  </div>
	                </details>
	              </>
	            ) : null}

	            <label className="block text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black text-slate-700">시작 프롬프트</span>
                <button
                  type="button"
                  onClick={() => {
                    setSystemPrompt(buildPromptPreview(activeProfile, lowVoice, responseStyle, enabledToolIds));
                    setPromptEdited(false);
                  }}
                  disabled={settingsLocked}
                  className="min-h-8 rounded-md border border-slate-300 px-2 text-xs font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  기본값
                </button>
              </div>
              <textarea
                value={systemPrompt}
                onChange={(event) => {
                  setSystemPrompt(event.target.value);
                  setPromptEdited(true);
                }}
                disabled={settingsLocked}
                rows={7}
                className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 font-mono text-xs leading-5 text-slate-900 outline-none transition focus:border-brand-interactive focus:ring-2 focus:ring-brand-interactive/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>

          </div>
        </details>

        <ExpressionCardView card={card} />

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-black text-slate-950">대화 기록</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyConversationLog()}
                disabled={logs.length === 0}
                className="min-h-9 rounded-md border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                기록 복사
              </button>
              <button
                type="button"
                onClick={resetBench}
                className="min-h-9 rounded-md border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                비우기
              </button>
            </div>
          </div>
          <div ref={transcriptScrollRef} className="mt-3 max-h-[40vh] space-y-2 overflow-y-auto" aria-live="polite">
            {logs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm font-semibold text-slate-400">
                아직 대화가 없습니다.
              </p>
            ) : logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-black ${
                    log.role === "bench" ? "text-emerald-700" : log.role === "user" ? "text-blue-700" : log.role === "error" ? "text-red-700" : "text-slate-500"
                  }`}>
                    {LOG_ROLE_TEXT[log.role]}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">{log.at}</span>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{log.text}</p>
              </div>
            ))}
          </div>
        </section>

        <details className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-black text-slate-700">문제 진단</summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MetricCard label="모델" value={readiness?.model ?? "-"} />
            <MetricCard label="서버 키" value={readiness?.missingEnv ? "없음" : "있음"} />
            <MetricCard label="브라우저" value={isSecure ? "마이크 가능" : "마이크 차단"} />
            <MetricCard label="마이크" value={MIC_TEXT[metrics.micPermission]} />
            <MetricCard label="연결" value={CONNECTION_TEXT[metrics.connectionState]} />
            <MetricCard label="첫 응답" value={formatMetric(metrics.firstResponseMs, "ms")} />
            <MetricCard label="응답 수" value={String(metrics.turnCount)} />
            <MetricCard label="시간" value={formatClock(metrics.sessionDurationSec)} />
          </div>

          <div className="mt-4">
            <label htmlFor="live-bench-text-probe" className="text-sm font-black text-slate-700">
              텍스트로 보내기
            </label>
            <textarea
              id="live-bench-text-probe"
              value={textProbe}
              onChange={(event) => setTextProbe(event.target.value)}
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-interactive focus:ring-2 focus:ring-brand-interactive/20"
            />
            <button
              type="button"
              onClick={sendTextProbe}
              disabled={metrics.connectionState !== "live" || textProbe.trim().length === 0 || isSendingText}
              className="mt-2 min-h-10 w-full rounded-lg bg-emerald-600 px-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              보내기
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRating("useful")}
              className={`min-h-10 rounded-lg border px-3 text-sm font-black transition ${
                metrics.rating === "useful"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              괜찮음
            </button>
            <button
              type="button"
              onClick={() => setRating("not-useful")}
              className={`min-h-10 rounded-lg border px-3 text-sm font-black transition ${
                metrics.rating === "not-useful"
                  ? "border-red-500 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              별로
            </button>
          </div>
        </details>
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-base font-black text-slate-950">{value}</dd>
    </div>
  );
}

function ToolBoard({
  tools,
  enabledToolIds,
  locked,
  activeCount,
  onToggle,
}: {
  tools: LiveToolMetadata[];
  enabledToolIds: string[];
  locked: boolean;
  activeCount: number;
  onToggle: (tool: LiveToolMetadata) => void;
}) {
  const enabledSet = new Set(enabledToolIds);
  const categories = TOOL_CATEGORY_ORDER
    .map((category) => ({
      category,
      tools: tools.filter((tool) => tool.category === category),
    }))
    .filter((group) => group.tools.length > 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-black text-slate-950">도구</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">{toolTokenHint(activeCount)}</p>
        </div>
        {locked ? (
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-800">
            다시 시작하면 반영
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {categories.map((group) => (
          <details key={group.category} open={group.category === "study" || group.category === "search"} className="rounded-lg border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-3 py-2 text-sm font-black text-slate-800">
              {TOOL_CATEGORY_LABEL[group.category]}
            </summary>
            <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
              {group.tools.map((tool) => {
                const enabled = enabledSet.has(tool.id);
                const disabled = locked || tool.status !== "available";
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => onToggle(tool)}
                    disabled={disabled}
                    aria-pressed={enabled}
                    className={`min-h-16 rounded-lg border bg-white px-3 py-2 text-left transition ${
                      enabled
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-slate-200 hover:border-slate-300"
                    } disabled:cursor-not-allowed disabled:opacity-65`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${
                          enabled
                            ? "bg-emerald-500"
                            : tool.status === "available"
                              ? "bg-slate-400"
                              : tool.status === "locked"
                                ? "bg-red-400"
                                : "bg-amber-400"
                        }`} />
                        <span className="text-sm font-black text-slate-950">{tool.label}</span>
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                        enabled
                          ? "bg-emerald-100 text-emerald-800"
                          : tool.status === "available"
                            ? "bg-slate-100 text-slate-600"
                            : tool.status === "locked"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-800"
                      }`}>
                        {enabled ? "켜짐" : TOOL_STATUS_TEXT[tool.status]}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
                      {tool.reason ?? tool.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function ExpressionCardView({ card }: { card: ExpressionCard | null }) {
  if (!card) return null;

  return (
    <section aria-live="polite" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-black text-slate-500">
        {card.state === "prompt" && <span aria-label="locked">🔒</span>}
        <span>
          {card.state === "prompt" ? "듣기 전" : card.state === "reveal" ? "교정" : "드릴"}
        </span>
      </div>
      <p className="mt-2 text-xl font-black text-slate-950">{card.ko}</p>
      {card.state === "reveal" && card.en && (
        <p className="mt-1 text-lg font-bold text-emerald-700">{card.en}</p>
      )}
      {card.state === "reveal" && card.pron && (
        <p className="mt-1 text-sm font-semibold text-slate-400">{card.pron}</p>
      )}
      {card.state === "drill" && card.drillHint && (
        <p className="mt-1 text-sm font-bold text-amber-700">{card.drillHint}</p>
      )}
    </section>
  );
}
