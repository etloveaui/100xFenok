"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import {
  CpBandVisual,
  CpCTARow,
  CpGaugeCard,
  CpMetricTile,
  CpMetricTileGrid,
  CpVerdictHero,
} from "@/components/canvas-plus/kit";
import { formatAsOf } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";
import EtfRetryCallout from "./EtfRetryCallout";
import {
  clearEtfSurfaceCaches,
  computeEtfInsights,
  fmtSignedPct,
  fmtVolumeCompact,
  loadEtfSnapshot,
  loadEtfUniverse,
  normalizeUniverseRows,
  type EtfScreenerLeaderRow,
} from "./etfSurfaceData";

interface NewEtfPreviewRow {
  s?: string;
  n?: string;
  inceptionDate?: string;
}

interface HeroSnapshotDoc {
  newEtfs?: { records?: NewEtfPreviewRow[] } | null;
  screener?: { volumeLeaders?: EtfScreenerLeaderRow[]; changeLeaders?: EtfScreenerLeaderRow[] } | null;
  bitcoin?: { records?: Array<{ symbol?: string }> } | null;
}

function MoverLink({ ticker, valueLabel }: { ticker?: string; valueLabel: string }) {
  if (!ticker) return null;
  return (
    <TransitionLink href={ROUTES.etf(ticker)} className="cpw5-etfs-mini-link">
      <span>{ticker}</span>
      <b>{valueLabel}</b>
    </TransitionLink>
  );
}

