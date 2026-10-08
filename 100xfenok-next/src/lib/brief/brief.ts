/**
 * 100x Briefing data contract (`briefing-index/v1`, `briefing-morning/v1`) and
 * the small formatting helpers the approved mockup's renderer used
 * (template_i.html + charts.js). Data lives at /data/briefing/.
 */

export const BRIEF_INDEX_URL = "/data/briefing/index.json";
export const BRIEF_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function briefMorningDataUrl(date: string): string {
  return `/data/briefing/morning/${date}.json`;
}

export type BriefEdge = {
  session?: string;
  score: number;
  label: string;
  prev_score?: number | null;
  prev_session?: string;
  sectors_up?: number;
  hy_spread?: number;
  components?: Record<string, number>;
};

export type BriefEdgeWeekPoint = { session: string; score: number; label?: string };

export type BriefIndexEdition = {
  product: string;
  edition_date: string;
  market_date: string;
  headline: string;
  thesis: string;
  sp500_chg_pct: number | null;
  nasdaq_chg_pct: number | null;
  russell_chg_pct: number | null;
  edge?: { score: number; label: string } | null;
  path: string;
  bytes?: number;
};

export type BriefProduct = { id: string; name: string; cadence: string; desc: string; status: string };

export type BriefIndex = {
  schema: string;
  latest: { morning?: string };
  editions: BriefIndexEdition[];
  products?: BriefProduct[];
};

export type BriefQuote = {
  close: number;
  chg_pct: number;
  streak?: number;
  record_date?: string;
  prev_date?: string;
  from_record_pct?: number;
  from_52w_high_pct?: number;
  ytd_pct?: number;
  vol_vs_20d?: number;
  spark20?: number[];
  symbol?: string;
  name?: string;
};

export type BriefIntraday = {
  open: number;
  high: number;
  high_time: string;
  low: number;
  low_time: string;
  close: number;
  points: [string, number][];
};

export type BriefPack = {
  session: string;
  indices: Record<string, BriefQuote>;
  etfs: Record<string, BriefQuote>;
  bigtech: Record<string, BriefQuote>;
  sectors: Record<string, BriefQuote>;
  sectors_up?: number;
  rates?: { us10y: number; us10y_prev: number } & Record<string, unknown>;
  breadth?: { advancing?: number; declining?: number; new_high?: number; new_low?: number } | null;
  edge?: BriefEdge | null;
  edge_week?: BriefEdgeWeekPoint[];
  sources?: string[];
  intraday?: Record<string, BriefIntraday | undefined>;
};

export type BriefAnnotation = { time_et: string; time_kst?: string; label: string; series: string };

export type BriefArticle = {
  schema: string;
  product: string;
  edition_date: string;
  market_date: string;
  model?: string;
  published_kst?: string;
  headline: string;
  thesis: string;
  strip_extra?: { label: string; value: string; change?: string }[];
  fx?: { usdkrw?: number; change_won?: number; basis?: string; change_pct?: number };
  story: {
    title: string;
    chart_headline?: string;
    paragraphs: string[];
    why?: string[];
    annotations?: BriefAnnotation[];
  };
  bigtech_take?: string;
  bigtech_notes?: { ticker: string; note: string }[];
  scene: { title: string; take: string };
  movers?: {
    ticker?: string;
    name: string;
    reason: string;
    stats?: { chg_pct?: number; vol_vs_20d?: number; from_52w_high_pct?: number; ytd_pct?: number };
  }[];
  tonight?: { kst: string; what: string; why?: string }[];
  yesterday_check?: { was: string; now: string }[];
  briefs?: { title: string; text: string; why?: string }[];
  pack: BriefPack;
};

export type Dir = "up" | "down" | "flat";

/** ko-KR number with fixed decimals; "–" for missing values (charts.js fmt). */
export function fmt(v: number | null | undefined, d?: number): string {
  if (v == null || Number.isNaN(v)) return "–";
  return Number(v).toLocaleString("ko-KR", {
    minimumFractionDigits: d == null ? 0 : d,
    maximumFractionDigits: d == null ? 2 : d,
  });
}

export function dir(v: number | null | undefined): Dir {
  if (v == null || Number.isNaN(v)) return "flat";
  return v > 0 ? "up" : v < 0 ? "down" : "flat";
}

/** Signed percentage with two decimals, "–" when missing. */
export function pct(v: number | null | undefined): string {
  return v == null ? "–" : `${v > 0 ? "+" : ""}${fmt(v, 2)}%`;
}

/** Hours KST is ahead of New York on an ISO day: 13 under EDT, 14 under EST. */
export function kstLeadHours(isoDay?: string | null): number {
  if (!isoDay || !BRIEF_DATE_RE.test(isoDay)) return 13;
  try {
    const noonUtc = new Date(`${isoDay}T16:00:00Z`);
    const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
      .formatToParts(noonUtc)
      .find((part) => part.type === "timeZoneName")?.value;
    const match = /GMT([+-]\d+)/.exec(name ?? "");
    return match ? 9 - Number(match[1]) : 13;
  } catch {
    return 13;
  }
}

/** ET "HH:MM" to KST "HH:MM" for the session day's New York offset. */
export function kst(t: string, leadHours = 13): string {
  const h = Number(t.slice(0, 2));
  return `${String((h + leadHours) % 24).padStart(2, "0")}:${t.slice(3)}`;
}

/** "MM/DD" from an ISO day. */
export function monthDay(iso: string): string {
  return iso.slice(5).replace("-", "/");
}

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** Korean dateline for an edition date ("2026년 10월 8일 목요일"). */
export function dateline(editionDate: string): string {
  const [y, m, d] = editionDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}년 ${m}월 ${d}일 ${DAYS[weekday]}요일`;
}

export function edgeLabelColor(label: string): string {
  return label === "방어" ? "#B42339" : label === "중립" ? "#475569" : "#0B6E4B";
}

export function sortedEditions(index: BriefIndex | null, product = "morning"): BriefIndexEdition[] {
  return (index?.editions ?? [])
    .filter((edition) => edition.product === product && BRIEF_DATE_RE.test(edition.edition_date))
    .sort((a, b) => (a.edition_date < b.edition_date ? -1 : a.edition_date > b.edition_date ? 1 : 0));
}

export function latestEdition(index: BriefIndex | null): BriefIndexEdition | null {
  const editions = sortedEditions(index);
  if (editions.length === 0) return null;
  const latest = index?.latest?.morning;
  return editions.find((edition) => edition.edition_date === latest) ?? editions[editions.length - 1];
}
