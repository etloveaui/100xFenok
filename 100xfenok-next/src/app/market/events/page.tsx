import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import MarketEventsClient from "./MarketEventsClient";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "시장 이벤트 | 100xFenok",
  description: "어닝, 기업 이벤트, IPO, 산업 흐름, 급등락 데이터를 한곳에서 확인합니다.",
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MarketEventsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};

  return (
    <div className="fnk-shell">
      <AppShell active="market" title="시장 이벤트" backHref="/market-valuation">
        <MarketEventsClient
          initialTab={firstParam(params.tab)}
          initialQuery={firstParam(params.q)}
          initialSection={firstParam(params.section)}
          initialRange={firstParam(params.range)}
          initialFrom={firstParam(params.from)}
          initialTo={firstParam(params.to)}
          initialSort={firstParam(params.sort)}
        />
      </AppShell>
    </div>
  );
}
