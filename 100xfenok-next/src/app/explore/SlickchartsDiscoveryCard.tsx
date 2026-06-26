"use client";

import { useEffect, useState, type ReactNode } from "react";
import TickerChip from "@/components/TickerChip";
import Tabs, { TabPanel, type TabItem, useTabsBaseId } from "@/components/ui/Tabs";
import { formatSignedPercentDecimal } from "@/lib/dashboard/formatters";

type DiscoveryTab = "movers" | "returns" | "dividends";

const DISCOVERY_TABS_ID = "explore-slickcharts-discovery-tabs";
const DISCOVERY_TABS: Array<TabItem<DiscoveryTab>> = [
  { id: "movers", label: "급등락" },
  { id: "returns", label: "수익률" },
  { id: "dividends", label: "배당" },
];

interface DiscoveryRow {
  symbol: string;
  company: string;
  sector: string | null;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  value?: number | null;
}

interface MoverSide {
  date: string | null;
  count: number;
  historyCount: number;
  rows: DiscoveryRow[];
}

interface DiscoveryDoc {
  generated_at?: string;
  source_files?: {
    gainers?: { updated?: string | null };
    losers?: { updated?: string | null };
    universe?: { updated?: string | null; uniqueCount?: number | null };
    stocks_analyzer?: { generated_at?: string | null; source_date?: string | null; count?: number | null };
    slick_index?: { generated_at?: string | null; count?: number | null };
  };
  movers?: {
    gainers?: MoverSide;
    losers?: MoverSide;
  };
  returns?: {
    asOf?: string | null;
    best1y?: DiscoveryRow[];
    worst1y?: DiscoveryRow[];
    best3y?: DiscoveryRow[];
  };
  dividends?: {
    asOf?: string | null;
    highYield?: DiscoveryRow[];
    highTtm?: DiscoveryRow[];
  };
  universe?: {
    uniqueCount?: number;
  };
}

let cache: DiscoveryDoc | null = null;
let pending: Promise<DiscoveryDoc | null> | null = null;

function loadDiscovery(): Promise<DiscoveryDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/slickcharts/discovery-summary.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      cache = d;
      return d;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmtMove(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

function fmtFraction(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatSignedPercentDecimal(value, 1) : "—";
}

function fmtDividendYield(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function fmtDollars(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `$${value.toFixed(2)}` : "—";
}

function datePart(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function RowList({
  rows,
  tone,
  formatValue,
}: {
  rows: DiscoveryRow[];
  tone: "up" | "down";
  formatValue: (value: number | null | undefined) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mv-col">
      {rows.slice(0, 5).map((row) => (
        <div key={row.symbol} className="mv-row">
          <span className="co">
            <div className="n">{row.company || row.symbol}</div>
            <div className="tk"><TickerChip ticker={row.symbol} variant="inline" />{row.sector ? ` · ${row.sector}` : ""}</div>
          </span>
          <span className={`pc num ${tone}`}>{formatValue(row.value ?? row.changePercent)}</span>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ tone, children }: { tone: "up" | "down"; children: ReactNode }) {
  return <div className={`mv-h ${tone}`}>{children}</div>;
}

export default function SlickchartsDiscoveryCard() {
  const [doc, setDoc] = useState<DiscoveryDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<DiscoveryTab>("movers");
  const tabsId = useTabsBaseId(DISCOVERY_TABS_ID);

  useEffect(() => {
    let cancelled = false;
    loadDiscovery().then((d) => {
      if (!cancelled) {
        setDoc(d);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const gainers = doc?.movers?.gainers?.rows ?? [];
  const losers = doc?.movers?.losers?.rows ?? [];
  const best1y = doc?.returns?.best1y ?? [];
  const worst1y = doc?.returns?.worst1y ?? [];
  const highYield = doc?.dividends?.highYield ?? [];
  const highTtm = doc?.dividends?.highTtm ?? [];
  const moverAsOf = doc?.movers?.gainers?.date ?? doc?.movers?.losers?.date ?? datePart(doc?.source_files?.gainers?.updated) ?? datePart(doc?.generated_at);
  const returnsAsOf = doc?.returns?.asOf ?? datePart(doc?.source_files?.slick_index?.generated_at) ?? datePart(doc?.generated_at);
  const dividendsAsOf = doc?.dividends?.asOf
    ?? doc?.source_files?.stocks_analyzer?.source_date
    ?? datePart(doc?.source_files?.stocks_analyzer?.generated_at)
    ?? datePart(doc?.generated_at);
  const tabAsOf: Record<DiscoveryTab, string | null> = {
    movers: moverAsOf,
    returns: returnsAsOf,
    dividends: dividendsAsOf,
  };
  const tabLabel: Record<DiscoveryTab, string> = {
    movers: "급등락",
    returns: "수익률",
    dividends: "배당",
  };
  const asOf = `${tabLabel[tab]} ${tabAsOf[tab] ?? "—"}`;

  if (!doc) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>수익률 리더보드</h2>
          <span className="desc">가격·수익률·배당</span>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">
          {loaded ? "수익률 리더보드 데이터를 불러오지 못했습니다." : "수익률 리더보드 확인 중"}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>수익률 리더보드</h2>
        <span className="desc">{asOf} · {doc.universe?.uniqueCount ?? "—"}개 종목</span>
        <Tabs
          idBase={tabsId}
          items={DISCOVERY_TABS}
          value={tab}
          onValueChange={setTab}
          ariaLabel="수익률 리더보드 분류"
          className="seg ml-auto"
          getTabClassName={(_, selected) => (selected ? "on" : undefined)}
        />
      </div>

      {DISCOVERY_TABS.map((item) => (
        <TabPanel key={item.id} idBase={tabsId} item={item} active={tab === item.id} className="mv-split">
          {item.id === "movers" ? (
            <>
          <div>
            <SectionTitle tone="up">▲ 상승률 TOP</SectionTitle>
            <RowList rows={gainers} tone="up" formatValue={fmtMove} />
          </div>
          <div>
            <SectionTitle tone="down">▼ 하락률 TOP</SectionTitle>
            <RowList rows={losers} tone="down" formatValue={fmtMove} />
          </div>
            </>
          ) : item.id === "returns" ? (
            <>
          <div>
            <SectionTitle tone="up">▲ 1Y 수익률 TOP</SectionTitle>
            <RowList rows={best1y} tone="up" formatValue={fmtFraction} />
          </div>
          <div>
            <SectionTitle tone="down">▼ 1Y 수익률 하위</SectionTitle>
            <RowList rows={worst1y} tone="down" formatValue={fmtFraction} />
          </div>
            </>
          ) : (
            <>
          <div>
            <SectionTitle tone="up">배당률 TOP</SectionTitle>
            <RowList rows={highYield} tone="up" formatValue={fmtDividendYield} />
          </div>
          <div>
            <SectionTitle tone="up">DPS TTM TOP</SectionTitle>
            <RowList rows={highTtm} tone="up" formatValue={fmtDollars} />
          </div>
            </>
          )}
        </TabPanel>
      ))}

      <div className="panel-foot">대용량 히스토리는 요약 데이터만 표시합니다</div>
    </section>
  );
}
