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

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fmtCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("ko-KR")
    : "—";
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
  const weakSentiment = [...model.sentiment]
    .sort((a, b) => (numberOrNull(a.latest.value) ?? 100) - (numberOrNull(b.latest.value) ?? 100))
    .slice(0, 3);
  const fullDepth = model.meta.reachable_count;
  const defaultVisible = model.meta.default_visible_count;

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-4">
      <div className="min-w-0 rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
        <p className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Coverage</p>
        <p className="orbitron mt-1 text-2xl font-black tabular-nums text-slate-950">
          {fmtCount(fullDepth)}
        </p>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">
          기본 {fmtCount(defaultVisible)} · MAX는 raw depth 패널에서 확장
        </p>
      </div>
      <div className="min-w-0 rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
        <p className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Liquidity</p>
        <p className="orbitron mt-1 text-2xl font-black tabular-nums text-slate-950">
          {model.liquidity.length}
        </p>
        <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
          {model.liquidity.map((item) => item.label).join(" · ") || "—"}
        </p>
      </div>
      <div className="min-w-0 rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
        <p className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Concentration</p>
        <p className="orbitron mt-1 text-2xl font-black tabular-nums text-slate-950">
          {fmt(topConcentration?.top10Weight, 1, "%")}
        </p>
        <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
          {topConcentration?.label ?? "—"} Top10
        </p>
      </div>
      <div className="min-w-0 rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
        <p className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Weak Sentiment</p>
        <p className="mt-2 min-w-0 break-words text-[11px] font-black leading-5 text-slate-700">
          {weakSentiment.map((item) => `${item.label} ${fmt(numberOrNull(item.latest.value), 1)}`).join(" · ") || "—"}
        </p>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">
          {model.aaii?.latest.date ?? model.generatedAt ?? "—"}
        </p>
      </div>
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
            원장
          </TransitionLink>
          <TransitionLink href="/explore" className="data-shell-link">
            Explore
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
            <SlotShell id="benchmark" title="이익 × 멀티플 매트릭스" subtitle="7 benchmarks">
              {slots.benchmark ? (
                slots.benchmark(slotProps)
              ) : (
                <Placeholder>
                  market-structure-benchmark 슬롯
                  <br />
                  props: {"{ model }"} · `model.benchmarkMatrix.rows` 전체 7개 벤치마크
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="credit" title="신용등급 스프레드" subtitle="3 Damodaran tables">
              {slots.credit ? (
                slots.credit(slotProps)
              ) : (
                <Placeholder>
                  market-structure-credit 슬롯
                  <br />
                  props: {"{ model }"} · `model.creditRatings.tables` 3개 테이블
                </Placeholder>
              )}
            </SlotShell>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <SlotShell id="mag7" title="Magnificent 7 리더십" subtitle="weight · market cap">
              {slots.mag7 ? (
                slots.mag7(slotProps)
              ) : (
                <Placeholder>
                  market-structure-mag7 슬롯
                  <br />
                  props: {"{ model }"} · `model.magnificent7.holdings` 리더십 패널
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="membership" title="지수 편입·제외" subtitle="membership changes">
              {slots.membership ? (
                slots.membership(slotProps)
              ) : (
                <Placeholder>
                  market-structure-membership 슬롯
                  <br />
                  props: {"{ model }"} · `model.membershipChanges.recent` 이벤트 원장
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
                  market-structure-liquidity 슬롯
                  <br />
                  props: {"{ model }"} · 패널은 `model.liquidity[*].loadFull()`로 MAX를 연결
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="sentiment" title="CNN 하위 심리" subtitle="7 components">
              {slots.sentiment ? (
                slots.sentiment(slotProps)
              ) : (
                <Placeholder>
                  market-structure-sentiment 슬롯
                  <br />
                  props: {"{ model }"} · 패널은 component별 explicit adapter 사용
                </Placeholder>
              )}
            </SlotShell>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <SlotShell id="aaii" title="AAII 개인투자자 심리" subtitle="bull · bear · spread">
              {slots.aaii ? (
                slots.aaii(slotProps)
              ) : (
                <Placeholder>
                  market-structure-aaii 슬롯
                  <br />
                  props: {"{ model }"} · MAX는 `model.aaii.loadFull()`
                </Placeholder>
              )}
            </SlotShell>

            <SlotShell id="concentration" title="지수 집중도" subtitle="SlickCharts holdings">
              {slots.concentration ? (
                slots.concentration(slotProps)
              ) : (
                <Placeholder>
                  market-structure-concentration 슬롯
                  <br />
                  props: {"{ model }"} · 집중도/리더 보유비중 패널
                </Placeholder>
              )}
            </SlotShell>
          </div>
        </div>
      ) : null}
    </div>
  );
}
