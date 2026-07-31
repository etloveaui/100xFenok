import {
  MONA_VNEXT_AUTH_TOKEN_ENDPOINT,
  MONA_VNEXT_GEMINI_API_KEY_ENV,
  MONA_VNEXT_LIVE_WS_ENDPOINT,
  buildMonaVnextAudioSetup,
  getMonaVnextGeminiApiKey,
  normalizeMonaVnextVadPreset,
  normalizeMonaVnextVoice,
} from "@/features/mona-vnext/server/liveSetup";
import {
  WIND_DOWN_VOICE_POLICY_VERSION,
  getWindDownLiveTalkTopic,
  getWindDownVoiceScenario,
  type WindDownVoiceDescriptor,
} from "@/features/winddown/voice/product";
import {
  WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION,
  WindDownVoiceSessionRequestError,
  parseWindDownVoiceSessionRequest,
  type WindDownLiveTalkDescriptor,
  type WindDownRoleplayDescriptor,
  type WindDownVoiceActivity,
  type WindDownVoiceSessionRequest,
  type WindDownVoiceSessionResponse,
} from "@/features/winddown/voice/sessionContract";
import {
  createWindDownVoiceSessionProof,
} from "@/features/winddown/server/voiceSessionProof";
import type {
  WindDownVoiceJourneyTarget,
} from "@/features/winddown/voice/journeyTarget";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type WindDownVoiceSessionDependencies = {
  now?: () => Date;
  randomId?: () => string;
  getApiKey?: () => string | null;
  fetch?: FetchLike;
  journeyTargets?: WindDownVoiceJourneyTarget[];
};

export class WindDownVoiceSessionError extends Error {
  constructor(
    readonly code:
      | "MISSING_GEMINI_API_KEY"
      | "GEMINI_EPHEMERAL_TOKEN_NETWORK_FAILED"
      | "GEMINI_EPHEMERAL_TOKEN_FAILED"
      | "GEMINI_EPHEMERAL_TOKEN_EMPTY"
      | "WINDDOWN_VOICE_EXPERIENCE_NOT_FOUND",
    readonly status: 404 | 502 | 503,
    readonly providerStatus?: number,
  ) {
    super(code);
    this.name = "WindDownVoiceSessionError";
  }
}

function buildRoleplayPrompt(
  descriptor: WindDownRoleplayDescriptor,
  journeyTargets: readonly WindDownVoiceJourneyTarget[] = [],
) {
  const goals = descriptor.goals
    .map((goal, index) => `${index + 1}. ${goal.label} (${goal.id})`)
    .join("\n");
  return [
    "You are Lumi, a warm English conversation partner in a fixed roleplay.",
    `ROLEPLAY POLICY VERSION: ${WIND_DOWN_VOICE_POLICY_VERSION}`,
    `SCENARIO: ${descriptor.title}`,
    `SCENE: ${descriptor.scene}`,
    `You are the ${descriptor.coachRole}.`,
    "ROLES: Stay in that server-assigned role. The learner remains themself.",
    "GOALS: Help the learner naturally reach these scenario goals without reading them as a quiz:",
    goals,
    `OPENING LINE: ${descriptor.openingLine}`,
    "Speak mostly in short, natural English turns. Use brief Korean only when the learner is stuck.",
    "Do not switch to study exercises, grading, or review scheduling.",
    "The roleplay is complete only after the learner has had a natural chance to meet every listed goal.",
    ...(journeyTargets.length > 0
      ? [
          "TONIGHT'S PHRASES: Invite the learner to use at least one of these naturally. Do not read them as a quiz or claim success before the learner says one:",
          ...journeyTargets.map(
            (target, index) => `${index + 1}. ${target.en} (${target.materialId})`,
          ),
        ]
      : []),
  ].join("\n");
}

