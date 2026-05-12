"use client";

import type { V2SegmentFilter } from "./types";
import SegmentFilter from "./SegmentFilter";

export default function PageHeaderV2({
  filter,
  onFilterChange,
}: {
  filter: V2SegmentFilter;
  onFilterChange: (next: V2SegmentFilter) => void;
}) {
  return (
    <div className="hp-page__head">
      <div>
        <h1 className="hp-page__title">오늘의 시장 판정</h1>
        <div className="hp-page__sub">혼합 기준 · 15m delayed · 방금 업데이트</div>
      </div>
      <SegmentFilter value={filter} onChange={onFilterChange} />
    </div>
  );
}
