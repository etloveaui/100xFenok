import {
  containsWindDownVoiceSecretLeakage,
  containsWindDownVoiceUnsafeText,
  evaluateWindDownRoleplay,
  getWindDownVoiceScenario,
  isWindDownVoiceDescriptor,
  normalizeWindDownVoiceDescriptor,
  summarizeWindDownLiveTalk,
  type WindDownVoiceActivity,
  type WindDownVoiceCorrection,
  type WindDownVoiceDescriptor,
  type WindDownVoiceFinalizedTurn,
  type WindDownVoiceGoalEvidence,
  type WindDownVoiceHighlightTurn,
} from "@/features/winddown/voice/product";

export const WIND_DOWN_VOICE_REPORT_SCHEMA_VERSION = 1 as const;
export const WIND_DOWN_VOICE_REPORT_MAX_BYTES = 48 * 1024;
export const WIND_DOWN_VOICE_REPORT_MAX_TURNS = 24;
export const WIND_DOWN_VOICE_REPORT_MAX_TURN_TEXT_CHARS = 640;
export const WIND_DOWN_VOICE_REPORT_MAX_CORRECTION_CHARS = 240;
export const WIND_DOWN_VOICE_REPORT_MAX_LATENCY_SAMPLES = 60;

export type WindDownVoiceCompletionReason =
  | "learner-stop"
  | "scenario-goals-complete"
  | "idle-timeout"
  | "session-limit"
  | "pagehide"
  | "reconnect-failed"
  | "session-error";

const COMPLETION_REASONS = new Set<WindDownVoiceCompletionReason>([
  "learner-stop",
  "scenario-goals-complete",
  "idle-timeout",
  "session-limit",
  "pagehide",
  "reconnect-failed",
  "session-error",
]);

const REPORT_METRIC_KEYS = new Set<keyof WindDownVoiceReportMetrics>([
  "sessionPostMs",
  "socketOpenMs",
  "setupDoneMs",
  "firstResponseMs",
  "lastResponseLatencyMs",
  "responseLatencySamplesMs",
  "reconnectCount",
  "audioFramesSent",
  "inputSampleRate",
  "turnCount",
  "interruptionCount",
]);
const REPORT_KEYS = new Set([
  "schemaVersion",
  "productSessionId",
  "activity",
  "descriptor",
  "conversationIds",
  "sessionProofs",
  "startedAtIso",
  "stoppedAtIso",
  "completionReason",
  "turns",
  "metrics",
  "outcome",
]);
const TURN_KEYS = new Set([
  "conversationId",
  "turnSeq",
  "userText",
  "modelText",
  "finalized",
  "sttDrift",
  "interrupted",
]);
const TURN_KEYS_WITH_CORRECTION = new Set([
  ...TURN_KEYS,
  "correctionText",
]);
const ROLEPLAY_OUTCOME_KEYS = new Set([
  "kind",
  "scenarioId",
  "goalResults",
  "evidence",
  "completed",
  "corrections",
  "nextPracticeSuggestion",
]);
const LIVE_TALK_OUTCOME_KEYS = new Set([
  "kind",
  "finalizedLearnerTurns",
  "cleanLearnerTurns",
  "highlightTurnSeqs",
  "highlightTurns",
  "durationSeconds",
  "interruptedTurnCount",
  "corrections",
]);
const GOAL_RESULT_KEYS = new Set([
  "goalId",
  "label",
  "completed",
  "evidence",
]);
const EVIDENCE_KEYS = new Set([
  "scenarioId",
  "goalId",
  "conversationId",
  "turnSeq",
  "learnerText",
  "matchedPhrase",
]);
const CORRECTION_KEYS = new Set([
  "conversationId",
  "turnSeq",
  "learnerText",
  "correctionText",
]);
const HIGHLIGHT_KEYS = new Set([
  "conversationId",
  "turnSeq",
]);

function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

export function containsWindDownVoiceReportSecretLeakage(value: string | null | undefined) {
  return containsWindDownVoiceSecretLeakage(value);
}

