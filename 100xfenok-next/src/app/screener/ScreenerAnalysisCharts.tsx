"use client";

import { useId, useRef, useState } from "react";
import { COMPARISON_METRICS, finite, normalizedComparison, type ComparisonEntity } from "./screener-analysis";

const COLORS = ["#0072B2", "#D55E00", "#56B4E9", "#E69F00"];
const point = (index: number, radius: number) => {
  const angle = -Math.PI / 2 + index * 2 * Math.PI / 5;
  return [190 + radius * Math.cos(angle), 150 + radius * Math.sin(angle)];
};

export default function ScreenerAnalysisCharts({ entities, sourceDate }: {
  entities: readonly ComparisonEntity[]; sourceDate: string | null;
}) {
  const id = useId();
  const radar = useRef<SVGSVGElement>(null);
  const bubble = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);
  const plotted = entities.filter((entity) => finite(entity.values.roe) && finite(entity.values.growthRate));
  const xs = plotted.map((entity) => entity.values.roe! * 100);
  const ys = plotted.map((entity) => entity.values.growthRate! * 100);
  const xMin = Math.min(0, ...xs) - 5, xMax = Math.max(0, ...xs) + 5;
  const yMin = Math.min(0, ...ys) - 5, yMax = Math.max(0, ...ys) + 5;
  const x = (value: number) => 60 + (value - xMin) / (xMax - xMin) * 270;
  const y = (value: number) => 250 - (value - yMin) / (yMax - yMin) * 190;
  const maxCap = Math.max(1, ...plotted.map((entity) => entity.values.marketCap ?? 0));

  async function downloadPng(element: SVGSVGElement | null, name: string) {
    if (!element) return;
    setError(null);
    const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("이미지를 만들지 못했습니다.")); image.src = svgUrl; });
      const canvas = document.createElement("canvas");
      canvas.width = 1140; canvas.height = 960;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG 내보내기를 지원하지 않는 브라우저입니다.");
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG를 저장하지 못했습니다.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `100xfenok-${name}-${sourceDate ?? "undated"}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "PNG 내보내기에 실패했습니다."); }
    finally { URL.revokeObjectURL(svgUrl); }
  }

  return <div>
    <div className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-xl border border-[var(--c-line)] p-3">
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold">지표별 비교</h3>
          <button type="button" className="min-h-11 px-2 text-sm underline" onClick={() => void downloadPng(radar.current, "comparison-radar")}>PNG 저장</button></div>
        <svg ref={radar} xmlns="http://www.w3.org/2000/svg" width="380" height="320" viewBox="0 0 380 320" role="img" aria-labelledby={`${id}-radar`} className="w-full" style={{ height: "auto", background: "white", color: "#0f172a", fontFamily: "sans-serif" }}>
          <title id={`${id}-radar`}>ROE, 성장률, 모멘텀, PER, 배당수익률 정규화 비교. 원래 값은 아래 표에 표시합니다.</title>
          {[25, 50, 75, 100].map((level) => <polygon key={level} points={COMPARISON_METRICS.map((_, index) => point(index, level).join(",")).join(" ")} fill="none" stroke="#cbd5e1" />)}
          {COMPARISON_METRICS.map((metric, index) => { const [px, py] = point(index, 122); return <g key={metric.key}>
            <line x1="190" y1="150" x2={point(index, 100)[0]} y2={point(index, 100)[1]} stroke="#cbd5e1" />
            <text x={px} y={py} textAnchor="middle" fontSize="11" fill="#334155">{metric.label}</text>
          </g>; })}
          {entities.map((entity, index) => {
            const values = normalizedComparison(entity);
            if (values.some((value) => value === null)) return null;
            return <polygon key={entity.id} points={values.map((value, dimension) => point(dimension, value!).join(",")).join(" ")} fill="none" stroke={COLORS[index]} strokeWidth="2.5" strokeDasharray={index ? `${index * 3} 3` : undefined}>
              <title>{entity.name}</title>
            </polygon>;
          })}
          <text x="190" y="306" textAnchor="middle" fontSize="10" fill="#475569">자료 기준 {sourceDate ?? "미제공"} · 0–100 정규화</text>
        </svg>
        <p className="text-xs text-[var(--c-ink-2)]">지표가 모두 있는 대상만 도형을 표시합니다. PER는 낮을수록 바깥쪽입니다.</p>
      </article>
      <article className="rounded-xl border border-[var(--c-line)] p-3">
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold">수익성 · 성장성</h3>
          <button type="button" className="min-h-11 px-2 text-sm underline" onClick={() => void downloadPng(bubble.current, "comparison-bubble")}>PNG 저장</button></div>
        <svg ref={bubble} xmlns="http://www.w3.org/2000/svg" width="380" height="320" viewBox="0 0 380 320" role="img" aria-labelledby={`${id}-bubble`} className="w-full" style={{ height: "auto", background: "white", fontFamily: "sans-serif" }}>
          <title id={`${id}-bubble`}>가로축 ROE, 세로축 성장률. 원 크기는 시가총액입니다. 모든 원래 값은 비교 표에서 확인할 수 있습니다.</title>
          <line x1="60" y1="250" x2="330" y2="250" stroke="#64748b" /><line x1="60" y1="60" x2="60" y2="250" stroke="#64748b" />
          <line x1={x(0)} y1="60" x2={x(0)} y2="250" stroke="#cbd5e1" strokeDasharray="3 3" /><line x1="60" y1={y(0)} x2="330" y2={y(0)} stroke="#cbd5e1" strokeDasharray="3 3" />
          {[0, 0.5, 1].map((ratio) => <g key={ratio} fontSize="10" fill="#475569">
            <text x={60 + ratio * 270} y="268" textAnchor="middle">{(xMin + ratio * (xMax - xMin)).toFixed(1)}%</text>
            <text x="54" y={250 - ratio * 190} textAnchor="end">{(yMin + ratio * (yMax - yMin)).toFixed(1)}%</text>
          </g>)}
          {plotted.map((entity) => { const index = entities.indexOf(entity); return <g key={entity.id}>
            <circle cx={x(entity.values.roe! * 100)} cy={y(entity.values.growthRate! * 100)} r={6 + Math.sqrt(Math.max(0, entity.values.marketCap ?? 0) / maxCap) * 18} fill={COLORS[index]} fillOpacity="0.3" stroke={COLORS[index]} strokeWidth="2">
              <title>{`${entity.name}: ROE ${(entity.values.roe! * 100).toFixed(2)}%, 성장률 ${(entity.values.growthRate! * 100).toFixed(2)}%, PER ${entity.values.per ?? "미제공"}`}</title>
            </circle><text x={x(entity.values.roe! * 100)} y={y(entity.values.growthRate! * 100) - 29} textAnchor="middle" fontSize="10" fill="#0f172a">{entity.id}</text>
          </g>; })}
          <text x="195" y="287" textAnchor="middle" fontSize="11" fill="#334155">ROE (%)</text><text x="30" y="40" fontSize="11" fill="#334155">성장률 (%)</text>
          <text x="190" y="306" textAnchor="middle" fontSize="10" fill="#475569">자료 기준 {sourceDate ?? "미제공"} · 원 크기: 시총</text>
        </svg>
        <p className="text-xs text-[var(--c-ink-2)]">ROE와 성장률이 있는 대상만 표시합니다. 시총이 없으면 최소 크기로 표시합니다.</p>
      </article>
    </div>
    <ul className="mt-3 flex flex-wrap gap-3 text-sm" aria-label="비교 범례">{entities.map((entity, index) => <li key={entity.id} className="flex items-center gap-1.5"><span aria-hidden="true" style={{ background: COLORS[index] }} className="h-3 w-3 rounded-full" />{index + 1}. {entity.name}</li>)}</ul>
    {error ? <p role="alert" className="mt-2 text-sm">{error}</p> : null}
  </div>;
}
