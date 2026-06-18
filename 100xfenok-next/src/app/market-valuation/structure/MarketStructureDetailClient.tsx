"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import TransitionLink from "@/components/TransitionLink";
import {
  loadMarketStructureModel,
  type MarketStructureModel,
} from "@/lib/market-valuation/models/marketStructureModel";

type LoadState = "loading" | "ready" | "failed";

export interface MarketStructureSlotProps {
  model: MarketStructureModel;
}

export interface MarketStructureDetailSlots {
  benchmark?: (props: MarketStructureSlotProps) => ReactNode;
  credit?: (props: MarketStructureSlotProps) => ReactNode;
  mag7?: (props: MarketStructureSlotProps) => ReactNode;
  membership?: (props: MarketStructureSlotProps) => ReactNode;
  concentration?: (props: MarketStructureSlotProps) => ReactNode;
  liquidity?: (props: MarketStructureSlotProps) => ReactNode;
  sentiment?: (props: MarketStructureSlotProps) => ReactNode;
  aaii?: (props: MarketStructureSlotProps) => ReactNode;
}

interface MarketStructureDetailClientProps {
  slots?: MarketStructureDetailSlots;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function fmt(value: number | null | undefined, digits = 1, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(digits)}${suffix}`
    : "—";
}

function fmtUsdBillions(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(0)}B`
    : "—";
}

