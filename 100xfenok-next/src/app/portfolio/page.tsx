import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import PortfolioClient from "./PortfolioClient";

export const metadata: Metadata = {
  title: "포트폴리오 | 100xFenok",
  description: "내 포트폴리오를 기기 내에서 관리합니다. 서버 전송 없음.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function PortfolioPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="portfolio" title="포트폴리오">
        <PortfolioClient />
      </AppShell>
    </div>
  );
}
