import type { Metadata } from "next";

import AppShell from "@/components/shell/AppShell";
import MacroChartClient from "./MacroChartClient";

export const metadata: Metadata = {
  title: "매크로 차트",
  description: "100xFenok 매크로 시계열 비교 차트",
};

export default function MacroChartPage() {
  return (
    <AppShell active="market" title="매크로 차트" backHref="/market-valuation">
      <MacroChartClient />
    </AppShell>
  );
}