function containsForbiddenReportText(value: string | null | undefined) {
  return containsWindDownVoiceUnsafeText(value);
}

export function isWindDownVoiceCompletionReason(
  value: unknown,
): value is WindDownVoiceCompletionReason {
  return typeof value === "string" && COMPLETION_REASONS.has(value as WindDownVoiceCompletionReason);
}

/**
 * Metrics are observational only. The report intentionally has no card, XP,
 * reward, or SRS fields, so Live Talk cannot accidentally become a scoring
 * activity through its persistence contract.
 */
export type WindDownVoiceReportMetrics = {
  sessionPostMs?: number | null;
  socketOpenMs?: number | null;
  setupDoneMs?: number | null;
  firstResponseMs?: number | null;
  lastResponseLatencyMs?: number | null;
  responseLatencySamplesMs?: number[];
  reconnectCount?: number;
  audioFramesSent?: number;
  inputSampleRate?: number | null;
  turnCount?: number;
  interruptionCount?: number;
};

export type WindDownVoiceReportInput = {
  schemaVersion: typeof WIND_DOWN_VOICE_REPORT_SCHEMA_VERSION;
  productSessionId: string;
  activity: WindDownVoiceActivity;
  descriptor: WindDownVoiceDescriptor;
  conversationIds: string[];
  sessionProofs: string[];
  startedAtIso: string | null;
  stoppedAtIso: string;
  completionReason: WindDownVoiceCompletionReason;
  turns: readonly WindDownVoiceFinalizedTurn[];
  metrics: WindDownVoiceReportMetrics;
};

/**
 * The frozen client payload. The report route separately re-normalizes this
 * value before it writes a receipt, but retries always use this exact object.
 */
export type WindDownVoiceReport = {
  schemaVersion: typeof WIND_DOWN_VOICE_REPORT_SCHEMA_VERSION;
  productSessionId: string;
  activity: WindDownVoiceActivity;
  descriptor: WindDownVoiceDescriptor;
  conversationIds: string[];
  sessionProofs: string[];
  startedAtIso: string | null;
  stoppedAtIso: string;
  completionReason: WindDownVoiceCompletionReason;
  turns: WindDownVoiceFinalizedTurn[];
  metrics: WindDownVoiceReportMetrics;
  outcome: WindDownVoiceReportOutcome;
};

export type WindDownRoleplayGoalResult = {
  goalId: string;
  label: string;
  completed: boolean;
  evidence: WindDownVoiceGoalEvidence | null;
};

export type WindDownVoiceRoleplayOutcome = {
  kind: "roleplay";
  scenarioId: string;
  goalResults: WindDownRoleplayGoalResult[];
  evidence: WindDownVoiceGoalEvidence[];
  completed: boolean;
  corrections: WindDownVoiceCorrection[];
  nextPracticeSuggestion: WindDownRoleplayNextPracticeSuggestion;
};

export type WindDownRoleplayNextPracticeSuggestion =
  | {
      kind: "correction";
      conversationId: string;
      turnSeq: number;
      text: string;
    }
  | {
      kind: "unmet-goal";
      goalId: string;
      label: string;
      text: string;
    }
  | {
      kind: "completed-goal";
      goalId: string;
      conversationId: string;
      turnSeq: number;
      text: string;
    };

export type WindDownVoiceLiveTalkOutcome = {
  kind: "live-talk";
  finalizedLearnerTurns: number;
  cleanLearnerTurns: number;
  highlightTurnSeqs: number[];
  highlightTurns: WindDownVoiceHighlightTurn[];
  durationSeconds: number | null;
  interruptedTurnCount: number;
  corrections: WindDownVoiceCorrection[];
};

export type WindDownVoiceReportOutcome =
  | WindDownVoiceRoleplayOutcome
  | WindDownVoiceLiveTalkOutcome;

