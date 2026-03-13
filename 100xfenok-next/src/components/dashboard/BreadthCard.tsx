import Link from 'next/link';
import type { SectorSnapshot } from '@/lib/dashboard/types';
import { formatSignedPercentDecimal } from '@/lib/dashboard/formatters';

type BreadthCardProps = {
  sectorRows: SectorSnapshot[];
  sectorUp: number;
  sectorDown: number;
};

export default function BreadthCard({ sectorRows, sectorUp, sectorDown }: BreadthCardProps) {
  const sectorTopRows = [...sectorRows]
    .sort((left, right) => right.displayChange - left.displayChange)
    .slice(0, 4);
  const sectorLeaders = [...sectorRows]
    .sort((left, right) => right.displayChange - left.displayChange)
    .slice(0, 3);
  const sectorLaggards = [...sectorRows]
    .sort((left, right) => left.displayChange - right.displayChange)
    .slice(0, 3);

  return (
    <article className="overview-widget-card overview-widget-card--sector">
      <header className="overview-widget-head">
        <div>
          <p className="overview-widget-kicker orbitron">섹터 흐름</p>
          <h3 className="overview-widget-subtitle">Breadth Expansion</h3>
          <p className="overview-source-meta">최근 강세와 약세 섹터를 한눈에 요약합니다.</p>
        </div>
      </header>
      <div className="overview-breadth">
        <div className="overview-breadth-ledger">
          <span className="overview-dot is-up" aria-hidden="true" />
          <span className="overview-breadth-value">상승 {sectorUp}</span>
          <span className="overview-dot is-down" aria-hidden="true" />
          <span className="overview-breadth-value is-down">하락 {sectorDown}</span>
        </div>
        <div className="overview-chip-row">
          {sectorTopRows.map((sector) => (
            <span key={sector.key} className={`overview-chip ${sector.displayChange >= 0 ? 'is-up' : 'is-down'}`}>
              {sector.etf} {formatSignedPercentDecimal(sector.displayChange, 1)}
            </span>
          ))}
        </div>
      </div>
      <div className="sector-insight-strip mt-4" aria-label="섹터 요약">
        <article className="sector-insight-card">
          <h4 className="sector-insight-title">강한 섹터</h4>
          <div className="sector-insight-list">
            {sectorLeaders.map((sector) => (
              <div key={`leader-${sector.key}`} className="sector-insight-row">
                <span className="sector-insight-symbol">{sector.etf}</span>
                <strong className="sector-insight-value is-up">{formatSignedPercentDecimal(sector.displayChange, 1)}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="sector-insight-card">
          <h4 className="sector-insight-title">약한 섹터</h4>
          <div className="sector-insight-list">
            {sectorLaggards.map((sector) => (
              <div key={`laggard-${sector.key}`} className="sector-insight-row">
                <span className="sector-insight-symbol">{sector.etf}</span>
                <strong className="sector-insight-value is-down">{formatSignedPercentDecimal(sector.displayChange, 1)}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>
      <Link href="/sectors" className="overview-widget-link">
        시장 랩 보기
      </Link>
    </article>
  );
}
