import Link from 'next/link';
import type { BankingTone } from '@/lib/dashboard/types';

type BankingHealthCardProps = {
  bankingTone: BankingTone;
  bankingLabel: string;
  bankingSummary: string;
};

export default function BankingHealthCard({ bankingTone, bankingLabel, bankingSummary }: BankingHealthCardProps) {
  const bankingDotClass = bankingTone === 'stable'
    ? 'is-stable'
    : bankingTone === 'watch'
      ? 'is-watch'
      : 'is-stress';

  return (
    <article className="overview-widget-card overview-widget-card--banking">
      <header className="overview-widget-head">
        <div>
          <p className="overview-widget-kicker orbitron">금융 건전성</p>
          <h3 className="overview-widget-subtitle">Funding Stress Guard</h3>
          <p className="overview-source-meta">연체율, 예대율, 자본비율로 은행권 상태를 봅니다.</p>
        </div>
      </header>
      <div className="overview-health-row">
        <span className={`overview-pulse-dot ${bankingDotClass}`} aria-hidden="true" />
        <strong>{bankingLabel}</strong>
      </div>
      <p className="overview-metric-sub">{bankingSummary}</p>
      <Link href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fbanking-health.html" className="overview-widget-link">
        상세 분석
      </Link>
    </article>
  );
}
