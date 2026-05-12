"use client";

import { forwardRef } from "react";
import { v2cx } from "@/components/dashboard/v2/types";
import Sparkline from "./Sparkline";
import type { WrapAnchor } from "./types";

type Props = {
  anchors: WrapAnchor[];
  activeId: number | null;
  registerRef: (id: number, node: HTMLDivElement | null) => void;
};

const ToneDelta = forwardRef<HTMLSpanElement, { tone: WrapAnchor["tone"]; text: string }>(
  function ToneDelta({ tone, text }, ref) {
    return (
      <span
        ref={ref}
        className={v2cx("mw-anchor-delta", `mw-anchor-delta-${tone}`)}
      >
        {text}
      </span>
    );
  },
);

export default function AnchorRail({ anchors, activeId, registerRef }: Props) {
  return (
    <aside className="mw-rail">
      <div className="mw-rail-head">
        <span className="kicker">오늘의 앵커</span>
        <span className="mono mw-rail-count">{anchors.length} / 7</span>
      </div>
      <div className="mw-rail-list">
        {anchors.map((anchor) => (
          <div
            key={anchor.id}
            ref={(node) => registerRef(anchor.id, node)}
            className={v2cx(
              "mw-anchor-card",
              activeId === anchor.id && "is-flash",
            )}
            data-anchor-id={anchor.id}
          >
            <div className="mw-anchor-head">
              <span className="mw-anchor-id">{String(anchor.id).padStart(2, "0")}</span>
              <span className="mw-anchor-kicker">{anchor.kicker}</span>
              <span className="mono mw-anchor-sym">{anchor.sym}</span>
            </div>
            <div className="mw-anchor-value-row">
              <span className="mw-anchor-value">{anchor.value}</span>
              <Sparkline points={anchor.spark} tone={anchor.tone} width={88} height={28} />
            </div>
            <ToneDelta tone={anchor.tone} text={anchor.delta} />
            <p className="mw-anchor-meta">{anchor.meta}</p>
          </div>
        ))}
      </div>
      <div className="mw-rail-foot">
        <span className="kicker">FRESHNESS</span>
        <span className="mw-live-dot" />
        <span className="mono mw-live-text">LIVE · 15s</span>
      </div>
    </aside>
  );
}