export type WindDownVoiceReportReceipt = {
  schemaVersion: 1;
  activity: WindDownVoiceActivity;
  productSessionId: string;
  finalDigest: string;
  committedAtIso: string;
  report: unknown;
};

export type WindDownVoiceReportResponse = {
  ok: true;
  duplicate: boolean;
  habitCredited: boolean;
  receipt: WindDownVoiceReportReceipt;
};

function safeIso(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function safeOptionalMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function normalizeMetrics(metrics: WindDownVoiceReportMetrics): WindDownVoiceReportMetrics {
  const sessionPostMs = safeOptionalMetric(metrics.sessionPostMs);
  const socketOpenMs = safeOptionalMetric(metrics.socketOpenMs);
  const setupDoneMs = safeOptionalMetric(metrics.setupDoneMs);
  const firstResponseMs = safeOptionalMetric(metrics.firstResponseMs);
  const lastResponseLatencyMs = safeOptionalMetric(metrics.lastResponseLatencyMs);
  const reconnectCount = safeOptionalMetric(metrics.reconnectCount);
  const audioFramesSent = safeOptionalMetric(metrics.audioFramesSent);
  const inputSampleRate = safeOptionalMetric(metrics.inputSampleRate);
  const turnCount = safeOptionalMetric(metrics.turnCount);
  const interruptionCount = safeOptionalMetric(metrics.interruptionCount);
  return {
    ...(sessionPostMs !== null ? { sessionPostMs } : {}),
    ...(socketOpenMs !== null ? { socketOpenMs } : {}),
    ...(setupDoneMs !== null ? { setupDoneMs } : {}),
    ...(firstResponseMs !== null ? { firstResponseMs } : {}),
    ...(lastResponseLatencyMs !== null ? { lastResponseLatencyMs } : {}),
    ...(Array.isArray(metrics.responseLatencySamplesMs)
      ? {
        responseLatencySamplesMs: metrics.responseLatencySamplesMs
          .map(safeOptionalMetric)
          .filter((value): value is number => value !== null),
      }
      : {}),
    ...(reconnectCount !== null ? { reconnectCount } : {}),
    ...(audioFramesSent !== null ? { audioFramesSent } : {}),
    ...(inputSampleRate !== null ? { inputSampleRate } : {}),
    ...(turnCount !== null ? { turnCount } : {}),
    ...(interruptionCount !== null ? { interruptionCount } : {}),
  };
}

function normalizeTurn(turn: WindDownVoiceFinalizedTurn): WindDownVoiceFinalizedTurn | null {
  const conversationId = typeof turn.conversationId === "string"
    ? turn.conversationId
    : "";
  if (!conversationId || !Number.isInteger(turn.turnSeq) || turn.turnSeq < 1 || turn.finalized !== true) return null;
  const userText = typeof turn.userText === "string" ? turn.userText.trim().replace(/\s+/g, " ") : null;
  const modelText = typeof turn.modelText === "string" ? turn.modelText.trim().replace(/\s+/g, " ") : null;
  if (
    (userText && containsForbiddenReportText(userText))
    || (modelText && containsForbiddenReportText(modelText))
  ) return null;
  if (!userText && !modelText) return null;
  const correctionText = typeof turn.correctionText === "string"
    ? turn.correctionText.trim().replace(/\s+/g, " ")
    : null;
  if (correctionText && containsForbiddenReportText(correctionText)) return null;
  return {
    conversationId,
    turnSeq: turn.turnSeq,
    userText,
    modelText,
    finalized: true,
    sttDrift: turn.sttDrift === true,
    interrupted: turn.interrupted === true,
    ...(correctionText ? { correctionText } : {}),
  };
}

function isSafeSessionProof(value: unknown) {
  return typeof value === "string"
    && value.length >= 80
    && value.length <= 2_048
    && /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value);
}

