import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { ROUTES } from "@/lib/routes";
import { canonicalPath } from "@/lib/site-url";
import { normalizeForRouteTicker } from "@/lib/ticker";
import EtfDetailClient from "./EtfDetailClient";

interface Props {
  params: Promise<{ ticker: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = normalizeForRouteTicker(ticker);
  return {
    title: `${symbol} ETF 상세 | 100xFenok`,
    description: `${symbol} ETF 보유·스왑 구성, 섹터/국가 분해, 가격 히스토리`,
    alternates: {
      canonical: canonicalPath(ROUTES.etf(symbol)),
    },
  };
}

export default async function EtfDetailPage({ params }: Props) {
  const { ticker } = await params;
  const symbol = normalizeForRouteTicker(ticker);
  return (
    <div className="fnk-shell">
      <AppShell active="etfs" title={symbol} backHref={ROUTES.etfs}>
        <EtfDetailClient ticker={symbol} />
      </AppShell>
    </div>
  );
}
