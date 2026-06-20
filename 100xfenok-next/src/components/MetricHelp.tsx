"use client";

import { useId } from "react";
import { metricGlossaryText } from "@/lib/metric-glossary";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function MetricHelp({
  label,
  metricKey,
  showLabel = true,
  align = "left",
  className,
  labelClassName,
}: {
  label: string;
  metricKey?: string;
  showLabel?: boolean;
  align?: "left" | "right";
  className?: string;
  labelClassName?: string;
}) {
  const tooltipId = useId();
  const description = metricGlossaryText(label, metricKey);

  if (!description) {
    return showLabel ? <span className={className}>{label}</span> : null;
  }

  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1 align-middle", className)}>
      {showLabel ? <span className={cx("min-w-0 truncate", labelClassName)}>{label}</span> : null}
      <span className="group/metric-help relative inline-flex shrink-0">
        <button
          type="button"
          aria-label={`${label} 설명: ${description}`}
          aria-describedby={tooltipId}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex size-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-black leading-none text-slate-500 shadow-sm transition hover:border-brand-interactive hover:text-brand-interactive focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
        >
          ?
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className={cx(
            "pointer-events-none absolute top-5 z-30 w-56 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] font-semibold leading-4 text-slate-600 opacity-0 shadow-lg transition group-hover/metric-help:opacity-100 group-focus-within/metric-help:opacity-100",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {description}
        </span>
      </span>
    </span>
  );
}
