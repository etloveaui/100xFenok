import { NextResponse } from "next/server";
import {
  createSessionCookieHeader,
  resolveCurrentSession,
} from "@/lib/server/authSession";
import { resolveUserRegistry } from "@/lib/server/userRegistry";

export const dynamic = "force-dynamic";
export const revalidate = false;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const session = await resolveCurrentSession(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const registry = await resolveUserRegistry();
  if (await registry.isBlocked(session.sub)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: Account is blocked" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const settings = await session.store.getSettings();

  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  // If session came from cookie, keep sliding refresh alive
  if (session.source === "cookie") {
    headers["Set-Cookie"] = createSessionCookieHeader(session.token);
  }

  return NextResponse.json(
    {
      ok: true,
      user: session.user,
      settings,
    },
    {
      status: 200,
      headers,
    },
  );
}
