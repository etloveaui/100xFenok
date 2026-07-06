// Chart-free data loaders for the superinvestors portfolio views + factor
// exposures. Split out of PortfolioCharts.tsx so client components (e.g.
// InsightsTab) can fetch this data without statically importing chart.js into
// the Worker/SSR bundle.

import type {
  FactorExposureRecord,
  FactorExposuresSummaryData,
  PortfolioViewsData,
} from "@/lib/superinvestors/types";

// ---------------------------------------------------------------------------
// Module-level portfolio views cache
// ---------------------------------------------------------------------------

let pvCache: PortfolioViewsData | null = null;
let pvPromise: Promise<PortfolioViewsData | null> | null = null;
let factorCache: FactorExposuresSummaryData | null = null;
let factorPromise: Promise<FactorExposuresSummaryData | null> | null = null;

export function loadPortfolioViews(): Promise<PortfolioViewsData | null> {
  if (pvCache) return Promise.resolve(pvCache);
  if (pvPromise) return pvPromise;
  pvPromise = fetch("/data/sec-13f/analytics/portfolio_views.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<PortfolioViewsData>;
    })
    .then((data) => {
      pvCache = data;
      return data;
    })
    .catch(() => {
      pvPromise = null;
      return null;
    });
  return pvPromise;
}

type RawFactorExposuresSummary = Omit<FactorExposuresSummaryData, "rows"> & {
  rows?: Array<Record<string, unknown> | unknown[]>;
};

function readField(row: Record<string, unknown> | unknown[], fields: string[], key: string): unknown {
  if (Array.isArray(row)) {
    const index = fields.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  }
  return row[key];
}

function factorString(row: Record<string, unknown> | unknown[], fields: string[], key: string): string | null {
  const value = readField(row, fields, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function factorNumber(row: Record<string, unknown> | unknown[], fields: string[], key: string): number | null {
  const value = readField(row, fields, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeFactorExposureRecord(
  row: Record<string, unknown> | unknown[],
  fields: string[],
): FactorExposureRecord | null {
  const investorId = factorString(row, fields, "investorId");
  const name = factorString(row, fields, "name");
  if (!investorId || !name) return null;
  return {
    investorId,
    name,
    asOf: factorString(row, fields, "asOf"),
    confidence: factorString(row, fields, "confidence"),
    coverageRatio: factorNumber(row, fields, "coverageRatio"),
    observationCount: factorNumber(row, fields, "observationCount"),
    rSquared: factorNumber(row, fields, "rSquared"),
    marketBeta: factorNumber(row, fields, "marketBeta"),
    sizeBeta: factorNumber(row, fields, "sizeBeta"),
    valueBeta: factorNumber(row, fields, "valueBeta"),
    profitabilityBeta: factorNumber(row, fields, "profitabilityBeta"),
    investmentBeta: factorNumber(row, fields, "investmentBeta"),
    momentumBeta: factorNumber(row, fields, "momentumBeta"),
    marketScore: factorNumber(row, fields, "marketScore"),
    sizeScore: factorNumber(row, fields, "sizeScore"),
    valueScore: factorNumber(row, fields, "valueScore"),
    profitabilityScore: factorNumber(row, fields, "profitabilityScore"),
    investmentScore: factorNumber(row, fields, "investmentScore"),
    momentumScore: factorNumber(row, fields, "momentumScore"),
    tiltStrengthScore: factorNumber(row, fields, "tiltStrengthScore"),
  };
}

export function loadFactorExposuresSummary(): Promise<FactorExposuresSummaryData | null> {
  if (factorCache) return Promise.resolve(factorCache);
  if (factorPromise) return factorPromise;
  factorPromise = fetch("/data/sec-13f/analytics/factor_exposures_summary.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<RawFactorExposuresSummary>;
    })
    .then((payload) => {
      const fields = Array.isArray(payload.fields) ? payload.fields : [];
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      factorCache = {
        ...payload,
        fields,
        rows: rows
          .map((row) => normalizeFactorExposureRecord(row, fields))
          .filter((row): row is FactorExposureRecord => Boolean(row)),
      };
      return factorCache;
    })
    .catch(() => {
      factorPromise = null;
      return null;
    });
  return factorPromise;
}