function buildLiveTalkPrompt(
  descriptor: WindDownLiveTalkDescriptor,
) {
  return [
    "You are Lumi, a warm partner for an open conversation in English.",
    `LIVE TALK POLICY VERSION: ${WIND_DOWN_VOICE_POLICY_VERSION}`,
    `SERVER-SELECTED TOPIC: ${descriptor.title}`,
    `SCENE: ${descriptor.scene}`,
    `You are the ${descriptor.coachRole}.`,
    `OPENING LINE: ${descriptor.openingLine}`,
    "Keep the exchange open and natural. Follow the learner's meaning instead of driving scenario goals.",
    "Speak mostly in short, natural English turns. Use brief Korean only when the learner is stuck.",
    "Do not use study exercises, grading, review scheduling, or roleplay completion goals.",
    "There is no automatic completion. The session ends only when the learner decides to stop.",
  ].join("\n");
}

export function buildWindDownVoicePrompt(
  activity: WindDownVoiceActivity,
  descriptor?: WindDownRoleplayDescriptor | WindDownLiveTalkDescriptor,
  journeyTargets: readonly WindDownVoiceJourneyTarget[] = [],
) {
  if (!descriptor || descriptor.kind !== (activity === "roleplay" ? "scenario" : "topic")) {
    throw new WindDownVoiceSessionError("WINDDOWN_VOICE_EXPERIENCE_NOT_FOUND", 404);
  }
  return activity === "roleplay"
    ? buildRoleplayPrompt(
        descriptor as WindDownRoleplayDescriptor,
        journeyTargets,
      )
    : buildLiveTalkPrompt(descriptor as WindDownLiveTalkDescriptor);
}

function resolveExperience(request: WindDownVoiceSessionRequest) {
  if (request.activity === "roleplay") {
    const scenario = getWindDownVoiceScenario(request.scenarioId);
    if (!scenario || scenario.version !== request.policyVersion) {
      throw new WindDownVoiceSessionError("WINDDOWN_VOICE_EXPERIENCE_NOT_FOUND", 404);
    }
    const descriptor: WindDownRoleplayDescriptor = {
      kind: "scenario",
      scenarioId: request.scenarioId,
      policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
      title: scenario.title,
      scene: scenario.scene,
      coachRole: scenario.coachRole,
      openingLine: scenario.openingLine,
      goals: scenario.goals.map(({ id, label }) => ({ id, label })),
    };
    return descriptor;
  }
  const topic = getWindDownLiveTalkTopic(request.topicId);
  if (!topic) {
    throw new WindDownVoiceSessionError("WINDDOWN_VOICE_EXPERIENCE_NOT_FOUND", 404);
  }
  const descriptor: WindDownLiveTalkDescriptor = {
    kind: "topic",
    topicId: request.topicId,
    policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
    title: topic.title,
    scene: topic.scene,
    coachRole: topic.coachRole,
    openingLine: topic.openingLine,
  };
  return descriptor;
}

function createId() {
  return crypto.randomUUID();
}

