// Application Data
const applicationData = {
  "companies": [
    {
      "ticker": "RMD", "name": "ResMed", "finalScore": 89.5, "rank": 1, "recommendation": "STRONG BUY",
      "targetReturn": 15, "confidence": 92,
      "investmentType": "디지털 헬스케어 복합성장주", 
      "keyStrengths": ["독점적 시장 지위", "GLP-1 순풍 효과", "탁월한 자본 효율성"],
      "scenarios": {"bear": 0, "base": 15, "bull": 25, "probability": {"bull": 35, "base": 45, "bear": 20}},
      "scores": [3.0, 3.0, 4.2, 5.0, 5.0, 5.0, 4.3, 5.0, 3.5, 4.2, 3.5, 4.2, 4.9, 4.8, 4.5],
      "financials": {"pe": 28.5, "ev_ebitda": 17.0, "fcf_yield": 3.9, "roe": 21.2, "roic": 23.6, "debt_equity": 0.12, "current_ratio": 2.4, "gross_margin": 59.9, "operating_margin": 24.8},
      "risks": {"macro": "낮음", "regulatory": "중간", "competition": "낮음", "technology": "낮음", "currency": "중간", "overall": "낮음-중간"},
      "target_price": {"current": 255.16, "consensus": 277, "upside": 8.5, "jpmorgan": 290, "goldman": 275, "morgan_stanley": 265},
      "esg": {"environmental": 75, "social": 82, "governance": 88, "total": 82},
      "color": "#1E88E5"
    },
    {
      "ticker": "TRMB", "name": "Trimble", "finalScore": 80.9, "rank": 2, "recommendation": "BUY",
      "targetReturn": 12, "confidence": 78,
      "investmentType": "SaaS 전환 가치주",
      "keyStrengths": ["소프트웨어 전환", "ARR 고성장", "밸류에이션 재평가"],
      "scenarios": {"bear": -5, "base": 12, "bull": 22, "probability": {"bull": 25, "base": 50, "bear": 25}},
      "scores": [5.0, 5.0, 3.8, 3.6, 4.1, 4.3, 4.0, 3.8, 4.1, 3.8, 3.0, 4.5, 2.8, 4.1, 4.0],
      "financials": {"pe": 23.0, "ev_ebitda": 17.0, "fcf_yield": 2.9, "roe": 15.8, "roic": 18.2, "debt_equity": 0.35, "current_ratio": 1.8, "gross_margin": 66.7, "operating_margin": 19.4},
      "risks": {"macro": "높음", "regulatory": "낮음", "competition": "중간", "technology": "중간", "currency": "중간", "overall": "중간-높음"},
      "target_price": {"current": 68.45, "consensus": 83, "upside": 21.2, "jpmorgan": 88, "goldman": 78, "morgan_stanley": 82},
      "esg": {"environmental": 68, "social": 74, "governance": 79, "total": 74},
      "color": "#FF9800"
    },
    {
      "ticker": "ABT", "name": "Abbott", "finalScore": 79.4, "rank": 3, "recommendation": "HOLD",
      "targetReturn": 8, "confidence": 85,
      "investmentType": "다각화된 방어주",
      "keyStrengths": ["다각화된 포트폴리오", "경기 방어력", "안정적 현금흐름"],
      "scenarios": {"bear": -2, "base": 8, "bull": 15, "probability": {"bull": 20, "base": 60, "bear": 20}},
      "scores": [4.0, 3.0, 5.0, 4.0, 4.4, 4.0, 4.8, 3.6, 4.0, 4.5, 5.0, 4.0, 3.5, 3.6, 4.0],
      "financials": {"pe": 17.4, "ev_ebitda": 18.5, "fcf_yield": 6.3, "roe": 14.2, "roic": 11.9, "debt_equity": 0.42, "current_ratio": 1.6, "gross_margin": 57.1, "operating_margin": 21.0},
      "risks": {"macro": "낮음", "regulatory": "중간", "competition": "중간", "technology": "낮음", "currency": "중간", "overall": "낮음"},
      "target_price": {"current": 134.38, "consensus": 150, "upside": 11.6, "jpmorgan": 145, "goldman": 155, "morgan_stanley": 150},
      "esg": {"environmental": 79, "social": 85, "governance": 91, "total": 85},
      "color": "#4CAF50"
    },
    {
      "ticker": "EW", "name": "Edwards", "finalScore": 74.4, "rank": 4, "recommendation": "HOLD",
      "targetReturn": 7, "confidence": 65,
      "investmentType": "혁신기술 특화주",
      "keyStrengths": ["TMTT 파이프라인", "기술 혁신", "고성장 잠재력"],
      "scenarios": {"bear": -8, "base": 7, "bull": 15, "probability": {"bull": 15, "base": 50, "bear": 35}},
      "scores": [2.5, 3.5, 3.3, 3.5, 3.7, 3.8, 3.2, 4.2, 4.2, 3.5, 3.0, 3.8, 3.5, 3.7, 3.5],
      "financials": {"pe": 25.3, "ev_ebitda": 23.0, "fcf_yield": 4.0, "roe": 18.9, "roic": 20.1, "debt_equity": 0.28, "current_ratio": 2.1, "gross_margin": 78.7, "operating_margin": 28.5},
      "risks": {"macro": "높음", "regulatory": "높음", "competition": "중간", "technology": "높음", "currency": "낮음", "overall": "중간-높음"},
      "target_price": {"current": 78.21, "consensus": 89, "upside": 13.8, "jpmorgan": 95, "goldman": 85, "morgan_stanley": 88},
      "esg": {"environmental": 72, "social": 78, "governance": 83, "total": 78},
      "color": "#E91E63"
    }
  ],
  "evaluationCriteria": ["저평가", "성장성", "경기방어력", "자본효율성", "경영진역량", "전략적해자", "매크로민감도", "재평가가능성", "시장심리", "리스크내성", "기관수급", "제품믹스", "FCF수익률", "리더십신뢰도", "6개월추천"],
  "weightingSystem": {"growth": 30, "moat": 30, "valuation": 25, "management": 15},
  "marketData": {"sp500_ytd": 5.2, "sector_performance": {"healthcare": -2.1, "technology": 8.7, "industrials": 3.4}, "vix": 16.8, "10y_treasury": 4.25},
  "analysisMetadata": {"date": "2025-06-29", "analyst": "Professional Investment Team", "horizon": "6개월", "last_updated": "2025-06-29T22:29:00+09:00"},
  "riskMetrics": {"portfolio_var_95": 0.18, "max_drawdown": 0.12, "sharpe_ratio": 1.42, "sortino_ratio": 1.89},
  "portfolioAllocation": {"conservative": {"RMD": 40, "ABT": 35, "TRMB": 15, "EW": 10}, "balanced": {"RMD": 35, "TRMB": 30, "ABT": 25, "EW": 10}, "aggressive": {"RMD": 45, "TRMB": 35, "ABT": 15, "EW": 5}}
};

