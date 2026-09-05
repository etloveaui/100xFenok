import { ROUTE_TICKER_PATTERN } from "@/lib/ticker";

export const MAX_JOURNEY_CONTEXT_LENGTH = 2_048;
export const MAX_JOURNEY_SNAPSHOT_LENGTH = 262_144;
export const MAX_JOURNEY_SELECTED_TICKERS = 10_000;
export const MAX_JOURNEY_VISIBLE_INDEX = 100_000;
export const MAX_JOURNEY_SCROLL_Y = 100_000;

const JOURNEY_ORIGIN = "https://journey.invalid";
const JOURNEY_SNAPSHOT_PREFIX = "100xfenok:journey:screener:";
const JOURNEY_SOURCE_PATHS = new Set(["/screener", "/superinvestors"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface ScreenerJourneySnapshot {
  selectedTickers: string[];
  visibleIndex: number;
  compareTickers?: string[];
  discoverCard?: string;
  scrollY?: number;
}

export interface JourneyScrollSnapshot {
  scrollY: number;
  holdingsScrollTop?: number;
}

export interface JourneyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function normalizeSourcePath(pathname: string): string {
  if (pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function validateJourneyReturnTo(value: string | null | undefined, allowNested: boolean): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_JOURNEY_CONTEXT_LENGTH) return null;
  if (CONTROL_CHARACTERS.test(value) || value.includes("\\") || value.startsWith("//") || !value.startsWith("/")) return null;

  try {
    if (CONTROL_CHARACTERS.test(decodeURIComponent(value))) return null;
    const parsed = new URL(value, JOURNEY_ORIGIN);
    if (parsed.origin !== JOURNEY_ORIGIN || parsed.username || parsed.password || parsed.port) return null;
    if (!JOURNEY_SOURCE_PATHS.has(normalizeSourcePath(parsed.pathname))) return null;
    if (!allowNested && parsed.searchParams.has("returnTo")) return null;
    const nested = parsed.searchParams.get("returnTo");
    if (nested !== null && !validateJourneyReturnTo(nested, false)) return null;
    return `${normalizeSourcePath(parsed.pathname)}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/** Return a same-origin product context with only the approved source paths. */
export function journeyReturnTo(value: string | null | undefined): string | null {
  return validateJourneyReturnTo(value, true);
}

export function currentJourneyReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  return journeyReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

export function withJourneyReturnTo(path: string, returnTo: string | null | undefined): string {
  const safe = journeyReturnTo(returnTo);
  if (!safe) return path;
  const hashIndex = path.indexOf("#");
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  return `${base}${base.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(safe)}${hash}`;
}

function normalizeSnapshotTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return ROUTE_TICKER_PATTERN.test(normalized) ? normalized : null;
}

function normalizeSnapshot(snapshot: unknown): ScreenerJourneySnapshot | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["selectedTickers", "visibleIndex", "compareTickers", "discoverCard", "scrollY"].includes(key))
    || !Array.isArray(record.selectedTickers)
    || typeof record.visibleIndex !== "number"
    || !Number.isInteger(record.visibleIndex)
  ) return null;
  if (record.visibleIndex < 0 || record.visibleIndex > MAX_JOURNEY_VISIBLE_INDEX) return null;

  const selectedTickers: string[] = [];
  for (const value of record.selectedTickers) {
    const ticker = normalizeSnapshotTicker(value);
    if (!ticker) return null;
    if (selectedTickers.includes(ticker)) continue;
    selectedTickers.push(ticker);
    if (selectedTickers.length >= MAX_JOURNEY_SELECTED_TICKERS) break;
  }
  const compare = record.compareTickers;
  if (compare !== undefined && (!Array.isArray(compare) || compare.length > 4 || compare.some((ticker) => normalizeSnapshotTicker(ticker) === null))) return null;
  const card = record.discoverCard;
  if (card !== undefined && (typeof card !== "string" || !/^[a-z-]{1,64}$/.test(card))) return null;
  const y = record.scrollY;
  if (y !== undefined && (typeof y !== "number" || !Number.isInteger(y) || y < 0 || y > MAX_JOURNEY_SCROLL_Y)) return null;
  return {
    selectedTickers, visibleIndex: record.visibleIndex,
    ...(Array.isArray(compare) ? { compareTickers: compare.map((ticker) => normalizeSnapshotTicker(ticker)!) } : {}),
    ...(typeof card === "string" ? { discoverCard: card } : {}),
    ...(typeof y === "number" ? { scrollY: y } : {}),
  };
}

export function encodeScreenerJourneySnapshot(snapshot: unknown): string {
  const normalized = normalizeSnapshot(snapshot) ?? { selectedTickers: [], visibleIndex: 0 };
  return JSON.stringify(normalized);
}

export function decodeScreenerJourneySnapshot(value: string | null | undefined): ScreenerJourneySnapshot | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_JOURNEY_SNAPSHOT_LENGTH) return null;
  try {
    return normalizeSnapshot(JSON.parse(value));
  } catch {
    return null;
  }
}

export function journeySnapshotStorageKey(source: string | null | undefined): string | null {
  const safe = journeyReturnTo(source);
  return safe ? `${JOURNEY_SNAPSHOT_PREFIX}${encodeURIComponent(safe)}` : null;
}

function browserSessionStorage(): JourneyStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveScreenerJourneySnapshot(
  source: string | null | undefined,
  snapshot: unknown,
  storage: JourneyStorage | null = browserSessionStorage(),
): boolean {
  const key = journeySnapshotStorageKey(source);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, encodeScreenerJourneySnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function consumeScreenerJourneySnapshot(
  storage: JourneyStorage | null,
  source: string | null | undefined,
): ScreenerJourneySnapshot | null {
  const key = journeySnapshotStorageKey(source);
  if (!key || !storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  const decoded = decodeScreenerJourneySnapshot(raw);
  try {
    // Invalid and valid state are both one-shot; stale state must not be
    // resurrected by a later mount with the same exact source URL.
    storage.removeItem(key);
  } catch {
    // A read-only or failing storage still degrades to URL-only context.
  }
  return decoded;
}

export function readScreenerJourneySnapshot(source: string | null | undefined): ScreenerJourneySnapshot | null {
  const key = journeySnapshotStorageKey(source);
  const storage = browserSessionStorage();
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    const decoded = decodeScreenerJourneySnapshot(raw);
    if (raw !== null && decoded === null) storage.removeItem(key);
    return decoded;
  } catch {
    return null;
  }
}

export function clearScreenerJourneySnapshot(source: string | null | undefined): void {
  const key = journeySnapshotStorageKey(source);
  const storage = browserSessionStorage();
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage is optional; URL context remains usable.
  }
}

function normalizeScrollSnapshot(value: unknown): JourneyScrollSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "scrollY" && key !== "holdingsScrollTop")) return null;
  if (typeof record.scrollY !== "number" || !Number.isInteger(record.scrollY)) return null;
  if (record.scrollY < 0 || record.scrollY > MAX_JOURNEY_SCROLL_Y) return null;
  const top = record.holdingsScrollTop;
  if (top !== undefined && (typeof top !== "number" || !Number.isInteger(top) || top < 0 || top > MAX_JOURNEY_SCROLL_Y)) return null;
  return { scrollY: record.scrollY, ...(typeof top === "number" ? { holdingsScrollTop: top } : {}) };
}

export function encodeJourneyScrollSnapshot(snapshot: unknown): string {
  return JSON.stringify(normalizeScrollSnapshot(snapshot) ?? { scrollY: 0 });
}

export function decodeJourneyScrollSnapshot(value: string | null | undefined): JourneyScrollSnapshot | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_JOURNEY_SNAPSHOT_LENGTH) return null;
  try {
    return normalizeScrollSnapshot(JSON.parse(value));
  } catch {
    return null;
  }
}

export function saveJourneyScrollSnapshot(
  source: string | null | undefined,
  snapshot: unknown,
  storage: JourneyStorage | null = browserSessionStorage(),
): boolean {
  const key = journeySnapshotStorageKey(source);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, encodeJourneyScrollSnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function consumeJourneyScrollSnapshot(
  storage: JourneyStorage | null,
  source: string | null | undefined,
): JourneyScrollSnapshot | null {
  const key = journeySnapshotStorageKey(source);
  if (!key || !storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  const decoded = decodeJourneyScrollSnapshot(raw);
  try {
    storage.removeItem(key);
  } catch {
    // Storage is optional; URL context remains usable.
  }
  return decoded;
}

export function readJourneyScrollSnapshot(source: string | null | undefined): JourneyScrollSnapshot | null {
  const key = journeySnapshotStorageKey(source);
  const storage = browserSessionStorage();
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    const decoded = decodeJourneyScrollSnapshot(raw);
    if (raw !== null && decoded === null) storage.removeItem(key);
    return decoded;
  } catch {
    return null;
  }
}

export function clearJourneyScrollSnapshot(source: string | null | undefined): void {
  const key = journeySnapshotStorageKey(source);
  const storage = browserSessionStorage();
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage is optional; URL context remains usable.
  }
}
