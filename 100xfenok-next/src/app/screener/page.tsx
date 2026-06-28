import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { macroContextFromParam } from "@/lib/macro-chart/context";
import { ROUTES } from "@/lib/routes";
import { normalizeForEntityKey } from "@/lib/ticker";
import { parseScreenerFilterState } from "@/lib/screener/filter-url";
import ScreenerClient from "./ScreenerClient";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "종목 스크리너 | 100xFenok",
  description: "글로벌 1,066개 종목을 PER·PBR·배당·12개월 수익률로 거르고 줄세우는 스크리너.",
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ScreenerPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialSearch = normalizeForEntityKey(firstParam(params.ticker ?? params.q));
  const initialSector = firstParam(params.sector).trim();
  const initialMacroContextId = macroContextFromParam(firstParam(params.macro))?.id;
  const initialFilters = parseScreenerFilterState(params);
  return (
    <div className="fnk-shell">
      <AppShell active="screener" title="스크리너" backHref={ROUTES.home}>
        <ScreenerClient
          initialSearch={initialSearch}
          initialSector={initialSector}
          initialMacroContextId={initialMacroContextId}
          initialPreset={firstParam(params.preset)}
          initialActionFilter={firstParam(params.action)}
          initialConnectionFilter={firstParam(params.connection)}
          initialFilters={initialFilters}
        />
      </AppShell>
    </div>
  );
}