export async function createWindDownVoiceSession(
  value: WindDownVoiceSessionRequest | unknown,
  dependencies: WindDownVoiceSessionDependencies = {},
): Promise<WindDownVoiceSessionResponse> {
  const request = parseWindDownVoiceSessionRequest(value);
  const now = (dependencies.now ?? (() => new Date()))();
  const randomId = (dependencies.randomId ?? createId)();
  const apiKey = (dependencies.getApiKey ?? getMonaVnextGeminiApiKey)();
  const fetchImpl = dependencies.fetch ?? fetch;
  if (!apiKey) {
    throw new WindDownVoiceSessionError("MISSING_GEMINI_API_KEY", 503);
  }

  const descriptorId = request.activity === "roleplay"
    ? request.scenarioId
    : request.topicId;
  const conversationPrefix = `winddown-${request.activity}-${descriptorId}-`;
  if (
    request.resumedFromConversationId
    && !request.resumedFromConversationId.startsWith(conversationPrefix)
  ) {
    throw new WindDownVoiceSessionRequestError("RESUME_ACTIVITY_MISMATCH");
  }
  const conversationId = `${conversationPrefix}${randomId}`;
  const sessionId = `${conversationPrefix}${randomId}`;
  const experience = resolveExperience(request);
  const voiceName = normalizeMonaVnextVoice(request.voiceName);
  const vadPreset = normalizeMonaVnextVadPreset(request.vadPreset);
  const setup = buildMonaVnextAudioSetup({
    voiceName,
    vadPreset,
    lowVoice: true,
    interruptionMode: "no-interrupt",
    systemInstruction: buildWindDownVoicePrompt(
      request.activity,
      experience,
      request.activity === "roleplay"
        ? dependencies.journeyTargets ?? []
        : [],
    ),
  });
  const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now.getTime() + 60 * 1000).toISOString();

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImpl(MONA_VNEXT_AUTH_TOKEN_ENDPOINT, {
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
    });
  } catch {
    throw new WindDownVoiceSessionError("GEMINI_EPHEMERAL_TOKEN_NETWORK_FAILED", 502);
  }
  if (!tokenResponse.ok) {
    throw new WindDownVoiceSessionError(
      "GEMINI_EPHEMERAL_TOKEN_FAILED",
      502,
      tokenResponse.status,
    );
  }
  const tokenPayload = (await tokenResponse.json().catch(() => null)) as
    | { name?: unknown; expireTime?: unknown; newSessionExpireTime?: unknown }
    | null;
  const token = typeof tokenPayload?.name === "string"
    ? tokenPayload.name.trim()
    : "";
  if (!token) {
    throw new WindDownVoiceSessionError("GEMINI_EPHEMERAL_TOKEN_EMPTY", 502);
  }
  const reportDescriptor: WindDownVoiceDescriptor = request.activity === "roleplay"
    ? {
      activity: "roleplay",
      scenarioId: request.scenarioId,
      policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
    }
    : {
      activity: "live-talk",
      topicId: request.topicId,
      policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
    };
  const reportProof = await createWindDownVoiceSessionProof({
    activity: request.activity,
    productSessionId: request.productSessionId,
    descriptor: reportDescriptor,
    conversationId,
    ...(request.resumedFromConversationId
      ? { resumedFromConversationId: request.resumedFromConversationId }
      : {}),
    issuedAtMs: now.getTime(),
    journeyTargets: request.activity === "roleplay"
      ? dependencies.journeyTargets ?? []
      : [],
  });

  const common = {
    schemaVersion: WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION,
    policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
    productSessionId: request.productSessionId,
    sessionId,
    conversationId,
    ...(request.resumedFromConversationId
      ? { resumedFromConversationId: request.resumedFromConversationId }
      : {}),
    status: "LIVE_TOKEN_READY" as const,
    startedAt: now.toISOString(),
    adapter: "gemini-live-ephemeral-winddown" as const,
    token,
    expiresAt: typeof tokenPayload?.expireTime === "string"
      ? tokenPayload.expireTime
      : expireTime,
    newSessionExpiresAt:
      typeof tokenPayload?.newSessionExpireTime === "string"
        ? tokenPayload.newSessionExpireTime
        : newSessionExpireTime,
    websocketEndpoint: MONA_VNEXT_LIVE_WS_ENDPOINT,
    setup,
    reportProof,
  };
  return request.activity === "roleplay"
    ? {
      ...common,
      activity: "roleplay",
      experience: experience as WindDownRoleplayDescriptor,
      journeyTargets: dependencies.journeyTargets ?? [],
      settings: { activity: "roleplay", voiceName, vadPreset },
    }
    : {
      ...common,
      activity: "live-talk",
      experience: experience as WindDownLiveTalkDescriptor,
      settings: { activity: "live-talk", voiceName, vadPreset },
    };
}

export function toWindDownVoiceSessionLogMetadata(
  session: WindDownVoiceSessionResponse,
) {
  return {
    schemaVersion: session.schemaVersion,
    policyVersion: session.policyVersion,
    activity: session.activity,
    sessionId: session.sessionId,
    conversationId: session.conversationId,
    experience: session.experience,
    settings: session.settings,
    adapter: session.adapter,
    expiresAt: session.expiresAt,
  };
}

export function getWindDownVoiceMissingEnvironment() {
  return MONA_VNEXT_GEMINI_API_KEY_ENV;
}
