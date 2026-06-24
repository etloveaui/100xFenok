"use client";

import TransitionLink from "@/components/TransitionLink";

const MACRO_PLAYBOOKS = [
  {
    title: "리스크와 유동성",
    detail: "S&P 500 · VIX · TGA · 10Y · HY",
    href: "/macro-chart?series=sp500,vix,tga,DGS10,HY_spread,M2SL&transform=rebase100,raw,rebase100,raw,raw,yoy&range=10Y&hidden=vix&axis=vix:right,DGS10:right,HY_spread:right&formula=ratio:sp500:DGS10",
  },
  {
    title: "경기활동",
    detail: "OECD CLI · PMI · ISM 제조/서비스",
    href: "/macro-chart?preset=activity&range=MAX",
  },
  {
    title: "은행·신용",
    detail: "은행신용 · 예금 · Tier 1 · HY · 10Y",
    href: "/macro-chart?series=bank_credit,deposits,fdic_tier1,HY_spread,DGS10&transform=yoy,yoy,raw,raw,raw&range=10Y&axis=fdic_tier1:right,HY_spread:right,DGS10:right&formula=spread:bank_credit:deposits",
  },
  {
    title: "크립토 유동성",
    detail: "Stablecoins · Nasdaq · S&P 500 · Crypto F/G",
    href: "/macro-chart?series=stablecoins,nasdaq,sp500,crypto_fear_greed,vix&transform=rebase100,rebase100,rebase100,raw,raw&range=5Y&hidden=vix&axis=crypto_fear_greed:right,vix:right&formula=ratio:nasdaq:stablecoins",
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
