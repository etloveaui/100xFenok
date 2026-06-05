import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function POST(request: Request) {
  await request.json().catch(() => null);

  return NextResponse.json(
    {
      error: "REAL_LIVE_WEBSOCKET_REQUIRED",
      message: "Use /api/admin/live/session/ to mint an ephemeral token, then send turns over Gemini Live WebSocket.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
