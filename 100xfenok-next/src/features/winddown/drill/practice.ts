import { assessWindDownPatternAttempt, type WindDownPatternFeedback } from "./patternFeedback";
export const WINDDOWN_PRACTICE_SCHEMA_VERSION = 1 as const;
export const WINDDOWN_PRACTICE_MATERIAL_LIMIT = 500 as const;

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const PRODUCT_SESSION_ID = /^[A-Za-z0-9._-]{8,160}$/;
const SOURCE_CONVERSATION_ID = /^[A-Za-z0-9._-]{1,120}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export type WindDownPracticeMethod =
  | "recall-reveal"
  | "audio-first-response"
  | "listening-variants"
  | "linked-recall-listen-response"
  | "pronunciation-transcript"
  | "pattern-transform";

export const WINDDOWN_VOICE_CORRECTION_METHODS: WindDownPracticeMethod[] = [
  "recall-reveal",
  "audio-first-response",
];

export type WindDownPracticeMaterial = {
  id: string;
  ko: string;
  en: string;
  acceptedVariants: string[];
  practice?: WindDownPracticeMetadata;
};

export type WindDownPracticeMetadata = {
  pattern: string | null;
  variationsEn: string[];
  theme: string | null;
};

export type WindDownPracticeCitation = {
  productSessionId: string;
  sourceConversationId: string;
  turnSeq: number;
};

export type WindDownPracticeVoiceCorrection = {
  citation: WindDownPracticeCitation;
  learnerText: string;
  modelCorrection: string;
};

export type WindDownPracticeQuery =
  | { kind: "none" }
  | { kind: "generic" }
  | { kind: "canonical-material"; materialId: string }
  | { kind: "voice-correction"; citation: WindDownPracticeCitation }
  | { kind: "error"; code: WindDownPracticeQueryErrorCode };

export type WindDownPracticeQueryErrorCode =
  | "unknown-query-key"
  | "duplicate-query-key"
  | "mixed-query"
  | "invalid-query-value"
  | "missing-citation-field"
  | "invalid-turn";

export type WindDownPracticeResponse = {
  ok: true;
  schemaVersion: typeof WINDDOWN_PRACTICE_SCHEMA_VERSION;
  mode: "practice";
  modelOpened: false;
  material: {
    source: "published-lkg";
    publicationStatus: "active";
    contentDigest: string;
  };
  materials: WindDownPracticeMaterial[];
  target: Exclude<WindDownPracticeQuery, { kind: "none" | "error" }>;
  voiceCorrection?: WindDownPracticeVoiceCorrection;
};

export type WindDownPracticeTarget = Exclude<
  WindDownPracticeQuery,
  { kind: "none" | "error" }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeId(value: string | null): value is string {
  return value !== null && SAFE_ID.test(value);
}

function safeProductSessionId(value: string | null): value is string {
  return value !== null && PRODUCT_SESSION_ID.test(value);
}

function safeSourceConversationId(value: string | null): value is string {
  return value !== null && SOURCE_CONVERSATION_ID.test(value);
}

