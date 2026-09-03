import type { Metadata } from "next";
import MacroContextCard from "@/components/macro/MacroContextCard";
import AppShell from "@/components/shell/AppShell";
import { macroContextFromParam } from "@/lib/macro-chart/context";
import { ROUTES } from "@/lib/routes";
import "./etfs-light.css";
import EtfHeroPanel from "./EtfHeroPanel";
import EtfTodayPanel from "./EtfTodayPanel";
import EtfToolsPanel from "./EtfToolsPanel";
import EtfUnifiedTable from "./EtfUnifiedTable";
import EtfUniversePanel from "./EtfUniversePanel";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "ETF 센터 | 100xFenok",
  description: "ETF 목록, 신규 상장, 비트코인 ETF 중심의 디지털자산, 레버리지·단일종목 ETF를 확인합니다.",
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EtfsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialMacroContextId = macroContextFromParam(firstParam(params.macro))?.id;

  return (
    <div className="fnk-shell">
      <AppShell active="etfs" title="ETF" backHref={ROUTES.home}>
        <div className="etf" data-etfs-surface="true">
          {initialMacroContextId ? <MacroContextCard contextId={initialMacroContextId} surface="etfs" /> : null}

          <EtfHeroPanel />

          <EtfUniversePanel />

          <EtfTodayPanel />

          <EtfUnifiedTable />

          <EtfToolsPanel />

          <p className="etf-disclaimer">투자 조언 아님 · 참고 자료입니다</p>
        </div>
      </AppShell>
    </div>
  );
}
