"use client";

import { useEffect, useRef, useState } from "react";
import { calculateVrGuide, fetchGuideQuote, type VrKind } from "./lib/guideCalculators";

const kinds = { deposit: "적립식", "lump-sum": "거치식", withdrawal: "인출식" } as const;
const examples = {
  deposit: { v1: "16000", pool: "500", g: "12", price: "72.45", shares: "229", poolLimit: "70", orderQuantity: "3", evaluation: "", movement: "250" },
  "lump-sum": { v1: "18300", pool: "2000", g: "10", price: "62", shares: "300", poolLimit: "50", orderQuantity: "1", evaluation: "", movement: "" },
  withdrawal: { v1: "39500", pool: "10000", g: "20", price: "79", shares: "500", poolLimit: "25", orderQuantity: "5", evaluation: "", movement: "250" },
};
export default function VrGuideCalculator() {
  const [kind, setKind] = useState<VrKind>("lump-sum");
  const [advanced, setAdvanced] = useState(true);
  const [values, setValues] = useState({ v1: "", pool: "", g: "10", price: "", shares: "", poolLimit: "50", orderQuantity: "1", evaluation: "", movement: "" });
  const [quoteNote, setQuoteNote] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateVrGuide> | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const update = (key: keyof typeof values, value: string) => { setValues(previous => ({ ...previous, [key]: value })); setResult(null); };
  const field = (key: keyof typeof values, label: string, optional = false) => <label key={key}>
    {label}<input type="number" step={key === "shares" || key === "orderQuantity" ? "1" : "any"} value={values[key]} required={!optional}
      onChange={event => update(key, event.target.value)} />
  </label>;
  const autoEvaluation = () => {
    if (!values.price || !values.shares || Number(values.shares) <= 0) { setError("현재가와 수량을 입력해 주세요."); return; }
    update("evaluation", (Number(values.price) * Number(values.shares)).toFixed(2)); setError("");
  };
  const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="ib-guide-panel" aria-labelledby="vr-calc-title">
    <h2 id="vr-calc-title">VR 사이클 계산 및 주문표 생성기</h2>
    <div className="ib-guide-actions">{(Object.keys(kinds) as VrKind[]).map(key => <button type="button" key={key} onClick={() => {
      setKind(key); setValues(examples[key]); setResult(null); setQuoteNote(""); setError("");
    }}>{kinds[key]} 예시</button>)}</div>
    <form onSubmit={event => {
      event.preventDefault(); setError("");
      try {
        const evaluation = values.evaluation ? Number(values.evaluation) : values.price && values.shares ? Number(values.price) * Number(values.shares) : NaN;
        if (advanced && !Number.isFinite(evaluation)) throw new Error("최종 평가금 또는 현재가와 수량을 입력해 주세요.");
        if (advanced && !values.evaluation) setValues(previous => ({ ...previous, evaluation: evaluation.toFixed(2) }));
        setResult(calculateVrGuide(kind, advanced, { v1: Number(values.v1), pool: Number(values.pool), g: Number(values.g),
          shares: Number.parseInt(values.shares, 10), poolLimit: Number(values.poolLimit), orderQuantity: Number.parseInt(values.orderQuantity, 10),
          evaluation: advanced ? evaluation : 0, movement: Number(values.movement) }));
      } catch (cause) { setResult(null); setError((cause as Error).message); }
    }}>
      <div className="ib-guide-fields">
        <label>투자 방식<select value={kind} onChange={event => { setKind(event.target.value as VrKind); setResult(null); }}>
          {(Object.keys(kinds) as VrKind[]).map(key => <option key={key} value={key}>{kinds[key]}</option>)}
        </select></label>
        <label>공식 종류<select value={advanced ? "advanced" : "basic"} onChange={event => { setAdvanced(event.target.value === "advanced"); setResult(null); }}>
          <option value="basic">기본공식</option><option value="advanced">실력공식</option>
        </select></label>
        {field("v1", "이전 V값 ($)")}{field("pool", "현재 Pool ($)")}{field("g", "기울기 (G)")}
        <div>{field("price", "TQQQ 현재가 ($)", true)}<button type="button" onClick={async () => {
          request.current?.abort(); const controller = new AbortController(); request.current = controller;
          setQuoteNote("시세 조회 중…");
          try {
            const quote = await fetchGuideQuote("TQQQ", controller.signal);
            if (controller.signal.aborted) return;
            update("price", quote.price.toFixed(2)); setQuoteNote(quote.basis);
          } catch { if (!controller.signal.aborted) setQuoteNote("시세를 불러오지 못해 현재가를 입력하지 않았습니다."); }
        }}>시세 자동입력</button><p aria-live="polite">{quoteNote}</p></div>
        {field("shares", "현재 TQQQ 수량")}{field("poolLimit", "Pool 사용한도 (%)")}{field("orderQuantity", "주문 수량 (Qty)")}
        {advanced && <div>{field("evaluation", "최종 평가금 ($)", true)}<button type="button" onClick={autoEvaluation}>평가금 자동계산</button></div>}
        {kind !== "lump-sum" && field("movement", kind === "deposit" ? "적립액 ($)" : "인출액 ($)", true)}
      </div><button type="submit">계산 및 주문표 생성</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <div className="ib-guide-results" aria-live="polite">
      <h3>다음 사이클 V값 및 밴드</h3>
      <dl><div><dt>새로운 V값 (V₂)</dt><dd>{money(result.newV)}</dd></div><div><dt>최소 밴드</dt><dd>{money(result.minBand)}</dd></div><div><dt>최대 밴드</dt><dd>{money(result.maxBand)}</dd></div></dl>
      <h3>2주 예약매매 주문표</h3>
      <div className="ib-guide-grid">{(["buy", "sell"] as const).map(side => <div className="ib-guide-table" key={side}>
        <table><caption>{side === "buy" ? "매수 주문표 (지정가)" : "매도 주문표 (지정가)"}</caption>
          <thead><tr><th>주문</th><th>가격</th><th>{side === "buy" ? "누적사용 Pool" : "예상 Pool 잔고"}</th></tr></thead>
          <tbody>{result[side].map((row, i) => <tr key={i}><td>{i + 1} ({result.orderQuantity}주)</td><td>{money(row.price)}</td><td>{money(row.pool)}</td></tr>)}</tbody>
        </table>{result[side].length === 0 && <p>입력한 한도 안에서 생성할 주문이 없습니다.</p>}
      </div>)}</div>
    </div>}
  </section>;
}
