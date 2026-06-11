import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import MarketValuationClient from "./MarketValuationClient";

export const metadata: Metadata = {
  title: "시장 밸류에이션 | 100xFenok",
  description: "S&P500·나스닥·러셀 등 주요 미국 지수가 역사적으로 비싼지/싼지 — Fwd P/E·P/B 16년 밴드 대조.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function MarketValuationPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="market" title="시장">
        <MarketValuationClient />
      </AppShell>
    </div>
  );
}
