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
 * invent per-stock detail (e.g. 13F 신규/증가 breakdowns, which the pipeline
 * does not provide — basis copy states holder count only).
 */

import { BAND_CHEAP, bandPct, normalizeBandTuple } from "./bands";
import { screenerSortValue } from "./common-basis-short-term";
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
   * Card ranking. Every card ranks via workbenchRank (the shared workbench
   * sort primitive + key), so "조건 보기" applies filters and sort 1:1.
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

/**
 * Q1 (smart-value) "왜": holder count only. The Q1 basis states 13F as
 * holder count with quarterly new/increased flows undisclosed, so no 13F
 * change placeholder is shown on this card.
 */
function holdersWhy(stock: ScreenerStock): string {
  return `${formatEdgeDrivers(stock) ?? "드라이버 미집계"} · ${holdersPhraseOf(stock)}`;
}

/**
 * Card ranking via the exact workbench sort primitive. Mirrors the
 * ScreenerClient `sorted` comparator (screenerSortValue + key, nulls-last
 * on both directions, string keys via localeCompare) so each card ranks
 * exactly as "조건 보기" does in analyze mode — including the
 * fenokConvictionScore -> fenokShortTermConvictionScore mapping and the
 * derived edgeGap key.
 */
function workbenchRank(stocks: ScreenerStock[], sortKey: ScreenerSortKey, sortDir: SortDir): ScreenerStock[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...stocks].sort((a, b) => {
    const av = screenerSortValue(a, sortKey);
    const bv = screenerSortValue(b, sortKey);
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    return ((av as number) - (bv as number)) * dir;
  });
}

export const SCREENER_QUESTION_CARDS: readonly QuestionCardDef[] = [
  {
    id: "smart-value",
    index: 1,
    title: "스마트머니 보유 저평가 종목",
    question: "기관·고수가 보유한 저평가 종목은?",
    basis: "신호 기관·고수 주목 ∩ 밴드 저평가 ∩ 장기 Edge 60 이상 · 13F 보유 기관 수 기준 · 분기별 신규/증가 내역은 미제공",
    filters: { actionFilter: "smart_money", bandFilter: "cheap", convictionMin: "60" },
    sortKey: "fenokConvictionScore",
    sortDir: "desc",
    chips: ["신호: 기관·고수 주목", "밴드: 저평가", "장기 Edge ≥ 60"],
    match: (stock) => stock.actionBucket === "smart_money" && isCheapBand(stock) && longEdgeAtLeast(stock, 60),
    rank: (stocks) => workbenchRank(stocks, "fenokConvictionScore", "desc"),
    why: (stock) => holdersWhy(stock),
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
    rank: (stocks) => workbenchRank(stocks, "edgeGap", "desc"),
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
    rank: (stocks) => workbenchRank(stocks, "fenokConvictionScore", "desc"),
    why: (stock) => driversWhy(stock),
  },
  {
    id: "upgrade-flow",
    index: 4,
    title: "FY+1 성장 + 스마트머니 보유",
    question: "FY+1 성장과 스마트머니 보유가 겹치는 종목은?",
    basis: "FY+1 매출·EPS 성장률 ≥ 0 (컨센서스 상향 신호 아님) ∩ 신호 기관·고수 주목",
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
    rank: (stocks) => workbenchRank(stocks, "epsGrowthFy1", "desc"),
    why: (stock) => driversWhy(stock),
  },
  {
    id: "dividend-health",
    index: 5,
    title: "고배당 · 재무 체력",
    question: "배당주면서 체력도 좋은 종목은?",
    basis: "배당수익률 2% 이상 · 내구 수익성 순",
    filters: { dividendYieldMin: "2", durabilityMin: "50" },
    sortKey: "durabilityProfitabilityScore",
    sortDir: "desc",
    chips: ["배당수익률 ≥ 2%", "내구 수익성 ≥ 50", "내구 수익성 순 정렬"],
    match: (stock) => {
      if (stock.dividendYield === null || stock.dividendYield === undefined || stock.dividendYield * 100 < 2) return false;
      // Mirrors the workbench durabilityMin check in ScreenerClient, so 조건 보기
      // reproduces this card's match set exactly.
      const durability = finiteNumber(stock.durabilityProfitabilityScore) ? stock.durabilityProfitabilityScore : null;
      return durability !== null && durability >= 50;
    },
    rank: (stocks) => workbenchRank(stocks, "durabilityProfitabilityScore", "desc"),
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
