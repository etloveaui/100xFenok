"use client";

import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";

export type MarketSectionKey = "valuation" | "regime" | "events" | "sectors";

const MARKET_SECTION_ITEMS: Array<{
  key: MarketSectionKey;
  href: string;
  label: string;
}> = [
  { key: "valuation", href: ROUTES.market, label: "밸류에이션" },
  { key: "regime", href: ROUTES.regime, label: "국면" },
  { key: "events", href: ROUTES.marketEvents, label: "이벤트" },
  { key: "sectors", href: ROUTES.sectors, label: "섹터" },
];

export default function MarketSectionNav({ active }: { active: MarketSectionKey }) {
  return (
    <nav className="data-shell-section-nav" aria-label="시장 섹션" data-market-section-nav>
      {MARKET_SECTION_ITEMS.map((item) => {
        const selected = item.key === active;
        return (
          <TransitionLink
            key={item.key}
            href={item.href}
            className={`data-shell-link ${selected ? "on" : ""}`}
            aria-current={selected ? "page" : undefined}
            data-market-section-link={item.key}
            style={{ minHeight: 44 }}
          >
            {item.label}
          </TransitionLink>
        );
      })}
    </nav>
  );
}
