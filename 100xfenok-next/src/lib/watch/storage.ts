"use client";

import { useCallback, useEffect, useState } from "react";
import type { Alert, Pin, Watch, WatchStorage } from "./types";

const STORAGE_KEY = "fenok_watch_v3";
const DEFAULT_STATE: WatchStorage = { pins: [], watches: [], alerts: [] };

function readStorage(): WatchStorage {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<WatchStorage>;
    return {
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
      watches: Array.isArray(parsed.watches) ? parsed.watches : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeStorage(next: WatchStorage) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota or privacy mode — silently drop */
  }
}

export function useWatchStorage() {
  // Lazy initializer avoids the "setState in effect" anti-pattern: the
  // first paint already reflects localStorage on the client. SSR returns
  // DEFAULT_STATE; hydration matches because the component is client-only.
  const [state, setState] = useState<WatchStorage>(() => readStorage());
  const hydrated = true;

  useEffect(() => {
    writeStorage(state);
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
    togglePin,
    addWatch,
    removeWatch,
    pushAlerts,
    markAllRead,
  };
}

export const __unused_marker = "hydrated-flag-kept-for-api-compat";

