import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import SuperinvestorsClient from "./SuperinvestorsClient";
import type { SuperInvestorsTab } from "@/lib/superinvestors/types";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "기관 공시 인텔리전스 | 100xFenok",
  description: "주요 투자자의 분기 공시 보유, 매매, 집중도, 종목별 보유 현황을 탐색합니다.",
};

const VALID_TABS = new Set<SuperInvestorsTab>(["consensus", "gurus", "by-ticker", "trades", "insights"]);

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SuperinvestorsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const tab = firstParam(params.tab);
  const initialTab = VALID_TABS.has(tab as SuperInvestorsTab) ? (tab as SuperInvestorsTab) : undefined;
  const initialTicker = firstParam(params.ticker ?? params.symbol).trim().toUpperCase();
  const initialGuru = firstParam(params.guru).trim();
  return (
    <div className="fnk-shell">
      <AppShell active="superinvestors" title="투자자">
        <SuperinvestorsClient
          initialTab={initialTab ?? (initialTicker ? "by-ticker" : initialGuru ? "gurus" : undefined)}
          initialSearch={initialTicker}
          initialGuru={initialGuru}
        />
      </AppShell>
    </div>
  );
}
