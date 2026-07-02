"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type CpTabItem = {
  id: string;
  label: ReactNode;
  panel: ReactNode;
  active?: boolean;
  disabled?: boolean;
};

type CpTabsProps = {
  items: CpTabItem[];
  ariaLabel: string;
  selectedId?: string;
  onSelect?: (id: string) => void;
};

export default function CpTabs({ items, ariaLabel, selectedId, onSelect }: CpTabsProps) {
  const defaultItem = items.find((item) => item.active && !item.disabled) ?? items.find((item) => !item.disabled);
  const [uncontrolledId, setUncontrolledId] = useState<string | undefined>(defaultItem?.id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeId = selectedId ?? uncontrolledId;
  const activeItem = items.find((item) => item.id === activeId) ?? defaultItem;

  const selectTab = (id: string) => {
    if (selectedId === undefined) {
      setUncontrolledId(id);
    }
    onSelect?.(id);
  };

  const focusTab = (id: string) => {
    tabRefs.current[id]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((item) => item.id === activeItem?.id);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % enabled.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabled.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const nextItem = enabled[nextIndex];
      selectTab(nextItem.id);
      focusTab(nextItem.id);
    }
  };

  return (
    <div className="cp-tabs">
      <div
        className="cp-tabs__list"
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => {
          const selected = item.id === activeItem?.id;
          return (
            <button
              key={item.id}
              id={`cp-tab-${item.id}`}
              type="button"
              className="cp-tabs__tab"
              role="tab"
              aria-selected={selected}
              aria-controls={`cp-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              onClick={() => selectTab(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => {
        const selected = item.id === activeItem?.id;
        return (
          <section
            key={item.id}
            id={`cp-panel-${item.id}`}
            className="cp-tabs__panel"
            role="tabpanel"
            aria-labelledby={`cp-tab-${item.id}`}
            hidden={!selected}
          >
            {item.panel}
          </section>
        );
      })}
    </div>
  );
}
