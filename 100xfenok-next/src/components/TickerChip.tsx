"use client";

import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import { isValidRouteTicker, normalizeForRouteTicker } from "@/lib/ticker";

export type TickerChipVariant = "pill" | "inline";

interface TickerChipProps {
  ticker: string;
  label?: string;
  variant?: TickerChipVariant;
  href?: string;
  className?: string;
}

const LINK_CLASSES: Record<TickerChipVariant, string> = {
  pill: "inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-600 transition touch-manipulation hover:border-brand-interactive hover:text-brand-interactive",
  inline: "inline-block py-1 font-black text-brand-interactive touch-manipulation hover:underline",
};

const TEXT_CLASSES: Record<TickerChipVariant, string> = {
  pill: "inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-500",
  inline: "font-black text-slate-700",
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function TickerChip({
  ticker,
  label,
  variant = "inline",
  href,
  className,
}: TickerChipProps) {
  const normalized = normalizeForRouteTicker(ticker);
  const display = label ?? normalized ?? ticker;

  if (!display) return <span className={cx(TEXT_CLASSES[variant], className)}>—</span>;
  if (!isValidRouteTicker(ticker)) {
    return <span className={cx(TEXT_CLASSES[variant], className)}>{display}</span>;
  }

  return (
    <TransitionLink href={href ?? ROUTES.stock(normalized)} className={cx(LINK_CLASSES[variant], className)}>
      {display}
    </TransitionLink>
  );
}
