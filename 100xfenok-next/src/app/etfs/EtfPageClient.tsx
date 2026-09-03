"use client";

import MacroContextCard from "@/components/macro/MacroContextCard";
import EtfHeroPanel from "./EtfHeroPanel";
import EtfTodayPanel from "./EtfTodayPanel";
import EtfToolsPanel from "./EtfToolsPanel";
import EtfUnifiedTable from "./EtfUnifiedTable";
import EtfUniversePanel from "./EtfUniversePanel";
import { useEtfSurfaceData } from "./etfSurfaceData";

// Single page-level surface store (fh-681 P1): one hook instance feeds
// Hero/Universe/Today/List, so one retry recovers every dependent panel
// atomically instead of rerendering only the clicked panel.
export default function EtfPageClient({ initialMacroContextId }: { initialMacroContextId?: string }) {
  const surface = useEtfSurfaceData();

  return (
    <div className="etf" data-etfs-surface="true">
      {initialMacroContextId ? <MacroContextCard contextId={initialMacroContextId} surface="etfs" /> : null}

      <EtfHeroPanel surface={surface} />

      <EtfUniversePanel surface={surface} />

      <EtfTodayPanel surface={surface} />

      <EtfUnifiedTable surface={surface} />

      <EtfToolsPanel />

      <p className="etf-disclaimer">투자 조언 아님 · 참고 자료입니다</p>
    </div>
  );
}
