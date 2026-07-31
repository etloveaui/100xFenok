import { containsMonaVnextControlLeakage } from "@/features/mona-vnext/logging/voiceLogSchema";

export const WIND_DOWN_VOICE_POLICY_VERSION = 1 as const;
/** @deprecated Prefer WIND_DOWN_VOICE_POLICY_VERSION in new transport code. */
export const WINDDOWN_VOICE_PRODUCT_VERSION = WIND_DOWN_VOICE_POLICY_VERSION;

export type WindDownVoiceActivity = "roleplay" | "live-talk";

export type WindDownVoiceScenarioGoal = {
  id: string;
  label: string;
  /**
   * These are stable, server-owned matching phrases, not prompt text supplied
   * by the browser. A learner needs one phrase from each goal in a clean,
   * finalized utterance for the app to count the goal.
   */
  matchAny: readonly string[];
};

export type WindDownVoiceScenario = {
  id: string;
  version: typeof WIND_DOWN_VOICE_POLICY_VERSION;
  title: string;
  eyebrow: string;
  scene: string;
  coachRole: string;
  openingLine: string;
  goals: readonly WindDownVoiceScenarioGoal[];
};

/**
 * The client sends only this identifier/version to the session transport.
 * The server must resolve the matching prompt and never accept client prompt
 * text as a system instruction.
 */
export type WindDownVoiceScenarioRequest = {
  scenarioId: string;
  policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
};

export type WindDownVoiceFinalizedTurn = {
  conversationId: string;
  turnSeq: number;
  userText: string | null;
  modelText: string | null;
  /** A partial STT update is never eligible for scenario completion. */
  finalized: boolean;
  sttDrift: boolean;
  interrupted: boolean;
  /**
   * Optional provider/coach correction. It is retained only when it is a
   * literal excerpt of the finalized coach transcript for the same turn.
   */
  correctionText?: string | null;
};

export type WindDownVoiceGoalEvidence = {
  scenarioId: string;
  goalId: string;
  conversationId: string;
  turnSeq: number;
  learnerText: string;
  matchedPhrase: string;
};

export type WindDownVoiceCorrection = {
  conversationId: string;
  turnSeq: number;
  learnerText: string;
  correctionText: string;
};

/**
 * A resumed Live Talk chain can restart its numeric turn sequence. Keep the
 * conversation identity beside a highlight so the saved reference cannot
 * accidentally point at a similarly numbered turn in an older chain.
 */
export type WindDownVoiceHighlightTurn = {
  conversationId: string;
  turnSeq: number;
};

export type WindDownRoleplayProgress = {
  scenario: WindDownVoiceScenario;
  completedGoalIds: string[];
  evidence: WindDownVoiceGoalEvidence[];
  corrections: WindDownVoiceCorrection[];
  completed: boolean;
};

export type WindDownLiveTalkSummary = {
  activity: "live-talk";
  finalizedLearnerTurns: number;
  cleanLearnerTurns: number;
  /** Clean turns with both speaker transcripts, newest last. */
  highlightTurnSeqs: number[];
  highlightTurns: WindDownVoiceHighlightTurn[];
  interruptedTurnCount: number;
  durationSeconds: number | null;
  corrections: WindDownVoiceCorrection[];
};

const SCENARIOS = [
  {
    id: "cafe-order",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "카페에서 주문하기",
    eyebrow: "ROLEPLAY · 3 GOALS",
    scene: "루미는 바리스타예요. 음료를 주문하고, 취향을 말하고, 자연스럽게 마무리해봐요.",
    coachRole: "friendly cafe barista",
    openingLine: "Hi! What can I get for you tonight?",
    goals: [
      {
        id: "order",
        label: "음료를 주문했어",
        matchAny: ["i'd like", "i would like", "can i get", "could i get", "i'll have"],
      },
      {
        id: "preference",
        label: "내 취향을 말했어",
        matchAny: ["with oat milk", "with soy milk", "without ice", "less sweet", "decaf"],
      },
      {
        id: "close",
        label: "주문을 마무리했어",
        matchAny: ["that's all", "that will be all", "thank you", "thanks"],
      },
    ],
  },
  {
    id: "after-work-check-in",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "퇴근 후 안부",
    eyebrow: "ROLEPLAY · 3 GOALS",
    scene: "루미는 하루를 함께 정리하는 친구예요. 오늘의 기분과 이유, 내일의 작은 계획을 말해봐요.",
    coachRole: "warm after-work friend",
    openingLine: "How did your day go?",
    goals: [
      {
        id: "feeling",
        label: "오늘의 기분을 말했어",
        matchAny: ["i feel", "i felt", "i'm feeling", "i was"],
      },
      {
        id: "reason",
        label: "이유를 덧붙였어",
        matchAny: ["because", "since", "so", "it was"],
      },
      {
        id: "next-step",
        label: "내일의 작은 계획을 말했어",
        matchAny: ["tomorrow i'll", "tomorrow i will", "i'm going to", "i want to"],
      },
    ],
  },
] as const satisfies readonly WindDownVoiceScenario[];

