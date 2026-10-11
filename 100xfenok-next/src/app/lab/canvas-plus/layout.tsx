import type { ReactNode } from "react";

/**
 * The CANVAS+ lab routes render hand-written sample figures, not product data.
 * This notice sits above every /lab/canvas-plus/* page so no proof-of-concept
 * number can be read as a real one.
 */
export default function CanvasPlusLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <p
        role="note"
        data-canvas-plus-sample-notice
        className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-[13px] font-bold text-amber-900"
      >
        예시 데이터 — 이 화면의 수치와 종목 정보는 화면 설계를 시험하려고 만든 값이며 실제 시장 데이터가 아닙니다.
      </p>
      {children}
    </>
  );
}
