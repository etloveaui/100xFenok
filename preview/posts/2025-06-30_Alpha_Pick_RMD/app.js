// Enhanced Investment Analysis Application
// Data-driven charts and interactive features for ResMed Alpha Pick analysis

// Application Data - Enhanced with provided JSON data
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

// Chart color palette for enhanced visualization
const chartColors = ['#1FB8CD', '#FFC185', '#B4413C', '#ECEBD5', '#5D878F', '#DB4545', '#D2BA4C', '#964325', '#944454', '#13343B'];

// Global chart instances
let comparisonChart = null;
let competencyChart = null;
let scenarioChart = null;

// Application initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('Investment Analysis Dashboard Initializing...');
    
    // Initialize all features
    initializeIntersectionObserver();
    initializeNavigation();
    initializeCharts();
    initializeCompanyCards();
    initializeLegendControls();
    initializePortfolioInteractions();
    initializeScrollEffects();
    
    console.log('Dashboard initialized successfully');
});

// Enhanced Intersection Observer for smooth animations
function initializeIntersectionObserver() {
    const observerOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                
                // Trigger chart animations when they become visible
                const chartCanvas = entry.target.querySelector('canvas');
                if (chartCanvas) {
                    triggerChartAnimation(chartCanvas.id);
                }
            }
        });
    }, observerOptions);

    // Observe all fade-in elements
    document.querySelectorAll('.fade-in').forEach(el => {
        observer.observe(el);
    });
}

// Enhanced navigation with smooth scrolling and active states
function initializeNavigation() {
    const navbar = document.querySelector('.navbar');
    
    // Navbar scroll effect
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const offsetTop = target.offsetTop - 80; // Account for fixed navbar
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Update active navigation states
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');

    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 100;
            if (window.scrollY >= sectionTop) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });
}

// Initialize all charts with enhanced styling and interactions
function initializeCharts() {
    initializeComparisonChart();
    initializeCompetencyChart();
    initializeScenarioChart();
}

// Enhanced comparison chart with better styling
function initializeComparisonChart() {
    const ctx = document.getElementById('comparisonChart');
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
    const ctx = document.getElementById('competencyChart');
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
    const ctx = document.getElementById('scenarioChart');
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

// Enhanced company card flip functionality
function initializeCompanyCards() {
    const companyCards = document.querySelectorAll('.company-card');
    
    companyCards.forEach(card => {
        // Click event for flipping
        card.addEventListener('click', function() {
            this.classList.toggle('flipped');
            
            // Add analytics tracking
            const ticker = this.classList.contains('rmd') ? 'RMD' : 
                          this.classList.contains('trmb') ? 'TRMB' :
                          this.classList.contains('abt') ? 'ABT' : 'EW';
            console.log(`Card flipped: ${ticker}`);
        });

        // Keyboard accessibility
        card.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.classList.toggle('flipped');
            }
        });

        // Escape key to flip back
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                companyCards.forEach(c => c.classList.remove('flipped'));
            }
        });

        // Make cards focusable and accessible
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', '클릭하여 카드를 뒤집어 상세 정보를 확인하세요');
    });
}

// Enhanced legend controls for radar chart
function initializeLegendControls() {
    const legendItems = document.querySelectorAll('.legend-item');
    
    legendItems.forEach((item, index) => {
        item.addEventListener('click', function() {
            if (!competencyChart) return;
            
            const dataset = competencyChart.data.datasets[index];
            if (!dataset) return;
            
            // Toggle dataset visibility
            dataset.hidden = !dataset.hidden;
            
            // Update legend item appearance
            this.classList.toggle('inactive', dataset.hidden);
            
            // Update chart
            competencyChart.update('active');
            
            // Analytics
            const company = this.getAttribute('data-company');
            console.log(`Legend toggled: ${company}, visible: ${!dataset.hidden}`);
        });

        // Keyboard support
        item.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });

        // Accessibility
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        const company = item.querySelector('.legend-label')?.textContent || '';
        item.setAttribute('aria-label', `클릭하여 ${company} 차트 표시/숨김 토글`);
    });
}

// Portfolio interaction features
function initializePortfolioInteractions() {
    const portfolioCards = document.querySelectorAll('.portfolio-card');
    
    portfolioCards.forEach(card => {
        card.addEventListener('click', function() {
            // Remove active class from all cards
            portfolioCards.forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked card
            this.classList.add('active');
            
            // Get portfolio type
            const portfolioType = this.classList.contains('conservative') ? 'conservative' :
                                 this.classList.contains('balanced') ? 'balanced' : 'aggressive';
            
            // Update allocation visualization (if needed)
            updatePortfolioVisualization(portfolioType);
            
            console.log(`Portfolio selected: ${portfolioType}`);
        });
    });
}

