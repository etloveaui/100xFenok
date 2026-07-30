export type WindDownMode = "learn" | "review" | "roleplay" | "live-talk";

export type WindDownActivityContract = {
  mode: WindDownMode;
  engine: "deterministic-learn" | "fsrs-review" | "gemini-roleplay" | "gemini-live-talk";
  modelPolicy: "forbidden" | "required";
  microphonePolicy: "forbidden" | "required";
  completion: "five-exercises" | "due-queue" | "scenario-goals" | "learner-stop";
};

export const WINDDOWN_ACTIVITY_CONTRACTS = {
  learn: {
    mode: "learn",
    engine: "deterministic-learn",
    modelPolicy: "forbidden",
    microphonePolicy: "forbidden",
    completion: "five-exercises",
  },
  review: {
    mode: "review",
    engine: "fsrs-review",
    modelPolicy: "forbidden",
    microphonePolicy: "forbidden",
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
