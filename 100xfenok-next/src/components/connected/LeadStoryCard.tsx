"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import TickerChip from "@/components/TickerChip";
import TransitionLink from "@/components/TransitionLink";
import {
  TraversalTrailProvider,
  useTraversalTrail,
} from "@/components/connected/useTraversalTrail";
import {
  loadBuyingPressure,
  loadByTickerHolders,
  type BuyingPressureRow,
  type HolderDetail,
  type TickerHoldersResult,
} from "@/lib/connected/connected-loaders";
import {
  getStockConnection,
  getStockServices,
  loadStockConnectionIndex,
  loadStockServicesIndex,
  type StockConnectionEntry,
  type StockServiceEtfLink,
} from "@/lib/data-entity-graph/stock-index";
import { isValidRouteTicker, normalizeForEntityKey, normalizeForRouteTicker } from "@/lib/ticker";
import { ROUTES } from "@/lib/routes";

type MoverSide = "gainer" | "loser";

interface DiscoveryRow {
  symbol?: string;
  company?: string;
  sector?: string | null;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
}

interface DiscoverySide {
  date?: string | null;
  rows?: DiscoveryRow[];
}

interface DiscoverySummary {
  generated_at?: string | null;
  movers?: {
    gainers?: DiscoverySide;
    losers?: DiscoverySide;
  };
}

interface LeadStoryCandidate {
  ticker: string;
  company: string;
  sector: string | null;
  price: number | null;
  changePercent: number;
  side: MoverSide;
  date: string | null;
}

export interface LeadStory {
  ticker: string;
  company: string;
  sector: string | null;
  price: number | null;
  changePercent: number;
  side: MoverSide;
  date: string | null;
  holders: TickerHoldersResult;
  topHolders: HolderDetail[];
  buyingPressure: BuyingPressureRow | null;
  etfs: StockServiceEtfLink[];
  connectionEntry: StockConnectionEntry | null;
}

interface LeadStoryCardProps {
  story?: LeadStory | null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtPrice(value: number | null): string {
  if (!finiteNumber(value)) return "가격 -";
  return value >= 1000
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMoney(value: number | null | undefined): string {
  if (!finiteNumber(value)) return "$-";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function shortText(value: string | null | undefined, fallback: string, max = 34): string {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

const SAFE_ETF_ROUTE_PATTERN = /^\/etfs\/[A-Za-z0-9.-]+$/;

function safeEtfHref(link: StockServiceEtfLink | null | undefined): string {
  const route = typeof link?.route === "string" ? link.route.trim() : "";
  return SAFE_ETF_ROUTE_PATTERN.test(route) ? route : ROUTES.etfs;
}

function formatInvestorName(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : ""))
    .join(" ");
}

function parseMovers(doc: DiscoverySummary | null): LeadStoryCandidate[] {
  const sides: Array<{ side: MoverSide; source: DiscoverySide | undefined }> = [
    { side: "gainer", source: doc?.movers?.gainers },
    { side: "loser", source: doc?.movers?.losers },
  ];

  return sides.flatMap(({ side, source }) => (
    (source?.rows ?? [])
      .map((row) => {
        const ticker = normalizeForRouteTicker(row.symbol);
        if (!ticker || !isValidRouteTicker(ticker) || !finiteNumber(row.changePercent)) return null;
        return {
          ticker,
          company: shortText(row.company, ticker, 48),
          sector: typeof row.sector === "string" && row.sector.trim() ? row.sector.trim() : null,
          price: finiteNumber(row.price) ? row.price : null,
          changePercent: row.changePercent,
          side,
          date: source?.date ?? doc?.generated_at ?? null,
        };
      })
      .filter((row): row is LeadStoryCandidate => row !== null)
  ));
}

async function loadDiscoverySummary(): Promise<DiscoverySummary | null> {
  try {
    const response = await fetch("/data/slickcharts/discovery-summary.json", { cache: "force-cache" });
    return response.ok ? response.json() as Promise<DiscoverySummary> : null;
  } catch {
    return null;
  }
}

async function buildLeadStory(): Promise<LeadStory | null> {
  const [discovery, stockIndex, servicesIndex, pressureIndex] = await Promise.all([
    loadDiscoverySummary(),
    loadStockConnectionIndex(),
    loadStockServicesIndex(),
    loadBuyingPressure(),
  ]);
  const movers = parseMovers(discovery)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent) || a.ticker.localeCompare(b.ticker))
    .slice(0, 40);

  const resolved = await Promise.all(
    movers.map(async (candidate) => ({
      candidate,
      holders: await loadByTickerHolders(candidate.ticker),
    })),
  );

