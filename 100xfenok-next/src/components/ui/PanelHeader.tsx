import * as React from "react";

type PanelHeaderProps = {
  eyebrow?: string;
  title: string;
  right?: React.ReactNode;
  className?: string;
};

export function PanelHeader({ eyebrow, title, right, className = "" }: PanelHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between h-[44px] px-4 border-b border-[#e2e8f0] bg-[#ffffff] ${className}`}
    >
      <div className="flex flex-col gap-[1px] min-w-0">
        {eyebrow && (
          <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#64748b] leading-none">
            {eyebrow}
          </span>
        )}
        <span className="text-[14px] font-semibold text-[#0f172a] leading-none truncate">{title}</span>
      </div>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