export const WINDDOWN_VOICE_SCENARIOS = SCENARIOS;

export type WindDownVoiceScenarioId = (typeof SCENARIOS)[number]["id"];

export type WindDownVoiceTopic = {
  id: string;
  version: typeof WIND_DOWN_VOICE_POLICY_VERSION;
  title: string;
  eyebrow: string;
  scene: string;
  coachRole: string;
  openingLine: string;
};

/**
 * Live Talk has fixed conversation topics, not a free-form browser prompt.
 * There are deliberately no goal/card/reward fields here: its only completion
 * path is an explicit learner stop.
 */
const LIVE_TALK_TOPICS = [
  {
    id: "open-evening",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "오늘을 천천히 풀기",
    eyebrow: "LIVE TALK · OPEN CONVERSATION",
    scene: "오늘 있었던 일을 편안하게 이야기해요. 루미는 짧고 자연스럽게만 이어가요.",
    coachRole: "calm conversation partner",
    openingLine: "What would you like to talk about tonight?",
  },
  {
    id: "day-reflection",
    version: WIND_DOWN_VOICE_POLICY_VERSION,
    title: "오늘의 한 장면",
    eyebrow: "LIVE TALK · OPEN CONVERSATION",
    scene: "오늘 마음에 남은 한 장면을 가볍게 이야기해요. 목표나 점수 없이 대화를 이어가요.",
    coachRole: "encouraging conversation partner",
    openingLine: "What is one moment from today that stayed with you?",
  },
] as const satisfies readonly WindDownVoiceTopic[];

export const WIND_DOWN_LIVE_TALK_TOPICS = LIVE_TALK_TOPICS;
/** @deprecated Prefer WIND_DOWN_LIVE_TALK_TOPICS in new transport code. */
export const WINDDOWN_LIVE_TALK_TOPICS = WIND_DOWN_LIVE_TALK_TOPICS;
export type WindDownVoiceTopicId = (typeof LIVE_TALK_TOPICS)[number]["id"];

/**
 * This descriptor is the complete client-to-server policy selection. It is
 * intentionally identifiers-only: the server resolves all role/prompt text
 * from the same catalog and rejects an unknown or mismatched version.
 */
export type WindDownVoiceDescriptor =
  | {
      activity: "roleplay";
      scenarioId: WindDownVoiceScenarioId;
      topicId?: never;
      policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
    }
  | {
      activity: "live-talk";
      topicId: WindDownVoiceTopicId;
      scenarioId?: never;
      policyVersion: typeof WIND_DOWN_VOICE_POLICY_VERSION;
    };

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
}

function cleanText(value: string | null | undefined, limit = 280) {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, limit) : null;
}

const VOICE_SECRET_LEAKAGE_PATTERNS = [
  /\baccess_token\b/i,
  /\bx-goog-api-key\b/i,
  /\bauth_tokens\b/i,
  /\bGEMINI_API_KEY\b/i,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bbearer\s+[A-Za-z0-9._~+\/-]{24,}\b/i,
  /\b(?:access[ _-]?token|api[ _-]?key|token)\s*[:=]\s*[A-Za-z0-9._~+\/-]{24,}\b/i,
];

export function containsWindDownVoiceSecretLeakage(value: string | null | undefined) {
  return VOICE_SECRET_LEAKAGE_PATTERNS.some((pattern) => pattern.test(value ?? ""));
}

