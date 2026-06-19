"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  tabId?: string;
  panelId?: string;
  disabled?: boolean;
}

interface TabsProps<T extends string, I extends TabItem<T> = TabItem<T>> {
  items: I[];
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  idBase?: string;
  activationMode?: "automatic" | "manual";
  orientation?: "horizontal" | "vertical";
  className?: string;
  getTabClassName?: (item: I, selected: boolean) => string | undefined;
  renderLabel?: (item: I, selected: boolean) => ReactNode;
}

export function useTabsBaseId(prefix: string): string {
  const generatedId = useId();
  return useMemo(() => `${prefix}-${generatedId.replace(/:/g, "")}`, [generatedId, prefix]);
}

export function getTabId<T extends string>(baseId: string, item: TabItem<T>): string {
  return item.tabId ?? `${baseId}-tab-${item.id}`;
}

export function getPanelId<T extends string>(baseId: string, item: TabItem<T>): string {
  return item.panelId ?? `${baseId}-panel-${item.id}`;
}

export default function Tabs<T extends string, I extends TabItem<T> = TabItem<T>>({
  items,
  value,
  onValueChange,
  ariaLabel,
  idBase,
  activationMode = "automatic",
  orientation = "horizontal",
  className,
  getTabClassName,
  renderLabel,
}: TabsProps<T, I>) {
  const generatedId = useId();
  const baseId = useMemo(() => idBase ?? `tabs-${generatedId.replace(/:/g, "")}`, [generatedId, idBase]);
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  const [focusedValue, setFocusedValue] = useState<T>(value);

  useEffect(() => {
    setFocusedValue(value);
  }, [value]);

  function moveTo(currentIndex: number, delta: number) {
    const enabledItems = items.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;
    const fallbackIndex = enabledItems.findIndex((item) => item.id === value);
    const baseIndex = currentIndex >= 0 ? currentIndex : Math.max(fallbackIndex, 0);
    const nextIndex = delta === 0 ? baseIndex : baseIndex + delta;
    const normalizedIndex = (nextIndex + enabledItems.length) % enabledItems.length;
    const nextItem = enabledItems[normalizedIndex] ?? enabledItems[0];
    if (!nextItem) return;
    setFocusedValue(nextItem.id);
    if (activationMode === "automatic") onValueChange(nextItem.id);
    requestAnimationFrame(() => {
      tabRefs.current.get(nextItem.id)?.focus();
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const enabledItems = items.filter((item) => !item.disabled);
    const currentEnabledIndex = enabledItems.findIndex((item) => item.id === items[index]?.id);
    if ((orientation === "horizontal" && event.key === "ArrowRight") || (orientation === "vertical" && event.key === "ArrowDown")) {
      event.preventDefault();
      moveTo(currentEnabledIndex, 1);
    } else if ((orientation === "horizontal" && event.key === "ArrowLeft") || (orientation === "vertical" && event.key === "ArrowUp")) {
      event.preventDefault();
      moveTo(currentEnabledIndex, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(enabledItems.length - 1, 0);
    } else if ((event.key === "Enter" || event.key === " ") && activationMode === "manual") {
      event.preventDefault();
      const item = items[index];
      if (item && !item.disabled) onValueChange(item.id);
    }
  }

  return (
    <div className={className} role="tablist" aria-label={ariaLabel} aria-orientation={orientation}>
      {items.map((item, index) => {
        const selected = item.id === value;
        const focusable = item.id === focusedValue || (selected && !items.some((candidate) => candidate.id === focusedValue));
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) tabRefs.current.set(item.id, node);
              else tabRefs.current.delete(item.id);
            }}
            id={getTabId(baseId, item)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={getPanelId(baseId, item)}
            tabIndex={focusable && !item.disabled ? 0 : -1}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              setFocusedValue(item.id);
              onValueChange(item.id);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={getTabClassName?.(item, selected)}
          >
            {renderLabel ? renderLabel(item, selected) : item.label}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps<T extends string> {
  item: TabItem<T>;
  active: boolean;
  idBase: string;
  className?: string;
  children: ReactNode;
}

export function TabPanel<T extends string>({ item, active, idBase, className, children }: TabPanelProps<T>) {
  return (
    <div
      id={getPanelId(idBase, item)}
      role="tabpanel"
      aria-labelledby={getTabId(idBase, item)}
      hidden={!active}
      className={className}
    >
      {active ? children : null}
    </div>
  );
}
