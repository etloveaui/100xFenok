import {
  signAdminScopedServerValue,
  verifyAdminScopedServerValue,
} from "@/lib/server/admin-session";
import {
  normalizeWindDownVoiceDescriptor,
  type WindDownVoiceActivity,
  type WindDownVoiceDescriptor,
} from "@/features/winddown/voice/product";
import {
  normalizeWindDownVoiceJourneyTargets,
  type WindDownVoiceJourneyTarget,
} from "@/features/winddown/voice/journeyTarget";

const PROOF_SCOPE = "winddown-voice-report-session-v1";
export const WIND_DOWN_VOICE_REPORT_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
export const WIND_DOWN_VOICE_REPORT_MAX_DURATION_MS = 10 * 60 * 1000;
export const WIND_DOWN_VOICE_REPORT_CLOCK_SKEW_MS = 30 * 1000;
const MAX_PROOF_LENGTH = 2_048;
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9._-]{1,120}$/;
const SAFE_PRODUCT_SESSION_ID = /^[A-Za-z0-9._-]{8,120}$/;

type WindDownVoiceSessionProofPayload = {
  v: 1;
  activity: WindDownVoiceActivity;
  productSessionId: string;
  descriptor: WindDownVoiceDescriptor;
  conversationId: string;
  resumedFromConversationId?: string;
  issuedAtMs: number;
  expiresAtMs: number;
  journeyTargets: WindDownVoiceJourneyTarget[];
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodePayload(payload: WindDownVoiceSessionProofPayload) {
  return bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
}

function exactPayloadKeys(
  value: Record<string, unknown>,
  resumed: boolean,
) {
  const expected = new Set([
    "v",
    "activity",
    "productSessionId",
    "descriptor",
    "conversationId",
    "issuedAtMs",
    "expiresAtMs",
    "journeyTargets",
    ...(resumed ? ["resumedFromConversationId"] : []),
  ]);
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function parsePayload(encoded: string): WindDownVoiceSessionProofPayload | null {
  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(encoded));
    const value = JSON.parse(decoded) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const resumed = value.resumedFromConversationId !== undefined;
    if (!exactPayloadKeys(value, resumed)) return null;
    const descriptor = normalizeWindDownVoiceDescriptor(value.descriptor);
    const journeyTargets = normalizeWindDownVoiceJourneyTargets(
      value.journeyTargets,
    );
    if (
      value.v !== 1
      || (value.activity !== "roleplay" && value.activity !== "live-talk")
      || typeof value.productSessionId !== "string"
      || !SAFE_PRODUCT_SESSION_ID.test(value.productSessionId)
      || !descriptor
      || !journeyTargets
      || descriptor.activity !== value.activity
      || typeof value.conversationId !== "string"
      || !SAFE_CONVERSATION_ID.test(value.conversationId)
      || (
        resumed
        && (
          typeof value.resumedFromConversationId !== "string"
          || !SAFE_CONVERSATION_ID.test(value.resumedFromConversationId)
        )
      )
      || typeof value.issuedAtMs !== "number"
      || !Number.isSafeInteger(value.issuedAtMs)
      || typeof value.expiresAtMs !== "number"
      || !Number.isSafeInteger(value.expiresAtMs)
      || value.expiresAtMs <= value.issuedAtMs
    ) {
      return null;
    }
    return {
      v: 1,
      activity: value.activity,
      productSessionId: value.productSessionId,
      descriptor,
      conversationId: value.conversationId,
      ...(resumed
        ? { resumedFromConversationId: value.resumedFromConversationId as string }
        : {}),
      issuedAtMs: value.issuedAtMs,
      expiresAtMs: value.expiresAtMs,
      journeyTargets,
    };
  } catch {
    return null;
  }
}

function sameDescriptor(
  left: WindDownVoiceDescriptor,
  right: WindDownVoiceDescriptor,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isWindDownVoiceSessionProof(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 80
    || value.length > MAX_PROOF_LENGTH
  ) return false;
  const parts = value.split(".");
  return parts.length === 2
    && /^[A-Za-z0-9_-]+$/.test(parts[0] ?? "")
    && /^[a-f0-9]{64}$/.test(parts[1] ?? "");
}

