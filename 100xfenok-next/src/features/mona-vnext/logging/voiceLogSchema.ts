import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

export const MONA_VNEXT_LOG_SCHEMA_VERSION = 1;

export type MonaVnextLogEvent = {
  type: string;
  message: string;
  atIso: string;
  detail?: Record<string, unknown>;
};

export type MonaVnextVoiceLogDoc = {
  schemaVersion: typeof MONA_VNEXT_LOG_SCHEMA_VERSION;
  source: "mona-vnext";
  namespace: "voice-logs-vnext";
  tester: "owner";
  sessionId: string;
  conversationId: string;
  startedAt: string;
  savedAt: string;
  stoppedAt: string | null;
  settings: Record<string, unknown>;
  metrics: Record<string, unknown>;
  turns: MonaVnextTurn[];
  learnerTranscript: Array<{
    speaker: "user" | "model";
    text: string;
    turnSeq: number;
    atIso: string;
  }>;
  events: MonaVnextLogEvent[];
  finalized: boolean;
};

const CONTROL_LEAKAGE_PATTERNS = [
  /\bRAW\b/,
  /\bserverContent\b/,
  /\bcoachTurn\b/,
  /\btoolCall\b/,
  /\btoolResponse\b/,
  /\bcontrol-intent\b/,
  /\bframesSent\b/,
  /\[(?:SYSTEM|CONTROL|coach_control)[^\]]*\]/i,
  /\bstate\s*=\s*(?:prompt|reveal|drill|clear)\b/i,
];

export function containsMonaVnextControlLeakage(value: string | null | undefined) {
  const text = value ?? "";
  return CONTROL_LEAKAGE_PATTERNS.some((pattern) => pattern.test(text));
}

export function scrubLearnerFacingText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (containsMonaVnextControlLeakage(text)) return null;
  return text.slice(0, 1600);
}
