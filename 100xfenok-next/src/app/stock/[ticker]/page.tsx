import type { Metadata } from "next";
import MacroContextCard from "@/components/macro/MacroContextCard";
import AppShell from "@/components/shell/AppShell";
import { macroContextFromParam } from "@/lib/macro-chart/context";
import { ROUTES } from "@/lib/routes";
import { canonicalPath } from "@/lib/site-url";
import { normalizeForRouteTicker } from "@/lib/ticker";
import StockDetailClient from "./StockDetailClient";

interface Props {
  params: Promise<{ ticker: string }>;
  searchParams?: Promise<{ tab?: string | string[]; macro?: string | string[]; v2?: string | string[] }>;
}

const STOCK_DETAIL_TABS = ["overview", "etf", "statistics", "estimates", "financials", "ownership", "filings"] as const;
type StockDetailInitialTab = (typeof STOCK_DETAIL_TABS)[number];

function isStockDetailInitialTab(value: string | undefined): value is StockDetailInitialTab {
  return STOCK_DETAIL_TABS.includes(value as StockDetailInitialTab);
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function readFlag(value: string | string[] | undefined): boolean {
  return firstParam(value) === "1";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = normalizeForRouteTicker(ticker);
  return {
    title: `${symbol} 종목 상세 | 100xFenok`,
    description: `${symbol} 종목 상세 분석 — PER 밴드, 매출/EPS 추이, 13F 투자자 보유 현황`,
    alternates: {
      canonical: canonicalPath(ROUTES.stock(symbol)),
    },
  };
}

export default async function StockDetailPage({ params, searchParams }: Props) {
  const { ticker } = await params;
  const query = searchParams ? await searchParams : {};
  const symbol = normalizeForRouteTicker(ticker);
  const requestedTab = firstParam(query.tab);
  const initialTab = isStockDetailInitialTab(requestedTab) ? requestedTab : undefined;
  const initialMacroContextId = macroContextFromParam(firstParam(query.macro))?.id;
  const enableCanvasPlusPreview = readFlag(query.v2);
  return (
    <div className="fnk-shell">
      <AppShell active="screener" title={symbol} backHref={ROUTES.screenerTicker(symbol)}>
        {initialMacroContextId ? (
          <MacroContextCard contextId={initialMacroContextId} surface="stock" className="mb-[var(--s4)]" />
        ) : null}
        <StockDetailClient ticker={symbol} initialTab={initialTab} enableCanvasPlusPreview={enableCanvasPlusPreview} />
      </AppShell>
    </div>
  );
}
