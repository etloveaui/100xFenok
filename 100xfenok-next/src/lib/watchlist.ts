"use client";

/**
 * Watchlist — device-local personalization (Wave C P-1).
 * localStorage only; no server, no cost. Schema versioned for the later
 * KV-sync stage (P-3) to migrate from.
 */

import { useSyncExternalStore } from "react";

const KEY = "fenok.watchlist.v1";
const MAX_TICKERS = 100;

interface WatchlistDoc {
  version: 1;
  tickers: string[];
  updated_at: string;
}

type Listener = (tickers: string[]) => void;
const listeners = new Set<Listener>();

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const doc = JSON.parse(raw) as WatchlistDoc;
    return Array.isArray(doc.tickers) ? doc.tickers.slice(0, MAX_TICKERS) : [];
  } catch {
    return [];
  }
}

function write(tickers: string[]) {
  const doc: WatchlistDoc = {
    version: 1,
    tickers: tickers.slice(0, MAX_TICKERS),
    updated_at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    // storage full/blocked — keep in-memory state only
  }
  for (const cb of listeners) cb(doc.tickers);
}

export function getWatchlist(): string[] {
  return read();
}

export function isWatched(ticker: string): boolean {
  return read().includes(ticker.toUpperCase());
}

export function toggleWatch(ticker: string): boolean {
  const t = ticker.toUpperCase();
  const cur = read();
  const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
  write(next);
  return next.includes(t);
}

// useSyncExternalStore needs a referentially-stable snapshot between changes
const EMPTY: string[] = [];
let snapshot: string[] | null = null;

function getSnapshot(): string[] {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

function invalidate() {
  snapshot = read();
}

function subscribe(onChange: () => void): () => void {
  const local: Listener = () => { invalidate(); onChange(); };
  listeners.add(local);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { invalidate(); onChange(); }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(local);
    window.removeEventListener("storage", onStorage);
  };
}

/** Reactive hook — updates across components and browser tabs. */
export function useWatchlist(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
