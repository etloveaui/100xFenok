"use client";

import { v2cx, type V2SegmentFilter } from "./types";

const SEGMENTS: V2SegmentFilter[] = ["ALL", "EQUITY", "MACRO", "CRYPTO"];

export default function SegmentFilter({
  value,
  onChange,
}: {
  value: V2SegmentFilter;
  onChange: (next: V2SegmentFilter) => void;
}) {
  return (
    <div className="hp-seg" role="tablist" aria-label="세그먼트 필터">
      {SEGMENTS.map((segment) => (
        <button
          key={segment}
          type="button"
          role="tab"
          aria-selected={value === segment}
          className={v2cx("hp-seg__btn", value === segment && "is-active")}
          onClick={() => onChange(segment)}
        >
          {segment}
        </button>
      ))}
    </div>
  );
}
