"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

type ActionTab = "smart_money" | "value_momentum" | "index_core";

interface ActionRow {
  symbol: string;
  company?: string | null;
  sector?: string | null;
  marketScope?: string | null;
  actionScore?: number | null;
  confidenceLabel?: string | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  lowEvidence?: boolean | null;
  return12m?: number | null;
  guruHolders?: number | null;
}

interface ActionDoc {
  generated_at?: string;
  coverage?: {
    indexed_stock_count?: number | null;
    conviction_matched_count?: number | null;
    quarter_close_ticker_count?: number | null;
  };
  fields?: string[];
  rows?: Array<ActionRow | unknown[]>;
}

let cache: ActionDoc | null = null;
let pending: Promise<ActionDoc | null> | null = null;

function loadActions(): Promise<ActionDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/computed/stock_action_summary.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => {
      cache = doc;
      return doc;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

function fmtScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toString() : "—";
}

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function confidenceText(label: string | null | undefined): string {
  if (label === "high") return "신뢰 높음";
  if (label === "medium") return "신뢰 중간";
  if (label === "low") return "신뢰 낮음";
  return "신뢰 미정";
}

function tone(bucket: string | null | undefined, confidenceLabel?: string | null, lowEvidence = false): string {
  if (lowEvidence || confidenceLabel === "low") return "neutral";
  if (bucket === "smart_money") return "up";
  if (bucket === "value_momentum") return "up";
  if (bucket === "index_core") return "neutral";
  return "neutral";
}

function normalizeActionRow(row: ActionRow | unknown[], fields: string[]): ActionRow | null {
  if (!Array.isArray(row)) return row.symbol ? row : null;
  const value = (key: string): unknown => {
    const index = fields.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  };
  const symbol = value("symbol");
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  const actionReasons = value("actionReasons");
  return {
    symbol,
    company: typeof value("company") === "string" ? value("company") as string : null,
    sector: typeof value("sector") === "string" ? value("sector") as string : null,
    marketScope: typeof value("marketScope") === "string" ? value("marketScope") as string : null,
    actionScore: typeof value("actionScore") === "number" ? value("actionScore") as number : null,
    confidenceLabel: typeof value("confidenceLabel") === "string" ? value("confidenceLabel") as string : null,
    actionLabel: typeof value("actionLabel") === "string" ? value("actionLabel") as string : null,
    actionBucket: typeof value("actionBucket") === "string" ? value("actionBucket") as string : null,
    actionReasons: Array.isArray(actionReasons) ? actionReasons.filter((item): item is string => typeof item === "string") : [],
    lowEvidence: typeof value("lowEvidence") === "boolean" ? value("lowEvidence") as boolean : false,
    return12m: typeof value("return12m") === "number" ? value("return12m") as number : null,
    guruHolders: typeof value("guruHolders") === "number" ? value("guruHolders") as number : null,
  };
}

export default function ActionCandidatesCard() {
  const [doc, setDoc] = useState<ActionDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<ActionTab>("smart_money");

  useEffect(() => {
    let cancelled = false;
    loadActions().then((next) => {
      if (!cancelled) {
        setDoc(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const all = Array.isArray(doc?.rows) ? doc.rows : [];
    return all
      .map((row) => normalizeActionRow(row, doc?.fields ?? []))
      .filter((row): row is ActionRow => row?.actionBucket === tab)
      .slice(0, 6);
  }, [doc, tab]);

  if (!doc) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>투자 후보</h2>
          <span className="desc">스코어 계산</span>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">
          {loaded ? "투자 후보 데이터를 불러오지 못했습니다." : "투자 후보 계산 중"}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>투자 후보</h2>
        <span className="desc">{doc.coverage?.indexed_stock_count ?? "—"}개 · 13F {doc.coverage?.conviction_matched_count ?? "—"}건</span>
        <div className="seg" style={{ marginLeft: "auto" }}>
          {[
            ["smart_money", "기관·고수"],
            ["value_momentum", "밸류+모멘텀"],
            ["index_core", "지수 핵심"],
          ].map(([key, label]) => (
            <button key={key} type="button" className={tab === key ? "on" : ""} onClick={() => setTab(key as ActionTab)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mv-col">
        {rows.map((row) => (
          <TransitionLink key={row.symbol} href={`/stock/${encodeURIComponent(row.symbol)}`} className="mv-row">
            <span className="co">
              <div className="n">{row.company || row.symbol}</div>
              <div className="tk">
                {row.symbol}{row.sector ? ` · ${row.sector}` : ""}
              </div>
              <div className="tk" style={{ whiteSpace: "normal" }}>
                {row.actionLabel ?? "관찰"}{row.lowEvidence ? " · 증거 부족" : ""}
              </div>
              {row.actionReasons?.[0] ? <div className="tk" style={{ whiteSpace: "normal" }}>{row.actionReasons[0]}</div> : null}
            </span>
            <span className={`pc num ${tone(row.actionBucket, row.confidenceLabel, row.lowEvidence === true)}`}>
              {fmtScore(row.actionScore)}
              <small style={{ display: "block", fontSize: 10, color: "var(--c-ink-3)" }}>{confidenceText(row.confidenceLabel)}</small>
              <small style={{ display: "block", fontSize: 10, color: "var(--c-ink-3)" }}>{fmtPct(row.return12m)}</small>
            </span>
          </TransitionLink>
        ))}
      </div>
      <div className="panel-foot">분기말 종가 {doc.coverage?.quarter_close_ticker_count ?? "—"}개 · 가격·수익률·기관 동향·자동 계산 점수 반영</div>
    </section>
  );
}
