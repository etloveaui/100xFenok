"use client";

import Link from "next/link";
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

const COMBO_KO: Record<string, string> = {
  "VIX Panic Buy": "VIX 패닉 매수",
  "AAII Extreme Bear": "AAII 극단적 약세",
  "CNN Extreme Fear": "CNN 극단적 공포",
  "Triple Fear": "트리플 공포",
  "Fear Consensus": "공포 컨센서스",
  "AAII Spread Panic": "AAII 스프레드 패닉",
  "Put/Call Extreme": "풋콜 익스트림",
  "Triple Greed": "트리플 탐욕",
  "Greed Consensus": "탐욕 컨센서스",
  "Put/Call Low": "풋콜 저점",
};

function comboKo(name: string): string {
  return COMBO_KO[name] ?? name;
}

function signedBillions(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}B $`;
}

/* Signal summary bar: one LED per card verdict plus a sentiment-activity
 * gauge. LED colors encode the source's own grade only — flow colors are
 * direction (rising/stable/falling), stress/banking reuse their 4-grade
 * severity, sentiment reuses opportunity/neutral/warning. Non-ready cards get
 * a hollow dot and an honest label; the per-card StateNote keeps its retry. */
type LedTone = "green" | "slate" | "amber" | "orange" | "red" | "blue" | "hollow";

const LED_DOT: Record<LedTone, string> = {
  green: "bg-green-500",
  slate: "bg-slate-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  hollow: "border border-slate-300 bg-white",
};

type LedItem = { id: string; label: string; text: string; tone: LedTone };

function flowLed(status: string | null, state: CardState): LedItem {
  if (state !== "ready" || !status) {
    return { id: "flow", label: "유동성 흐름", text: state === "loading" ? "확인 중" : "자료 없음", tone: "hollow" };
  }
  const tone: LedTone = status === "rising" ? "green" : status === "falling" ? "amber" : "slate";
  return { id: "flow", label: "유동성 흐름", text: toneKo(status), tone };
}

function gradeLed(id: string, label: string, status: string | null, state: CardState): LedItem {
  if (state !== "ready" || !status) {
    return { id, label, text: state === "loading" ? "확인 중" : "자료 없음", tone: "hollow" };
  }
  const tone: LedTone =
    status === "normal" ? "green" : status === "caution" ? "amber" : status === "warning" ? "orange" : status === "danger" ? "red"
    : status === "opportunity" ? "green" : status === "neutral" ? "slate" : "amber";
  return { id, label, text: toneKo(status), tone };
}

function SummaryBar({ leds, activeCombos, totalCombos }: { leds: LedItem[]; activeCombos: number; totalCombos: number }) {
  const share = totalCombos > 0 ? Math.round((activeCombos / totalCombos) * 100) : null;
  return (
    <section aria-label="Radar 신호 요약" data-radar-summary="true" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <ul className="flex flex-wrap gap-2" aria-label="4판정 신호">
        {leds.map((led) => (
          <li
            key={led.id}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700"
          >
            <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${LED_DOT[led.tone]}`} />
            {led.label} {led.text}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
          <span>심리온도</span>
          <span>{share === null ? "자료 없음" : `활성 ${activeCombos}/${totalCombos}`}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={share === null ? "심리 활성 자료 없음" : `심리 활성 ${activeCombos}/${totalCombos}`}>
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${share ?? 0}%` }} />
        </div>
      </div>
    </section>
  );
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
  const category = initialCategory;
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
      <SummaryBar
        leds={[
          flowLed(flowSnap?.status ?? null, flow.state),
          gradeLed("stress", "스트레스", stressSnap?.overallStatus ?? null, stress.state),
          gradeLed("banking", "은행", bankingSnap?.overallStatus ?? null, banking.state),
          gradeLed("sentiment", "심리", sentimentSnap?.overallStatus ?? null, sentiment.state),
        ]}
        activeCombos={activeCombos}
        totalCombos={totalCombos}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Radar 요약">
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

      <div className="mt-4 grid items-start gap-3 md:grid-cols-2">
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
                      <span className="text-xs font-bold text-slate-700">{comboKo(combo.name)}</span>
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
