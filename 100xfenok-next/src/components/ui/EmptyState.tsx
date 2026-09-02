import * as React from "react";
import { Button } from "./Button";

type EmptyStateProps = {
  reason?: string;
  nextRefresh?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function EmptyState({ reason = "표시할 데이터가 없습니다", nextRefresh, actionLabel, onAction, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-start gap-2 py-[22px] px-4 ${className}`}>
      <span className="text-[13px] font-semibold text-[#0f172a]">{reason}</span>
      {nextRefresh && <span className="text-[12px] text-[#64748b]">{nextRefresh}</span>}
      {actionLabel && onAction && (
        <Button variant="secondary" onClick={onAction} className="mt-1">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