// Chart colors matching the theme
const chartColors = ['#1FB8CD', '#FFC185', '#B4413C', '#ECEBD5', '#5D878F', '#DB4545', '#D2BA4C', '#964325', '#944454', '#13343B'];

// Global chart instances
let keyMetricsChart, riskReturnChart, radarChart, scenarioChart, valuationChart, esgChart, allocationChart, attributionChart;

// Current tab state
let currentTab = 'dashboard';

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeCharts();
    initializeInteractivity();
    startRealTimeUpdates();
});

// Navigation functionality
function initializeNavigation() {
    const navTabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            // Update active tab
            navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update active content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetTab) {
                    content.classList.add('active');
                }
            });
            
            currentTab = targetTab;
            
            // Refresh charts when switching tabs
            setTimeout(() => {
                refreshChartsForTab(targetTab);
            }, 100);
        });
    });
}

// Initialize all charts
function initializeCharts() {
    initializeKeyMetricsChart();
    initializeRiskReturnChart();
    initializeRadarChart();
    initializeScenarioChart();
    initializeValuationChart();
    initializeESGChart();
    initializeAllocationChart();
    initializeAttributionChart();
}

// Key Metrics Chart (Dashboard)
function initializeKeyMetricsChart() {
    const ctx = document.getElementById('keyMetricsChart');
    if (!ctx) return;

    const companies = applicationData.companies;
    const labels = companies.map(c => c.ticker);
    const scores = companies.map(c => c.finalScore);

    keyMetricsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '종합 점수',
                data: scores,
                backgroundColor: chartColors.slice(0, companies.length).map(color => color + '80'),
                borderColor: chartColors.slice(0, companies.length),
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '핵심 지표 비교',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(255, 201, 71, 0.1)' },
                    ticks: { color: '#B8C5D1' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#B8C5D1', font: { weight: 'bold' } }
                }
            },
            animation: { duration: 1500, easing: 'easeInOutQuart' }
        }
    });

    // Add metric selector functionality
    const metricSelector = document.getElementById('metricSelector');
    if (metricSelector) {
        metricSelector.addEventListener('change', (e) => {
            updateKeyMetricsChart(e.target.value);
        });
    }
}

