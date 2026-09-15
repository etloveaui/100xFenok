"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EvidenceRail, Pill, StatStrip } from "@/components/ui";
import { formatAsOf } from "@/lib/data-state";
import { formatMoney, formatSignedPercent } from "@/lib/format";
import type { QuotePayload } from "@/lib/quote-contract";

const STRIP_SYMBOLS = ["TQQQ", "SOXL"] as const;
const REFRESH_INTERVAL_MS = 300_000;
const REQUEST_TIMEOUT_MS = 10_000;
const BAR_FULL_SCALE_PERCENT = 3;

type StripSymbol = (typeof STRIP_SYMBOLS)[number];
type StripFreshness = "fresh" | "stale" | "pending" | "error";

type QuoteCell = {
  symbol: StripSymbol;
  quote: QuotePayload | null;
  asOf: string | null;
  status: "loading" | "ready" | "failed";
};

const FRESHNESS_DOT: Record<StripFreshness, string> = {
  fresh: "var(--fnk-color-gain)",
  stale: "var(--fnk-color-warn)",
  pending: "var(--fnk-color-warn)",
  error: "var(--fnk-color-loss)",
};

function changeValue(quote: QuotePayload | null): number | null {
  const value = quote?.changePercent;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function changeText(quote: QuotePayload | null): string {
  const value = changeValue(quote);
  return value === null ? "—" : formatSignedPercent(value, { digits: 2, fraction: false, empty: "—" });
}

function changeTone(value: number | null): string {
  if (value === null || value === 0) return "var(--c-neutral)";
  return value > 0 ? "var(--c-up)" : "var(--c-down)";
}

function marketStateLabel(value: string | null | undefined): string {
  if (!value) return "확인 중";
  if (value.includes("REGULAR")) return "정규장";
  if (value.includes("PRE")) return "프리";
  if (value.includes("POST")) return "마감 후";
  if (value.includes("CLOSED")) return "장 마감";
  return "확인 중";
}

function readAsOf(quote: QuotePayload | null): string | null {
  return formatAsOf(quote?.state?.asOf ?? null) ?? formatAsOf(quote?.lastUpdated ?? null);
}

function compactAsOf(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(5) : value;
}

function isReadableQuote(payload: QuotePayload | null): payload is QuotePayload {
  return typeof payload?.price === "number" && Number.isFinite(payload.price) && payload.price > 0;
}

async function readQuote(symbol: StripSymbol): Promise<QuotePayload | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/ticker/${encodeURIComponent(symbol)}/`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as QuotePayload;
    return isReadableQuote(payload) ? payload : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function cellFreshness(cell: QuoteCell): StripFreshness {
  if (cell.status === "failed") return cell.quote === null ? "error" : "stale";
  if (cell.status === "loading" && cell.quote === null) return "pending";
  return cell.quote?.state?.status === "stale" ? "stale" : "fresh";
}

function stripFreshness(cells: QuoteCell[]): StripFreshness {
  const states = cells.map(cellFreshness);
  if (states.includes("error")) return "error";
  if (states.includes("pending")) return "pending";
  if (states.includes("stale")) return "stale";
  return "fresh";
}

function sourceLabel(cells: QuoteCell[]): string {
  const sources = Array.from(
    new Set(cells.map((cell) => cell.quote?.source).filter((value): value is string => typeof value === "string")),
  );
  if (sources.length === 1) {
    if (sources[0] === "yahoo") return "Yahoo 시세";
    if (sources[0] === "worker") return "보조 시세 경로";
  }
  return "100xFenok 시세 API";
}

function cellAsOfText(cell: QuoteCell, freshness: StripFreshness): string {
  if (cell.quote === null) {
    return cell.status === "loading" ? "시세 확인 중" : "시세를 확인하지 못했습니다";
  }
  const compact = compactAsOf(cell.asOf);
  const stamp = compact ? `기준 ${compact}` : "기준 시각 미표시";
  return freshness === "stale" ? `${stamp} · 갱신 지연` : stamp;
}

function readingLine(cells: QuoteCell[]): string {
  const quoted = cells.filter((cell): cell is QuoteCell & { quote: QuotePayload } => cell.quote !== null);
  if (quoted.length === 0) {
    return cells.some((cell) => cell.status === "loading") ? "시세 확인 중" : "시세를 확인하지 못했습니다";
  }

  const parts = cells.map((cell) =>
    cell.quote ? `${cell.symbol} ${changeText(cell.quote)}` : `${cell.symbol} 확인 실패`,
  );
  const above = quoted.filter((cell) => (changeValue(cell.quote) ?? 0) > 0).length;
  const below = quoted.filter((cell) => (changeValue(cell.quote) ?? 0) < 0).length;
  const flat = quoted.filter((cell) => changeValue(cell.quote) === 0).length;
  const unknown = quoted.length - above - below - flat;
  const complete = quoted.length === cells.length;

  let sentence: string;
  if (unknown > 0) {
    sentence = "변동률을 확인하지 못한 종목이 있습니다.";
  } else if (above === quoted.length) {
    sentence = complete ? "두 종목 모두 전일 종가 위에서 거래 중입니다." : "전일 종가 위에서 거래 중입니다.";
  } else if (below === quoted.length) {
    sentence = complete ? "두 종목 모두 전일 종가 아래에서 거래 중입니다." : "전일 종가 아래에서 거래 중입니다.";
  } else if (flat === quoted.length) {
    sentence = complete ? "두 종목 모두 전일 종가와 같은 수준입니다." : "전일 종가와 같은 수준입니다.";
  } else {
    sentence = "종목별 방향이 엇갈렸습니다.";
  }

  return `${parts.join(" · ")} — ${complete ? "" : "확인된 종목 기준으로 "}${sentence}`;
}

function SignedBar({ change }: { change: number | null }) {
  const magnitude = change === null ? 0 : Math.min(Math.abs(change) / BAR_FULL_SCALE_PERCENT, 1);
  const fillWidth = magnitude * 50;
  const positive = (change ?? 0) >= 0;
  return (
    <span
      aria-hidden="true"
      className="relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--fnk-neutral-100)]"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--fnk-neutral-300)]" />
      {magnitude > 0 ? (
        <span
          className="absolute inset-y-0 rounded-full"
          style={{
            background: changeTone(change),
            left: `${positive ? 50 : 50 - fillWidth}%`,
            width: `${fillWidth}%`,
          }}
        />
      ) : null}
    </span>
  );
}

export default function IbQuoteStrip() {
  const [cells, setCells] = useState<QuoteCell[]>(() =>
    STRIP_SYMBOLS.map((symbol): QuoteCell => ({ symbol, quote: null, asOf: null, status: "loading" })),
  );
  const lastKnown = useRef<Partial<Record<StripSymbol, QuotePayload>>>({});

  const load = useCallback(async () => {
    const reads = await Promise.all(
      STRIP_SYMBOLS.map(async (symbol) => [symbol, await readQuote(symbol)] as const),
    );
    setCells((previous) =>
      previous.map((cell): QuoteCell => {
        const fresh = reads.find(([symbol]) => symbol === cell.symbol)?.[1] ?? null;
        if (fresh) {
          lastKnown.current[cell.symbol] = fresh;
          return { symbol: cell.symbol, quote: fresh, asOf: readAsOf(fresh), status: "ready" };
        }
        const kept = lastKnown.current[cell.symbol] ?? null;
        return { symbol: cell.symbol, quote: kept, asOf: readAsOf(kept), status: "failed" };
      }),
    );
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active && !document.hidden) void load();
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [load]);

  const readCount = cells.filter((cell) => cell.quote !== null).length;
  const asOfValues = cells.map((cell) => cell.asOf).filter((value): value is string => value !== null);
  const stripAsOf = asOfValues.length === cells.length ? [...asOfValues].sort()[0] : null;

  return (
    <div className="flex flex-col gap-2" data-infinite-buying-quote-strip="true">
      <StatStrip data-infinite-buying-quote-tiles="true">
        {cells.map((cell) => {
          const change = changeValue(cell.quote);
          const freshness = cellFreshness(cell);
          return (
            <div
              key={cell.symbol}
              className="flex min-w-0 flex-1 basis-0 flex-col gap-1 px-3 py-2"
              data-infinite-buying-quote-symbol={cell.symbol}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] font-black tracking-[0.08em] text-[var(--c-ink-2)]">
                  {cell.symbol}
                </span>
                <Pill tone="neutral" className="shrink-0">
                  {marketStateLabel(cell.quote?.marketState)}
                </Pill>
              </div>
              <span className="tabular-nums text-[18px] font-semibold leading-none text-[var(--c-ink)]">
                {cell.quote ? formatMoney(cell.quote.price, "USD", 2) : "—"}
              </span>
              <div className="flex min-w-0 items-center gap-2">
                <span className="tabular-nums text-[11px] font-black" style={{ color: changeTone(change) }}>
                  {changeText(cell.quote)}
                </span>
                <SignedBar change={change} />
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--c-ink-3)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: FRESHNESS_DOT[freshness] }}
                />
                <span className="truncate">{cellAsOfText(cell, freshness)}</span>
              </div>
            </div>
          );
        })}
      </StatStrip>
      <p className="text-[11px] font-semibold leading-5 text-[var(--c-ink-2)]" data-infinite-buying-quote-reading="true">
        {readingLine(cells)}
      </p>
      <EvidenceRail
        freshness={stripFreshness(cells)}
        source={sourceLabel(cells)}
        asOf={stripAsOf ?? "—"}
        coverage={`${readCount}/${cells.length} 종목`}
        skeletonDelayMs={120}
      />
    </div>
  );
}
