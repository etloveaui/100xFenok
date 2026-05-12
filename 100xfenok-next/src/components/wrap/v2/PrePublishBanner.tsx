"use client";

export default function PrePublishBanner({ etaLabel = "KST 08:30" }: { etaLabel?: string }) {
  return (
    <div className="mw-prebanner">
      <div className="mw-prebanner-inner">
        <span className="kicker">오늘 wrap 준비 중</span>
        <h3 className="mw-prebanner-h">오늘 wrap은 곧 도착합니다</h3>
        <p>오늘 wrap은 {etaLabel}경 도착. 아래는 가장 최근 발행본.</p>
        <div className="mw-prebanner-row">
          <span className="mw-chip mw-chip-regime-warn">
            <span className="mw-chip-dot" />
            PRE
          </span>
          <span className="mono mw-prebanner-eta">ETA · {etaLabel}</span>
        </div>
      </div>
    </div>
  );
}
