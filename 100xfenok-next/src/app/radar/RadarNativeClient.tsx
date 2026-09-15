"use client";

import Link from "next/link";
import { useState } from "react";
import { ROUTES } from "@/lib/routes";
import { useRadarData, type CardState } from "./useRadarData";

export type RadarCategory = "all" | "liquidity" | "sentiment";

const DETAIL_PATHS = {
  flow: "tools/macro-monitor/details/liquidity-flow.html",
  stress: "tools/macro-monitor/details/liquidity-stress.html",
  banking: "tools/macro-monitor/details/banking-health.html",
  sentiment: "tools/macro-monitor/details/sentiment-signal/index.html",
} as const;

function detailHref(path: string): string {
  return `${ROUTES.radar}?path=${encodeURIComponent(path)}`;
}

const TONE_KO: Record<string, string> = {
  normal: "정상",
  caution: "주의",
  warning: "경계",
  danger: "위험",
  rising: "상승",
  stable: "안정",
  falling: "하락",
  neutral: "중립",
  opportunity: "기회",
  active: "활성",
  near: "접근",
  inactive: "대기",
  buy: "매수",
  warn: "경계",
};

function toneKo(tone: string): string {
  return TONE_KO[tone] ?? tone;
}

function signedBillions(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}B $`;
}

function StateNote({ state, onRetry }: { state: CardState; onRetry: () => void }) {
  if (state === "loading") {
    return <p className="mt-3 text-sm text-slate-500">불러오는 중입니다.</p>;
  }
  if (state === "missing") {
    return <p className="mt-3 text-sm text-slate-500">받은 자료가 없어 표시할 수 없습니다.</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <p className="text-sm text-slate-500">자료를 불러오지 못했습니다.</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
      >
        다시 시도
      </button>
    </div>
  );
}

function CardShell({
  id,
  kicker,
  title,
  detail,
  children,
  footer,
}: {
  id: string;
  kicker: string;
  title: string;
  detail: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <article
      data-radar-card={id}
      className="flex min-h-80 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-600">
          {kicker}
        </span>
      </div>
      <Link
        href={detailHref(detail)}
        data-radar-card-link={id}
        className="mt-2 flex min-h-11 flex-1 flex-col rounded-lg"
      >
        <h3 className="text-base font-black text-slate-900">{title}</h3>
        <div className="mt-2 flex-1">{children}</div>
      </Link>
      {footer}
    </article>
  );
}

export default function RadarNativeClient({ initialCategory }: { initialCategory: RadarCategory }) {
  const [category, setCategory] = useState<RadarCategory>(initialCategory);
  const { flow, stress, banking, sentiment, retry } = useRadarData();

  const cards = [
    { id: "flow", group: "liquidity" as const },
    { id: "stress", group: "liquidity" as const },
    { id: "banking", group: "liquidity" as const },
    { id: "sentiment", group: "sentiment" as const },
  ];
  const visible = cards.filter((card) => category === "all" || card.group === category);

  const states: CardState[] = [flow.state, stress.state, banking.state, sentiment.state];
  const readyCount = states.filter((s) => s === "ready").length;
  const missingCount = states.filter((s) => s === "missing" || s === "failed").length;
  const basisDates = [flow.snapshot?.as_of, stress.snapshot?.as_of, banking.snapshot?.as_of].filter(Boolean) as string[];
  const basis = basisDates.length ? basisDates.sort().reverse()[0] : null;

  const flowSnap = flow.snapshot;
  const stressSnap = stress.snapshot;
  const bankingSnap = banking.snapshot;
  const sentimentSnap = sentiment.snapshot;
  const activeCombos = sentimentSnap?.combos.filter((c) => c.status === "active").length ?? 0;
  const totalCombos = sentimentSnap?.combos.length ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Radar 요약">
        <span className="inline-flex min-h-11 items-center rounded-full border border-green-200 bg-green-50 px-3 text-xs font-bold text-green-800">
          표시 중 {readyCount}
        </span>
        <span className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600">
          자료 없음 {missingCount}
        </span>
        <span className="inline-flex min-h-11 items-center rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-900">
          기준 {basis ?? "확인 중"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Radar 분류">
        {(
          [
            { key: "all", label: "전체" },
            { key: "liquidity", label: "유동성" },
            { key: "sentiment", label: "심리" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={category === tab.key}
            onClick={() => setCategory(tab.key)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-bold transition ${
              category === tab.key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {visible.some((c) => c.id === "flow") && (
          <CardShell
            id="liquidity-flow"
            kicker="유동성"
            title="유동성 흐름"
            detail={DETAIL_PATHS.flow}
            footer={flow.state !== "ready" ? <StateNote state={flow.state} onRetry={retry} /> : undefined}
          >
            {flowSnap ? (
              <div>
                <p className="text-2xl font-black text-slate-900">{signedBillions(flowSnap.weeklyNetFlow)}</p>
                <p className="mt-1 text-sm font-bold text-slate-600">주간 순유동성 변화 · {toneKo(flowSnap.status)}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">M2 증가율</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">{flowSnap.m2YoY.toFixed(2)}%</dd>
                    <dd className="text-[11px] text-slate-500">${(flowSnap.m2Total / 1000).toFixed(2)}T</dd>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">순유동성</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">${flowSnap.netLiquidity.toFixed(1)}B</dd>
                    <dd className="text-[11px] text-slate-500">연준 − TGA − RRP</dd>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">스테이블코인</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">{flowSnap.scM2Ratio.toFixed(2)}%</dd>
                    <dd className="text-[11px] text-slate-500">M2 대비</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </CardShell>
        )}

        {visible.some((c) => c.id === "stress") && (
          <CardShell
            id="liquidity-stress"
            kicker="유동성"
            title="유동성 스트레스"
            detail={DETAIL_PATHS.stress}
            footer={stress.state !== "ready" ? <StateNote state={stress.state} onRetry={retry} /> : undefined}
          >
            {stressSnap ? (
              <div>
                <p className="text-2xl font-black text-slate-900">{toneKo(stressSnap.overallStatus)}</p>
                <p className="mt-1 text-sm font-bold text-slate-600">{stressSnap.overallLabel}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">금리 스프레드</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">{stressSnap.tier1.value}bp</dd>
                    <dd className="text-[11px] text-slate-500">{toneKo(stressSnap.tier1.status)}</dd>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">지급준비금/GDP</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">{stressSnap.tier2.value}%</dd>
                    <dd className="text-[11px] text-slate-500">{toneKo(stressSnap.tier2.status)}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </CardShell>
        )}

        {visible.some((c) => c.id === "banking") && (
          <CardShell
            id="banking-health"
            kicker="자금"
            title="은행 건전성"
            detail={DETAIL_PATHS.banking}
            footer={banking.state !== "ready" ? <StateNote state={banking.state} onRetry={retry} /> : undefined}
          >
            {bankingSnap ? (
              <div>
                <p className="text-2xl font-black text-slate-900">{toneKo(bankingSnap.overallStatus)}</p>
                <p className="mt-1 text-sm font-bold text-slate-600">{bankingSnap.overallLabel}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">자본비율</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">{bankingSnap.tier1.value}%</dd>
                    <dd className="text-[11px] text-slate-500">{toneKo(bankingSnap.tier1.status)}</dd>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">예대율</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">{bankingSnap.loanDeposit.value}%</dd>
                    <dd className="text-[11px] text-slate-500">{toneKo(bankingSnap.loanDeposit.status)}</dd>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <dt className="text-[11px] font-bold text-slate-500">연체율</dt>
                    <dd className="mt-1 text-sm font-black text-slate-900">{bankingSnap.delinquency.value}%</dd>
                    <dd className="text-[11px] text-slate-500">{toneKo(bankingSnap.delinquency.status)}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </CardShell>
        )}

        {visible.some((c) => c.id === "sentiment") && (
          <CardShell
            id="sentiment-signal"
            kicker="심리"
            title="심리 신호"
            detail={DETAIL_PATHS.sentiment}
            footer={sentiment.state !== "ready" ? <StateNote state={sentiment.state} onRetry={retry} /> : undefined}
          >
            {sentimentSnap ? (
              <div>
                <p className="text-2xl font-black text-slate-900">
                  {activeCombos} / {totalCombos} 활성
                </p>
                <p className="mt-1 text-sm font-bold text-slate-600">전체 흐름 {toneKo(sentimentSnap.overallStatus)}</p>
                <ul className="mt-3 flex flex-col gap-1">
                  {sentimentSnap.combos.map((combo) => (
                    <li
                      key={combo.id}
                      className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1"
                    >
                      <span className="text-xs font-bold text-slate-700">{combo.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-white px-1.5">{toneKo(combo.category)}</span>
                        <span>{toneKo(combo.status)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardShell>
        )}
      </div>
    </div>
  );
}
