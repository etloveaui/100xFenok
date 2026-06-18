"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

interface CountMap {
  records?: number | null;
  ok?: number | null;
  failed?: number | null;
  hard_failed?: number | null;
}

interface StockanalysisManifest {
  updated?: string | null;
  files?: {
    etfFileCount?: number | null;
    stockFileCount?: number | null;
    financialFileCount?: number | null;
    backfillFileCount?: number | null;
  };
  universe?: {
    generated_at?: string | null;
    counts?: CountMap | null;
    warnings?: unknown[] | null;
  } | null;
  latestBackfill?: {
    generated_at?: string | null;
    counts?: CountMap | null;
    stop_reason?: string | null;
  } | null;
}

interface MarketQualityManifest {
  status?: "ready" | "in_progress" | "not_available" | string;
  audit?: {
    backfill?: {
      chunk_files?: number | null;
      expected_chunk_files?: number | null;
      ready_for_finalize?: boolean | null;
      hard_error_count?: number | null;
      status_counts?: CountMap | null;
    } | null;
    market_source_parity?: {
      summary?: {
        ticker_count?: number | null;
        warning_count?: number | null;
      } | null;
    } | null;
  } | null;
  sourceParity?: {
    summary?: {
      ticker_count?: number | null;
      warning_count?: number | null;
    } | null;
  } | null;
}

let stockCache: StockanalysisManifest | null = null;
let qualityCache: MarketQualityManifest | null = null;
let pending: Promise<[StockanalysisManifest | null, MarketQualityManifest | null]> | null = null;

function loadCoverage(): Promise<[StockanalysisManifest | null, MarketQualityManifest | null]> {
  if (stockCache || qualityCache) return Promise.resolve([stockCache, qualityCache]);
  if (pending) return pending;
  const stockPromise: Promise<StockanalysisManifest | null> = fetch("/api/data/stockanalysis").then((r) =>
    r.ok ? (r.json() as Promise<StockanalysisManifest>) : null,
  );
  const qualityPromise: Promise<MarketQualityManifest | null> = fetch("/api/data/market-quality").then((r) =>
    r.ok ? (r.json() as Promise<MarketQualityManifest>) : null,
  );
  const nextPending = Promise.all([stockPromise, qualityPromise] as const)
    .then(([stock, quality]): [StockanalysisManifest | null, MarketQualityManifest | null] => {
      stockCache = stock;
      qualityCache = quality;
      return [stock, quality];
    })
    .catch((): [StockanalysisManifest | null, MarketQualityManifest | null] => {
      pending = null;
      return [null, null];
    });
  pending = nextPending;
  return nextPending;
}

function fmtNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function datePart(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function pct(done: number | null | undefined, total: number | null | undefined): string {
  if (!done || !total || total <= 0) return "—";
  return `${Math.min((done / total) * 100, 100).toFixed(0)}%`;
}

export default function DataCoverageCard() {
  const [stock, setStock] = useState<StockanalysisManifest | null>(null);
  const [quality, setQuality] = useState<MarketQualityManifest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCoverage().then(([stockDoc, qualityDoc]) => {
      if (!cancelled) {
        setStock(stockDoc);
        setQuality(qualityDoc);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const backfill = quality?.audit?.backfill;
    const latestCounts = stock?.latestBackfill?.counts;
    const universeCount = stock?.universe?.counts?.records ?? null;
    const etfFileCount = stock?.files?.etfFileCount ?? null;
    const stockFileCount = stock?.files?.stockFileCount ?? null;
    const financialFileCount = stock?.files?.financialFileCount ?? null;
    const chunks = backfill?.chunk_files ?? stock?.files?.backfillFileCount ?? null;
    const expectedChunks = backfill?.expected_chunk_files ?? null;

    return [
      {
        label: "ETF 목록",
        detail: `${fmtNumber(etfFileCount)}개 저장`,
        value: fmtNumber(universeCount),
        tone: "up",
      },
      {
        label: "개별 종목 보강",
        detail: "개요·시세·히스토리",
        value: fmtNumber(stockFileCount),
        tone: "neutral",
      },
      {
        label: "재무 데이터",
        detail: "교차검증용 · 자동 갱신",
        value: fmtNumber(financialFileCount),
        tone: financialFileCount && financialFileCount > 0 ? "up" : "neutral",
      },
      {
        label: "수집 진행",
        detail: `${fmtNumber(chunks)} / ${fmtNumber(expectedChunks)}개 파일`,
        value: pct(chunks, expectedChunks),
        tone: backfill?.ready_for_finalize ? "up" : "neutral",
      },
      {
        label: "최근 수집",
        detail: `성공 ${fmtNumber(latestCounts?.ok)} · 실패 ${fmtNumber(latestCounts?.failed)}`,
        value: `오류 ${fmtNumber(backfill?.hard_error_count ?? latestCounts?.hard_failed)}`,
        tone: (backfill?.hard_error_count ?? latestCounts?.hard_failed ?? 0) > 0 ? "down" : "up",
      },
    ];
  }, [quality, stock]);

  const asOf =
    datePart(stock?.latestBackfill?.generated_at)
    ?? datePart(stock?.universe?.generated_at)
    ?? datePart(stock?.updated)
    ?? "—";
  const parityWarnings =
    quality?.sourceParity?.summary?.warning_count
    ?? quality?.audit?.market_source_parity?.summary?.warning_count
    ?? null;
  const ready = quality?.status === "ready";

  if (!stock && !quality) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>데이터 커버리지</h2>
          <span className="desc">ETF·종목·품질</span>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">
          {loaded ? "데이터 커버리지 정보를 불러오지 못했습니다." : "데이터 커버리지 확인 중"}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>데이터 커버리지</h2>
        <span className="desc">{asOf} · {ready ? "점검 완료" : "수집 중"}</span>
      </div>
      <div className="mv-col">
        {rows.map((row) => (
          <div key={row.label} className="mv-row">
            <span className="co">
              <div className="n">{row.label}</div>
              <div className="tk">{row.detail}</div>
            </span>
            <span className={`pc num ${row.tone}`}>{row.value}</span>
          </div>
        ))}
      </div>
      <div className="panel-foot">
        소스 비교 경고 {fmtNumber(parityWarnings)}
        <TransitionLink href="/admin/data-lab" style={{ marginLeft: 8, fontWeight: 900 }}>
          데이터 랩
        </TransitionLink>
      </div>
    </section>
  );
}
