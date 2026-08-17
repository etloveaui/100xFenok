import { isValidEntityTicker, normalizeForEntityKey } from "../ticker";
import type { Flag } from "../personal/personal-state";

export const MATERIAL_CHANGE_VERSION = 1 as const;
export const MATERIAL_CHANGE_MAX_ITEMS = 7 as const;

export type MaterialChangeSource = "revision" | "superinvestor";
export type MaterialChangeKind = "up" | "down" | "buy" | "sell" | "new-position";
export type MaterialChangeStatus = "available" | "missing" | "invalid";

export interface RevisionMoversInput {
  generated_at?: unknown;
  generatedAt?: unknown;
  up?: unknown;
  down?: unknown;
}

export interface SuperinvestorHighlightsInput {
  generated_at?: unknown;
  generatedAt?: unknown;
  quarter?: unknown;
  metadata?: unknown;
  bought?: unknown;
  sold?: unknown;
  new_positions?: unknown;
  highlights?: unknown;
}

/** Direct flags, a SavedFlags payload, or its `{ data: { flags } }` envelope. */
export type PersonalFlagsLike =
  | Readonly<Record<string, unknown>>
  | { flags?: unknown; data?: unknown }
  | null
  | undefined;

export interface MaterialChangeItem {
  id: string;
  source: MaterialChangeSource;
  kind: MaterialChangeKind;
  ticker: string;
  asOf: string;
  label: string;
  title: string;
  detail: string;
  value: number | null;
}

export interface MaterialChangeAttentionItem extends MaterialChangeItem {
  flag: Flag;
}

export interface RevisionSourceEvidence {
  generatedAt: string | null;
  asOf: string | null;
  asOfs: readonly string[];
  validCandidateCount: number;
  invalidCandidateCount: number;
  reason: string | null;
}

export interface SuperinvestorSourceEvidence {
  generatedAt: string | null;
  quarter: string | null;
  quarters: readonly string[];
  validCandidateCount: number;
  invalidCandidateCount: number;
  reason: string | null;
}

export interface MaterialChangeProjection {
  version: typeof MATERIAL_CHANGE_VERSION;
  sources: {
    revision: { status: MaterialChangeStatus; evidence: RevisionSourceEvidence };
    superinvestor: { status: MaterialChangeStatus; evidence: SuperinvestorSourceEvidence };
  };
  changed: readonly MaterialChangeItem[];
  attention: readonly MaterialChangeAttentionItem[];
}

interface Candidate extends MaterialChangeItem {
  sourceRank: number;
  kindRank: number;
  priority: number;
}

interface ParsedSource<Evidence> {
  status: MaterialChangeStatus;
  evidence: Evidence;
  candidates: Candidate[];
}

