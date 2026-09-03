"use client";

import TransitionLink from "@/components/TransitionLink";
import { EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import {
  MARKET_QUICK_BASE_LINKS,
  MARKET_QUICK_MACRO_LENS_LINKS,
  MARKET_QUICK_STRUCTURE_LINK,
} from "@/components/market/MarketQuickLinks";

const TOOL_TAGS: Record<string, string> = {
  "매크로 차트 보기": "테마",
  "이벤트 보기": "일정",
  "리스크 렌즈": "보유구조",
  "경기 렌즈": "테마",
  "시장 비교": "벤치마크",
  "시장 구조 보기": "보유구조",
};

const TOOL_LINKS = [...MARKET_QUICK_BASE_LINKS, ...MARKET_QUICK_MACRO_LENS_LINKS, MARKET_QUICK_STRUCTURE_LINK];

export default function EtfToolsPanel() {
  return (
    <Panel>
      <PanelHeader
        eyebrow="Tools"
        title="ETF 센터"
        right={<span className="etf-head-note">테마 · 보유구조 바로가기</span>}
      />
      <div className="etf-tools-grid">
        {TOOL_LINKS.map((link) => (
          <TransitionLink key={link.href} href={link.href} className="etf-tool-row">
            <span className="etf-tool-label">{link.textLabel}</span>
            <span className="etf-tool-tag">{TOOL_TAGS[link.textLabel] ?? ""}</span>
          </TransitionLink>
        ))}
      </div>
      <EvidenceRail freshness="fixed" source="ETF 센터 라우팅" asOf="—" coverage={`${TOOL_LINKS.length}개 도구`} />
    </Panel>
  );
}
