import Chart from "chart.js/auto";

const applicationData = {
    companies: {
        RMD: {
            name: "ResMed",
            ticker: "RMD",
            final_score: 89.5,
            pe_ratio: 28.5,
            ev_ebitda: 17.0,
            roic: 21.2,
            fcf_yield: 3.9,
            market_share: "80%+ CPAP 시장",
            investment_type: "높은 해자를 가진 디지털 헬스 복리 성장주",
            key_drivers: ["독점적 시장 지위", "잘못 인식된 기회 (GLP-1)", "탁월한 자본 효율성"],
            scenario: {bear: 0, base: 15, bull: 25},
            strengths: ["2900만+ 커넥티드 기기", "220억+ 수면 데이터", "1만+ 특허"],
            target_return: "+15.5%",
            risk_level: "중간"
        },
        TRMB: {
            name: "Trimble",
            ticker: "TRMB",
            final_score: 80.9,
            pe_ratio: 23.0,
            ev_ebitda: 17.0,
            arr_growth: "17% YoY",
            tam: "$70B+ (25% 침투율)",
            investment_type: "소프트웨어 전환 및 가치주 투자",
            key_drivers: ["소프트웨어 전환", "ARR 성장", "저관입 시장"],
            scenario: {bear: -5, base: 12, bull: 22},
            strengths: ["79% 소프트웨어/서비스 매출", "AECO 시장 리더", "$3B ARR 목표"],
            target_return: "+12.8%",
            risk_level: "중상"
        },
        ABT: {
            name: "Abbott",
            ticker: "ABT",
            final_score: 79.4,
            pe_ratio: 17.4,
            ev_ebitda: 18.5,
            roic: 10.9,
            fcf_yield: 6.3,
            dividend_streak: "53년 연속 배당",
            investment_type: "다각화된 방어적 리더",
            key_drivers: ["다각화된 방어적 리더", "안정적 현금흐름", "혁신 파이프라인"],
            scenario: {bear: -2, base: 8, bull: 15},
            strengths: ["다각화 포트폴리오", "글로벌 90개 생산시설", "강력한 브랜드"],
            target_return: "+8.5%",
            risk_level: "낮음"
        },
        EW: {
            name: "Edwards Lifesciences",
            ticker: "EW",
            final_score: 74.4,
            pe_ratio: 25.3,
            ev_ebitda: 23.0,
            roic: 20.1,
            fcf_yield: 4.0,
            tmtt_target: "$2B 매출 by 2030",
            investment_type: "구조적 심장 질환 분야의 집중형 혁신가",
            key_drivers: ["구조적 심장 질환", "TMTT 확장", "TAVR 리더십"],
            scenario: {bear: -8, base: 7, bull: 15},
            strengths: ["TAVR 기술 선도", "TMTT 파이프라인", "임상 데이터 우위"],
            target_return: "+7.2%",
            risk_level: "높음"
        }
    },
    evaluation_criteria: [
        "저평가", "성장성", "경기방어력", "해자", "경영진", "자본효율성",
        "촉매 요인", "밸류에이션", "재평가 가능성", "시장 심리", "애널리스트 전망",
        "기술 혁신", "시장 지위", "재무 건전성", "주주 환원"
    ],
    scores_matrix: {
        RMD: [8, 7, 9, 10, 9, 10, 8, 8, 9, 7, 8, 9, 10, 9, 8],
        TRMB: [9, 9, 6, 8, 8, 7, 9, 9, 10, 8, 8, 8, 7, 7, 6],
        ABT: [7, 6, 10, 7, 8, 6, 6, 7, 6, 9, 9, 7, 8, 10, 10],
        EW: [5, 8, 6, 7, 7, 8, 7, 5, 6, 6, 7, 9, 8, 8, 7]
    },
    chart_colors: {
        RMD: {border: "rgb(31, 184, 205)", background: "rgba(31, 184, 205, 0.2)"},
        TRMB: {border: "rgb(255, 193, 133)", background: "rgba(255, 193, 133, 0.2)"},
        ABT: {border: "rgb(180, 65, 60)", background: "rgba(180, 65, 60, 0.2)"},
        EW: {border: "rgb(236, 235, 213)", background: "rgba(236, 235, 213, 0.2)"}
    },
    portfolio_recommendations: {
        conservative: {RMD: 25, TRMB: 20, ABT: 40, EW: 15},
        balanced: {RMD: 35, TRMB: 30, ABT: 25, EW: 10},
        aggressive: {RMD: 45, TRMB: 35, ABT: 15, EW: 5}
    },
    sp500_reference: 5
};


