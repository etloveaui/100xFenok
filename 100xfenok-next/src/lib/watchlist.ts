"use client";

/**
 * Watchlist — device-local personalization (Wave C P-1).
 * localStorage only; no server, no cost. Schema versioned for the later
 * KV-sync stage (P-3) to migrate from.
 */

import { useSyncExternalStore } from "react";
import * as personalStore from "@/lib/personal/personalStore";

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
  const doc = personalStore.read<WatchlistDoc>("watchlist");
  return doc && Array.isArray(doc.tickers) ? doc.tickers.slice(0, MAX_TICKERS) : [];
}

function write(tickers: string[]) {
  const doc: WatchlistDoc = {
    version: 1,
    tickers: tickers.slice(0, MAX_TICKERS),
    updated_at: new Date().toISOString(),
  };
  personalStore.write("watchlist", doc);
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
  const unsubStore = personalStore.subscribe("watchlist", () => {
    invalidate();
    onChange();
  });
  return () => {
    listeners.delete(local);
    unsubStore();
  };
}

/** Reactive hook — updates across components and browser tabs. */
export function useWatchlist(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
