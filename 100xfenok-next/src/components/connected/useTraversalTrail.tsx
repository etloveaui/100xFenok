"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface TraversalTrailEntity {
  id: string;
  label?: string;
  kind?: string;
  href?: string;
}

export interface TraversalTrailItem extends TraversalTrailEntity {
  at: number;
}

interface TraversalTrailContextValue {
  trail: TraversalTrailItem[];
  pushTrail: (entity: TraversalTrailEntity) => void;
  resetTrail: (entity?: TraversalTrailEntity) => void;
  popTrailTo: (index: number) => void;
  clearTrail: () => void;
}

const TraversalTrailContext = createContext<TraversalTrailContextValue | null>(null);
const MAX_TRAIL_ITEMS = 12;
export const VISIBLE_TRAVERSAL_TRAIL_ITEMS = 3;

export function splitTraversalTrail(
  trail: TraversalTrailItem[],
  visibleCount = VISIBLE_TRAVERSAL_TRAIL_ITEMS,
) {
  const hiddenCount = Math.max(0, trail.length - visibleCount);
  return {
    hiddenItems: trail.slice(0, hiddenCount),
    visibleItems: trail.slice(hiddenCount).map((item, offset) => ({
      item,
      index: hiddenCount + offset,
    })),
  };
}

function toTrailItem(entity: TraversalTrailEntity): TraversalTrailItem | null {
  const id = entity.id.trim();
  if (!id) return null;
  return {
    ...entity,
    id,
    label: entity.label?.trim() || id,
    at: Date.now(),
  };
}

function trailingDuplicateIndex(trail: TraversalTrailItem[], id: string): number {
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    if (trail[i]?.id === id) return i;
  }
  return -1;
}

export function TraversalTrailProvider({
  children,
  initialTrail = [],
}: {
  children: ReactNode;
  initialTrail?: TraversalTrailEntity[];
}) {
  const [trail, setTrail] = useState<TraversalTrailItem[]>(() => (
    initialTrail
      .map(toTrailItem)
      .filter((item): item is TraversalTrailItem => item !== null)
      .slice(-MAX_TRAIL_ITEMS)
  ));

  const pushTrail = useCallback((entity: TraversalTrailEntity) => {
    const item = toTrailItem(entity);
    if (!item) return;
    setTrail((current) => {
      const existingIndex = trailingDuplicateIndex(current, item.id);
      if (existingIndex === current.length - 1) {
        return [...current.slice(0, -1), item];
      }
      const next = existingIndex >= 0 ? [...current.slice(0, existingIndex), item] : [...current, item];
      return next.slice(-MAX_TRAIL_ITEMS);
    });
  }, []);

  const resetTrail = useCallback((entity?: TraversalTrailEntity) => {
    const item = entity ? toTrailItem(entity) : null;
    setTrail(item ? [item] : []);
  }, []);

  const popTrailTo = useCallback((index: number) => {
    setTrail((current) => current.slice(0, Math.max(0, index + 1)));
  }, []);

  const clearTrail = useCallback(() => {
    setTrail([]);
  }, []);

  const value = useMemo<TraversalTrailContextValue>(() => ({
    trail,
    pushTrail,
    resetTrail,
    popTrailTo,
    clearTrail,
  }), [clearTrail, popTrailTo, pushTrail, resetTrail, trail]);

  return (
    <TraversalTrailContext.Provider value={value}>
      {children}
    </TraversalTrailContext.Provider>
  );
}

export function useTraversalTrail(): TraversalTrailContextValue {
  const context = useContext(TraversalTrailContext);
  if (!context) {
    throw new Error("useTraversalTrail must be used within TraversalTrailProvider");
  }
  return context;
}
