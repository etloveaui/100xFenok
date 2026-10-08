import type { Metadata } from "next";
import BriefArticleClient from "@/components/brief/BriefArticleClient";
import AppShell from "@/components/shell/AppShell";
import { BRIEF_DATE_RE, briefMorningDataUrl, dateline } from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";
import { readDataAsset } from "@/lib/server/data-asset-reader";
import { canonicalPath, canonicalUrl } from "@/lib/site-url";

interface Props {
  params: Promise<{ date: string }>;
}

export const dynamic = "force-dynamic";

const FALLBACK_DESCRIPTION = "방금 끝난 미국장을 정리한 100x 모닝 브리프";

/** Headline and thesis of one edition for link previews; null when unreadable. */
async function readEditionSummary(date: string): Promise<{ headline: string; thesis: string } | null> {
  if (!BRIEF_DATE_RE.test(date)) return null;
  try {
    const result = await readDataAsset(briefMorningDataUrl(date));
    if (result.kind !== "ok") return null;
    const doc = JSON.parse(result.raw) as { edition_date?: unknown; headline?: unknown; thesis?: unknown };
    if (doc.edition_date !== date || typeof doc.headline !== "string" || typeof doc.thesis !== "string") return null;
    return { headline: doc.headline, thesis: doc.thesis };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const valid = BRIEF_DATE_RE.test(date);
  const path = valid ? ROUTES.briefMorning(date) : ROUTES.brief;
  const summary = await readEditionSummary(date);
  const title = summary?.headline ?? (valid ? `모닝 브리프 · ${dateline(date)}` : "모닝 브리프");
  const description = summary?.thesis ?? FALLBACK_DESCRIPTION;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonicalPath(path) },
    openGraph: {
      type: "article",
      locale: "ko_KR",
      siteName: "FenoK",
      title,
      description,
      url: canonicalUrl(path),
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function BriefMorningPage({ params }: Props) {
  const { date } = await params;
  return (
    <AppShell active="brief" title="모닝 브리프">
      <BriefArticleClient date={date} />
    </AppShell>
  );
}
