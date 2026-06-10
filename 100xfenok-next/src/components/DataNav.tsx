"use client";

import TransitionLink from "@/components/TransitionLink";

type Page = "explore" | "market" | "sectors" | "screener" | "superinvestors";

const PAGES: Array<{ id: Page; label: string; href: string }> = [
  { id: "explore", label: "탐색", href: "/explore" },
  { id: "market", label: "시장", href: "/market-valuation" },
  { id: "sectors", label: "섹터", href: "/sectors" },
  { id: "screener", label: "스크리너", href: "/screener" },
  { id: "superinvestors", label: "구루", href: "/superinvestors" },
];

export default function DataNav({ active }: { active: Page }) {
  return (
    <nav className="overflow-x-auto" aria-label="데이터 페이지 탐색">
      <div className="flex gap-1.5 whitespace-nowrap">
        {PAGES.map((p) => (
          <TransitionLink
            key={p.id}
            href={p.href}
            className={`inline-flex min-h-8 items-center rounded-full px-3 text-[11px] font-black uppercase tracking-[0.1em] transition ${
              p.id === active
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:border-brand-interactive hover:text-brand-interactive"
            }`}
          >
            {p.label}
          </TransitionLink>
        ))}
      </div>
    </nav>
  );
}
