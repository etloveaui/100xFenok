import { NextResponse } from "next/server";
import {
  createSessionCookieHeader,
  getGoogleVerifier,
  resolveUserStore,
} from "@/lib/server/authSession";

export const dynamic = "force-dynamic";
export const revalidate = false;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) {
    return NextResponse.json(
      { ok: false, error: "idToken is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const verifier = getGoogleVerifier();
  const payload = await verifier.verify(idToken);
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "Invalid or unverified Google ID token" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const store = await resolveUserStore(payload.sub);
  const profile = await store.saveProfile({
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  });

  const deviceHint = typeof body?.deviceHint === "string" ? body.deviceHint : undefined;
  const { token, expiresAt } = await store.mintToken(deviceHint);

  const cookieHeader = createSessionCookieHeader(token);

  return NextResponse.json(
    { ok: true, token, expiresAt, user: profile },
    {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Set-Cookie": cookieHeader,
      },
    },
  );
}
