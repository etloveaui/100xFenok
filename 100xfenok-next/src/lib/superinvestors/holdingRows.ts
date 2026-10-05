import type { InvestorFiling, InvestorHolding } from "./types";

export type HoldingChangeKind = "new" | "increased" | "decreased" | "sold";
export type HoldingRow = InvestorHolding & { row_key: string; liquidated?: boolean };

export function confirmedChanges(changes: InvestorFiling["changes_summary"] | undefined) {
  return changes?.comparison_basis === "reported_security_shares" ? changes : undefined;
}

export function buildHoldingChangeMap(changes: InvestorFiling["changes_summary"] | undefined) {
  const map = new Map<string, { kind: HoldingChangeKind; pct: number }>();
  const current = confirmedChanges(changes);
  for (const kind of ["new", "increased", "decreased", "sold"] as const) {
    for (const entry of current?.[kind] ?? []) {
      if (!entry.security_key || map.has(entry.security_key)) continue;
      map.set(entry.security_key, {
        kind,
        pct: Number.isFinite(entry.change_pct) ? entry.change_pct : NaN,
      });
    }
  }
  return map;
}

export function buildHoldingRows(
  holdings: InvestorHolding[],
  changes: InvestorFiling["changes_summary"] | undefined,
): HoldingRow[] {
  const held = new Map<string, HoldingRow>();
  for (const [index, holding] of holdings.entries()) {
    // Only the producer may establish identity. Unkeyed and unresolved source
    // rows stay visible; stored tickers never become an implicit confirmation.
    const key = holding.security_key || `unkeyed:${index}`;
    const current = held.get(key);
    if (current) {
      for (const field of ["weight", "shares", "market_value"] as const) {
        current[field] = Number.isFinite(current[field]) && Number.isFinite(holding[field])
          ? current[field] + holding[field] : NaN;
      }
      const symbol = holding.resolved_ticker?.replaceAll("-", ".") ?? null;
      if ((current.resolved_ticker?.replaceAll("-", ".") ?? null) !== symbol) {
        current.resolved_ticker = null;
      }
    } else {
      held.set(key, { ...holding, resolved_ticker: holding.resolved_ticker || null, row_key: key });
    }
  }
  const rows = [...held.values()]
    .sort((a, b) => (Number.isFinite(b.weight) ? b.weight : 0) - (Number.isFinite(a.weight) ? a.weight : 0))
    .slice(0, 50);
  const sold = (confirmedChanges(changes)?.sold ?? [])
    .filter((entry) => entry.security_key && !held.has(entry.security_key))
    .slice(0, 50)
    .map((entry): HoldingRow => ({
      ...entry,
      ticker: entry.ticker,
      resolved_ticker: entry.resolved_ticker || null,
      cusip: entry.cusip || "",
      row_key: entry.security_key!,
      shares: NaN,
      market_value: NaN,
      weight: NaN,
      liquidated: true,
    }));
  return [...rows, ...sold];
}
