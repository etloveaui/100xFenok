"use client";

import { FenokSignalRadarHexagonPair } from "./FenokSignalRadarHexagonPair";
import type { FenokSignalRadarHexagonAxis } from "./FenokSignalRadarHexagon";

const SAMPLE_SHORT_TERM_AXES: FenokSignalRadarHexagonAxis[] = [
  { label: "수익성", fullLabel: "수익성", score: 88, direction: "strong", tier: "strong" },
  { label: "내구", fullLabel: "내구 수익성", score: 74, direction: "constructive", tier: "constructive" },
  { label: "성장", fullLabel: "성장", score: 76, direction: "constructive", tier: "constructive" },
  { label: "기술", fullLabel: "기술·자금", score: 59, direction: "neutral", tier: "neutral" },
  { label: "상방", fullLabel: "상승 잠재력", score: 63, direction: "upside_bias", tier: "constructive" },
  { label: "하방", fullLabel: "하락 압력", score: 42, direction: "downside_bias", tier: "neutral" },
];

const SAMPLE_LONG_TERM_AXES: FenokSignalRadarHexagonAxis[] = [
  { label: "수익성", fullLabel: "수익성", score: 72, direction: "constructive", tier: "constructive" },
  { label: "내구", fullLabel: "내구 수익성", score: 81, direction: "strong", tier: "strong" },
  { label: "성장", fullLabel: "성장", score: 68, direction: "constructive", tier: "constructive" },
  { label: "상방", fullLabel: "상승 잠재력", score: 58, direction: "balanced", tier: "neutral" },
  { label: "하방", fullLabel: "하락 압력", score: 35, direction: "downside_bias", tier: "constructive" },
  { label: "동종군", fullLabel: "동종군 유사도", score: 60, direction: "neutral", tier: "neutral" },
];

export function FenokSignalRadarHexagonPairSample() {
  return (
    <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink)]">
          Fenok 신호 한눈에 보기 · 매수권유 아님
        </h3>
        <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
          6축 hexagon pair 샘플
        </span>
      </div>
      <FenokSignalRadarHexagonPair
        leftTitle="Short-term"
        rightTitle="Long-term"
        leftAxes={SAMPLE_SHORT_TERM_AXES}
        rightAxes={SAMPLE_LONG_TERM_AXES}
        size="lg"
      />
      <p className="mt-3 text-[10px] font-bold text-[var(--c-ink-3)]">
        Fenok 파생 신호 · 데이터는 mock/sample · 실제 배선은 cc가 12축 스펙 전달 후 진행
      </p>
    </div>
  );
}
