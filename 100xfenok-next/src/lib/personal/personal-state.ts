/**
 * Shared Personal Market OS state - slice 1.
 *
 * Versioned, validated, SSR-safe localStorage documents for personal
 * view preferences (SavedView), saved universes (SavedUniverse), and
 * per-symbol flags (SavedFlags). Screener is the first consumer: its
 * legacy keys (screener-preset, screener-density, screener-view-mode,
 * screener-filter-presets) migrate into these documents on the first
 * successful read and only while the current key is absent: a present
 * current document - valid or malformed - is authoritative and never
 * re-imports legacy. Legacy keys are never deleted or overwritten in
 * this release. Malformed current or legacy storage fails closed to
 * defaults without throwing. Saved filter states are normalized onto
 * defaults field-by-field so nothing malformed is cast into state.
 * URL query state remains the authority for Screener filters; this
 * module never overrides URL-provided state.
 */

import {
  coerceActionFilter,
  coerceColumnPreset,
  coerceConnectionFilter,
  coerceConvictionFilter,
  coerceFenokEdgeFilter,
  defaultScreenerFilterState,
  type ColumnPreset,
  type ScreenerFilterState,
} from "../screener/filter-url";
import { SCREENER_SORT_KEYS, type ScreenerSortKey } from "../screener/types";

export const PERSONAL_STATE_VERSION = 1 as const;

export interface PersonalDocument<TPayload> {
  version: typeof PERSONAL_STATE_VERSION;
  /** ISO-8601 UTC timestamp written on every mutation; suitable for Change Feed intersection. */
  updatedAt: string;
  data: TPayload;
}

/** Per-symbol flag values shared across surfaces. */
export type Flag = "WATCH" | "THESIS" | "RISK" | "VERIFY";

export const FLAG_VALUES: readonly Flag[] = ["WATCH", "THESIS", "RISK", "VERIFY"];

export const PERSONAL_DOC_KEYS = {
  view: "personal-view.v1",
  universes: "personal-universes.v1",
  flags: "personal-flags.v1",
} as const;

/** Personal view preferences per surface. A missing field means the surface has no persisted preference for it. */
export type ScreenerDensity = "compact" | "standard" | "comfortable";
export type ScreenerViewMode = "table" | "card";

export interface ScreenerViewPreferences {
  columnPreset?: ColumnPreset;
  density?: ScreenerDensity;
  viewMode?: ScreenerViewMode;
}

export type SavedView = PersonalDocument<{ screener: ScreenerViewPreferences }>;

/** A user-saved named filter universe (Screener filter preset). */
export interface SavedScreenerUniverse {
  name: string;
  state: ScreenerFilterState;
}

export type SavedUniverse = PersonalDocument<{ screener: SavedScreenerUniverse[] }>;

/** Per-symbol flag document (WATCH | THESIS | RISK | VERIFY). */
export type SavedFlags = PersonalDocument<{ flags: Record<string, Flag> }>;

/** Legacy Screener keys. Migrate-only this release: never deleted, never overwritten. */
const LEGACY_SCREENER_KEYS = {
  preset: "screener-preset",
  density: "screener-density",
  viewMode: "screener-view-mode",
  filterPresets: "screener-filter-presets",
} as const;

