import { buildLearningEvent } from "@/features/mona-vnext/memory/srsBridge";
import type { MonaVnextLearningEvent } from "@/features/mona-vnext/memory/srsBridge";

export const WINDDOWN_LEARN_PROGRESS_SCHEMA_VERSION = 1 as const;

export type WindDownLearnProgressVerdict =
  "canonical" | "variant" | "close" | "miss";

export type WindDownLearnProgressInput = {
  schemaVersion: typeof WINDDOWN_LEARN_PROGRESS_SCHEMA_VERSION;
  activity: "learn";
  attemptId: string;
  sessionId: string;
  sequence: number;
  materialId: string;
  contentDigest: string;
  occurredAt: string;
  verdict: WindDownLearnProgressVerdict;
};

export type WindDownLearnProgressPrepared = {
  input: WindDownLearnProgressInput;
  learningEvent: MonaVnextLearningEvent;
  checkpoint: {
    conversationId: string;
    turnSeq: number;
    advisory: {
      best3Candidates: never[];
      weakNoteCandidates: never[];
      nextSessionSuggestions: never[];
      learningEvents: MonaVnextLearningEvent[];
    };
  };
};

export type WindDownLearnProgressErrorCode =
  "INVALID_PROGRESS_EVENT" | "MATERIAL_VERSION_CHANGED" | "MATERIAL_NOT_ACTIVE";

export class WindDownLearnProgressError extends Error {
  constructor(
    readonly code: WindDownLearnProgressErrorCode,
    readonly status: 400 | 409,
  ) {
    super(code);
    this.name = "WindDownLearnProgressError";
  }
}

type PrepareOptions = {
  currentContentDigest: string;
  activeMaterialIds: ReadonlySet<string>;
};

const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

function cleanId(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    !SAFE_ID.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function validIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validVerdict(value: unknown): WindDownLearnProgressVerdict | null {
  return value === "canonical" ||
    value === "variant" ||
    value === "close" ||
    value === "miss"
    ? value
    : null;
}

export function prepareWindDownLearnProgress(
  value: unknown,
  options: PrepareOptions,
): WindDownLearnProgressPrepared {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WindDownLearnProgressError("INVALID_PROGRESS_EVENT", 400);
  }
  const source = value as Record<string, unknown>;
  const attemptId = cleanId(source.attemptId, 160);
  const sessionId = cleanId(source.sessionId, 120);
  const materialId = cleanId(source.materialId, 120);
  const contentDigest =
    typeof source.contentDigest === "string" &&
    SHA256_HEX.test(source.contentDigest)
      ? source.contentDigest
      : null;
  const occurredAt = validIso(source.occurredAt);
  const verdict = validVerdict(source.verdict);
  const sequence =
    typeof source.sequence === "number" &&
    Number.isInteger(source.sequence) &&
    source.sequence >= 1 &&
    source.sequence <= 20
      ? source.sequence
      : null;

  if (
    source.schemaVersion !== WINDDOWN_LEARN_PROGRESS_SCHEMA_VERSION ||
    source.activity !== "learn" ||
    !attemptId ||
    !sessionId ||
    !materialId ||
    !contentDigest ||
    !occurredAt ||
    !verdict ||
    sequence === null
  ) {
    throw new WindDownLearnProgressError("INVALID_PROGRESS_EVENT", 400);
  }
  if (contentDigest !== options.currentContentDigest) {
    throw new WindDownLearnProgressError("MATERIAL_VERSION_CHANGED", 409);
  }
  if (!options.activeMaterialIds.has(materialId)) {
    throw new WindDownLearnProgressError("MATERIAL_NOT_ACTIVE", 409);
  }

  const learningEvent = buildLearningEvent({
    expressionId: materialId,
    verdict,
    atIso: occurredAt,
    sessionId: `winddown:${sessionId}:${attemptId}`,
  });
  if (!learningEvent) {
    throw new WindDownLearnProgressError("INVALID_PROGRESS_EVENT", 400);
  }

  const input: WindDownLearnProgressInput = {
    schemaVersion: WINDDOWN_LEARN_PROGRESS_SCHEMA_VERSION,
    activity: "learn",
    attemptId,
    sessionId,
    sequence,
    materialId,
    contentDigest,
    occurredAt,
    verdict,
  };
  return {
    input,
    learningEvent,
    checkpoint: {
      conversationId: `winddown-learn-${sessionId}`,
      turnSeq: sequence,
      advisory: {
        best3Candidates: [],
        weakNoteCandidates: [],
        nextSessionSuggestions: [],
        learningEvents: [learningEvent],
      },
    },
  };
}
