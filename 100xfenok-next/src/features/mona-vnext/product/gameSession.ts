import type { MonaVnextAnswerMatchTier } from "@/features/mona-vnext/coach/answerMatcher";

export const PRODUCT_QUEST_TARGET = 5;

const XP_BY_TIER: Record<Exclude<MonaVnextAnswerMatchTier, "garbage">, number> = {
  canonical: 25,
  variant: 25,
  close: 18,
  miss: 10,
};

export type ProductQuestState = {
  targetSteps: number;
  completedSteps: number;
  xp: number;
  lastReward: number | null;
  isComplete: boolean;
};

export function createProductQuest(): ProductQuestState {
  return {
    targetSteps: PRODUCT_QUEST_TARGET,
    completedSteps: 0,
    xp: 0,
    lastReward: null,
    isComplete: false,
  };
}

export function applyProductVerdict(
  state: ProductQuestState,
  tier: MonaVnextAnswerMatchTier,
): ProductQuestState {
  if (state.isComplete || tier === "garbage") return state;

  const completedSteps = Math.min(state.targetSteps, state.completedSteps + 1);
  const reward = XP_BY_TIER[tier];

  return {
    ...state,
    completedSteps,
    xp: state.xp + reward,
    lastReward: reward,
    isComplete: completedSteps >= state.targetSteps,
  };
}
