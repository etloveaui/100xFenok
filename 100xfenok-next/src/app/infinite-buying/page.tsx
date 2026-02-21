import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Infinite Buying',
  description: 'TQQQ·SOXL 분할매수를 자동 계산해 주는 가이드',
};

export default function InfiniteBuyingPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/ib/ib-total-guide-calculator.html"
        title="Infinite Buying Guide"
        loading="eager"
        className="h-full w-full border-0"
      />
    </div>
  );
}
