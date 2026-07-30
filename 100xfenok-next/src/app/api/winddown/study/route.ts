import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  readMonaVnextLearningProfileState,
} from "@/features/mona-vnext/memory/monaMemoryRepository";
import {
  classifyMonaVnextLearningProfile,
} from "@/features/mona-vnext/memory/fsrsLearningProfile";
import { buildWindDownStudyBootstrap } from "@/features/winddown/server/studyBootstrap";
import { loadWindDownStudyMaterial } from "@/features/winddown/server/publishedMaterialAdapter";
import { buildWindDownReviewCards } from "@/features/winddown/server/reviewCycle";
import {
  normalizeWindDownStudyCount,
  normalizeWindDownStudyMode,
  normalizeWindDownStudySeed,
} from "@/features/winddown/server/studyRequest";

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

export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }

  const url = new URL(request.url);
  const mode = normalizeWindDownStudyMode(url.searchParams.get("mode"));
  if (!mode) return noStoreJson({ error: "INVALID_WINDDOWN_STUDY_MODE" }, 400);

  try {
    const now = new Date();
    const learningProfile = await readMonaVnextLearningProfileState();
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
    const bootstrap = buildWindDownStudyBootstrap({
      mode,
      seed: normalizeWindDownStudySeed(url.searchParams.get("seed"), mode),
      entries: material.entries,
      dueExpressionIds: material.dueExpressionIds,
      deferredExpressionIds: material.deferredExpressionIds,
      count: normalizeWindDownStudyCount(url.searchParams.get("count")),
    });
    let cards = bootstrap.cards;
    let inventory = bootstrap.inventory;
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
