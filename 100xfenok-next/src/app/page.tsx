'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-3 py-3 sm:px-4 sm:py-4">
      {/* Market Pulse */}
      <section 
        className="market-pulse" 
        style={{ background: 'linear-gradient(135deg, #64748b, #94a3b8)' }}
      >
        <div className="pulse-top">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="market-state-badge state-closed">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current"></span>
                <span>--</span>
              </div>
            </div>
            <div className="text-2xl font-black orbitron">
              {loading ? (
                <div className="skeleton" style={{ height: '2rem', width: '6rem' }}></div>
              ) : (
                "시장 대기"
              )}
            </div>
            <div className="text-xs opacity-60 mt-1">{loading ? '불러오는 중...' : '데이터 연결 준비중'}</div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1.5 justify-end">
              <span className="text-[10px] font-bold opacity-50 orbitron">VIX</span>
              <span className="text-xl font-black orbitron">--</span>
            </div>
            <div className="flex items-center gap-2 justify-end mt-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/15">--</span>
              <span className="text-[10px] opacity-50">--</span>
            </div>
          </div>
        </div>

        <div className="pulse-indices">
          {loading ? (
            <>
              <div className="index-item"><div className="skeleton" style={{ height: '3rem' }}></div></div>
              <div className="index-item"><div className="skeleton" style={{ height: '3rem' }}></div></div>
              <div className="index-item"><div className="skeleton" style={{ height: '3rem' }}></div></div>
            </>
          ) : (
            <>
              <div className="index-item">
                <div className="index-name">S&amp;P 500</div>
                <div className="index-price orbitron">--</div>
                <div className="index-change idx-flat">-- --%</div>
              </div>
              <div className="index-item">
                <div className="index-name">NASDAQ</div>
                <div className="index-price orbitron">--</div>
                <div className="index-change idx-flat">-- --%</div>
              </div>
              <div className="index-item">
                <div className="index-name">DOW</div>
                <div className="index-price orbitron">--</div>
                <div className="index-change idx-flat">-- --%</div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Sector Heatmap */}
      <div className="bento-card mb-3">
        <div className="flex justify-between items-center mb-3">
          <h3 className="card-title orbitron">섹터 히트맵</h3>
          <span className="text-xs text-slate-400">--</span>
        </div>
        <div className="heatmap-grid">
          {loading ? (
            <>
              <div className="skeleton" style={{ height: '50px' }}></div>
              <div className="skeleton" style={{ height: '50px' }}></div>
              <div className="skeleton" style={{ height: '50px' }}></div>
              <div className="skeleton" style={{ height: '50px' }}></div>
            </>
          ) : (
            <div className="col-span-full text-center py-8 text-slate-400 text-sm">
              Phase 2에서 연결 예정
            </div>
          )}
        </div>
      </div>

      {/* Info Grid 2x2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        {/* 투자 심리 */}
        <div className="bento-card">
          <h3 className="card-title orbitron mb-3">투자 심리</h3>
          <div>
            <div className="placeholder-row">
              <span className="text-xs text-slate-500">AAII 강세/약세</span>
              <span className="ph-tag">준비 중</span>
            </div>
            <div className="placeholder-row">
              <span className="text-xs text-slate-500">Put/Call 비율</span>
              <span className="ph-tag">준비 중</span>
            </div>
            <div className="placeholder-row">
              <span className="text-xs text-slate-500">공포 &amp; 탐욕</span>
              <span className="ph-tag">준비 중</span>
            </div>
          </div>
        </div>

        {/* 유동성 */}
        <div className="bento-card">
          <h3 className="card-title orbitron mb-3">유동성</h3>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xl font-bold text-brand-navy orbitron">--</span>
            <span className="ph-tag">WoW</span>
          </div>
          <div className="h-8 bg-gradient-to-r from-slate-50 to-slate-100 rounded flex items-end px-1 gap-0.5">
            <div className="w-2.5 bg-slate-200 rounded-t" style={{ height: '40%' }}></div>
            <div className="w-2.5 bg-slate-200 rounded-t" style={{ height: '55%' }}></div>
            <div className="w-2.5 bg-slate-200 rounded-t" style={{ height: '65%' }}></div>
            <div className="w-2.5 bg-slate-200 rounded-t" style={{ height: '50%' }}></div>
            <div className="w-2.5 bg-slate-200 rounded-t" style={{ height: '70%' }}></div>
            <div className="w-2.5 bg-slate-300 rounded-t" style={{ height: '85%' }}></div>
          </div>
          <p className="text-[10px] text-slate-300 mt-2">Phase 2 연결 예정</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 금융 건전성 */}
        <div className="bento-card">
          <h3 className="card-title orbitron mb-3">금융 건전성</h3>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-slate-200 rounded-full"></div>
            <span className="text-sm font-bold text-slate-400">--</span>
          </div>
          <p className="text-[10px] text-slate-300 mt-2">Phase 2 연결 예정</p>
        </div>

        {/* 스트레스 지수 */}
        <div className="bento-card">
          <h3 className="card-title orbitron mb-3">스트레스 지수</h3>
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-slate-400 orbitron">--</span>
            <span className="ph-tag">N/A</span>
          </div>
          <p className="text-[10px] text-slate-300 mt-2">Phase 2 연결 예정</p>
        </div>
      </div>
    </div>
  );
}
