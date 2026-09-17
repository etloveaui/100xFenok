import { NextResponse } from "next/server";
import {
  createClearSessionCookieHeader,
  parseSessionToken,
  resolveUserStore,
} from "@/lib/server/authSession";

export const dynamic = "force-dynamic";
export const revalidate = false;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const parsed = parseSessionToken(request);
  if (parsed) {
    try {
      const store = await resolveUserStore(parsed.sub);
      await store.revokeToken(parsed.secret);
    } catch {
      // Ignore revocation failure, clear cookie regardless
    }
  }

  const clearCookie = createClearSessionCookieHeader();

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Set-Cookie": clearCookie,
      },
    },
  );
}
