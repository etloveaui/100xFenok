"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

interface NewEtfRow {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
}

interface EtfSnapshotPayload {
  newEtfs?: {
    fetched_at?: string | null;
    counts?: {
      records?: number | null;
      rows?: number | null;
    } | null;
    records?: NewEtfRow[];
  } | null;
}

interface EtfCoveragePayload {
  missing_tickers?: string[];
  yahoo_fallback_tickers?: string[];
}

interface NewEtfsState {
  snapshot: EtfSnapshotPayload | null;
  coverage: EtfCoveragePayload | null;
}

let cache: EtfSnapshotPayload | null = null;
let pending: Promise<EtfSnapshotPayload | null> | null = null;
let coverageCache: EtfCoveragePayload | null = null;
let coveragePending: Promise<EtfCoveragePayload | null> | null = null;

function loadSnapshot(): Promise<EtfSnapshotPayload | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/api/data/stockanalysis/etf-snapshot", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<EtfSnapshotPayload> : null))
    .then((payload) => {
      cache = payload;
      return payload;
    })
    .catch(() => null);
  return pending;
}

function loadCoverage(): Promise<EtfCoveragePayload | null> {
  if (coverageCache) return Promise.resolve(coverageCache);
  if (coveragePending) return coveragePending;
  coveragePending = fetch("/data/stockanalysis/coverage/etf_detail.json", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<EtfCoveragePayload> : null))
    .then((payload) => {
      coverageCache = payload;
      return payload;
    })
    .catch(() => null);
  return coveragePending;
}

function fmtDate(value: string | null | undefined): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "-";
}

function fmtPrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "-";
}

function fmtChange(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function countRows(payload: EtfSnapshotPayload | null): number {
  const value = payload?.newEtfs?.counts?.records ?? payload?.newEtfs?.counts?.rows;
  if (typeof value === "number") return value;
  return payload?.newEtfs?.records?.length ?? 0;
}

function detailStatus(ticker: string, coverage: EtfCoveragePayload | null): string {
  const symbol = ticker.trim().toUpperCase();
  const missing = new Set((coverage?.missing_tickers ?? []).map((item) => item.trim().toUpperCase()));
  if (missing.has(symbol)) return "상세 준비 중";
  const fallback = new Set((coverage?.yahoo_fallback_tickers ?? []).map((item) => item.trim().toUpperCase()));
  if (fallback.has(symbol)) return "가격 보강";
  return "상세 연결 완료";
}

export default function NewEtfsList() {
  const [state, setState] = useState<NewEtfsState>({ snapshot: null, coverage: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSnapshot(), loadCoverage()]).then(([snapshot, coverage]) => {
      if (!cancelled) {
        setState({ snapshot, coverage });
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    return (state.snapshot?.newEtfs?.records ?? [])
      .filter((row) => typeof row.s === "string" && row.s.trim())
      .map((row) => ({
        ...row,
        s: row.s!.trim().toUpperCase(),
        n: typeof row.n === "string" && row.n.trim() ? row.n.trim() : row.s!.trim().toUpperCase(),
        detailStatus: detailStatus(row.s!, state.coverage),
      }));
  }, [state]);

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>신규 상장 ETF</h2>
        <span className="desc">{fmtDate(state.snapshot?.newEtfs?.fetched_at)} · {countRows(state.snapshot).toLocaleString("ko-KR")}개</span>
      </div>

      {!loaded ? (
        <div className="mv-row">
          <span className="co">
            <div className="n">신규 상장 목록 확인 중</div>
            <div className="tk">상장일과 가격 정보를 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      ) : rows.length > 0 ? (
        <div className="mv-col">
          {rows.map((row) => (
            <TransitionLink key={row.s} href={`/etfs/${encodeURIComponent(row.s)}`} className="mv-row">
              <span className="co">
                <div className="n">{row.n}</div>
                <div className="tk">{row.s} · 상장일 {fmtDate(row.inceptionDate)} · 가격 {fmtPrice(row.price)} · {row.detailStatus}</div>
              </span>
              <span className={`pc num ${(row.change ?? 0) >= 0 ? "up" : "down"}`}>{fmtChange(row.change)}</span>
            </TransitionLink>
          ))}
        </div>
      ) : (
        <div className="mv-row">
          <span className="co">
            <div className="n">신규 상장 ETF 없음</div>
            <div className="tk">현재 표시할 신규 상장 목록이 없습니다</div>
          </span>
          <span className="pc num neutral">-</span>
        </div>
      )}
    </section>
  );
}
