'use client';

import { useState } from 'react';

export default function VRPage() {
  const [stocks, setStocks] = useState([
    { name: '주식 A', value: 40, target: 40 },
    { name: '주식 B', value: 30, target: 30 },
    { name: '채권', value: 30, target: 30 },
  ]);

  const totalValue = stocks.reduce((sum, s) => sum + s.value, 0);

  const rebalance = () => {
    // 간단한 리밸런싱 로직
    alert('리밸런싱 계산 완료! (Phase 2에서 상세 구현 예정)');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black orbitron text-slate-800 mb-2">
          Value <span className="text-brand-gold">Rebalancing</span>
        </h1>
        <p className="text-slate-600">자산 배분 최적화 및 리밸런싱 도구</p>
      </div>

      {/* Portfolio Overview */}
      <div className="bento-card mb-6">
        <h2 className="card-title orbitron mb-4">현재 포트폴리오</h2>
        
        <div className="space-y-4">
          {stocks.map((stock, idx) => (
            <div key={idx} className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="font-bold text-slate-700">{stock.name}</span>
                  <span className="text-sm text-slate-500">{stock.value}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-navy rounded-full"
                    style={{ width: `${stock.value}%` }}
                  />
                </div>
              </div>
              <input
                type="number"
                value={stock.target}
                onChange={(e) => {
                  const newStocks = [...stocks];
                  newStocks[idx].target = parseInt(e.target.value) || 0;
                  setStocks(newStocks);
                }}
                className="w-20 px-2 py-1 border border-slate-200 rounded text-center"
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100">
          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-700">총합</span>
            <span className={`font-bold orbitron ${totalValue === 100 ? 'text-green-600' : 'text-red-600'}`}>
              {totalValue}%
            </span>
          </div>
        </div>
      </div>

      {/* Target Allocation */}
      <div className="bento-card mb-6">
        <h2 className="card-title orbitron mb-4">목표 배분</h2>
        
        <div className="grid grid-cols-3 gap-4 mb-6">
          {stocks.map((stock, idx) => (
            <div key={idx} className="p-4 bg-slate-50 rounded-lg text-center">
              <div className="text-xs text-slate-500 mb-1">{stock.name}</div>
              <div className="text-2xl font-bold orbitron text-brand-navy">
                {stock.target}%
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={rebalance}
          className="w-full py-3 bg-brand-gold text-white font-bold rounded-lg hover:bg-brand-navy transition-colors"
        >
          리밸런싱 계산
        </button>
      </div>

      {/* Info Card */}
      <div className="bento-card">
        <h2 className="card-title orbitron mb-3">리밸런싱 전략</h2>
        <div className="text-sm text-slate-600 space-y-2">
          <p>• 정기적인 리밸런싱으로 목표 자산 배분 유지</p>
          <p>• 변동성이 큰 자산에서 수익 실현, 안정 자산으로 이동</p>
          <p>• 장기 수익률 향상 및 리스크 관리</p>
        </div>
      </div>
    </div>
  );
}