// Scroll effects and performance optimizations
function initializeScrollEffects() {
    let ticking = false;
    
    function updateScrollEffects() {
        const scrolled = window.scrollY;
        
        // Parallax effect for hero background
        const heroParticles = document.querySelector('.hero-particles');
        if (heroParticles) {
            heroParticles.style.transform = `translateY(${scrolled * 0.5}px)`;
        }
        
        // Update progress indicator (if exists)
        updateProgressIndicator();
        
        ticking = false;
    }
    
    window.addEventListener('scroll', function() {
        if (!ticking) {
            requestAnimationFrame(updateScrollEffects);
            ticking = true;
        }
    });
}

// Utility functions
function triggerChartAnimation(chartId) {
    // Add specific animations when charts become visible
    setTimeout(() => {
        const chartElement = document.getElementById(chartId);
        if (chartElement) {
            chartElement.style.opacity = '1';
            chartElement.style.transform = 'translateY(0)';
        }
    }, 200);
}

function updatePortfolioVisualization(portfolioType) {
    const allocations = applicationData.portfolio_recommendations[portfolioType];
    
    // Update allocation bars animation
    Object.keys(allocations).forEach(ticker => {
        const percentage = allocations[ticker];
        const allocationBar = document.querySelector(`.allocation-fill.${ticker.toLowerCase()}`);
        if (allocationBar) {
            setTimeout(() => {
                allocationBar.style.width = `${percentage}%`;
            }, 100);
        }
    });
}

function updateProgressIndicator() {
    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = (winScroll / height) * 100;
    
    // Update progress bar (if exists)
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = scrolled + '%';
    }
}

// Chart refresh functionality
function refreshChart(chartType) {
    switch(chartType) {
        case 'comparison':
            if (comparisonChart) {
                comparisonChart.destroy();
                initializeComparisonChart();
            }
            break;
        case 'competency':
            if (competencyChart) {
                competencyChart.destroy();
                initializeCompetencyChart();
            }
            break;
        case 'scenario':
            if (scenarioChart) {
                scenarioChart.destroy();
                initializeScenarioChart();
            }
            break;
    }
}

// Window resize handler for responsive charts
window.addEventListener('resize', function() {
    if (comparisonChart) comparisonChart.resize();
    if (competencyChart) competencyChart.resize();
    if (scenarioChart) scenarioChart.resize();
});

// Performance monitoring
const performanceObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.entryType === 'measure') {
            console.log(`Performance: ${entry.name} took ${entry.duration}ms`);
        }
    }
});

// Error handling
window.addEventListener('error', function(e) {
    console.error('Application error:', e.error);
    
    // Show user-friendly error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-warning fixed-top';
    errorDiv.style.zIndex = '9999';
    errorDiv.innerHTML = `
        <i class="fas fa-exclamation-triangle me-2"></i>
        일시적인 오류가 발생했습니다. 페이지를 새로고침 해주세요.
        <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
    `;
    document.body.appendChild(errorDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (errorDiv.parentElement) {
            errorDiv.remove();
        }
    }, 5000);
});

// Export functions for global access
window.refreshChart = refreshChart;
window.applicationData = applicationData;

// Analytics and tracking
function trackInteraction(action, element) {
    console.log(`User interaction: ${action} on ${element}`);
    // Could integrate with analytics services here
}

// Accessibility improvements
document.addEventListener('keydown', function(e) {
    // Escape key functionality
    if (e.key === 'Escape') {
        // Close any open modals or flipped cards
        document.querySelectorAll('.company-card.flipped').forEach(card => {
            card.classList.remove('flipped');
        });
    }
    
    // Alt + number for quick navigation
    if (e.altKey && e.key >= '1' && e.key <= '6') {
        const sections = ['hero', 'dashboard', 'competency', 'scenarios', 'portfolio', 'profiles'];
        const sectionIndex = parseInt(e.key) - 1;
        if (sections[sectionIndex]) {
            const section = document.getElementById(sections[sectionIndex]);
            if (section) {
                section.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }
});

// Dark mode toggle (if needed)
function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
}

// Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
}

// Print optimization
window.addEventListener('beforeprint', function() {
    // Pause animations before printing
    document.body.style.animationPlayState = 'paused';
    document.body.style.transform = 'none';
});

window.addEventListener('afterprint', function() {
    // Resume animations after printing
    document.body.style.animationPlayState = 'running';
});

console.log('Investment Analysis Dashboard - ResMed Alpha Pick v2.0 Loaded Successfully');