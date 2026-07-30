import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  executeWindDownReviewApiRequest,
} from "@/features/winddown/server/reviewApi";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

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
  return verifyAdminSessionToken(token);
}

export async function POST(request: Request) {
  if (!(await requireAdminSession())) {
    return noStoreJson({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  }
  const body = await request.json().catch(() => null);
  try {
    const result = await executeWindDownReviewApiRequest(body);
    return noStoreJson(result.body, result.status);
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error("WINDDOWN_REVIEW_FAILED", { requestId, error });
    return noStoreJson(
      { error: "WINDDOWN_REVIEW_FAILED", requestId },
      500,
    );
  }
}
