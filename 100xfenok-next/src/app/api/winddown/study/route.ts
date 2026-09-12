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
import { classifyWindDownReviewProfile } from "@/features/winddown/server/reviewIdentity";
import {
  getWindDownHabitKstDay,
} from "@/features/winddown/habit/domain";
import {
  createWindDownLearnSessionProof,
  WIND_DOWN_LEARN_SESSION_TTL_MS,
  type WindDownLearnSessionManifest,
} from "@/features/winddown/server/learnSessionProof";
import { selectWindDownLearnResume } from "@/features/winddown/server/learnResume";
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

const LEARN_ACTION_LINKS = {
  review: "/winddown/review",
  drill: "/winddown/drill",
  home: "/winddown",
} as const;

function learnUnavailable(
  error: "WINDDOWN_LEARN_RESUME_UNAVAILABLE" | "WINDDOWN_LEARN_NO_NEW_MATERIAL",
) {
  return noStoreJson({
    schemaVersion: 1,
    mode: "learn",
    modelOpened: false,
    error,
    availability: error === "WINDDOWN_LEARN_NO_NEW_MATERIAL"
      ? "no-new-material"
      : "resume-unavailable",
    links: LEARN_ACTION_LINKS,
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
    const material = await loadWindDownStudyMaterial(learningSelection);
    const learning = {
      updatedAt: learningProfile.updatedAt,
      recordCount: Object.keys(learningProfile.records).length,
      ...classifyWindDownReviewProfile({
        profile: learningProfile,
        activeMaterialIds: material.entries.map((entry) => entry.id),
        aliases: material.aliases,
        nowIso: now.toISOString(),
      }),
    };
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
      learningProfile,
      practice: material.practiceForExpressionIds(material.entries.map(entry => entry.id)),
      dueExpressionIds: learning.dueExpressionIds,
      deferredExpressionIds: learning.deferredExpressionIds,
      count: mode === "review"
        ? reviewJourney.remaining
        : WINDDOWN_LEARN_CREDIT_TARGET,
    });
    let cards = bootstrap.cards;
    let selectionBasis: string | undefined = "selectionBasis" in bootstrap ? bootstrap.selectionBasis : undefined;
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
        aliases: material.aliases,
        contentDigest: material.metadata.contentDigest,
        nowIso: now.toISOString(),
      });
      inventory = {
        ...bootstrap.inventory,
        selectedCount: cards.length,
      };
    } else {
      const activeLearn =
        habit.activeLearn
        && typeof habit.activeLearn === "object"
        && !Array.isArray(habit.activeLearn)
          ? habit.activeLearn as Record<string, unknown>
          : null;
      const hasActiveLearn =
        habit.activeLearn !== null && habit.activeLearn !== undefined;
      if (
        material.metadata.source !== "published-lkg"
        || material.metadata.publicationStatus !== "active"
        || !material.metadata.contentDigest
      ) {
        return hasActiveLearn
          ? learnUnavailable("WINDDOWN_LEARN_RESUME_UNAVAILABLE")
          : noStoreJson({ error: "WINDDOWN_MATERIAL_UNAVAILABLE" }, 503);
      }
      const resumed = hasActiveLearn
        ? selectWindDownLearnResume({
            entries: material.entries,
            manifest: activeLearn?.manifest,
            state: activeLearn?.state,
            habitKstDay,
            contentDigest: material.metadata.contentDigest,
            now,
          })
        : null;
      if (hasActiveLearn && !resumed) {
        return learnUnavailable("WINDDOWN_LEARN_RESUME_UNAVAILABLE");
      }
      if (!hasActiveLearn && cards.length !== WINDDOWN_LEARN_CREDIT_TARGET) {
        return learnUnavailable("WINDDOWN_LEARN_NO_NEW_MATERIAL");
      }
      const issuedAtMs = now.getTime();
      const manifest: WindDownLearnSessionManifest =
        resumed
          ? {
              ...resumed.manifest,
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
      if (resumed) {
        selectionBasis = "saved-session";
        cards = resumed.cards;
        inventory = {
          ...inventory,
          selectedCount: cards.length,
          insufficientFreshCount: 0,
        };
      }
      learnSession = {
        manifest,
        proof: await createWindDownLearnSessionProof(manifest),
        resumeState: resumed?.state ?? null,
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
      ...(mode === "learn" ? { selectionBasis } : {}),
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