// Update Key Metrics Chart based on selection
function updateKeyMetricsChart(metric) {
    if (!keyMetricsChart) return;

    const companies = applicationData.companies;
    let data, label;

    switch(metric) {
        case 'scores':
            data = companies.map(c => c.finalScore);
            label = '종합 점수';
            break;
        case 'returns':
            data = companies.map(c => c.targetReturn);
            label = '예상 수익률 (%)';
            break;
        case 'confidence':
            data = companies.map(c => c.confidence);
            label = '신뢰도 (%)';
            break;
        default:
            data = companies.map(c => c.finalScore);
            label = '종합 점수';
    }

    keyMetricsChart.data.datasets[0].data = data;
    keyMetricsChart.data.datasets[0].label = label;
    keyMetricsChart.options.plugins.title.text = `${label} 비교`;
    keyMetricsChart.update('active');
}

// Risk-Return Scatter Plot
function initializeRiskReturnChart() {
    const ctx = document.getElementById('riskReturnChart');
    if (!ctx) return;

    const companies = applicationData.companies;
    const scatterData = companies.map((company, index) => ({
        x: getRiskScore(company.risks.overall),
        y: company.targetReturn,
        backgroundColor: chartColors[index],
        borderColor: chartColors[index],
        pointRadius: 8,
        pointHoverRadius: 10,
        label: company.ticker
    }));

    riskReturnChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: '리스크-수익률 포지셔닝',
                data: scatterData,
                backgroundColor: scatterData.map(d => d.backgroundColor + '80'),
                borderColor: scatterData.map(d => d.borderColor),
                borderWidth: 2,
                pointRadius: scatterData.map(d => d.pointRadius),
                pointHoverRadius: scatterData.map(d => d.pointHoverRadius),
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '리스크-수익률 포지셔닝',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            return companies[index].name + ' (' + companies[index].ticker + ')';
                        },
                        label: function(context) {
                            return [
                                `예상 수익률: ${context.parsed.y}%`,
                                `리스크 레벨: ${context.parsed.x}/10`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '리스크 레벨',
                        color: '#B8C5D1'
                    },
                    min: 0,
                    max: 10,
                    grid: { color: 'rgba(255, 201, 71, 0.1)' },
                    ticks: { color: '#B8C5D1' }
                },
                y: {
                    title: {
                        display: true,
                        text: '예상 수익률 (%)',
                        color: '#B8C5D1'
                    },
                    grid: { color: 'rgba(255, 201, 71, 0.1)' },
                    ticks: { color: '#B8C5D1' }
                }
            },
            animation: { duration: 1500, easing: 'easeInOutQuart' }
        }
    });
}

// Convert risk level to numeric score
function getRiskScore(riskLevel) {
    switch(riskLevel) {
        case '낮음': return 2;
        case '낮음-중간': return 4;
        case '중간': return 5;
        case '중간-높음': return 7;
        case '높음': return 9;
        default: return 5;
    }
}

