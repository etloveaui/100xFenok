import {
  WIND_DOWN_LIVE_TALK_TOPICS,
  WIND_DOWN_VOICE_POLICY_VERSION,
  getWindDownLiveTalkTopic,
  getWindDownVoiceScenario,
  isWindDownVoiceScenarioId,
  isWindDownVoiceTopicId,
  type WindDownVoiceActivity as ProductWindDownVoiceActivity,
  type WindDownVoiceScenarioId,
  type WindDownVoiceTopicId,
} from "@/features/winddown/voice/product";
import {
  normalizeWindDownVoiceJourneyTargets,
  type WindDownVoiceJourneyTarget,
} from "@/features/winddown/voice/journeyTarget";

export const WIND_DOWN_VOICE_SESSION_ENDPOINT = "/api/winddown/live/session/" as const;
export const WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION = 1 as const;
export {
  WIND_DOWN_LIVE_TALK_TOPICS,
  WIND_DOWN_VOICE_POLICY_VERSION,
};

export type WindDownVoiceActivity = ProductWindDownVoiceActivity;
export type { WindDownVoiceScenarioId };
export type WindDownLiveTalkTopicId = WindDownVoiceTopicId;
export type WindDownVoiceName =
  | "Kore"
  | "Aoede"
  | "Puck"
  | "Charon"
  | "Achernar";
export type WindDownVoiceVadPreset = "relaxed" | "balanced";

type CommonRequest = {
  schemaVersion: typeof WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION;
  productSessionId: string;
  voiceName?: WindDownVoiceName;
  vadPreset?: WindDownVoiceVadPreset;
  resumedFromConversationId?: string;
};

export type WindDownRoleplaySessionRequest = CommonRequest & {
  activity: "roleplay";
  scenarioId: WindDownVoiceScenarioId;
  policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
};

export type WindDownLiveTalkSessionRequest = CommonRequest & {
  activity: "live-talk";
  topicId: WindDownLiveTalkTopicId;
  policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
};

export type WindDownVoiceSessionRequest =
  | WindDownRoleplaySessionRequest
  | WindDownLiveTalkSessionRequest;

export type WindDownRoleplayDescriptor = {
  kind: "scenario";
  scenarioId: WindDownVoiceScenarioId;
  policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
  title: string;
  scene: string;
  coachRole: string;
  openingLine: string;
  goals: readonly { id: string; label: string }[];
};

export type WindDownLiveTalkDescriptor = {
  kind: "topic";
  topicId: WindDownLiveTalkTopicId;
  policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
  title: string;
  scene: string;
  coachRole: string;
  openingLine: string;
};

type CommonResponse = {
  schemaVersion: typeof WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION;
  policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
  productSessionId: string;
  sessionId: string;
  conversationId: string;
  resumedFromConversationId?: string;
  status: "LIVE_TOKEN_READY";
  startedAt: string;
  adapter: "gemini-live-ephemeral-winddown";
  token: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  websocketEndpoint: string;
  setup: Record<string, unknown>;
  /** Opaque server signature authorizing this conversation in one final report. */
  reportProof: string;
};

export type WindDownRoleplaySessionResponse = CommonResponse & {
  activity: "roleplay";
  experience: WindDownRoleplayDescriptor;
  journeyTargets: WindDownVoiceJourneyTarget[];
  settings: {
    activity: "roleplay";
    voiceName: WindDownVoiceName;
    vadPreset: WindDownVoiceVadPreset;
  };
};

export type WindDownLiveTalkSessionResponse = CommonResponse & {
  activity: "live-talk";
  experience: WindDownLiveTalkDescriptor;
  settings: {
    activity: "live-talk";
    voiceName: WindDownVoiceName;
    vadPreset: WindDownVoiceVadPreset;
  };
};

export type WindDownVoiceSessionResponse =
  | WindDownRoleplaySessionResponse
  | WindDownLiveTalkSessionResponse;

export class WindDownVoiceSessionRequestError extends Error {
  readonly status = 400;
  readonly code = "INVALID_WINDDOWN_VOICE_SESSION_REQUEST";

  constructor(readonly reason: string) {
    super("INVALID_WINDDOWN_VOICE_SESSION_REQUEST");
    this.name = "WindDownVoiceSessionRequestError";
  }
}

