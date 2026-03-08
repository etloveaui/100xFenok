import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  verifyAdminPasswordServer,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const authenticated = await verifyAdminSessionToken(token);
  return NextResponse.json(
    { authenticated },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { password?: string }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password.trim()) {
    return NextResponse.json(
      { error: "PASSWORD_REQUIRED" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const matched = await verifyAdminPasswordServer(password);
  if (!matched) {
    return NextResponse.json(
      { error: "INVALID_PASSWORD" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { authenticated: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    await createAdminSessionToken(),
    getAdminSessionCookieOptions(),
  );
  return response;
}

export async function DELETE() {
  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    ...getAdminSessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
  return response;
}