  const eligible = resolved
    .filter((row): row is { candidate: LeadStoryCandidate; holders: TickerHoldersResult } => (
      Boolean(row.holders && row.holders.holder_details.length > 0)
    ))
    .sort((a, b) => {
      const moveDelta = Math.abs(b.candidate.changePercent) - Math.abs(a.candidate.changePercent);
      if (moveDelta !== 0) return moveDelta;
      const holderDelta = b.holders.holder_details.length - a.holders.holder_details.length;
      if (holderDelta !== 0) return holderDelta;
      return a.candidate.ticker.localeCompare(b.candidate.ticker);
    });

  const picked = eligible[0];
  if (!picked) return null;

  const tickerKey = normalizeForEntityKey(picked.candidate.ticker);
  const services = getStockServices(servicesIndex, tickerKey);
  const connectionEntry = getStockConnection(stockIndex, tickerKey);
  const topHolders = picked.holders.holder_details
    .slice()
    .sort((a, b) => b.market_value - a.market_value)
    .slice(0, 2);

  return {
    ...picked.candidate,
    holders: picked.holders,
    topHolders,
    buyingPressure: pressureIndex?.byTicker.get(tickerKey) ?? null,
    etfs: services?.single_stock_etfs?.slice(0, 2) ?? [],
    connectionEntry,
  };
}

function LeadStoryCardBody({ children }: { children: ReactNode }) {
  return <div className="v5-lead-story__body">{children}</div>;
}

function LeadStoryStep({
  index,
  title,
  meta,
  open,
  children,
}: {
  index: number;
  title: string;
  meta: string;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`v5-lead-step ${open ? "is-open" : ""}`}>
      <div className="v5-lead-step__head">
        <span>{index}</span>
        <b>{title}</b>
        <small>{open ? meta : "대기"}</small>
      </div>
      {open ? <LeadStoryCardBody>{children}</LeadStoryCardBody> : null}
    </div>
  );
}