function positiveSafeInteger(value: string | null): value is string {
  if (value === null || !/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

export function parseWindDownPracticeQuery(
  params: URLSearchParams,
): WindDownPracticeQuery {
  const entries = [...params.keys()];
  const allowed = new Set(["practice", "material", "conversation", "turn", "source"]);
  const unknown = entries.find((key) => !allowed.has(key));
  if (unknown) return { kind: "error", code: "unknown-query-key" };
  const duplicate = entries.find((key, index) => entries.indexOf(key) !== index);
  if (duplicate) return { kind: "error", code: "duplicate-query-key" };

  const practice = params.get("practice");
  const material = params.get("material");
  const conversation = params.get("conversation");
  const turn = params.get("turn");
  const source = params.get("source");
  const hasPractice = practice !== null;
  const hasMaterial = material !== null;
  const hasConversation = conversation !== null;
  const hasTurn = turn !== null;
  const hasSource = source !== null;

  if (!entries.length) return { kind: "none" };
  if (hasPractice) {
    return entries.length === 1 && practice === "1"
      ? { kind: "generic" }
      : { kind: "error", code: "mixed-query" };
  }
  if (hasMaterial) {
    return entries.length === 1 && safeId(material)
      ? { kind: "canonical-material", materialId: material }
      : { kind: "error", code: entries.length === 1 ? "invalid-query-value" : "mixed-query" };
  }
  if (hasConversation || hasTurn || hasSource) {
    if (!(hasConversation && hasTurn && hasSource) || entries.length !== 3) {
      return { kind: "error", code: "missing-citation-field" };
    }
    if (!safeProductSessionId(conversation) || !safeSourceConversationId(source)) {
      return { kind: "error", code: "invalid-query-value" };
    }
    if (!positiveSafeInteger(turn)) return { kind: "error", code: "invalid-turn" };
    return {
      kind: "voice-correction",
      citation: {
        productSessionId: conversation,
        sourceConversationId: source,
        turnSeq: Number(turn),
      },
    };
  }
  return { kind: "error", code: "invalid-query-value" };
}

function validMaterial(value: unknown): value is WindDownPracticeMaterial {
  if (!isRecord(value)) return false;
  if (!exactKeys(value, ["id", "ko", "en", "acceptedVariants", ...(value.practice === undefined ? [] : ["practice"])])) return false;
  if (!safeId(typeof value.id === "string" ? value.id : null)) return false;
  if (
    typeof value.ko !== "string" || !value.ko.trim()
    || typeof value.en !== "string" || !value.en.trim()
    || !Array.isArray(value.acceptedVariants)
    || value.acceptedVariants.some((item) => typeof item !== "string" || !item.trim())
  ) return false;
  return value.practice === undefined || validPracticeMetadata(value.practice);
}

const PATTERN_MAX_LENGTH = 160;
const THEME_MAX_LENGTH = 80;
const VARIATION_MAX_LENGTH = 240;
const VARIATION_LIMIT = 8;

function validPracticeMetadata(value: unknown): value is WindDownPracticeMetadata {
  if (!isRecord(value) || !exactKeys(value, ["pattern", "variationsEn", "theme"])) return false;
  const pattern = value.pattern;
  const theme = value.theme;
  const variations = value.variationsEn;
  if (pattern !== null && (typeof pattern !== "string" || pattern !== pattern.trim() || !pattern || pattern.length > PATTERN_MAX_LENGTH)) return false;
  if (theme !== null && (typeof theme !== "string" || theme !== theme.trim() || !theme || theme.length > THEME_MAX_LENGTH)) return false;
  if (!Array.isArray(variations) || variations.length > VARIATION_LIMIT) return false;
  const normalized = variations.map((item) => typeof item === "string" ? item.trim() : "");
  if (normalized.some((item, index) => !item || variations[index] !== item || item.length > VARIATION_MAX_LENGTH)) return false;
  if (new Set(normalized).size !== normalized.length) return false;
  return pattern !== null || theme !== null || normalized.length > 0;
}

function validCitation(value: unknown): value is WindDownPracticeCitation {
  return isRecord(value)
    && exactKeys(value, ["productSessionId", "sourceConversationId", "turnSeq"])
    && safeProductSessionId(typeof value.productSessionId === "string" ? value.productSessionId : null)
    && safeSourceConversationId(typeof value.sourceConversationId === "string" ? value.sourceConversationId : null)
    && typeof value.turnSeq === "number"
    && Number.isSafeInteger(value.turnSeq)
    && value.turnSeq > 0;
}

function validTarget(value: unknown): value is WindDownPracticeTarget {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "generic") return exactKeys(value, ["kind"]);
  if (value.kind === "canonical-material") {
    return exactKeys(value, ["kind", "materialId"])
      && safeId(typeof value.materialId === "string" ? value.materialId : null);
  }
  if (value.kind === "voice-correction") {
    return exactKeys(value, ["kind", "citation"]) && validCitation(value.citation);
  }
  return false;
}

export function isWindDownPracticeResponse(
  value: unknown,
): value is WindDownPracticeResponse {
  if (!isRecord(value) || value.ok !== true) return false;
  const responseKeys = value.voiceCorrection === undefined
    ? ["ok", "schemaVersion", "mode", "modelOpened", "material", "materials", "target"]
    : ["ok", "schemaVersion", "mode", "modelOpened", "material", "materials", "target", "voiceCorrection"];
  if (!exactKeys(value, responseKeys)) return false;
  if (
    value.schemaVersion !== WINDDOWN_PRACTICE_SCHEMA_VERSION
    || value.mode !== "practice"
    || value.modelOpened !== false
    || !isRecord(value.material)
    || value.material.source !== "published-lkg"
    || value.material.publicationStatus !== "active"
    || typeof value.material.contentDigest !== "string"
    || !SHA256_HEX.test(value.material.contentDigest)
    || !Array.isArray(value.materials)
    || value.materials.length === 0
    || value.materials.length > WINDDOWN_PRACTICE_MATERIAL_LIMIT
    || !validTarget(value.target)
  ) return false;
  const target = value.target as WindDownPracticeTarget;
  if (value.materials.some((item) => !validMaterial(item))) return false;
  const materials = value.materials as WindDownPracticeMaterial[];
  if (new Set(materials.map((item) => item.id)).size !== materials.length) return false;
  if (
    target.kind === "canonical-material"
    && !materials.some((item) => item.id === target.materialId)
  ) return false;
  if (target.kind === "voice-correction") {
    if (!isRecord(value.voiceCorrection)) return false;
    if (!exactKeys(value.voiceCorrection, ["citation", "learnerText", "modelCorrection"])) return false;
    if (
      !validCitation(value.voiceCorrection.citation)
      || value.voiceCorrection.citation.productSessionId !== target.citation.productSessionId
      || value.voiceCorrection.citation.sourceConversationId !== target.citation.sourceConversationId
      || value.voiceCorrection.citation.turnSeq !== target.citation.turnSeq
      || typeof value.voiceCorrection.learnerText !== "string"
      || !value.voiceCorrection.learnerText.trim()
      || typeof value.voiceCorrection.modelCorrection !== "string"
      || !value.voiceCorrection.modelCorrection.trim()
    ) return false;
  } else if (value.voiceCorrection !== undefined) {
    return false;
  }
  return true;
}

export type WindDownPracticeStep = {
  method: Exclude<WindDownPracticeMethod, "linked-recall-listen-response">;
  materialId: string;
  creditPolicy: "practice-only";
};

export type WindDownPracticeAttempt = {
  text: string;
  feedback?: WindDownPatternFeedback;
  verdict: "practice-only";
  reward: 0;
};

export type WindDownPracticeState = {
  schemaVersion: typeof WINDDOWN_PRACTICE_SCHEMA_VERSION;
  seed: string;
  method: WindDownPracticeMethod;
  material: WindDownPracticeMaterial | null;
  voiceCorrection: WindDownPracticeVoiceCorrection | null;
  canonicalGrading: boolean;
  phase: "recall" | "listening" | "response" | "awaiting-reveal" | "revealed" | "complete";
  stepIndex: number;
  currentStep: WindDownPracticeStep | null;
  revealed: boolean;
  revealText: string | null;
  attempt: WindDownPracticeAttempt | null;
  score: 0;
  xp: 0;
  creditPolicy: "practice-only";
  steps: WindDownPracticeStep[];
};

export type WindDownPracticeAction =
  | { type: "submit-response"; text: string }
  | { type: "retry-response" }
  | { type: "reveal" }
  | { type: "complete" }
  | { type: "advance" };

export function windDownPracticeListeningTexts(material: WindDownPracticeMaterial): string[] {
  return Array.from(new Set([
    material.en,
    ...material.acceptedVariants,
    ...(material.practice?.variationsEn ?? []),
  ].map((text) => text.trim()).filter(Boolean)));
}

function stepsFor(
  method: WindDownPracticeMethod,
  materialId: string | null,
): WindDownPracticeStep[] {
  if (!materialId) return [];
  const methods: Array<Exclude<WindDownPracticeMethod, "linked-recall-listen-response">> =
    method === "linked-recall-listen-response"
      ? ["recall-reveal", "listening-variants", "audio-first-response"]
      : [method];
  return methods.map((stepMethod) => ({
    method: stepMethod,
    materialId,
    creditPolicy: "practice-only",
  }));
}

function phaseForStep(step: WindDownPracticeStep | null): WindDownPracticeState["phase"] {
  if (!step) return "recall";
  if (step.method === "listening-variants") return "listening";
  if (step.method === "audio-first-response" || step.method === "pronunciation-transcript" || step.method === "pattern-transform") return "response";
  return "recall";
}

export function createWindDownPracticeSession(args: {
  material?: WindDownPracticeMaterial;
  method: WindDownPracticeMethod;
  seed: string;
  voiceCorrection?: WindDownPracticeVoiceCorrection;
}): WindDownPracticeState {
  const material = args.material ?? null;
  const voiceCorrection = args.voiceCorrection ?? null;
  if (!material && !voiceCorrection) throw new Error("winddown_practice_target_required");
  if (material && voiceCorrection) throw new Error("winddown_practice_targets_mixed");
  if (args.method === "pattern-transform" && !material?.practice?.pattern) {
    throw new Error("winddown_pattern_method_unavailable");
  }
  if (voiceCorrection && !WINDDOWN_VOICE_CORRECTION_METHODS.includes(args.method)) {
    throw new Error("winddown_voice_correction_method_unavailable");
  }
  const steps = stepsFor(args.method, material?.id ?? null);
  const currentStep = steps[0] ?? null;
  return {
    schemaVersion: WINDDOWN_PRACTICE_SCHEMA_VERSION,
    seed: args.seed.trim() || "winddown-practice",
    method: args.method,
    material,
    voiceCorrection,
    canonicalGrading: Boolean(material),
    phase: phaseForStep(currentStep),
    stepIndex: 0,
    currentStep,
    revealed: false,
    revealText: null,
    attempt: null,
    score: 0,
    xp: 0,
    creditPolicy: "practice-only",
    steps,
  };
}

export function applyWindDownPracticeAction(
  state: WindDownPracticeState,
  action: WindDownPracticeAction,
): WindDownPracticeState {
  if (action.type === "retry-response" && state.attempt?.feedback && (state.phase === "awaiting-reveal" || state.phase === "revealed")) {
    return { ...state, phase: "response", attempt: null, revealed: false, revealText: null };
  }
  if ((state.phase === "recall" || state.phase === "response") && action.type === "submit-response") {
    const text = action.text.trim();
    if (!text) return state;
    return {
      ...state,
      phase: "awaiting-reveal",
      attempt: { text, verdict: "practice-only", reward: 0,
        ...(state.method === "pattern-transform" && state.material ? { feedback: assessWindDownPatternAttempt(state.material, text) } : {}),
      },
    };
  }
  if (state.phase === "awaiting-reveal" && action.type === "reveal") {
    return {
      ...state,
      phase: "revealed",
      revealed: true,
      revealText: state.currentStep?.method === "pattern-transform"
        ? state.material?.practice?.pattern ?? state.material?.en ?? null
        : state.material?.en ?? state.voiceCorrection?.modelCorrection ?? null,
    };
  }
  if (state.phase === "revealed" && action.type === "complete") {
    const nextIndex = state.stepIndex + 1;
    const nextStep = state.steps[nextIndex] ?? null;
    if (nextStep) {
      return {
        ...state,
        phase: phaseForStep(nextStep),
        stepIndex: nextIndex,
        currentStep: nextStep,
        revealed: false,
        revealText: null,
        attempt: null,
      };
    }
    return { ...state, phase: "complete", stepIndex: state.steps.length, currentStep: null };
  }
  if (state.phase === "listening" && action.type === "advance") {
    const nextIndex = state.stepIndex + 1;
    const nextStep = state.steps[nextIndex] ?? null;
    if (!nextStep) return { ...state, phase: "complete", stepIndex: state.steps.length, currentStep: null };
    return {
      ...state,
      phase: phaseForStep(nextStep),
      stepIndex: nextIndex,
      currentStep: nextStep,
      revealed: false,
      revealText: null,
      attempt: null,
    };
  }
  return state;
}
