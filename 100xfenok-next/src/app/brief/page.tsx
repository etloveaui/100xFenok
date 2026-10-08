import type { Metadata } from "next";
import BriefHubClient from "@/components/brief/BriefHubClient";
import AppShell from "@/components/shell/AppShell";
import { ROUTES } from "@/lib/routes";
import { canonicalPath, canonicalUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const TITLE = "브리핑";
const DESCRIPTION = "방금 끝난 미국장부터 오늘 밤 일정까지, 투자자의 하루를 여는 100x 브리핑";

export const metadata: Metadata = {
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
  },
};

export default function BriefHubPage() {
  return (
    <AppShell active="brief" title={TITLE}>
      <BriefHubClient />
    </AppShell>
  );
}
