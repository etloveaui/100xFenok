import type { Metadata } from "next";

import AppShell from "@/components/shell/AppShell";
import { MarketStructureDetailWired } from "@/lib/market-valuation/charts/marketStructurePanelComponents";

export const metadata: Metadata = {
  title: "시장 구조 상세 | 100xFenok",
  description: "시장 구조 인덱스의 유동성, 집중도, 심리 시계열을 원천 깊이까지 확인합니다.",
};

export default function MarketStructureDetailPage() {
  return (
    <div className="fnk-shell">
      <AppShell active="market" title="시장 구조" backHref="/market-valuation">
        <MarketStructureDetailWired />
      </AppShell>
    </div>
  );
}
