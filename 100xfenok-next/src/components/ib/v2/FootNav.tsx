"use client";

import { v2cx } from "@/components/dashboard/v2/types";

const TABS = [
  { k: "home", i: "fa-home", l: "Home" },
  { k: "market", i: "fa-chart-line", l: "Market" },
  { k: "strategy", i: "fa-infinity", l: "Strategy" },
  { k: "tools", i: "fa-sliders-h", l: "Tools" },
  { k: "me", i: "fa-question", l: "Me" },
] as const;

type Props = { active?: (typeof TABS)[number]["k"] };

export default function FootNav({ active = "strategy" }: Props) {
  return (
    <nav className="ib-foot" aria-label="IB Helper 탭">
      {TABS.map((t) => (
        <div key={t.k} className={v2cx("ib-foot__t", active === t.k && "on")}>
          <i className={`fas ${t.i}`} aria-hidden="true" />
          <span>{t.l}</span>
        </div>
      ))}
    </nav>
  );
}
