'use client';

import { useState } from 'react';

export default function IBHelperPage() {
  const [initialInvestment, setInitialInvestment] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [result, setResult] = useState<{
    shares: number;
    avgPrice: number;
    totalInvestment: number;
    profit: number;
    profitPercent: number;
  } | null>(null);

  const calculate = () => {
    const init = parseFloat(initialInvestment) || 0;
    const target = parseFloat(targetPrice) || 0;
    const current = parseFloat(currentPrice) || 0;

    if (init > 0 && target > 0 && current > 0) {
      const shares = Math.floor(init / current);
      const avgPrice = current;
      const totalInvestment = shares * current;
      const profit = (target - current) * shares;
      const profitPercent = ((target - current) / current) * 100;

      setResult({
        shares,
        avgPrice,
        totalInvestment,
        profit,
        profitPercent,
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black orbitron text-slate-800 mb-2">
          IB Helper <span className="text-brand-gold">무한매수</span>
        </h1>
        <p className="text-slate-600">DCA 전략 기반 무한매수 계산기</p>
      </div>

      {/* Calculator Card */}
      <div className="bento-card mb-6">
        <h2 className="card-title orbitron mb-4">계산기 입력</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              초기 투자금액 (USD)
            </label>
            <input
              type="number"
              value={initialInvestment}
              onChange={(e) => setInitialInvestment(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg text-lg font-tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-navy"
              placeholder="10000"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              목표 주가
            </label>
            <input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg text-lg font-tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-navy"
              placeholder="150"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              현재 주가
            </label>
            <input
              type="number"
              value={currentPrice}
              onChange={(e) => setCurrentPrice(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg text-lg font-tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-navy"
              placeholder="100"
            />
          </div>

          <button
            onClick={calculate}
            className="w-full py-3 bg-brand-navy text-white font-bold rounded-lg hover:bg-brand-interactive transition-colors"
          >
            계산하기
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="bento-card border-l-4 border-l-brand-gold">
          <h2 className="card-title orbitron mb-4">계산 결과</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 mb-1">매수 주식수</div>
              <div className="text-xl font-bold orbitron text-slate-800">
                {result.shares.toLocaleString()}주
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 mb-1">평균 매수가</div>
              <div className="text-xl font-bold orbitron text-slate-800">
                ${result.avgPrice.toFixed(2)}
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 mb-1">총 투자금액</div>
              <div className="text-xl font-bold orbitron text-slate-800">
                ${result.totalInvestment.toLocaleString()}
              </div>
            </div>

            <div className={`p-4 rounded-lg ${result.profit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className="text-xs text-slate-500 mb-1">예상 수익</div>
              <div className={`text-xl font-bold orbitron ${result.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {result.profit >= 0 ? '+' : ''}${result.profit.toLocaleString()}
              </div>
              <div className={`text-sm ${result.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ({result.profitPercent >= 0 ? '+' : ''}{result.profitPercent.toFixed(2)}%)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Info */}
      <div className="bento-card mt-6">
        <h2 className="card-title orbitron mb-3">무한매수 전략 안내</h2>
        <div className="text-sm text-slate-600 space-y-2">
          <p>• 주가 하띰에 따라 분할 매수하여 평균 단가를 낮추는 전략</p>
          <p>• 장기 투자 관점에서 변동성을 활용한 리스크 관리</p>
          <p>• 적정 비중을 유지하며 단계별 진입</p>
        </div>
      </div>
    </div>
  );
}
