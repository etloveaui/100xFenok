import { NextResponse } from "next/server";
import { getMacroManifest } from "@/lib/server/data-loader";

export async function GET() {
  try {
    const payload = await getMacroManifest();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
