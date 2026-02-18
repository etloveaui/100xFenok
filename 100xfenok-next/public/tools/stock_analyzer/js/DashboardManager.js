/**
 * DashboardManager.js - Sprint 4 통합 대시보드 관리자
 * GrowthAnalytics, RankingAnalytics, EPSAnalytics 통합
 */

class DashboardManager {
    constructor() {
        this.analytics = {
            growth: null,
            ranking: null,
            eps: null
        };

        this.charts = {
            growth: null,
            ranking: null,
            eps: null,
            combined: null
        };

        this.currentIndustry = 'all';
        this.initialized = false;
    }

    /**
     * 초기화
     */
    initialize() {
        if (this.initialized) return;

        console.log('DashboardManager initializing...');

        // Analytics 인스턴스 생성 및 초기화
        this.analytics.growth = new GrowthAnalytics().initialize();
        this.analytics.ranking = new RankingAnalytics().initialize();
        this.analytics.eps = new EPSAnalytics().initialize();

        // 이벤트 리스너 등록
        this.setupEventListeners();

        // 초기 렌더링
        this.render();

        this.initialized = true;
        console.log('DashboardManager initialized successfully');
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 업종 선택
        const industrySelect = document.getElementById('industry-select');
        if (industrySelect) {
            industrySelect.addEventListener('change', (e) => {
                this.handleIndustryChange(e.target.value);
            });
        }

        // 새로고침
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refresh();
            });
        }

        // CSV 내보내기
        const exportCsvBtn = document.getElementById('export-csv-btn');
        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => {
                this.exportToCSV();
            });
        }

        // PNG 내보내기
        const exportPngBtn = document.getElementById('export-png-btn');
        if (exportPngBtn) {
            exportPngBtn.addEventListener('click', () => {
                this.exportToPNG();
            });
        }

        // 모달 닫기
        const closeModalBtn = document.getElementById('close-modal');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                this.closeModal();
            });
        }

        // 모달 배경 클릭
        const modal = document.getElementById('company-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }
    }

    /**
     * 업종 변경 처리
     */
    handleIndustryChange(industry) {
        console.log('Industry changed to:', industry);
        this.currentIndustry = industry;

        // 모든 Analytics 모듈 필터 적용
        this.analytics.growth.filterByIndustry(industry);
        this.analytics.ranking.filterByIndustry(industry);
        this.analytics.eps.filterByIndustry(industry);

        // 대시보드 업데이트
        this.render();
    }

    /**
     * 새로고침
     */
    refresh() {
        console.log('Refreshing dashboard...');

        // 데이터 재생성
        this.analytics.growth.initialize();
        this.analytics.ranking.initialize();
        this.analytics.eps.initialize();

        // 현재 필터 재적용
        if (this.currentIndustry !== 'all') {
            this.handleIndustryChange(this.currentIndustry);
        } else {
            this.render();
        }
    }

    /**
     * 전체 렌더링
     */
    render() {
        this.updateOverviewCards();
        this.renderCharts();
        this.renderDetailTabs();
    }

    /**
     * Overview Cards 업데이트
     */
    updateOverviewCards() {
        // Growth 평균
        const growthAvg = this.analytics.growth.calculateAverageGrowth();
        const growthAvgEl = document.getElementById('growth-avg');
        if (growthAvgEl) {
            growthAvgEl.textContent = growthAvg.toFixed(2);
            growthAvgEl.className = growthAvg >= 0 ? 'text-3xl font-bold text-green-600' : 'text-3xl font-bold text-red-600';
        }

        // Ranking Top 10
        const top10Count = this.analytics.ranking.getTop10Count();
        const rankingTop10El = document.getElementById('ranking-top10');
        if (rankingTop10El) {
            rankingTop10El.textContent = top10Count;
        }

        // EPS 평균
        const epsAvg = this.analytics.eps.calculateAverageEPS();
        const epsAvgEl = document.getElementById('eps-avg');
        if (epsAvgEl) {
            epsAvgEl.textContent = epsAvg.toLocaleString();
        }
    }

    /**
     * 차트 렌더링
     */
    renderCharts() {
        this.renderGrowthChart();
        this.renderRankingChart();
        this.renderEPSChart();
        this.renderCombinedChart();
    }

    /**
     * Growth 차트
     */
    renderGrowthChart() {
        const ctx = document.getElementById('growth-chart');
        if (!ctx) return;

        // 기존 차트 파괴
        if (this.charts.growth) {
            this.charts.growth.destroy();
        }

        const config = this.analytics.growth.getChartData();
        this.charts.growth = new Chart(ctx, config);
    }

    /**
     * Ranking 차트
     */
    renderRankingChart() {
        const ctx = document.getElementById('ranking-chart');
        if (!ctx) return;

        if (this.charts.ranking) {
            this.charts.ranking.destroy();
        }

        const config = this.analytics.ranking.getChartData();
        this.charts.ranking = new Chart(ctx, config);
    }

    /**
     * EPS 차트
     */
    renderEPSChart() {
        const ctx = document.getElementById('eps-chart');
        if (!ctx) return;

        if (this.charts.eps) {
            this.charts.eps.destroy();
        }

        const config = this.analytics.eps.getChartData();
        this.charts.eps = new Chart(ctx, config);
    }

    /**
     * 통합 비교 차트
     */
    renderCombinedChart() {
        const ctx = document.getElementById('combined-chart');
        if (!ctx) return;

        if (this.charts.combined) {
            this.charts.combined.destroy();
        }

        // 3개 모듈의 상위 5개 기업 데이터 통합
        const growthTop = this.analytics.growth.getTopGrowthCompanies(5);
        const rankingTop = this.analytics.ranking.rankings.current.slice(0, 5);
        const epsTop = this.analytics.eps.getTopEPSCompanies(5);

        // 정규화 함수 (0-100 스케일)
        const normalize = (value, min, max) => {
            return ((value - min) / (max - min)) * 100;
        };

        // 성장률 정규화
        const growthValues = growthTop.map(c => c.avgGrowth);
        const growthMin = Math.min(...growthValues);
        const growthMax = Math.max(...growthValues);

        // 순위 정규화 (순위는 역순)
        const rankValues = rankingTop.map(c => c.rank);
        const rankMin = Math.min(...rankValues);
        const rankMax = Math.max(...rankValues);

        // EPS 정규화
        const epsValues = epsTop.map(c => c.avgEPS);
        const epsMin = Math.min(...epsValues);
        const epsMax = Math.max(...epsValues);

        // 공통 기업 찾기 (상위 5개 기업 중 겹치는 것)
        const allCompanies = new Set([
            ...growthTop.map(c => c.name),
            ...rankingTop.map(c => c.name),
            ...epsTop.map(c => c.name)
        ]);

        const companies = Array.from(allCompanies).slice(0, 5);

        const config = {
            type: 'radar',
            data: {
                labels: companies,
                datasets: [
                    {
                        label: '성장률',
                        data: companies.map(name => {
                            const company = growthTop.find(c => c.name === name);
                            if (!company) return 0;
                            return normalize(company.avgGrowth, growthMin, growthMax);
                        }),
                        borderColor: 'rgb(59, 130, 246)',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        borderWidth: 2
                    },
                    {
                        label: '순위 (역순)',
                        data: companies.map(name => {
                            const company = rankingTop.find(c => c.name === name);
                            if (!company) return 0;
                            // 순위는 낮을수록 좋으므로 역순으로 정규화
                            return 100 - normalize(company.rank, rankMin, rankMax);
                        }),
                        borderColor: 'rgb(16, 185, 129)',
                        backgroundColor: 'rgba(16, 185, 129, 0.2)',
                        borderWidth: 2
                    },
                    {
                        label: 'EPS',
                        data: companies.map(name => {
                            const company = epsTop.find(c => c.name === name);
                            if (!company) return 0;
                            return normalize(company.avgEPS, epsMin, epsMax);
                        }),
                        borderColor: 'rgb(168, 85, 247)',
                        backgroundColor: 'rgba(168, 85, 247, 0.2)',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.r.toFixed(1);
                            }
                        }
                    }
                },
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            stepSize: 20
                        }
                    }
                }
            }
        };

        this.charts.combined = new Chart(ctx, config);
    }

    /**
     * Detail Tabs 렌더링
     */
    renderDetailTabs() {
        // Growth Details
        const growthDetails = document.getElementById('growth-details');
        if (growthDetails) {
            growthDetails.innerHTML = this.analytics.growth.renderDetails();
        }

        // Ranking Details
        const rankingDetails = document.getElementById('ranking-details');
        if (rankingDetails) {
            rankingDetails.innerHTML = this.analytics.ranking.renderDetails();
        }

        // EPS Details
        const epsDetails = document.getElementById('eps-details');
        if (epsDetails) {
            epsDetails.innerHTML = this.analytics.eps.renderDetails();
        }
    }

    /**
     * 기업 상세 모달 표시
     */
    showCompanyDetail(company, source) {
        console.log('Showing company detail:', company.name, 'from', source);

        const modal = document.getElementById('company-modal');
        const modalTitle = document.getElementById('modal-title');
        const modalContent = document.getElementById('modal-content');

        if (!modal || !modalTitle || !modalContent) return;

        modalTitle.textContent = company.name;

        // 소스별 상세 정보 생성
        let detailHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">업종</p>
                        <p class="text-lg font-semibold">${company.industry}</p>
                    </div>
        `;

        if (source === 'growth') {
            const avgGrowth = (company.growth.q1 + company.growth.q2 + company.growth.q3 + company.growth.q4) / 4;
            detailHTML += `
                    <div>
                        <p class="text-sm text-gray-500">평균 성장률</p>
                        <p class="text-lg font-semibold ${avgGrowth >= 0 ? 'text-green-600' : 'text-red-600'}">${avgGrowth.toFixed(2)}%</p>
                    </div>
                </div>
                <div>
                    <h4 class="font-semibold mb-2">분기별 성장률</h4>
                    <div class="grid grid-cols-4 gap-2">
                        ${['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => {
                            const qKey = 'q' + (i + 1);
                            const value = company.growth[qKey];
                            return `
                                <div class="bg-gray-50 rounded p-3 text-center">
                                    <p class="text-xs text-gray-500">${q}</p>
                                    <p class="text-lg font-bold ${value >= 0 ? 'text-green-600' : 'text-red-600'}">${value.toFixed(2)}%</p>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } else if (source === 'ranking') {
            detailHTML += `
                    <div>
                        <p class="text-sm text-gray-500">현재 순위</p>
                        <p class="text-lg font-semibold">${company.rank}위</p>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">이전 순위</p>
                        <p class="text-lg font-semibold">${company.prevRank}위</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500">순위 변화</p>
                        <p class="text-lg font-semibold ${company.rankChange > 0 ? 'text-green-600' : company.rankChange < 0 ? 'text-red-600' : 'text-gray-600'}">
                            ${company.rankChange > 0 ? `↑ ${company.rankChange}` : company.rankChange < 0 ? `↓ ${Math.abs(company.rankChange)}` : '-'}
                        </p>
                    </div>
                </div>
            `;
        } else if (source === 'eps') {
            const avgEPS = company.avgEPS || (company.eps.q1 + company.eps.q2 + company.eps.q3 + company.eps.q4) / 4;
            detailHTML += `
                    <div>
                        <p class="text-sm text-gray-500">평균 EPS</p>
                        <p class="text-lg font-semibold">${Math.floor(avgEPS).toLocaleString()}원</p>
                    </div>
                </div>
                <div>
                    <h4 class="font-semibold mb-2">분기별 EPS</h4>
                    <div class="grid grid-cols-4 gap-2">
                        ${['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => {
                            const qKey = 'q' + (i + 1);
                            const value = company.eps[qKey];
                            return `
                                <div class="bg-gray-50 rounded p-3 text-center">
                                    <p class="text-xs text-gray-500">${q}</p>
                                    <p class="text-lg font-bold">${value.toLocaleString()}원</p>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-4 mt-4">
                    <div class="bg-blue-50 rounded p-3 text-center">
                        <p class="text-xs text-blue-600">PER</p>
                        <p class="text-lg font-bold text-blue-900">${company.per}</p>
                    </div>
                    <div class="bg-green-50 rounded p-3 text-center">
                        <p class="text-xs text-green-600">ROE</p>
                        <p class="text-lg font-bold text-green-900">${company.roe}%</p>
                    </div>
                    <div class="bg-purple-50 rounded p-3 text-center">
                        <p class="text-xs text-purple-600">배당수익률</p>
                        <p class="text-lg font-bold text-purple-900">${company.dividendYield}%</p>
                    </div>
                </div>
            `;
        }

        detailHTML += `</div>`;
        modalContent.innerHTML = detailHTML;

        modal.classList.add('active');
    }

    /**
     * 모달 닫기
     */
    closeModal() {
        const modal = document.getElementById('company-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    /**
     * CSV 내보내기
     */
    exportToCSV() {
        console.log('Exporting to CSV...');

        const csvParts = [
            '=== Growth Analytics ===',
            this.analytics.growth.exportToCSV(),
            '',
            '=== Ranking Analytics ===',
            this.analytics.ranking.exportToCSV(),
            '',
            '=== EPS Analytics ===',
            this.analytics.eps.exportToCSV()
        ];

        const csvContent = csvParts.join('\n');
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `stock_analytics_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('CSV export completed');
    }

    /**
     * PNG 내보내기
     */
    async exportToPNG() {
        console.log('Exporting to PNG...');

        try {
            // 모든 차트를 개별 PNG로 내보내기
            const charts = ['growth-chart', 'ranking-chart', 'eps-chart', 'combined-chart'];

            for (const chartId of charts) {
                const canvas = document.getElementById(chartId);
                if (!canvas) continue;

                const dataURL = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.download = `${chartId}_${new Date().toISOString().split('T')[0]}.png`;
                link.href = dataURL;
                link.click();

                // 다운로드 간 딜레이
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log('PNG export completed');
        } catch (error) {
            console.error('PNG export failed:', error);
            alert('PNG 내보내기 중 오류가 발생했습니다.');
        }
    }

    /**
     * 데이터 가져오기 (외부 API 연동용)
     */
    async loadDataFromAPI(apiUrl) {
        try {
            const response = await fetch(apiUrl);
            const data = await response.json();

            // 데이터 형식에 맞게 변환
            this.analytics.growth.initialize(data.growth);
            this.analytics.ranking.initialize(data.ranking);
            this.analytics.eps.initialize(data.eps);

            this.render();
            console.log('Data loaded from API successfully');
        } catch (error) {
            console.error('Failed to load data from API:', error);
        }
    }
}

// Global export
if (typeof window !== 'undefined') {
    window.DashboardManager = DashboardManager;
}
