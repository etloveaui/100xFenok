import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VR 시스템 아카이브 - El Fenomeno',
  description: 'VR 시스템 개발 자료를 모아 둔 아카이브입니다.',
  alternates: {
    canonical: '/vr',
  },
  openGraph: {
    title: 'VR 시스템 아카이브 - El Fenomeno',
    description: 'VR 시스템 개발 자료를 모아 둔 아카이브입니다.',
    type: 'website',
    images: ['/favicon-96x96.png'],
  },
  themeColor: '#0ea5e9',
};

export default function VRPage() {
  return (
    <div className="vr-page-bg vr-mathematical-bg min-h-screen"
      style={{
        fontFamily: "'Noto Sans KR', sans-serif"
      }}
    >
      <div className="container mx-auto p-4 md:p-8">
        <header className="text-center mb-16">
          <div className="vr-floating-formula text-8xl mb-6">⚖️</div>
          <h1 className="text-4xl md:text-6xl font-black text-slate-800 mb-4">VR 시스템 아카이브</h1>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
            밸류 리밸런싱(Value Rebalancing) 관련 문서와 계산기 모음<br/>
            <span className="text-indigo-600 font-semibold">수학적 원칙에 기반한 체계적 투자 시스템</span>
          </p>
        </header>

        <div className="vr-card p-6 mb-12 text-center max-w-4xl mx-auto border-2 border-indigo-200">
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
            <span className="text-slate-800 font-semibold">Core Formula</span>
            <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
          </div>
          <div className="font-mono text-lg text-indigo-700 bg-indigo-50 p-4 rounded-lg">
            V₂ = V₁ + (Pool ÷ G) + (E - V₁) ÷ (2√G)
          </div>
          <p className="text-slate-600 text-sm mt-2">
            V₁: 이전 목표값 | Pool: 현금풀 | G: G-Value | E: 평가금
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl mx-auto mb-16">
          <Link href="/vr/vr-complete-system" className="vr-card p-8 block">
            <div className="flex justify-between items-start mb-6">
              <span className="vr-system-badge text-white text-sm font-bold px-4 py-2 rounded-full">
                🔬 시스템 가이드
              </span>
              <span className="text-sm text-slate-500">완전판</span>
            </div>
            <h3 className="text-2xl font-bold text-slate-800 group-hover:text-indigo-600 transition-colors duration-300 mb-4">
              VR 5.0 완전 시스템 가이드
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              밸류 리밸런싱 5.0의 전체 철학과 공식을 다룹니다. 시뮬레이터, 백테스트, 실전 Q&A까지 포함된 완전한 가이드입니다.
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex items-center text-sm text-slate-600">
                <i className="fas fa-chart-line w-5 text-indigo-500 mr-3"></i>
                <span>공식별 성과 비교 차트</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <i className="fas fa-calculator w-5 text-green-500 mr-3"></i>
                <span>실시간 공식 시뮬레이터</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <i className="fas fa-question-circle w-5 text-blue-500 mr-3"></i>
                <span>실전 투자 Q&A</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-700">VR 5.0</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-700">시뮬레이터</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-700">백테스트</span>
            </div>
          </Link>

          <Link href="/vr/vr-total-guide-calculator" className="vr-card p-8 block">
            <div className="flex justify-between items-start mb-6">
              <span className="vr-calculator-badge text-white text-sm font-bold px-4 py-2 rounded-full">
                🧮 계산기
              </span>
              <span className="text-sm text-slate-500">실용도구</span>
            </div>
            <h3 className="text-2xl font-bold text-slate-800 group-hover:text-green-600 transition-colors duration-300 mb-4">
              밸류 리밸런싱 계산기
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              TQQQ와 현금 비율을 조절하는 장기 투자 전략 계산기입니다. 실시간 가격 연동과 주문표 자동 생성 기능을 제공합니다.
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex items-center text-sm text-slate-600">
                <i className="fas fa-sync-alt w-5 text-blue-500 mr-3"></i>
                <span>실시간 TQQQ 가격 연동</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <i className="fas fa-table w-5 text-purple-500 mr-3"></i>
                <span>매수/매도 주문표 자동 생성</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <i className="fas fa-sliders-h w-5 text-orange-500 mr-3"></i>
                <span>3단계 라이프사이클 지원</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-700">TQQQ</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-700">실시간</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-700">주문표</span>
            </div>
          </Link>
        </div>

        <div className="vr-card p-8 max-w-4xl mx-auto mb-16">
          <h3 className="text-2xl font-bold text-slate-800 text-center mb-6">⚖️ VR 시스템의 핵심 특징</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-4xl mb-3">🎯</div>
              <h4 className="font-bold text-slate-800 mb-2">수학적 정확성</h4>
              <p className="text-slate-600 text-sm">감정을 배제한 완전 자동화된 매매 시스템</p>
            </div>
            <div>
              <div className="text-4xl mb-3">📊</div>
              <h4 className="font-bold text-slate-800 mb-2">유연한 설정</h4>
              <p className="text-slate-600 text-sm">G-Value로 리스크와 수익률을 자유롭게 조절</p>
            </div>
            <div>
              <div className="text-4xl mb-3">🔄</div>
              <h4 className="font-bold text-slate-800 mb-2">라이프사이클</h4>
              <p className="text-slate-600 text-sm">자산 형성-유지-활용의 3단계 자동 전환</p>
            </div>
          </div>
        </div>

        <div className="vr-card p-8 text-center max-w-2xl mx-auto border-2 border-green-200">
          <div className="text-5xl mb-4">📈</div>
          <h3 className="text-2xl font-bold text-slate-800 mb-4">VR 시스템 성과 지표</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-3xl font-black text-green-600">49.5%</div>
              <div className="text-sm text-slate-600">예상 연평균 수익률</div>
            </div>
            <div>
              <div className="text-3xl font-black text-red-600">-58.4%</div>
              <div className="text-sm text-slate-600">예상 최대 하락폭</div>
            </div>
            <div>
              <div className="text-3xl font-black text-blue-600">2주</div>
              <div className="text-sm text-slate-600">리밸런싱 주기</div>
            </div>
          </div>
          <p className="text-slate-500 text-xs mt-4">
            * 기본 설정(G=10) 기준, 실제 수익률은 시장 상황에 따라 달라질 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
