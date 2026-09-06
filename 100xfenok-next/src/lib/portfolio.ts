\"use client\";

/**
 * Portfolio — device-local personalization (Wave D P-2).
 * localStorage only; no server, no cost. Schema versioned for later
 * KV-sync stage to migrate from.
 */

import { useSyncExternalStore } from "react";

const KEY = "fenok.portfolio.v1";

export interface Holding {
  ticker: string;
  shares: number;
  avg_cost: number;
}

export interface Portfolio {
  id: string;
  name: string;
  currency: "USD";
  cash: number;
  holdings: Holding[];
}

interface PortfolioDoc {
  version: 1;
  updated_at: string;
  portfolios: Portfolio[];
}

export type SavePortfoliosResult = { ok: true } | { ok: false; message: string };

let idCounter = 0;
export function newId(): string {
  return `p-${Date.now()}-${++idCounter}`;
}

export const SAMPLE_PORTFOLIO: Portfolio = {
  id: "sample",
  name: "예시 포트폴리오 (샘플)",
  currency: "USD",
  cash: 2500,
  holdings: [
    { ticker: "AAPL", shares: 12, avg_cost: 198.4 },
    { ticker: "NVDA", shares: 30, avg_cost: 96.1 },
    { ticker: "KORU", shares: 9, avg_cost: 392.57 },
    { ticker: "SCHD", shares: 85, avg_cost: 27.2 },
  ],
};

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): Portfolio[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const doc = JSON.parse(raw) as PortfolioDoc;
    return Array.isArray(doc.portfolios) ? doc.portfolios : [];
  } catch {
    return [];
  }
}

function write(portfolios: Portfolio[]): SavePortfoliosResult {
  if (typeof window === "undefined") {
    return { ok: false, message: "브라우저 환경에서만 저장할 수 있습니다." };
  }
  const doc: PortfolioDoc = {
    version: 1,
    portfolios,
    updated_at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(doc));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "저장 공간 부족 또는 브라우저 권한 제한";
    return {
      ok: false,
      message: `포트폴리오를 기기에 저장하지 못했습니다 (${detail}). 기존 보관 데이터는 유지됩니다.`,
    };
  }
  for (const cb of listeners) cb();
  return { ok: true };
}

export function savePortfolios(next: Portfolio[]): SavePortfoliosResult {
  return write(next);
}

// useSyncExternalStore needs a referentially-stable snapshot between changes
const EMPTY: Portfolio[] = [];
let snapshot: Portfolio[] | null = null;

function getSnapshot(): Portfolio[] {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function getServerSnapshot(): Portfolio[] {
  return EMPTY;
}

function invalidate() {
  snapshot = read();
}

function subscribe(onChange: () => void): () => void {
  const local: Listener = () => {
    invalidate();
    onChange();
  };
  listeners.add(local);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      invalidate();
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(local);
    window.removeEventListener("storage", onStorage);
  };
}

