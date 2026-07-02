import type { ReactNode } from "react";

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
};

export default function CpTabs({ items, ariaLabel }: CpTabsProps) {
  const activeItem = items.find((item) => item.active && !item.disabled) ?? items.find((item) => !item.disabled);

  return (
    <div className="cp-tabs">
      <div className="cp-tabs__list" role="tablist" aria-label={ariaLabel}>
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
