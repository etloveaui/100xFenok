/**
 * DashboardFixManager - 대시보드 차트 수정 시스템
 */

class DashboardFixManager {
    constructor() {
        this.charts = new Map();
        this.isInitialized = false;
        
        console.log('📊 DashboardFixManager 초기화');
    }

    /**
     * 대시보드 수정 시스템 초기화
     */
    initialize() {
        if (this.isInitialized) return;
        
        this.fixDashboardDataLoading();
        this.implementValuationMatrix();
        this.implementSectorAnalysis();
        this.setupChartRefresh();
        
        this.isInitialized = true;
        console.log('✅ 대시보드 수정 시스템 초기화 완료');
    }

    /**
     * 대시보드 데이터 로딩 수정
     */
    fixDashboardDataLoading() {
        // DashboardManager의 데이터 로딩 대기 문제 해결
        const originalCalculateMarketOverview = window.dashboardManager?.calculateMarketOverview;
        
        if (window.dashboardManager && originalCalculateMarketOverview) {
            window.dashboardManager.calculateMarketOverview = () => {
                if (!window.allData || window.allData.length === 0) {
                    console.log('⏳ 대시보드: 데이터 로딩 대기 중...');
                    
                    // 3초 후 재시도
                    setTimeout(() => {
                        if (window.allData && window.allData.length > 0) {
                            originalCalculateMarketOverview.call(window.dashboardManager);
                            this.refreshAllCharts();
                        }
                    }, 3000);
                    
                    return;
                }
                
                // 원본 함수 실행
                originalCalculateMarketOverview.call(window.dashboardManager);
            };
        }

        console.log('🔧 대시보드 데이터 로딩 수정 완료');
    }

    /**
     * 밸류에이션 매트릭스 구현
     */
    implementValuationMatrix() {
        const canvasId = 'valuation-matrix-chart';
        const canvas = document.getElementById(canvasId);
        
        if (!canvas) {
            console.warn('⚠️ 밸류에이션 매트릭스 캔버스를 찾을 수 없습니다.');
            return;
        }

        this.createValuationMatrix(canvasId);
    }

    /**
     * 밸류에이션 매트릭스 차트 생성
     */
    createValuationMatrix(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !window.allData) return;

        const ctx = canvas.getContext('2d');
        
        // 기존 차트 제거
        if (this.charts.has(canvasId)) {
            this.charts.get(canvasId).destroy();
        }

        // PER vs PBR 스캐터 플롯 데이터 생성
        const scatterData = this.generateValuationScatterData();

        const chart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: '기업 분포',
                    data: scatterData,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '밸류에이션 매트릭스 (PER vs PBR)',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const point = context.raw;
                                return `${point.company}: PER ${point.x.toFixed(1)}, PBR ${point.y.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'PER (Price-to-Earnings Ratio)'
                        },
                        min: 0,
                        max: 50
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'PBR (Price-to-Book Ratio)'
                        },
                        min: 0,
                        max: 10
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        console.log('📊 밸류에이션 매트릭스 차트 생성 완료');
    }

    /**
     * 밸류에이션 스캐터 데이터 생성
     */
    generateValuationScatterData() {
        if (!window.allData) return [];

        return window.allData
            .filter(company => {
                const per = parseFloat(company['PER (Oct-25)']);
                const pbr = parseFloat(company['PBR (Oct-25)']);
                return !isNaN(per) && !isNaN(pbr) && per > 0 && per < 100 && pbr > 0 && pbr < 20;
            })
            .slice(0, 200) // 성능을 위해 200개로 제한
            .map(company => ({
                x: parseFloat(company['PER (Oct-25)']),
                y: parseFloat(company['PBR (Oct-25)']),
                company: company.Ticker
            }));
    }

    /**
     * 섹터 분석 구현
     */
    implementSectorAnalysis() {
        const canvasId = 'sector-analysis-chart';
        const canvas = document.getElementById(canvasId);
        
        if (!canvas) {
            console.warn('⚠️ 섹터 분석 캔버스를 찾을 수 없습니다.');
            return;
        }

        this.createSectorAnalysisChart(canvasId);
    }

    /**
     * 섹터 분석 차트 생성
     */
    createSectorAnalysisChart(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !window.allData) return;

        const ctx = canvas.getContext('2d');
        
        // 기존 차트 제거
        if (this.charts.has(canvasId)) {
            this.charts.get(canvasId).destroy();
        }

        // 섹터별 데이터 생성
        const sectorData = this.generateSectorData();

        const chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: sectorData.labels,
                datasets: [{
                    data: sectorData.values,
                    backgroundColor: [
                        '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
                        '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6B7280'
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '섹터별 기업 분포',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label;
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value}개 (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        console.log('📊 섹터 분석 차트 생성 완료');
    }

    /**
     * 섹터별 데이터 생성
     */
    generateSectorData() {
        if (!window.allData) return { labels: [], values: [] };

        const sectorCounts = {};
        
        window.allData.forEach(company => {
            const sector = company.industry || 'Unknown';
            sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
        });

        // 상위 10개 섹터만 표시
        const sortedSectors = Object.entries(sectorCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);

        return {
            labels: sortedSectors.map(([sector]) => sector),
            values: sortedSectors.map(([,count]) => count)
        };
    }

    /**
     * 차트 새로고침 설정
     */
    setupChartRefresh() {
        // 데이터 변경 시 차트 자동 새로고침
        const originalApplyFilters = window.applyFilters;
        
        if (originalApplyFilters) {
            window.applyFilters = (filter) => {
                originalApplyFilters(filter);
                
                // 차트 새로고침
                setTimeout(() => {
                    this.refreshAllCharts();
                }, 500);
            };
        }

        console.log('🔄 차트 자동 새로고침 설정 완료');
    }

    /**
     * 모든 차트 새로고침
     */
    refreshAllCharts() {
        if (!window.allData || window.allData.length === 0) {
            console.log('⏳ 차트 새로고침: 데이터 대기 중...');
            return;
        }

        // 밸류에이션 매트릭스 새로고침
        if (document.getElementById('valuation-matrix-chart')) {
            this.createValuationMatrix('valuation-matrix-chart');
        }

        // 섹터 분석 새로고침
        if (document.getElementById('sector-analysis-chart')) {
            this.createSectorAnalysisChart('sector-analysis-chart');
        }

        console.log('🔄 모든 차트 새로고침 완료');
    }

    /**
     * 차트 상태 반환
     */
    getChartStatus() {
        return {
            totalCharts: this.charts.size,
            isInitialized: this.isInitialized,
            availableData: window.allData ? window.allData.length : 0
        };
    }
}

// 전역 인스턴스 생성
window.dashboardFixManager = new DashboardFixManager();

console.log('✅ DashboardFixManager 로드 완료 - 대시보드 차트 수정 시스템');