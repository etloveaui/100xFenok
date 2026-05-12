"use client";

import { useEffect, useRef } from "react";
import type { Alert, Watch } from "@/lib/watch/types";
import { metricByKey } from "@/lib/watch/metrics";
import { v2cx } from "@/components/dashboard/v2/types";

type Props = {
  open: boolean;
  alerts: Alert[];
  watches: Watch[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onOpenBuilder: () => void;
};

function formatRelative(iso: string): string {
  const fired = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - fired) / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  return new Date(iso).toISOString().slice(0, 10);
}

export default function AlertInbox({
  open,
  alerts,
  watches,
  onClose,
  onMarkAllRead,
  onOpenBuilder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="hp-alertinbox" ref={ref} role="dialog" aria-label="알림 인박스">
      <div className="hp-alertinbox__head">
        <span className="hp-alertinbox__title">🔔 Alert Inbox ({alerts.length})</span>
        {alerts.length > 0 ? (
          <button
            type="button"
            className="hp-alertinbox__action"
            onClick={onMarkAllRead}
          >
            모두 읽음
          </button>
        ) : null}
      </div>
      {alerts.length === 0 ? (
        <div className="hp-alertinbox__empty">
          {watches.length === 0 ? (
            <>
              아직 등록된 Watch 가 없어요.
              <br />
              <strong>⌘K</strong> 또는 아래 버튼으로 첫 Watch 를 만들어보세요.
            </>
          ) : (
            <>
              {watches.length}개의 Watch 가 감시 중.
              <br />
              발화 시 여기에 누적됩니다.
            </>
          )}
        </div>
      ) : (
        <div className="hp-alertinbox__list">
          {alerts.map((alert) => {
            const def = metricByKey(alert.metric);
            return (
              <div
                key={alert.id}
                className={v2cx(
                  "hp-alertinbox__item",
                  !alert.read && "hp-alertinbox__item--unread",
                )}
              >
                <div className="hp-alertinbox__item-row">
                  <span>
                    {def?.label ?? alert.metric} {alert.op} {alert.threshold}
                  </span>
                  <span className="hp-alertinbox__item-time">
                    {formatRelative(alert.firedAt)}
                  </span>
                </div>
                <div className="hp-alertinbox__item-meta">
                  관측치 {alert.observed.toFixed(2)}
                  {def?.unit ?? ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="hp-alertinbox__cta" onClick={onOpenBuilder}>
        + Watch 추가하기
      </button>
    </div>
  );
}
