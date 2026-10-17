import { NextResponse } from "next/server";
import { getMarketQualityManifest } from "@/lib/server/data-loader";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getMarketQualityManifest();
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "MARKET_QUALITY_MANIFEST_FAILED",
        message,
      },
      { status: 500 },
    );
  }
}
