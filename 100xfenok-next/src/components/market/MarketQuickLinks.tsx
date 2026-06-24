"use client";

import TransitionLink from "@/components/TransitionLink";
import { SurfaceActionLink } from "@/components/ui/Surface";

type MarketQuickLinksVariant = "pills" | "text";

interface MarketQuickLinksProps {
  className?: string;
  includeStructure?: boolean;
  variant?: MarketQuickLinksVariant;
}

const BASE_LINKS = [
  { href: "/regime", label: "국면", textLabel: "국면 보기" },
  { href: "/macro-chart", label: "매크로", textLabel: "매크로 차트 보기" },
  { href: "/market/events", label: "이벤트", textLabel: "이벤트 보기" },
] as const;

const MACRO_LENS_LINKS = [
  {
    href: "/macro-chart?macro=risk-liquidity&series=sp500,vix,tga,DGS10,HY_spread,M2SL&transform=rebase100,raw,rebase100,raw,raw,yoy&range=10Y&hidden=vix&axis=vix:right,DGS10:right,HY_spread:right&formula=ratio:sp500:DGS10",
    label: "리스크",
    textLabel: "리스크 렌즈",
  },
  {
    href: "/macro-chart?macro=activity&preset=activity&range=MAX",
    label: "경기",
    textLabel: "경기 렌즈",
  },
  {
    href: "/macro-chart?macro=risk-liquidity&series=stq~SPY.US,stq~QQQ.US,stq~IWM.US&transform=rebase100,rebase100,rebase100&range=5Y",
    label: "비교",
    textLabel: "시장 비교",
  },
] as const;

const STRUCTURE_LINK = {
  href: "/market-valuation/structure",
  label: "구조",
  textLabel: "시장 구조 보기",
} as const;

const TEXT_LINK_CLASS = "text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive";

export default function MarketQuickLinks({
  className,
  includeStructure = false,
  variant = "pills",
}: MarketQuickLinksProps) {
  const links = includeStructure ? [...BASE_LINKS, ...MACRO_LENS_LINKS, STRUCTURE_LINK] : [...BASE_LINKS, ...MACRO_LENS_LINKS];

  if (variant === "text") {
    return (
      <nav className={className} aria-label="시장 빠른 이동">
        {links.map((link) => (
          <TransitionLink key={link.href} href={link.href} className={TEXT_LINK_CLASS}>
            {link.textLabel}
          </TransitionLink>
        ))}
      </nav>
    );
  }

  return (
    <nav className={["data-shell-section-nav", className].filter(Boolean).join(" ")} aria-label="시장 빠른 이동">
      {links.map((link) => (
        <SurfaceActionLink key={link.href} href={link.href}>
          {link.label}
        </SurfaceActionLink>
      ))}
    </nav>
  );
}
