import type {
  ByTickerData,
  BuyingPressureData,
  ConvictionEntriesData,
  NewPositionsData,
  SummaryData,
} from "@/lib/superinvestors/types";

// Pure selectors for the signal tab. No hardcoded investor names anywhere:
// the follow roster is derived from the loaded payload on every load.

export const FOLLOW_ROSTER_SIZE = 8;

export type RosterBasis = "conviction" | "holdings" | "aum" | "none";

export interface FollowRoster {
  ids: string[];
  basis: RosterBasis;
  totalNonPassive: number;
}

function isPassive(group: string | undefined): boolean {
  return (group ?? "").toLowerCase() === "passive";
}

// Default roster: non-passive managers ordered by conviction (max
// top-conviction-hold weight). Falls back to max holder weight from by_ticker,
// then AUM — always from the loaded payload, never a name list.
export function selectFollowRoster(
  summary: SummaryData | null,
  convictionEntries: ConvictionEntriesData | null,
  byTicker: ByTickerData | null,
  size = FOLLOW_ROSTER_SIZE,
): FollowRoster {
  const investors = summary ? Object.entries(summary.investors) : [];
  const pool = investors.filter(([, inv]) => !isPassive(inv.group)).map(([id]) => id);
  if (pool.length === 0) return { ids: [], basis: "none", totalNonPassive: 0 };

  const conviction = new Map<string, number>();
  for (const entry of convictionEntries?.top_conviction_hold ?? []) {
    if (!entry || typeof entry.investor !== "string") continue;
    if (typeof entry.weight !== "number" || !Number.isFinite(entry.weight)) continue;
    conviction.set(entry.investor, Math.max(conviction.get(entry.investor) ?? -1, entry.weight));
  }
  let basis: RosterBasis = "conviction";
  let scored = pool.map((id) => ({ id, score: conviction.get(id) ?? -1 }));
  if (scored.every((s) => s.score < 0)) {
    const topWeight = new Map<string, number>();
    if (byTicker) {
      for (const entry of Object.values(byTicker)) {
        for (const h of entry?.holder_details ?? []) {
          if (!h || typeof h.investor !== "string") continue;
          if (typeof h.weight !== "number" || !Number.isFinite(h.weight)) continue;
          topWeight.set(h.investor, Math.max(topWeight.get(h.investor) ?? -1, h.weight));
        }
      }
    }
    scored = pool.map((id) => ({ id, score: topWeight.get(id) ?? -1 }));
    basis = "holdings";
  }
  if (scored.every((s) => s.score < 0)) {
    scored = pool.map((id) => ({ id, score: summary?.investors[id]?.aum ?? -1 }));
    basis = "aum";
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { ids: scored.slice(0, size).map((s) => s.id), basis, totalNonPassive: pool.length };
}

export interface NewBuyRank {
  ticker: string;
  buyers: Array<{ investor: string; weight: number }>;
  count: number;
  convictionWeight: number;
}

// 신규 매수 상위: new-position buyers grouped by ticker, ranked by the
// conviction-weighted buyer count (sum of position weights). Scope limits the
// buyers to the follow roster; null scope means the whole cohort.
export function buildNewBuyRanks(
  newPositions: NewPositionsData | null,
  scope: Set<string> | null,
  limit = 3,
): NewBuyRank[] {
  const byTicker = new Map<string, Array<{ investor: string; weight: number }>>();
  for (const p of newPositions?.new_positions ?? []) {
    if (!p || typeof p.ticker !== "string" || typeof p.investor !== "string") continue;
    if (scope && !scope.has(p.investor)) continue;
    const weight = typeof p.position_weight === "number" && Number.isFinite(p.position_weight) ? p.position_weight : 0;
    const arr = byTicker.get(p.ticker) ?? [];
    arr.push({ investor: p.investor, weight });
    byTicker.set(p.ticker, arr);
  }
  return [...byTicker.entries()]
    .map(([ticker, buyers]) => {
      buyers.sort((a, b) => b.weight - a.weight);
      const convictionWeight = buyers.reduce((sum, b) => sum + b.weight, 0);
      return { ticker, buyers, count: buyers.length, convictionWeight };
    })
    .sort((a, b) => b.convictionWeight - a.convictionWeight || b.count - a.count || a.ticker.localeCompare(b.ticker))
    .slice(0, limit);
}

export interface PressureRank {
  ticker: string;
  count: number;
}

// 증가/청산 상위: buying-pressure breadth counts. No holder-level weights
// exist for increasers/sellers in the loaded feeds, so these rank by net
// filer counts and say so on the rail — never synthesized weights.
export function buildPressureRanks(
  buyingPressure: BuyingPressureData | null,
  key: "net_buyers" | "net_sellers",
  limit = 3,
): PressureRank[] {
  const rows: Array<{ ticker: string; count: number; value: number }> = [];
  for (const [ticker, row] of Object.entries(buyingPressure?.buying_pressure ?? {})) {
    const count = row?.[key];
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
    const value = typeof row.total_value_change === "number" && Number.isFinite(row.total_value_change)
      ? row.total_value_change
      : 0;
    rows.push({ ticker, count, value });
  }
  rows.sort((a, b) => b.count - a.count || b.value - a.value || a.ticker.localeCompare(b.ticker));
  return rows.slice(0, limit);
}

export interface GrandRow {
  ticker: string;
  holders: number;
  totalWeight: number;
  maxWeight: number;
}

// Grand portfolio: every ticker by holder count, with summed and max
// holder weights (합산 비중 · 최대 집중) from holder_details.
export function buildGrandPortfolio(byTicker: ByTickerData | null, limit = 10): GrandRow[] {
  const rows: GrandRow[] = [];
  if (!byTicker) return rows;
  for (const [ticker, entry] of Object.entries(byTicker)) {
    if (!entry) continue;
    const details = Array.isArray(entry.holder_details) ? entry.holder_details : [];
    const weights = details
      .map((h) => h?.weight)
      .filter((w): w is number => typeof w === "number" && Number.isFinite(w));
    const holders = details.length > 0 ? details.length : (Array.isArray(entry.holders) ? entry.holders.length : 0);
    if (holders === 0) continue;
    rows.push({
      ticker,
      holders,
      totalWeight: weights.reduce((sum, w) => sum + w, 0),
      maxWeight: weights.length > 0 ? Math.max(...weights) : 0,
    });
  }
  rows.sort((a, b) => b.holders - a.holders || b.totalWeight - a.totalWeight || a.ticker.localeCompare(b.ticker));
  return rows.slice(0, limit);
}

export function investorDisplayName(summary: SummaryData | null, id: string): string {
  return summary?.investors[id]?.name ?? id;
}

export function initialsOf(name: string): string {
  const first = (name ?? "").trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

const AVATAR_STYLES = [
  { bg: "#cffafe", fg: "#0e7490" },
  { bg: "#fef9c3", fg: "#854d0e" },
  { bg: "#ccfbf1", fg: "#0f766e" },
  { bg: "#e2e8f0", fg: "#334155" },
  { bg: "#fae8ff", fg: "#a21caf" },
  { bg: "#ffedd5", fg: "#c2410c" },
  { bg: "#dbeafe", fg: "#1d4ed8" },
  { bg: "#f1f5f9", fg: "#475569" },
];

export function avatarStyleFor(id: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_STYLES[hash % AVATAR_STYLES.length] ?? { bg: "#f1f5f9", fg: "#475569" };
}
