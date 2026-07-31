import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  commitWindDownVoiceReportThroughCoordinator,
  MonaVnextProfileCoordinatorError,
} from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import {
  buildWindDownVoiceReport,
  type WindDownVoiceReportInput,
} from "@/features/winddown/voice/report";
import {
  readWindDownVoiceSessionProofChainContext,
} from "@/features/winddown/server/voiceSessionProof";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body) return noStoreJson({ error: "INVALID_JSON" }, 400);

  let report;
  try {
    report = buildWindDownVoiceReport(
      body as unknown as WindDownVoiceReportInput,
    );
  } catch (error) {
    if (
      error instanceof Error
      && error.message === "winddown_voice_report_session_proof_invalid"
    ) {
      return noStoreJson({
        error: "INVALID_WINDDOWN_VOICE_REPORT_SESSION_PROOF",
      }, 403);
    }
    return noStoreJson({ error: "INVALID_WINDDOWN_VOICE_REPORT" }, 400);
  }
  const proofContext = await readWindDownVoiceSessionProofChainContext({
    activity: report.activity,
    productSessionId: report.productSessionId,
    descriptor: report.descriptor,
    conversationIds: report.conversationIds,
    sessionProofs: report.sessionProofs,
    startedAtIso: report.startedAtIso,
    stoppedAtIso: report.stoppedAtIso,
  });
  if (!proofContext) {
    return noStoreJson({
      error: "INVALID_WINDDOWN_VOICE_REPORT_SESSION_PROOF",
    }, 403);
  }
  const canonical = JSON.stringify(report);
  const finalDigest = await sha256Hex(canonical);
  const receipt = {
    schemaVersion: 1 as const,
    activity: report.activity,
    productSessionId: report.productSessionId,
    finalDigest,
    committedAtIso: new Date().toISOString(),
    report,
    journeyTargets: proofContext.journeyTargets,
  };

  try {
    const committed =
      await commitWindDownVoiceReportThroughCoordinator(receipt);
    return noStoreJson({
      ok: true,
      duplicate: committed.duplicate === true,
      receipt: committed.receipt,
    });
  } catch (error) {
    if (
      error instanceof MonaVnextProfileCoordinatorError &&
      (error.status === 400 || error.status === 409)
    ) {
      return noStoreJson({ error: error.code }, error.status);
    }
    return noStoreJson({ error: "WINDDOWN_VOICE_REPORT_FAILED" }, 500);
  }
}