/** Mount the original chart configurations inside this article only. */
export function mountRmdPost(root) {
let comparisonChart = null, competencyChart = null, scenarioChart = null;
const controller = new AbortController();
const on = (target, event, callback) => target.addEventListener(event, callback, { signal: controller.signal });
function initializeComparisonChart() {
    const ctx = root.querySelector('#' + 'comparisonChart');
    if (!ctx) return;

    const companies = Object.values(applicationData.companies);
    const labels = companies.map(c => `${c.name} (${c.ticker})`);
    const scores = companies.map(c => c.final_score);
    const colors = Object.values(applicationData.chart_colors);

    comparisonChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '최종 가중 점수',
                data: scores,
                backgroundColor: colors.map(c => c.background),
                borderColor: colors.map(c => c.border),
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                title: {
                    display: true,
                    text: '최종 가중 점수 비교',
                    color: '#fbbf24',
                    font: {
                        size: 18,
                        weight: 'bold'
                    }
                },
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#fbbf24',
                    bodyColor: '#f1f5f9',
                    borderColor: '#fbbf24',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const company = companies[context.dataIndex];
                            return [
                                `점수: ${context.parsed.x}점`,
                                `투자 유형: ${company.investment_type}`,
                                `목표 수익률: ${company.target_return}`,
                                `리스크: ${company.risk_level}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: 'rgba(251, 191, 36, 0.1)'
                    },
                    ticks: {
                        color: '#f1f5f9',
                        callback: function(value) {
                            return value + '점';
                        }
                    }
                },
                y: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#f1f5f9',
                        font: {
                            weight: 'bold'
                        }
                    }
                }
            },
            animation: {
                duration: 2000,
                easing: 'easeInOutQuart'
            }
        }
    });
}

// Enhanced competency radar chart
function initializeCompetencyChart() {
    const ctx = root.querySelector('#' + 'competencyChart');
    if (!ctx) return;

    const companies = Object.keys(applicationData.companies);
    const labels = applicationData.evaluation_criteria;
    const colors = Object.values(applicationData.chart_colors);

    const datasets = companies.map((ticker, index) => ({
        label: `${applicationData.companies[ticker].name} (${ticker})`,
        data: applicationData.scores_matrix[ticker],
        backgroundColor: colors[index].background,
        borderColor: colors[index].border,
        borderWidth: 2,
        pointBackgroundColor: colors[index].border,
        pointBorderColor: '#f1f5f9',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        hidden: false
    }));

    competencyChart = new Chart(ctx, {
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
                    text: '핵심 역량 비교 (15개 항목)',
                    color: '#fbbf24',
                    font: {
                        size: 18,
                        weight: 'bold'
                    }
                },
                legend: {
                    display: false // We use custom legend
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#fbbf24',
                    bodyColor: '#f1f5f9',
                    borderColor: '#fbbf24',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.r}점`;
                        }
                    }
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 10,
                    grid: {
                        color: 'rgba(251, 191, 36, 0.2)'
                    },
                    angleLines: {
                        color: 'rgba(251, 191, 36, 0.2)'
                    },
                    pointLabels: {
                        color: '#f1f5f9',
                        font: {
                            size: 11,
                            weight: '500'
                        }
                    },
                    ticks: {
                        color: '#f1f5f9',
                        backdropColor: 'transparent',
                        stepSize: 2
                    }
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeInOutQuart'
            }
        }
    });
}

