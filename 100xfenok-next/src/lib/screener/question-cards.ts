/**
 * Screener V3 discover mode — the five Fenok question cards.
 *
 * One constant, not five hand-built panels. Each card is a saved screen: `filters`
 * uses only existing workbench primitives (ScreenerFilterState fields), so
 * "조건 보기" applies them 1:1 via applyFilterState and both modes share state.
 *
 * Predicates mirror ScreenerClient's filter checks (cited inline); any deviation
 * from the artboard mock numbers is deliberate — the artboard shows illustrative
 * values, while these definitions compute live from the loaded payload and never
 * invent per-stock detail (e.g. 13F 신규/증가 breakdowns, which exist only as
 * honest partial state in the UI).
 */

import { BAND_CHEAP, bandPct, normalizeBandTuple } from "./bands";
import { formatEdgeDrivers } from "./edge-drivers";
import type { ScreenerFilterState, SortDir } from "./filter-url";
import type { ScreenerSortKey, ScreenerStock } from "./types";

export type QuestionCardId =
  | "smart-value"
  | "short-over-long"
  | "conviction-band"
  | "upgrade-flow"
  | "dividend-health";

export interface QuestionCardDef {
  id: QuestionCardId;
  /** 1-based position in the five-card row. */
  index: number;
  title: string;
  /** One-line question shown under the title. */
  question: string;
  /** Condition basis line (describes the applied workbench conditions). */
  basis: string;
  /** Workbench state applied on "조건 보기" (existing primitives only). */
  filters: Partial<ScreenerFilterState>;
  sortKey: ScreenerSortKey;
  sortDir: SortDir;
  /** Display chips — always derived from `filters`, never aspirational. */
  chips: string[];
  /** Live predicate over the enriched screener stocks. */
  match: (stock: ScreenerStock) => boolean;
  /**
   * Card ranking. Uses the shared workbench sort for every card — including
   * short-over-long, whose short-minus-long gap has the edgeGap workbench sort
   * key, so "조건 보기" applies filters and sort 1:1.
   */
  rank: (stocks: ScreenerStock[]) => ScreenerStock[];
  /** One-line "왜" for a result row. */
  why: (stock: ScreenerStock) => string;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Mirrors ScreenerClient bandFilter === "cheap" (bandPct <= BAND_CHEAP, tuple required). */
function isCheapBand(stock: ScreenerStock): boolean {
  const band = normalizeBandTuple(stock.perBandCurrent, stock.perBandMin, stock.perBandMax);
  if (!band) return false;
  return bandPct(band[0], band[1], band[2]) <= BAND_CHEAP;
}

/** Mirrors passesFenokEdgeFilters long leg (convictionMin -> longEdgeMin -> fenokLongTermScore). */
function longEdgeAtLeast(stock: ScreenerStock, min: number): boolean {
  const long = finiteNumber(stock.fenokLongTermScore) ? stock.fenokLongTermScore : null;
  return long !== null && long >= min;
}

/** Mirrors passesFenokEdgeFilters short leg (fenokEdgeMin -> shortEdgeMin -> fenokShortTermScore). */
function shortEdgeAtLeast(stock: ScreenerStock, min: number): boolean {
  const short = finiteNumber(stock.fenokShortTermScore) ? stock.fenokShortTermScore : null;
  return short !== null && short >= min;
}

function convictionOf(stock: ScreenerStock): number | null {
  return finiteNumber(stock.fenokConvictionScore) ? stock.fenokConvictionScore : null;
}

function holdersOf(stock: ScreenerStock): number | null {
  return finiteNumber(stock.guruHolders) && stock.guruHolders > 0 ? stock.guruHolders : null;
}

function holdersPhraseOf(stock: ScreenerStock): string {
  const holders = holdersOf(stock);
  return holders === null ? "기관 보유 미집계" : `기관 ${holders}곳 보유`;
}

/**
 * Unified card "왜": top-2 Edge drivers (drawer-identical) · holder count ·
 * 13F change. Per-stock 13F 신규/증가 exists nowhere in the pipeline, so the
 * change leg is always an honest dash — never a fabricated breakdown.
 */
function driversWhy(stock: ScreenerStock): string {
  return `${formatEdgeDrivers(stock) ?? "드라이버 미집계"} · ${holdersPhraseOf(stock)} · 13F 변화 -`;
}

function byDescNullsLast(get: (stock: ScreenerStock) => number | null) {
  return (a: ScreenerStock, b: ScreenerStock) => {
    const av = get(a);
    const bv = get(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  };
}

export const SCREENER_QUESTION_CARDS: readonly QuestionCardDef[] = [
  {
    id: "smart-value",
    index: 1,
    title: "스마트머니 보유 저평가 종목",
    question: "기관·고수가 보유한 저평가 종목은?",
    basis: "신호 기관·고수 주목 ∩ 밴드 저평가 ∩ 장기 Edge 60 이상 · 13F 신규·증가 내역 부분 공개",
    filters: { actionFilter: "smart_money", bandFilter: "cheap", convictionMin: "60" },
    sortKey: "fenokConvictionScore",
    sortDir: "desc",
    chips: ["신호: 기관·고수 주목", "밴드: 저평가", "장기 Edge ≥ 60"],
    match: (stock) => stock.actionBucket === "smart_money" && isCheapBand(stock) && longEdgeAtLeast(stock, 60),
    rank: (stocks) => [...stocks].sort(byDescNullsLast(convictionOf)),
    why: (stock) => driversWhy(stock),
  },
  {
    id: "short-over-long",
    index: 2,
    title: "단기 Edge가 장기보다 앞선 종목",
    question: "단기 모멘텀이 장기를 앞서는 종목은?",
    basis: "단기 Edge 60 이상 중 단기−장기 괴리 순",
    filters: { fenokEdgeMin: "60" },
    sortKey: "edgeGap",
    sortDir: "desc",
    chips: ["단기 Edge ≥ 60", "단기−장기 괴리 순 정렬"],
    match: (stock) => {
      if (!shortEdgeAtLeast(stock, 60)) return false;
      if (!finiteNumber(stock.fenokLongTermScore)) return false;
      return (stock.fenokShortTermScore as number) > (stock.fenokLongTermScore as number);
    },
    rank: (stocks) =>
      [...stocks].sort((a, b) => {
        const gapA = (a.fenokShortTermScore as number) - (a.fenokLongTermScore as number);
        const gapB = (b.fenokShortTermScore as number) - (b.fenokLongTermScore as number);
        return gapB - gapA;
      }),
    why: (stock) => driversWhy(stock),
  },
  {
    id: "conviction-band",
    index: 3,
    title: "장기 Edge 상위 · 밸류 밴드 하단",
    question: "장기 점수는 높은데 아직 싼 종목은?",
    basis: "장기 Edge 70 이상 ∩ 밴드 저평가",
    filters: { convictionMin: "70", bandFilter: "cheap" },
    sortKey: "fenokConvictionScore",
    sortDir: "desc",
    chips: ["장기 Edge ≥ 70", "밴드: 저평가"],
    match: (stock) => longEdgeAtLeast(stock, 70) && isCheapBand(stock),
    rank: (stocks) => [...stocks].sort(byDescNullsLast(convictionOf)),
    why: (stock) => driversWhy(stock),
  },
  {
    id: "upgrade-flow",
    index: 4,
    title: "FY+1 성장 + 스마트머니 보유",
    question: "FY+1 성장과 스마트머니 보유가 겹치는 종목은?",
    basis: "매출·EPS 상향(FY+1) ∩ 신호 기관·고수 주목",
    filters: { revenueGrowthMin: "0", epsGrowthMin: "0", actionFilter: "smart_money" },
    sortKey: "epsGrowthFy1",
    sortDir: "desc",
    chips: ["매출 성장(FY+1) ≥ 0%", "EPS 성장(FY+1) ≥ 0%", "신호: 기관·고수 주목"],
    match: (stock) => {
      if (stock.actionBucket !== "smart_money") return false;
      if (stock.revenueGrowthFy1 === null || stock.revenueGrowthFy1 === undefined || stock.revenueGrowthFy1 < 0) return false;
      if (stock.epsGrowthFy1 === null || stock.epsGrowthFy1 === undefined || stock.epsGrowthFy1 < 0) return false;
      return true;
    },
    rank: (stocks) =>
      [...stocks].sort((a, b) => {
        const av = a.epsGrowthFy1 ?? null;
        const bv = b.epsGrowthFy1 ?? null;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      }),
    why: (stock) => driversWhy(stock),
  },
  {
    id: "dividend-health",
    index: 5,
    title: "고배당 · 재무 체력",
    question: "배당주면서 체력도 좋은 종목은?",
    basis: "배당수익률 2% 이상 · 내구 수익성 순",
    filters: { dividendYieldMin: "2" },
    sortKey: "durabilityProfitabilityScore",
    sortDir: "desc",
    chips: ["배당수익률 ≥ 2%", "내구 수익성 ≥ 50 · 카드 선별", "내구 수익성 순 정렬"],
    match: (stock) => {
      if (stock.dividendYield === null || stock.dividendYield === undefined || stock.dividendYield * 100 < 2) return false;
      // Card-only curation floor: no workbench primitive reproduces it, so the
      // chips above say so explicitly.
      const durability = finiteNumber(stock.durabilityProfitabilityScore) ? stock.durabilityProfitabilityScore : null;
      return durability !== null && durability >= 50;
    },
    rank: (stocks) =>
      [...stocks].sort((a, b) => {
        const av = finiteNumber(a.durabilityProfitabilityScore) ? (a.durabilityProfitabilityScore as number) : null;
        const bv = finiteNumber(b.durabilityProfitabilityScore) ? (b.durabilityProfitabilityScore as number) : null;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      }),
    why: (stock) => driversWhy(stock),
  },
];

export function getQuestionCard(id: string | null | undefined): QuestionCardDef {
  return SCREENER_QUESTION_CARDS.find((card) => card.id === id) ?? SCREENER_QUESTION_CARDS[0];
}

/** Live result set for a card, ranked. Mirrors the workbench result for card.filters. */
export function matchQuestionCard(stocks: ScreenerStock[], card: QuestionCardDef): ScreenerStock[] {
  return card.rank(stocks.filter(card.match));
}