function isSafeMetrics(value: unknown): value is WindDownVoiceReportMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metrics = value as Record<string, unknown>;
  if (!Object.keys(metrics).every((key) =>
    REPORT_METRIC_KEYS.has(key as keyof WindDownVoiceReportMetrics))) {
    return false;
  }
  return Object.entries(metrics).every(([name, metric]) => {
    if (name === "responseLatencySamplesMs") {
      return Array.isArray(metric)
        && metric.length <= WIND_DOWN_VOICE_REPORT_MAX_LATENCY_SAMPLES
        && metric.every((sample) =>
          typeof sample === "number"
          && Number.isFinite(sample)
          && sample >= 0);
    }
    return metric === null
      || metric === undefined
      || (typeof metric === "number" && Number.isFinite(metric) && metric >= 0);
  });
}

function isCanonicalMetrics(value: unknown): value is WindDownVoiceReportMetrics {
  return isSafeMetrics(value)
    && Object.values(value as Record<string, unknown>)
      .every((metric) => metric !== undefined);
}

function buildRoleplayNextPracticeSuggestion(args: {
  scenario: NonNullable<ReturnType<typeof getWindDownVoiceScenario>>;
  evidence: readonly WindDownVoiceGoalEvidence[];
  corrections: readonly WindDownVoiceCorrection[];
}): WindDownRoleplayNextPracticeSuggestion {
  const correction = args.corrections[0];
  if (correction) {
    return {
      kind: "correction",
      conversationId: correction.conversationId,
      turnSeq: correction.turnSeq,
      text: `다음에는 “${correction.correctionText}”를 한 번 더 말해봐.`,
    };
  }
  const completedGoalIds = new Set(args.evidence.map((item) => item.goalId));
  const unmetGoal = args.scenario.goals.find((goal) => !completedGoalIds.has(goal.id));
  if (unmetGoal) {
    return {
      kind: "unmet-goal",
      goalId: unmetGoal.id,
      label: unmetGoal.label,
      text: `다음엔 “${unmetGoal.label}” 목표를 한 문장으로 말해봐.`,
    };
  }
  const evidence = args.evidence[0];
  if (!evidence) {
    throw new Error("winddown_voice_report_next_practice_unproven");
  }
  return {
    kind: "completed-goal",
    goalId: evidence.goalId,
    conversationId: evidence.conversationId,
    turnSeq: evidence.turnSeq,
    text: `“${evidence.matchedPhrase}”를 다른 표현으로 한 번 더 말해봐.`,
  };
}

function serializedByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Pure client-side payload builder. It preserves only finalized turns and
 * de-duplicates within the supplied resume-chain order. A resumed chain can
 * restart its turn number, so global numeric sorting would fabricate a false
 * chronology. The returned payload is frozen by the UI for idempotent retry.
 */
