"use client";

import { SurfaceActionLink, SurfaceCallout } from "@/components/ui/Surface";
import { macroContextFromParam, type MacroContextId } from "@/lib/macro-chart/context";

interface MacroContextCardProps {
  contextId?: MacroContextId | string | null;
  surface: "macro" | "screener" | "etfs" | "stock";
  className?: string;
}

const SURFACE_LABEL: Record<MacroContextCardProps["surface"], string> = {
  macro: "워크벤치",
  screener: "스크리너",
  etfs: "ETF",
  stock: "종목",
};

export default function MacroContextCard({ contextId, surface, className = "" }: MacroContextCardProps) {
  const context = macroContextFromParam(contextId);
  if (!context) return null;

  const actions = [
    surface !== "macro" ? { label: "차트", href: context.chartHref } : null,
    surface !== "screener" ? { label: "스크리너", href: context.screenerHref } : null,
    surface !== "etfs" ? { label: "ETF", href: context.etfHref } : null,
    surface !== "stock" ? { label: context.stockSymbol, href: context.stockHref } : null,
  ].filter((item): item is { label: string; href: string } => item !== null);

  return (
    <SurfaceCallout tone="info" className={className} aria-label="매크로 연결 맥락">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--info)]">
            매크로 연결 · {SURFACE_LABEL[surface]}
          </p>
          <h2 className="mt-1 text-sm font-black text-slate-950">{context.label}</h2>
          <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-slate-700">{context.detail}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {actions.map((action) => (
            <SurfaceActionLink key={action.href} href={action.href}>
              {action.label}
            </SurfaceActionLink>
          ))}
        </div>
      </div>
    </SurfaceCallout>
  );
}