const COMMON_KEYS = new Set([
  "schemaVersion",
  "activity",
  "policyVersion",
  "productSessionId",
  "voiceName",
  "vadPreset",
  "resumedFromConversationId",
]);
const ROLEPLAY_KEYS = new Set([...COMMON_KEYS, "scenarioId"]);
const LIVE_TALK_KEYS = new Set([...COMMON_KEYS, "topicId"]);
const VOICE_NAMES = new Set<WindDownVoiceName>([
  "Kore",
  "Aoede",
  "Puck",
  "Charon",
  "Achernar",
]);

function fail(reason: string): never {
  throw new WindDownVoiceSessionRequestError(reason);
}

function parseCommon(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
) {
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknownKey) fail(`UNKNOWN_FIELD:${unknownKey}`);
  if (record.schemaVersion !== WIND_DOWN_VOICE_SESSION_SCHEMA_VERSION) {
    fail("SCHEMA_VERSION");
  }
  if (record.policyVersion !== WIND_DOWN_VOICE_POLICY_VERSION) {
    fail("POLICY_VERSION");
  }
  if (
    typeof record.productSessionId !== "string"
    || !/^[A-Za-z0-9._-]{8,120}$/.test(record.productSessionId)
  ) {
    fail("PRODUCT_SESSION_ID");
  }
  if (record.voiceName !== undefined && !VOICE_NAMES.has(record.voiceName as WindDownVoiceName)) {
    fail("VOICE_NAME");
  }
  if (record.vadPreset !== undefined && record.vadPreset !== "relaxed" && record.vadPreset !== "balanced") {
    fail("VAD_PRESET");
  }
  if (record.resumedFromConversationId !== undefined) {
    if (
      typeof record.resumedFromConversationId !== "string"
      || !/^[A-Za-z0-9._-]{1,110}$/.test(record.resumedFromConversationId)
    ) {
      fail("RESUMED_CONVERSATION_ID");
    }
  }
  return {
    productSessionId: record.productSessionId,
    ...(record.voiceName ? { voiceName: record.voiceName as WindDownVoiceName } : {}),
    ...(record.vadPreset ? { vadPreset: record.vadPreset as WindDownVoiceVadPreset } : {}),
    ...(record.resumedFromConversationId
      ? { resumedFromConversationId: record.resumedFromConversationId as string }
      : {}),
  };
}

export function parseWindDownVoiceSessionRequest(
  value: unknown,
): WindDownVoiceSessionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("BODY");
  }
  const record = value as Record<string, unknown>;
  if (record.activity === "roleplay") {
    const common = parseCommon(record, ROLEPLAY_KEYS);
    if (!isWindDownVoiceScenarioId(record.scenarioId)) {
      return fail("SCENARIO_ID");
    }
    return {
      schemaVersion: 1,
      activity: "roleplay",
      scenarioId: record.scenarioId,
      policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
      ...common,
    };
  }
  if (record.activity === "live-talk") {
    const common = parseCommon(record, LIVE_TALK_KEYS);
    if (!isWindDownVoiceTopicId(record.topicId)) {
      return fail("TOPIC_ID");
    }
    return {
      schemaVersion: 1,
      activity: "live-talk",
      topicId: record.topicId,
      policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
      ...common,
    };
  }
  return fail("ACTIVITY");
}

