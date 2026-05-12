"use client";

import type { V2DataStatus } from "./types";
import { v2cx } from "./types";

const BANNER_MAP: Record<
  Exclude<V2DataStatus, "live">,
  { cls: string; icon: string; text: string }
> = {
  loading: {
    cls: "hp-banner--loading",
    icon: "fa-sync-alt",
    text: "데이터를 확인하는 중입니다. 잠시만 기다려주세요.",
  },
  partial: {
    cls: "hp-banner--partial",
    icon: "fa-balance-scale",
    text: "일부 데이터가 늦거나 미수신 상태입니다. 정상 수신된 타일만 선명하게 표시합니다.",
  },
  offline: {
    cls: "hp-banner--offline",
    icon: "fa-satellite-dish",
    text: "오프라인 기준값입니다. 실제 시장과 다를 수 있습니다.",
  },
};

export default function StateBannerV2({ status }: { status: V2DataStatus }) {
  if (status === "live") return null;
  const s = BANNER_MAP[status];
  if (!s) return null;
  return (
    <div className={v2cx("hp-banner", s.cls)} role="status">
      <span className="hp-banner__icon" aria-hidden="true">
        <i className={`fas ${s.icon}`} />
      </span>
      <span>{s.text}</span>
    </div>
  );
}