export function buildWindDownVoiceReport(
  input: WindDownVoiceReportInput,
): WindDownVoiceReport {
  if (input.schemaVersion !== WIND_DOWN_VOICE_REPORT_SCHEMA_VERSION) {
    throw new Error("winddown_voice_report_schema_invalid");
  }
  if (!isWindDownVoiceCompletionReason(input.completionReason)) {
    throw new Error("winddown_voice_report_completion_reason_invalid");
  }
  if (!isSafeProductSessionId(input.productSessionId)) {
    throw new Error("winddown_voice_report_product_session_invalid");
  }
  const descriptor = normalizeWindDownVoiceDescriptor(input.descriptor);
  if (!descriptor || descriptor.activity !== input.activity) {
    throw new Error("winddown_voice_report_descriptor_invalid");
  }
  const stoppedAtIso = safeIso(input.stoppedAtIso);
  if (!stoppedAtIso) throw new Error("winddown_voice_report_stopped_at_invalid");
  if (
    !Array.isArray(input.conversationIds)
    || input.conversationIds.length < 1
    || input.conversationIds.length > 5
    || !input.conversationIds.every(isSafeConversationId)
  ) throw new Error("winddown_voice_report_conversation_invalid");
  const conversationIds = [...new Set(input.conversationIds)];
  if (conversationIds.length === 0 || conversationIds.length > 5) {
    throw new Error("winddown_voice_report_conversation_invalid");
  }
  if (
    !Array.isArray(input.sessionProofs)
    || input.sessionProofs.length !== conversationIds.length
    || !input.sessionProofs.every(isSafeSessionProof)
  ) {
    throw new Error("winddown_voice_report_session_proof_invalid");
  }
  const sessionProofs = [...input.sessionProofs];
  if (
    !Array.isArray(input.turns)
    || input.turns.length > WIND_DOWN_VOICE_REPORT_MAX_TURNS
  ) {
    throw new Error("winddown_voice_report_turns_invalid");
  }
  if (!input.turns.every(isSafeTurn)) {
    throw new Error("winddown_voice_report_turn_invalid");
  }
  const conversationOrder = new Map(conversationIds.map((conversationId, index) => [conversationId, index]));
  if (!input.turns.every((turn) => conversationOrder.has(turn.conversationId))) {
    throw new Error("winddown_voice_report_turn_conversation_invalid");
  }

  const turnsByKey = new Map<string, WindDownVoiceFinalizedTurn>();
  for (const turn of input.turns
      .map(normalizeTurn)
      .filter((turn): turn is WindDownVoiceFinalizedTurn => Boolean(turn))
      .sort((left, right) => {
        const conversationDifference = (conversationOrder.get(left.conversationId) ?? 0)
          - (conversationOrder.get(right.conversationId) ?? 0);
        return conversationDifference || left.turnSeq - right.turnSeq;
      })) {
    turnsByKey.set(`${turn.conversationId}:${turn.turnSeq}`, turn);
  }
  const turns = [...turnsByKey.values()];
  if (turns.length > WIND_DOWN_VOICE_REPORT_MAX_TURNS) {
    throw new Error("winddown_voice_report_turns_invalid");
  }
  if (!isSafeMetrics(input.metrics)) {
    throw new Error("winddown_voice_report_metrics_invalid");
  }
  const outcome: WindDownVoiceReportOutcome = input.activity === "roleplay"
    ? (() => {
      if (descriptor.activity !== "roleplay") {
        throw new Error("winddown_voice_report_descriptor_activity_invalid");
      }
      const scenario = getWindDownVoiceScenario(descriptor.scenarioId);
      if (!scenario) throw new Error("winddown_voice_report_scenario_invalid");
      const progress = evaluateWindDownRoleplay(scenario, turns);
      return {
        kind: "roleplay" as const,
        scenarioId: scenario.id,
        goalResults: scenario.goals.map((goal) => ({
          goalId: goal.id,
          label: goal.label,
          completed: progress.completedGoalIds.includes(goal.id),
          evidence: progress.evidence.find((item) => item.goalId === goal.id) ?? null,
        })),
        evidence: progress.evidence,
        completed: progress.completed,
        corrections: progress.corrections,
        nextPracticeSuggestion: buildRoleplayNextPracticeSuggestion({
          scenario,
          evidence: progress.evidence,
          corrections: progress.corrections,
        }),
      };
    })()
    : (() => {
      const summary = summarizeWindDownLiveTalk({
        turns,
        startedAtIso: safeIso(input.startedAtIso),
        endedAtIso: stoppedAtIso,
      });
      return {
        kind: "live-talk" as const,
        finalizedLearnerTurns: summary.finalizedLearnerTurns,
        cleanLearnerTurns: summary.cleanLearnerTurns,
        highlightTurnSeqs: summary.highlightTurnSeqs,
        highlightTurns: summary.highlightTurns,
        durationSeconds: summary.durationSeconds,
        interruptedTurnCount: summary.interruptedTurnCount,
        corrections: summary.corrections,
      };
    })();

  if (input.activity === "live-talk" && input.completionReason === "scenario-goals-complete") {
    throw new Error("winddown_voice_report_live_talk_completion_invalid");
  }
  if (
    input.activity === "roleplay"
    && input.completionReason === "scenario-goals-complete"
    && (!outcome || outcome.kind !== "roleplay" || outcome.completed !== true)
  ) {
    throw new Error("winddown_voice_report_roleplay_completion_unproven");
  }

  const report: WindDownVoiceReport = {
    schemaVersion: WIND_DOWN_VOICE_REPORT_SCHEMA_VERSION,
    productSessionId: input.productSessionId,
    activity: input.activity,
    descriptor,
    conversationIds,
    sessionProofs,
    startedAtIso: safeIso(input.startedAtIso),
    stoppedAtIso,
    completionReason: input.completionReason,
    turns,
    metrics: normalizeMetrics(input.metrics),
    outcome,
  };
  if (serializedByteLength(report) > WIND_DOWN_VOICE_REPORT_MAX_BYTES) {
    throw new Error("winddown_voice_report_too_large");
  }
  return report;
}

