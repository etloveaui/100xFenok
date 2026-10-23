"use client";

import { useState } from "react";
import StablecoinChart from "./StablecoinChart";

export default function StablecoinPost() {
  const [growth, setGrowth] = useState(800);
  const [foreign, setForeign] = useState(60);
  const [year, setYear] = useState(2028);
  const [results, setResults] = useState<{ marketCap: number; bondDemand: number; liquidity: number } | null>(null);
  const [tab, setTab] = useState<"winners" | "caution" | "index">("winners");
  // Preserve the original simulator: target year labels the scenario but does not compound its growth input.
  return <div className="native-post-stablecoin">

    
    <div className="container mx-auto p-4 md:p-8">

        
        <header className="text-center mb-16">
            <div className="floating-timeline text-8xl mb-6">🎯</div>
            <h1 className="text-4xl md:text-6xl font-black text-white mb-4">스테이블코인 마스터플랜</h1>
            <p className="text-xl text-white/80 max-w-4xl mx-auto leading-relaxed">
                디지털 시대 달러 패권의 완전 설계도<br />
                <span className="text-yellow-300 font-semibold">40년 패권 사이클의 새로운 전환점</span>
            </p>
            <div className="progress-bar w-full max-w-2xl mx-auto mt-8"></div>
        </header>

        
        <section className="masterplan-card p-8 mb-16">
            <div className="relative z-10">
                <h2 className="text-3xl font-bold text-white text-center mb-8">🔄 40년마다 찾아오는 혁명</h2>
                <p className="text-white/80 text-center mb-12 max-w-3xl mx-auto text-lg">
                    미국은 역대급 부채 상황에서 산업 트렌드를 바꾸며 새로운 40년 패권을 만들어왔습니다.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center mb-12">
                    <div className="masterplan-card border-2 border-yellow-400/50 p-6">
                        <div className="cycle-badge text-white text-sm font-bold px-4 py-2 rounded-full mb-4 inline-block">
                            1940년</div>
                        <h3 className="text-xl font-bold text-white mb-3">루즈벨트 혁명</h3>
                        <p className="text-white/70 text-sm">뉴딜정책과 제조업 중심 경제로 패권 구축</p>
                    </div>

                    <div className="masterplan-card border-2 border-blue-400/50 p-6">
                        <div
                            className="mechanism-badge text-white text-sm font-bold px-4 py-2 rounded-full mb-4 inline-block">
                            1980년</div>
                        <h3 className="text-xl font-bold text-white mb-3">레이건 혁명</h3>
                        <p className="text-white/70 text-sm">금융 중심 경제와 달러 패권 강화</p>
                    </div>

                    <div className="masterplan-card border-2 border-purple-400/50 p-6">
                        <div
                            className="digital-badge text-white text-sm font-bold px-4 py-2 rounded-full mb-4 inline-block">
                            2020년</div>
                        <h3 className="text-xl font-bold text-white mb-3">디지털 혁명</h3>
                        <p className="text-white/70 text-sm">AI와 디지털 자산을 통한 패권 재정립</p>
                    </div>
                </div>

                <div className="bg-white/10 p-6 rounded-lg border-l-4 border-yellow-400">
                    <h4 className="font-bold text-white mb-2">💡 핵심 인사이트</h4>
                    <p className="text-white/80">
                        매번 역대급 부채 상황에서 산업 트렌드를 바꾸려 했고, 강한 저항이 있었지만 결국 새로운 40년 패권을 만들어갔습니다.
                        이번에도 미국이 산업 정책을 바꾸려는 시도에 경제학자들의 반대가 심하지만, 정치·군사 관점에서는 필요한 방향입니다.
                    </p>
                </div>
            </div>
        </section>

        
        <section className="masterplan-card p-8 mb-16">
            <div className="relative z-10">
                <h2 className="text-3xl font-bold text-white text-center mb-8">💫 Part 1: 유동성 엔진의 대변혁</h2>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
                    <div>
                        <h3 className="text-2xl font-bold text-white mb-6">연준 대차대조표: 유동성의 진실</h3>
                        <p className="text-white/80 mb-6">
                            연준의 양적긴축(QT)에도 불구하고 은행 지급준비금은 안정적이었습니다.
                            그 비밀은 급감하는 역레포(RRP) 잔고에 있었습니다.
                        </p>
                        <div className="space-y-4">
                            <div className="bg-white/10 p-4 rounded-lg border-l-4 border-blue-400">
                                <h4 className="font-bold text-white mb-2">📊 RRP 메커니즘</h4>
                                <p className="text-white/70 text-sm">MMF가 연준에 자금을 맡기는 장치로, 연준이 고정금리를 제공합니다.</p>
                            </div>
                            <div className="bg-white/10 p-4 rounded-lg border-l-4 border-green-400">
                                <h4 className="font-bold text-white mb-2">💰 옐런의 전략</h4>
                                <p className="text-white/70 text-sm">단기채를 역레포 금리보다 높게 발행하여 MMF 자금을 유도했습니다.</p>
                            </div>
                        </div>
                    </div>

                    <div className="chart-container">
                        <div style={{ height: 300 }}><StablecoinChart id="rrpFlowChart" /></div>
                    </div>
                </div>

                <div className="flow-diagram p-8 rounded-lg mb-8">
                    <h3 className="text-2xl font-bold text-white text-center mb-8">🔄 RRP → 스테이블코인 전환 플로우</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                        <div className="bg-white/20 p-4 rounded-lg">
                            <div className="text-4xl mb-2">🏦</div>
                            <h4 className="font-bold text-white">MMF 자금</h4>
                            <p className="text-white/70 text-sm">역레포 계좌</p>
                        </div>
                        <div className="flex items-center justify-center">
                            <div className="text-3xl text-yellow-400">→</div>
                        </div>
                        <div className="bg-white/20 p-4 rounded-lg">
                            <div className="text-4xl mb-2">📜</div>
                            <h4 className="font-bold text-white">단기국채</h4>
                            <p className="text-white/70 text-sm">더 높은 금리</p>
                        </div>
                        <div className="flex items-center justify-center">
                            <div className="text-3xl text-yellow-400">→</div>
                        </div>
                        <div className="bg-white/20 p-4 rounded-lg">
                            <div className="text-4xl mb-2">🏛️</div>
                            <h4 className="font-bold text-white">TGA 충전</h4>
                            <p className="text-white/70 text-sm">재무부 계정</p>
                        </div>
                        <div className="flex items-center justify-center">
                            <div className="text-3xl text-yellow-400">→</div>
                        </div>
                        <div className="bg-white/20 p-4 rounded-lg">
                            <div className="text-4xl mb-2">💸</div>
                            <h4 className="font-bold text-white">정부지출</h4>
                            <p className="text-white/70 text-sm">유동성 공급</p>
                        </div>
                    </div>
                </div>

                <div className="bg-red-500/20 p-6 rounded-lg border-l-4 border-red-400">
                    <h4 className="font-bold text-white mb-2">⚠️ 위기의 신호</h4>
                    <p className="text-white/80">
                        현재 역레포 잔고가 약 2천억 달러까지 감소했으며, 이는 더 이상 단기채 발행을 뒷받침할 수 없는 수준입니다.
                        따라서 새로운 미국채 수요처가 필요한 상황이며, 이것이 바로 스테이블코인입니다.
                    </p>
                </div>
            </div>
        </section>

        
        <section className="masterplan-card p-8 mb-16">
            <div className="relative z-10">
                <h2 className="text-3xl font-bold text-white text-center mb-8">🌐 Part 2: 디지털 패권의 공생 관계</h2>

                <div className="text-center mb-12">
                    <div className="inline-flex items-center space-x-8 bg-white/10 p-6 rounded-lg">
                        <div className="text-center">
                            <div className="text-6xl mb-2">₿</div>
                            <h3 className="font-bold text-white">비트코인</h3>
                            <p className="text-white/70 text-sm">국채 담보 역할</p>
                        </div>
                        <div className="text-4xl text-yellow-400">+</div>
                        <div className="text-center">
                            <div className="text-6xl mb-2">💵</div>
                            <h3 className="font-bold text-white">스테이블코인</h3>
                            <p className="text-white/70 text-sm">달러 패권 강화</p>
                        </div>
                        <div className="text-4xl text-yellow-400">=</div>
                        <div className="text-center">
                            <div className="text-6xl mb-2">🎯</div>
                            <h3 className="font-bold text-white">디지털 패권</h3>
                            <p className="text-white/70 text-sm">완전 지배력</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    <div className="bg-white/10 p-6 rounded-lg">
                        <h3 className="text-xl font-bold text-white mb-4">🔗 비트코인: 국채 수요의 촉매제</h3>
                        <p className="text-white/80 mb-4">
                            미국은 비트코인을 달러의 경쟁자가 아닌, '국채 담보 역할의 금융 자산'으로 재정의하고 있습니다.
                        </p>
                        <ul className="space-y-2 text-white/70">
                            <li>• 글로벌 시장에서 비트코인 거래는 주로 USDT로 이루어짐</li>
                            <li>• 비트코인 시장 성장 → 스테이블코인 수요 증가</li>
                            <li>• 스테이블코인 → 미국 국채 매입으로 직결</li>
                        </ul>
                    </div>

                    <div className="bg-white/10 p-6 rounded-lg">
                        <h3 className="text-xl font-bold text-white mb-4">💰 스테이블코인 잠재력</h3>
                        <div className="text-center mb-4">
                            <div className="text-4xl font-bold text-yellow-400">2,500억 → 2조</div>
                            <p className="text-white/70">달러 (8배 성장 가능성)</p>
                        </div>
                        <p className="text-white/80">
                            베센트 재무장관은 스테이블코인 시총이 2조 달러까지 성장할 수 있다는 전망을 합리적이라고 평가했습니다.
                        </p>
                    </div>
                </div>

                <div className="bg-purple-500/20 p-6 rounded-lg border-l-4 border-purple-400">
                    <h4 className="font-bold text-white mb-2">🌍 해외 거래소의 특성</h4>
                    <p className="text-white/80">
                        한국을 제외한 해외 거래소에서는 비트코인을 USDT 등 스테이블코인으로 거래합니다.
                        비트코인 시가총액이 2조 달러이고, 만약 이를 모두 스테이블코인으로 전환한다면 스테이블코인 시장이 즉시 2조 달러로 확대될 수 있습니다.
                    </p>
                </div>
            </div>
        </section>

        
        <section className="simulator-container p-8 mb-16 relative">
            <div className="relative z-10">
                <h2 className="text-3xl font-bold text-white text-center mb-8">🎮 Part 3: 스테이블코인 시나리오 시뮬레이터</h2>

                <div className="bg-white/10 p-6 rounded-lg mb-8">
                    <h3 className="text-xl font-bold text-white mb-6 text-center">📊 변수 조작 패널</h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                        <div>
                            <label htmlFor="growthRate" className="block text-white mb-2 font-semibold">스테이블코인 성장률 (%)</label>
                            <input type="range" id="growthRate" onChange={(event) => setGrowth(Number(event.target.value))} min="200" max="800" value={growth} className="w-full" />
                            <div className="text-center text-white mt-2" id="growthDisplay">{growth}%</div>
                        </div>
                        <div>
                            <label htmlFor="foreignRatio" className="block text-white mb-2 font-semibold">해외 자금 비중 (%)</label>
                            <input type="range" id="foreignRatio" onChange={(event) => setForeign(Number(event.target.value))} min="30" max="80" value={foreign} className="w-full" />
                            <div className="text-center text-white mt-2" id="foreignDisplay">{foreign}%</div>
                        </div>
                        <div>
                            <label htmlFor="targetYear" className="block text-white mb-2 font-semibold">목표 연도</label>
                            <input type="range" id="targetYear" onChange={(event) => setYear(Number(event.target.value))} min="2025" max="2030" value={year} className="w-full" />
                            <div className="text-center text-white mt-2" id="yearDisplay">{year}</div>
                        </div>
                    </div>

                    <button id="simulateBtn" type="button" onClick={() => setResults({ marketCap: 0.25 * growth / 100, bondDemand: 0.25 * growth / 100 * foreign / 100, liquidity: growth / 100 })}
                        className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold py-3 px-6 rounded-lg text-lg hover:from-yellow-600 hover:to-orange-600 transition-all">
                        시뮬레이션 실행
                    </button>
                </div>

                <div id="simulationResults" aria-live="polite" className={`grid grid-cols-1 md:grid-cols-3 gap-6${results ? "" : " hidden"}`}>
                    <div className="bg-white/20 p-6 rounded-lg text-center">
                        <h4 className="font-bold text-white mb-2">예상 스테이블코인 시가총액</h4>
                        <div id="marketCapResult" className="text-3xl font-bold text-yellow-400">{results?.marketCap.toFixed(1) ?? "--"}</div>
                        <p className="text-white/70 text-sm mt-2">조 달러</p>
                    </div>
                    <div className="bg-white/20 p-6 rounded-lg text-center">
                        <h4 className="font-bold text-white mb-2">美 국채 추가 수요</h4>
                        <div id="bondDemandResult" className="text-3xl font-bold text-green-400">{results?.bondDemand.toFixed(1) ?? "--"}</div>
                        <p className="text-white/70 text-sm mt-2">조 달러</p>
                    </div>
                    <div className="bg-white/20 p-6 rounded-lg text-center">
                        <h4 className="font-bold text-white mb-2">유동성 공급 효과</h4>
                        <div id="liquidityResult" className="text-3xl font-bold text-blue-400">{results?.liquidity.toFixed(1) ?? "--"}</div>
                        <p className="text-white/70 text-sm mt-2">배 증가</p>
                    </div>
                </div>
            </div>
        </section>

        
        <section className="masterplan-card p-8 mb-16">
            <div className="relative z-10">
                <h2 className="text-3xl font-bold text-white text-center mb-8">📈 Part 4: 새로운 시대의 투자 전략</h2>

                <div className="mb-8">
                    <h3 className="text-2xl font-bold text-white mb-6 text-center">🎯 자산 클래스 매력도 분석</h3>
                    <p className="text-white/80 text-center mb-8 max-w-3xl mx-auto">
                        정부 주도, 인플레이션 동반 성장 환경에서는 자산의 매력도가 재평가됩니다.
                        정부 지원을 받는 성장 자산과 인플레이션 헤지 능력이 중요해집니다.
                    </p>

                    <div className="chart-container mb-8">
                        <div style={{ height: 400 }}><StablecoinChart id="assetAttractivenessChart" /></div>
                    </div>
                </div>

                <div className="flex justify-center border-b mb-8">
                    <button id="winnersTab" type="button" aria-pressed={tab === "winners"} onClick={() => setTab("winners")} className={`interactive-tab py-3 px-6 rounded-t-lg${tab === "winners" ? " active" : ""}`}>🏆 승자 그룹</button>
                    <button id="cautionTab" type="button" aria-pressed={tab === "caution"} onClick={() => setTab("caution")} className={`interactive-tab py-3 px-6 rounded-t-lg${tab === "caution" ? " active" : ""}`}>⚠️ 주의 그룹</button>
                    <button id="indexTab" type="button" aria-pressed={tab === "index"} onClick={() => setTab("index")} className={`interactive-tab py-3 px-6 rounded-t-lg${tab === "index" ? " active" : ""}`}>📊 지수 투자</button>
                </div>

                <div id="winnersContent" className={`tab-content${tab === "winners" ? "" : " hidden"}`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-green-500/20 p-6 rounded-lg border-l-4 border-green-400">
                            <h4 className="font-bold text-white mb-4">🚀 정부 육성 전략 산업</h4>
                            <ul className="space-y-2 text-white/80">
                                <li>• <strong>AI</strong>: 정부 집중 투자 분야</li>
                                <li>• <strong>반도체</strong>: CHIPS Act 수혜</li>
                                <li>• <strong>방산</strong>: 지정학적 리스크 대응</li>
                                <li>• <strong>원전</strong>: 에너지 전환 핵심</li>
                            </ul>
                        </div>
                        <div className="bg-yellow-500/20 p-6 rounded-lg border-l-4 border-yellow-400">
                            <h4 className="font-bold text-white mb-4">🛡️ 인플레이션 헤지 자산</h4>
                            <ul className="space-y-2 text-white/80">
                                <li>• <strong>원자재</strong>: 1990년 이전 최상위 성과</li>
                                <li>• <strong>금</strong>: 전통적 안전자산</li>
                                <li>• <strong>부동산</strong>: 실물자산 헤지</li>
                                <li>• <strong>에너지</strong>: 구조적 수요 증가</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div id="cautionContent" className={`tab-content${tab === "caution" ? "" : " hidden"}`}>
                    <div className="bg-red-500/20 p-6 rounded-lg border-l-4 border-red-400">
                        <h4 className="font-bold text-white mb-4">⚠️ 주의가 필요한 자산군</h4>
                        <p className="text-white/80 mb-4">
                            전통적인 안전자산인 장기 채권은 금리 통제와 인플레이션 압력으로 인해 과거보다 헤지 능력이 약화될 수 있습니다.
                        </p>
                        <ul className="space-y-2 text-white/80">
                            <li>• <strong>장기 국채</strong>: 금리 상승 압력</li>
                            <li>• <strong>유틸리티</strong>: 높은 이자 부담</li>
                            <li>• <strong>REIT</strong>: 금리 민감성</li>
                            <li>• <strong>디플레이션 수혜주</strong>: 환경 변화</li>
                        </ul>
                    </div>
                </div>

                <div id="indexContent" className={`tab-content${tab === "index" ? "" : " hidden"}`}>
                    <div className="bg-blue-500/20 p-6 rounded-lg border-l-4 border-blue-400">
                        <h4 className="font-bold text-white mb-4">📊 지수 투자의 유효성</h4>
                        <p className="text-white/80 mb-4">
                            전략 산업의 핵심인 빅테크 기업들이 S&amp;P 500과 나스닥에 집중되어 있어, 지수 투자 역시 유효한 전략입니다.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h5 className="font-bold text-white mb-2">S&amp;P 500</h5>
                                <p className="text-white/70 text-sm">AI 혁명의 핵심 기업들이 상위 가중치를 차지</p>
                            </div>
                            <div>
                                <h5 className="font-bold text-white mb-2">NASDAQ</h5>
                                <p className="text-white/70 text-sm">기술주 중심으로 정부 육성 산업과 직결</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        
        <section className="masterplan-card p-8 mb-16">
            <div className="relative z-10">
                <h2 className="text-3xl font-bold text-white text-center mb-8">⚠️ Part 5: 리스크 시나리오와 대응</h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-red-500/20 p-6 rounded-lg border-l-4 border-red-400">
                        <div className="risk-badge text-white text-sm font-bold px-3 py-1 rounded-full mb-4 inline-block">단기
                            리스크</div>
                        <h3 className="font-bold text-white mb-3">💥 단기 유동성 충격</h3>
                        <p className="text-white/80 text-sm mb-4">
                            부채한도 협상 타결 후 대규모 국채 발행 시, 일시적 시장 유동성 흡수로 조정이 발생할 수 있습니다.
                        </p>
                        <div className="bg-white/10 p-3 rounded">
                            <p className="text-white/70 text-xs">대응: 7-8월 조정 가능성 대비</p>
                        </div>
                    </div>

                    <div className="bg-orange-500/20 p-6 rounded-lg border-l-4 border-orange-400">
                        <div className="risk-badge text-white text-sm font-bold px-3 py-1 rounded-full mb-4 inline-block">
                            지정학 리스크</div>
                        <h3 className="font-bold text-white mb-3">🌏 분쟁의 동진 현상</h3>
                        <p className="text-white/80 text-sm mb-4">
                            분쟁의 동진(東進) 현상, 특히 대만 해협 등에서의 충돌은 글로벌 경제 질서에 큰 충격을 줄 수 있습니다.
                        </p>
                        <div className="bg-white/10 p-3 rounded">
                            <p className="text-white/70 text-xs">대응: 안전자산 비중 조절</p>
                        </div>
                    </div>

                    <div className="bg-purple-500/20 p-6 rounded-lg border-l-4 border-purple-400">
                        <div className="risk-badge text-white text-sm font-bold px-3 py-1 rounded-full mb-4 inline-block">정책
                            리스크</div>
                        <h3 className="font-bold text-white mb-3">🎯 정책 실패 리스크</h3>
                        <p className="text-white/80 text-sm mb-4">
                            스테이블코인 시장이 예상만큼 성장하지 못하거나 해외 자금 유입에 실패하면 전략 효과가 반감됩니다.
                        </p>
                        <div className="bg-white/10 p-3 rounded">
                            <p className="text-white/70 text-xs">대응: 다각화된 포트폴리오</p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 bg-yellow-500/20 p-6 rounded-lg border-l-4 border-yellow-400">
                    <h4 className="font-bold text-white mb-2">📅 주요 일정</h4>
                    <p className="text-white/80">
                        8월 이전에 부채 한도 협상이 타결될 것으로 예상되며, 협상이 타결되면 대규모 국채 발행으로 TGA 잔고를 채우는 과정에서
                        일시적으로 시중 유동성이 긴축될 가능성이 있어 7-8월 조정을 주의해야 합니다.
                    </p>
                </div>
            </div>
        </section>

        
        <section className="masterplan-card p-8 mb-16">
            <div className="relative z-10">
                <h2 className="text-3xl font-bold text-white text-center mb-8">🎯 2028년까지의 로드맵</h2>

                <div className="text-center mb-12">
                    <div className="text-6xl mb-4">🗺️</div>
                    <p className="text-xl text-white/80 max-w-3xl mx-auto">
                        앞으로 항상 인플레이션을 동반하는 성장 사이클로 움직일 것이며,
                        스테이블코인 2조 달러 목표 달성을 통해 새로운 달러 패권 시대를 열어갈 것입니다.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="text-center">
                        <div className="bg-blue-500/20 p-6 rounded-lg">
                            <div className="text-4xl mb-2">📊</div>
                            <h4 className="font-bold text-white">2025</h4>
                            <p className="text-white/70 text-sm">GENIUS Act 시행</p>
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="bg-purple-500/20 p-6 rounded-lg">
                            <div className="text-4xl mb-2">🚀</div>
                            <h4 className="font-bold text-white">2026</h4>
                            <p className="text-white/70 text-sm">스테이블코인 급성장</p>
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="bg-green-500/20 p-6 rounded-lg">
                            <div className="text-4xl mb-2">🎯</div>
                            <h4 className="font-bold text-white">2027</h4>
                            <p className="text-white/70 text-sm">1조 달러 돌파</p>
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="bg-yellow-500/20 p-6 rounded-lg">
                            <div className="text-4xl mb-2">👑</div>
                            <h4 className="font-bold text-white">2028</h4>
                            <p className="text-white/70 text-sm">2조 달러 달성</p>
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-8 rounded-lg border border-white/20">
                    <h3 className="text-2xl font-bold text-white text-center mb-6">🏆 투자자 실행 가이드</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="font-bold text-white mb-3">📈 우선 배분</h4>
                            <ul className="space-y-2 text-white/80">
                                <li>• 정부 육성 산업 (AI, 반도체, 방산)</li>
                                <li>• 인플레이션 헤지 자산 (원자재, 금)</li>
                                <li>• 주요 지수 (S&amp;P 500, 나스닥)</li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-white mb-3">⚖️ 리스크 관리</h4>
                            <ul className="space-y-2 text-white/80">
                                <li>• 7-8월 단기 조정 대비</li>
                                <li>• 지정학적 리스크 모니터링</li>
                                <li>• 유동성 상황 지속 점검</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </section>

    </div>

    






  </div>;
}
