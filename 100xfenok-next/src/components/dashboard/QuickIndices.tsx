import type { QuickIndexSnapshot } from '@/lib/dashboard/types';
import { formatSignedPercentDecimal, formatPercent, getMarketStateMeta, quickIndexDetail } from '@/lib/dashboard/formatters';

type QuickIndicesProps = {
  quickIndices: QuickIndexSnapshot[];
  tenYearYield: number;
  hySpread: number;
};

export default function QuickIndices({ quickIndices, tenYearYield, hySpread }: QuickIndicesProps) {
  const spyIndex = quickIndices.find((item) => item.symbol === 'SPY') ?? quickIndices[0];
  const qqqIndex = quickIndices.find((item) => item.symbol === 'QQQ') ?? quickIndices[1];
  const spyMarketStateMeta = getMarketStateMeta(spyIndex.marketState);
  const qqqMarketStateMeta = getMarketStateMeta(qqqIndex.marketState);

  return (
    <div className="bento-card p-4 quick-indices-card">
      <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">Quick Indices</h3>
      <div className="quick-indices-scroll">
        <div className="index-item">
          <span className="text-xs text-slate-600">SPY</span>
          <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,16 10,14 20,12 30,10 40,11 50,6 60,4" /></svg>
          <span className={`font-bold text-sm ${spyIndex.change >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
            {formatSignedPercentDecimal(spyIndex.change)}
          </span>
          <span className="index-live-detail">{quickIndexDetail(spyIndex)}</span>
          {spyMarketStateMeta ? (
            <span className={`market-state-badge index-market-state ${spyMarketStateMeta.className}`}>
              {spyMarketStateMeta.label}
            </span>
          ) : null}
        </div>
        <div className="index-item">
          <span className="text-xs text-slate-600">QQQ</span>
          <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,18 10,16 20,12 30,10 40,8 50,6 60,3" /></svg>
          <span className={`font-bold text-sm ${qqqIndex.change >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
            {formatSignedPercentDecimal(qqqIndex.change)}
          </span>
          <span className="index-live-detail">{quickIndexDetail(qqqIndex)}</span>
          {qqqMarketStateMeta ? (
            <span className={`market-state-badge index-market-state ${qqqMarketStateMeta.className}`}>
              {qqqMarketStateMeta.label}
            </span>
          ) : null}
        </div>
        <div className="index-item">
          <span className="text-xs text-slate-600">UST10Y</span>
          <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#ef4444" strokeWidth="1.5" points="0,8 10,9 20,10 30,11 40,12 50,13 60,14" /></svg>
          <span className="font-bold text-slate-700 text-sm">{formatPercent(tenYearYield, 2)}</span>
        </div>
        <div className="index-item">
          <span className="text-xs text-slate-600">HY OAS</span>
          <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points="0,12 10,11 20,10 30,9 40,10 50,11 60,12" /></svg>
          <span className="font-bold text-amber-800 text-sm">{formatPercent(hySpread, 2)}</span>
        </div>
      </div>
    </div>
  );
}