function isSafeConversationId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(value);
}

function isSafeProductSessionId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{8,120}$/.test(value);
}

function isSafeTurn(value: unknown): value is WindDownVoiceFinalizedTurn {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (!Object.keys(source).every((key) =>
    TURN_KEYS_WITH_CORRECTION.has(key))) return false;
  const turn = value as Partial<WindDownVoiceFinalizedTurn>;
  if (
    !isSafeConversationId(turn.conversationId)
    || !Number.isInteger(turn.turnSeq)
    || !turn.turnSeq || turn.turnSeq < 1
    || turn.finalized !== true
    || typeof turn.sttDrift !== "boolean"
    || typeof turn.interrupted !== "boolean"
  ) return false;
  for (const text of [turn.userText, turn.modelText, turn.correctionText]) {
    if (text !== null && text !== undefined && typeof text !== "string") return false;
    if (typeof text === "string" && containsForbiddenReportText(text)) return false;
  }
  if (
    (typeof turn.userText === "string"
      && turn.userText.length > WIND_DOWN_VOICE_REPORT_MAX_TURN_TEXT_CHARS)
    || (typeof turn.modelText === "string"
      && turn.modelText.length > WIND_DOWN_VOICE_REPORT_MAX_TURN_TEXT_CHARS)
    || (typeof turn.correctionText === "string"
      && turn.correctionText.length > WIND_DOWN_VOICE_REPORT_MAX_CORRECTION_CHARS)
  ) return false;
  return Boolean(turn.userText || turn.modelText);
}

function isCanonicalTurn(value: unknown): value is WindDownVoiceFinalizedTurn {
  if (!isSafeTurn(value)) return false;
  const source = value as unknown as Record<string, unknown>;
  const expected = source.correctionText === undefined
    ? TURN_KEYS
    : TURN_KEYS_WITH_CORRECTION;
  return hasExactKeys(source, expected)
    && source.userText !== undefined
    && source.modelText !== undefined;
}

function sameEvidence(
  actual: unknown,
  expected: WindDownVoiceGoalEvidence | null,
) {
  if (expected === null) return actual === null;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  if (!hasExactKeys(actual as Record<string, unknown>, EVIDENCE_KEYS)) return false;
  const value = actual as Partial<WindDownVoiceGoalEvidence>;
  return value.scenarioId === expected.scenarioId
    && value.goalId === expected.goalId
    && value.conversationId === expected.conversationId
    && value.turnSeq === expected.turnSeq
    && value.learnerText === expected.learnerText
    && value.matchedPhrase === expected.matchedPhrase;
}

function sameCorrections(
  actual: unknown,
  expected: readonly WindDownVoiceCorrection[],
) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => {
      const candidate = value as Partial<WindDownVoiceCorrection>;
      const target = expected[index];
      return Boolean(candidate)
        && typeof candidate === "object"
        && !Array.isArray(candidate)
        && hasExactKeys(
          candidate as unknown as Record<string, unknown>,
          CORRECTION_KEYS,
        )
        && candidate.conversationId === target.conversationId
        && candidate.turnSeq === target.turnSeq
        && candidate.learnerText === target.learnerText
        && candidate.correctionText === target.correctionText;
    });
}

