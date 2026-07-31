export type WindDownMode = "learn" | "review" | "roleplay" | "live-talk";

export const WINDDOWN_REVIEW_DAILY_TARGET = 3 as const;

export type WindDownActivityContract = {
  mode: WindDownMode;
  engine: "deterministic-learn" | "fsrs-review" | "gemini-roleplay" | "gemini-live-talk";
  modelPolicy: "forbidden" | "required";
  microphonePolicy: "forbidden" | "optional-browser-managed" | "required";
  completion: "five-exercises" | "due-queue" | "scenario-goals" | "learner-stop";
};

export const WINDDOWN_ACTIVITY_CONTRACTS = {
  learn: {
    mode: "learn",
    engine: "deterministic-learn",
    modelPolicy: "forbidden",
    microphonePolicy: "optional-browser-managed",
    completion: "five-exercises",
  },
  review: {
    mode: "review",
    engine: "fsrs-review",
    modelPolicy: "forbidden",
    microphonePolicy: "optional-browser-managed",
    completion: "due-queue",
  },
  roleplay: {
    mode: "roleplay",
    engine: "gemini-roleplay",
    modelPolicy: "required",
    microphonePolicy: "required",
    completion: "scenario-goals",
  },
  "live-talk": {
    mode: "live-talk",
    engine: "gemini-live-talk",
    modelPolicy: "required",
    microphonePolicy: "required",
    completion: "learner-stop",
  },
} as const satisfies Record<WindDownMode, WindDownActivityContract>;

export function getWindDownActivityContract(mode: WindDownMode): WindDownActivityContract {
  return WINDDOWN_ACTIVITY_CONTRACTS[mode];
}

export function getWindDownReviewJourneyTarget(args: {
  completedCount: number;
  dueCount: number;
}) {
  const completedCount = Number.isFinite(args.completedCount)
    ? Math.max(0, Math.floor(args.completedCount))
    : 0;
  const dueCount = Number.isFinite(args.dueCount)
    ? Math.max(0, Math.floor(args.dueCount))
    : 0;
  const target = Math.min(
    WINDDOWN_REVIEW_DAILY_TARGET,
    completedCount + dueCount,
  );
  return {
    target,
    remaining: Math.max(0, target - completedCount),
  };
}
