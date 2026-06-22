"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import Tabs, { TabPanel, type TabItem, useTabsBaseId } from "@/components/ui/Tabs";
import { loadActionSummaryDocument, type ActionSummaryDocument, type ActionSummaryRecord } from "@/features/stock-analyzer/data/action-summary-provider";

type ActionTab = "smart_money" | "value_momentum" | "index_core";

const ACTION_TABS_ID = "explore-action-candidates-tabs";
const ACTION_TABS: Array<TabItem<ActionTab>> = [
  { id: "smart_money", label: "기관·고수" },
  { id: "value_momentum", label: "밸류+모멘텀" },
  { id: "index_core", label: "지수 핵심" },
];

type ActionRow = ActionSummaryRecord;
type ActionDoc = ActionSummaryDocument;

function loadActions(): Promise<ActionDoc | null> {
  return loadActionSummaryDocument();
}

function fmtScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toString() : "—";
}

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function confidenceText(label: string | null | undefined): string {
  if (label === "high") return "신뢰 높음";
  if (label === "medium") return "신뢰 중간";
  if (label === "low") return "신뢰 낮음";
  return "신뢰 미정";
}

function tone(bucket: string | null | undefined, confidenceLabel?: string | null, lowEvidence = false): string {
  if (lowEvidence || confidenceLabel === "low") return "neutral";
  if (bucket === "smart_money") return "up";
  if (bucket === "value_momentum") return "up";
  if (bucket === "index_core") return "neutral";
  return "neutral";
}

export default function ActionCandidatesCard() {
  const [doc, setDoc] = useState<ActionDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<ActionTab>("smart_money");
  const tabsId = useTabsBaseId(ACTION_TABS_ID);

  useEffect(() => {
    let cancelled = false;
    loadActions().then((next) => {
      if (!cancelled) {
        setDoc(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rowsByTab = useMemo(() => {
    const all = Array.isArray(doc?.rows) ? doc.rows : [];
    const normalized = all
      .filter((row): row is ActionRow => Boolean(row?.actionBucket));
    return ACTION_TABS.reduce((acc, item) => {
      acc[item.id] = normalized.filter((row) => row.actionBucket === item.id).slice(0, 6);
      return acc;
    }, {} as Record<ActionTab, ActionRow[]>);
  }, [doc]);

  if (!doc) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>투자 후보</h2>
          <span className="desc">스코어 계산</span>
        </div>
        <div className="panel-b text-sm font-semibold text-[var(--c-ink-3)]">
          {loaded ? "투자 후보 데이터를 불러오지 못했습니다." : "투자 후보 계산 중"}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>투자 후보</h2>
        <span className="desc">{doc.coverage?.indexed_stock_count ?? "—"}개 · 13F {doc.coverage?.conviction_matched_count ?? "—"}건</span>
        <Tabs
          idBase={tabsId}
          items={ACTION_TABS}
          value={tab}
          onValueChange={setTab}
          ariaLabel="투자 후보 분류"
          className="seg ml-auto"
          getTabClassName={(_, selected) => (selected ? "on" : undefined)}
        />
      </div>
      {ACTION_TABS.map((item) => {
        const rows = rowsByTab[item.id] ?? [];
        return (
          <TabPanel key={item.id} idBase={tabsId} item={item} active={tab === item.id} className="mv-col">
            {rows.length > 0 ? rows.map((row) => (
              <TransitionLink key={row.symbol} href={`/stock/${encodeURIComponent(row.symbol)}`} className="mv-row">
                <span className="co">
                  <div className="n">{row.company || row.symbol}</div>
                  <div className="tk">
                    {row.symbol}{row.sector ? ` · ${row.sector}` : ""}
                  </div>
                  <div className="tk" style={{ whiteSpace: "normal" }}>
                    {row.actionLabel ?? "관찰"}{row.lowEvidence ? " · 증거 부족" : ""}
                  </div>
                  {row.actionReasons?.[0] ? <div className="tk" style={{ whiteSpace: "normal" }}>{row.actionReasons[0]}</div> : null}
                </span>
                <span className={`pc num ${tone(row.actionBucket, row.confidenceLabel, row.lowEvidence === true)}`}>
                  {fmtScore(row.actionScore)}
                  <small className="block text-[10px] text-[var(--c-ink-3)]">{confidenceText(row.confidenceLabel)}</small>
                  <small className="block text-[10px] text-[var(--c-ink-3)]">{fmtPct(row.return12m)}</small>
                </span>
              </TransitionLink>
            )) : (
              <div className="mv-row">
                <span className="co">
                  <div className="n">선택한 분류에 표시할 종목이 없습니다</div>
                  <div className="tk">다른 탭을 선택해 주세요</div>
                </span>
                <span className="pc num neutral">—</span>
              </div>
            )}
          </TabPanel>
        );
      })}
      <div className="panel-foot">분기말 종가 {doc.coverage?.quarter_close_ticker_count ?? "—"}개 · 가격·수익률·기관 동향·자동 계산 점수 반영</div>
    </section>
  );
}
