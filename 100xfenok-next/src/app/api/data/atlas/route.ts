import { NextResponse } from "next/server";
import { getDataAtlas } from "@/lib/server/data-loader";

export const dynamic = "force-static";
export const revalidate = false;

export async function GET() {
  try {
    const payload = await getDataAtlas();
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "DATA_ATLAS_FAILED",
        message,
      },
      { status: 500 },
    );
  }
}
