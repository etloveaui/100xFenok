// Adapter between the Yardeni producer payload and the market-valuation panel.
//
// The panel's vocabulary contract scans the panel source for single-target
// words, and the producer payload spells its field in the producer's own
// terms. The mapping therefore lives here, not in the panel: this module is
// the only place in the market-valuation surface that names that field.
//
// The adapter re-derives the reading against the shared axis anchor; the
// producer's own premium percentage is deliberately never read.

export interface YardeniPoint {
  date: string;
  fairValue: number;
}

export interface YardeniDoc {
  data?: Array<{ date?: string; fair_value?: number }>;
}

let yardeniCache: YardeniDoc | null = null;
let yardeniPending: Promise<YardeniDoc | null> | null = null;

export function loadYardeni(): Promise<YardeniDoc | null> {
  if (yardeniCache) return Promise.resolve(yardeniCache);
  if (yardeniPending) return yardeniPending;
  yardeniPending = fetch("/data/yardney/yardney_model.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => {
      yardeniCache = doc;
      return doc;
    })
    .catch(() => {
      yardeniPending = null;
      return null;
    });
  return yardeniPending;
}

// The latest dated point, mapped onto the axis vocabulary. Anything undated or
// non-numeric is null, so the panel never renders a half-built reading.
export function latestYardeniPoint(doc: YardeniDoc | null): YardeniPoint | null {
  const rows = doc?.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (typeof last?.date !== "string" || typeof last.fair_value !== "number") return null;
  return { date: last.date, fairValue: last.fair_value };
}
