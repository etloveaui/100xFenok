import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import { readMonaVnextLearningProfile } from "@/features/mona-vnext/memory/monaMemoryRepository";
import { buildWindDownStudyBootstrap } from "@/features/winddown/server/studyBootstrap";
import { loadWindDownStudyMaterial } from "@/features/winddown/server/publishedMaterialAdapter";
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
    const learning = await readMonaVnextLearningProfile();
    const material = loadWindDownStudyMaterial({
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
    return noStoreJson({
      ...bootstrap,
      learning: {
        updatedAt: learning.updatedAt,
        recordCount: learning.recordCount,
      },
      material: material.metadata,
      materialResolution: material.resolution,
      advisor: material.advisorForExpressionIds(
        bootstrap.cards.map((card) => card.id),
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
