import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import ScreenerClient from "./ScreenerClient";

export const metadata: Metadata = {
  title: "종목 스크리너 | 100xFenok",
  description: "글로벌 1,066개 종목을 PER·PBR·배당·12개월 수익률로 거르고 줄세우는 스크리너.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function ScreenerPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="screener" title="스크리너">
        <ScreenerClient />
      </AppShell>
    </div>
  );
}
