import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  GEMINI_API_KEY_ENV,
  GEMINI_AUTH_TOKEN_ENDPOINT,
  GEMINI_LIVE_WS_ENDPOINT,
  LIVE_VOICES,
  LIVE_PROFILES,
  buildDefaultSystemPrompt,
  buildLiveSetup,
  buildReadiness,
  getGeminiApiKey,
  normalizeLiveMode,
  normalizeResponseStyle,
  normalizeVadPreset,
  normalizeLiveVoice,
} from "@/lib/server/admin-live";
import {
  DEFAULT_LIVE_ENABLED_TOOL_IDS,
  getDefaultLiveEnabledToolIds,
  getLiveToolMetadata,
  LIVE_SEARCH_SELECTION_POLICY,
  normalizeLiveToolIds,
} from "@/lib/server/admin-live-tools";
import {
  DEFAULT_COACH_CONFIG,
  normalizeCoachConfig,
} from "@/lib/admin-live-coach-config";
import { registerLiveToolSessionContext } from "@/lib/server/admin-live-session-context";

export const dynamic = "force-dynamic";
export const revalidate = false;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeRequestedToolIds(mode: string, body: {
  enabledToolIds?: unknown;
} | null) {
  if (Array.isArray(body?.enabledToolIds)) {
    return normalizeLiveToolIds(body.enabledToolIds);
  }
  return getDefaultLiveEnabledToolIds(mode);
}

async function requireAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const authenticated = await verifyAdminSessionToken(token);
  if (authenticated) return null;

  return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
}

export async function GET() {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;

  return noStoreJson({
    readiness: buildReadiness(),
    profiles: Object.values(LIVE_PROFILES).map((profile) => ({
      id: profile.id,
      label: profile.label,
      intent: profile.intent,
      constraints: profile.constraints,
      sampleProbe: profile.sampleProbe,
      languageHints: profile.languageHints,
      defaultSystemPrompt: buildDefaultSystemPrompt(
        profile.id,
        true,
        "concise",
        getDefaultLiveEnabledToolIds(profile.id),
      ),
    })),
    voices: LIVE_VOICES,
    defaults: {
      voiceName: "Kore",
      responseStyle: "concise",
      vadPreset: "balanced",
      coachConfig: DEFAULT_COACH_CONFIG,
      tools: {
        enabledToolIds: DEFAULT_LIVE_ENABLED_TOOL_IDS,
        enabledToolIdsByMode: {
          fenok: getDefaultLiveEnabledToolIds("fenok"),
          mona: getDefaultLiveEnabledToolIds("mona"),
        },
        registry: getLiveToolMetadata(),
        searchSelectionPolicy: LIVE_SEARCH_SELECTION_POLICY,
      },
    },
  });
}

export async function POST(request: Request) {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as
    | {
        mode?: unknown;
        lowVoice?: unknown;
        voiceName?: unknown;
        responseStyle?: unknown;
        vadPreset?: unknown;
        interruptionMode?: unknown;
        resumeHandle?: unknown;
        systemPrompt?: unknown;
        enabledToolIds?: unknown;
        coachConfig?: unknown;
      }
    | null;
  const mode = normalizeLiveMode(body?.mode);
  const lowVoice = body?.lowVoice !== false;
  const voiceName = normalizeLiveVoice(body?.voiceName);
  const responseStyle = normalizeResponseStyle(body?.responseStyle);
  const vadPreset = normalizeVadPreset(body?.vadPreset, mode);
  const interruptionMode = body?.interruptionMode === "no-interrupt" ? "no-interrupt" : "barge-in";
  const coachConfig = normalizeCoachConfig(body?.coachConfig);
  const resumeHandle = typeof body?.resumeHandle === "string" && body.resumeHandle.length > 0 && body.resumeHandle.length <= 512
    ? body.resumeHandle
    : null;
  const enabledToolIds = normalizeRequestedToolIds(mode, body);
  const now = new Date();
  const apiKey = getGeminiApiKey();
  const sessionId = `live-${mode}-${now.getTime().toString(36)}`;

  if (!apiKey) {
    return noStoreJson(
      {
        error: "MISSING_GEMINI_API_KEY",
        status: "BLOCKED",
        missingEnv: GEMINI_API_KEY_ENV,
        readiness: buildReadiness(),
      },
      503,
    );
  }

  const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now.getTime() + 60 * 1000).toISOString();
  const { setup, coachSessionState } = await buildLiveSetup(mode, {
    lowVoice,
    voiceName,
    responseStyle,
    vadPreset,
    interruptionMode,
    resumeHandle,
    systemPrompt: body?.systemPrompt,
    enabledToolIds,
    coachConfig,
    sessionId,
  });
  const tokenResponse = await fetch(GEMINI_AUTH_TOKEN_ENDPOINT, {
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

  registerLiveToolSessionContext({
    sessionId,
    mode,
    coachConfig,
  });

  return noStoreJson(
    {
      sessionId,
      status: "LIVE_TOKEN_READY",
      startedAt: now.toISOString(),
      adapter: "gemini-live-ephemeral",
      mode,
      resumed: !!resumeHandle,
      profile: {
        id: LIVE_PROFILES[mode].id,
        label: LIVE_PROFILES[mode].label,
        intent: LIVE_PROFILES[mode].intent,
        constraints: LIVE_PROFILES[mode].constraints,
        sampleProbe: LIVE_PROFILES[mode].sampleProbe,
      },
      settings: {
        voiceName,
        responseStyle,
        vadPreset,
        interruptionMode,
        enabledToolIds,
        coachConfig,
        coachSessionState,
      },
      token,
      expiresAt: typeof tokenPayload?.expireTime === "string" ? tokenPayload.expireTime : expireTime,
      newSessionExpiresAt:
        typeof tokenPayload?.newSessionExpireTime === "string"
          ? tokenPayload.newSessionExpireTime
          : newSessionExpireTime,
      websocketEndpoint: GEMINI_LIVE_WS_ENDPOINT,
      setup,
      metrics: {
        firstResponseMs: null,
        transcriptLatencyMs: null,
        turnCount: 0,
        interruptionCount: 0,
        sessionDurationSec: 0,
        lowVoice,
      },
    },
  );
}

export async function DELETE(request: Request) {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as
    | { sessionId?: unknown }
    | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;

  return noStoreJson(
    {
      stopped: true,
      sessionId,
      stoppedAt: new Date().toISOString(),
    },
  );
}