/** Shared browser/server guard for transcript-derived product state. */
export function containsWindDownVoiceUnsafeText(value: string | null | undefined) {
  return containsMonaVnextControlLeakage(value) || containsWindDownVoiceSecretLeakage(value);
}

function isCleanLearnerTurn(turn: WindDownVoiceFinalizedTurn) {
  const learnerText = cleanText(turn.userText);
  const modelText = cleanText(turn.modelText);
  return turn.finalized === true
    && turn.sttDrift !== true
    && turn.interrupted !== true
    && typeof turn.conversationId === "string"
    && Boolean(turn.conversationId.trim())
    && Number.isInteger(turn.turnSeq)
    && turn.turnSeq > 0
    && Boolean(learnerText)
    && !containsWindDownVoiceUnsafeText(learnerText)
    && (!modelText || !containsWindDownVoiceUnsafeText(modelText));
}

function phraseMatches(text: string, phrase: string) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}(?=$|[^a-z])`, "i").test(text);
}

function correctionFromTurn(turn: WindDownVoiceFinalizedTurn): WindDownVoiceCorrection | null {
  if (!isCleanLearnerTurn(turn)) return null;
  const learnerText = cleanText(turn.userText);
  const modelText = cleanText(turn.modelText, 560);
  const correctionText = cleanText(turn.correctionText, 360);
  if (!learnerText || !modelText || !correctionText) return null;
  if (
    containsWindDownVoiceUnsafeText(learnerText)
    || containsWindDownVoiceUnsafeText(modelText)
    || containsWindDownVoiceUnsafeText(correctionText)
  ) return null;
  if (!normalizeText(modelText).includes(normalizeText(correctionText))) return null;
  return {
    conversationId: turn.conversationId.trim(),
    turnSeq: turn.turnSeq,
    learnerText,
    correctionText,
  };
}

function dedupeCorrections(turns: readonly WindDownVoiceFinalizedTurn[]) {
  const seen = new Set<string>();
  return turns.flatMap((turn) => {
    const correction = correctionFromTurn(turn);
    if (!correction) return [];
    const key = `${correction.conversationId}:${correction.turnSeq}:${normalizeText(correction.correctionText)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [correction];
  });
}

export function getWindDownVoiceScenario(id: string | null | undefined) {
  return WINDDOWN_VOICE_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

export function getWindDownLiveTalkTopic(id: string | null | undefined) {
  return WIND_DOWN_LIVE_TALK_TOPICS.find((topic) => topic.id === id) ?? null;
}

export function isWindDownVoiceScenarioId(value: unknown): value is WindDownVoiceScenarioId {
  return typeof value === "string" && getWindDownVoiceScenario(value) !== null;
}

export function isWindDownVoiceTopicId(value: unknown): value is WindDownVoiceTopicId {
  return typeof value === "string" && getWindDownLiveTalkTopic(value) !== null;
}

export function createWindDownRoleplayDescriptor(
  scenarioId: WindDownVoiceScenarioId,
): WindDownVoiceDescriptor {
  return {
    activity: "roleplay",
    scenarioId,
    policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
  };
}

export function createWindDownLiveTalkDescriptor(
  topicId: WindDownVoiceTopicId,
): WindDownVoiceDescriptor {
  return {
    activity: "live-talk",
    topicId,
    policyVersion: WIND_DOWN_VOICE_POLICY_VERSION,
  };
}

const ROLEPLAY_DESCRIPTOR_KEYS = new Set([
  "activity",
  "policyVersion",
  "scenarioId",
]);
const LIVE_TALK_DESCRIPTOR_KEYS = new Set([
  "activity",
  "policyVersion",
  "topicId",
]);

function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

export function isWindDownVoiceDescriptor(value: unknown): value is WindDownVoiceDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = value as Record<string, unknown>;
  if (descriptor.policyVersion !== WIND_DOWN_VOICE_POLICY_VERSION) return false;
  if (descriptor.activity === "roleplay") {
    return hasExactKeys(descriptor, ROLEPLAY_DESCRIPTOR_KEYS)
      && isWindDownVoiceScenarioId(descriptor.scenarioId);
  }
  if (descriptor.activity === "live-talk") {
    return hasExactKeys(descriptor, LIVE_TALK_DESCRIPTOR_KEYS)
      && isWindDownVoiceTopicId(descriptor.topicId);
  }
  return false;
}