const SOURCE_RANK: Record<MaterialChangeSource, number> = { revision: 0, superinvestor: 1 };
const KIND_RANK: Record<MaterialChangeKind, number> = {
  up: 0,
  down: 1,
  buy: 2,
  sell: 3,
  "new-position": 4,
};
const FLAG_RANK: Record<Flag, number> = { RISK: 0, VERIFY: 1, THESIS: 2, WATCH: 3 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function readNumber(record: Record<string, unknown>, ...keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function isNumberAtLeast(record: Record<string, unknown>, key: string, minimum: number): boolean {
  if (!hasOwn(record, key)) return true;
  const value = asNumber(record[key]);
  return value !== null && value >= minimum;
}

function hasValidSuperinvestorNumbers(row: Record<string, unknown>): boolean {
  return ["amount", "value", "position_value"].every((key) => isNumberAtLeast(row, key, 0))
    && isNumberAtLeast(row, "investors_count", Number.MIN_VALUE)
    && isNumberAtLeast(row, "new_count", 0)
    && isNumberAtLeast(row, "exit_count", 0);
}

function normalizeTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ticker = normalizeForEntityKey(value);
  return ticker.length > 0 && isValidEntityTicker(ticker) ? ticker : null;
}

function normalizeDate(value: unknown): string | null {
  const text = asString(value);
  const match = text?.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? match[1]
    : null;
}

function normalizeQuarter(value: unknown): string | null {
  const quarter = asString(value);
  return quarter !== null && /^\d{4}-Q[1-4]$/.test(quarter) ? quarter : null;
}

function readGeneratedAt(record: Record<string, unknown>): string | null {
  const metadata = isRecord(record.metadata) ? record.metadata : null;
  return asString(record.generated_at ?? record.generatedAt ?? metadata?.generated_at ?? metadata?.generatedAt);
}

function readQuarter(record: Record<string, unknown>): string | null {
  const metadata = isRecord(record.metadata) ? record.metadata : null;
  return normalizeQuarter(record.quarter ?? metadata?.quarter);
}

function revisionEvidence(
  generatedAt: string | null,
  asOfs: Iterable<string>,
  validCandidateCount: number,
  invalidCandidateCount: number,
  reason: string | null,
): RevisionSourceEvidence {
  const sorted = [...new Set(asOfs)].sort();
  return {
    generatedAt,
    asOf: sorted.length === 1 ? sorted[0] : null,
    asOfs: sorted,
    validCandidateCount,
    invalidCandidateCount,
    reason,
  };
}

function superinvestorEvidence(
  generatedAt: string | null,
  quarters: Iterable<string>,
  validCandidateCount: number,
  invalidCandidateCount: number,
  reason: string | null,
): SuperinvestorSourceEvidence {
  const sorted = [...new Set(quarters)].sort();
  return {
    generatedAt,
    quarter: sorted.length === 1 ? sorted[0] : null,
    quarters: sorted,
    validCandidateCount,
    invalidCandidateCount,
    reason,
  };
}

function stableId(source: MaterialChangeSource, kind: MaterialChangeKind, ticker: string, asOf: string): string {
  return `${source}:${kind}:${ticker}:${asOf}`;
}

function makeCandidate(
  source: MaterialChangeSource,
  kind: MaterialChangeKind,
  ticker: string,
  asOf: string,
  title: string,
  detail: string,
  value: number | null,
  priority: number,
): Candidate {
  return {
    id: stableId(source, kind, ticker, asOf),
    source,
    kind,
    ticker,
    asOf,
    label: kind === "up"
      ? "실적추정 상향"
      : kind === "down"
        ? "실적추정 하향"
        : kind === "buy"
          ? "최다 매수"
          : kind === "sell"
            ? "최다 매도"
            : "신규 편입",
    title,
    detail,
    value,
    sourceRank: SOURCE_RANK[source],
    kindRank: KIND_RANK[kind],
    priority,
  };
}

function makeRevisionCandidate(kind: "up" | "down", row: Record<string, unknown>): Candidate | null {
  const ticker = normalizeTicker(row.ticker);
  const asOf = normalizeDate(row.as_of);
  const change = asNumber(row.change_1w);
  if (ticker === null || asOf === null || change === null || (kind === "up" ? change <= 0 : change >= 0)) return null;
  const direction = kind === "up" ? "상향" : "하향";
  const sign = change > 0 ? "+" : change < 0 ? "-" : "";
  return makeCandidate(
    "revision",
    kind,
    ticker,
    asOf,
    readString(row, "name") ?? "내년(FY+1) EPS 추정치",
    `FY+1 EPS 추정치 ${direction} ${sign}${Math.abs(change * 100).toFixed(1)}%`,
    change,
    change,
  );
}

function parseRevisionSource(input: unknown): ParsedSource<RevisionSourceEvidence> {
  if (input === null || input === undefined) {
    return {
      status: "missing",
      evidence: revisionEvidence(null, [], 0, 0, "source_missing"),
      candidates: [],
    };
  }
  if (!isRecord(input)) {
    return {
      status: "invalid",
      evidence: revisionEvidence(null, [], 0, 0, "source_malformed"),
      candidates: [],
    };
  }
  const hasUp = hasOwn(input, "up");
  const hasDown = hasOwn(input, "down");
  if (!hasUp && !hasDown) {
    return {
      status: "invalid",
      evidence: revisionEvidence(readGeneratedAt(input), [], 0, 0, "source_malformed"),
      candidates: [],
    };
  }

  const candidates: Candidate[] = [];
  const asOfs = new Set<string>();
  let invalidCandidateCount = 0;
  let malformed = false;
  for (const [key, kind] of [["up", "up"], ["down", "down"]] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      malformed = true;
      invalidCandidateCount += 1;
      continue;
    }
    for (const rawRow of value) {
      if (!isRecord(rawRow)) {
        invalidCandidateCount += 1;
        continue;
      }
      const candidate = makeRevisionCandidate(kind, rawRow);
      if (candidate === null) {
        invalidCandidateCount += 1;
        continue;
      }
      candidates.push(candidate);
      asOfs.add(candidate.asOf);
    }
  }
  if (malformed) {
    return {
      status: "invalid",
      evidence: revisionEvidence(readGeneratedAt(input), [], 0, invalidCandidateCount, "source_malformed"),
      candidates: [],
    };
  }
  if (candidates.length === 0 && invalidCandidateCount > 0) {
    return {
      status: "invalid",
      evidence: revisionEvidence(readGeneratedAt(input), [], 0, invalidCandidateCount, "candidate_invalid"),
      candidates: [],
    };
  }
  return {
    status: "available",
    evidence: revisionEvidence(readGeneratedAt(input), asOfs, candidates.length, invalidCandidateCount, null),
    candidates,
  };
}

