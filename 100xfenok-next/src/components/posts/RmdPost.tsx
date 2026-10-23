"use client";

import { useEffect, useRef } from "react";
import { mountRmdPost } from "./rmd-runtime";

export default function RmdPost() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (root.current) return mountRmdPost(root.current); }, []);
  return <div ref={root} className="native-post-rmd">






    <div className="fixed top-1/4 -translate-y-1/2 right-0 z-40 group">

    </div>

    <section id="hero" className="hero-section">
        <div className="hero-background">
            <div className="hero-overlay"></div>
            <div className="hero-particles"></div>
        </div>

        <div className="container-fluid">
            <div className="row min-vh-100 align-items-center">
                <div className="col-lg-6">
                    <div className="hero-content fade-in">
                        <div className="hero-badge mb-3">
                            <i className="fas fa-star me-2"></i>
                            Alpha Pick #1
                        </div>

                        <h1 className="hero-title">
                            <span className="text-accent">ResMed</span><br />
                            <span className="hero-subtitle">독점적 시장 지위의 복리 성장주</span>
                        </h1>

                        <div className="hero-stock-card">
                            <div className="stock-info">
                                <div className="stock-ticker">RMD</div>
                                <div className="stock-price">$255.16</div>
                                <div className="stock-change positive">+2.8% (24h)</div>
                            </div>
                            <div className="stock-score">
                                <div className="score-label">종합 점수</div>
                                <div className="score-value">89.5</div>
                            </div>
                        </div>

                        <p className="hero-description">
                            경쟁사 Philips의 대규모 리콜 사태 이후 미국 CPAP 시장에서 80% 이상의 압도적 점유율을 확보한 ResMed는
                            업계 최고 수준의 ROIC 21.2%와 함께 GLP-1 약물 확산이라는 잘못 인식된 기회까지 보유한 완벽한 투자처입니다.
                        </p>

                        <div className="hero-actions">
                            <a href="#dashboard" className="btn btn--primary btn--lg">
                                <i className="fas fa-chart-line me-2"></i>
                                상세 분석 보기
                            </a>
                            <a href="#portfolio" className="btn btn--secondary btn--lg">
                                <i className="fas fa-briefcase me-2"></i>
                                포트폴리오 구성
                            </a>
                        </div>

                        <div className="hero-stats">
                            <div className="stat-item">
                                <div className="stat-value">+25%</div>
                                <div className="stat-label">6개월 목표 수익률</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-value">21.2%</div>
                                <div className="stat-label">ROIC</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-value">80%+</div>
                                <div className="stat-label">시장 점유율</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-6">
                    <div className="hero-visual">
                        <div className="investment-cards">
                            <div className="investment-card primary fade-in" style={{"animationDelay": "0.2s"}}>
                                <div className="card-icon">
                                    <i className="fas fa-crown"></i>
                                </div>
                                <h3>독점적 시장 지위</h3>
                                <p>경쟁사 리콜 사태로 인한 80% 이상의 압도적 시장 점유율</p>
                                <div className="card-metric">
                                    <span className="metric-value">2,900만+</span>
                                    <span className="metric-label">커넥티드 기기</span>
                                </div>
                            </div>

                            <div className="investment-card secondary fade-in" style={{"animationDelay": "0.4s"}}>
                                <div className="card-icon">
                                    <i className="fas fa-flask"></i>
                                </div>
                                <h3>GLP-1 기회</h3>
                                <p>체중 감량 약물 확산이 오히려 수면무호흡 진단률을 높이는 역설적 기회</p>
                                <div className="card-metric">
                                    <span className="metric-value">+10.8%</span>
                                    <span className="metric-label">진단률 증가</span>
                                </div>
                            </div>

                            <div className="investment-card tertiary fade-in" style={{"animationDelay": "0.6s"}}>
                                <div className="card-icon">
                                    <i className="fas fa-chart-line"></i>
                                </div>
                                <h3>탁월한 자본 효율성</h3>
                                <p>업계 최고 수준의 ROIC와 지속적인 R&D 재투자로 경쟁우위 강화</p>
                                <div className="card-metric">
                                    <span className="metric-value">220억+</span>
                                    <span className="metric-label">수면 데이터 포인트</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="dashboard" className="dashboard-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-12">
                    <div className="section-header text-center">
                        <h2 className="section-title fade-in">
                            <i className="fas fa-tachometer-alt me-3"></i>
                            투자 분석 대시보드
                        </h2>
                        <p className="section-description fade-in">
                            실시간 데이터 기반의 종합적인 투자 분석 및 의사결정 지원 시스템
                        </p>
                    </div>
                </div>
            </div>

            <div className="row g-4">
                <div className="col-xl-8">
                    <div className="dashboard-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-chart-bar me-2"></i>
                                최종 가중 점수 비교
                            </h3>
                            <div className="card-controls">
                                <button className="btn btn--sm btn--outline" data-refresh="comparison" aria-label="비교 차트 새로고침">
                                    <i className="fas fa-sync-alt"></i>
                                </button>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="chart-container">
                                <canvas id="comparisonChart"></canvas>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-xl-4">
                    <div className="dashboard-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-ranking-star me-2"></i>
                                순위 및 점수
                            </h3>
                        </div>
                        <div className="card-body">
                            <div className="ranking-list">
                                <div className="rank-item gold">
                                    <div className="rank-badge">1</div>
                                    <div className="rank-info">
                                        <div className="rank-name">ResMed</div>
                                        <div className="rank-ticker">RMD</div>
                                    </div>
                                    <div className="rank-score">89.5</div>
                                </div>
                                <div className="rank-item silver">
                                    <div className="rank-badge">2</div>
                                    <div className="rank-info">
                                        <div className="rank-name">Trimble</div>
                                        <div className="rank-ticker">TRMB</div>
                                    </div>
                                    <div className="rank-score">80.9</div>
                                </div>
                                <div className="rank-item bronze">
                                    <div className="rank-badge">3</div>
                                    <div className="rank-info">
                                        <div className="rank-name">Abbott</div>
                                        <div className="rank-ticker">ABT</div>
                                    </div>
                                    <div className="rank-score">79.4</div>
                                </div>
                                <div className="rank-item">
                                    <div className="rank-badge">4</div>
                                    <div className="rank-info">
                                        <div className="rank-name">Edwards</div>
                                        <div className="rank-ticker">EW</div>
                                    </div>
                                    <div className="rank-score">74.4</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="competency" className="analysis-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-12">
                    <div className="section-header text-center">
                        <h2 className="section-title fade-in">
                            <i className="fas fa-spider me-3"></i>
                            핵심 역량 분석
                        </h2>
                        <p className="section-description fade-in">
                            15개 평가 기준에 따른 4개 기업의 종합적인 역량 비교 분석
                        </p>
                    </div>
                </div>
            </div>

            <div className="row g-4">
                <div className="col-lg-8">
                    <div className="analysis-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-radar me-2"></i>
                                레이더 차트 분석
                            </h3>
                        </div>
                        <div className="card-body">
                            <div className="chart-container">
                                <canvas id="competencyChart"></canvas>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-4">
                    <div className="analysis-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-list me-2"></i>
                                범례 및 제어
                            </h3>
                        </div>
                        <div className="card-body">
                            <div className="legend-controls">
                                <div className="legend-item active" data-company="RMD">
                                    <span className="legend-dot rmd"></span>
                                    <span className="legend-label">ResMed</span>
                                    <span className="legend-score">89.5</span>
                                </div>
                                <div className="legend-item active" data-company="TRMB">
                                    <span className="legend-dot trmb"></span>
                                    <span className="legend-label">Trimble</span>
                                    <span className="legend-score">80.9</span>
                                </div>
                                <div className="legend-item active" data-company="ABT">
                                    <span className="legend-dot abt"></span>
                                    <span className="legend-label">Abbott</span>
                                    <span className="legend-score">79.4</span>
                                </div>
                                <div className="legend-item active" data-company="EW">
                                    <span className="legend-dot ew"></span>
                                    <span className="legend-label">Edwards</span>
                                    <span className="legend-score">74.4</span>
                                </div>
                            </div>

                            <div className="evaluation-criteria">
                                <h4>평가 기준</h4>
                                <div className="criteria-grid">
                                    <div className="criteria-item">저평가</div>
                                    <div className="criteria-item">성장성</div>
                                    <div className="criteria-item">경기방어력</div>
                                    <div className="criteria-item">해자</div>
                                    <div className="criteria-item">경영진</div>
                                    <div className="criteria-item">자본효율성</div>
                                    <div className="criteria-item">촉매 요인</div>
                                    <div className="criteria-item">밸류에이션</div>
                                    <div className="criteria-item">재평가 가능성</div>
                                    <div className="criteria-item">시장 심리</div>
                                    <div className="criteria-item">애널리스트 전망</div>
                                    <div className="criteria-item">기술 혁신</div>
                                    <div className="criteria-item">시장 지위</div>
                                    <div className="criteria-item">재무 건전성</div>
                                    <div className="criteria-item">주주 환원</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="scenarios" className="analysis-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-12">
                    <div className="section-header text-center">
                        <h2 className="section-title fade-in">
                            <i className="fas fa-chart-area me-3"></i>
                            시나리오 분석
                        </h2>
                        <p className="section-description fade-in">
                            6개월 투자 기간 동안의 상승/하락 시나리오 vs S&P 500 벤치마크 비교
                        </p>
                    </div>
                </div>
            </div>

            <div className="row">
                <div className="col-12">
                    <div className="analysis-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-chart-line me-2"></i>
                                6개월 수익률 시나리오
                            </h3>
                            <div className="scenario-legend">
                                <div className="legend-item">
                                    <span className="legend-dot bull"></span>
                                    <span>상승 시나리오</span>
                                </div>
                                <div className="legend-item">
                                    <span className="legend-dot bear"></span>
                                    <span>하락 시나리오</span>
                                </div>
                                <div className="legend-item">
                                    <span className="legend-dot sp500"></span>
                                    <span>S&P 500 기준</span>
                                </div>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="chart-container">
                                <canvas id="scenarioChart"></canvas>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="financials" className="analysis-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-12">
                    <div className="section-header text-center">
                        <h2 className="section-title fade-in">
                            <i className="fas fa-calculator me-3"></i>
                            재무 분석
                        </h2>
                        <p className="section-description fade-in">
                            핵심 재무 지표 및 밸류에이션 분석 (카드를 클릭하여 다음 보기)
                        </p>
                    </div>
                </div>
            </div>

            <div className="row g-4">
                <div className="col-lg-6">
                    <div className="flippable-card-container h-100">
                        <div className="card-inner">
                            <div className="card-front">
                                <div className="financial-card h-200">
                                    <div className="card-header">
                                        <h3 className="card-title"><i className="fas fa-chart-pie me-2"></i>핵심 재무 지표 (1/2)</h3>
                                    </div>
                                    <div className="card-body">
                                        <div className="financial-metrics">
                                            <div className="metric-group">
                                                <h4>ResMed (RMD)</h4>
                                                <div className="metric-row"><span>P/E Ratio</span><span
                                                        className="metric-value">28.5</span></div>
                                                <div className="metric-row"><span>EV/EBITDA</span><span
                                                        className="metric-value">17.0</span></div>
                                                <div className="metric-row"><span>ROIC</span><span
                                                        className="metric-value highlight">21.2%</span></div>
                                                <div className="metric-row"><span>FCF Yield</span><span
                                                        className="metric-value">3.9%</span></div>
                                            </div>
                                            <div className="metric-group">
                                                <h4>Trimble (TRMB)</h4>
                                                <div className="metric-row"><span>P/E Ratio</span><span
                                                        className="metric-value">23.0</span></div>
                                                <div className="metric-row"><span>EV/EBITDA</span><span
                                                        className="metric-value">17.0</span></div>
                                                <div className="metric-row"><span>ARR Growth</span><span
                                                        className="metric-value highlight">17% YoY</span></div>
                                                <div className="metric-row"><span>TAM</span><span
                                                        className="metric-value">$70B+</span></div>
                                            </div>
                                        </div>
                                        <div className="flip-indicator"><i className="fas fa-sync-alt me-2"></i> 클릭하여 다음 지표 보기
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="card-back">
                                <div className="financial-card h-200">
                                    <div className="card-header">
                                        <h3 className="card-title"><i className="fas fa-chart-pie me-2"></i>핵심 재무 지표 (2/2)</h3>
                                    </div>
                                    <div className="card-body">
                                        <div className="financial-metrics">
                                            <div className="metric-group">
                                                <h4>Abbott (ABT)</h4>
                                                <div className="metric-row"><span>P/E Ratio</span><span
                                                        className="metric-value">17.4</span></div>
                                                <div className="metric-row"><span>EV/EBITDA</span><span
                                                        className="metric-value">18.5</span></div>
                                                <div className="metric-row"><span>ROIC</span><span
                                                        className="metric-value highlight">10.9%</span></div>
                                                <div className="metric-row"><span>FCF Yield</span><span
                                                        className="metric-value">6.3%</span></div>
                                            </div>
                                            <div className="metric-group">
                                                <h4>Edwards (EW)</h4>
                                                <div className="metric-row"><span>P/E Ratio</span><span
                                                        className="metric-value">25.3</span></div>
                                                <div className="metric-row"><span>EV/EBITDA</span><span
                                                        className="metric-value">23.0</span></div>
                                                <div className="metric-row"><span>ROIC</span><span
                                                        className="metric-value highlight">20.1%</span></div>
                                                <div className="metric-row"><span>FCF Yield</span><span
                                                        className="metric-value">4.0%</span></div>
                                            </div>
                                        </div>
                                        <div className="flip-indicator"><i className="fas fa-undo me-2"></i> 클릭하여 되돌아가기</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-6">
                    <div className="financial-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-balance-scale me-2"></i>
                                밸류에이션 비교
                            </h3>
                        </div>
                        <div className="card-body">
                            <div className="valuation-table">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>기업</th>
                                            <th>현재가</th>
                                            <th>목표가</th>
                                            <th>상승여력</th>
                                            <th>리스크</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="highlight">
                                            <td><strong>ResMed</strong></td>
                                            <td>$255.16</td>
                                            <td>$295.00</td>
                                            <td className="positive">+15.5%</td>
                                            <td><span className="badge badge-medium">중간</span></td>
                                        </tr>
                                        <tr>
                                            <td><strong>Trimble</strong></td>
                                            <td>$67.50</td>
                                            <td>$76.00</td>
                                            <td className="positive">+12.8%</td>
                                            <td><span className="badge badge-high">중상</span></td>
                                        </tr>
                                        <tr>
                                            <td><strong>Abbott</strong></td>
                                            <td>$115.20</td>
                                            <td>$125.00</td>
                                            <td className="positive">+8.5%</td>
                                            <td><span className="badge badge-low">낮음</span></td>
                                        </tr>
                                        <tr>
                                            <td><strong>Edwards</strong></td>
                                            <td>$89.30</td>
                                            <td>$95.50</td>
                                            <td className="positive">+7.2%</td>
                                            <td><span className="badge badge-high">높음</span></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="risk" className="analysis-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-12">
                    <div className="section-header text-center">
                        <h2 className="section-title fade-in">
                            <i className="fas fa-shield-alt me-3"></i>
                            리스크 평가
                        </h2>
                        <p className="section-description fade-in">
                            종합적인 리스크 분석 및 관리 전략
                        </p>
                    </div>
                </div>
            </div>

            <div className="row g-4">
                <div className="col-lg-8">
                    <div className="risk-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-exclamation-triangle me-2"></i>
                                리스크 매트릭스
                            </h3>
                        </div>
                        <div className="card-body">
                            <div className="risk-matrix">
                                <div className="risk-item low">
                                    <div className="risk-company">Abbott</div>
                                    <div className="risk-level">낮은 리스크</div>
                                    <div className="risk-factors">
                                        <span className="factor">다각화 포트폴리오</span>
                                        <span className="factor">안정적 현금흐름</span>
                                        <span className="factor">경기 방어력</span>
                                    </div>
                                </div>

                                <div className="risk-item medium">
                                    <div className="risk-company">ResMed</div>
                                    <div className="risk-level">중간 리스크</div>
                                    <div className="risk-factors">
                                        <span className="factor">독점적 지위</span>
                                        <span className="factor">규제 변화</span>
                                        <span className="factor">경쟁 복귀</span>
                                    </div>
                                </div>

                                <div className="risk-item high">
                                    <div className="risk-company">Trimble</div>
                                    <div className="risk-level">중상 리스크</div>
                                    <div className="risk-factors">
                                        <span className="factor">경기 민감도</span>
                                        <span className="factor">전환 리스크</span>
                                        <span className="factor">기술 경쟁</span>
                                    </div>
                                </div>

                                <div className="risk-item high">
                                    <div className="risk-company">Edwards</div>
                                    <div className="risk-level">높은 리스크</div>
                                    <div className="risk-factors">
                                        <span className="factor">규제 승인</span>
                                        <span className="factor">임상 실패</span>
                                        <span className="factor">시장 변동</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-4">
                    <div className="risk-card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-chart-line me-2"></i>
                                VaR 분석
                            </h3>
                        </div>
                        <div className="card-body">
                            <div className="var-analysis">
                                <div className="var-item">
                                    <div className="var-label">95% 신뢰구간 (6개월)</div>
                                    <div className="var-value">-12.1%</div>
                                </div>
                                <div className="var-item">
                                    <div className="var-label">99% 신뢰구간 (6개월)</div>
                                    <div className="var-value">-17.8%</div>
                                </div>
                                <div className="var-item">
                                    <div className="var-label">최대 예상 손실</div>
                                    <div className="var-value">-25%</div>
                                </div>
                            </div>

                            <div className="risk-management">
                                <h4>리스크 관리 전략</h4>
                                <ul>
                                    <li>개별 종목 최대 5% 제한</li>
                                    <li>손절매 기준: -15%</li>
                                    <li>이익실현: +20%</li>
                                    <li>주간 리뷰 및 월간 재평가</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="portfolio" className="analysis-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-12">
                    <div className="section-header text-center">
                        <h2 className="section-title fade-in">
                            <i className="fas fa-briefcase me-3"></i>
                            포트폴리오 최적화
                        </h2>
                        <p className="section-description fade-in">
                            리스크 성향별 최적 포트폴리오 구성 권고안
                        </p>
                    </div>
                </div>
            </div>

            <div className="row g-4">
                <div className="col-lg-4">
                    <div className="portfolio-card conservative">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-shield me-2"></i>
                                보수적 포트폴리오
                            </h3>
                            <div className="portfolio-stats">
                                <div className="stat">
                                    <span className="stat-label">예상 수익률</span>
                                    <span className="stat-value">+10.2%</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">리스크 수준</span>
                                    <span className="stat-value low">낮음</span>
                                </div>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="allocation-chart">
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill abt" style={{"width": "40%"}}></div>
                                    </div>
                                    <div className="allocation-label">Abbott 40%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill rmd" style={{"width": "25%"}}></div>
                                    </div>
                                    <div className="allocation-label">ResMed 25%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill trmb" style={{"width": "20%"}}></div>
                                    </div>
                                    <div className="allocation-label">Trimble 20%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill ew" style={{"width": "15%"}}></div>
                                    </div>
                                    <div className="allocation-label">Edwards 15%</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-4">
                    <div className="portfolio-card balanced recommended">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-balance-scale me-2"></i>
                                균형 포트폴리오
                                <span className="recommended-badge">추천</span>
                            </h3>
                            <div className="portfolio-stats">
                                <div className="stat">
                                    <span className="stat-label">예상 수익률</span>
                                    <span className="stat-value">+11.4%</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">리스크 수준</span>
                                    <span className="stat-value medium">중간</span>
                                </div>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="allocation-chart">
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill rmd" style={{"width": "35%"}}></div>
                                    </div>
                                    <div className="allocation-label">ResMed 35%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill trmb" style={{"width": "30%"}}></div>
                                    </div>
                                    <div className="allocation-label">Trimble 30%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill abt" style={{"width": "25%"}}></div>
                                    </div>
                                    <div className="allocation-label">Abbott 25%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill ew" style={{"width": "10%"}}></div>
                                    </div>
                                    <div className="allocation-label">Edwards 10%</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-4">
                    <div className="portfolio-card aggressive">
                        <div className="card-header">
                            <h3 className="card-title">
                                <i className="fas fa-rocket me-2"></i>
                                공격적 포트폴리오
                            </h3>
                            <div className="portfolio-stats">
                                <div className="stat">
                                    <span className="stat-label">예상 수익률</span>
                                    <span className="stat-value">+12.8%</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">리스크 수준</span>
                                    <span className="stat-value high">높음</span>
                                </div>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="allocation-chart">
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill rmd" style={{"width": "45%"}}></div>
                                    </div>
                                    <div className="allocation-label">ResMed 45%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill trmb" style={{"width": "35%"}}></div>
                                    </div>
                                    <div className="allocation-label">Trimble 35%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill abt" style={{"width": "15%"}}></div>
                                    </div>
                                    <div className="allocation-label">Abbott 15%</div>
                                </div>
                                <div className="allocation-item">
                                    <div className="allocation-bar">
                                        <div className="allocation-fill ew" style={{"width": "5%"}}></div>
                                    </div>
                                    <div className="allocation-label">Edwards 5%</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="profiles" className="analysis-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-12">
                    <div className="section-header text-center">
                        <h2 className="section-title fade-in">
                            <i className="fas fa-building me-3"></i>
                            기업 상세 분석
                        </h2>
                        <p className="section-description fade-in">
                            각 기업의 핵심 투자 포인트와 특징 분석
                        </p>
                    </div>
                </div>
            </div>

            <div className="row g-4">
                <div className="col-lg-6 col-xl-3">
                    <div className="company-card rmd fade-in">
                        <div className="card-inner">
                            <div className="card-front">
                                <div className="company-logo">
                                    <i className="fas fa-bed"></i>
                                </div>
                                <div className="company-info">
                                    <h3 className="company-ticker">RMD</h3>
                                    <p className="company-name">ResMed</p>
                                    <div className="company-score">89.5</div>
                                </div>
                                <div className="company-type">
                                    높은 해자를 가진 디지털 헬스 복리 성장주
                                </div>
                                <div className="flip-indicator">
                                    <i className="fas fa-sync-alt"></i>
                                    상세 정보 클릭
                                </div>
                            </div>
                            <div className="card-back">
                                <div className="company-details">
                                    <h4>핵심 강점</h4>
                                    <ul>
                                        <li>2,900만+ 커넥티드 기기</li>
                                        <li>220억+ 수면 데이터 포인트</li>
                                        <li>1만+ 특허 포트폴리오</li>
                                        <li>80%+ CPAP 시장 점유율</li>
                                    </ul>

                                    <h4>투자 논리</h4>
                                    <p>경쟁사 Philips의 대규모 리콜 사태 이후 독점적 시장 지위를 확보하고, GLP-1 약물 확산이 오히려 수면무호흡 진단률을 높이는 역설적
                                        기회를 보유</p>

                                    <div className="target-metrics">
                                        <div className="metric">
                                            <span className="metric-label">목표 수익률</span>
                                            <span className="metric-value">+15.5%</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-label">리스크 수준</span>
                                            <br />
                                            <span className="metric-value">중간</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-6 col-xl-3">
                    <div className="company-card trmb fade-in">
                        <div className="card-inner">
                            <div className="card-front">
                                <div className="company-logo">
                                    <i className="fas fa-drafting-compass"></i>
                                </div>
                                <div className="company-info">
                                    <h3 className="company-ticker">TRMB</h3>
                                    <p className="company-name">Trimble</p>
                                    <div className="company-score">80.9</div>
                                </div>
                                <div className="company-type">
                                    소프트웨어 전환 및 가치주 투자
                                </div>
                                <div className="flip-indicator">
                                    <i className="fas fa-sync-alt"></i>
                                    상세 정보 클릭
                                </div>
                            </div>
                            <div className="card-back">
                                <div className="company-details">
                                    <h4>핵심 강점</h4>
                                    <ul>
                                        <li>79% 소프트웨어/서비스 매출</li>
                                        <li>AECO 시장 리더</li>
                                        <li>$3B ARR 목표</li>
                                        <li>17% YoY ARR 성장</li>
                                    </ul>

                                    <h4>투자 논리</h4>
                                    <p>건설, 농업 등 전통 산업 분야에서 하드웨어 중심 기업에서 고마진의 구독 기반 소프트웨어 기업으로 성공적인 전환 진행 중</p>

                                    <div className="target-metrics">
                                        <div className="metric">
                                            <span className="metric-label">목표 수익률</span>
                                            <span className="metric-value">+12.8%</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-label">리스크 수준</span>
                                            <br />
                                            <span className="metric-value">중상</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-6 col-xl-3">
                    <div className="company-card abt fade-in">
                        <div className="card-inner">
                            <div className="card-front">
                                <div className="company-logo">
                                    <i className="fas fa-heartbeat"></i>
                                </div>
                                <div className="company-info">
                                    <h3 className="company-ticker">ABT</h3>
                                    <p className="company-name">Abbott</p>
                                    <div className="company-score">79.4</div>
                                </div>
                                <div className="company-type">
                                    다각화된 방어적 리더
                                </div>
                                <div className="flip-indicator">
                                    <i className="fas fa-sync-alt"></i>
                                    상세 정보 클릭
                                </div>
                            </div>
                            <div className="card-back">
                                <div className="company-details">
                                    <h4>핵심 강점</h4>
                                    <ul>
                                        <li>다각화 포트폴리오</li>
                                        <li>글로벌 90개 생산시설</li>
                                        <li>강력한 브랜드</li>
                                        <li>53년 연속 배당 증가</li>
                                    </ul>

                                    <h4>투자 논리</h4>
                                    <p>의료기기, 진단, 영양, 제약 등 광범위한 포트폴리오를 통해 안정성과 예측 가능한 현금 흐름을 제공하는 글로벌 헬스케어 대기업</p>

                                    <div className="target-metrics">
                                        <div className="metric">
                                            <span className="metric-label">목표 수익률</span>
                                            <span className="metric-value">+8.5%</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-label">리스크 수준</span>
                                            <br />
                                            <span className="metric-value">낮음</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-lg-6 col-xl-3">
                    <div className="company-card ew fade-in">
                        <div className="card-inner">
                            <div className="card-front">
                                <div className="company-logo">
                                    <i className="fas fa-heart"></i>
                                </div>
                                <div className="company-info">
                                    <h3 className="company-ticker">EW</h3>
                                    <p className="company-name">Edwards</p>
                                    <div className="company-score">74.4</div>
                                </div>
                                <div className="company-type">
                                    구조적 심장 질환 분야의 집중형 혁신가
                                </div>
                                <div className="flip-indicator">
                                    <i className="fas fa-sync-alt"></i>
                                    상세 정보 클릭
                                </div>
                            </div>
                            <div className="card-back">
                                <div className="company-details">
                                    <h4>핵심 강점</h4>
                                    <ul>
                                        <li>TAVR 기술 선도</li>
                                        <li>TMTT 파이프라인</li>
                                        <li>임상 데이터 우위</li>
                                        <li>$2B 매출 목표 (2030)</li>
                                    </ul>

                                    <h4>투자 논리</h4>
                                    <p>경피적 대동맥판막 치환술(TAVR)과 경피적 승모판 및 삼첨판 치료(TMTT) 등 특정 고성장 분야에 집중하는 기술 기반 의료기기 기업</p>

                                    <div className="target-metrics">
                                        <div className="metric">
                                            <span className="metric-label">목표 수익률</span>
                                            <span className="metric-value">+7.2%</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-label">리스크 수준</span>
                                            <br />
                                            <span className="metric-value">높음</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>


    <section id="conclusion" className="conclusion-section">
        <div className="container-fluid">
            <div className="row">
                <div className="col-lg-10 mx-auto">
                    <div className="conclusion-content fade-in">
                        <div className="conclusion-header text-center">
                            <h2 className="section-title">
                                <i className="fas fa-trophy me-3"></i>
                                최종 투자 권고
                            </h2>
                            <p className="section-description">
                                종합적 분석을 바탕으로 한 투자 의사결정 및 실행 계획
                            </p>
                        </div>

                        <div className="conclusion-highlight mt-12">
                            <div className="highlight-content">
                                <h3>
                                    <i className="fas fa-star text-accent me-2"></i>
                                    ResMed (RMD) - 최고의 투자 기회
                                </h3>
                                <p>
                                    ResMed는 독점적 시장 지위, 탁월한 자본 효율성, 그리고 GLP-1 약물 확산이라는 잘못 인식된 기회까지
                                    모든 면에서 뛰어난 투자 가치를 제공합니다. 89.5점의 최고 점수로 4개 기업 중 명확한 1위를 차지했습니다.
                                </p>

                                <div className="highlight-metrics">
                                    <div className="metric-item">
                                        <div className="metric-icon">
                                            <i className="fas fa-crown"></i>
                                        </div>
                                        <div className="metric-content">
                                            <div className="metric-value">80%+</div>
                                            <div className="metric-label">시장 점유율</div>
                                        </div>
                                    </div>
                                    <div className="metric-item">
                                        <div className="metric-icon">
                                            <i className="fas fa-chart-line"></i>
                                        </div>
                                        <div className="metric-content">
                                            <div className="metric-value">21.2%</div>
                                            <div className="metric-label">ROIC</div>
                                        </div>
                                    </div>
                                    <div className="metric-item">
                                        <div className="metric-icon">
                                            <i className="fas fa-bullseye"></i>
                                        </div>
                                        <div className="metric-content">
                                            <div className="metric-value">+25%</div>
                                            <div className="metric-label">목표 수익률</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="row g-4">
                            <div className="col-lg-6">
                                <div className="conclusion-card">
                                    <div className="card-header">
                                        <h4>
                                            <i className="fas fa-lightbulb me-2"></i>
                                            핵심 투자 논리
                                        </h4>
                                    </div>
                                    <div className="card-body">
                                        <ul className="investment-points">
                                            <li>
                                                <strong>독점적 시장 지위:</strong>
                                                Philips 리콜 사태로 인한 80% 이상의 시장 점유율 확보
                                            </li>
                                            <li>
                                                <strong>GLP-1 기회:</strong>
                                                체중 감량 약물 확산이 오히려 수면무호흡 진단률을 10.8% 증가시킴
                                            </li>
                                            <li>
                                                <strong>자본 효율성:</strong>
                                                업계 최고 수준의 ROIC 21.2%와 지속적인 R&D 투자
                                            </li>
                                            <li>
                                                <strong>디지털 생태계:</strong>
                                                2,900만+ 커넥티드 기기와 220억+ 데이터 포인트
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div className="col-lg-6">
                                <div className="conclusion-card">
                                    <div className="card-header">
                                        <h4>
                                            <i className="fas fa-exclamation-triangle me-2"></i>
                                            주요 리스크 요인
                                        </h4>
                                    </div>
                                    <div className="card-body">
                                        <ul className="risk-points">
                                            <li>
                                                <strong>규제 리스크:</strong>
                                                FDA 승인 지연 또는 규제 환경 변화 가능성
                                            </li>
                                            <li>
                                                <strong>경쟁 리스크:</strong>
                                                Philips의 시장 복귀 가능성 (2026년 예상)
                                            </li>
                                            <li>
                                                <strong>기술 리스크:</strong>
                                                새로운 치료 방법이나 대체 기술의 등장
                                            </li>
                                            <li>
                                                <strong>시장 리스크:</strong>
                                                경기 침체 시 의료비 지출 감소 우려
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="final-recommendation">
                            <div className="recommendation-card">
                                <div className="recommendation-header">
                                    <h3>
                                        <i className="fas fa-bullseye me-2"></i>
                                        최종 투자 권고
                                    </h3>
                                </div>
                                <div className="recommendation-content">
                                    <div className="recommendation-rating">
                                        <div className="rating-label">투자 등급</div>
                                        <div className="rating-value strong-buy">매수 강력 추천</div>
                                    </div>

                                    <div className="recommendation-targets">
                                        <div className="target-item">
                                            <span className="target-label">목표 수익률</span>
                                            <span className="target-value">+15.5%</span>
                                        </div>
                                        <div className="target-item">
                                            <span className="target-label">투자 기간</span>
                                            <span className="target-value">6개월</span>
                                        </div>
                                        <div className="target-item">
                                            <span className="target-label">리스크 수준</span>
                                            <span className="target-value">중간</span>
                                        </div>
                                    </div>

                                    <div className="recommendation-summary">
                                        <p>
                                            ResMed는 현재 시장에서 가장 매력적인 투자 기회 중 하나로,
                                            독점적 시장 지위와 탁월한 자본 효율성을 바탕으로 6개월 목표 수익률 +15.5%를 달성할 수 있는
                                            높은 확률을 보여줍니다. 균형 포트폴리오에서 35% 비중으로 배분할 것을 권장합니다.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>









</div>;
}
