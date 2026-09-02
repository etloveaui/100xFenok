import * as React from "react";

type BarProps = {
  value: number; // 0-100
  className?: string;
  "aria-label"?: string;
};

export function Bar({ value, className = "", ...props }: BarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`h-[6px] rounded-[3px] bg-[#f1f5f9] overflow-hidden w-[160px] ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <i
        className="block h-full bg-[#1B73D3] rounded-[3px] transition-all duration-150 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
