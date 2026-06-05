import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import { executeLiveToolFunction } from "@/lib/server/admin-live-tools";

export const dynamic = "force-dynamic";
export const revalidate = false;

type ToolRequest = {
  id?: unknown;
  name?: unknown;
  args?: unknown;
};

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

  const body = (await request.json().catch(() => null)) as ToolRequest | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const id = typeof body?.id === "string" ? body.id : "";
  const args = body?.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {};

  const result = await executeLiveToolFunction(name, args);
  const status = "error" in result && result.error === "UNKNOWN_TOOL" ? 400 : 200;
  return noStoreJson({
    id,
    name,
    response: { result },
  }, status);
}
