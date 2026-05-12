"use client";

import { v2cx } from "@/components/dashboard/v2/types";

const FEATURED = ["TQQQ", "SOXL"] as const;
const SECONDARY = ["SPYU", "NVDA", "AAPL"] as const;

export default function ZeroState() {
  return (
    <div className="ib-zero">
      <div className="ib-zero__kick">Get started · 무한매수법</div>
      <h2>두 종목으로 DCA 시작하기</h2>
      <p>
        변동성이 다른 두 종목을 동시에 굴리면 평단·현금 흐름이 더 안정적입니다.
        추천 시드 5종목 중 선택:
      </p>
      <div className="ib-zero__chips">
        {FEATURED.map((sym) => (
          <button key={sym} type="button" className={v2cx("ib-zero__chip", "featured")}>
            {sym}
          </button>
        ))}
        {SECONDARY.map((sym) => (
          <button key={sym} type="button" className="ib-zero__chip">
            {sym}
          </button>
        ))}
      </div>
      <button type="button" className="ib-zero__cta">
        <i className="fas fa-infinity" aria-hidden="true" />
        TQQQ + SOXL 시작하기
      </button>
    </div>
  );
}
