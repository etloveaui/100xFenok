import {
  MonaVnextProfileCoordinatorError,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  WindDownReviewCycleError,
} from "@/features/winddown/server/reviewCycle";
import {
  gradeWindDownReviewRecall,
  persistWindDownReviewCycle,
  WindDownReviewPersistenceError,
} from "@/features/winddown/server/reviewCyclePersistence";

type ReviewApiResponse = {
  status: number;
  body: Record<string, unknown>;
};

type ReviewApiDependencies = {
  gradeRecall: typeof gradeWindDownReviewRecall;
  commitReviewCycle: typeof persistWindDownReviewCycle;
};

const DEFAULT_DEPENDENCIES: ReviewApiDependencies = {
  gradeRecall: gradeWindDownReviewRecall,
  commitReviewCycle: persistWindDownReviewCycle,
};

export async function executeWindDownReviewApiRequest(
  value: unknown,
  dependencies: ReviewApiDependencies = DEFAULT_DEPENDENCIES,
): Promise<ReviewApiResponse> {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body) {
    return {
      status: 400,
      body: { error: "INVALID_WINDDOWN_REVIEW_REQUEST" },
    };
  }

  try {
    if (body.operation === "grade-recall") {
      const result = await dependencies.gradeRecall(body);
      return {
        status: 200,
        body: {
          ok: true,
          operation: body.operation,
          outcome: result.outcome,
          needsRepair: result.needsRepair,
        },
      };
    }
    if (body.operation === "commit-review-cycle") {
      const result = await dependencies.commitReviewCycle(body);
      return {
        status: 200,
        body: {
          ok: true,
          operation: body.operation,
          duplicate: result.duplicate,
          receipt: result.receipt,
          remainingDueCount: result.remainingDueCount,
          nextDueAtIso: result.nextDueAtIso,
        },
      };
    }
    return {
      status: 400,
      body: { error: "INVALID_WINDDOWN_REVIEW_OPERATION" },
    };
  } catch (error) {
    if (error instanceof WindDownReviewCycleError) {
      return { status: error.status, body: { error: error.code } };
    }
    if (
      error instanceof MonaVnextProfileCoordinatorError &&
      (error.status === 400 || error.status === 409)
    ) {
      return { status: error.status, body: { error: error.code } };
    }
    if (error instanceof WindDownReviewPersistenceError) {
      return { status: error.status, body: { error: error.code } };
    }
    throw error;
  }
}
