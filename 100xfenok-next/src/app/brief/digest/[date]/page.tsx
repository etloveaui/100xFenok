import type { Metadata } from "next";
import BriefDigestClient from "@/components/brief/BriefDigestClient";
import AppShell from "@/components/shell/AppShell";
import { BRIEF_DATE_RE, briefDigestDataUrl, dateline } from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";
import { readDataAsset } from "@/lib/server/data-asset-reader";
import { canonicalPath, canonicalUrl } from "@/lib/site-url";

interface Props {
  params: Promise<{ date: string }>;
}

export const dynamic = "force-dynamic";

const FALLBACK_DESCRIPTION = "모닝 브리프 뒤에 나온 자료로 전날 미국장을 한 걸음 더 읽는 100x 데일리 다이제스트";

/** Headline and lead of one edition for link previews; null when unreadable. */
async function readEditionSummary(date: string): Promise<{ headline: string; lead: string } | null> {
  if (!BRIEF_DATE_RE.test(date)) return null;
  try {
    const result = await readDataAsset(briefDigestDataUrl(date));
    if (result.kind !== "ok") return null;
    const doc = JSON.parse(result.raw) as { date?: unknown; headline?: unknown; lead?: unknown };
    if (doc.date !== date || typeof doc.headline !== "string" || typeof doc.lead !== "string") return null;
    return { headline: doc.headline, lead: doc.lead };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const valid = BRIEF_DATE_RE.test(date);
  const path = valid ? ROUTES.briefDigest(date) : ROUTES.brief;
  const summary = await readEditionSummary(date);
  const title = summary?.headline ?? (valid ? `데일리 다이제스트 · ${dateline(date)}` : "데일리 다이제스트");
  const description = summary?.lead ?? FALLBACK_DESCRIPTION;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonicalPath(path) },
    openGraph: { type: "article", locale: "ko_KR", siteName: "FenoK", title, description, url: canonicalUrl(path) },
    twitter: { card: "summary", title, description },
  };
}

export default async function BriefDigestPage({ params }: Props) {
  const { date } = await params;
  return (
    <AppShell active="brief" title="데일리 다이제스트">
      <BriefDigestClient date={date} />
    </AppShell>
  );
}