function sameNextPracticeSuggestion(
  actual: unknown,
  expected: WindDownRoleplayNextPracticeSuggestion,
) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const candidate = actual as Record<string, unknown>;
  const expectedRecord = expected as unknown as Record<string, unknown>;
  const actualKeys = Object.keys(candidate);
  const expectedKeys = Object.keys(expectedRecord);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => candidate[key] === expectedRecord[key]);
}

function isSafeRoleplayOutcome(
  value: unknown,
  descriptor: WindDownVoiceDescriptor,
  turns: readonly WindDownVoiceFinalizedTurn[],
) {
  if (!value || typeof value !== "object" || Array.isArray(value) || descriptor.activity !== "roleplay") return false;
  if (!hasExactKeys(value as Record<string, unknown>, ROLEPLAY_OUTCOME_KEYS)) return false;
  const scenario = getWindDownVoiceScenario(descriptor.scenarioId);
  if (!scenario) return false;
  const outcome = value as Partial<WindDownVoiceRoleplayOutcome>;
  const progress = evaluateWindDownRoleplay(scenario, turns);
  const expectedGoals = scenario.goals.map((goal) => {
    const evidence = progress.evidence.find((item) => item.goalId === goal.id) ?? null;
    return { goal, evidence };
  });
  return outcome.kind === "roleplay"
    && outcome.scenarioId === scenario.id
    && outcome.completed === progress.completed
    && Array.isArray(outcome.goalResults)
    && outcome.goalResults.length === expectedGoals.length
    && outcome.goalResults.every((candidate, index) => {
      const expected = expectedGoals[index];
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      if (!hasExactKeys(candidate as Record<string, unknown>, GOAL_RESULT_KEYS)) return false;
      const goal = candidate as Partial<WindDownRoleplayGoalResult>;
      return goal.goalId === expected.goal.id
        && goal.label === expected.goal.label
        && goal.completed === Boolean(expected.evidence)
        && sameEvidence(goal.evidence, expected.evidence);
    })
    && Array.isArray(outcome.evidence)
    && outcome.evidence.length === progress.evidence.length
    && outcome.evidence.every((candidate, index) => sameEvidence(candidate, progress.evidence[index]))
    && sameCorrections(outcome.corrections, progress.corrections)
    && sameNextPracticeSuggestion(
      outcome.nextPracticeSuggestion,
      buildRoleplayNextPracticeSuggestion({
        scenario,
        evidence: progress.evidence,
        corrections: progress.corrections,
      }),
    );
}

function isSafeLiveTalkOutcome(
  value: unknown,
  turns: readonly WindDownVoiceFinalizedTurn[],
  startedAtIso: string | null | undefined,
  stoppedAtIso: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!hasExactKeys(value as Record<string, unknown>, LIVE_TALK_OUTCOME_KEYS)) return false;
  const outcome = value as Partial<WindDownVoiceLiveTalkOutcome>;
  const summary = summarizeWindDownLiveTalk({ turns, startedAtIso, endedAtIso: stoppedAtIso });
  return outcome.kind === "live-talk"
    && outcome.finalizedLearnerTurns === summary.finalizedLearnerTurns
    && outcome.cleanLearnerTurns === summary.cleanLearnerTurns
    && outcome.interruptedTurnCount === summary.interruptedTurnCount
    && outcome.durationSeconds === summary.durationSeconds
    && Array.isArray(outcome.highlightTurnSeqs)
    && outcome.highlightTurnSeqs.length === summary.highlightTurnSeqs.length
    && outcome.highlightTurnSeqs.every((turnSeq, index) => turnSeq === summary.highlightTurnSeqs[index])
    && Array.isArray(outcome.highlightTurns)
    && outcome.highlightTurns.length === summary.highlightTurns.length
    && outcome.highlightTurns.every((turn, index) => {
      const expected = summary.highlightTurns[index];
      const candidate = turn as Partial<WindDownVoiceHighlightTurn>;
      return Boolean(candidate)
        && typeof candidate === "object"
        && !Array.isArray(candidate)
        && hasExactKeys(
          candidate as unknown as Record<string, unknown>,
          HIGHLIGHT_KEYS,
        )
        && candidate.conversationId === expected.conversationId
        && candidate.turnSeq === expected.turnSeq;
    })
    && sameCorrections(outcome.corrections, summary.corrections);
}

