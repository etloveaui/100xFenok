import {
  WINDDOWN_DRILL_ROUND_TARGET,
  type WindDownDrillFeedback,
  type WindDownDrillResult,
  type WindDownDrillRound,
  type WindDownDrillState,
} from "@/features/winddown/drill/engine";

export type WindDownDrillResponse = {
  ok: true;
  schemaVersion: 1;
  mode: "drill";
  modelOpened: false;
  material: {
    source: "published-lkg";
    publicationStatus: "active";
    contentDigest: string;
  };
  session: WindDownDrillState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRound(value: unknown): value is WindDownDrillRound {
  if (
    !isRecord(value)
    || !Array.isArray(value.choices)
    || value.choices.length !== 3
  ) {
    return false;
  }
  const choices = value.choices.filter(isRecord);
  if (
    !isNonEmptyString(value.id)
    || !isNonEmptyString(value.prompt)
    || !isNonEmptyString(value.answer)
    || !isNonEmptyString(value.correctChoiceId)
    || choices.length !== 3
    || choices.some(
      (choice) => !isNonEmptyString(choice.id) || !isNonEmptyString(choice.text),
    )
  ) {
    return false;
  }
  return new Set(choices.map((choice) => choice.id)).size === 3
    && new Set(choices.map((choice) => choice.text)).size === 3
    && choices.filter((choice) => choice.id === value.correctChoiceId).length === 1;
}

function resultFrom(value: unknown): WindDownDrillResult | null {
  if (
    !isRecord(value)
    || typeof value.roundId !== "string"
    || typeof value.choiceId !== "string"
    || typeof value.correct !== "boolean"
    || !isNonNegativeInteger(value.points)
    || !isNonNegativeInteger(value.combo)
  ) {
    return null;
  }
  return value as WindDownDrillResult;
}

function feedbackFrom(value: unknown): WindDownDrillFeedback | null {
  const result = resultFrom(value);
  return result && isRecord(value) && typeof value.answer === "string"
    ? { ...result, answer: value.answer }
    : null;
}

export function isWindDownDrillStatePayload(
  value: unknown,
): value is WindDownDrillState {
  if (!isRecord(value) || !Array.isArray(value.rounds) || !Array.isArray(value.results)) {
    return false;
  }
  if (value.rounds.length !== WINDDOWN_DRILL_ROUND_TARGET) return false;
  const phase = value.phase;
  const rounds = value.rounds.filter(isRound);
  const results = Array.from(value.results, resultFrom);
  if (
    value.schemaVersion !== 1
    || !isNonEmptyString(value.seed)
    || !["prompt", "feedback", "complete"].includes(String(phase))
    || rounds.length !== WINDDOWN_DRILL_ROUND_TARGET
    || new Set(rounds.map((round) => round.id)).size !== WINDDOWN_DRILL_ROUND_TARGET
    || !isNonNegativeInteger(value.roundIndex)
    || value.roundIndex > WINDDOWN_DRILL_ROUND_TARGET
    || !isNonNegativeInteger(value.score)
    || !isNonNegativeInteger(value.combo)
    || !isNonNegativeInteger(value.maxCombo)
    || !isNonNegativeInteger(value.correctCount)
    || results.some((result) => !result)
  ) {
    return false;
  }

  const validResults = results as WindDownDrillResult[];
  let combo = 0;
  let score = 0;
  let maxCombo = 0;
  let correctCount = 0;
  for (const [index, result] of validResults.entries()) {
    const round = rounds[index];
    if (!round || result.roundId !== round.id) return false;
    const choice = round.choices.find((candidate) => candidate.id === result.choiceId);
    if (!choice || result.correct !== (choice.id === round.correctChoiceId)) return false;
    combo = result.correct ? combo + 1 : 0;
    const points = result.correct ? 100 + (combo - 1) * 25 : 0;
    if (result.combo !== combo || result.points !== points) return false;
    score += points;
    maxCombo = Math.max(maxCombo, combo);
    correctCount += result.correct ? 1 : 0;
  }
  if (
    value.score !== score
    || value.combo !== combo
    || value.maxCombo !== maxCombo
    || value.correctCount !== correctCount
  ) {
    return false;
  }

  if (phase === "prompt") {
    return value.roundIndex < WINDDOWN_DRILL_ROUND_TARGET
      && validResults.length === value.roundIndex
      && value.feedback === null;
  }
  if (phase === "complete") {
    return value.roundIndex === WINDDOWN_DRILL_ROUND_TARGET
      && validResults.length === WINDDOWN_DRILL_ROUND_TARGET
      && value.feedback === null;
  }

  const feedback = feedbackFrom(value.feedback);
  const activeRound = rounds[value.roundIndex];
  const latestResult = validResults.at(-1);
  return value.roundIndex < WINDDOWN_DRILL_ROUND_TARGET
    && validResults.length === value.roundIndex + 1
    && Boolean(activeRound && feedback && latestResult)
    && feedback?.roundId === activeRound?.id
    && feedback?.answer === activeRound?.answer
    && feedback?.roundId === latestResult?.roundId
    && feedback?.choiceId === latestResult?.choiceId
    && feedback?.correct === latestResult?.correct
    && feedback?.points === latestResult?.points
    && feedback?.combo === latestResult?.combo;
}

export function isWindDownDrillResponsePayload(
  value: unknown,
): value is WindDownDrillResponse {
  if (!isRecord(value) || !isRecord(value.material)) return false;
  return value.ok === true
    && value.schemaVersion === 1
    && value.mode === "drill"
    && value.modelOpened === false
    && value.material.source === "published-lkg"
    && value.material.publicationStatus === "active"
    && typeof value.material.contentDigest === "string"
    && /^[a-f0-9]{64}$/.test(value.material.contentDigest)
    && isWindDownDrillStatePayload(value.session);
}
