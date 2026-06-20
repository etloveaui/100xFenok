import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import EdgarSummaryPilotClient from "./EdgarSummaryPilotClient";

export const metadata: Metadata = {
  title: "NVDA 10-K 자동 요약 파일럿 | 100xFenok",
  description: "NVDA 10-K 공시를 기반으로 만든 AI 자동 생성 한글 요약 파일럿입니다.",
};

export default function Nvda10kFilingSummaryPage() {
  return (
    <div className="fnk-shell">
      <AppShell active="market" title="공시 요약" backHref="/market/events">
        <EdgarSummaryPilotClient />
      </AppShell>
    </div>
  );
}
