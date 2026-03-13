import Link from 'next/link';

type RiskAppetiteCardProps = {
  vixValue: number;
  vixLabel: string;
  putCallValue: number;
  putCallLabel: string;
  cryptoFearGreed: number;
  cryptoLabel: string;
};

export default function RiskAppetiteCard({ vixValue, vixLabel, putCallValue, putCallLabel, cryptoFearGreed, cryptoLabel }: RiskAppetiteCardProps) {
  return (
    <article className="overview-widget-card overview-widget-card--sentiment">
      <header className="overview-widget-head">
        <div>
          <p className="overview-widget-kicker orbitron">투자 심리</p>
          <h3 className="overview-widget-subtitle">Risk Appetite</h3>
          <p className="overview-source-meta">변동성과 옵션, 암호화폐 심리를 함께 봅니다.</p>
        </div>
      </header>
      <div className="overview-stat-list">
        <p className="overview-stat-row">
          <span>VIX</span>
          <strong className="text-emerald-800">{vixValue.toFixed(2)} <em>{vixLabel}</em></strong>
        </p>
        <p className="overview-stat-row">
          <span>Put/Call</span>
          <strong className="text-slate-700">{putCallValue.toFixed(2)} <em>{putCallLabel}</em></strong>
        </p>
        <p className="overview-stat-row">
          <span>Crypto F&amp;G</span>
          <strong className="text-brand-gold">{Math.round(cryptoFearGreed)} <em>{cryptoLabel}</em></strong>
        </p>
      </div>
      <Link href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fsentiment-signal%2Findex.html" className="overview-widget-link">
        상세 분석
      </Link>
    </article>
  );
}
