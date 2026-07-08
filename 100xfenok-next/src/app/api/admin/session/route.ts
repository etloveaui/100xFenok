import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  isAdminAuthConfigured,
  verifyAdminPasswordServer,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";
import {
  adminLoginRetryAfterSeconds,
  checkAdminLoginThrottle,
  clearAdminLoginFailures,
  getAdminLoginClientKey,
  registerAdminLoginFailure,
  type AdminLoginThrottleResult,
} from "@/lib/server/admin-login-throttle";

export const dynamic = "force-dynamic";
export const revalidate = false;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function tooManyAttemptsResponse(throttle: AdminLoginThrottleResult) {
  return NextResponse.json(
    { error: "TOO_MANY_ATTEMPTS", retryAfterMs: throttle.retryAfterMs },
    {
      status: 429,
      headers: {
        ...NO_STORE_HEADERS,
        "Retry-After": String(adminLoginRetryAfterSeconds(throttle.retryAfterMs)),
      },
    },
  );
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const authenticated = await verifyAdminSessionToken(token);
  return NextResponse.json(
    { authenticated },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      { error: "ADMIN_AUTH_NOT_CONFIGURED" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const clientKey = getAdminLoginClientKey(request);
  const currentThrottle = checkAdminLoginThrottle(clientKey);
  if (currentThrottle.limited) return tooManyAttemptsResponse(currentThrottle);

  const body = (await request.json().catch(() => null)) as
    | { password?: string }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password.trim()) {
    return NextResponse.json(
      { error: "PASSWORD_REQUIRED" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const matched = await verifyAdminPasswordServer(password);
  if (!matched) {
    const failedThrottle = registerAdminLoginFailure(clientKey);
    if (failedThrottle.limited) return tooManyAttemptsResponse(failedThrottle);

    return NextResponse.json(
      { error: "INVALID_PASSWORD" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  clearAdminLoginFailures(clientKey);
  const response = NextResponse.json(
    { authenticated: true },
    { headers: NO_STORE_HEADERS },
  );
  const now = Date.now();
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    await createAdminSessionToken(now),
    getAdminSessionCookieOptions(now),
  );
  return response;
}

export async function DELETE() {
  const response = NextResponse.json(
    { authenticated: false },
    { headers: NO_STORE_HEADERS },
  );
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    ...getAdminSessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
  return response;
}
