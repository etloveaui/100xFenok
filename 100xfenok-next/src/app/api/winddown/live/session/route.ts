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
    return noStoreJson(await createWindDownVoiceSession(body));
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
