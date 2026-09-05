"use client";

import TickerChip from "@/components/TickerChip";
import TransitionLink from "@/components/TransitionLink";
import { Panel } from "@/components/ui";
import { formatCurrency, formatCurrencyCompact, formatCompactNumber, formatPercent } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { CANONICAL_SECTORS, resolveSector, sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";
import type { InvestorFiling, InvestorHolding, TradesRankingRow } from "@/lib/superinvestors/types";

const CANONICAL_SECTOR_SET = new Set<string>(CANONICAL_SECTORS);

function normalizeSuperSector(gicsRaw?: string | null, scouterRaw?: string | null): CanonicalSector {
  const gics = gicsRaw?.trim();
  if (gics && CANONICAL_SECTOR_SET.has(gics)) return gics as CanonicalSector;
  const scouter = scouterRaw?.trim();
  if (scouter && CANONICAL_SECTOR_SET.has(scouter)) return scouter as CanonicalSector;
  return resolveSector(gicsRaw, scouterRaw);
}

type HoldingChangeKind = "new" | "increased" | "decreased" | "sold";

const HOLDING_CHANGE_LABEL: Record<HoldingChangeKind, string> = {
  new: "신규",
  increased: "증가",
  decreased: "감소",
  sold: "청산",
};

const HOLDING_CHANGE_TONE: Record<HoldingChangeKind, string> = {
  new: "bg-emerald-100 text-emerald-700",
  increased: "bg-sky-100 text-sky-700",
  decreased: "bg-amber-100 text-amber-700",
  sold: "bg-rose-100 text-rose-700",
};

type HoldingRow = InvestorHolding & { liquidated?: boolean };

function buildHoldingChangeMap(
  changes: InvestorFiling["changes_summary"] | undefined,
): Map<string, { kind: HoldingChangeKind; pct: number }> {
  const map = new Map<string, { kind: HoldingChangeKind; pct: number }>();
  if (!changes) return map;
  const kinds: HoldingChangeKind[] = ["new", "increased", "decreased", "sold"];
  for (const kind of kinds) {
    for (const entry of changes[kind] ?? []) {
      if (!entry?.ticker || map.has(entry.ticker)) continue;
      map.set(entry.ticker, {
        kind,
        pct: typeof entry.change_pct === "number" && Number.isFinite(entry.change_pct) ? entry.change_pct : NaN,
      });
    }
  }
  return map;
}

function HoldingChangePill({ change }: { change: { kind: HoldingChangeKind; pct: number } | undefined }) {
  if (!change) return <span className="text-[var(--c-ink-3)]">—</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black ${HOLDING_CHANGE_TONE[change.kind]}`}
      title={Number.isFinite(change.pct) ? `변화 ${change.pct}%` : undefined}
    >
      {HOLDING_CHANGE_LABEL[change.kind]}
    </span>
  );
}

function buildHoldingRows(
  holdings: InvestorHolding[],
  changes: InvestorFiling["changes_summary"] | undefined,
): HoldingRow[] {
  // Filings carry one row per share class / CUSIP — aggregate by ticker.
  const byTicker = new Map<string, InvestorHolding>();
  for (const holding of holdings) {
    if (!holding.ticker) continue;
    const current = byTicker.get(holding.ticker);
    if (current) {
      current.weight = (current.weight || 0) + (holding.weight || 0);
      current.shares = (current.shares || 0) + (holding.shares || 0);
      current.market_value = (current.market_value || 0) + (holding.market_value || 0);
    } else {
      byTicker.set(holding.ticker, { ...holding });
    }
  }
  const held: HoldingRow[] = [...byTicker.values()]
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, 50);
  // Fully liquidated positions are absent from the latest holdings. Keep them
  // as explicit rows with unavailable holding/price values, never fabricated 0s.
  const liquidated: HoldingRow[] = (changes?.sold ?? [])
    .filter((entry) => entry?.ticker && !byTicker.has(entry.ticker))
    .slice(0, 50)
    .map((entry) => ({
      ticker: entry.ticker,
      cusip: `sold-${entry.ticker}`,
      name: entry.name || entry.ticker,
      shares: Number.NaN,
      market_value: Number.NaN,
      weight: Number.NaN,
      liquidated: true,
    }));
  return [...held, ...liquidated];
}

export function ResponsiveHoldingsTable({
  holdings,
  changes,
  returnTo,
  onBeforeNavigate,
}: {
  holdings: InvestorHolding[];
  changes?: InvestorFiling["changes_summary"];
  returnTo?: string | null;
  onBeforeNavigate?: () => void;
}) {
  const rows = buildHoldingRows(holdings, changes);
  const changeMap = buildHoldingChangeMap(changes);

  if (rows.length === 0) {
    return (
      <Panel empty emptyReason="보유 종목이 없습니다" emptyNextRefresh="다음 분기 공시 반영 후 갱신">
        <span>보유 종목이 없습니다</span>
      </Panel>
    );
  }

  return (
    <div data-superinvestor-guru-top-holdings>
      <div
        data-journey-holdings-scroll
        className="sup-responsive-scroll sup-responsive-scroll--holdings scroll-hint-x"
        role="region"
        tabIndex={0}
        aria-label="최신 보유 및 청산 종목 표 가로 스크롤"
      >
        <table className="sup-responsive-table sup-responsive-table--holdings">
          <caption className="sr-only">최신 보유 및 청산 종목</caption>
          <thead>
            <tr>
              <th scope="col">티커</th>
              <th scope="col">종목</th>
              <th scope="col">비중</th>
              <th scope="col">분기 변화</th>
              <th scope="col">주식수</th>
              <th scope="col">보고가</th>
              <th scope="col">현재가</th>
              <th scope="col">보유 평가액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((holding) => (
              <tr
                key={`${holding.ticker}-${holding.cusip}`}
                data-superinvestor-guru-holding-row
                data-superinvestor-guru-holding-ticker={holding.ticker ?? ""}
                data-superinvestor-guru-holding-liquidated={holding.liquidated ? "true" : undefined}
                className="sup-responsive-row"
              >
                <td data-label="티커">
                  {holding.ticker ? (
                    <TickerChip
                      ticker={holding.ticker}
                      variant="pill"
                      href={ROUTES.stock(holding.ticker, returnTo)}
                      onClick={onBeforeNavigate}
                      className="min-h-11"
                    />
                  ) : (
                    <span className="text-[var(--c-ink-3)]">—</span>
                  )}
                </td>
                <td data-label="종목">
                  <span className="sup-responsive-name">{holding.name}</span>
                  {holding.sector ? <span className="sup-responsive-sub">{holding.sector}</span> : null}
                </td>
                <td data-label="비중">
                  <span className="tabular-nums font-bold text-slate-900">
                    {holding.liquidated ? "—" : formatPercent(holding.weight, { digits: 2 })}
                  </span>
                </td>
                <td data-label="분기 변화">
                  <HoldingChangePill change={holding.ticker ? changeMap.get(holding.ticker) : undefined} />
                </td>
                <td data-label="주식수">
                  <span className="tabular-nums text-slate-700">{formatCompactNumber(holding.shares)}</span>
                </td>
                <td data-label="보고가">
                  <span className="tabular-nums text-slate-700">
                    {holding.price_at_filing != null ? formatCurrency(holding.price_at_filing, "USD", { digits: 2 }) : "—"}
                  </span>
                </td>
                <td data-label="현재가">
                  <span className="tabular-nums text-slate-700">
                    {holding.price_latest != null ? formatCurrency(holding.price_latest, "USD", { digits: 2 }) : "—"}
                  </span>
                </td>
                <td data-label="보유 평가액">
                  <span className="tabular-nums text-slate-700">{formatCurrencyCompact(holding.market_value, "USD")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type AmountColor = "emerald" | "rose";

function tradeShare(amount: number | null | undefined, totalAmount: number): number | null {
  if (amount === null || amount === undefined || Number.isNaN(amount) || totalAmount <= 0) return null;
  return (amount / totalAmount) * 100;
}

function formatTradeShare(amount: number | null | undefined, totalAmount: number): string {
  return formatPercent(tradeShare(amount, totalAmount), { digits: 1, fraction: false });
}

export function ResponsiveTradeRankingPanel({
  title,
  rows,
  totalAmount,
  amountColor,
  side,
  expanded,
  onToggle,
  actionLabel,
  returnTo,
  onBeforeNavigate,
}: {
  title: string;
  rows: TradesRankingRow[];
  totalAmount: number;
  amountColor: AmountColor;
  side: "bought" | "sold";
  expanded: boolean;
  onToggle: () => void;
  actionLabel: (row: TradesRankingRow) => string | undefined;
  returnTo?: string | null;
  onBeforeNavigate?: () => void;
}) {
  const visibleRows = expanded ? rows : rows.slice(0, 10);
  const amountTextClass = amountColor === "emerald" ? "text-emerald-700" : "text-rose-700";
  const topLabel = amountColor === "emerald" ? "TOP 매수자" : "TOP 매도자";
  const shareScopeLabel = side === "bought" ? "매수 상위권 내 비중" : "매도 상위권 내 비중";

  if (rows.length === 0) {
    return (
      <section data-superinvestor-trades-panel data-superinvestor-trades-side={side} className="sup-trades-panel">
        <h3 className="sup-trades-title">{title}</h3>
        <Panel empty emptyReason="데이터가 없습니다" emptyNextRefresh="해당 분기 매매 데이터가 존재하지 않습니다.">
          <span>데이터가 없습니다</span>
        </Panel>
      </section>
    );
  }

  return (
    <section data-superinvestor-trades-panel data-superinvestor-trades-side={side} className="sup-trades-panel">
      <h3 className="sup-trades-title">{title}</h3>
      <div
        data-superinvestor-trades-region
        data-superinvestor-trades-side={side}
        className="sup-responsive-scroll sup-responsive-scroll--trades scroll-hint-x"
        role="region"
        tabIndex={0}
        aria-label={`${title} 표 가로 스크롤`}
      >
        <table className="sup-responsive-table sup-responsive-table--trades">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">순위</th>
              <th scope="col">종목</th>
              <th scope="col">섹터</th>
              <th scope="col">비중</th>
              <th scope="col">투자자</th>
              <th scope="col">{topLabel}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const canonicalSector = normalizeSuperSector(row.sector_gics ?? row.sector, row.sector);
              return (
                <tr
                  key={`${row.ticker}-${row.rank}`}
                  data-superinvestor-trades-row
                  data-superinvestor-trades-side={side}
                  data-superinvestor-trades-ticker={row.ticker}
                  className="sup-responsive-row"
                >
                  <td data-label="순위">
                    <span className="tabular-nums text-xs font-bold text-[var(--c-ink-3)]">{row.rank}</span>
                  </td>
                  <td data-label="종목">
                    <TransitionLink
                      href={ROUTES.stock(row.ticker, returnTo)}
                      onClick={onBeforeNavigate}
                      data-superinvestor-trades-action
                      data-superinvestor-trades-stock-link
                      className="sup-responsive-link"
                    >
                      <span className="sup-responsive-name">{row.name}</span>
                      <span className="sup-responsive-code">{row.ticker}</span>
                    </TransitionLink>
                  </td>
                  <td data-label="섹터">
                    <span className="sup-responsive-sector">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: sectorColor(canonicalSector) }}
                      />
                      <span className="truncate">{sectorLabelKo(canonicalSector)}</span>
                    </span>
                  </td>
                  <td data-label="비중" title={shareScopeLabel}>
                    <span className={`tabular-nums font-bold ${amountTextClass}`}>
                      {formatTradeShare(row.amount, totalAmount)}
                    </span>
                  </td>
                  <td data-label="투자자">
                    <span className="tabular-nums font-bold text-slate-900">{row.investors_count}</span>
                    {actionLabel(row) ? <span className="sup-responsive-sub">{actionLabel(row)}</span> : null}
                  </td>
                  <td data-label={topLabel}>
                    {row.top_investor?.id ? (
                      <TransitionLink
                        href={ROUTES.superinvestorsGuru(row.top_investor.id, returnTo)}
                        onClick={onBeforeNavigate}
                        data-superinvestor-trades-action
                        data-superinvestor-trades-investor-link
                        className="sup-responsive-link sup-responsive-link--investor"
                        title={row.top_investor.name}
                      >
                        <span className="truncate">{row.top_investor.name}</span>
                      </TransitionLink>
                    ) : (
                      <span className="font-bold text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 10 ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={expanded}
          className="sup-trades-toggle"
        >
          {expanded ? "접기" : "전체 50개 보기"}
        </button>
      ) : null}
    </section>
  );
}
