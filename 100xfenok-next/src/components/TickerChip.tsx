"use client";

import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import { isValidRouteTicker, normalizeForRouteTicker } from "@/lib/ticker";

export type TickerChipVariant = "pill" | "inline";

interface TickerChipProps {
  ticker: string;
  label?: string;
  variant?: TickerChipVariant;
}

const LINK_CLASSES: Record<TickerChipVariant, string> = {
  pill: "inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive",
  inline: "font-black text-brand-interactive hover:underline",
};

const TEXT_CLASSES: Record<TickerChipVariant, string> = {
  pill: "inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-500",
  inline: "font-black text-slate-700",
};

export default function TickerChip({
  ticker,
  label,
  variant = "inline",
}: TickerChipProps) {
  const normalized = normalizeForRouteTicker(ticker);
  const display = label ?? normalized ?? ticker;

  if (!display) return <span className={TEXT_CLASSES[variant]}>—</span>;
  if (!isValidRouteTicker(ticker)) {
    return <span className={TEXT_CLASSES[variant]}>{display}</span>;
  }

  return (
    <TransitionLink href={ROUTES.stock(normalized)} className={LINK_CLASSES[variant]}>
      {display}
    </TransitionLink>
  );
}
