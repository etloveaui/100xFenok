import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import StockDetailClient from "./StockDetailClient";

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
  return {
    title: `${ticker.toUpperCase()} 종목 상세 | 100xFenok`,
    description: `${ticker.toUpperCase()} 종목 상세 분석 — PER 밴드, 매출/EPS 추이, 13F 구루 보유 현황`,
  };
}

export default async function StockDetailPage({ params }: Props) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell title={symbol} backHref="/explore">
        <StockDetailClient ticker={symbol} />
      </AppShell>
    </div>
  );
}