function parseSuperinvestorKind(value: unknown): MaterialChangeKind | null {
  const text = asString(value)?.toLowerCase().replace(/_/g, "-") ?? "";
  if (["buy", "bought", "top-buy", "매수"].includes(text) || text.includes("매수")) return "buy";
  if (["sell", "sold", "top-sell", "매도"].includes(text) || text.includes("매도")) return "sell";
  if (["new", "new-position", "new-position-signal", "신규", "신규 편입"].includes(text)) return "new-position";
  return null;
}

function superinvestorDetail(kind: MaterialChangeKind, row: Record<string, unknown>): string {
  if (kind === "new-position") {
    const count = readNumber(row, "new_count");
    return count === null ? "13F 신규 포지션" : `13F 신규 포지션 · ${count}명 신규`;
  }
  const investors = readNumber(row, "investors_count");
  if (investors !== null) return `13F ${kind === "buy" ? "매수" : "매도"} · ${investors}명`;
  return readString(row, "signal") ?? `13F ${kind === "buy" ? "매수" : "매도"}`;
}

function makeSuperinvestorRowCandidate(
  kind: MaterialChangeKind,
  row: Record<string, unknown>,
  sourceQuarter: string | null,
  requireAmount: boolean,
): Candidate | null {
  const ticker = normalizeTicker(row.ticker);
  const quarter = normalizeQuarter(readString(row, "quarter", "quarter_added") ?? sourceQuarter);
  const amount = readNumber(row, "amount", "value", "position_value");
  if (!hasValidSuperinvestorNumbers(row) || ticker === null || quarter === null || (requireAmount && amount === null)) return null;
  let priority = amount ?? 0;
  if (kind === "new-position") {
    const count = row.new_count === undefined ? 1 : asNumber(row.new_count);
    if (count === null || count <= 0) return null;
    priority = count;
  }
  return makeCandidate(
    "superinvestor",
    kind,
    ticker,
    quarter,
    readString(row, "name", "meta") ?? ticker,
    superinvestorDetail(kind, row),
    amount,
    priority,
  );
}

function makeSuperinvestorHighlightCandidate(
  entry: Record<string, unknown>,
  sourceQuarter: string | null,
): Candidate | null {
  const kind = parseSuperinvestorKind(entry.kind ?? entry.key ?? entry.label);
  const ticker = normalizeTicker(entry.ticker);
  const quarter = normalizeQuarter(readString(entry, "quarter", "asOf", "as_of") ?? sourceQuarter);
  if (!hasValidSuperinvestorNumbers(entry) || kind === null || ticker === null || quarter === null) return null;
  const amount = readNumber(entry, "amount", "value", "position_value");
  const newCount = asNumber(entry.new_count);
  const priority = kind === "new-position" ? (newCount ?? 1) : (amount ?? 0);
  if (priority <= 0 && kind === "new-position") return null;
  return makeCandidate(
    "superinvestor",
    kind,
    ticker,
    quarter,
    readString(entry, "name", "meta") ?? ticker,
    superinvestorDetail(kind, entry),
    amount,
    priority,
  );
}

