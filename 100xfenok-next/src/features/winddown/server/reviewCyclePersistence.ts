import { invokeMonaVnextProfileCoordinator } from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import type {
  WindDownReviewCycleInput,
  WindDownReviewCycleReceipt,
} from "@/features/winddown/server/reviewCycle";
import { loadWindDownStudyMaterial } from "@/features/winddown/server/publishedMaterialAdapter";

export type WindDownReviewCycleCommitResult = {
  duplicate: boolean;
  receipt: WindDownReviewCycleReceipt;
};

export async function persistWindDownReviewCycle(
  input: WindDownReviewCycleInput,
): Promise<WindDownReviewCycleCommitResult> {
  const material = await loadWindDownStudyMaterial({
    dueExpressionIds: [],
    deferredExpressionIds: [],
  });
  if (
    material.metadata.source !== "published-lkg" ||
    material.metadata.publicationStatus !== "active" ||
    !material.metadata.contentDigest
  ) {
    throw new Error("WINDDOWN_MATERIAL_UNAVAILABLE");
  }
  const active = material.entries.find((entry) => entry.id === input.materialId);
  const response = await invokeMonaVnextProfileCoordinator({
    operation: "commit-review-cycle",
    input,
    material: active
      ? {
          id: active.id,
          en: active.en,
          acceptedVariants: active.acceptedVariants,
        }
      : null,
    currentContentDigest: material.metadata.contentDigest,
    nowIso: new Date().toISOString(),
  });
  const receipt =
    response.receipt &&
    typeof response.receipt === "object" &&
    !Array.isArray(response.receipt)
      ? (response.receipt as WindDownReviewCycleReceipt)
      : null;
  if (!receipt) throw new Error("PROFILE_COORDINATOR_RECEIPT_MISSING");
  return {
    duplicate: response.duplicate === true,
    receipt,
  };
}
