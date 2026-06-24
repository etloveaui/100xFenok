"use client";

import TransitionLink from "@/components/TransitionLink";
import { MACRO_CONTEXTS } from "@/lib/macro-chart/context";

const MACRO_PLAYBOOKS = [
  {
    title: "리스크와 유동성",
    detail: "S&P 500 · VIX · TGA · 10Y · HY",
    href: MACRO_CONTEXTS["risk-liquidity"].chartHref,
  },
  {
    title: "경기활동",
    detail: "OECD CLI · PMI · ISM 제조/서비스",
    href: MACRO_CONTEXTS.activity.chartHref,
  },
  {
    title: "은행·신용",
    detail: "은행신용 · 예금 · Tier 1 · HY · 10Y",
    href: MACRO_CONTEXTS["bank-credit"].chartHref,
  },
  {
    title: "크립토 유동성",
    detail: "Stablecoins · Nasdaq · S&P 500 · Crypto F/G",
    href: MACRO_CONTEXTS["crypto-liquidity"].chartHref,
  },
  {
    title: "시장 비교",
    detail: "SPY · QQQ · IWM · Stooq proxy",
    href: "/macro-chart?macro=risk-liquidity&series=stq~SPY.US,stq~QQQ.US,stq~IWM.US&transform=rebase100,rebase100,rebase100&range=5Y",
  },
];

export default function MacroPlaybookCard() {
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>매크로 플레이북</h2>
        <span className="desc">차트 분석</span>
        <TransitionLink href="/macro-chart" className="act">
          전체 →
        </TransitionLink>
      </div>
      <div className="panel-b">
        <div className="space-y-2">
          {MACRO_PLAYBOOKS.map((playbook) => (
            <TransitionLink
              key={playbook.title}
              href={playbook.href}
              className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-brand-interactive hover:bg-slate-50"
            >
              <span className="block truncate text-sm font-black text-slate-900">{playbook.title}</span>
              <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">{playbook.detail}</span>
            </TransitionLink>
          ))}
        </div>
      </div>
    </section>
  );
}
