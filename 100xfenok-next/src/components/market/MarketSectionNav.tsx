"use client";

import TransitionLink from "@/components/TransitionLink";

export type MarketSectionKey = "valuation" | "regime" | "events" | "sectors";

const MARKET_SECTION_ITEMS: Array<{
  key: MarketSectionKey;
  href: string;
  label: string;
}> = [
  { key: "valuation", href: "/market-valuation", label: "밸류에이션" },
  { key: "regime", href: "/regime", label: "국면" },
  { key: "events", href: "/market/events", label: "이벤트" },
  { key: "sectors", href: "/sectors", label: "섹터" },
];

export default function MarketSectionNav({ active }: { active: MarketSectionKey }) {
  return (
    <nav className="data-shell-section-nav" aria-label="시장 섹션">
      {MARKET_SECTION_ITEMS.map((item) => {
        const selected = item.key === active;
        return (
          <TransitionLink
            key={item.key}
            href={item.href}
            className={`data-shell-link ${selected ? "on" : ""}`}
            aria-current={selected ? "page" : undefined}
          >
            {item.label}
          </TransitionLink>
        );
      })}
    </nav>
  );
}
