import {
  parseWindDownPracticeQuery,
  isWindDownPracticeResponse,
  WINDDOWN_PRACTICE_MATERIAL_LIMIT,
  type WindDownPracticeResponse,
} from "@/features/winddown/drill/practice";
import { readWindDownConversationsThroughCoordinator, MonaVnextProfileCoordinatorError } from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import type { WindDownVoiceReportReceipt } from "@/features/mona-vnext/memory/learningProfileCoordinator";
import { extractWindDownVoicePracticeSeeds } from "@/features/winddown/voice/practiceSeed";
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
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function requireAdminSession() {
  const cookieStore = await cookies();
  return verifyAdminSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null,
  );
}

export async function GET(request: Request) {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }

  const query = parseWindDownPracticeQuery(new URL(request.url).searchParams);
  if (query.kind === "error") return noStoreJson({ error: "INVALID_WINDDOWN_PRACTICE_QUERY" }, 400);
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
      || material.entries.length === 0
      || (query.kind === "none" && (material.entries.length < 3
        || new Set(material.entries.map((entry) => entry.ko.trim())).size < 3))
    ) {
      return noStoreJson({ error: "WINDDOWN_MATERIAL_UNAVAILABLE" }, 503);
    }
    if (query.kind !== "none") {
      if (material.entries.length > WINDDOWN_PRACTICE_MATERIAL_LIMIT) return noStoreJson({ error: "WINDDOWN_PRACTICE_MATERIAL_UNAVAILABLE" }, 503);
      const authoredPractice = new Map(material.practiceForExpressionIds(material.entries.map(entry => entry.id))
        .map(({ materialId, ...practice }) => [materialId, practice]));
      const materials = material.entries.map(entry => ({
        id: entry.id, ko: entry.ko, en: entry.en, acceptedVariants: entry.acceptedVariants ?? [],
        ...(authoredPractice.has(entry.id) ? { practice: authoredPractice.get(entry.id)! } : {}),
      }));
      if (query.kind === "canonical-material" && !materials.some(entry => entry.id === query.materialId)) {
        return noStoreJson({ error: "WINDDOWN_PRACTICE_MATERIAL_NOT_FOUND" }, 404);
      }
      let voiceCorrection: WindDownPracticeResponse["voiceCorrection"];
      if (query.kind === "voice-correction") {
        const result = await readWindDownConversationsThroughCoordinator({ session: query.citation.productSessionId });
        // The archive boundary validates the immutable report and its digest.
        const receipt = result.receipt as WindDownVoiceReportReceipt;
        const seed = extractWindDownVoicePracticeSeeds(receipt).find(candidate =>
          candidate.citation.source === query.citation.sourceConversationId && candidate.citation.turn === query.citation.turnSeq);
        if (!seed) return noStoreJson({ error: "WINDDOWN_PRACTICE_CITATION_NOT_FOUND" }, 404);
        voiceCorrection = { citation: query.citation, learnerText: seed.learnerText, modelCorrection: seed.modelCorrection };
      }
      const response: WindDownPracticeResponse = {
        ok: true, schemaVersion: 1, mode: "practice", modelOpened: false,
        material: { source: "published-lkg", publicationStatus: "active", contentDigest: material.metadata.contentDigest },
        materials, target: query, ...(voiceCorrection ? { voiceCorrection } : {}),
      };
      if (!isWindDownPracticeResponse(response)) return noStoreJson({ error: "WINDDOWN_PRACTICE_MATERIAL_UNAVAILABLE" }, 503);
      return noStoreJson(response);
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
    if (query.kind !== "none") {
      const missing = error instanceof MonaVnextProfileCoordinatorError && error.code === "WINDDOWN_CONVERSATION_NOT_FOUND";
      return noStoreJson({ error: missing ? "WINDDOWN_PRACTICE_CITATION_NOT_FOUND" : "WINDDOWN_PRACTICE_UNAVAILABLE" }, missing ? 404 : 503);
    }
    const requestId = crypto.randomUUID();
    console.error("WINDDOWN_DRILL_BOOTSTRAP_FAILED", { requestId, error });
    return noStoreJson({ error: "WINDDOWN_DRILL_BOOTSTRAP_FAILED", requestId }, 500);
  }
}
