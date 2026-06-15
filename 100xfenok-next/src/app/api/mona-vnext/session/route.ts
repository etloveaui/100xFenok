import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import { MONA_VNEXT_NAMESPACE_POLICY } from "@/features/mona-vnext/memory/monaVnextNamespace";
import {
  MONA_VNEXT_AUTH_TOKEN_ENDPOINT,
  MONA_VNEXT_GEMINI_API_KEY_ENV,
  MONA_VNEXT_LIVE_WS_ENDPOINT,
  buildMonaVnextLiveSetup,
  buildMonaVnextReadiness,
  getMonaVnextGeminiApiKey,
  normalizeMonaVnextInterruptionMode,
  normalizeMonaVnextVadPreset,
  normalizeMonaVnextVoice,
} from "@/features/mona-vnext/server/liveSetup";
import { createMonaVnextConversationId } from "@/features/mona-vnext/transcript/turnBoundary";

export const dynamic = "force-dynamic";
export const revalidate = false;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function requireAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const authenticated = await verifyAdminSessionToken(token);
  if (authenticated) return null;
  return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
}

function normalizeClientBuildVersion(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 80) : null;
}

export async function GET() {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;

  return noStoreJson({
    readiness: buildMonaVnextReadiness(),
    defaults: {
      voiceName: "Kore",
      vadPreset: "relaxed",
      lowVoice: true,
      interruptionMode: "no-interrupt",
      englishVisible: true,
      namespace: MONA_VNEXT_NAMESPACE_POLICY,
    },
  });
}

export async function POST(request: Request) {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const now = new Date();
  const apiKey = getMonaVnextGeminiApiKey();
  const conversationId = createMonaVnextConversationId(now);
  const sessionId = `${conversationId}-live`;
  const voiceName = normalizeMonaVnextVoice(body?.voiceName);
  const vadPreset = normalizeMonaVnextVadPreset(body?.vadPreset);
  const interruptionMode = normalizeMonaVnextInterruptionMode(body?.interruptionMode);
  const lowVoice = body?.lowVoice !== false;
  const englishVisible = body?.englishVisible !== false;
  const clientBuildVersion = normalizeClientBuildVersion(body?.clientBuildVersion);

  if (!apiKey) {
    return noStoreJson(
      {
        error: "MISSING_GEMINI_API_KEY",
        status: "BLOCKED",
        missingEnv: MONA_VNEXT_GEMINI_API_KEY_ENV,
        readiness: buildMonaVnextReadiness(),
      },
      503,
    );
  }

  const setup = buildMonaVnextLiveSetup({
    voiceName,
    vadPreset,
    lowVoice,
    interruptionMode,
    englishVisible,
  });
  const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now.getTime() + 60 * 1000).toISOString();
  const tokenResponse = await fetch(MONA_VNEXT_AUTH_TOKEN_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      bidiGenerateContentSetup: setup,
    }),
  }).catch(() => null);

  if (!tokenResponse) {
    return noStoreJson({ error: "GEMINI_EPHEMERAL_TOKEN_NETWORK_FAILED" }, 502);
  }

  if (!tokenResponse.ok) {
    return noStoreJson(
      {
        error: "GEMINI_EPHEMERAL_TOKEN_FAILED",
        providerStatus: tokenResponse.status,
      },
      502,
    );
  }

  const tokenPayload = (await tokenResponse.json().catch(() => null)) as
    | { name?: unknown; expireTime?: unknown; newSessionExpireTime?: unknown }
    | null;
  const token = typeof tokenPayload?.name === "string" ? tokenPayload.name : "";
  if (!token) {
    return noStoreJson({ error: "GEMINI_EPHEMERAL_TOKEN_EMPTY" }, 502);
  }

  return noStoreJson({
    sessionId,
    conversationId,
    status: "LIVE_TOKEN_READY",
    startedAt: now.toISOString(),
    adapter: "gemini-live-ephemeral-vnext",
    token,
    expiresAt: typeof tokenPayload?.expireTime === "string" ? tokenPayload.expireTime : expireTime,
    newSessionExpiresAt:
      typeof tokenPayload?.newSessionExpireTime === "string"
        ? tokenPayload.newSessionExpireTime
        : newSessionExpireTime,
    websocketEndpoint: MONA_VNEXT_LIVE_WS_ENDPOINT,
    setup,
    settings: {
      ...(clientBuildVersion ? { clientBuildVersion } : {}),
      voiceName,
      vadPreset,
      lowVoice,
      interruptionMode,
      namespace: "mona-vnext",
      productionWriteEnabled: false,
    },
  });
}
