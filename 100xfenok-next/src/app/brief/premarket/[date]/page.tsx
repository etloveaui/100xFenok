import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BriefPremarketClient from "@/components/brief/BriefPremarketClient";
import AppShell from "@/components/shell/AppShell";
import { BRIEF_DATE_RE, briefPremarketDataUrl, dateline } from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";
import { readDataAsset } from "@/lib/server/data-asset-reader";
import { canonicalPath, canonicalUrl } from "@/lib/site-url";

interface Props {
  params: Promise<{ date: string }>;
}

export const dynamic = "force-dynamic";

const FALLBACK_DESCRIPTION = "한국시간 18:00의 시장과 오늘 밤 일정을 읽는 100x 프리마켓 브리프";

/** Headline and lead of one edition for link previews; null when unreadable. */
async function readEditionSummary(date: string): Promise<{ headline: string; lead: string } | null> {
  if (!BRIEF_DATE_RE.test(date)) return null;
  try {
    const result = await readDataAsset(briefPremarketDataUrl(date));
    if (result.kind !== "ok") return null;
    const doc = JSON.parse(result.raw) as {
      schema?: unknown; product_name?: unknown; date?: unknown; headline?: unknown; lead?: unknown;
    };
    if (doc.schema !== "daily-digest/v1" || doc.product_name !== "프리마켓 브리프" || doc.date !== date ||
        typeof doc.headline !== "string" || typeof doc.lead !== "string") return null;
    return { headline: doc.headline, lead: doc.lead };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const valid = BRIEF_DATE_RE.test(date);
  const path = valid ? ROUTES.briefPremarket(date) : ROUTES.brief;
  const summary = await readEditionSummary(date);
  const title = summary?.headline ?? (valid ? `프리마켓 브리프 · ${dateline(date)}` : "프리마켓 브리프");
  const description = summary?.lead ?? FALLBACK_DESCRIPTION;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonicalPath(path) },
    openGraph: { type: "article", locale: "ko_KR", siteName: "FenoK", title, description, url: canonicalUrl(path) },
    twitter: { card: "summary", title, description },
  };
}

export default async function BriefPremarketPage({ params }: Props) {
  const { date } = await params;
  if (!(await readEditionSummary(date))) notFound();
  return (
    <AppShell active="brief" title="프리마켓 브리프">
      <BriefPremarketClient date={date} />
    </AppShell>
  );
}
