"use client";

import { v2cx } from "@/components/dashboard/v2/types";

type Props = { tone?: "ok" | "warn" | "bad"; label?: string };

export default function Fresh({ tone = "ok", label = "Live · 15m" }: Props) {
  return (
    <span
      className={v2cx(
        "ib-fresh",
        tone === "warn" && "ib-fresh--warn",
        tone === "bad" && "ib-fresh--bad",
      )}
    >
      <span className="ib-fresh__dot" />
      {label}
    </span>
  );
}