function parseSuperinvestorSource(input: unknown): ParsedSource<SuperinvestorSourceEvidence> {
  if (input === null || input === undefined) {
    return {
      status: "missing",
      evidence: superinvestorEvidence(null, [], 0, 0, "source_missing"),
      candidates: [],
    };
  }

  const record = isRecord(input) ? input : null;
  if (record === null) {
    return {
      status: "invalid",
      evidence: superinvestorEvidence(null, [], 0, 0, Array.isArray(input) ? "source_wrapper_required" : "source_malformed"),
      candidates: [],
    };
  }

  const generatedAt = readGeneratedAt(record);
  const sourceQuarter = readQuarter(record);
  const candidates: Candidate[] = [];
  let invalidCandidateCount = 0;
  let malformed = false;
  const appendHighlights = (value: unknown, quarter: string | null) => {
    if (!Array.isArray(value)) {
      malformed = true;
      invalidCandidateCount += 1;
      return;
    }
    for (const raw of value) {
      if (!isRecord(raw)) {
        invalidCandidateCount += 1;
        continue;
      }
      const candidate = makeSuperinvestorHighlightCandidate(raw, quarter);
      if (candidate === null) invalidCandidateCount += 1;
      else candidates.push(candidate);
    }
  };

  const shapeKeys = ["bought", "sold", "new_positions", "highlights"] as const;
  if (!shapeKeys.some((key) => hasOwn(record, key))) {
    return {
      status: "invalid",
      evidence: superinvestorEvidence(generatedAt, [], 0, 0, "source_malformed"),
      candidates: [],
    };
  }
  const appendRows = (key: (typeof shapeKeys)[number], kind: MaterialChangeKind, requireAmount: boolean) => {
    const value = record[key];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      malformed = true;
      invalidCandidateCount += 1;
      return;
    }
    for (const raw of value) {
      if (!isRecord(raw)) {
        invalidCandidateCount += 1;
        continue;
      }
      const candidate = makeSuperinvestorRowCandidate(kind, raw, sourceQuarter, requireAmount);
      if (candidate === null) {
        invalidCandidateCount += 1;
        continue;
      }
      candidates.push(candidate);
      if (kind === "buy" && asNumber(raw.new_count) !== null && (asNumber(raw.new_count) ?? 0) > 0) {
        const newCandidate = makeSuperinvestorRowCandidate("new-position", raw, sourceQuarter, false);
        if (newCandidate !== null) candidates.push(newCandidate);
      }
    }
  };
  appendRows("bought", "buy", true);
  appendRows("sold", "sell", true);
  appendRows("new_positions", "new-position", false);
  if (hasOwn(record, "highlights") && record.highlights !== undefined) {
    if (sourceQuarter === null) {
      return {
        status: "invalid",
        evidence: superinvestorEvidence(generatedAt, [], 0, invalidCandidateCount, "source_clock_missing"),
        candidates: [],
      };
    }
    appendHighlights(record.highlights, sourceQuarter);
  }

  if (malformed) {
    return {
      status: "invalid",
      evidence: superinvestorEvidence(generatedAt, [], 0, invalidCandidateCount, "source_malformed"),
      candidates: [],
    };
  }
  if (candidates.length === 0 && invalidCandidateCount > 0) {
    return {
      status: "invalid",
      evidence: superinvestorEvidence(generatedAt, [], 0, invalidCandidateCount, "candidate_invalid"),
      candidates: [],
    };
  }
  return {
    status: "available",
    evidence: superinvestorEvidence(generatedAt, candidates.map((candidate) => candidate.asOf), candidates.length, invalidCandidateCount, null),
    candidates,
  };
}

function candidateIdentity(a: MaterialChangeItem, b: MaterialChangeItem): number {
  return a.ticker.localeCompare(b.ticker) || a.asOf.localeCompare(b.asOf) || a.id.localeCompare(b.id)
    || a.title.localeCompare(b.title) || a.detail.localeCompare(b.detail);
}

function candidateSignature(candidate: Candidate): string {
  return [candidate.title, candidate.detail, candidate.value ?? "", candidate.priority].join("\u0000");
}

function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const previous = byId.get(candidate.id);
    if (!previous || candidateSignature(candidate).localeCompare(candidateSignature(previous)) < 0) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()];
}

function compareRevision(a: Candidate, b: Candidate, kind: "up" | "down"): number {
  return (kind === "up" ? b.priority - a.priority : a.priority - b.priority) || candidateIdentity(a, b);
}

