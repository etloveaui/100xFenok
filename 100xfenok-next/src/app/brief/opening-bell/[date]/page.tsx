import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BriefOpeningBellClient from "@/components/brief/BriefOpeningBellClient";
import AppShell from "@/components/shell/AppShell";
import { BRIEF_DATE_RE, briefOpeningBellDataUrl, dateline } from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";
import { readDataAsset } from "@/lib/server/data-asset-reader";
import { canonicalPath, canonicalUrl } from "@/lib/site-url";

interface Props {
  params: Promise<{ date: string }>;
}

export const dynamic = "force-dynamic";

const FALLBACK_DESCRIPTION = "미국 정규장 개장 30분의 움직임과 프리마켓의 조건을 읽는 100x 오프닝 벨";

/** Headline and lead of one edition for link previews; null when unreadable. */
async function readEditionSummary(date: string): Promise<{ headline: string; lead: string } | null> {
  if (!BRIEF_DATE_RE.test(date)) return null;
  try {
    const result = await readDataAsset(briefOpeningBellDataUrl(date));
    if (result.kind !== "ok") return null;
    const doc = JSON.parse(result.raw) as {
      schema?: unknown; product_name?: unknown; date?: unknown; headline?: unknown; lead?: unknown;
    };
    if (doc.schema !== "daily-digest/v1" || doc.product_name !== "오프닝 벨" || doc.date !== date ||
        typeof doc.headline !== "string" || typeof doc.lead !== "string") return null;
    return { headline: doc.headline, lead: doc.lead };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const valid = BRIEF_DATE_RE.test(date);
  const path = valid ? ROUTES.briefOpeningBell(date) : ROUTES.brief;
  const summary = await readEditionSummary(date);
  const title = summary?.headline ?? (valid ? `오프닝 벨 · ${dateline(date)}` : "오프닝 벨");
  const description = summary?.lead ?? FALLBACK_DESCRIPTION;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonicalPath(path) },
    openGraph: { type: "article", locale: "ko_KR", siteName: "FenoK", title, description, url: canonicalUrl(path) },
    twitter: { card: "summary", title, description },
  };
}

export default async function BriefOpeningBellPage({ params }: Props) {
  const { date } = await params;
  if (!(await readEditionSummary(date))) notFound();
  return (
    <AppShell active="brief" title="오프닝 벨">
      <BriefOpeningBellClient date={date} />
    </AppShell>
  );
}
