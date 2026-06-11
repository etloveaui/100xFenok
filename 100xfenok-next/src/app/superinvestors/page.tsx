import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import SuperinvestorsClient from "./SuperinvestorsClient";

export const metadata: Metadata = {
  title: "13F Superinvestors | 100xFenok",
  description: "30개 슈퍼인베스터의 13F 보유 데이터를 탐색합니다. 컨센서스, 구루 포트폴리오, 종목별 보유 현황.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function SuperinvestorsPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="superinvestors" title="구루">
        <SuperinvestorsClient />
      </AppShell>
    </div>
  );
}
