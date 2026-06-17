import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import { MONA_VNEXT_NAMESPACE_POLICY } from "@/features/mona-vnext/memory/monaVnextNamespace";
import {
  appendMonaVnextMemoryCheckpoint,
  readMonaVnextMemorySummary,
} from "@/features/mona-vnext/memory/monaMemoryRepository";

export const dynamic = "force-dynamic";
export const revalidate = false;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "UNKNOWN_ERROR");
}

async function requireAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const authenticated = await verifyAdminSessionToken(token);
  if (authenticated) return null;
  return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
}

export async function GET() {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;
  try {
    const memory = await readMonaVnextMemorySummary();
    return noStoreJson({
      namespace: MONA_VNEXT_NAMESPACE_POLICY,
      mode: "owner-test-only",
      memory,
    });
  } catch (error) {
    return noStoreJson({
      ok: false,
      error: "MONA_VNEXT_MEMORY_READ_FAILED",
      detail: errorDetail(error),
    }, 500);
  }
}

export async function POST(request: Request) {
  const blocked = await requireAdminSession();
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return noStoreJson({ error: "INVALID_JSON" }, 400);

  try {
    const result = await appendMonaVnextMemoryCheckpoint(body);
    return noStoreJson(result);
  } catch (error) {
    return noStoreJson({
      ok: false,
      error: "MONA_VNEXT_MEMORY_WRITE_FAILED",
      detail: errorDetail(error),
    }, 500);
  }
}
