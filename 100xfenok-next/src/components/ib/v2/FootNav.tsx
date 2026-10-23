"use client";

import { v2cx } from "@/components/dashboard/v2/types";

const TABS = [
  { k: "home", i: "fa-home", l: "Home" },
  { k: "market", i: "fa-chart-line", l: "Market" },
  { k: "strategy", i: "fa-infinity", l: "Strategy" },
  { k: "tools", i: "fa-sliders-h", l: "Tools" },
  { k: "guide", i: "fa-book-open", l: "가이드" },
  { k: "me", i: "fa-question", l: "Me" },
] as const;

type Props = { active?: (typeof TABS)[number]["k"]; onGuide?: () => void; onStrategy?: () => void };

export default function FootNav({ active = "strategy", onGuide, onStrategy }: Props) {
  return (
    <nav className="ib-foot" aria-label="IB Helper 탭">
      {TABS.map((t) => (
        <button type="button" key={t.k} className={v2cx("ib-foot__t", active === t.k && "on")}
          onClick={t.k === "guide" ? onGuide : t.k === "strategy" ? onStrategy : undefined}
          aria-current={active === t.k ? "page" : undefined}>
          <i className={`fas ${t.i}`} aria-hidden="true" />
          <span>{t.l}</span>
        </button>
      ))}
    </nav>
  );
}