export async function createWindDownVoiceSessionProof(args: {
  activity: WindDownVoiceActivity;
  productSessionId: string;
  descriptor: WindDownVoiceDescriptor;
  conversationId: string;
  resumedFromConversationId?: string;
  issuedAtMs: number;
  journeyTargets?: WindDownVoiceJourneyTarget[];
}) {
  const descriptor = normalizeWindDownVoiceDescriptor(args.descriptor);
  const journeyTargets = normalizeWindDownVoiceJourneyTargets(
    args.journeyTargets ?? [],
  );
  if (
    !descriptor
    || !journeyTargets
    || (args.activity === "live-talk" && journeyTargets.length > 0)
    || descriptor.activity !== args.activity
    || !SAFE_PRODUCT_SESSION_ID.test(args.productSessionId)
    || !SAFE_CONVERSATION_ID.test(args.conversationId)
    || (
      args.resumedFromConversationId !== undefined
      && !SAFE_CONVERSATION_ID.test(args.resumedFromConversationId)
    )
    || !Number.isSafeInteger(args.issuedAtMs)
  ) {
    throw new Error("WINDDOWN_VOICE_SESSION_PROOF_INPUT_INVALID");
  }
  const encoded = encodePayload({
    v: 1,
    activity: args.activity,
    productSessionId: args.productSessionId,
    descriptor,
    conversationId: args.conversationId,
    ...(args.resumedFromConversationId
      ? { resumedFromConversationId: args.resumedFromConversationId }
      : {}),
    issuedAtMs: args.issuedAtMs,
    expiresAtMs: args.issuedAtMs + WIND_DOWN_VOICE_REPORT_PROOF_TTL_MS,
    journeyTargets,
  });
  const signature = await signAdminScopedServerValue(PROOF_SCOPE, encoded);
  return `${encoded}.${signature}`;
}

export async function readWindDownVoiceSessionProofChainContext(args: {
  activity: WindDownVoiceActivity;
  productSessionId: string;
  descriptor: WindDownVoiceDescriptor;
  conversationIds: readonly string[];
  sessionProofs: readonly string[];
  startedAtIso: string | null;
  stoppedAtIso: string;
  nowMs?: number;
}): Promise<{ journeyTargets: WindDownVoiceJourneyTarget[] } | null> {
  const descriptor = normalizeWindDownVoiceDescriptor(args.descriptor);
  const nowMs = args.nowMs ?? Date.now();
  const startedAtMs = Date.parse(args.startedAtIso ?? "");
  const stoppedAtMs = Date.parse(args.stoppedAtIso);
  if (
    !descriptor
    || descriptor.activity !== args.activity
    || !SAFE_PRODUCT_SESSION_ID.test(args.productSessionId)
    || args.conversationIds.length < 1
    || args.conversationIds.length > 5
    || args.sessionProofs.length !== args.conversationIds.length
    || !Number.isFinite(startedAtMs)
    || !Number.isFinite(stoppedAtMs)
    || stoppedAtMs < startedAtMs
    || stoppedAtMs > nowMs + WIND_DOWN_VOICE_REPORT_CLOCK_SKEW_MS
    || stoppedAtMs - startedAtMs
      > WIND_DOWN_VOICE_REPORT_MAX_DURATION_MS
        + WIND_DOWN_VOICE_REPORT_CLOCK_SKEW_MS
  ) return null;

  let previousConversationId: string | null = null;
  let previousIssuedAtMs: number | null = null;
  let firstIssuedAtMs: number | null = null;
  let journeyTargetsJson: string | null = null;
  let journeyTargets: WindDownVoiceJourneyTarget[] = [];
  for (let index = 0; index < args.sessionProofs.length; index += 1) {
    const proof = args.sessionProofs[index];
    if (!isWindDownVoiceSessionProof(proof)) return null;
    const [encoded, signature] = proof.split(".", 2);
    const payload = parsePayload(encoded);
    if (
      !payload
      || !await verifyAdminScopedServerValue(PROOF_SCOPE, encoded, signature)
      || payload.activity !== args.activity
      || payload.productSessionId !== args.productSessionId
      || !sameDescriptor(payload.descriptor, descriptor)
      || payload.conversationId !== args.conversationIds[index]
      || payload.expiresAtMs <= nowMs
      || payload.issuedAtMs > stoppedAtMs
      || stoppedAtMs > payload.expiresAtMs
      || (
        previousIssuedAtMs !== null
        && payload.issuedAtMs < previousIssuedAtMs
      )
      || (
        index === 0
          ? payload.resumedFromConversationId !== undefined
          : payload.resumedFromConversationId !== previousConversationId
      )
    ) {
      return null;
    }
    const currentTargetsJson = JSON.stringify(payload.journeyTargets);
    if (
      journeyTargetsJson !== null
      && journeyTargetsJson !== currentTargetsJson
    ) return null;
    journeyTargetsJson = currentTargetsJson;
    journeyTargets = payload.journeyTargets;
    firstIssuedAtMs ??= payload.issuedAtMs;
    previousIssuedAtMs = payload.issuedAtMs;
    previousConversationId = payload.conversationId;
  }
  return firstIssuedAtMs === startedAtMs ? { journeyTargets } : null;
}

export async function verifyWindDownVoiceSessionProofChain(
  args: Parameters<typeof readWindDownVoiceSessionProofChainContext>[0],
) {
  return Boolean(await readWindDownVoiceSessionProofChainContext(args));
}
