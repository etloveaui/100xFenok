import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import { appendMonaVnextVoiceLog } from "@/features/mona-vnext/logging/voiceLogWriter";

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
  const authenticated = await verifyAdminSessionToken(token);
  if (authenticated) return null;
  return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
}

export async function POST(request: Request) {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return noStoreJson({ error: "INVALID_JSON" }, 400);

  const result = await appendMonaVnextVoiceLog(body);
  return noStoreJson(result);
}
