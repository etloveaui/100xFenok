"use client";

import type { ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import MarketThermometer from "@/components/market/MarketThermometer";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import type {
  IndexMomentum,
  MarketEventRisk,
  MarketIndexTrend,
  MarketMacroPulse,
  MarketSentimentPulse,
  MarketSignalPulse,
  MarketStructurePulse,
  MarketTone,
  ValuationBand,
  ValuationDriver,
} from "@/lib/market-valuation/types";
import YardeniCard from "./YardeniCard";
import { formatPercent } from "@/lib/dashboard/formatters";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Map a history percentile to a rich/cheap verdict. */
function valuationMeta(pct: number | null): { label: string; tone: string; dot: string } {
  if (pct === null) return { label: "—", tone: "text-slate-400", dot: "bg-slate-300" };
  if (pct >= 80) return { label: "고평가", tone: "text-rose-600", dot: "bg-rose-500" };
  if (pct >= 60) return { label: "다소 높음", tone: "text-amber-600", dot: "bg-amber-500" };
  if (pct >= 40) return { label: "역사적 중립", tone: "text-slate-600", dot: "bg-slate-400" };
  if (pct >= 20) return { label: "다소 낮음", tone: "text-sky-600", dot: "bg-sky-500" };
  return { label: "저평가", tone: "text-emerald-600", dot: "bg-emerald-500" };
}

function positionPct(value: number | null, min: number | null, max: number | null): number | null {
  if (value === null || min === null || max === null || max === min) return null;
  return Math.min(100, Math.max(0, Math.round(((value - min) / (max - min)) * 100)));
}

function fmt(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

function fmtSignedPct(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function toneClass(tone: MarketTone): string {
  if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "rose") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function toneDotClass(tone: MarketTone): string {
  if (tone === "emerald") return "bg-emerald-500";
  if (tone === "amber") return "bg-amber-500";
  if (tone === "rose") return "bg-rose-500";
  return "bg-slate-400";
}

function fmtIndex(value: number | null): string {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function EmptyPanel({ label }: { label: string }) {
  return <div className="px-4 py-5 text-sm font-semibold text-slate-400">{label}</div>;
}

function PanelShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white shadow-[0_10px_36px_-18px_rgba(15,23,42,0.18)]">
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="min-w-0 text-sm font-black tracking-tight text-slate-950">{title}</h2>
        <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{subtitle}</span>
      </header>
      {children}
    </section>
  );
}

function MacroPulsePanel({ items }: { items: MarketMacroPulse[] }) {
  return (
    <PanelShell title="경기 펄스" subtitle="PMI · ISM · OECD CLI">
      {items.length === 0 ? (
        <EmptyPanel label="경기 데이터 없음" />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2 xl:grid-cols-5">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 xl:border-t-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", toneDotClass(item.tone))} />
                <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
              </div>
              <div className="mt-2 flex min-w-0 items-end gap-1">
                <span className="orbitron min-w-0 text-2xl font-black tabular-nums text-slate-950">{fmt(item.value, 1)}</span>
                <span className="pb-1 text-[10px] font-bold uppercase text-slate-400">{item.unit}</span>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-slate-400">{item.period ?? item.releaseDate ?? "—"}</p>
              <p className="mt-2 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.detail}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function SignalPulsePanel({ items }: { items: MarketSignalPulse[] }) {
  return (
    <PanelShell title="유동성·리스크 신호" subtitle="computed signals">
      {items.length === 0 ? (
        <EmptyPanel label="가공 신호 없음" />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                  <p className="mt-1 min-w-0 break-words text-xs font-semibold leading-5 text-slate-500">{item.detail}</p>
                </div>
                <span className={cx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-black", toneClass(item.tone))}>{item.statusLabel}</span>
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{item.asOf ?? "—"}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function SentimentPulsePanel({ items }: { items: MarketSentimentPulse[] }) {
  return (
    <PanelShell title="센티먼트" subtitle="VIX · AAII · MOVE">
      {items.length === 0 ? (
        <EmptyPanel label="센티먼트 데이터 없음" />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 lg:border-t-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", toneDotClass(item.tone))} />
                <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
              </div>
              <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{item.valueLabel}</p>
              <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.detail}</p>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{item.date ?? "—"}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function MarketStructurePanel({ trends, structures }: { trends: MarketIndexTrend[]; structures: MarketStructurePulse[] }) {
  return (
    <PanelShell title="시장 구조" subtitle="indices · slickcharts">
      {trends.length === 0 && structures.length === 0 ? (
        <EmptyPanel label="시장 구조 데이터 없음" />
      ) : (
        <>
          <div className="grid min-w-0 md:grid-cols-2">
            {trends.map((trend) => (
              <div key={trend.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 md:border-t-0">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{trend.label}</p>
                    <p className="orbitron mt-1 text-2xl font-black tabular-nums text-slate-950">{fmtIndex(trend.latestValue)}</p>
                  </div>
                  <span className="shrink-0 text-right text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{trend.latestDate ?? "—"}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MomentumCell label="1Y" value={trend.oneYearReturn} />
                  <MomentumCell label="5Y" value={trend.fiveYearReturn} />
                  <MomentumCell label="DD" value={trend.drawdownFromHigh} />
                </div>
              </div>
            ))}
          </div>
          <div className="grid min-w-0 border-t border-slate-100 sm:grid-cols-2 lg:grid-cols-3">
            {structures.map((item) => (
              <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 lg:[&:nth-child(-n+3)]:border-t-0">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                    <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.detail}</p>
                  </div>
                  <span className={cx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-black tabular-nums", toneClass(item.tone))}>{item.valueLabel}</span>
                </div>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{item.updated ?? "—"}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </PanelShell>
  );
}

function EventRiskPanel({ items }: { items: MarketEventRisk[] }) {
  return (
    <PanelShell title="이벤트 리스크" subtitle="USD calendar">
      {items.length === 0 ? (
        <EmptyPanel label="다가오는 주요 이벤트 없음" />
      ) : (
        <div className="grid min-w-0 lg:grid-cols-2">
          {items.map((item) => {
            const tone: MarketTone = item.importance === "H" ? "rose" : "amber";
            return (
              <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:[&:nth-child(-n+2)]:border-t-0">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-black tabular-nums text-slate-950">{item.dateKst.slice(5)}</p>
                    <p className="text-[10px] font-bold tabular-nums text-slate-400">{item.timeKst}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-black", toneClass(tone))}>{item.importance}</span>
                      <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{item.category}</span>
                    </div>
                    <p className="mt-1 min-w-0 break-words text-sm font-bold leading-5 text-slate-800">{item.titleKo}</p>
                    {item.titleEn ? <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-400">{item.titleEn}</p> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}

function DriverBadge({ driver }: { driver: ValuationDriver | null }) {
  if (!driver) return null;
  return (
    <div className={cx("mt-3 rounded-[1rem] border px-3 py-2", toneClass(driver.tone))}>
      <p className="text-[11px] font-black uppercase tracking-[0.08em]">{driver.label}</p>
      <p className="mt-1 text-[11px] font-semibold leading-5 opacity-80">{driver.detail}</p>
    </div>
  );
}

function MomentumCell({ label, value }: { label: string; value: number | null }) {
  const positive = value !== null && value >= 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className={cx("orbitron mt-1 text-sm font-black tabular-nums", value === null ? "text-slate-300" : positive ? "text-emerald-600" : "text-rose-600")}>
        {fmtSignedPct(value)}
      </p>
    </div>
  );
}

function MomentumBlock({ momentum }: { momentum: IndexMomentum | null }) {
  if (!momentum) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">YTD 분해</p>
      <div className="grid grid-cols-3 gap-2">
        <MomentumCell label="가격" value={momentum.price.ytd} />
        <MomentumCell label="EPS" value={momentum.eps.ytd} />
        <MomentumCell label="P/E" value={momentum.pe.ytd} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MomentumCell label="P/B" value={momentum.pb.ytd} />
        <MomentumCell label="ROE" value={momentum.roe.ytd} />
      </div>
    </div>
  );
}

function ValuationRow({ label, band, digits }: { label: string; band: ValuationBand; digits: number }) {
  const meta = valuationMeta(band.percentile);
  const curPos = positionPct(band.current, band.min, band.max);
  const avgPos = positionPct(band.avg, band.min, band.max);
  return (
    <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</span>
        <span className="orbitron text-xl font-black text-slate-950">{fmt(band.current, digits)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] font-bold">
        <span className={cx("inline-flex items-center gap-1", meta.tone)}>
          <span className={cx("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
          {band.percentile !== null ? <span className="text-slate-400">· 역사 {band.percentile}%</span> : null}
        </span>
        <span className="tabular-nums text-slate-400">
          {fmt(band.min, digits)} ~ {fmt(band.max, digits)}
        </span>
      </div>
      {/* 16-year band gauge: min ── avg ── max, with current marker */}
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-emerald-200 via-slate-200 to-rose-200">
        {avgPos !== null ? (
          <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-slate-400" style={{ left: `${avgPos}%` }} aria-hidden="true" />
        ) : null}
        {curPos !== null ? (
          <span
            className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
            style={{ left: `${curPos}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold uppercase tracking-wider text-slate-300">
        <span>저평가</span>
        <span>avg {fmt(band.avg, digits)}</span>
        <span>고평가</span>
      </div>
    </div>
  );
}

export default function MarketValuationClient() {
  const {
    indices,
    macroPulses,
    signalPulses,
    sentimentPulses,
    eventRisks,
    indexTrends,
    structurePulses,
    dataReady,
    failed,
    sourceDate,
  } = useMarketValuation();

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">Market Valuation</p>
          <h1 className="data-shell-title">시장 밸류에이션</h1>
          <p className="data-shell-desc">
            주요 미국 지수가 <strong className="text-slate-800">역사적으로 비싼지/싼지</strong>. Fwd P/E·P/B를 16년 밴드와 대조합니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          {sourceDate ? (
            <span className="data-shell-pill ok">
              <span />
              {sourceDate}
            </span>
          ) : null}
          <TransitionLink href="/explore" className="data-shell-link">
            Explore
          </TransitionLink>
        </div>
      </section>

      {failed ? (
        <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          지수 밸류에이션 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      <MarketThermometer />

      <div className={cx("grid gap-4", !dataReady && "opacity-60")}>
        <MacroPulsePanel items={macroPulses} />
        <SignalPulsePanel items={signalPulses} />
      </div>

      <div className={cx("grid gap-4", !dataReady && "opacity-60")}>
        <SentimentPulsePanel items={sentimentPulses} />
        <MarketStructurePanel trends={indexTrends} structures={structurePulses} />
      </div>

      <EventRiskPanel items={eventRisks} />

      <div className={cx("grid gap-4 sm:grid-cols-2", !dataReady && "opacity-60")}>
        {indices.map((index) => (
          <section
            key={index.id}
            className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-5"
          >
            <header className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{index.nameEn}</p>
                <h2 className="truncate text-lg font-black tracking-tight text-slate-950">{index.name}</h2>
              </div>
              <div className="text-right">
                <p className="orbitron text-lg font-black tabular-nums text-slate-900">
                  {index.price === null ? "—" : index.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{index.date ?? "—"}</p>
              </div>
            </header>

            <div className="mt-3 grid gap-2">
              <ValuationRow label="Fwd P/E" band={index.pe} digits={1} />
              <ValuationRow label="P/B" band={index.pb} digits={2} />
              <div className="flex items-center justify-between rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-2">
                <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">ROE</span>
                <span className="orbitron text-lg font-black tabular-nums text-slate-900">
                  {index.roe === null ? "—" : formatPercent(index.roe * 100, 1)}
                </span>
              </div>
            </div>
            <MomentumBlock momentum={index.momentum} />
            <DriverBadge driver={index.driver} />
          </section>
        ))}
      </div>

      <YardeniCard />

      <p className="px-1 text-[11px] text-slate-400">
        역사 밴드 = 2010년 이후 weekly 시계열의 min/avg/max. percentile은 현재값의 역사적 위치(높을수록 고평가). YTD 분해는 가격 변화가 EPS 개선인지 멀티플 확장/축소인지 보기 위한 가공 신호입니다.
      </p>
    </div>
  );
}
