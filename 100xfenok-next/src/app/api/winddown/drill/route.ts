import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  createWindDownDrillSession,
} from "@/features/winddown/drill/engine";
import {
  getWindDownHabitKstDay,
} from "@/features/winddown/habit/domain";
import {
  loadWindDownStudyMaterial,
} from "@/features/winddown/server/publishedMaterialAdapter";

export const dynamic = "force-dynamic";
export const revalidate = false;

const SHA256_HEX = /^[a-f0-9]{64}$/;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function requireAdminSession() {
  const cookieStore = await cookies();
  return verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );
}

export async function GET() {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }

  try {
    const material = await loadWindDownStudyMaterial({
      dueExpressionIds: [],
      deferredExpressionIds: [],
    });
    if (
      material.metadata.source !== "published-lkg"
      || material.metadata.publicationStatus !== "active"
      || !material.metadata.contentDigest
      || !SHA256_HEX.test(material.metadata.contentDigest)
      || material.entries.length < 3
      || new Set(material.entries.map((entry) => entry.ko.trim())).size < 3
    ) {
      return noStoreJson({ error: "WINDDOWN_MATERIAL_UNAVAILABLE" }, 503);
    }
    const seed = `${getWindDownHabitKstDay(new Date())}:quick-drill`;
    const session = createWindDownDrillSession({
      cards: material.entries,
      seed,
    });
    return noStoreJson({
      ok: true,
      schemaVersion: 1,
      mode: "drill",
      modelOpened: false,
      material: {
        source: material.metadata.source,
        publicationStatus: material.metadata.publicationStatus,
        contentDigest: material.metadata.contentDigest,
      },
      session,
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error("WINDDOWN_DRILL_BOOTSTRAP_FAILED", { requestId, error });
    return noStoreJson({ error: "WINDDOWN_DRILL_BOOTSTRAP_FAILED", requestId }, 500);
  }
}