function hasActivityCompatibleCompletion(
  activity: WindDownVoiceActivity,
  completionReason: WindDownVoiceCompletionReason,
  outcome: WindDownVoiceReportOutcome,
) {
  if (activity === "live-talk") return completionReason !== "scenario-goals-complete";
  if (completionReason !== "scenario-goals-complete") return true;
  return outcome.kind === "roleplay" && outcome.completed === true;
}

export function isWindDownVoiceReport(value: unknown): value is WindDownVoiceReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!hasExactKeys(value as Record<string, unknown>, REPORT_KEYS)) return false;
  const report = value as Partial<WindDownVoiceReport>;
  if (
    report.schemaVersion !== WIND_DOWN_VOICE_REPORT_SCHEMA_VERSION
    || !isSafeProductSessionId(report.productSessionId)
    || (report.activity !== "roleplay" && report.activity !== "live-talk")
    || !isWindDownVoiceDescriptor(report.descriptor)
    || report.descriptor.activity !== report.activity
    || !Array.isArray(report.conversationIds)
    || report.conversationIds.length < 1
    || report.conversationIds.length > 5
    || !report.conversationIds.every(isSafeConversationId)
    || new Set(report.conversationIds).size !== report.conversationIds.length
    || !Array.isArray(report.sessionProofs)
    || report.sessionProofs.length !== report.conversationIds.length
    || !report.sessionProofs.every(isSafeSessionProof)
    || typeof report.stoppedAtIso !== "string"
    || !Number.isFinite(Date.parse(report.stoppedAtIso))
    || (report.startedAtIso !== null
      && (typeof report.startedAtIso !== "string"
        || !Number.isFinite(Date.parse(report.startedAtIso))))
    || !isWindDownVoiceCompletionReason(report.completionReason)
    || !Array.isArray(report.turns)
    || report.turns.length > WIND_DOWN_VOICE_REPORT_MAX_TURNS
    || !report.turns.every(isCanonicalTurn)
    || !isCanonicalMetrics(report.metrics)
    || serializedByteLength(report) > WIND_DOWN_VOICE_REPORT_MAX_BYTES
  ) return false;
  const conversationIds = report.conversationIds as string[];
  const turns = report.turns as WindDownVoiceFinalizedTurn[];
  const descriptor = report.descriptor as WindDownVoiceDescriptor;
  const outcome = report.outcome as WindDownVoiceReportOutcome;
  const completionReason = report.completionReason as WindDownVoiceCompletionReason;
  const stoppedAtIso = report.stoppedAtIso as string;
  if (
    !turns.every((turn) => conversationIds.includes(turn.conversationId))
    || (report.activity === "roleplay"
      ? !isSafeRoleplayOutcome(outcome, descriptor, turns)
      : !isSafeLiveTalkOutcome(outcome, turns, report.startedAtIso, stoppedAtIso))
    || !hasActivityCompatibleCompletion(report.activity, completionReason, outcome)
  ) return false;
  return true;
}

export function isWindDownVoiceReportResponse(value: unknown): value is WindDownVoiceReportResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  const receipt = response.receipt;
  return response.ok === true
    && typeof response.duplicate === "boolean"
    && typeof response.habitCredited === "boolean"
    && Boolean(receipt)
    && typeof receipt === "object"
    && !Array.isArray(receipt)
    && (receipt as Record<string, unknown>).schemaVersion === 1
    && typeof (receipt as Record<string, unknown>).productSessionId === "string"
    && typeof (receipt as Record<string, unknown>).finalDigest === "string"
    && typeof (receipt as Record<string, unknown>).committedAtIso === "string";
}
