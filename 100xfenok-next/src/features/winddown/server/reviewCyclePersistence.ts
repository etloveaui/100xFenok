import {
  invokeMonaVnextProfileCoordinator,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  readMonaVnextLearningProfileState,
} from "@/features/mona-vnext/memory/monaMemoryRepository";
import {
  gradeWindDownReviewAttemptState,
  normalizeWindDownReviewCycleReceipt,
  normalizeWindDownReviewCycleInput,
  normalizeWindDownReviewGradeInput,
  type WindDownReviewCycleMaterial,
  type WindDownReviewCycleReceipt,
} from "@/features/winddown/server/reviewCycle";
import { loadWindDownStudyMaterial } from "@/features/winddown/server/publishedMaterialAdapter";

export class WindDownReviewPersistenceError extends Error {
  constructor(
    readonly code: "WINDDOWN_MATERIAL_UNAVAILABLE" | "PROFILE_COORDINATOR_RESPONSE_INVALID",
    readonly status: 500 | 503,
  ) {
    super(code);
    this.name = "WindDownReviewPersistenceError";
  }
}

type ActiveMaterialContext = {
  material: WindDownReviewCycleMaterial | null;
  activeMaterialIds: string[];
  contentDigest: string;
};

async function loadActiveMaterialContext(
  materialId: string,
): Promise<ActiveMaterialContext> {
  const material = await loadWindDownStudyMaterial({
    dueExpressionIds: [],
    deferredExpressionIds: [],
  });
  if (
    material.metadata.source !== "published-lkg" ||
    material.metadata.publicationStatus !== "active" ||
    !material.metadata.contentDigest
  ) {
    throw new WindDownReviewPersistenceError(
      "WINDDOWN_MATERIAL_UNAVAILABLE",
      503,
    );
  }
  const active = material.entries.find((entry) => entry.id === materialId);
  return {
    material: active
      ? {
          id: active.id,
          en: active.en,
          acceptedVariants: active.acceptedVariants,
        }
      : null,
    activeMaterialIds: material.entries.map((entry) => entry.id),
    contentDigest: material.metadata.contentDigest,
  };
}

export async function gradeWindDownReviewRecall(
  value: unknown,
  now = new Date(),
) {
  const input = normalizeWindDownReviewGradeInput(value);
  const [profile, context] = await Promise.all([
    readMonaVnextLearningProfileState(),
    loadActiveMaterialContext(input.materialId),
  ]);
  return gradeWindDownReviewAttemptState({
    profile,
    input,
    material: context.material,
    currentContentDigest: context.contentDigest,
    nowIso: now.toISOString(),
  });
}

export type WindDownReviewCycleCommitResult = {
  duplicate: boolean;
  receipt: WindDownReviewCycleReceipt;
  remainingDueCount: number;
  nextDueAtIso: string | null;
};

export async function persistWindDownReviewCycle(
  value: unknown,
  now = new Date(),
): Promise<WindDownReviewCycleCommitResult> {
  const input = normalizeWindDownReviewCycleInput(value);
  const context = await loadActiveMaterialContext(input.materialId);
  const response = await invokeMonaVnextProfileCoordinator({
    operation: "commit-review-cycle",
    input,
    material: context.material,
    activeMaterialIds: context.activeMaterialIds,
    currentContentDigest: context.contentDigest,
    nowIso: now.toISOString(),
  });
  const receipt = normalizeWindDownReviewCycleReceipt(response.receipt);
  const remainingDueCount = response.remainingDueCount;
  const nextDueAtIso = response.nextDueAtIso;
  if (
    !receipt ||
    typeof remainingDueCount !== "number" ||
    !Number.isSafeInteger(remainingDueCount) ||
    remainingDueCount < 0 ||
    !(
      nextDueAtIso === null ||
      (typeof nextDueAtIso === "string" &&
        Number.isFinite(Date.parse(nextDueAtIso)))
    )
  ) {
    throw new WindDownReviewPersistenceError(
      "PROFILE_COORDINATOR_RESPONSE_INVALID",
      500,
    );
  }
  return {
    duplicate: response.duplicate === true,
    receipt,
    remainingDueCount,
    nextDueAtIso,
  };
}