// Radar Chart for Comprehensive Analysis
function initializeRadarChart() {
    const ctx = document.getElementById('radarChart');
    if (!ctx) return;

    const companies = applicationData.companies;
    const labels = applicationData.evaluationCriteria;
    
    const datasets = companies.map((company, index) => ({
        label: `${company.name} (${company.ticker})`,
        data: company.scores,
        backgroundColor: chartColors[index] + '20',
        borderColor: chartColors[index],
        borderWidth: 2,
        pointBackgroundColor: chartColors[index],
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
    }));

    radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '15-기준 종합 평가',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: '#B8C5D1',
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 5,
                    grid: { color: 'rgba(255, 201, 71, 0.2)' },
                    angleLines: { color: 'rgba(255, 201, 71, 0.2)' },
                    pointLabels: {
                        color: '#B8C5D1',
                        font: { size: 11, weight: '500' }
                    },
                    ticks: {
                        color: '#B8C5D1',
                        backdropColor: 'transparent',
                        stepSize: 1
                    }
                }
            },
            animation: { duration: 1500, easing: 'easeInOutQuart' }
        }
    });
}

// Scenario Analysis Chart
function initializeScenarioChart() {
    const ctx = document.getElementById('scenarioChart');
    if (!ctx) return;

    const companies = applicationData.companies;
    const labels = companies.map(c => c.ticker);
    
    // Create floating bar data [min, max] for bear to bull scenarios
    const scenarioData = companies.map(company => [
        company.scenarios.bear,
        company.scenarios.bull
    ]);

    scenarioChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '시나리오 범위 (Bear → Bull)',
                    data: scenarioData,
                    backgroundColor: chartColors.slice(0, companies.length).map(color => color + '60'),
                    borderColor: chartColors.slice(0, companies.length),
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: 'Base Case',
                    data: companies.map(c => c.scenarios.base),
                    type: 'line',
                    borderColor: '#FFC947',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointBackgroundColor: '#FFC947',
                    pointBorderColor: '#FFC947',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '6개월 시나리오 분석',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    display: true,
                    labels: { color: '#B8C5D1', usePointStyle: true, padding: 20 }
                },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                const company = companies[context.dataIndex];
                                return [
                                    `Bear Case: ${company.scenarios.bear}%`,
                                    `Bull Case: ${company.scenarios.bull}%`,
                                    `범위: ${company.scenarios.bull - company.scenarios.bear}%`
                                ];
                            } else {
                                return `Base Case: ${context.parsed.y}%`;
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#B8C5D1', font: { weight: 'bold' } }
                },
                y: {
                    title: {
                        display: true,
                        text: '예상 수익률 (%)',
                        color: '#B8C5D1'
                    },
                    grid: { color: 'rgba(255, 201, 71, 0.1)' },
                    ticks: { color: '#B8C5D1' }
                }
            },
            animation: { duration: 2000, easing: 'easeInOutQuart' }
        }
    });
}

// Valuation Multiples Chart
function initializeValuationChart() {
    const ctx = document.getElementById('valuationChart');
    if (!ctx) return;

    const companies = applicationData.companies;
    const labels = companies.map(c => c.ticker);

    valuationChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'P/E 비율',
                    data: companies.map(c => c.financials.pe),
                    backgroundColor: '#1FB8CD80',
                    borderColor: '#1FB8CD',
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'EV/EBITDA',
                    data: companies.map(c => c.financials.ev_ebitda),
                    backgroundColor: '#FFC18580',
                    borderColor: '#FFC185',
                    borderWidth: 2,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '밸류에이션 배수 비교',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    display: true,
                    labels: { color: '#B8C5D1', usePointStyle: true }
                },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#B8C5D1', font: { weight: 'bold' } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(255, 201, 71, 0.1)' },
                    ticks: { color: '#B8C5D1' }
                }
            },
            animation: { duration: 1500, easing: 'easeInOutQuart' }
        }
    });
}

// ESG Chart
function initializeESGChart() {
    const ctx = document.getElementById('esgChart');
    if (!ctx) return;

    const companies = applicationData.companies;
    const labels = companies.map(c => c.ticker);

    esgChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Environmental',
                    data: companies.map(c => c.esg.environmental),
                    backgroundColor: '#10B98180',
                    borderColor: '#10B981',
                    borderWidth: 2
                },
                {
                    label: 'Social',
                    data: companies.map(c => c.esg.social),
                    backgroundColor: '#3B82F680',
                    borderColor: '#3B82F6',
                    borderWidth: 2
                },
                {
                    label: 'Governance',
                    data: companies.map(c => c.esg.governance),
                    backgroundColor: '#F59E0B80',
                    borderColor: '#F59E0B',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'ESG 점수 비교',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    display: true,
                    labels: { color: '#B8C5D1', usePointStyle: true }
                },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#B8C5D1', font: { weight: 'bold' } }
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(255, 201, 71, 0.1)' },
                    ticks: { color: '#B8C5D1' }
                }
            },
            animation: { duration: 1500, easing: 'easeInOutQuart' }
        }
    });
}

