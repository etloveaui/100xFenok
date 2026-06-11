import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import SectorsClient from "./SectorsClient";

export const metadata: Metadata = {
  title: "섹터 히트맵 | 100xFenok",
  description: "11개 미국 업종의 다기간 성과 히트맵, 강·약 순위, 섹터 ETF 비교.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function SectorsPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="sectors" title="섹터">
        <SectorsClient />
      </AppShell>
    </div>
  );
}
