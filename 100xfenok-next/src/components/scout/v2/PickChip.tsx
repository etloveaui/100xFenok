"use client";

import { v2cx } from "@/components/dashboard/v2/types";
import type { Pick } from "./types";

const KIND_LABEL: Record<Pick["kind"], string> = {
  value: "가치",
  momentum: "모멘텀",
  institution: "월스트리트",
};

export default function PickChip({ pick }: { pick: Pick }) {
  return (
    <span className={v2cx("as-pick", `as-pick--${pick.kind}`)}>
      <span className="as-pick__kind">{KIND_LABEL[pick.kind]}</span>
      <span className="as-pick__ticker">{pick.ticker}</span>
      <span className="as-pick__name">{pick.name}</span>
      <span className="as-pick__note">{pick.note}</span>
    </span>
  );
}
