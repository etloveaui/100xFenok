/**
 * ChartManager - Chart.js 기반 차트 시스템
 */

class ChartManager {
    constructor() {
        this.charts = new Map(); // 생성된 차트 인스턴스 관리
        this.industryAverages = new Map(); // 업종별 평균 데이터 캐시
        
        console.log('📊 ChartManager 초기화');
    }

    /**
     * 레이더 차트 생성 (핵심 지표)
     */
    createRadarChart(canvasId, companyData) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.warn(`캔버스를 찾을 수 없습니다: ${canvasId}`);
            return null;
        }

        // 기존 차트 제거
        if (this.charts.has(canvasId)) {
            this.charts.get(canvasId).destroy();
        }

        const ctx = canvas.getContext('2d');
        
        // 핵심 지표 데이터 추출
        const radarData = this.extractRadarData(companyData);
        
        const chart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: radarData.labels,
                datasets: [{
                    label: companyData.corpName || companyData.Ticker,
                    data: radarData.values,
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 2,
                    pointBackgroundColor: 'rgba(59, 130, 246, 1)',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: 'rgba(59, 130, 246, 1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '핵심 지표 분석',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            stepSize: 20
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        },
                        angleLines: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        console.log(`📊 레이더 차트 생성 완료: ${canvasId}`);
        return chart;
    }

    /**
     * 바 차트 생성 (업종 평균 대비)
     */
    createComparisonChart(canvasId, companyData) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.warn(`캔버스를 찾을 수 없습니다: ${canvasId}`);
            return null;
        }

        // 기존 차트 제거
        if (this.charts.has(canvasId)) {
            this.charts.get(canvasId).destroy();
        }

        const ctx = canvas.getContext('2d');
        
        // 업종 평균 대비 데이터 생성
        const comparisonData = this.generateComparisonData(companyData);
        
        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: comparisonData.labels,
                datasets: [
                    {
                        label: '업종 평균',
                        data: comparisonData.industryAverages,
                        backgroundColor: 'rgba(156, 163, 175, 0.6)',
                        borderColor: 'rgba(156, 163, 175, 1)',
                        borderWidth: 1
                    },
                    {
                        label: companyData.corpName || companyData.Ticker,
                        data: comparisonData.companyValues,
                        backgroundColor: 'rgba(59, 130, 246, 0.6)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '업종 평균 대비 비교',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        console.log(`📊 비교 바 차트 생성 완료: ${canvasId}`);
        return chart;
    }

    /**
     * 레이더 차트용 데이터 추출
     */
    extractRadarData(companyData) {
        const metrics = [
            { key: 'PER (Oct-25)', label: 'PER', max: 50, invert: true },
            { key: 'PBR (Oct-25)', label: 'PBR', max: 10, invert: true },
            { key: 'ROE (Fwd)', label: 'ROE', max: 100, invert: false },
            { key: 'OPM (Fwd)', label: '영업이익률', max: 100, invert: false },
            { key: 'Sales (3)', label: '매출성장률', max: 100, invert: false },
            { key: 'Return (Y)', label: '연간수익률', max: 100, invert: false }
        ];

        const labels = metrics.map(m => m.label);
        const values = metrics.map(metric => {
            const rawValue = parseFloat(companyData[metric.key]) || 0;
            
            // 정규화 (0-100 스케일)
            let normalizedValue;
            if (metric.invert) {
                // PER, PBR은 낮을수록 좋음 (역정규화)
                normalizedValue = Math.max(0, 100 - (rawValue / metric.max * 100));
            } else {
                // ROE, 영업이익률 등은 높을수록 좋음
                normalizedValue = Math.min(100, (rawValue / metric.max * 100));
            }
            
            return Math.max(0, normalizedValue);
        });

        return { labels, values };
    }

    /**
     * 업종 평균 대비 비교 데이터 생성
     */
    generateComparisonData(companyData) {
        const industry = companyData.industry;
        const metrics = [
            { key: 'PER (Oct-25)', label: 'PER' },
            { key: 'PBR (Oct-25)', label: 'PBR' },
            { key: 'ROE (Fwd)', label: 'ROE(%)' },
            { key: 'OPM (Fwd)', label: '영업이익률(%)' },
            { key: 'Sales (3)', label: '매출성장률(%)' }
        ];

        const labels = metrics.map(m => m.label);
        const companyValues = metrics.map(m => parseFloat(companyData[m.key]) || 0);
        
        // 업종 평균 계산 (실제로는 전체 데이터에서 계산해야 함)
        const industryAverages = this.calculateIndustryAverages(industry, metrics);

        return {
            labels,
            companyValues,
            industryAverages
        };
    }

    /**
     * 업종 평균 계산
     */
    calculateIndustryAverages(industry, metrics) {
        // 캐시된 데이터가 있으면 사용
        if (this.industryAverages.has(industry)) {
            const cached = this.industryAverages.get(industry);
            return metrics.map(m => cached[m.key] || 0);
        }

        // 전체 데이터에서 해당 업종 기업들 필터링
        if (!window.allData || window.allData.length === 0) {
            return metrics.map(() => 0);
        }

        const industryCompanies = window.allData.filter(company => 
            company.industry === industry
        );

        if (industryCompanies.length === 0) {
            return metrics.map(() => 0);
        }

        const averages = {};
        metrics.forEach(metric => {
            const values = industryCompanies
                .map(company => parseFloat(company[metric.key]))
                .filter(value => !isNaN(value) && value > 0);
            
            averages[metric.key] = values.length > 0 
                ? values.reduce((sum, val) => sum + val, 0) / values.length 
                : 0;
        });

        // 캐시에 저장
        this.industryAverages.set(industry, averages);
        
        return metrics.map(m => averages[m.key] || 0);
    }

    /**
     * 모든 차트 제거
     */
    destroyAllCharts() {
        this.charts.forEach((chart, canvasId) => {
            chart.destroy();
            console.log(`📊 차트 제거: ${canvasId}`);
        });
        this.charts.clear();
    }

    /**
     * 특정 차트 제거
     */
    destroyChart(canvasId) {
        if (this.charts.has(canvasId)) {
            this.charts.get(canvasId).destroy();
            this.charts.delete(canvasId);
            console.log(`📊 차트 제거: ${canvasId}`);
        }
    }

    /**
     * 차트 데이터 업데이트
     */
    updateChart(canvasId, newData) {
        const chart = this.charts.get(canvasId);
        if (chart) {
            chart.data = newData;
            chart.update();
            console.log(`📊 차트 업데이트: ${canvasId}`);
        }
    }
    /**
     * 인터랙티브 기능 추가
     */
    addInteractiveFeatures() {
        // 차트 클릭 이벤트 처리
        this.charts.forEach((chart, canvasId) => {
            const canvas = document.getElementById(canvasId);
            if (canvas) {
                canvas.addEventListener('click', (event) => {
                    this.handleChartClick(chart, event);
                });
            }
        });

        console.log('🖱️ 차트 인터랙티브 기능 추가 완료');
    }

    /**
     * 차트 클릭 이벤트 처리
     */
    handleChartClick(chart, event) {
        const points = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
        
        if (points.length > 0) {
            const point = points[0];
            const datasetIndex = point.datasetIndex;
            const index = point.index;
            const dataset = chart.data.datasets[datasetIndex];
            
            console.log('📊 차트 포인트 클릭:', {
                datasetIndex,
                index,
                value: dataset.data[index]
            });

            // 클릭된 데이터에 따른 액션 수행
            this.performChartAction(chart, point);
        }
    }

    /**
     * 차트 액션 수행
     */
    performChartAction(chart, point) {
        const chartType = chart.config.type;
        
        switch (chartType) {
            case 'scatter':
                this.handleScatterClick(chart, point);
                break;
            case 'bar':
                this.handleBarClick(chart, point);
                break;
            case 'radar':
                this.handleRadarClick(chart, point);
                break;
            default:
                console.log('📊 차트 클릭 - 기본 액션');
        }
    }

    /**
     * 산점도 클릭 처리
     */
    handleScatterClick(chart, point) {
        const dataPoint = chart.data.datasets[point.datasetIndex].data[point.index];
        if (dataPoint && dataPoint.company) {
            console.log(`📊 기업 선택: ${dataPoint.company}`);
            
            // 해당 기업 데이터 찾기
            const company = window.allData?.find(c => c.Ticker === dataPoint.company);
            if (company) {
                // 기업 상세 모달 표시
                showCompanyAnalysisModal(company);
            }
        }
    }

    /**
     * 바 차트 클릭 처리
     */
    handleBarClick(chart, point) {
        const label = chart.data.labels[point.index];
        console.log(`📊 업종 선택: ${label}`);
        
        // 해당 업종으로 필터링
        if (window.advancedFilterManager) {
            const industryFilter = document.getElementById('industry-filter');
            if (industryFilter) {
                industryFilter.value = label;
                window.advancedFilterManager.filters.industry = label;
                window.advancedFilterManager.applyFilters();
                
                // 스크리닝 탭으로 전환
                if (window.dashboardManager) {
                    window.dashboardManager.switchTab('screener');
                }
            }
        }
    }

    /**
     * 레이더 차트 클릭 처리
     */
    handleRadarClick(chart, point) {
        const label = chart.data.labels[point.index];
        console.log(`📊 지표 선택: ${label}`);
        
        // 해당 지표에 대한 상세 정보 표시
        this.showMetricDetails(label);
    }

    /**
     * 지표 상세 정보 표시
     */
    showMetricDetails(metricLabel) {
        const metricInfo = {
            'PER': {
                name: 'PER (주가수익비율)',
                description: '주가를 주당순이익으로 나눈 비율. 낮을수록 저평가.',
                goodRange: '10-20',
                interpretation: '15 이하면 저평가, 25 이상이면 고평가'
            },
            'PBR': {
                name: 'PBR (주가순자산비율)',
                description: '주가를 주당순자산으로 나눈 비율. 낮을수록 저평가.',
                goodRange: '1-3',
                interpretation: '1 이하면 저평가, 3 이상이면 고평가'
            },
            'ROE': {
                name: 'ROE (자기자본수익률)',
                description: '기업이 자기자본으로 얼마나 효율적으로 이익을 창출하는지 나타내는 지표.',
                goodRange: '15% 이상',
                interpretation: '20% 이상이면 우수, 10% 이하면 부진'
            }
        };

        const info = metricInfo[metricLabel] || metricInfo[metricLabel.split('(')[0]];
        if (info) {
            alert(`📊 ${info.name}\n\n${info.description}\n\n적정 범위: ${info.goodRange}\n해석: ${info.interpretation}`);
        }
    }

    /**
     * 차트 애니메이션 효과 추가
     */
    addChartAnimations() {
        this.charts.forEach((chart, canvasId) => {
            // 호버 효과 개선
            chart.options.onHover = (event, activeElements) => {
                event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
            };

            // 애니메이션 설정
            chart.options.animation = {
                duration: 1000,
                easing: 'easeInOutQuart'
            };

            chart.update();
        });

        console.log('✨ 차트 애니메이션 효과 추가 완료');
    }

    /**
     * 차트 데이터 실시간 업데이트
     */
    enableRealTimeUpdates() {
        // 5분마다 차트 데이터 업데이트 (실제로는 실시간 데이터 소스 필요)
        setInterval(() => {
            if (window.dashboardManager && window.dashboardManager.getCurrentTab() === 'dashboard') {
                console.log('🔄 차트 데이터 실시간 업데이트');
                this.refreshChartData();
            }
        }, 300000); // 5분

        console.log('🔄 실시간 업데이트 활성화');
    }

    /**
     * 차트 데이터 새로고침
     */
    refreshChartData() {
        this.charts.forEach((chart, canvasId) => {
            // 데이터 재계산 및 업데이트
            if (canvasId.includes('valuation-matrix')) {
                // 밸류에이션 매트릭스 데이터 업데이트
                this.updateValuationMatrixData(chart);
            } else if (canvasId.includes('sector-performance')) {
                // 섹터 성과 데이터 업데이트
                this.updateSectorPerformanceData(chart);
            }
        });
    }

    /**
     * 밸류에이션 매트릭스 데이터 업데이트
     */
    updateValuationMatrixData(chart) {
        // 새로운 데이터로 차트 업데이트
        const newData = this.generateValuationMatrixData();
        chart.data.datasets[0].data = newData;
        chart.update('none'); // 애니메이션 없이 업데이트
    }

    /**
     * 섹터 성과 데이터 업데이트
     */
    updateSectorPerformanceData(chart) {
        // 새로운 데이터로 차트 업데이트
        const newData = this.generateSectorPerformanceData();
        chart.data.datasets[0].data = newData.values;
        chart.update('none');
    }

    /**
     * 차트 내보내기 기능
     */
    exportChart(canvasId, filename) {
        const chart = this.charts.get(canvasId);
        if (chart) {
            const url = chart.toBase64Image();
            const link = document.createElement('a');
            link.download = filename || `chart-${canvasId}-${Date.now()}.png`;
            link.href = url;
            link.click();
            
            console.log(`📊 차트 내보내기: ${filename}`);
        }
    }

    /**
     * 차트 전체화면 모드
     */
    toggleFullscreen(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (canvas) {
            if (canvas.requestFullscreen) {
                canvas.requestFullscreen();
            } else if (canvas.webkitRequestFullscreen) {
                canvas.webkitRequestFullscreen();
            } else if (canvas.msRequestFullscreen) {
                canvas.msRequestFullscreen();
            }
            
            console.log(`📊 차트 전체화면: ${canvasId}`);
        }
    }
}

// 전역 인스턴스 생성
window.chartManager = new ChartManager();

console.log('✅ ChartManager 로드 완료 - Chart.js 기반 차트 시스템');

// ChartManager 인스턴스에 인터랙티브 기능 추가
if (window.chartManager) {
    // 데이터 로딩 후 인터랙티브 기능 활성화
    setTimeout(() => {
        window.chartManager.addInteractiveFeatures();
        window.chartManager.addChartAnimations();
        window.chartManager.enableRealTimeUpdates();
    }, 2000);
}

console.log('✅ 인터랙티브 차트 시스템 확장 완료');