/** Reactive hook — updates across components and browser tabs. */
export function usePortfolios(): Portfolio[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Validates and parses imported portfolio text (JSON) in single-export, version 1 bundle,
 * or legacy named-map formats. Rejects unsupported or malformed documents in their entirety
 * without silent data loss or zero-coercion.
 */
export function parsePortfolioImport(
  text: string,
  createId: () => string = newId,
): Portfolio[] {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("백업 내용이 비어 있습니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 형식이 올바르지 않습니다. 내보낸 백업 내용을 그대로 붙여넣어 주세요.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("지원하지 않는 백업 루트 형식입니다 (객체여야 합니다).");
  }

  const root = parsed as Record<string, unknown>;
  if (root.version !== undefined && root.version !== 1) {
    throw new Error("지원하지 않는 백업 버전입니다.");
  }

  function parseHoldings(rawHoldings: unknown): Holding[] {
    if (!Array.isArray(rawHoldings)) {
      throw new Error("보유 종목 목록의 형식이 올바르지 않습니다.");
    }

    return rawHoldings.map((rawHolding: unknown, idx: number) => {
      if (typeof rawHolding !== "object" || rawHolding === null || Array.isArray(rawHolding)) {
        throw new Error(`보유 종목 데이터 형식이 올바르지 않습니다 [${idx}].`);
      }
      const h = rawHolding as Record<string, unknown>;

      if (typeof h.ticker !== "string") {
        throw new Error(`${idx + 1}번째 종목의 종목 코드가 올바르지 않습니다.`);
      }
      const ticker = h.ticker;
      if (!ticker.trim()) {
        throw new Error(`${idx + 1}번째 종목의 종목 코드가 비어 있습니다.`);
      }

      if (typeof h.shares !== "number" || !Number.isFinite(h.shares) || h.shares < 0) {
        throw new Error(`${idx + 1}번째 종목의 주식수는 0 이상의 유효한 숫자여야 합니다.`);
      }

      if (typeof h.avg_cost !== "number" || !Number.isFinite(h.avg_cost) || h.avg_cost < 0) {
        throw new Error(`${idx + 1}번째 종목의 평균 매입가는 0 이상의 유효한 숫자여야 합니다.`);
      }

      return {
        ticker,
        shares: h.shares,
        avg_cost: h.avg_cost,
      };
    });
  }

  // Format 1: Legacy named map { portfolios: { [name]: { currency?, cash?, holdings? } } }
  if (root.portfolios && typeof root.portfolios === "object" && !Array.isArray(root.portfolios)) {
    const entries = Object.entries(root.portfolios as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error("백업에 포트폴리오가 없습니다.");
    }
    return entries.map(([name, data]) => {
      if (!name || !name.trim()) {
        throw new Error("포트폴리오 이름이 비어 있습니다.");
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error(`포트폴리오 형식이 올바르지 않습니다: ${name}`);
      }
      const raw = data as Record<string, unknown>;

      // Legacy allows currency inference (defaults to USD). If present, must be USD.
      if (raw.currency !== undefined && raw.currency !== "USD") {
        throw new Error(`지원하지 않는 통화입니다: ${raw.currency} (USD만 지원).`);
      }

      // Legacy allows omitted cash (defaults to 0). If present, must be finite number >= 0.
      let cash = 0;
      if (raw.cash !== undefined) {
        if (typeof raw.cash !== "number" || !Number.isFinite(raw.cash) || raw.cash < 0) {
          throw new Error(`현금 잔고는 0 이상의 유효한 숫자여야 합니다 (${name}).`);
        }
        cash = raw.cash;
      }

      // Legacy allows omitted holdings (defaults to empty array). If present, must be array.
      let holdings: Holding[] = [];
      if (raw.holdings !== undefined) {
        holdings = parseHoldings(raw.holdings);
      }

      return {
        id: createId(),
        name,
        currency: "USD",
        cash,
        holdings,
      };
    });
  }

  function validateCompleteModernPortfolio(
    obj: unknown,
    contextLabel: string,
  ): Portfolio {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      throw new Error(`${contextLabel}: 포트폴리오 데이터 형식이 올바르지 않습니다.`);
    }
    const raw = obj as Record<string, unknown>;

    // Modern portfolios must explicitly declare a non-empty name
    if (typeof raw.name !== "string" || !raw.name.trim()) {
      throw new Error(`${contextLabel}: 포트폴리오 이름이 비어 있거나 올바르지 않습니다.`);
    }

    // Modern portfolios must explicitly declare currency as "USD"
    if (raw.currency !== "USD") {
      throw new Error(`${contextLabel}: 지원하는 통화는 USD입니다.`);
    }

    // Modern portfolios must explicitly provide finite nonnegative cash
    if (typeof raw.cash !== "number" || !Number.isFinite(raw.cash) || raw.cash < 0) {
      throw new Error(`${contextLabel}: 현금 잔고는 0 이상의 유효한 숫자여야 합니다.`);
    }

    // Modern portfolios must explicitly provide holdings array
    if (!Array.isArray(raw.holdings)) {
      throw new Error(`${contextLabel}: 보유 종목 목록의 형식이 올바르지 않습니다.`);
    }

    const holdings = parseHoldings(raw.holdings);

    return {
      id: createId(),
      name: raw.name,
      currency: "USD",
      cash: raw.cash,
      holdings,
    };
  }

  // Format 2: Version 1 bundle { version: 1, portfolios: Portfolio[] }
  if (root.version === 1) {
    if (!Array.isArray(root.portfolios) || root.portfolios.length === 0) {
      throw new Error("백업에 포트폴리오 목록이 없거나 비어 있습니다.");
    }
    return root.portfolios.map((item: unknown, idx: number) =>
      validateCompleteModernPortfolio(item, `포트폴리오 [${idx + 1}]`),
    );
  }

  // Format 3: Single Portfolio export { id?, name, currency, cash, holdings }
  if (Array.isArray(root.holdings)) {
    return [validateCompleteModernPortfolio(root, "단일 포트폴리오")];
  }

  throw new Error("지원하지 않는 백업 데이터 형식입니다.");
}
