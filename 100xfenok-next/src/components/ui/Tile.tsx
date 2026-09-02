import * as React from "react";

type TileProps = {
  symbol: string;
  name?: string;
  value: string;
  change: number; // percent for heatmap tint selection
  className?: string;
  onClick?: () => void;
};

function heatmapClass(pct: number) {
  const v = pct;
  if (v >= 1.5) return "bg-[#d6f1df] border-[#d6f1df]";
  if (v >= 0.75) return "bg-[#e6f6eb] border-[#e6f6eb]";
  if (v >= 0.25) return "bg-[#f4fbf6] border-[#f4fbf6]";
  if (v > -0.25) return "bg-[#ffffff] border-[#e2e8f0]";
  if (v > -0.75) return "bg-[#fff7f7] border-[#feebec]";
  if (v > -1.5) return "bg-[#feebec] border-[#ffdbdc]";
  if (v > -2.5) return "bg-[#ffdbdc] border-[#ffdbdc]";
  return "bg-[#ffcdce] border-[#ffcdce]";
}

export function Tile({ symbol, name, value, change, className = "", onClick }: TileProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      className={`rounded-[6px] p-[8px_10px] min-h-[52px] flex flex-col justify-between border transition-colors duration-150 ${heatmapClass(change)} ${onClick ? "cursor-pointer hover:brightness-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B73D3]" : ""} ${className}`}
    >
      <span className="font-mono text-[11px] text-[#334155] leading-none">{symbol}{name ? ` · ${name}` : ""}</span>
      <span className="tabular-nums text-[16px] font-semibold text-[#0f172a] leading-none">{value}</span>
    </div>
  );
}
