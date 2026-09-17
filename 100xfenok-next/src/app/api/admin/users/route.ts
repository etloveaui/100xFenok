import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import { resolveUserRegistry } from "@/lib/server/userRegistry";

export const dynamic = "force-dynamic";
export const revalidate = false;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function getAdminToken(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get("Cookie") || request.headers.get("cookie") || "";
  if (cookieHeader) {
    const cookiesList = cookieHeader.split(";").map((c) => c.trim());
    for (const c of cookiesList) {
      if (c.startsWith(`${ADMIN_SESSION_COOKIE}=`)) {
        return c.slice(`${ADMIN_SESSION_COOKIE}=`.length).trim();
      }
    }
  }

  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    return cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const adminToken = await getAdminToken(request);
  const authenticated = await verifyAdminSessionToken(adminToken);
  if (!authenticated) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const registry = await resolveUserRegistry();
  const [stats, users] = await Promise.all([
    registry.getStats(),
    registry.listUsers(),
  ]);

  return NextResponse.json(
    { ok: true, stats, users },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  const adminToken = await getAdminToken(request);
  const authenticated = await verifyAdminSessionToken(adminToken);
  if (!authenticated) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const sub = typeof body?.sub === "string" ? body.sub.trim() : "";

  if (!sub || !action) {
    return NextResponse.json(
      { ok: false, error: "sub and action are required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const registry = await resolveUserRegistry();

  if (action === "block") {
    await registry.setBlocked(sub, true);
    return NextResponse.json(
      { ok: true, blocked: true },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  if (action === "unblock") {
    await registry.setBlocked(sub, false);
    return NextResponse.json(
      { ok: true, blocked: false },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  if (action === "revokeAll") {
    await registry.revokeAll(sub);
    return NextResponse.json(
      { ok: true, revoked: true },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { ok: false, error: `Unknown action: ${action}` },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}
