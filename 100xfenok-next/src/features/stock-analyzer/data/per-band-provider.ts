"use client";

export interface PerBandRecord {
  current: number;
  min: number;
  avg: number | null;
  max: number;
}

export interface PerBandIndex {
  sourceDate: string | null;
  generatedAt: string | null;
  rows: Map<string, PerBandRecord>;
}

interface RawPerBandRecord {
  current?: unknown;
  min?: unknown;
  avg?: unknown;
  max?: unknown;
}

const PER_BAND_PATH = "/data/global-scouter/core/per_bands_index.json";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) ? text : null;
}

function normalizeRecord(value: unknown): PerBandRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as RawPerBandRecord;
  const current = finite(raw.current);
  const min = finite(raw.min);
  const max = finite(raw.max);
  if (current === null || min === null || max === null || min >= max) return null;
  const avg = finite(raw.avg);
  return { current, min, avg, max };
}

function normalizeDocument(value: unknown): PerBandIndex | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const sourceDate = dateValue(raw.source_date);
  const generatedAt = dateValue(raw.generated_at);
  const rows = new Map<string, PerBandRecord>();
  const data = raw.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [ticker, entry] of Object.entries(data)) {
      const normalizedTicker = ticker.trim().toUpperCase();
      const normalized = normalizeRecord(entry);
      if (normalizedTicker && normalized) rows.set(normalizedTicker, normalized);
    }
  }
  return { sourceDate, generatedAt, rows };
}

let cachedIndex: PerBandIndex | null = null;
let cachedPromise: Promise<PerBandIndex | null> | null = null;

/** Small public PER feed; one cache and one in-flight request per browser. */
export function loadPerBandIndex(): Promise<PerBandIndex | null> {
  if (cachedIndex) return Promise.resolve(cachedIndex);
  if (cachedPromise) return cachedPromise;
  cachedPromise = fetch(PER_BAND_PATH, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      const normalized = normalizeDocument(payload);
      if (normalized) cachedIndex = normalized;
      cachedPromise = null;
      return normalized;
    })
    .catch(() => {
      cachedPromise = null;
      return null;
    });
  return cachedPromise;
}
