"use client";

import { useState } from "react";
import IbGuideCalculator from "./IbGuideCalculator";
import VrGuideCalculator from "./VrGuideCalculator";
import { starPercent, type GuideTicker } from "./lib/guideCalculators";
import "@/styles/ib-guide.css";

function StrategyChart() {
  const [ticker, setTicker] = useState<GuideTicker>("TQQQ");
  const points = Array.from({ length: 40 }, (_, i) => ({ t: i + 1, value: starPercent(ticker, i + 1) }));
  return <section className="ib-guide-panel">
    <h2>종목별 상세 전략 (V2.2 기준)</h2>
    <p>매매 구조는 동일하지만 변동성을 감안하여 ☆% 공식과 목표 수익률에 차이를 둡니다.</p>
    <div className="ib-guide-actions" role="tablist" aria-label="종목별 전략">
      {(["TQQQ", "SOXL"] as const).map(symbol => <button type="button" role="tab" aria-selected={ticker === symbol} key={symbol}
        onClick={() => setTicker(symbol)}>{symbol}</button>)}
    </div>
    <h3>{ticker} 전략: {ticker === "TQQQ" ? "안정성에 집중" : "변동성 대응"}</h3>
    <p>기본 설정: 40분할 / 목표수익 +{ticker === "TQQQ" ? 10 : 12}% · ☆% = {ticker === "TQQQ" ? "10 − T/2" : "12 − T×0.6"}</p>
    <svg viewBox="0 0 640 290" role="img" aria-label={`${ticker} T=1부터 40까지의 LOC 기준가 별 퍼센트`}>
      {[-12, -6, 0, 6, 12].map(value => <g key={value}><line x1="42" x2="630" y1={135-value*9} y2={135-value*9} stroke="#cbd5e1" />
        <text x="3" y={139-value*9} fontSize="12" fill="#334155">{value}%</text></g>)}
      {points.map(({t, value}) => <rect key={t} x={44+(t-1)*14.5} y={value >= 0 ? 135-value*9 : 135} width="10" height={Math.abs(value)*9 || 1}
        fill={value >= 0 ? "#0072B2" : "#D55E00"}><title>T={t}: {value.toFixed(1)}%</title></rect>)}
      {[1,10,20,30,40].map(t => <text key={t} x={44+(t-1)*14.5} y="263" fontSize="12" fill="#334155">{t}</text>)}
      <text x="312" y="285" fontSize="12" fill="#334155">T 값</text>
    </svg>
    <details><summary>전체 T값·☆% 표</summary><div className="ib-guide-table"><table><thead><tr><th>T</th><th>☆%</th></tr></thead>
      <tbody>{points.map(row => <tr key={row.t}><td>{row.t}</td><td>{row.value.toFixed(1)}%</td></tr>)}</tbody></table></div></details>
  </section>;
}

