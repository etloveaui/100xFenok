"use client";

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

function write(portfolios: Portfolio[]) {
  const doc: PortfolioDoc = {
    version: 1,
    portfolios,
    updated_at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    // storage full/blocked — keep in-memory state only
  }
  for (const cb of listeners) cb();
}

export function savePortfolios(next: Portfolio[]) {
  write(next);
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
