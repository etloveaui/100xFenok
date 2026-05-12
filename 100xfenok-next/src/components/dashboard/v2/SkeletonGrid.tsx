"use client";

import { v2cx } from "./types";

const Skel = () => (
  <div className="hp-tile">
    <div className="hp-tile__head">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <span className="hp-skel hp-skel--pill" style={{ width: 60, height: 12 }} />
        <span className="hp-skel hp-skel--line" style={{ width: "60%", height: 16 }} />
      </div>
      <span className="hp-skel hp-skel--pill" style={{ width: 70 }} />
    </div>
    <div
      className="hp-tile__body"
      style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <span className="hp-skel hp-skel--num" style={{ width: 120 }} />
      <span className="hp-skel hp-skel--line" style={{ width: "80%" }} />
      <span className="hp-skel hp-skel--line" style={{ width: "50%" }} />
    </div>
  </div>
);

export default function SkeletonGrid() {
  return (
    <div className={v2cx("hp-bento")}>
      <div className="hp-tile hp-tile--hero" style={{ minHeight: 260 }}>
        <div className="hp-tile__head">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <span className="hp-skel hp-skel--pill" style={{ width: 80 }} />
            <span className="hp-skel hp-skel--line" style={{ width: "40%", height: 22 }} />
          </div>
          <span className="hp-skel hp-skel--pill" style={{ width: 80 }} />
        </div>
        <div
          className="hp-tile__body"
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
          }}
        >
          <span className="hp-skel hp-skel--block" style={{ height: 110 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="hp-skel hp-skel--line" />
            <span className="hp-skel hp-skel--line" />
            <span className="hp-skel hp-skel--line" style={{ width: "70%" }} />
          </div>
        </div>
      </div>
      <div className="hp-tile hp-tile--wide">
        <Skel />
      </div>
      <Skel />
      <Skel />
      <Skel />
      <Skel />
      <Skel />
      <Skel />
      <Skel />
    </div>
  );
}
