import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  commitWindDownCeremonyChoiceThroughCoordinator,
  MonaVnextProfileCoordinatorError,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  normalizeWindDownCeremonySelection,
} from "@/features/winddown/game/model/ceremony";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  loadWindDownCeremonyMaterialContext,
  WindDownCeremonyMaterialError,
} from "@/features/winddown/server/ceremonyMaterialContext";

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
  const selection = normalizeWindDownCeremonySelection(
    await request.json().catch(() => null),
  );
  if (!selection) {
    return noStoreJson({ error: "INVALID_WINDDOWN_CEREMONY_CHOICE" }, 400);
  }
  try {
    const ceremonyMaterial = await loadWindDownCeremonyMaterialContext();
    const result = await commitWindDownCeremonyChoiceThroughCoordinator(
      { selection, ceremonyMaterial },
    );
    return noStoreJson({
      ok: true,
      duplicate: result.duplicate === true,
      choice: result.choice,
      ceremony: result.ceremony,
    });
  } catch (error) {
    if (error instanceof WindDownCeremonyMaterialError) {
      return noStoreJson({ error: error.code }, error.status);
    }
    if (error instanceof MonaVnextProfileCoordinatorError) {
      return noStoreJson({ error: error.code }, error.status);
    }
    const requestId = crypto.randomUUID();
    console.error("WINDDOWN_CEREMONY_COMMIT_FAILED", { requestId, error });
    return noStoreJson(
      { error: "WINDDOWN_CEREMONY_COMMIT_FAILED", requestId },
      500,
    );
  }
}
