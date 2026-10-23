"use client";

import { useEffect, useRef, useState } from "react";
import { calculateIbGuide, fetchGuideQuote, type GuideOrder, type GuideQuote, type GuideTicker } from "./lib/guideCalculators";

export default function IbGuideCalculator() {
  const [ticker, setTicker] = useState<GuideTicker>("TQQQ");
  const [values, setValues] = useState({ seed: "", invested: "", average: "", quantity: "" });
  const [quotes, setQuotes] = useState<Partial<Record<GuideTicker, GuideQuote>>>({});
  const [failed, setFailed] = useState<GuideTicker[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateIbGuide> | null>(null);
  const request = useRef<AbortController | null>(null);
  const refresh = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const rows = await Promise.allSettled((["TQQQ", "SOXL"] as const).map(symbol => fetchGuideQuote(symbol, controller.signal)));
    if (controller.signal.aborted) return;
    setQuotes(previous => ({ ...previous, ...Object.fromEntries(rows.flatMap((row, i) => row.status === "fulfilled" ? [[i ? "SOXL" : "TQQQ", row.value]] : [])) }));
    setFailed(rows.flatMap((row, i) => row.status === "rejected" ? [i ? "SOXL" : "TQQQ"] : []) as GuideTicker[]);
    setBusy(false);
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 300_000);
    return () => { clearInterval(timer); request.current?.abort(); };
  // The initial fetch and timer intentionally share the current request ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fields = [
    ["seed", "가상 투자금 ($)", "13000"], ["invested", "누적 매수금 ($)", "1631"],
    ["average", "평균 매수가 ($)", "70.9110"], ["quantity", "보유 수량", "23"],
  ] as const;
  const table = (title: string, orders: GuideOrder[]) => <div className="ib-guide-table"><table><caption>{title}</caption>
    <thead><tr><th>주문 종류</th><th>가격 ($)</th><th>수량</th></tr></thead>
    <tbody>{orders.map((order, i) => <tr key={i}><td>{order.type}</td><td>{order.price.toFixed(4)}</td><td>{order.quantity}</td></tr>)}</tbody>
  </table></div>;
  return <>
    <section className="ib-guide-panel" aria-labelledby="ib-quotes-title">
      <h2 id="ib-quotes-title">현재 시세</h2>
      <div className="ib-guide-grid">{(["TQQQ", "SOXL"] as const).map(symbol => <div key={symbol}>
        <h3>{symbol}</h3><strong>{quotes[symbol] ? `$${quotes[symbol]!.price.toFixed(2)}` : busy ? "확인 중…" : "가격 확인 실패"}</strong>
        <p aria-live="polite">{quotes[symbol]?.basis}</p>
        {failed.includes(symbol) && <p>지금은 시세를 확인하지 못했습니다.{quotes[symbol] ? " 이전에 확인한 가격입니다." : " 다시 시도해 주세요."}</p>}
      </div>)}</div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? "확인 중…" : "시세 다시 확인"}</button>
    </section>
    <section className="ib-guide-panel" aria-labelledby="ib-calc-title">
      <h2 id="ib-calc-title">자동매매 백업: 수동 주문 생성기</h2>
      <p>현재가를 확인하고 계좌 상황을 입력하면 매수·매도 주문 목록을 계산합니다.</p>
      <form onSubmit={event => {
        event.preventDefault(); setError("");
        try {
          if (Object.values(values).some(value => !value.trim())) throw new Error("모든 값을 입력해 주세요.");
          setResult(calculateIbGuide(ticker, Number(values.seed), Number(values.invested), Number(values.average), Number(values.quantity)));
        } catch (cause) { setResult(null); setError((cause as Error).message); }
      }}>
        <div className="ib-guide-fields">
          <label>종목<select value={ticker} onChange={event => { setTicker(event.target.value as GuideTicker); setResult(null); }}><option>TQQQ</option><option>SOXL</option></select></label>
          {fields.map(([key, label, placeholder]) => <label key={key}>{label}<input type="number" step="any" required value={values[key]} placeholder={placeholder}
            onChange={event => { setValues({ ...values, [key]: event.target.value }); setResult(null); }} /></label>)}
        </div><button type="submit">주문 목록 계산</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <div className="ib-guide-results" aria-live="polite">
        <dl><div><dt>T-Value</dt><dd>{result.t.toFixed(1)}</dd></div><div><dt>1회 매수금</dt><dd>${result.oneTimeBuy.toFixed(2)}</dd></div>
          <div><dt>☆% (LOC 가격)</dt><dd>{result.star.toFixed(2)}% (${result.starPrice.toFixed(2)})</dd></div></dl>
        {quotes[ticker] && <p>현재 평가수익률: {((quotes[ticker]!.price / Number(values.average) - 1) * 100).toFixed(2)}% · {quotes[ticker]!.basis}{failed.includes(ticker) ? " · 이전 확인 가격" : ""}</p>}
        {table("매수 주문 목록", result.buy)}{table("매도 주문 목록", result.sell)}
      </div>}
    </section>
  </>;
}