// Portfolio Allocation Chart
function initializeAllocationChart() {
    const ctx = document.getElementById('allocationChart');
    if (!ctx) return;

    const conservativeData = applicationData.portfolioAllocation.conservative;
    const labels = Object.keys(conservativeData);
    const data = Object.values(conservativeData);

    allocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: chartColors.slice(0, labels.length).map(color => color + '80'),
                borderColor: chartColors.slice(0, labels.length),
                borderWidth: 2,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '포트폴리오 배분 (보수형)',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: '#B8C5D1', usePointStyle: true, padding: 20 }
                },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return `${context.label}: ${context.parsed}%`;
                        }
                    }
                }
            },
            animation: { 
                animateRotate: true,
                animateScale: true,
                duration: 1500,
                easing: 'easeInOutQuart'
            }
        }
    });

    // Add allocation type switching functionality
    initializeAllocationSwitcher();
}

// Allocation Type Switcher
function initializeAllocationSwitcher() {
    const allocationBtns = document.querySelectorAll('.allocation-btn');
    const allocationTypes = document.querySelectorAll('.allocation-type');

    allocationBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            
            // Update active button
            allocationBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update active allocation details
            allocationTypes.forEach(at => {
                at.classList.remove('active');
                if (at.id === type + '-allocation') {
                    at.classList.add('active');
                }
            });
            
            // Update chart data
            updateAllocationChart(type);
        });
    });
}

// Update Allocation Chart
function updateAllocationChart(type) {
    if (!allocationChart) return;

    const data = applicationData.portfolioAllocation[type];
    const labels = Object.keys(data);
    const values = Object.values(data);

    allocationChart.data.labels = labels;
    allocationChart.data.datasets[0].data = values;
    allocationChart.options.plugins.title.text = `포트폴리오 배분 (${getTypeName(type)})`;
    allocationChart.update('active');
}

function getTypeName(type) {
    switch(type) {
        case 'conservative': return '보수형';
        case 'balanced': return '균형형';
        case 'aggressive': return '공격형';
        default: return '보수형';
    }
}

// Performance Attribution Chart
function initializeAttributionChart() {
    const ctx = document.getElementById('attributionChart');
    if (!ctx) return;

    const companies = applicationData.companies;
    const labels = companies.map(c => c.ticker);
    
    // Mock attribution data (in a real app, this would come from portfolio calculations)
    const attributionData = companies.map(c => c.targetReturn * 0.3); // Simplified calculation

    attributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '성과 기여도 (%)',
                data: attributionData,
                backgroundColor: attributionData.map((value, index) => 
                    value >= 0 ? '#10B981' + '80' : '#EF4444' + '80'
                ),
                borderColor: attributionData.map((value, index) => 
                    value >= 0 ? '#10B981' : '#EF4444'
                ),
                borderWidth: 2,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: '성과 기여도 분석',
                    color: '#FFFFFF',
                    font: { size: 16, weight: 'bold' }
                },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(24, 59, 86, 0.95)',
                    titleColor: '#FFC947',
                    bodyColor: '#FFFFFF',
                    borderColor: '#FFC947',
                    borderWidth: 1,
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#B8C5D1', font: { weight: 'bold' } }
                },
                y: {
                    title: {
                        display: true,
                        text: '기여도 (%)',
                        color: '#B8C5D1'
                    },
                    grid: { color: 'rgba(255, 201, 71, 0.1)' },
                    ticks: { color: '#B8C5D1' }
                }
            },
            animation: { duration: 1500, easing: 'easeInOutQuart' }
        }
    });
}

