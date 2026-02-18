/**
 * DashboardManager - 대시보드 탭 관리 시스템
 */

class DashboardManager {
    constructor() {
        this.currentTab = 'screener';
        this.dashboardCharts = new Map();
        this.marketData = {
            totalCompanies: 0,
            avgPER: 0,
            avgROE: 0,
            totalMarketCap: 0
        };
        
        console.log('📊 DashboardManager 초기화');
    }

    /**
     * 대시보드 시스템 초기화
     */
    initialize() {
        this.setupTabNavigation();
        this.calculateMarketOverview();
        this.initializeDashboardCharts();
        
        // 고급 차트 시스템 초기화
        if (window.advancedChartManager) {
            window.advancedChartManager.addTouchSupport();
        }
        
        console.log('✅ 대시보드 시스템 초기화 완료');
    }

    /**
     * 탭 네비게이션 설정
     */
    setupTabNavigation() {
        const tabButtons = document.querySelectorAll('.tab-button');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const tabId = e.target.id.replace('tab-', '');
                this.switchTab(tabId);
            });
        });

        console.log('🔄 탭 네비게이션 설정 완료');
    }

    /**
     * 탭 전환
     */
    switchTab(tabName) {
        console.log(`🔄 탭 전환: ${this.currentTab} → ${tabName}`);
        
        // 모든 탭 버튼 비활성화
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
            btn.classList.add('text-gray-500', 'border-transparent');
            btn.classList.remove('text-blue-600', 'border-blue-500');
        });

        // 모든 탭 내용 숨기기
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.add('hidden');
        });

        // 선택된 탭 활성화
        const activeButton = document.getElementById(`tab-${tabName}`);
        const activeContent = document.getElementById(`${tabName}-content`);

        if (activeButton) {
            activeButton.classList.add('active', 'text-blue-600', 'border-blue-500');
            activeButton.classList.remove('text-gray-500', 'border-transparent');
        }

        if (activeContent) {
            activeContent.classList.remove('hidden');
        }

        this.currentTab = tabName;

        // 대시보드 탭으로 전환 시 차트 업데이트
        if (tabName === 'dashboard') {
            setTimeout(() => {
                // 데이터가 없으면 안내 메시지 표시
                if (!window.allData || window.allData.length === 0) {
                    this.showDataLoadingMessage();
                } else {
                    this.updateDashboardCharts();
                    this.createAdvancedCharts();
                }
            }, 100);
        }
    }

    /**
     * 데이터 로딩 안내 메시지 표시
     */
    showDataLoadingMessage() {
        const dashboardContent = document.getElementById('dashboard-content');
        if (!dashboardContent) return;

        const messageHTML = `
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
                <div class="text-blue-500 text-5xl mb-4">
                    <i class="fas fa-chart-line"></i>
                </div>
                <h3 class="text-xl font-bold text-blue-900 mb-2">대시보드 준비 중</h3>
                <p class="text-blue-700 mb-4">데이터를 로딩하고 있습니다. 잠시만 기다려주세요.</p>
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        `;

        // 차트 컨테이너에 메시지 삽입
        const chartContainers = dashboardContent.querySelectorAll('.dashboard-card');
        chartContainers.forEach(container => {
            if (!container.querySelector('.bg-blue-50')) {
                container.innerHTML = messageHTML;
            }
        });
    }

    /**
     * 시장 개요 계산
     */
    calculateMarketOverview() {
        if (!window.allData || window.allData.length === 0) {
            console.log('⏳ 데이터 로딩 대기 중... (시장 개요 계산)');
            // 데이터가 없어도 기본값으로 UI 표시
            this.marketData.totalCompanies = 0;
            this.marketData.avgPER = 0;
            this.marketData.avgROE = 0;
            this.marketData.totalMarketCap = 0;
            this.updateMarketOverviewCards();

            // 1초 후 재시도
            setTimeout(() => {
                this.calculateMarketOverview();
            }, 1000);
            return;
        }

        const data = window.allData;
        
        // 총 기업 수
        this.marketData.totalCompanies = data.length;

        // 평균 PER 계산
        const validPERs = data
            .map(company => parseFloat(company['PER (Oct-25)']))
            .filter(per => !isNaN(per) && per > 0 && per < 100);
        this.marketData.avgPER = validPERs.length > 0 
            ? (validPERs.reduce((sum, per) => sum + per, 0) / validPERs.length).toFixed(1)
            : 0;

        // 평균 ROE 계산
        const validROEs = data
            .map(company => parseFloat(company['ROE (Fwd)']))
            .filter(roe => !isNaN(roe));
        this.marketData.avgROE = validROEs.length > 0 
            ? (validROEs.reduce((sum, roe) => sum + roe, 0) / validROEs.length).toFixed(1)
            : 0;

        // 총 시가총액 계산
        const validMarketCaps = data
            .map(company => parseFloat(company['(USD mn)']))
            .filter(cap => !isNaN(cap) && cap > 0);
        const totalMarketCapMn = validMarketCaps.reduce((sum, cap) => sum + cap, 0);
        this.marketData.totalMarketCap = (totalMarketCapMn / 1000000).toFixed(1); // 조 달러 단위

        // UI 업데이트
        this.updateMarketOverviewCards();

        console.log('📊 시장 개요 계산 완료:', this.marketData);
    }

    /**
     * 시장 개요 카드 업데이트
     */
    updateMarketOverviewCards() {
        const totalCompaniesEl = document.getElementById('total-companies');
        const avgPEREl = document.getElementById('avg-per');
        const avgROEEl = document.getElementById('avg-roe');
        const totalMarketCapEl = document.getElementById('total-market-cap');

        if (totalCompaniesEl) totalCompaniesEl.textContent = this.marketData.totalCompanies.toLocaleString();
        if (avgPEREl) avgPEREl.textContent = this.marketData.avgPER;
        if (avgROEEl) avgROEEl.textContent = `${this.marketData.avgROE}%`;
        if (totalMarketCapEl) totalMarketCapEl.textContent = `$${this.marketData.totalMarketCap}T`;
    }

    /**
     * 대시보드 차트 초기화
     */
    initializeDashboardCharts() {
        // 차트는 탭이 활성화될 때 생성
        setTimeout(() => {
            if (this.currentTab === 'dashboard' && window.allData && window.allData.length > 0) {
                this.createAdvancedCharts();
            }
        }, 1000);
        
        console.log('📊 대시보드 차트 초기화 준비 완료');
    }

    /**
     * 고급 차트들 생성
     */
    createAdvancedCharts() {
        if (!window.advancedChartManager || !window.allData) return;

        console.log('📊 고급 차트 생성 시작');

        // 1. 밸류에이션 매트릭스 (PER vs PBR)
        const valuationChart = window.advancedChartManager.createValuationMatrix(
            'valuation-matrix-chart', 
            window.allData
        );

        // 2. 섹터 히트맵 (기존 캔버스 ID 사용)
        const sectorChart = window.advancedChartManager.createSectorHeatmap(
            'sector-performance-chart', 
            window.allData
        );

        console.log('✅ 고급 차트 생성 완료');
    }

    /**
     * 대시보드 차트 업데이트
     */
    updateDashboardCharts() {
        if (!window.allData || window.allData.length === 0) return;

        this.createValuationMatrix();
        this.createSectorPerformanceChart();
        this.updateTopWorstPerformers();

        console.log('📊 대시보드 차트 업데이트 완료');
    }

    /**
     * 밸류에이션 매트릭스 생성 (PER vs PBR 산점도)
     */
    createValuationMatrix() {
        const canvas = document.getElementById('valuation-matrix-chart');
        if (!canvas) return;

        // 기존 차트 제거
        if (this.dashboardCharts.has('valuation-matrix')) {
            this.dashboardCharts.get('valuation-matrix').destroy();
        }

        const ctx = canvas.getContext('2d');
        
        // 유효한 PER, PBR 데이터 추출
        const scatterData = window.allData
            .map(company => {
                const per = parseFloat(company['PER (Oct-25)']);
                const pbr = parseFloat(company['PBR (Oct-25)']);
                const marketCap = parseFloat(company['(USD mn)']);
                
                if (!isNaN(per) && !isNaN(pbr) && per > 0 && per < 100 && pbr > 0 && pbr < 20) {
                    return {
                        x: per,
                        y: pbr,
                        r: Math.sqrt(marketCap / 1000), // 시가총액에 따른 버블 크기
                        company: company.Ticker
                    };
                }
                return null;
            })
            .filter(item => item !== null)
            .slice(0, 200); // 성능을 위해 200개로 제한

        const chart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: '기업 분포',
                    data: scatterData,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'PER vs PBR 분포 (버블 크기 = 시가총액)',
                        font: { size: 14 }
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'PER'
                        },
                        min: 0,
                        max: 50
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'PBR'
                        },
                        min: 0,
                        max: 10
                    }
                }
            }
        });

        this.dashboardCharts.set('valuation-matrix', chart);
    }

    /**
     * 섹터별 성과 차트 생성
     */
    createSectorPerformanceChart() {
        const canvas = document.getElementById('sector-performance-chart');
        if (!canvas) return;

        // 기존 차트 제거
        if (this.dashboardCharts.has('sector-performance')) {
            this.dashboardCharts.get('sector-performance').destroy();
        }

        const ctx = canvas.getContext('2d');
        
        // 업종별 평균 수익률 계산
        const sectorData = this.calculateSectorPerformance();

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sectorData.labels,
                datasets: [{
                    label: '평균 연간수익률 (%)',
                    data: sectorData.returns,
                    backgroundColor: sectorData.returns.map(ret => 
                        ret > 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)'
                    ),
                    borderColor: sectorData.returns.map(ret => 
                        ret > 0 ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)'
                    ),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '업종별 평균 연간수익률',
                        font: { size: 14 }
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '수익률 (%)'
                        }
                    }
                }
            }
        });

        this.dashboardCharts.set('sector-performance', chart);
    }

    /**
     * 업종별 성과 계산
     */
    calculateSectorPerformance() {
        const sectorReturns = new Map();
        
        window.allData.forEach(company => {
            const industry = company.industry;
            const yearReturn = parseFloat(company['Return (Y)']);
            
            if (industry && !isNaN(yearReturn)) {
                if (!sectorReturns.has(industry)) {
                    sectorReturns.set(industry, []);
                }
                sectorReturns.get(industry).push(yearReturn);
            }
        });

        // 평균 계산 및 정렬
        const sectorAverages = Array.from(sectorReturns.entries())
            .map(([industry, returns]) => ({
                industry,
                avgReturn: returns.reduce((sum, ret) => sum + ret, 0) / returns.length,
                count: returns.length
            }))
            .filter(item => item.count >= 5) // 5개 이상 기업이 있는 업종만
            .sort((a, b) => b.avgReturn - a.avgReturn)
            .slice(0, 10); // 상위 10개 업종

        return {
            labels: sectorAverages.map(item => item.industry),
            returns: sectorAverages.map(item => item.avgReturn.toFixed(1))
        };
    }

    /**
     * TOP/WORST 수익률 업데이트
     */
    updateTopWorstPerformers() {
        const topPerformers = this.getTopPerformers(10);
        const worstPerformers = this.getWorstPerformers(10);

        this.renderPerformersList('top-performers', topPerformers, true);
        this.renderPerformersList('worst-performers', worstPerformers, false);
    }

    /**
     * 상위 수익률 기업 조회
     */
    getTopPerformers(count) {
        return window.allData
            .filter(company => {
                const yearReturn = parseFloat(company['Return (Y)']);
                return !isNaN(yearReturn);
            })
            .sort((a, b) => parseFloat(b['Return (Y)']) - parseFloat(a['Return (Y)']))
            .slice(0, count);
    }

    /**
     * 하위 수익률 기업 조회
     */
    getWorstPerformers(count) {
        return window.allData
            .filter(company => {
                const yearReturn = parseFloat(company['Return (Y)']);
                return !isNaN(yearReturn);
            })
            .sort((a, b) => parseFloat(a['Return (Y)']) - parseFloat(b['Return (Y)']))
            .slice(0, count);
    }

    /**
     * 수익률 리스트 렌더링
     */
    renderPerformersList(containerId, companies, isTop) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const listHTML = companies.map((company, index) => {
            const yearReturn = parseFloat(company['Return (Y)']);
            const returnClass = isTop ? 'text-green-600' : 'text-red-600';
            const rankIcon = isTop ? '🏆' : '📉';
            
            return `
                <div class="flex justify-between items-center p-2 hover:bg-gray-50 rounded cursor-pointer" 
                     onclick="showCompanyAnalysisModal(${JSON.stringify(company).replace(/"/g, '&quot;')})">
                    <div class="flex items-center">
                        <span class="text-sm mr-2">${rankIcon} ${index + 1}</span>
                        <div>
                            <div class="font-medium text-sm">${company.Ticker}</div>
                            <div class="text-xs text-gray-500">${company.industry}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="font-bold ${returnClass}">${yearReturn.toFixed(1)}%</div>
                        <div class="text-xs text-gray-500">${company.Exchange}</div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = listHTML;
    }

    /**
     * 현재 탭 반환
     */
    getCurrentTab() {
        return this.currentTab;
    }
}

// 전역 인스턴스 생성
window.dashboardManager = new DashboardManager();

console.log('✅ DashboardManager 로드 완료 - 대시보드 탭 시스템');