function compareSuperinvestor(a: Candidate, b: Candidate): number {
  return b.priority - a.priority
    || (a.kind === "new-position" && b.kind === "new-position" ? (b.value ?? 0) - (a.value ?? 0) : 0)
    || candidateIdentity(a, b);
}

function selectChanged(revisionCandidates: readonly Candidate[], superinvestorCandidates: readonly Candidate[]): Candidate[] {
  const revisions = dedupe(revisionCandidates);
  const superinvestors = dedupe(superinvestorCandidates);
  const up = revisions.filter((candidate) => candidate.kind === "up").sort((a, b) => compareRevision(a, b, "up")).slice(0, 2);
  const down = revisions.filter((candidate) => candidate.kind === "down").sort((a, b) => compareRevision(a, b, "down")).slice(0, 2);
  const first = (kind: MaterialChangeKind) => superinvestors
    .filter((candidate) => candidate.kind === kind)
    .sort(compareSuperinvestor)[0];
  return [...up, ...down, first("buy"), first("sell"), first("new-position")]
    .filter((candidate): candidate is Candidate => candidate !== undefined)
    .slice(0, MATERIAL_CHANGE_MAX_ITEMS);
}

function extractFlagRecord(input: PersonalFlagsLike): Readonly<Record<string, unknown>> {
  if (!isRecord(input)) return {};
  if (isRecord(input.data) && isRecord(input.data.flags)) return input.data.flags;
  if (isRecord(input.flags)) return input.flags;
  return input;
}

function isFlag(value: unknown): value is Flag {
  return value === "WATCH" || value === "THESIS" || value === "RISK" || value === "VERIFY";
}

function normalizeFlags(input: PersonalFlagsLike): Readonly<Record<string, Flag>> {
  const byTicker = new Map<string, Flag | null>();
  const raw = extractFlagRecord(input);
  for (const key of Object.keys(raw).sort()) {
    const ticker = normalizeTicker(key);
    const flag = isFlag(raw[key]) ? raw[key] : null;
    if (ticker === null || flag === null) continue;
    if (!byTicker.has(ticker)) byTicker.set(ticker, flag);
    else if (byTicker.get(ticker) !== flag) byTicker.set(ticker, null);
  }
  const result: Record<string, Flag> = {};
  for (const [ticker, flag] of byTicker) {
    if (flag !== null) result[ticker] = flag;
  }
  return result;
}

function selectAttention(candidates: readonly Candidate[], flagsInput: PersonalFlagsLike): MaterialChangeAttentionItem[] {
  const flags = normalizeFlags(flagsInput);
  return dedupe(candidates)
    .flatMap((candidate) => {
      const flag = flags[candidate.ticker];
      return flag === undefined ? [] : [{ ...candidate, flag }];
    })
    .sort((a, b) => FLAG_RANK[a.flag] - FLAG_RANK[b.flag]
      || a.sourceRank - b.sourceRank
      || a.kindRank - b.kindRank
      || candidateIdentity(a, b))
    .slice(0, MATERIAL_CHANGE_MAX_ITEMS)
    .map(({ sourceRank: _sourceRank, kindRank: _kindRank, priority: _priority, ...item }) => item);
}

function publicItem(candidate: Candidate): MaterialChangeItem {
  const { sourceRank: _sourceRank, kindRank: _kindRank, priority: _priority, ...item } = candidate;
  return item;
}

/** Pure Phase 1 projection: no I/O, clock, persistence, LLM, UI, or watchlist union. */
export function projectMaterialChanges(
  revisionMovers: RevisionMoversInput | null | undefined,
  superinvestorHighlights: SuperinvestorHighlightsInput | null | undefined,
  flags: PersonalFlagsLike = {},
): MaterialChangeProjection {
  const revisions = parseRevisionSource(revisionMovers);
  const superinvestors = parseSuperinvestorSource(superinvestorHighlights);
  return {
    version: MATERIAL_CHANGE_VERSION,
    sources: {
      revision: { status: revisions.status, evidence: revisions.evidence },
      superinvestor: { status: superinvestors.status, evidence: superinvestors.evidence },
    },
    changed: selectChanged(revisions.candidates, superinvestors.candidates).map(publicItem),
    attention: selectAttention([...revisions.candidates, ...superinvestors.candidates], flags),
  };
}
