import type { Metadata } from "next";
import BriefHubClient from "@/components/brief/BriefHubClient";
import AppShell from "@/components/shell/AppShell";
import { BRIEF_DATE_RE, BRIEF_INDEX_URL, BRIEF_OG_IMAGE, briefMorningOgImageUrl } from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";
import { readDataAsset } from "@/lib/server/data-asset-reader";
import { canonicalPath, canonicalUrl, siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const TITLE = "브리핑";
const DESCRIPTION = "방금 끝난 미국장부터 오늘 밤 일정까지, 투자자의 하루를 여는 100x 브리핑";

/** The latest morning edition date from the briefing index; null when unreadable. */
async function readLatestMorning(): Promise<string | null> {
  try {
    const result = await readDataAsset(BRIEF_INDEX_URL);
    if (result.kind !== "ok") return null;
    const latest = (JSON.parse(result.raw) as { latest?: { morning?: unknown } }).latest?.morning;
    return typeof latest === "string" && BRIEF_DATE_RE.test(latest) ? latest : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const latest = await readLatestMorning();
  const image = latest
    ? { url: new URL(briefMorningOgImageUrl(latest), siteOrigin).toString(), ...BRIEF_OG_IMAGE, alt: "100x 모닝 브리프" }
    : null;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: canonicalPath(ROUTES.brief) },
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: "FenoK",
      title: "100x 브리핑",
      description: DESCRIPTION,
      url: canonicalUrl(ROUTES.brief),
      ...(image ? { images: [image] } : {}),
    },
    ...(image ? { twitter: { card: "summary_large_image", title: "100x 브리핑", description: DESCRIPTION, images: [image.url] } } : {}),
  };
}

export default function BriefHubPage() {
  return (
    <AppShell active="brief" title={TITLE}>
      <BriefHubClient />
    </AppShell>
  );
}