function LeadStoryCardInner({ providedStory }: { providedStory?: LeadStory | null }) {
  const [story, setStory] = useState<LeadStory | null | undefined>(providedStory);
  const [revealedHop, setRevealedHop] = useState(0);
  const [pending, setPending] = useState(false);
  const timerRef = useRef<number | null>(null);
  const { trail, pushTrail, popTrailTo, clearTrail } = useTraversalTrail();

  useEffect(() => {
    let cancelled = false;
    if (providedStory !== undefined) {
      setStory(providedStory);
      return () => { cancelled = true; };
    }

    setStory(undefined);
    buildLeadStory().then((next) => {
      if (!cancelled) setStory(next);
    });
    return () => { cancelled = true; };
  }, [providedStory]);

  useEffect(() => {
    setRevealedHop(0);
    clearTrail();
  }, [clearTrail, story?.ticker]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const topHolder = story?.topHolders[0] ?? null;
  const topEtf = story?.etfs[0] ?? null;
  const topEtfHref = topEtf ? safeEtfHref(topEtf) : ROUTES.etfs;
  const tone = story && story.changePercent < 0 ? "down" : "up";
  const stockHref = story ? ROUTES.stock(story.ticker) : "";
  const filingHref = story ? ROUTES.stockFilings(story.ticker) : "";
  const filingReady = Boolean(story?.connectionEntry?.flags?.filings);
  const nextLabel = revealedHop >= 4 ? "연결 완료" : pending ? "확인 중" : "다음 연결";

  const pressureDetail = useMemo(() => {
    if (!story?.buyingPressure) return null;
    const row = story.buyingPressure;
    const direction = row.pressure > 0 ? "매수 우위" : row.pressure < 0 ? "매도 우위" : "중립";
    return `${direction} · 순매수 ${row.net_buyers} / 순매도 ${row.net_sellers} · ${fmtMoney(row.total_value_change)}`;
  }, [story]);

  if (story === undefined) {
    return (
      <section className="panel v5-lead-story v5-lead-story--loading" data-testid="v5-lead-story" aria-labelledby="v5-lead-story-title">
        <div className="panel-h">
          <h2 id="v5-lead-story-title">오늘의 리드 스토리</h2>
          <span className="desc">연결 대기</span>
        </div>
        <div className="panel-b">
          <div className="v5-lead-story__placeholder">
            <b>연결 대기</b>
            <p>오늘의 주도주 및 연결 맵을 불러오는 중입니다</p>
          </div>
        </div>
      </section>
    );
  }

  if (story === null) return null;

  function revealNext() {
    if (!story || pending || revealedHop >= 4) return;
    const nextHop = revealedHop + 1;
    setPending(true);
    timerRef.current = window.setTimeout(() => {
      setRevealedHop(nextHop);
      setPending(false);
      if (nextHop === 1) {
        pushTrail({ id: `ticker:${story.ticker}`, label: story.ticker, kind: "ticker", href: stockHref });
      } else if (nextHop === 2 && topHolder) {
        pushTrail({ id: `holder:${topHolder.investor}`, label: formatInvestorName(topHolder.investor), kind: "13f-holder" });
      } else if (nextHop === 3 && topEtf) {
        pushTrail({ id: `etf:${topEtf.ticker}`, label: topEtf.ticker, kind: "etf", href: topEtfHref });
      } else if (nextHop === 4) {
        pushTrail({ id: `filing:${story.ticker}`, label: "공시", kind: "filing", href: filingHref });
      }
    }, 250);
  }

  return (
    <section className={`panel v5-lead-story is-${tone}`} data-testid="v5-lead-story" aria-labelledby="v5-lead-story-title">
      <div className="panel-h">
        <h2 id="v5-lead-story-title">오늘의 리드 스토리</h2>
        <span className="desc">{story.date?.slice(0, 10) ?? "mover"} · 13F edge</span>
      </div>
      <div className="panel-b">
        <div className="v5-lead-story__hero">
          <span>{story.side === "gainer" ? "상승 모멘텀" : "하락 모멘텀"}</span>
          <b><TickerChip ticker={story.ticker} variant="inline" /></b>
          <p>{story.company}</p>
          <strong className={`num ${tone}`}>{fmtPct(story.changePercent)}</strong>
        </div>

        <div className="v5-lead-story__facts">
          <span>{fmtPrice(story.price)}</span>
          <span>{story.sector ?? "섹터 미정"}</span>
          <span>{story.holders.holder_details.length.toLocaleString("ko-KR")} holders</span>
        </div>

        <div className="v5-lead-story__steps" aria-label={`${story.ticker} 연결 단계`}>
          <LeadStoryStep index={1} title="왜 움직였나" meta="mover" open={revealedHop >= 1}>
            <p>{story.ticker}는 오늘 {fmtPct(story.changePercent)} 움직인 {story.side === "gainer" ? "상승" : "하락"} 리더입니다.</p>
            {pressureDetail ? <small>{pressureDetail}</small> : null}
          </LeadStoryStep>

          <LeadStoryStep index={2} title="누가 들고 있나" meta="13F holder" open={revealedHop >= 2}>
            {topHolder ? (
              <TransitionLink href={`/superinvestors?tab=gurus&guru=${encodeURIComponent(topHolder.investor)}`}>
                {formatInvestorName(topHolder.investor)}
                <b>{fmtMoney(topHolder.market_value)}</b>
              </TransitionLink>
            ) : <p>표시할 보유자가 없습니다.</p>}
          </LeadStoryStep>

          <LeadStoryStep index={3} title="ETF가 싣는가" meta="ETF edge" open={revealedHop >= 3}>
            {topEtf ? (
              <TransitionLink href={topEtfHref}>
                {topEtf.ticker}
                <b>{shortText(topEtf.label, "ETF", 28)}</b>
              </TransitionLink>
            ) : <p>단일종목 ETF 연결은 아직 없습니다.</p>}
          </LeadStoryStep>

          <LeadStoryStep index={4} title="무엇이 공시됐나" meta={filingReady ? "EDGAR" : "stock page"} open={revealedHop >= 4}>
            <TransitionLink href={filingReady ? filingHref : stockHref}>
              {filingReady ? "공시 전체 보기" : "종목 전체 보기"}
            </TransitionLink>
          </LeadStoryStep>
        </div>

        <button
          type="button"
          className="v5-lead-story__next"
          onClick={revealNext}
          disabled={pending || revealedHop >= 4}
          aria-disabled={pending || revealedHop >= 4}
        >
          {nextLabel}
        </button>

        {trail.length > 0 ? (
          <div className="v5-traversal-trail" aria-label="리드 스토리 이동 경로">
            {trail.map((item, index) => (
              <button key={`${item.id}-${index}`} type="button" onClick={() => popTrailTo(index)}>
                {item.label ?? item.id}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function LeadStoryCard({ story }: LeadStoryCardProps) {
  if (story === null) return null;
  return (
    <div className="v5-lead-story-wrap">
      <TraversalTrailProvider>
        <LeadStoryCardInner providedStory={story} />
      </TraversalTrailProvider>
    </div>
  );
}
