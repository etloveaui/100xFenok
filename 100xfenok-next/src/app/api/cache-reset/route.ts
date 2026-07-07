import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      cleared: ["http-cache"],
      clientActions: ["service-worker-unregister", "cache-storage-delete", "design-cookie-delete"],
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Clear-Site-Data": '"cache"',
      },
    },
  );
}
