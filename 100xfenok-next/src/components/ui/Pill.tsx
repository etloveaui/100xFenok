import * as React from "react";

type PillProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "up" | "down" | "warn";
};

const toneClass: Record<string, string> = {
  neutral: "border-[#e2e8f0] text-[#475569] bg-[#ffffff]",
  up: "border-[#bbf7d0] text-[#166534] bg-[#f0fdf4]",
  down: "border-[#fecdd3] text-[#991b1b] bg-[#fef2f2]",
  warn: "border-[#f2a93b] text-[#b9791a] bg-[#fffbeb]",
};

export function Pill({ tone = "neutral", className = "", children, ...props }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-semibold border bg-white transition-colors duration-150 ${toneClass[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
