import { NextResponse } from "next/server";
import { resolveCurrentSession } from "@/lib/server/authSession";
import { resolveUserRegistry } from "@/lib/server/userRegistry";

export const dynamic = "force-dynamic";
export const revalidate = false;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
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

  await registry.ping(session.sub);

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
