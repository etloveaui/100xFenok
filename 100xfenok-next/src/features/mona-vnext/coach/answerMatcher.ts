export type MonaVnextAnswerMatchTier = "garbage" | "canonical" | "variant" | "close" | "miss";

export type MonaVnextAnswerMatch = {
  tier: MonaVnextAnswerMatchTier;
  confidence: number;
  reason: string;
  normalizedUser: string;
  normalizedTarget: string;
};

const FILLER_TOKENS = new Set([
  "uh",
  "um",
  "er",
  "ah",
  "like",
]);

function normalizeAnswerText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’‘`]/g, "'")
    .replace(/\bcan not\b/g, "cannot")
    .replace(/\bi am\b/g, "i'm")
    .replace(/\byou are\b/g, "you're")
    .replace(/\bit is\b/g, "it's")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bdid not\b/g, "didn't")
    .replace(/\bdoes not\b/g, "doesn't")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !FILLER_TOKENS.has(token));
}

function countTargetTokensInOrder(userTokens: string[], targetTokens: string[]) {
  let index = 0;
  for (const token of userTokens) {
    if (token === targetTokens[index]) index += 1;
    if (index >= targetTokens.length) break;
  }
  return index;
}

function overlapRatio(userTokens: string[], targetTokens: string[]) {
  if (targetTokens.length === 0) return 0;
  const userSet = new Set(userTokens);
  const hits = targetTokens.filter((token) => userSet.has(token)).length;
  return hits / targetTokens.length;
}

function hasLikelyGarbageShape(rawUser: string, normalizedUser: string) {
  if (!rawUser.trim()) return true;
  if (/[ぁ-ゟ゠-ヿ]/.test(rawUser)) return true;

  const digitTokens = rawUser.match(/\b\d+\b/g)?.length ?? 0;
  const latinTokens = normalizedUser.match(/[a-z]+/g)?.length ?? 0;
  const hangulTokens = rawUser.match(/[가-힣]+/g)?.length ?? 0;
  const hasOnlyNoiseSymbols = normalizedUser.length === 0 && hangulTokens === 0;

  if (hasOnlyNoiseSymbols) return true;
  if (digitTokens >= 3 && latinTokens === 0 && hangulTokens <= 2) return true;
  return false;
}

export function evaluateMonaVnextAnswerAttempt(
  userText: string | null | undefined,
  targetText: string,
  acceptedVariants: string[] = [],
): MonaVnextAnswerMatch {
  const rawUser = (userText ?? "").trim();
  const normalizedUser = normalizeAnswerText(rawUser);
  const normalizedTarget = normalizeAnswerText(targetText);
  const userTokens = tokenize(normalizedUser);
  const targetTokens = tokenize(normalizedTarget);

  if (hasLikelyGarbageShape(rawUser, normalizedUser)) {
    return {
      tier: "garbage",
      confidence: 0,
      reason: "stt-garbage-shape",
      normalizedUser,
      normalizedTarget,
    };
  }

  if (targetTokens.length === 0 || userTokens.length === 0) {
    return {
      tier: "miss",
      confidence: 0,
      reason: "no-english-answer",
      normalizedUser,
      normalizedTarget,
    };
  }

  if (normalizedUser === normalizedTarget) {
    return {
      tier: "canonical",
      confidence: 1,
      reason: "exact-normalized-match",
      normalizedUser,
      normalizedTarget,
    };
  }

  const normalizedVariants = acceptedVariants
    .map((variant) => normalizeAnswerText(variant))
    .filter(Boolean);
  if (normalizedVariants.includes(normalizedUser)) {
    return {
      tier: "variant",
      confidence: 1,
      reason: "accepted-variant-match",
      normalizedUser,
      normalizedTarget,
    };
  }

  const inOrder = countTargetTokensInOrder(userTokens, targetTokens);
  const orderCoverage = inOrder / targetTokens.length;
  const overlap = overlapRatio(userTokens, targetTokens);
  const extraTokenBudget = Math.max(2, Math.ceil(targetTokens.length * 0.25));
  const extraTokens = Math.max(0, userTokens.length - targetTokens.length);

  if (orderCoverage === 1 && extraTokens <= extraTokenBudget) {
    return {
      tier: "canonical",
      confidence: 0.95,
      reason: "target-tokens-in-order",
      normalizedUser,
      normalizedTarget,
    };
  }

  if (orderCoverage >= 0.6 || overlap >= 0.65) {
    return {
      tier: "close",
      confidence: Math.max(orderCoverage, overlap),
      reason: "partial-target-match",
      normalizedUser,
      normalizedTarget,
    };
  }

  return {
    tier: "miss",
    confidence: Math.max(orderCoverage, overlap),
    reason: "low-target-match",
    normalizedUser,
    normalizedTarget,
  };
}
