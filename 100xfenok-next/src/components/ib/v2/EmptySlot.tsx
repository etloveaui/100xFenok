"use client";

export default function EmptySlot() {
  return (
    <div className="ib-emptyslot">
      <div className="ib-emptyslot__ico">
        <i className="fas fa-arrow-right" aria-hidden="true" />
      </div>
      <div className="ib-emptyslot__title">두 번째 종목 추가</div>
      <div className="ib-emptyslot__sub">
        분산 운용 시 변동성이 다른 종목 1개를 함께 굴리는 게 권장됩니다.
      </div>
      <button type="button" className="ib-emptyslot__cta">
        종목 선택하기
      </button>
    </div>
  );
}
