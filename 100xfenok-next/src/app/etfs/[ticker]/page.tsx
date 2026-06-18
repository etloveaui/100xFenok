import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import StockDetailClient from "@/app/stock/[ticker]/StockDetailClient";

interface Props {
  params: Promise<{ ticker: string }>;
}

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return {
    title: `${symbol} ETF 상세 | 100xFenok`,
    description: `${symbol} ETF 보유·스왑 원장, 섹터/국가 분해, 가격 히스토리`,
  };
}

export default async function EtfDetailPage({ params }: Props) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="etfs" title={symbol} backHref="/etfs">
        <StockDetailClient ticker={symbol} />
      </AppShell>
    </div>
  );
}
