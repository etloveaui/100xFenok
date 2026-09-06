"use client";

import { useEffect, useState } from "react";
import { asEarningsDocument } from "@/lib/earnings/model";
import type { EarningsDocument } from "@/lib/earnings/types";
import EarningsOverviewPanel from "./EarningsOverviewPanel";

const supported = new Set(["AAPL", "AMZN", "MSFT", "META"]);
const cache = new Map<string, { document: EarningsDocument; fetchedAt: number }>();

export default function EarningsOverview({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const symbol = ticker.toUpperCase();
  const [result, setResult] = useState<{ ticker: string; document: EarningsDocument | null; failed: boolean } | null>(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!supported.has(symbol)) return;
    const controller = new AbortController();
    const previous = cache.get(symbol);
    setResult({ ticker: symbol, document: previous?.document ?? null, failed: false });
    if (previous && Date.now() - previous.fetchedAt < 300_000 && attempt === 0) return;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/data/earnings-overview/${encodeURIComponent(symbol)}.json`, { signal: controller.signal, cache: "no-cache" });
        if (!response.ok) throw new Error("earnings unavailable");
        const document = asEarningsDocument(await response.json());
        if (!document || document.ticker !== symbol) throw new Error("invalid earnings");
        if (!active) return;
        cache.set(symbol, { document, fetchedAt: Date.now() });
        setResult({ ticker: symbol, document, failed: false });
      } catch {
        if (active) setResult({ ticker: symbol, document: previous ? { ...previous.document, status: "retained", notice: "최신 자료를 불러오지 못해 마지막으로 확인한 실적을 표시합니다." } : null, failed: true });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [symbol, attempt]);

  if (!supported.has(symbol)) return null;
  const current = result?.ticker === symbol ? result : null;
  if (current?.document) return <>
    <EarningsOverviewPanel key={symbol} document={current.document} compact={compact} />
    {current.failed && <button type="button" className="mb-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => retry(value => value + 1)}>다시 불러오기</button>}
  </>;
  return (
    <section aria-label={`${symbol} 분기 실적`} aria-busy={!current?.failed} className="rounded-2xl border border-slate-200 bg-white p-5 my-4" data-testid="earnings-overview-state">
      <p role="status" className="text-sm text-slate-600">{current?.failed ? "공식 분기 실적을 불러오지 못했습니다." : "공식 분기 실적을 불러오는 중입니다."}</p>
      {current?.failed && <button type="button" className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => retry(value => value + 1)}>다시 불러오기</button>}
    </section>
  );
}
