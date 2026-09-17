import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const feedPath = path.join(process.cwd(), "public/data/computed/intro-feed.json");
    if (fs.existsSync(feedPath)) {
      const content = fs.readFileSync(feedPath, "utf8");
      return new NextResponse(content, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        },
      });
    }
  } catch {
    // If running in edge runtime or read fails
  }

  return NextResponse.json(
    {
      error: "INTRO_FEED_UNAVAILABLE",
    },
    { status: 404 },
  );
}
