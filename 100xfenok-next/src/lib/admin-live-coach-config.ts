export type CoachTester = "mona" | "owner";
export type CoachReviewMode = "new-first" | "balanced" | "review-first";
export type CoachDifficulty = "easy" | "normal" | "challenge";

export type CoachConfig = {
  tester: CoachTester;
  reviewMode: CoachReviewMode;
  reviewRatio: number;
  difficulty: CoachDifficulty;
  difficultyCap: number;
  freshMaterialEnabled: boolean;
  honorLiveRequests: boolean;
  emptyPraiseGuard: boolean;
};

const REVIEW_RATIO_BY_MODE: Record<CoachReviewMode, number> = {
  "new-first": 0.15,
  balanced: 0.3,
  "review-first": 0.55,
};

const DIFFICULTY_CAP_BY_PRESET: Record<CoachDifficulty, number> = {
  easy: 6,
  normal: 8,
  challenge: 10,
};

export const DEFAULT_COACH_CONFIG: CoachConfig = {
  tester: "mona",
  reviewMode: "balanced",
  reviewRatio: REVIEW_RATIO_BY_MODE.balanced,
  difficulty: "normal",
  difficultyCap: DIFFICULTY_CAP_BY_PRESET.normal,
  freshMaterialEnabled: true,
  honorLiveRequests: true,
  emptyPraiseGuard: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickTester(value: unknown): CoachTester {
  return value === "owner" ? "owner" : "mona";
}

function pickReviewMode(value: unknown): CoachReviewMode {
  if (value === "new-first" || value === "balanced" || value === "review-first") return value;
  return DEFAULT_COACH_CONFIG.reviewMode;
}

function pickDifficulty(value: unknown): CoachDifficulty {
  if (value === "easy" || value === "normal" || value === "challenge") return value;
  return DEFAULT_COACH_CONFIG.difficulty;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function normalizeCoachConfig(value: unknown): CoachConfig {
  const input = isRecord(value) ? value : {};
  const tester = pickTester(input.tester);
  const reviewMode = pickReviewMode(input.reviewMode);
  const difficulty = pickDifficulty(input.difficulty);
  const reviewRatio = clampNumber(
    input.reviewRatio,
    REVIEW_RATIO_BY_MODE[reviewMode],
    0,
    1,
  );
  const difficultyCap = clampNumber(
    input.difficultyCap,
    DIFFICULTY_CAP_BY_PRESET[difficulty],
    4,
    14,
  );

  return {
    tester,
    reviewMode,
    reviewRatio,
    difficulty,
    difficultyCap,
    freshMaterialEnabled: pickBoolean(input.freshMaterialEnabled, DEFAULT_COACH_CONFIG.freshMaterialEnabled),
    honorLiveRequests: pickBoolean(input.honorLiveRequests, DEFAULT_COACH_CONFIG.honorLiveRequests),
    emptyPraiseGuard: pickBoolean(input.emptyPraiseGuard, DEFAULT_COACH_CONFIG.emptyPraiseGuard),
  };
}
