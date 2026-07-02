export type StudyMode = "drill" | "live_talk" | "free_talk" | "review" | "winddown";

export type TeacherPhase =
  | "idle"
  | "connecting"
  | "presenting"
  | "awaiting_attempt"
  | "evaluating"
  | "feedback"
  | "revealed"
  | "advance_pending"
  | "digression"
  | "stopping"
  | "finalized";

export type TeacherVerdict = "canonical" | "variant" | "close" | "miss" | "garbage";

export type CardRef = {
  expressionId: string;
  ko: string;
  targetEn: string;
  acceptedVariants: string[];
  difficulty: number;
  exposureCount?: number;
};

export type TeacherSessionCard = CardRef & {
  exposureCount: number;
};

export type TeacherQueue = {
  entries: CardRef[];
  cursor: number;
  seed: string;
};

export type TeacherAttempt = {
  lastText: string | null;
  verdict: TeacherVerdict | null;
};

export type TeacherLifecycle = {
  goAwayCount: number;
  resumeHandle: string | null;
  resumePhase: TeacherPhase | null;
  pendingReconnectAction: "answer_question" | "acknowledge_attempt" | null;
  lastEffectSeq: number;
};

export type TeacherSession = {
  stateSeq: number;
  mode: StudyMode;
  phase: TeacherPhase;
  card: TeacherSessionCard | null;
  queue: TeacherQueue;
  visibility: { english: boolean };
  attempt: TeacherAttempt;
  praiseArmed: boolean;
  digressionReturn: { phase: TeacherPhase; stateSeq: number } | null;
  lifecycle: TeacherLifecycle;
};

export type TeacherExpectedModelAction =
  | "set_study_mode"
  | "present_card"
  | "wait_for_attempt"
  | "speak_target"
  | "reveal_target"
  | "repair_no_praise"
  | "acknowledge_variant"
  | "praise_attempt"
  | "coach_close_attempt"
  | "coach_miss"
  | "answer_question_then_return"
  | "suggest_correction"
  | "guided_conversation"
  | "reanchor_current_card"
  | "resume_state"
  | "offer_resume"
  | "stop_session"
  | "finalize_session"
  | "log_only";

export type TeacherEffectType =
  | "mode_changed"
  | "present_card"
  | "wait_for_attempt"
  | "reveal_target"
  | "repair_attempt"
  | "acknowledge_variant"
  | "praise"
  | "coach_close_attempt"
  | "coach_miss"
  | "offer_advance"
  | "corrective_respeak"
  | "model_drift_logged"
  | "answer_question"
  | "free_talk_correction"
  | "live_talk_prompt"
  | "reanchor_current_card"
  | "resume_state"
  | "offer_resume"
  | "stop_session"
  | "finalize_session"
  | "illegal_transition";

export type TeacherEffect = {
  type: TeacherEffectType;
  stateSeq: number;
  expressionId: string;
  expectedModelAction: TeacherExpectedModelAction;
  targetEn?: string;
  text?: string;
  observedText?: string;
  verdict?: TeacherVerdict;
  phase?: TeacherPhase;
};

export type TeacherEvent =
  | { type: "SESSION_READY" }
  | { type: "LEARNER_ATTEMPT"; text: string }
  | { type: "LEARNER_NEXT" }
  | { type: "LEARNER_REVEAL" }
  | { type: "LEARNER_MODE_CHANGE"; mode: StudyMode }
  | { type: "LEARNER_STOP" }
  | { type: "LEARNER_QUESTION"; text?: string }
  | { type: "EVAL_RESULT"; verdict: TeacherVerdict }
  | { type: "MODEL_TURN_COMPLETE" }
  | { type: "MODEL_DRIFT"; kind: "word_drop" | "wrong_target" | "unexpected_advance" | "off_state" | "other"; observedText?: string }
  | { type: "GO_AWAY"; resumeHandle?: string }
  | { type: "RECONNECTED"; resumeHandle?: string }
  | { type: "SOCKET_DEAD"; resumeHandle?: string };

export type TeacherTransitionResult = {
  session: TeacherSession;
  effects: TeacherEffect[];
};

export type TeacherMaterialCandidate = CardRef & {
  grounded?: boolean;
  verifiedInSource?: boolean;
  tried?: string[];
};

export type TeacherMaterialQuarantineEntry = TeacherMaterialCandidate & {
  reasons: string[];
};

export type TeacherMaterialWarningEntry = TeacherMaterialCandidate & {
  reasons: string[];
};

export type TeacherMaterialGateResult = {
  accepted: TeacherSessionCard[];
  quarantine: TeacherMaterialQuarantineEntry[];
  warnings: TeacherMaterialWarningEntry[];
};
