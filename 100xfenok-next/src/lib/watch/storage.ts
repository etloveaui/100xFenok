"use client";

import { useCallback, useEffect, useState } from "react";
import { metricByKey } from "./metrics";
import type { Alert, Pin, Watch, WatchStorage, WatchableMetric } from "./types";

const STORAGE_KEY = "fenok_watch_v3";
const DEFAULT_STATE: WatchStorage = { pins: [], watches: [], alerts: [] };

/** Per-element validation: rejects schema-drift entries so a stale
 *  localStorage payload from an older release can't poison the runtime.
 *  Audit fix (type-design-analyzer + silent-failure-hunter, 2026-05-12). */
const VALID_METRICS = new Set<WatchableMetric>(
  // populated dynamically from metricByKey() so a future METRIC_DEFS
  // expansion doesn't drift from this validator.
  (
    ["VIX", "FG", "SOFR", "HY", "SPY", "QQQ", "US10Y", "BTC", "CRYPTOFG"] as const
  ).filter((k) => metricByKey(k) != null),
);

function isWatch(x: unknown): x is Watch {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<Watch>;
  return (
    typeof r.id === "string" &&
    typeof r.metric === "string" &&
    VALID_METRICS.has(r.metric as WatchableMetric) &&
    typeof r.threshold === "number" &&
    Number.isFinite(r.threshold) &&
    typeof r.createdAt === "string"
  );
}
function isPin(x: unknown): x is Pin {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<Pin>;
  return typeof r.id === "string" && VALID_METRICS.has(r.id as WatchableMetric);
}
function isAlert(x: unknown): x is Alert {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<Alert>;
  return (
    typeof r.id === "string" &&
    typeof r.watchId === "string" &&
    typeof r.metric === "string" &&
    typeof r.observed === "number" &&
    typeof r.firedAt === "string"
  );
}

function readStorage(): WatchStorage {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<WatchStorage>;
    return {
      pins: Array.isArray(parsed.pins) ? parsed.pins.filter(isPin) : [],
      watches: Array.isArray(parsed.watches)
        ? parsed.watches.filter(isWatch)
        : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.filter(isAlert) : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

/** Returns `true` on success; `false` if the write failed (quota, privacy
 *  mode, sandboxed iframe). Caller can surface this in the UI. Audit fix
 *  (silent-failure-hunter, 2026-05-12). */
function writeStorage(next: WatchStorage): boolean {
  if (typeof window === "undefined") return true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function useWatchStorage() {
  // Lazy initializer avoids the "setState in effect" anti-pattern: the
  // first paint already reflects localStorage on the client. SSR returns
  // DEFAULT_STATE; hydration matches because the component is client-only.
  const [state, setState] = useState<WatchStorage>(() => readStorage());
  const [storageError, setStorageError] = useState(false);
  const hydrated = true;

  useEffect(() => {
    const ok = writeStorage(state);
    // Only flip the error flag *to* true. Once a write succeeds again the
    // banner clears automatically. eslint-disable required: this is a
    // deliberate external-store sync (localStorage outcome flowing back
    // into UI), not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStorageError(!ok);
  }, [state]);

  const togglePin = useCallback((pin: Pin) => {
    setState((prev) => {
      const has = prev.pins.find((p) => p.id === pin.id);
      return {
        ...prev,
        pins: has
          ? prev.pins.filter((p) => p.id !== pin.id)
          : [...prev.pins, pin],
      };
    });
  }, []);

  const addWatch = useCallback((watch: Watch) => {
    setState((prev) => ({ ...prev, watches: [...prev.watches, watch] }));
  }, []);

  const removeWatch = useCallback((watchId: string) => {
    setState((prev) => ({
      ...prev,
      watches: prev.watches.filter((w) => w.id !== watchId),
    }));
  }, []);

  const pushAlerts = useCallback((next: Alert[]) => {
    if (next.length === 0) return;
    setState((prev) => ({ ...prev, alerts: [...next, ...prev.alerts].slice(0, 50) }));
  }, []);

  const markAllRead = useCallback(() => {
    setState((prev) => ({
      ...prev,
      alerts: prev.alerts.map((a) => ({ ...a, read: true })),
    }));
  }, []);

  return {
    pins: state.pins,
    watches: state.watches,
    alerts: state.alerts,
    hydrated,
    storageError,
    togglePin,
    addWatch,
    removeWatch,
    pushAlerts,
    markAllRead,
  };
}

