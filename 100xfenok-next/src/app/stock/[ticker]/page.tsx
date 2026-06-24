import type { Metadata } from "next";
import MacroContextCard from "@/components/macro/MacroContextCard";
import AppShell from "@/components/shell/AppShell";
import { macroContextFromParam } from "@/lib/macro-chart/context";
import { canonicalPath } from "@/lib/site-url";
import StockDetailClient from "./StockDetailClient";

interface Props {
  params: Promise<{ ticker: string }>;
  searchParams?: Promise<{ tab?: string | string[]; macro?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return {
    title: `${symbol} 종목 상세 | 100xFenok`,
    description: `${symbol} 종목 상세 분석 — PER 밴드, 매출/EPS 추이, 13F 투자자 보유 현황`,
    alternates: {
      canonical: canonicalPath(`/stock/${symbol}`),
    },
  };
}

export default async function StockDetailPage({ params, searchParams }: Props) {
  const { ticker } = await params;
  const query = searchParams ? await searchParams : {};
  const symbol = ticker.toUpperCase();
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const initialTab = requestedTab === "filings" ? "filings" : undefined;
  const initialMacroContextId = macroContextFromParam(query.macro)?.id;
  return (
    <div className="fnk-shell">
      <AppShell active="screener" title={symbol} backHref={`/screener?ticker=${encodeURIComponent(symbol)}`}>
        {initialMacroContextId ? (
          <MacroContextCard contextId={initialMacroContextId} surface="stock" className="mb-[var(--s4)]" />
        ) : null}
        <StockDetailClient ticker={symbol} initialTab={initialTab} />
      </AppShell>
    </div>
  );
}
