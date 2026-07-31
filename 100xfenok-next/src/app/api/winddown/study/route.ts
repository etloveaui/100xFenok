import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  readMonaVnextLearningProfileThroughCoordinator,
  readWindDownHabitThroughCoordinator,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  classifyMonaVnextLearningProfile,
} from "@/features/mona-vnext/memory/fsrsLearningProfile";
import { buildWindDownStudyBootstrap } from "@/features/winddown/server/studyBootstrap";
import { loadWindDownStudyMaterial } from "@/features/winddown/server/publishedMaterialAdapter";
import { buildWindDownReviewCards } from "@/features/winddown/server/reviewCycle";
import {
  getWindDownHabitKstDay,
} from "@/features/winddown/habit/domain";
import {
  createWindDownLearnSessionProof,
  normalizeWindDownLearnSessionManifest,
  WIND_DOWN_LEARN_SESSION_TTL_MS,
  type WindDownLearnSessionManifest,
} from "@/features/winddown/server/learnSessionProof";
import {
  getWindDownReviewJourneyTarget,
} from "@/features/winddown/model/productContract";
import {
  WINDDOWN_LEARN_CREDIT_TARGET,
} from "@/features/winddown/learn/engine";
import {
  normalizeWindDownStudyMode,
  normalizeWindDownStudySeed,
} from "@/features/winddown/server/studyRequest";

export const dynamic = "force-dynamic";
export const revalidate = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }

  const url = new URL(request.url);
  const mode = normalizeWindDownStudyMode(url.searchParams.get("mode"));
  if (!mode) return noStoreJson({ error: "INVALID_WINDDOWN_STUDY_MODE" }, 400);

  try {
    const now = new Date();
    const [learningProfile, habit] = await Promise.all([
      readMonaVnextLearningProfileThroughCoordinator(),
      readWindDownHabitThroughCoordinator(now),
    ]);
    const learningSelection = classifyMonaVnextLearningProfile(
      learningProfile,
      now,
    );
    const learning = {
      updatedAt: learningProfile.updatedAt,
      recordCount: Object.keys(learningProfile.records).length,
      ...learningSelection,
    };
    const material = await loadWindDownStudyMaterial({
      dueExpressionIds: learning.dueExpressionIds,
      deferredExpressionIds: learning.deferredExpressionIds,
    });
    const habitKstDay = getWindDownHabitKstDay(now);
    const projection = isRecord(habit.projection) ? habit.projection : null;
    const questHistory = Array.isArray(projection?.questHistory)
      ? projection.questHistory.filter(isRecord)
      : [];
    const reviewCompletedCount = questHistory.filter(
      (event) => event.kstDay === habitKstDay && event.activity === "review",
    ).length;
    const reviewJourney = getWindDownReviewJourneyTarget({
      completedCount: reviewCompletedCount,
      dueCount: learning.dueExpressionIds.length,
    });
    const bootstrap = buildWindDownStudyBootstrap({
      mode,
      seed: mode === "learn"
        ? `${habitKstDay}:learn`
        : normalizeWindDownStudySeed(url.searchParams.get("seed"), mode),
      entries: material.entries,
      dueExpressionIds: material.dueExpressionIds,
      deferredExpressionIds: material.deferredExpressionIds,
      count: mode === "review"
        ? reviewJourney.remaining
        : WINDDOWN_LEARN_CREDIT_TARGET,
    });
    let cards = bootstrap.cards;
    let inventory = bootstrap.inventory;
    let learnSession:
      | {
          manifest: WindDownLearnSessionManifest;
          proof: string;
          resumeState: unknown | null;
        }
      | null = null;
    if (mode === "review") {
      if (
        material.metadata.source !== "published-lkg" ||
        material.metadata.publicationStatus !== "active" ||
        !material.metadata.contentDigest
      ) {
        return noStoreJson({ error: "WINDDOWN_MATERIAL_UNAVAILABLE" }, 503);
      }
      cards = await buildWindDownReviewCards({
        cards: bootstrap.cards,
        profile: learningProfile,
        contentDigest: material.metadata.contentDigest,
        nowIso: now.toISOString(),
      });
      inventory = {
        ...bootstrap.inventory,
        selectedCount: cards.length,
      };
    } else {
      if (
        material.metadata.source !== "published-lkg"
        || material.metadata.publicationStatus !== "active"
        || !material.metadata.contentDigest
        || cards.length !== WINDDOWN_LEARN_CREDIT_TARGET
      ) {
        return noStoreJson({ error: "WINDDOWN_MATERIAL_UNAVAILABLE" }, 503);
      }
      const activeLearn =
        habit.activeLearn
        && typeof habit.activeLearn === "object"
        && !Array.isArray(habit.activeLearn)
          ? habit.activeLearn as Record<string, unknown>
          : null;
      const activeManifest = normalizeWindDownLearnSessionManifest(
        activeLearn?.manifest,
      );
      const byId = new Map(material.entries.map((entry) => [entry.id, entry]));
      const resumedCards = activeManifest
        && activeManifest.habitKstDay === habitKstDay
        && activeManifest.contentDigest === material.metadata.contentDigest
          ? activeManifest.cardIds.flatMap((id) => {
              const card = byId.get(id);
              return card ? [card] : [];
            })
          : [];
      const issuedAtMs = now.getTime();
      const manifest: WindDownLearnSessionManifest =
        activeManifest && resumedCards.length === WINDDOWN_LEARN_CREDIT_TARGET
          ? {
              ...activeManifest,
              issuedAtIso: now.toISOString(),
              expiresAtIso: new Date(
                issuedAtMs + WIND_DOWN_LEARN_SESSION_TTL_MS,
              ).toISOString(),
            }
          : {
              schemaVersion: 1,
              sessionId: crypto.randomUUID(),
              habitKstDay,
              seed: bootstrap.seed,
              cardIds: cards.map((card) => card.id),
              contentDigest: material.metadata.contentDigest,
              issuedAtIso: now.toISOString(),
              expiresAtIso: new Date(
                issuedAtMs + WIND_DOWN_LEARN_SESSION_TTL_MS,
              ).toISOString(),
            };
      if (resumedCards.length === WINDDOWN_LEARN_CREDIT_TARGET) {
        cards = resumedCards;
      }
      learnSession = {
        manifest,
        proof: await createWindDownLearnSessionProof(manifest),
        resumeState: activeLearn?.state ?? null,
      };
    }
    return noStoreJson({
      ...bootstrap,
      cards,
      inventory,
      learning: {
        updatedAt: learning.updatedAt,
        recordCount: learning.recordCount,
      },
      material: material.metadata,
      materialResolution: material.resolution,
      ...(learnSession ? { learnSession } : {}),
      advisor: material.advisorForExpressionIds(
        cards.map((card) => card.id),
      ),
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error("WINDDOWN_STUDY_BOOTSTRAP_FAILED", { requestId, error });
    return noStoreJson(
      {
        error: "WINDDOWN_STUDY_BOOTSTRAP_FAILED",
        requestId,
      },
      500,
    );
  }
}