export default function IbGuideTab() {
  const [guide, setGuide] = useState<"ib" | "vr">("ib");
  return <div className="ib-guide" data-ib-guide="native">
    <header><h1>투자 가이드 · 계산기</h1><p>무한매수법과 밸류 리밸런싱의 전략 설명 및 수동 주문 계산</p></header>
    <div className="ib-guide-switch" role="tablist" aria-label="가이드 선택">
      <button id="ib-guide-tab" type="button" role="tab" aria-controls="ib-guide-content" aria-selected={guide === "ib"} onClick={() => setGuide("ib")}>무한매수 가이드</button>
      <button id="vr-guide-tab" type="button" role="tab" aria-controls="vr-guide-content" aria-selected={guide === "vr"} onClick={() => setGuide("vr")}>VR 가이드 · 계산기</button>
    </div>
    <div id="ib-guide-content" role="tabpanel" aria-labelledby="ib-guide-tab" hidden={guide !== "ib"}>
      <h2>무한매수법 완전정복</h2><p>3배 레버리지 ETF(TQQQ·SOXL)를 미리 정한 규칙에 따라 분할매수·분할매도하는 방법을 정리했습니다.</p>
<section id="intro" className="ib-guide-panel">
                <h2 className="text-3xl font-bold mb-4">1. 무한매수법의 핵심 철학</h2>
                <p className="mb-6 text-base md:text-lg">
                    '무한매수법'은 단기 주가 예측 대신 미리 정한 <span className="font-bold highlight">수학적 규칙</span>에 따라 분할매수와 분할매도를 반복하는 전략입니다. 감정적 판단을 배제하고, 변동성을 매매 기회로 쓰는 것이 기본 전제입니다.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-center">
                    <div className="p-6 bg-gray-50 rounded-lg">
                        <span className="text-5xl">🤖</span>
                        <h3 className="text-xl font-bold mt-2">나는 기계다</h3>
                        <p className="text-gray-600">어떤 상황에서도 원칙을 최우선으로. 감정적 판단은 가장 큰 적입니다.</p>
                    </div>
                    <div className="p-6 bg-gray-50 rounded-lg">
                        <span className="text-5xl">🏺</span>
                        <h3 className="text-xl font-bold mt-2">자신의 '그릇' 알기</h3>
                        <p className="text-gray-600">3배 레버리지의 변동성을 감당할 수 있는 만큼만 투자하는 것이 핵심입니다.</p>
                    </div>
                </div>
            </section>
<section id="evolution" className="ib-guide-panel">
                <h2 className="text-3xl font-bold mb-6 text-center">2. 전략의 진화: 끊임없는 최적화</h2>
                <p className="text-center text-lg mb-8 max-w-3xl mx-auto">무한매수법은 시장 상황에 맞춰 V1부터 최신 버전까지 계속 바뀌어 왔습니다. 각 버전은 리스크 관리와 수익 목표 사이의 균형을 조정한 결과입니다.</p>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-100">
                                <th className="p-4 font-bold">버전</th>
                                <th className="p-4 font-bold">핵심 특징</th>
                                <th className="p-4 font-bold">주요 변화</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b">
                                <td className="p-4 font-bold text-[#003f5c]">V2.2 (2023 오피셜)</td>
                                <td className="p-4">전후반전 개념을 'T값'에 따라 부드럽게 연결, 안정성 강화</td>
                                <td className="p-4">프로세스 간결화, 하락장 방어력 증진, 점진적 손절 개념 도입</td>
                            </tr>
                            <tr className="border-b">
                                <td className="p-4 font-bold text-[#665191]">V3.0</td>
                                <td className="p-4">20분할 기반, 수익의 일부를 1회 매수금에 즉시 반영 (반복리)</td>
                                <td className="p-4">분할 횟수를 40회에서 20회로 줄이고 회차당 매수금을 키움</td>
                            </tr>
                            <tr>
                                <td className="p-4 font-bold text-[#ff7c43]">IBS (무한매수매도법)</td>
                                <td className="p-4">10분할 기반, 매도를 매우 자주하여 현금 흐름 창출에 집중</td>
                                <td className="p-4">'쿼터매도' 대신 '1회치 매도' 개념 도입, 중기적 관점 필요</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
<StrategyChart />
<section id="crisis" className="ib-guide-panel">
                <h2 className="text-3xl font-bold mb-2 text-center">4. 위기관리: 쿼터 손절 (V2.2 기준)</h2>
                <p className="text-center text-lg mb-8 max-w-3xl mx-auto">모든 분할매수(40회)가 끝났음에도 목표 수익에 도달하지 못했을 때, 손실을 제한하고 재기회를 만드는 체계적인 비상 탈출 계획입니다.</p>
                <div className="flex flex-col md:flex-row items-stretch justify-center gap-4 md:gap-2">
                    <div className="flow-box">
                        <p className="pill mb-3">STEP 1</p>
                        <h3 className="text-xl font-bold mb-2">1/4 MOC 매도</h3>
                        <p>보유 수량의 <span className="highlight font-bold">1/4</span>을 종가(MOC)로 <span className="font-bold">무조건 매도</span>하여 현금을 확보하고 손실을 확정합니다.</p>
                    </div>
                    <div className="flow-arrow">➡️</div>
                    <div className="flow-box">
                        <p className="pill mb-3">STEP 2</p>
                        <h3 className="text-xl font-bold mb-2">자금 재계산</h3>
                        <p>확보된 현금과 기존 수익금을 합산하여, <span className="highlight font-bold">10회 분할 매수금</span>을 새로 계산합니다.</p>
                    </div>
                    <div className="flow-arrow">➡️</div>
                    <div className="flow-box">
                        <p className="pill mb-3">STEP 3</p>
                        <h3 className="text-xl font-bold mb-2">추가 매수 시작</h3>
                        <p><span className="highlight font-bold">-10%(TQQQ) 또는 -12%(SOXL)</span> LOC 매수를 10회에 걸쳐 진행하며 평단을 적극적으로 낮춥니다.</p>
                    </div>
                     <div className="flow-arrow">➡️</div>
                    <div className="flow-box">
                        <p className="pill mb-3">STEP 4</p>
                        <h3 className="text-xl font-bold mb-2">탈출 또는 반복</h3>
                        <p>낮아진 평단을 기반으로 작은 반등에도 수익 전환(탈출)을 노립니다. 실패 시 STEP 1을 반복합니다.</p>
                    </div>
                </div>
            </section>
<section id="synergy" className="ib-guide-panel">
                <h2 className="text-3xl font-bold mb-6 text-center">5. 완성된 그림: 무한매수법 + 밸류 리밸런싱(VR)</h2>
                <p className="text-center text-lg mb-8 max-w-3xl mx-auto">수익률만 보고 고르기보다, 무한매수법으로 만든 현금을 장기 투자 전략인 '밸류 리밸런싱(VR)'과 함께 운용하는 조합을 다룹니다.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-blue-50 p-6 rounded-lg">
                        <h3 className="text-xl font-bold mb-3">무한매수법 (단기/중기)</h3>
                        <ul className="list-disc list-inside space-y-2">
                            <li>횡보장/하락장에서도 현금 흐름 창출</li>
                            <li>실현 수익으로 인한 심리적 안정감 제공</li>
                            <li>급전 필요시 유연하게 대응 가능</li>
                        </ul>
                    </div>
                    <div className="bg-purple-50 p-6 rounded-lg">
                        <h3 className="text-xl font-bold mb-3">밸류 리밸런싱 (장기)</h3>
                        <ul className="list-disc list-inside space-y-2">
                            <li>장기 보유와 주기적 리밸런싱으로 자산을 운용</li>
                            <li>상승장의 큰 흐름을 놓치지 않음</li>
                            <li>무한매수법 수익금의 최종 종착지</li>
                        </ul>
                    </div>
                </div>
            </section>
      <IbGuideCalculator />
    </div>
    <div id="vr-guide-content" role="tabpanel" aria-labelledby="vr-guide-tab" hidden={guide !== "vr"}>
      <h2>밸류 리밸런싱 토탈 가이드</h2><p>TQQQ를 활용한 장기 투자 전략 by Fenok</p>
<section className="mb-20">
            <div className="text-center max-w-3xl mx-auto">
                <h2 className="text-3xl font-bold text-gray-800 mb-4">밸류 리밸런싱이란?</h2>
                <p className="text-lg leading-relaxed text-gray-700">
                    마이클 에들슨의 '밸류 에버리징'을 기반으로, TQQQ와 현금(Pool)의 비율을 조절하여 위험도는 낮추고 수익률은 극대화하는 장기 투자 전략입니다. 주가의 상승과 하락에 '대응'하며, 예측 불가능한 시장 상황 속에서 계획적으로 자산을 운용하는 것을 목표로 합니다.
                </p>
            </div>
        </section>

        
        <section className="mb-20">
            <h2 className="text-3xl font-bold text-center mb-8 text-gray-800">3가지 투자 방식 상세 가이드</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                
                <div className="card-gradient rounded-xl shadow-lg p-6 text-center border-t-4 border-indigo-500 transform hover:scale-105 transition-transform duration-300">
                    <h3 className="text-2xl font-bold mb-3">적립식 VR</h3>
                    <p className="text-gray-600 mb-4">투자 초기에 꾸준히 자산을 불려나가는 단계입니다.</p>
                    <ul className="text-left text-gray-700 space-y-2">
                        <li><span className="font-bold text-indigo-600">목표:</span> 투자금 증식, 하락장 방어</li>
                        <li><span className="font-bold text-indigo-600">초기 Pool:</span> 0% ~ 10%</li>
                        <li><span className="font-bold text-indigo-600">권장 G값:</span> 10부터 시작 (점진적 상향)</li>
                        <li><span className="font-bold text-indigo-600">Pool 사용한도:</span> 75%</li>
                    </ul>
                </div>
                
                <div className="card-gradient rounded-xl shadow-lg p-6 text-center border-t-4 border-purple-500 transform hover:scale-105 transition-transform duration-300">
                     <h3 className="text-2xl font-bold mb-3">거치식 VR</h3>
                    <p className="text-gray-600 mb-4">목돈을 안정적으로 운용하며 복리 효과를 누리는 단계입니다.</p>
                     <ul className="text-left text-gray-700 space-y-2">
                        <li><span className="font-bold text-purple-600">목표:</span> 안정적 자산 운용</li>
                        <li><span className="font-bold text-purple-600">초기 Pool:</span> 10% ~ 20%</li>
                        <li><span className="font-bold text-purple-600">권장 G값:</span> 10 ~ 20</li>
                        <li><span className="font-bold text-purple-600">Pool 사용한도:</span> 50%</li>
                    </ul>
                </div>
                
                <div className="card-gradient rounded-xl shadow-lg p-6 text-center border-t-4 border-pink-500 transform hover:scale-105 transition-transform duration-300">
                    <h3 className="text-2xl font-bold mb-3">인출식 VR</h3>
                    <p className="text-gray-600 mb-4">경제적 자유를 위해 자산을 인출하며 사용하는 최종 단계입니다.</p>
                     <ul className="text-left text-gray-700 space-y-2">
                        <li><span className="font-bold text-pink-600">목표:</span> 현금 흐름 창출</li>
                        <li><span className="font-bold text-pink-600">초기 Pool:</span> 20% ~ 30%</li>
                        <li><span className="font-bold text-pink-600">권장 G값:</span> 20 이상</li>
                        <li><span className="font-bold text-pink-600">Pool 사용한도:</span> 25%</li>
                    </ul>
                </div>
            </div>
        </section>

        
        <section className="mb-20">
            <h2 className="text-3xl font-bold text-center mb-8 text-gray-800">일반적인 투자 경로</h2>
            <div className="relative max-w-2xl mx-auto">
                <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-300 -translate-y-1/2"></div>
                <div className="relative flex justify-between items-center">
                    <div className="text-center z-10">
                        <div className="bg-indigo-100 text-indigo-800 rounded-full w-28 h-28 flex items-center justify-center font-bold text-lg shadow-md border-4 border-white">적립식</div>
                        <p className="mt-2 font-medium">자산 형성기</p>
                    </div>
                    <div className="text-center z-10">
                        <div className="bg-purple-100 text-purple-800 rounded-full w-28 h-28 flex items-center justify-center font-bold text-lg shadow-md border-4 border-white">거치식</div>
                         <p className="mt-2 font-medium">자산 유지/성장기</p>
                    </div>
                    <div className="text-center z-10">
                        <div className="bg-pink-100 text-pink-800 rounded-full w-28 h-28 flex items-center justify-center font-bold text-lg shadow-md border-4 border-white">인출식</div>
                         <p className="mt-2 font-medium">자산 활용기</p>
                    </div>
                </div>
            </div>
        </section>

        
        <section className="mb-20 bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-3xl font-bold text-center mb-8 text-gray-800">핵심 공식: 기본 vs 실력</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="bg-indigo-50 p-6 rounded-lg border-l-4 border-indigo-400">
                    <h4 className="font-bold text-xl text-indigo-800 mb-3">기본공식</h4>
                    <p className="text-gray-700 mb-4">계산이 간단하며 V값은 하락하지 않아 직관적입니다. 안정적인 시장에서 효과적입니다.</p>
                    <div className="text-center bg-white rounded-lg p-4 font-mono text-lg text-indigo-600">V₂ = V₁ + P/G ± 적립/인출금</div>
                </div>
                 <div className="bg-green-50 p-6 rounded-lg border-l-4 border-green-400">
                    <h4 className="font-bold text-xl text-green-800 mb-3">실력공식</h4>
                    <p className="text-gray-700 mb-4">평가금(E)을 반영하여 하락장에서 V값이 하락할 수 있어 현실적 대응이 가능합니다. </p>
                     <div className="text-center bg-white rounded-lg p-4 font-mono text-lg text-green-700">V₂ = V₁ + P/G + (E−V₁)/(2√G) ± 적립/인출금</div>
                </div>
             </div>
        </section>

        
      <VrGuideCalculator />
    </div>
  </div>;
}