export default function EtfHeroPanel() {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<{
    reloadKey: number;
    loaded: boolean;
    failed: boolean;
    universeGeneratedAt: string | null;
    rows: ReturnType<typeof normalizeUniverseRows>;
    snapshot: HeroSnapshotDoc | null;
  }>({ reloadKey: 0, loaded: false, failed: false, universeGeneratedAt: null, rows: [], snapshot: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadEtfUniverse(), loadEtfSnapshot()]).then(([universe, snapshot]) => {
      if (cancelled) return;
      if (!universe && !snapshot) {
        setState((prev) => ({ ...prev, reloadKey, loaded: true, failed: true }));
        return;
      }
      const rows = normalizeUniverseRows(universe, snapshot);
      setState({
        reloadKey,
        loaded: true,
        failed: false,
        universeGeneratedAt: universe?.generated_at ?? null,
        rows,
        snapshot,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const newPreview = state.snapshot?.newEtfs?.records?.slice(0, 3) ?? [];
  const volumeLeaders = state.snapshot?.screener?.volumeLeaders?.slice(0, 3) ?? [];
  const changeLeaders = state.snapshot?.screener?.changeLeaders?.slice(0, 3) ?? [];

  const insights = useMemo(
    () => (state.loaded && !state.failed ? computeEtfInsights(state.rows, state.snapshot, state.universeGeneratedAt) : null),
    [state],
  );

  const retryLoad = () => {
    clearEtfSurfaceCaches();
    setReloadKey((value) => value + 1);
  };

  if (!state.loaded) {
    return (
      <section className="cpw5-etfs-hero-block" aria-busy="true">
        <CpVerdictHero eyebrow="ETF · 시장 스냅샷" verdict="ETF 시장 현황을 계산하는 중입니다" sub="신규 상장·자산군 구성·레버리지 비중을 읽고 있습니다." />
      </section>
    );
  }

  if (state.failed || !insights) {
    return (
      <section className="cpw5-etfs-hero-block">
        <EtfRetryCallout
          title="ETF 시장 스냅샷을 불러오지 못했습니다"
          desc="ETF 전체 목록과 신규 상장·거래 상위 데이터를 연결하지 못했습니다. 다시 시도하면 최신 데이터를 새로 요청합니다."
          onRetry={retryLoad}
        />
      </section>
    );
  }

  const { compositionBuckets, dominantBucket, leverageInversePct, leverageInverseCount, totalCount, newCount, topMoversCount, topMoversLeverageInverseCount, asOf, asOfReason } = insights;
  const gaugeTone = leverageInversePct >= 15 ? "warning" : "neutral";
  const compositionSummary = compositionBuckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.label} ${bucket.pct}%`)
    .join(" · ");

  return (
    <section className="cpw5-etfs-hero-block">
      <CpVerdictHero
        eyebrow="ETF · 시장 스냅샷"
        verdict={
          <>
            오늘 신규 상장 <b>{newCount}개</b> · {dominantBucket?.label ?? "주식형"} 비중 <b>{dominantBucket?.pct ?? 0}%</b> 중심 · 레버리지·인버스 비중{" "}
            <b className={gaugeTone === "warning" ? "warn" : undefined}>{leverageInversePct}%</b>
          </>
        }
        sub={
          <>
            오늘 상위 거래량·변동률 종목 {topMoversCount}개 중 <b>{topMoversLeverageInverseCount}개</b>가 레버리지·인버스입니다. 관심·거래 쏠림 기준이며 자금 유입·유출액은 포함하지 않습니다.
          </>
        }
        trustChips={[
          {
            id: "asof",
            label: "기준일",
            value: formatAsOf(asOf) ?? (asOfReason?.includes("publishes no aggregate source date") ? "제공자 미공개" : "미확인"),
            freshness: true,
          },
          { id: "total", label: "전체", value: `${totalCount.toLocaleString("ko-KR")}개` },
        ]}
      />

      <div className="cpw5-etfs-hero-visuals">
        <CpBandVisual
          className="cpw5-etfs-band--neutral"
          label={`자산군 구성비 · 전체 ${totalCount.toLocaleString("ko-KR")}개 중 최대 비중`}
          currentLabel={dominantBucket?.label ?? "-"}
          currentValue={`${dominantBucket?.pct ?? 0}%`}
          position={dominantBucket?.pct ?? 0}
          lowLabel="0%"
          midLabel="50%"
          highLabel="100%"
          summary={compositionSummary}
        />
        <CpGaugeCard
          value={leverageInversePct}
          max={100}
          displayValue={`${leverageInversePct}%`}
          unitLabel="레버리지·인버스"
          tone={gaugeTone}
          sub={
            <>
              전체 {totalCount.toLocaleString("ko-KR")}개 중 <strong>{leverageInverseCount.toLocaleString("ko-KR")}개</strong>가 레버리지 또는 인버스입니다.
            </>
          }
        />
      </div>

      <CpCTARow
        primary={{ label: "ETF 비교", href: ROUTES.etfCompare }}
        secondary={{ label: "신규 ETF", href: ROUTES.etfNew }}
      />

      <CpMetricTileGrid>
        <CpMetricTile
          label="신규 상장 ETF"
          value={newCount}
          unit="개"
          sub={
            newPreview.length > 0 ? (
              <span className="cpw5-etfs-mini-list">
                {newPreview.map((row) => (
                  <MoverLink key={`new-${row.s}`} ticker={row.s} valueLabel={row.inceptionDate ?? "-"} />
                ))}
              </span>
            ) : (
              "신규 상장 없음"
            )
          }
        />
        <CpMetricTile
          label="거래량 상위 TOP 3"
          value={volumeLeaders.length}
          unit="종목"
          sub={
            <span className="cpw5-etfs-mini-list">
              {volumeLeaders.map((row) => (
                <MoverLink key={`vol-${row.s}`} ticker={row.s} valueLabel={fmtVolumeCompact(row.volume)} />
              ))}
            </span>
          }
        />
        <CpMetricTile
          label="변동률 상위 TOP 3"
          value={changeLeaders.length}
          unit="종목"
          tone={typeof changeLeaders[0]?.change === "number" ? (changeLeaders[0]!.change! >= 0 ? "positive" : "negative") : "neutral"}
          sub={
            <span className="cpw5-etfs-mini-list">
              {changeLeaders.map((row) => (
                <MoverLink key={`chg-${row.s}`} ticker={row.s} valueLabel={fmtSignedPct(row.change)} />
              ))}
            </span>
          }
        />
      </CpMetricTileGrid>
    </section>
  );
}
