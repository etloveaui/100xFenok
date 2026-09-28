import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  commitWindDownLearnAttemptThroughCoordinator,
  MonaVnextProfileCoordinatorError,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  getWindDownHabitKstDay,
} from "@/features/winddown/habit/domain";
import {
  verifyWindDownLearnSessionProof,
} from "@/features/winddown/server/learnSessionProof";
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return noStoreJson({ error: "INVALID_WINDDOWN_LEARN_ATTEMPT" }, 400);
    }
    const source = body as Record<string, unknown>;
    const expected = new Set([
      "schemaVersion",
      "activity",
      "attemptId",
      "sessionProof",
      "action",
    ]);
    const now = new Date();
    const manifest = await verifyWindDownLearnSessionProof({
      proof: source.sessionProof,
      now,
    });
    if (
      Object.keys(source).length !== expected.size
      || !Object.keys(source).every((key) => expected.has(key))
      || source.schemaVersion !== 2
      || source.activity !== "learn"
      || typeof source.attemptId !== "string"
      || !/^[A-Za-z0-9._:-]{1,160}$/.test(source.attemptId)
      || !manifest
      || manifest.habitKstDay !== getWindDownHabitKstDay(now)
    ) {
      return noStoreJson({ error: "INVALID_WINDDOWN_LEARN_ATTEMPT" }, 400);
    }
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
    if (manifest.contentDigest !== material.metadata.contentDigest) {
      return noStoreJson({ error: "MATERIAL_VERSION_CHANGED" }, 409);
    }
    const byId = new Map(material.entries.map((entry) => [entry.id, entry]));
    const cards = manifest.cardIds.flatMap((id) => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
    if (cards.length !== manifest.cardIds.length) {
      return noStoreJson({ error: "MATERIAL_VERSION_CHANGED" }, 409);
    }
    const stored = await commitWindDownLearnAttemptThroughCoordinator({
      manifest,
      cards,
      attemptId: source.attemptId,
      action: source.action as never,
      now,
    });
    return noStoreJson({
      ok: true,
      schemaVersion: 2,
      activity: "learn",
      attemptId: source.attemptId,
      persisted: stored.persisted === true,
      duplicate: stored.duplicate === true,
      outcome: stored.outcome,
      reward: stored.reward,
      state: stored.state,
      completionReceipt: stored.completionReceipt ?? null,
      backend: "durable-object",
    });
  } catch (error) {
    if (error instanceof MonaVnextProfileCoordinatorError) {
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
