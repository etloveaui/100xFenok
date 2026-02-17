'use client';

import { useState } from 'react';

type TabId = 'overview' | 'sectors' | 'liquidity' | 'sentiment';

const periods = ['1D', '1W', '1M', 'YTD', '1Y'];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [activePeriod, setActivePeriod] = useState('1W');

  return (
    <>
      <div className="command-bar">
        <div className="tab-pills" role="tablist" aria-label="View tabs">
          <button className={`tab-pill ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
          <button className={`tab-pill ${activeTab === 'sectors' ? 'active' : ''}`} onClick={() => setActiveTab('sectors')}>Sectors</button>
          <button className={`tab-pill ${activeTab === 'liquidity' ? 'active' : ''}`} onClick={() => setActiveTab('liquidity')}>Liquidity</button>
          <button className={`tab-pill ${activeTab === 'sentiment' ? 'active' : ''}`} onClick={() => setActiveTab('sentiment')}>Sentiment</button>
        </div>
        <div className="period-pills" role="radiogroup" aria-label="Time period">
          {periods.map((period) => (
            <button
              key={period}
              className={`period-pill ${activePeriod === period ? 'active' : ''}`}
              onClick={() => setActivePeriod(period)}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      <main className="container mx-auto px-4 py-4">
        {activeTab === 'overview' && (
          <>
            <div className="hero-zone">
              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-2 orbitron">FEAR & GREED</h3>
                <div className="flex items-center gap-3">
                  <div className="relative w-16 h-8">
                    <svg viewBox="0 0 100 50" className="w-full h-full" aria-hidden="true">
                      <defs>
                        <linearGradient id="gaugeFinal" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#ef4444" />
                          <stop offset="50%" stopColor="#eab308" />
                          <stop offset="100%" stopColor="#22c55e" />
                        </linearGradient>
                      </defs>
                      <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
                      <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="url(#gaugeFinal)" strokeWidth="6" strokeLinecap="round" strokeDasharray="126" strokeDashoffset="35" />
                    </svg>
                  </div>
                  <span className="text-2xl font-bold text-brand-navy orbitron">72</span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold text-xs">GREED</span>
                </div>
              </div>

              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-2 orbitron">MARKET REGIME</h3>
                <div className="flex items-center justify-between">
                  <div className="regime-badge">
                    <i className="fas fa-rocket text-xs" />
                    <span>RISK-ON</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Confidence</p>
                    <p className="text-xl font-bold text-green-600 orbitron">87%</p>
                  </div>
                </div>
              </div>

              <div className="bento-card p-4 quick-indices-card">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-2 orbitron">QUICK INDICES</h3>
                <div className="quick-indices-scroll">
                  <div className="index-item">
                    <span className="text-xs text-slate-500">SPY</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,16 10,14 20,12 30,10 40,11 50,6 60,4" /></svg>
                    <span className="font-bold text-green-600 text-sm">+0.85%</span>
                  </div>
                  <div className="index-item">
                    <span className="text-xs text-slate-500">QQQ</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,18 10,16 20,12 30,10 40,8 50,6 60,3" /></svg>
                    <span className="font-bold text-green-600 text-sm">+1.12%</span>
                  </div>
                  <div className="index-item">
                    <span className="text-xs text-slate-500">DXY</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#ef4444" strokeWidth="1.5" points="0,8 10,10 20,12 30,14 40,12 50,14 60,16" /></svg>
                    <span className="font-bold text-red-500 text-sm">-0.3%</span>
                  </div>
                  <div className="index-item">
                    <span className="text-xs text-slate-500">BTC</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,14 10,12 20,10 30,8 40,10 50,7 60,5" /></svg>
                    <span className="font-bold text-green-600 text-sm">+2.4%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
              <div className="bento-card p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-bold text-slate-400 tracking-widest orbitron">SECTOR SNAPSHOT</h3>
                  <button className="text-xs text-brand-interactive font-bold min-h-[44px] flex items-center" onClick={() => setActiveTab('sectors')}>View All →</button>
                </div>
                <div className="sector-snapshot">
                  <div className="flex gap-2 items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="font-bold text-green-600 text-sm">7 Up</span>
                    <span className="w-2 h-2 bg-red-500 rounded-full ml-2" />
                    <span className="font-bold text-red-600 text-sm">4 Down</span>
                  </div>
                  <div className="flex gap-1 flex-wrap mt-2">
                    <span className="sector-chip bg-green-100 text-green-700">XLK +2.3%</span>
                    <span className="sector-chip bg-green-100 text-green-700">XLF +1.5%</span>
                    <span className="sector-chip bg-green-100 text-green-700">XLC +1.1%</span>
                  </div>
                </div>
              </div>

              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-3 orbitron">LIQUIDITY FLOW</h3>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-brand-navy orbitron">+$87B</span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-bold">WoW</span>
                </div>
                <div className="h-10 bg-gradient-to-r from-green-100 to-green-50 rounded flex items-end px-1 gap-0.5">
                  <div className="w-3 bg-green-400 rounded-t h-[60%]" />
                  <div className="w-3 bg-green-400 rounded-t h-[75%]" />
                  <div className="w-3 bg-green-500 rounded-t h-[90%]" />
                  <div className="w-3 bg-green-400 rounded-t h-[70%]" />
                  <div className="w-3 bg-green-500 rounded-t h-[85%]" />
                  <div className="w-3 bg-green-600 rounded-t h-full" />
                </div>
              </div>

              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-3 orbitron">SENTIMENT</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center"><span className="text-xs text-slate-500">VIX</span><span className="font-bold text-green-600 text-sm">14.2 <span className="text-xs text-slate-400">Low</span></span></div>
                  <div className="flex justify-between items-center"><span className="text-xs text-slate-500">Put/Call</span><span className="font-bold text-slate-700 text-sm">0.78</span></div>
                  <div className="flex justify-between items-center"><span className="text-xs text-slate-500">Crypto F&G</span><span className="font-bold text-brand-gold text-sm">78 <span className="text-xs">Greed</span></span></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-3 orbitron">BANKING HEALTH</h3>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-lg font-bold text-green-600">Stable</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">BTFP $12.3B ↓ / DW $4.1B</p>
              </div>
              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-3 orbitron">STRESS INDEX</h3>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-green-600 orbitron">0.12</span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-bold">Low Risk</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">SOFR-IORB Spread</p>
              </div>
            </div>
          </>
        )}

        {activeTab === 'sectors' && (
          <div className="bento-card p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-slate-400 tracking-widest orbitron">SECTOR HEATMAP</h3>
              <span className="text-xs text-slate-400">Treemap by Market Cap</span>
            </div>
            <div className="heatmap-grid">
              <div className="heatmap-cell xlk bg-green-500 text-white"><span className="font-bold text-lg">XLK</span><span className="text-sm">Tech</span><span className="font-bold">+2.34%</span></div>
              <div className="heatmap-cell xlf bg-green-400 text-white"><span className="font-bold">XLF</span><span className="text-xs">+1.56%</span></div>
              <div className="heatmap-cell bg-green-300 text-green-800"><span className="font-bold">XLV</span><span className="text-xs">+0.89%</span></div>
              <div className="heatmap-cell bg-red-400 text-white"><span className="font-bold">XLE</span><span className="text-xs">-1.23%</span></div>
              <div className="heatmap-cell bg-green-200 text-green-800"><span className="font-bold">XLI</span><span className="text-xs">+0.45%</span></div>
              <div className="heatmap-cell bg-green-400 text-white"><span className="font-bold">XLC</span><span className="text-xs">+1.12%</span></div>
              <div className="heatmap-cell bg-red-300 text-red-800"><span className="font-bold">XLY</span><span className="text-xs">-0.67%</span></div>
              <div className="heatmap-cell bg-slate-200 text-slate-600"><span className="font-bold">XLP</span><span className="text-xs">+0.12%</span></div>
              <div className="heatmap-cell bg-red-200 text-red-700"><span className="font-bold">XLRE</span><span className="text-xs">-0.34%</span></div>
              <div className="heatmap-cell bg-green-300 text-green-800"><span className="font-bold">XLB</span><span className="text-xs">+0.78%</span></div>
              <div className="heatmap-cell bg-red-500 text-white"><span className="font-bold">XLU</span><span className="text-xs">-1.89%</span></div>
            </div>
          </div>
        )}

        {activeTab === 'liquidity' && (
          <div className="bento-card p-6">
            <div className="tab-placeholder">
              <i className="fas fa-water tab-placeholder-icon text-blue-400" />
              <h3 className="text-xl font-bold text-slate-700 mb-4">Liquidity Analysis</h3>
              <div className="w-full max-w-md space-y-3">
                <div className="skeleton-bar w-full" />
                <div className="skeleton-bar w-4/5" />
                <div className="skeleton-bar w-3/5" />
              </div>
              <p className="text-sm text-slate-400 mt-4">Loading liquidity data...</p>
            </div>
          </div>
        )}

        {activeTab === 'sentiment' && (
          <div className="bento-card p-6">
            <div className="tab-placeholder">
              <i className="fas fa-heart-pulse tab-placeholder-icon text-red-400" />
              <h3 className="text-xl font-bold text-slate-700 mb-4">Sentiment Indicators</h3>
              <div className="w-full max-w-md space-y-3">
                <div className="skeleton-bar w-full" />
                <div className="skeleton-bar w-4/5" />
                <div className="skeleton-bar w-3/5" />
              </div>
              <p className="text-sm text-slate-400 mt-4">Loading sentiment data...</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
