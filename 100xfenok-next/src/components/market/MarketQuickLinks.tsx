"use client";

import TransitionLink from "@/components/TransitionLink";

type MarketQuickLinksVariant = "pills" | "text";

interface MarketQuickLinksProps {
  className?: string;
  includeStructure?: boolean;
  variant?: MarketQuickLinksVariant;
}

const BASE_LINKS = [
  { href: "/regime", label: "국면", textLabel: "국면 보기" },
  { href: "/market/events", label: "이벤트", textLabel: "이벤트 보기" },
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
  const links = includeStructure ? [...BASE_LINKS, STRUCTURE_LINK] : BASE_LINKS;

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
        <TransitionLink key={link.href} href={link.href} className="data-shell-link">
          {link.label}
        </TransitionLink>
      ))}
    </nav>
  );
}