// Enhanced scenario analysis chart with floating bars
function initializeScenarioChart() {
    const ctx = root.querySelector('#' + 'scenarioChart');
    if (!ctx) return;

    const companies = Object.values(applicationData.companies);
    const labels = companies.map(c => `${c.name}\n(${c.ticker})`);
    const colors = Object.values(applicationData.chart_colors);

    // Create floating bar data [min, max]
    const scenarioData = companies.map(company => [
        company.scenario.bear,
        company.scenario.bull
    ]);

    scenarioChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '시나리오 범위',
                    data: scenarioData,
                    backgroundColor: colors.map(c => c.background),
                    borderColor: colors.map(c => c.border),
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: 'S&P 500 참고선',
                    data: new Array(companies.length).fill(applicationData.sp500_reference),
                    type: 'line',
                    borderColor: '#fbbf24',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    borderDash: [5, 5],
                    pointBackgroundColor: '#fbbf24',
                    pointBorderColor: '#fbbf24',
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
                    text: '6개월 시나리오 분석 vs S&P 500',
                    color: '#fbbf24',
                    font: {
                        size: 18,
                        weight: 'bold'
                    }
                },
                legend: {
                    display: true,
                    labels: {
                        color: '#f1f5f9',
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#fbbf24',
                    bodyColor: '#f1f5f9',
                    borderColor: '#fbbf24',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                const company = companies[context.dataIndex];
                                return [
                                    `하락 시나리오: ${company.scenario.bear}%`,
                                    `기본 시나리오: ${company.scenario.base}%`,
                                    `상승 시나리오: ${company.scenario.bull}%`,
                                    `변동 범위: ${company.scenario.bull - company.scenario.bear}%`
                                ];
                            } else {
                                return `S&P 500 참고: ${context.parsed.y}%`;
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#f1f5f9',
                        maxRotation: 0,
                        font: {
                            weight: 'bold',
                            size: 11
                        }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(251, 191, 36, 0.1)'
                    },
                    ticks: {
                        color: '#f1f5f9',
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            },
            animation: {
                duration: 2000,
                easing: 'easeInOutQuart'
            }
        }
    });
}


initializeComparisonChart(); initializeCompetencyChart(); initializeScenarioChart();
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { rootMargin: '0px 0px -50px 0px', threshold: 0.1 });
root.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
root.querySelectorAll('a[href^="#"]').forEach(anchor => on(anchor, 'click', event => {
  const target = root.querySelector(anchor.getAttribute('href'));
  if (target) { event.preventDefault(); window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }); }
}));
const cards = root.querySelectorAll('.company-card, .flippable-card-container');
cards.forEach(card => {
  card.tabIndex = 0; card.setAttribute('role', 'button');
  card.setAttribute('aria-label', '클릭하여 카드를 뒤집어 상세 정보를 확인하세요');
  const flip = () => { card.classList.toggle('flipped'); card.setAttribute('aria-pressed', String(card.classList.contains('flipped'))); };
  on(card, 'click', flip);
  on(card, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); } });
});
root.querySelectorAll('.legend-item').forEach((item, index) => {
  item.tabIndex = 0; item.setAttribute('role', 'button');
  item.setAttribute('aria-label', `클릭하여 ${item.querySelector('.legend-label')?.textContent || ''} 차트 표시/숨김 토글`);
  on(item, 'click', () => {
    const dataset = competencyChart.data.datasets[index];
    if (!dataset) return;
    dataset.hidden = !dataset.hidden;
    item.classList.toggle('inactive', dataset.hidden);
    item.setAttribute('aria-pressed', String(!dataset.hidden)); competencyChart.update('active');
  });
  on(item, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); } });
});
root.querySelectorAll('[data-refresh]').forEach(button => on(button, 'click', () => { comparisonChart.destroy(); initializeComparisonChart(); }));
on(window, 'keydown', event => {
  if (event.key === 'Escape') cards.forEach(card => { card.classList.remove('flipped'); card.setAttribute('aria-pressed', 'false'); });
  if (event.altKey && event.key >= '1' && event.key <= '6') {
    const id = ['hero', 'dashboard', 'competency', 'scenarios', 'portfolio', 'profiles'][Number(event.key) - 1];
    root.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth' });
  }
});
on(window, 'scroll', () => {
  const particles = root.querySelector('.hero-particles');
  if (particles) particles.style.transform = `translateY(${window.scrollY * 0.5}px)`;
  const progress = root.querySelector('.progress-bar');
  if (progress) progress.style.width = `${window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight) * 100}%`;
  let current = '';
  root.querySelectorAll('section[id]').forEach(section => { if (section.getBoundingClientRect().top <= 100) current = section.id; });
  root.querySelectorAll('.sticky a[href^="#"]').forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + current));
});
on(window, 'beforeprint', () => { root.style.animationPlayState = 'paused'; root.style.transform = 'none'; });
on(window, 'afterprint', () => { root.style.animationPlayState = 'running'; });
try { if (localStorage.getItem('theme') === 'dark') root.classList.add('dark-theme'); } catch { /* Storage may be disabled. */ }
return () => { controller.abort(); observer.disconnect(); comparisonChart?.destroy(); competencyChart?.destroy(); scenarioChart?.destroy(); };
}
