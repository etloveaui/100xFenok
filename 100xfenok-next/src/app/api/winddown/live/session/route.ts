import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  WindDownVoiceSessionError,
  createWindDownVoiceSession,
  getWindDownVoiceMissingEnvironment,
} from "@/features/winddown/server/voiceSession";
import {
  WindDownVoiceSessionRequestError,
} from "@/features/winddown/voice/sessionContract";
import {
  readWindDownHabitThroughCoordinator,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  loadWindDownStudyMaterial,
} from "@/features/winddown/server/publishedMaterialAdapter";
import type {
  WindDownVoiceJourneyTarget,
} from "@/features/winddown/voice/journeyTarget";

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

async function tonightJourneyTargets(now: Date) {
  const habit = await readWindDownHabitThroughCoordinator(now);
  const projection = isRecord(habit.projection) ? habit.projection : null;
  const currentKstDay =
    typeof projection?.currentKstDay === "string"
      ? projection.currentKstDay
      : "";
  const history = Array.isArray(projection?.questHistory)
    ? projection.questHistory.filter(isRecord)
    : [];
  const activeLearn = isRecord(habit.activeLearn) ? habit.activeLearn : null;
  const activeState = isRecord(activeLearn?.state) ? activeLearn.state : null;
  const learnedIds = Array.isArray(activeState?.creditedCardIds)
    ? activeState.creditedCardIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const reviewedIds = history.flatMap((event) => {
    if (event.kstDay !== currentKstDay || event.activity !== "review") return [];
    const source = isRecord(event.source) ? event.source : null;
    return typeof source?.materialId === "string" ? [source.materialId] : [];
  });
  const selectedIds = [...new Set([...learnedIds, ...reviewedIds])].slice(-2);
  if (selectedIds.length === 0) return [];
  const material = await loadWindDownStudyMaterial({
    dueExpressionIds: [],
    deferredExpressionIds: [],
  });
  if (
    material.metadata.source !== "published-lkg"
    || material.metadata.publicationStatus !== "active"
  ) return [];
  const byId = new Map(material.entries.map((entry) => [entry.id, entry]));
  return selectedIds.flatMap((id): WindDownVoiceJourneyTarget[] => {
    const entry = byId.get(id);
    return entry
      ? [{
          materialId: entry.id,
          en: entry.en,
          acceptedVariants: entry.acceptedVariants ?? [],
        }]
      : [];
  });
}

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }
  const body = await request.json().catch(() => null);
  try {
    const now = new Date();
    const journeyTargets =
      isRecord(body) && body.activity === "roleplay"
        ? await tonightJourneyTargets(now)
        : [];
    return noStoreJson(await createWindDownVoiceSession(body, {
      now: () => now,
      journeyTargets,
    }));
  } catch (error) {
    if (error instanceof WindDownVoiceSessionRequestError) {
      return noStoreJson({ error: error.code }, error.status);
    }
    if (error instanceof WindDownVoiceSessionError) {
      return noStoreJson({
        error: error.code,
        ...(error.code === "MISSING_GEMINI_API_KEY"
          ? { missingEnv: getWindDownVoiceMissingEnvironment() }
          : {}),
        ...(error.providerStatus === undefined
          ? {}
          : { providerStatus: error.providerStatus }),
      }, error.status);
    }
    return noStoreJson({ error: "WINDDOWN_VOICE_SESSION_FAILED" }, 500);
  }
}
