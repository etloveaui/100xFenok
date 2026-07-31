import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  classifyMonaVnextLearningProfile,
} from "@/features/mona-vnext/memory/fsrsLearningProfile";
import {
  readMonaVnextLearningProfileThroughCoordinator,
  readWindDownHabitThroughCoordinator,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  getWindDownReviewJourneyTarget,
} from "@/features/winddown/model/productContract";

export const dynamic = "force-dynamic";
export const revalidate = false;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function requireAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  return verifyAdminSessionToken(token);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export async function GET() {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }
  try {
    const now = new Date();
    const [habit, profile] = await Promise.all([
      readWindDownHabitThroughCoordinator(now),
      readMonaVnextLearningProfileThroughCoordinator(),
    ]);
    if (!isRecord(habit.projection)) {
      return noStoreJson({ error: "WINDDOWN_HABIT_PROJECTION_INVALID" }, 500);
    }
    if (
      !isRecord(habit.game)
      || habit.game.schemaVersion !== 1
      || !isNonNegativeInteger(habit.game.xp)
      || !isNonNegativeInteger(habit.game.creditedAnswerCount)
      || !isNonNegativeInteger(habit.game.collectedReviewStarCount)
      || !isNonNegativeInteger(habit.game.creditedNightCount)
    ) {
      return noStoreJson({ error: "WINDDOWN_GAME_PROJECTION_INVALID" }, 500);
    }
    const projection = habit.projection;
    const currentKstDay =
      typeof projection.currentKstDay === "string"
        ? projection.currentKstDay
        : "";
    const history = Array.isArray(projection.questHistory)
      ? projection.questHistory.filter(isRecord)
      : [];
    const tonightEvents = history.filter(
      (event) => event.kstDay === currentKstDay,
    );
    const activeLearn = isRecord(habit.activeLearn)
      ? habit.activeLearn
      : null;
    const activeLearnState = isRecord(activeLearn?.state)
      ? activeLearn.state
      : null;
    const activeCredited = Array.isArray(activeLearnState?.creditedCardIds)
      ? activeLearnState.creditedCardIds.length
      : 0;
    const learnCompleted = tonightEvents.some(
      (event) => event.activity === "learn",
    );
    const learnCreditedCount = learnCompleted
      ? 5
      : Math.max(0, Math.min(5, activeCredited));
    const reviewCompletedCount = tonightEvents.filter(
      (event) => event.activity === "review",
    ).length;
    const dueCount = classifyMonaVnextLearningProfile(
      profile,
      now,
    ).dueExpressionIds.length;
    const { target: reviewTarget } = getWindDownReviewJourneyTarget({
      completedCount: reviewCompletedCount,
      dueCount,
    });
    const voiceCompleted = tonightEvents.some(
      (event) => event.activity === "roleplay",
    );
    const reviewsDone = reviewCompletedCount >= reviewTarget;
    const completed = reviewsDone && learnCreditedCount >= 5 && voiceCompleted;
    const nextAction = !reviewsDone
      ? "review"
      : learnCreditedCount < 5
        ? "learn"
        : !voiceCompleted
          ? "roleplay"
          : "free";
    const estimatedMinutes =
      Math.max(0, reviewTarget - reviewCompletedCount)
      + Math.max(0, 5 - learnCreditedCount)
      + (voiceCompleted ? 0 : 3);
    return noStoreJson({
      ok: true,
      projection,
      game: {
        schemaVersion: 1,
        xp: habit.game.xp,
        creditedAnswerCount: habit.game.creditedAnswerCount,
        collectedReviewStarCount: habit.game.collectedReviewStarCount,
        creditedNightCount: habit.game.creditedNightCount,
      },
      tonight: {
        completed,
        nextAction,
        learnCreditedCount,
        learnTarget: 5,
        reviewCompletedCount,
        reviewTarget,
        voiceCompleted,
        estimatedMinutes,
      },
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error("WINDDOWN_HABIT_READ_FAILED", { requestId, error });
    return noStoreJson(
      { error: "WINDDOWN_HABIT_READ_FAILED", requestId },
      500,
    );
  }
}