const SCREENER_DENSITIES: readonly ScreenerDensity[] = ["compact", "standard", "comfortable"];
const SCREENER_VIEW_MODES: readonly ScreenerViewMode[] = ["table", "card"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDensity(value: unknown): value is ScreenerDensity {
  return typeof value === "string" && (SCREENER_DENSITIES as readonly string[]).includes(value);
}

function isViewMode(value: unknown): value is ScreenerViewMode {
  return typeof value === "string" && (SCREENER_VIEW_MODES as readonly string[]).includes(value);
}

function isIsoTimestamp(value: string): boolean {
  // ISO-8601 UTC timestamp (the shape our writer emits via toISOString).
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isDocumentEnvelope(value: unknown): value is PersonalDocument<unknown> {
  if (!isRecord(value)) return false;
  if (value.version !== PERSONAL_STATE_VERSION) return false;
  if (typeof value.updatedAt !== "string" || !isIsoTimestamp(value.updatedAt)) return false;
  return isRecord(value.data);
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Security-restricted environments surface no storage.
    return null;
  }
}

function readRaw(key: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Fail closed: quota/security errors never surface to callers.
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

type DocumentReadResult<TPayload> =
  | { kind: "absent" }
  | { kind: "malformed" }
  | { kind: "valid"; data: TPayload };

/**
 * Reads a versioned document, distinguishing "key absent" (eligible for
 * legacy migration) from "present but malformed/wrong-version" (fail
 * closed; never eligible for migration).
 */
function readDocument<TPayload>(key: string, extract: (data: unknown) => TPayload): DocumentReadResult<TPayload> {
  const raw = readRaw(key);
  if (raw === null) return { kind: "absent" };
  const parsed = parseJson(raw);
  if (parsed === null || !isDocumentEnvelope(parsed)) return { kind: "malformed" };
  return { kind: "valid", data: extract(parsed.data) };
}

function writeDocument<TPayload>(key: string, data: TPayload): void {
  const doc: PersonalDocument<TPayload> = {
    version: PERSONAL_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    data,
  };
  writeRaw(key, JSON.stringify(doc));
}

function extractViewData(value: unknown): ScreenerViewPreferences {
  if (!isRecord(value)) return {};
  const screener = value.screener;
  if (!isRecord(screener)) return {};
  const prefs: ScreenerViewPreferences = {};
  if (typeof screener.columnPreset === "string") {
    const preset = coerceColumnPreset(screener.columnPreset);
    if (preset !== null) prefs.columnPreset = preset;
  }
  if (isDensity(screener.density)) prefs.density = screener.density;
  if (isViewMode(screener.viewMode)) prefs.viewMode = screener.viewMode;
  return prefs;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Normalizes arbitrary saved filter state onto the default state.
 * Partial legacy states merge onto defaults; invalid field types and
 * enum values fail closed per field (safe defaults) instead of being
 * cast wholesale into ScreenerFilterState.
 */
function normalizeFilterState(raw: unknown): ScreenerFilterState {
  const state = defaultScreenerFilterState();
  if (!isRecord(raw)) return state;
  if (typeof raw.search === "string") state.search = raw.search;
  state.selectedSectors = normalizeStringList(raw.selectedSectors);
  state.selectedCountries = normalizeStringList(raw.selectedCountries);
  state.perMin = stringOrEmpty(raw.perMin);
  state.perMax = stringOrEmpty(raw.perMax);
  state.forwardPerMax = stringOrEmpty(raw.forwardPerMax);
  state.revenueGrowthMin = stringOrEmpty(raw.revenueGrowthMin);
  state.epsGrowthMin = stringOrEmpty(raw.epsGrowthMin);
  state.dividendYieldMin = stringOrEmpty(raw.dividendYieldMin);
  state.dividendYieldMax = stringOrEmpty(raw.dividendYieldMax);
  state.durabilityMin = stringOrEmpty(raw.durabilityMin);
  state.roeFy1Min = stringOrEmpty(raw.roeFy1Min);
  state.ret3yMin = stringOrEmpty(raw.ret3yMin);
  state.ret5yMin = stringOrEmpty(raw.ret5yMin);
  state.marketCapMin = stringOrEmpty(raw.marketCapMin);
  state.marketCapMax = stringOrEmpty(raw.marketCapMax);
  state.pbrMin = stringOrEmpty(raw.pbrMin);
  state.pbrMax = stringOrEmpty(raw.pbrMax);
  state.pegMax = stringOrEmpty(raw.pegMax);
  state.roeMin = stringOrEmpty(raw.roeMin);
  state.opmMin = stringOrEmpty(raw.opmMin);
  state.return12mMin = stringOrEmpty(raw.return12mMin);
  if (typeof raw.profitableOnly === "boolean") state.profitableOnly = raw.profitableOnly;
  if (raw.bandFilter === "" || raw.bandFilter === "cheap" || raw.bandFilter === "fair" || raw.bandFilter === "rich") {
    state.bandFilter = raw.bandFilter;
  }
  if (typeof raw.actionFilter === "string") state.actionFilter = coerceActionFilter(raw.actionFilter);
  if (typeof raw.fenokEdgeMin === "string") state.fenokEdgeMin = coerceFenokEdgeFilter(raw.fenokEdgeMin);
  if (typeof raw.convictionMin === "string") state.convictionMin = coerceConvictionFilter(raw.convictionMin);
  if (typeof raw.connectionFilter === "string") state.connectionFilter = coerceConnectionFilter(raw.connectionFilter);
  if (typeof raw.sortKey === "string" && (SCREENER_SORT_KEYS as readonly string[]).includes(raw.sortKey)) {
    state.sortKey = raw.sortKey as ScreenerSortKey;
  }
  if (raw.sortDir === "asc" || raw.sortDir === "desc") state.sortDir = raw.sortDir;
  if (typeof raw.preset === "string") {
    const preset = coerceColumnPreset(raw.preset);
    if (preset !== null) state.preset = preset;
  }
  return state;
}

function normalizeScreenerUniverse(entry: unknown): SavedScreenerUniverse | null {
  if (!isRecord(entry)) return null;
  if (typeof entry.name !== "string") return null;
  if (!isRecord(entry.state)) return null;
  return { name: entry.name, state: normalizeFilterState(entry.state) };
}

function extractUniverses(value: unknown): SavedScreenerUniverse[] {
  if (!isRecord(value)) return [];
  return extractUniversesFromArray(value.screener);
}

function extractUniversesFromArray(value: unknown): SavedScreenerUniverse[] {
  if (!Array.isArray(value)) return [];
  const presets: SavedScreenerUniverse[] = [];
  for (const entry of value) {
    const universe = normalizeScreenerUniverse(entry);
    if (universe !== null) presets.push(universe);
  }
  return presets;
}

function extractFlags(value: unknown): Record<string, Flag> {
  if (!isRecord(value)) return {};
  const flags: Record<string, Flag> = {};
  const raw = value.flags;
  if (!isRecord(raw)) return flags;
  for (const symbol of Object.keys(raw)) {
    const flag = raw[symbol];
    if (typeof flag === "string" && (FLAG_VALUES as readonly string[]).includes(flag)) {
      flags[symbol] = flag as Flag;
    }
  }
  return flags;
}

/**
 * Screener view preferences. Reads `personal-view.v1`; if it holds no
 * usable data, migrates legacy screener preference keys into it on this
 * read (legacy keys stay untouched) and returns the migrated values.
 * Migration only happens while the current key is absent; a present
 * document - valid or malformed - is authoritative and never re-imports
 * legacy. Malformed storage fails closed to {}.
 */
export function readScreenerView(): ScreenerViewPreferences {
  const result = readDocument(PERSONAL_DOC_KEYS.view, extractViewData);
  if (result.kind === "valid") return result.data;
  if (result.kind === "malformed") return {};
  return migrateLegacyScreenerView();
}

/** Merges the given fields into `personal-view.v1`. Never writes legacy keys. */
export function writeScreenerView(next: ScreenerViewPreferences): void {
  const current = readDocument(PERSONAL_DOC_KEYS.view, extractViewData);
  const merged: ScreenerViewPreferences = { ...(current.kind === "valid" ? current.data : {}), ...next };
  if (Object.keys(merged).length === 0) return;
  writeDocument(PERSONAL_DOC_KEYS.view, { screener: merged });
}

function migrateLegacyScreenerView(): ScreenerViewPreferences {
  const prefs: ScreenerViewPreferences = {};
  const rawPreset = readRaw(LEGACY_SCREENER_KEYS.preset);
  if (rawPreset !== null) {
    const preset = coerceColumnPreset(rawPreset);
    if (preset !== null) prefs.columnPreset = preset;
  }
  const rawDensity = readRaw(LEGACY_SCREENER_KEYS.density);
  if (rawDensity !== null && isDensity(rawDensity)) prefs.density = rawDensity;
  const rawViewMode = readRaw(LEGACY_SCREENER_KEYS.viewMode);
  if (rawViewMode !== null && isViewMode(rawViewMode)) prefs.viewMode = rawViewMode;
  if (Object.keys(prefs).length === 0) return {};
  writeDocument(PERSONAL_DOC_KEYS.view, { screener: prefs });
  return prefs;
}

/**
 * Saved Screener filter presets as saved universes. Reads
 * `personal-universes.v1`; if empty, migrates the legacy
 * `screener-filter-presets` array into it on this read (legacy key
 * stays untouched). Migration only happens while the current key is
 * absent; a present document - valid (even with an empty screener list)
 * or malformed - is authoritative and never re-imports legacy.
 * Malformed storage yields [].
 */
export function readScreenerUniverses(): SavedScreenerUniverse[] {
  const result = readDocument(PERSONAL_DOC_KEYS.universes, extractUniverses);
  if (result.kind === "valid") return result.data;
  if (result.kind === "malformed") return [];
  const raw = readRaw(LEGACY_SCREENER_KEYS.filterPresets);
  if (raw === null) return [];
  const presets = extractUniversesFromArray(parseJson(raw));
  if (presets.length === 0) return [];
  writeDocument(PERSONAL_DOC_KEYS.universes, { screener: presets });
  return presets;
}

/** Writes saved Screener filter presets into `personal-universes.v1`. Never writes legacy keys. */
export function writeScreenerUniverses(presets: SavedScreenerUniverse[]): void {
  writeDocument(PERSONAL_DOC_KEYS.universes, { screener: presets });
}

/**
 * Per-symbol flag document (`personal-flags.v1`, WATCH | THESIS | RISK | VERIFY).
 * Defined this slice; no surface consumer is wired yet.
 */
export function readPersonalFlags(): Record<string, Flag> {
  const result = readDocument(PERSONAL_DOC_KEYS.flags, extractFlags);
  return result.kind === "valid" ? result.data : {};
}

export function writePersonalFlags(flags: Record<string, Flag>): void {
  writeDocument(PERSONAL_DOC_KEYS.flags, { flags });
}
