"use client";

import type { MonaVnextSessionExpressionBank } from "@/features/mona-vnext/coach/coachPolicy";

export const MONA_VNEXT_INPUT_SAMPLE_RATE = 16000;
export const MONA_VNEXT_OUTPUT_SAMPLE_RATE = 24000;
export const MONA_VNEXT_AUDIO_MIME = `audio/pcm;rate=${MONA_VNEXT_INPUT_SAMPLE_RATE}`;

export type MonaVnextLiveStatus =
  | "idle"
  | "connecting"
  | "setup-wait"
  | "listening"
  | "stopping"
  | "stopped"
  | "blocked"
  | "error";

export type MonaVnextSessionResponse = {
  sessionId: string;
  conversationId: string;
  resumedFromConversationId?: string;
  status: "LIVE_TOKEN_READY";
  startedAt: string;
  adapter: "gemini-live-ephemeral-vnext";
  token: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  websocketEndpoint: string;
  setup: Record<string, unknown>;
  expressionBank: MonaVnextSessionExpressionBank;
  settings: {
    model: string;
    voiceName: string;
    vadPreset: string;
    lowVoice: boolean;
    interruptionMode: string;
    temperature: number;
    activeExpressionId?: string;
    expressionBankSize?: number;
    expressionBankSource?: string;
    expressionBankSeed?: string;
    thinkingLevel: string;
    namespace: string;
    productionWriteEnabled: false;
    clientBuildVersion?: string;
  };
};

export type MonaVnextInlineDataPart = {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
};

export type MonaVnextServerContent = {
  interrupted?: boolean;
  generationComplete?: boolean;
  turnComplete?: boolean;
  waitingForInput?: boolean;
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
  modelTurn?: {
    parts?: MonaVnextInlineDataPart[];
  };
};

export type MonaVnextServerMessage = {
  setupComplete?: Record<string, never>;
  serverContent?: MonaVnextServerContent;
  sessionResumptionUpdate?: {
    resumable?: boolean;
    newHandle?: string;
  };
  goAway?: {
    timeLeft?: unknown;
    [key: string]: unknown;
  };
  toolCall?: unknown;
  toolCallCancellation?: unknown;
};

export function buildMonaVnextWebSocketUrl(endpoint: string, token: string) {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}access_token=${encodeURIComponent(token)}`;
}

export async function readSocketPayload(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data.buffer);
  }
  return String(data ?? "");
}

export function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate = MONA_VNEXT_INPUT_SAMPLE_RATE): Int16Array {
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

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToPcmFloat32(value: string): Float32Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const view = new DataView(bytes.buffer);
  const pcm = new Float32Array(bytes.length / 2);
  for (let i = 0; i < pcm.length; i += 1) {
    pcm[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return pcm;
}

export function getPcmSampleRate(mimeType?: string): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? "");
  if (!match) return MONA_VNEXT_OUTPUT_SAMPLE_RATE;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MONA_VNEXT_OUTPUT_SAMPLE_RATE;
}

export function buildRealtimeAudioInput(pcm: Int16Array) {
  return {
    realtimeInput: {
      audio: {
        data: pcm16ToBase64(pcm),
        mimeType: MONA_VNEXT_AUDIO_MIME,
      },
    },
  };
}

export function buildRealtimeTextInput(text: string) {
  return {
    realtimeInput: {
      text,
    },
  };
}

export function buildAudioStreamEndInput() {
  return {
    realtimeInput: {
      audioStreamEnd: true,
    },
  };
}