// Initialize interactive features
function initializeInteractivity() {
    // Refresh buttons
    const refreshBtns = document.querySelectorAll('.refresh-btn');
    refreshBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            btn.style.transform = 'rotate(360deg)';
            btn.style.transition = 'transform 0.5s ease';
            setTimeout(() => {
                btn.style.transform = 'rotate(0deg)';
            }, 500);
            
            // Simulate data refresh
            setTimeout(() => {
                refreshChartsForTab(currentTab);
            }, 300);
        });
    });

    // Export buttons
    const exportBtns = document.querySelectorAll('.export-btn');
    exportBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Simulate export functionality
            showNotification('데이터 내보내기가 시작되었습니다.', 'success');
        });
    });

    // Methodology buttons
    const methodologyBtns = document.querySelectorAll('.methodology-btn');
    methodologyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            showMethodologyModal();
        });
    });

    // Trigger buttons
    const triggerBtns = document.querySelectorAll('.btn-small');
    triggerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            showNotification('리밸런싱 조정이 완료되었습니다.', 'success');
        });
    });
}

// Refresh charts for specific tab
function refreshChartsForTab(tab) {
    switch(tab) {
        case 'dashboard':
            if (keyMetricsChart) keyMetricsChart.update('active');
            if (riskReturnChart) riskReturnChart.update('active');
            break;
        case 'analysis':
            if (radarChart) radarChart.update('active');
            if (scenarioChart) scenarioChart.update('active');
            break;
        case 'financials':
            if (valuationChart) valuationChart.update('active');
            break;
        case 'risk':
            if (esgChart) esgChart.update('active');
            break;
        case 'portfolio':
            if (allocationChart) allocationChart.update('active');
            if (attributionChart) attributionChart.update('active');
            break;
    }
}

// Start real-time updates simulation
function startRealTimeUpdates() {
    // Simulate real-time data updates every 30 seconds
    setInterval(() => {
        updateMarketData();
    }, 30000);

    // Update timestamp every minute
    setInterval(() => {
        updateTimestamp();
    }, 60000);
}

// Update market data simulation
function updateMarketData() {
    const marketMetrics = document.querySelectorAll('.market-metrics .metric-value');
    
    marketMetrics.forEach(metric => {
        // Add small random fluctuation
        const currentValue = parseFloat(metric.textContent.replace(/[^\d.-]/g, ''));
        const fluctuation = (Math.random() - 0.5) * 0.1;
        const newValue = currentValue + fluctuation;
        
        // Update display
        if (metric.textContent.includes('%')) {
            metric.textContent = newValue.toFixed(1) + '%';
        } else {
            metric.textContent = newValue.toFixed(1);
        }
        
        // Add visual feedback
        metric.style.transition = 'color 0.3s ease';
        metric.style.color = '#FFC947';
        setTimeout(() => {
            metric.style.color = '';
        }, 300);
    });
}

// Update timestamp
function updateTimestamp() {
    const timestampEl = document.querySelector('.last-updated');
    if (timestampEl) {
        const now = new Date();
        const formatted = now.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        timestampEl.textContent = `마지막 업데이트: ${formatted}`;
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span>${message}</span>
            <button class="notification-close">&times;</button>
        </div>
    `;
    
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 24px;
        background: ${type === 'success' ? '#10B981' : '#3B82F6'};
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        max-width: 300px;
    `;

    document.body.appendChild(notification);

    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);

    // Close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    });
}

// Show methodology modal (simplified)
function showMethodologyModal() {
    showNotification('15-기준 평가 방법론: 성장성(30%), 경쟁우위(30%), 밸류에이션(25%), 경영진(15%)로 가중 평가', 'info');
}

// Chart resize handler
window.addEventListener('resize', function() {
    const charts = [keyMetricsChart, riskReturnChart, radarChart, scenarioChart, valuationChart, esgChart, allocationChart, attributionChart];
    charts.forEach(chart => {
        if (chart) {
            chart.resize();
        }
    });
});

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    
    .notification-close {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .notification-close:hover {
        opacity: 0.7;
    }
`;
document.head.appendChild(style);

// Console log for debugging
console.log('Professional Investment Analysis Platform initialized successfully');
console.log('Available companies:', applicationData.companies.map(c => c.ticker));
console.log('Current tab:', currentTab);