function fmtSignedUsdBillions(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toFixed(0)}B`;
}

function spreadTone(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value > 0) return "강세우위";
  if (value < 0) return "약세우위";
  return "중립";
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
      <p className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="orbitron mt-1 text-2xl font-black tabular-nums text-slate-950">
        {value}
      </p>
      <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-4 text-slate-500">
        {detail}
      </p>
    </div>
  );
}

function SlotShell({
  id,
  title,
  subtitle,
  children,
}: {
  id: keyof MarketStructureDetailSlots;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section
      data-slot={`market-structure-${id}`}
      className="min-w-0 rounded-[1.2rem] border border-slate-200 bg-white p-4 shadow-[0_10px_36px_-18px_rgba(15,23,42,0.18)]"
    >
      <header className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 className="min-w-0 text-sm font-black tracking-tight text-slate-950">{title}</h2>
        <span className="min-w-0 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
          {subtitle}
        </span>
      </header>
      {children}
    </section>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs font-bold leading-5 text-slate-400">
      {children}
    </div>
  );
}

function SummaryStrip({ model }: { model: MarketStructureModel }) {
  const topConcentration = model.concentration[0] ?? null;
  const tga = model.liquidity.find((item) => item.id === "tga") ?? null;
  const aaii = model.aaii;

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-4">
      <MetricCard
        label="집중도"
        value={fmt(topConcentration?.top10Weight, 1, "%")}
        detail={`${topConcentration?.label ?? "S&P 500"} Top10`}
      />
      <MetricCard
        label="Mag7"
        value={fmt(model.magnificent7.indexWeight, 1, "%")}
        detail="S&P 500 시총 대비"
      />
      <MetricCard
        label="유동성"
        value={fmtUsdBillions(tga?.latest.value)}
        detail={`재무부 잔고 · 7일 ${fmtSignedUsdBillions(tga?.delta7d)}`}
      />
      <MetricCard
        label="투자심리"
        value={fmt(aaii?.spread, 1)}
        detail={`AAII 강세-약세 · 강세 ${fmt(aaii?.bullish, 1)} / 약세 ${fmt(aaii?.bearish, 1)} · ${spreadTone(aaii?.spread)}`}
      />
    </div>
  );
}

export default function MarketStructureDetailClient({
  slots = {},
}: MarketStructureDetailClientProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [model, setModel] = useState<MarketStructureModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMarketStructureModel().then((next) => {
      if (cancelled) return;
      setModel(next);
      setState(next ? "ready" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const slotProps = useMemo<MarketStructureSlotProps | null>(
    () => (model ? { model } : null),
    [model],
  );

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <div className="mb-2 hidden items-center gap-2 text-[11px] font-black uppercase tracking-[0.1em] text-slate-400 md:flex">
            <TransitionLink href="/market-valuation" className="hover:text-brand-interactive">
              시장 밸류에이션
            </TransitionLink>
            <span>/</span>
            <span className="text-slate-600">시장 구조</span>
          </div>
          <p className="data-shell-kicker">Market Structure</p>
          <h1 className="data-shell-title">시장 구조 상세</h1>
          <p className="data-shell-desc">
            벤치마크 매트릭스, 신용 스프레드, Magnificent 7, 편입·제외 이벤트, 유동성, 집중도, CNN 하위 심리와 AAII까지 한 화면에서 확장합니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          {model?.generatedAt ? (
            <span className="data-shell-pill ok">
              <span />
              {model.generatedAt}
            </span>
          ) : null}
          <TransitionLink href="/market-valuation" className="data-shell-link">
            시장 밸류에이션
          </TransitionLink>
          <TransitionLink href="/explore" className="data-shell-link">
            탐색
          </TransitionLink>
        </div>
      </section>

      {state === "loading" ? (
        <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-8 text-center text-sm font-bold text-slate-400">
          시장 구조 데이터를 불러오는 중입니다.
        </div>
      ) : null}

      {state === "failed" ? (
        <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          시장 구조 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      {model && slotProps ? (
        <div className={cx("grid gap-4", state !== "ready" && "opacity-60")}>
          <SummaryStrip model={model} />

          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <SlotShell id="benchmark" title="이익 × 멀티플 매트릭스" subtitle="7개 벤치마크">
              {slots.benchmark ? (
                slots.benchmark(slotProps)
              ) : (
                <Placeholder>
                  벤치마크 상세 패널 준비 중
                  <br />
                  7개 벤치마크의 이익과 멀티플을 비교합니다
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="credit" title="신용등급 스프레드" subtitle="신용 스프레드 표 3개">
              {slots.credit ? (
                slots.credit(slotProps)
              ) : (
                <Placeholder>
                  신용등급 상세 패널 준비 중
                  <br />
                  등급별 스프레드 변화를 비교합니다
                </Placeholder>
              )}
            </SlotShell>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <SlotShell id="mag7" title="Magnificent 7 리더십" subtitle="비중·시총">
              {slots.mag7 ? (
                slots.mag7(slotProps)
              ) : (
                <Placeholder>
                  대형 기술주 리더십 패널 준비 중
                  <br />
                  지수 내 비중과 시가총액 변화를 보여줍니다
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="membership" title="지수 편입·제외" subtitle="편입·편출">
              {slots.membership ? (
                slots.membership(slotProps)
              ) : (
                <Placeholder>
                  편입·제외 이벤트 패널 준비 중
                  <br />
                  최근 지수 편입과 제외 종목을 정리합니다
                </Placeholder>
              )}
            </SlotShell>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <SlotShell id="liquidity" title="유동성" subtitle="TGA · stablecoins">
              {slots.liquidity ? (
                slots.liquidity(slotProps)
              ) : (
                <Placeholder>
                  유동성 상세 패널 준비 중
                  <br />
                  재무부 잔고와 스테이블코인 흐름을 비교합니다
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="sentiment" title="CNN 하위 심리" subtitle="7개 구성 지표">
              {slots.sentiment ? (
                slots.sentiment(slotProps)
              ) : (
                <Placeholder>
                  투자심리 상세 패널 준비 중
                  <br />
                  심리 구성 요소별 강약을 보여줍니다
                </Placeholder>
              )}
            </SlotShell>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <SlotShell id="aaii" title="AAII 개인투자자 심리" subtitle="강세·약세·스프레드">
              {slots.aaii ? (
                slots.aaii(slotProps)
              ) : (
                <Placeholder>
                  개인투자자 심리 패널 준비 중
                  <br />
                  강세와 약세 응답의 차이를 추적합니다
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="concentration" title="지수 집중도" subtitle="보유비중 기준">
              {slots.concentration ? (
                slots.concentration(slotProps)
              ) : (
                <Placeholder>
                  지수 집중도 패널 준비 중
                  <br />
                  상위 종목 비중과 쏠림 정도를 보여줍니다
                </Placeholder>
              )}
            </SlotShell>
          </div>
        </div>
      ) : null}
    </div>
  );
}