export function isWindDownVoiceSessionResponse(
  value: unknown,
): value is WindDownVoiceSessionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const safeId = (candidate: unknown) =>
    typeof candidate === "string"
    && /^[A-Za-z0-9._-]{1,180}$/.test(candidate);
  const safeProductSessionId = (candidate: unknown) =>
    typeof candidate === "string"
    && /^[A-Za-z0-9._-]{8,120}$/.test(candidate);
  const nonempty = (candidate: unknown) =>
    typeof candidate === "string" && candidate.trim().length > 0;
  const safeToken = (candidate: unknown) =>
    typeof candidate === "string"
    && candidate.length > 0
    && candidate.length <= 4096
    && !/\s/.test(candidate);
  const safeReportProof = (candidate: unknown) =>
    typeof candidate === "string"
    && candidate.length >= 80
    && candidate.length <= 2048
    && /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(candidate);
  const iso = (candidate: unknown) =>
    typeof candidate === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(candidate)
    && Number.isFinite(Date.parse(candidate));
  const setup = record.setup;
  const settings = record.settings;
  const experience = record.experience;
  const journeyTargets = normalizeWindDownVoiceJourneyTargets(
    record.journeyTargets,
  );
  if (
    record.schemaVersion !== 1
    || record.policyVersion !== 1
    || record.status !== "LIVE_TOKEN_READY"
    || record.adapter !== "gemini-live-ephemeral-winddown"
    || !safeId(record.sessionId)
    || !safeProductSessionId(record.productSessionId)
    || !safeId(record.conversationId)
    || (
      record.resumedFromConversationId !== undefined
      && !safeId(record.resumedFromConversationId)
    )
    || !safeToken(record.token)
    || !safeReportProof(record.reportProof)
    || typeof record.websocketEndpoint !== "string"
    || !record.websocketEndpoint.startsWith("wss://")
    || !iso(record.startedAt)
    || !iso(record.expiresAt)
    || !iso(record.newSessionExpiresAt)
    || !setup
    || typeof setup !== "object"
    || Array.isArray(setup)
    || !experience
    || typeof experience !== "object"
    || Array.isArray(experience)
    || !settings
    || typeof settings !== "object"
    || Array.isArray(settings)
  ) {
    return false;
  }
  const startedAtMs = Date.parse(record.startedAt as string);
  const expiresAtMs = Date.parse(record.expiresAt as string);
  const newSessionExpiresAtMs = Date.parse(
    record.newSessionExpiresAt as string,
  );
  if (
    newSessionExpiresAtMs < startedAtMs
    || expiresAtMs < newSessionExpiresAtMs
  ) {
    return false;
  }
  const responseSettings = settings as Record<string, unknown>;
  if (
    !VOICE_NAMES.has(responseSettings.voiceName as WindDownVoiceName)
    || (
      responseSettings.vadPreset !== "relaxed"
      && responseSettings.vadPreset !== "balanced"
    )
  ) {
    return false;
  }
  const responseExperience = experience as Record<string, unknown>;
  if (
    !nonempty(responseExperience.title)
    || !nonempty(responseExperience.scene)
    || !nonempty(responseExperience.coachRole)
    || !nonempty(responseExperience.openingLine)
  ) {
    return false;
  }
  if (record.activity === "roleplay") {
    if (
      !journeyTargets
      || responseExperience.kind !== "scenario"
      || responseExperience.policyVersion !== WIND_DOWN_VOICE_POLICY_VERSION
      || !isWindDownVoiceScenarioId(responseExperience.scenarioId)
      || !Array.isArray(responseExperience.goals)
      || responseSettings.activity !== "roleplay"
    ) {
      return false;
    }
    const scenario = getWindDownVoiceScenario(responseExperience.scenarioId);
    const goals = responseExperience.goals as Record<string, unknown>[];
    const prefix = `winddown-roleplay-${responseExperience.scenarioId}-`;
    return Boolean(scenario)
      && responseExperience.title === scenario?.title
      && responseExperience.scene === scenario?.scene
      && responseExperience.coachRole === scenario?.coachRole
      && responseExperience.openingLine === scenario?.openingLine
      && goals.length === scenario?.goals.length
      && goals.every((goal, index) =>
        goal?.id === scenario?.goals[index]?.id
        && goal?.label === scenario?.goals[index]?.label)
      && (record.sessionId as string).startsWith(prefix)
      && (record.conversationId as string).startsWith(prefix)
      && (
        record.resumedFromConversationId === undefined
        || (record.resumedFromConversationId as string).startsWith(prefix)
      );
  }
  if (
    record.activity !== "live-talk"
    || record.journeyTargets !== undefined
    || responseExperience.kind !== "topic"
    || responseExperience.policyVersion !== WIND_DOWN_VOICE_POLICY_VERSION
    || !isWindDownVoiceTopicId(responseExperience.topicId)
    || responseSettings.activity !== "live-talk"
  ) {
    return false;
  }
  const topic = getWindDownLiveTalkTopic(responseExperience.topicId);
  const prefix = `winddown-live-talk-${responseExperience.topicId}-`;
  return Boolean(topic)
    && responseExperience.title === topic?.title
    && responseExperience.scene === topic?.scene
    && responseExperience.coachRole === topic?.coachRole
    && responseExperience.openingLine === topic?.openingLine
    && (record.sessionId as string).startsWith(prefix)
    && (record.conversationId as string).startsWith(prefix)
    && (
      record.resumedFromConversationId === undefined
      || (record.resumedFromConversationId as string).startsWith(prefix)
    );
}
