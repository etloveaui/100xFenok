import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import { appendMonaVnextMemoryCheckpoint } from "@/features/mona-vnext/memory/monaMemoryRepository";
import {
  prepareWindDownLearnProgress,
  WindDownLearnProgressError,
} from "@/features/winddown/server/learnProgress";
import { loadWindDownStudyMaterial } from "@/features/winddown/server/publishedMaterialAdapter";

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

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }
  const body = await request.json().catch(() => null);

  try {
    const material = await loadWindDownStudyMaterial({
      dueExpressionIds: [],
      deferredExpressionIds: [],
    });
    if (
      material.metadata.source !== "published-lkg" ||
      material.metadata.publicationStatus !== "active" ||
      !material.metadata.contentDigest
    ) {
      return noStoreJson({ error: "WINDDOWN_MATERIAL_UNAVAILABLE" }, 503);
    }
    const prepared = prepareWindDownLearnProgress(body, {
      currentContentDigest: material.metadata.contentDigest,
      activeMaterialIds: new Set(material.entries.map((entry) => entry.id)),
    });
    const stored = await appendMonaVnextMemoryCheckpoint(prepared.checkpoint);
    return noStoreJson({
      ok: true,
      schemaVersion: prepared.input.schemaVersion,
      activity: prepared.input.activity,
      attemptId: prepared.input.attemptId,
      materialId: prepared.input.materialId,
      rating: prepared.learningEvent.rating,
      persisted: stored.ok === true,
      backend: stored.backend,
    });
  } catch (error) {
    if (error instanceof WindDownLearnProgressError) {
      return noStoreJson({ error: error.code }, error.status);
    }
    const requestId = crypto.randomUUID();
    console.error("WINDDOWN_LEARN_PROGRESS_FAILED", { requestId, error });
    return noStoreJson(
      { error: "WINDDOWN_LEARN_PROGRESS_FAILED", requestId },
      500,
    );
  }
}