export function normalizeWindDownVoiceDescriptor(
  value: unknown,
): WindDownVoiceDescriptor | null {
  if (!isWindDownVoiceDescriptor(value)) return null;
  return value.activity === "roleplay"
    ? createWindDownRoleplayDescriptor(value.scenarioId)
    : createWindDownLiveTalkDescriptor(value.topicId);
}

export function createWindDownVoiceScenarioRequest(
  scenario: WindDownVoiceScenario,
): WindDownVoiceScenarioRequest {
  return {
    scenarioId: scenario.id,
    policyVersion: scenario.version,
  };
}

/**
 * Only clean, finalized learner utterances may create evidence. This makes a
 * goal reproducible from the persisted transcript and prevents a partial,
 * interrupted, or known-drift STT fragment from completing a scenario.
 */
export function evaluateWindDownRoleplay(
  scenario: WindDownVoiceScenario,
  turns: readonly WindDownVoiceFinalizedTurn[],
): WindDownRoleplayProgress {
  const evidence: WindDownVoiceGoalEvidence[] = [];
  const completedGoalIds = new Set<string>();
  // Do not globally re-sort across resumed chains: the transport/report chain
  // already defines chronological order, while turn numbers may restart.
  const orderedTurns = [...turns];

  for (const turn of orderedTurns) {
    if (!isCleanLearnerTurn(turn)) continue;
    const learnerText = cleanText(turn.userText);
    if (!learnerText) continue;
    const normalizedLearnerText = normalizeText(learnerText);
    for (const goal of scenario.goals) {
      if (completedGoalIds.has(goal.id)) continue;
      const matchedPhrase = goal.matchAny.find((phrase) => phraseMatches(normalizedLearnerText, phrase));
      if (!matchedPhrase) continue;
      completedGoalIds.add(goal.id);
      evidence.push({
        scenarioId: scenario.id,
        goalId: goal.id,
        conversationId: turn.conversationId.trim(),
        turnSeq: turn.turnSeq,
        learnerText,
        matchedPhrase,
      });
    }
  }

  const completedGoalIdsInScenarioOrder = scenario.goals
    .map((goal) => goal.id)
    .filter((goalId) => completedGoalIds.has(goalId));

  return {
    scenario,
    completedGoalIds: completedGoalIdsInScenarioOrder,
    evidence,
    corrections: dedupeCorrections(orderedTurns),
    completed: completedGoalIdsInScenarioOrder.length === scenario.goals.length,
  };
}

export function summarizeWindDownLiveTalk(args: {
  turns: readonly WindDownVoiceFinalizedTurn[];
  startedAtIso?: string | null;
  endedAtIso?: string | null;
}): WindDownLiveTalkSummary {
  const finalizedLearnerTurns = args.turns.filter(
    (turn) => turn.finalized && Boolean(cleanText(turn.userText)) && !containsWindDownVoiceUnsafeText(cleanText(turn.userText)),
  ).length;
  const cleanLearnerTurns = args.turns.filter(isCleanLearnerTurn).length;
  const highlightTurns = args.turns
    .filter((turn) => isCleanLearnerTurn(turn) && Boolean(cleanText(turn.modelText)))
    .map((turn) => ({ conversationId: turn.conversationId, turnSeq: turn.turnSeq }));
  const interruptedTurnCount = args.turns.filter((turn) => turn.finalized && turn.interrupted === true).length;
  const startedAt = Date.parse(args.startedAtIso ?? "");
  const endedAt = Date.parse(args.endedAtIso ?? "");
  const durationSeconds = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
    ? Math.round((endedAt - startedAt) / 1000)
    : null;

  return {
    activity: "live-talk",
    finalizedLearnerTurns,
    cleanLearnerTurns,
    highlightTurnSeqs: highlightTurns.map((turn) => turn.turnSeq),
    highlightTurns,
    interruptedTurnCount,
    durationSeconds,
    corrections: dedupeCorrections(args.turns),
  };
}

export function isWindDownVoiceCleanFinalizedTurn(
  turn: WindDownVoiceFinalizedTurn,
) {
  return isCleanLearnerTurn(turn);
}
