import * as React from "react";

type StatProps = {
  label: string;
  value: React.ReactNode;
  sub?: string;
  className?: string;
  highlight?: boolean;
};

export function Stat({ label, value, sub, className = "", highlight }: StatProps) {
  return (
    <div className={`flex flex-col gap-1 py-3 px-4 border-r last:border-r-0 border-[#e2e8f0] min-w-0 ${className}`}>
      <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#64748b]">{label}</span>
      <span
        className={`tabular-nums text-[22px] font-semibold text-[#0f172a] leading-none transition-colors duration-150 ${highlight ? "bg-[#eafaf2] rounded px-1" : ""}`}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-[#64748b]">{sub}</span>}
    </div>
  );
}

export function StatStrip({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex bg-white border border-[#e2e8f0] rounded-[8px] overflow-hidden divide-x divide-[#e2e8f0] ${className}`} {...props}>{children}</div>;
}
