import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { ROUTES } from "@/lib/routes";
import MarketValuationClient from "./MarketValuationClient";
import "@/styles/cp-w5-market-valuation.css";

export const metadata: Metadata = {
  title: "시장 밸류에이션 | 100xFenok",
  description: "S&P500·나스닥·러셀 등 주요 미국 지수가 역사적으로 비싼지/싼지 — Fwd P/E·P/B 16년 밴드 대조.",
};

export default function MarketValuationPage() {
  return (
    <div className="fnk-shell">
      <AppShell active="market" title="시장" backHref={ROUTES.home}>
        <MarketValuationClient />
      </AppShell>
    </div>
  );
}
