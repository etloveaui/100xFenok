"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import DataStateNotice from "@/components/DataStateNotice";
import { sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";
import { formatSignedPercent } from "@/lib/format";
import { makeDataState } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";

/**
 * 섹터 흐름 패널 — 11 sectors as sorted diverging-bar rows (shell v3).
 * Source: benchmarks/summaries.json momentum (1m).
 */

type MomentumMap = Record<string, Record<string, number>>;

const SECTOR_KEYS: Array<{ key: string; canonical: CanonicalSector }> = [
  { key: "information_technology", canonical: "Technology" },
  { key: "communication_services", canonical: "Communication Services" },
  { key: "consumer_discretionary", canonical: "Consumer Discretionary" },
  { key: "consumer_staples", canonical: "Consumer Staples" },
  { key: "energy", canonical: "Energy" },
  { key: "financials", canonical: "Financials" },
  { key: "health_care", canonical: "Healthcare" },
  { key: "industrials", canonical: "Industrials" },
  { key: "materials", canonical: "Materials" },
  { key: "real_estate", canonical: "Real Estate" },
  { key: "utilities", canonical: "Utilities" },
];

function pct(v: number | undefined | null): string {
  return formatSignedPercent(v, { digits: 1 });
}

export default function ExploreDashboard() {
  const [momentum, setMomentum] = useState<MomentumMap | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/benchmarks/summaries.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.momentum) setMomentum(j.momentum as MomentumMap);
        if (!cancelled) setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!momentum) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>섹터 흐름</h2>
          <span className="desc">최근 1개월 · 수익률순</span>
        </div>
        <div className="panel-b">
          <DataStateNotice
            state={makeDataState({
              status: loaded ? "error" : "pending",
              label: loaded ? "섹터 흐름 오류" : "섹터 흐름 확인 중",
              detail: loaded ? "섹터별 1개월 흐름 데이터를 불러오지 못했습니다." : "섹터별 수익률 데이터를 읽고 있습니다.",
            })}
          />
        </div>
      </section>
    );
  }

  const rows = SECTOR_KEYS.map(({ key, canonical }) => ({
    key,
    label: sectorLabelKo(canonical),
    v: typeof momentum[key]?.["1m"] === "number" ? momentum[key]["1m"] : null,
  }))
    .filter((r): r is { key: string; label: string; v: number } => r.v !== null)
    .sort((a, b) => b.v - a.v);
  if (rows.length === 0) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>섹터 흐름</h2>
          <span className="desc">최근 1개월 · 수익률순</span>
        </div>
        <div className="panel-b">
          <DataStateNotice
            state={makeDataState({
              status: "unavailable",
              label: "표시할 섹터 없음",
              detail: "데이터 파일은 열렸지만 1개월 수익률을 계산할 섹터가 없습니다.",
            })}
          />
        </div>
      </section>
    );
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.v)));

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>섹터 흐름</h2>
        <span className="desc">최근 1개월 · 수익률순</span>
        <TransitionLink href={ROUTES.sectors} className="act">
          히트맵 →
        </TransitionLink>
      </div>
      <div className="rows">
        {rows.map(({ key, label, v }) => {
          const up = v >= 0;
          const w = Math.max((Math.abs(v) / max) * 50, 3);
          return (
            <TransitionLink key={key} href={ROUTES.sectors} className="sec-row" title={`${label} 1개월 ${pct(v)}`}>
              <span className="sn">{label}</span>
              <div className="sec-track">
                <span className="z" />
                <i
                  style={{
                    width: `${w}%`,
                    left: up ? "50%" : undefined,
                    right: up ? undefined : "50%",
                    background: up ? "var(--c-up)" : "var(--c-down)",
                  }}
                />
              </div>
              <span className={`sv num ${up ? "up" : "down"}`}>{pct(v)}</span>
            </TransitionLink>
          );
        })}
      </div>
    </section>
  );
}
