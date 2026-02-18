/**
 * AdvancedChartManager - 고급 시각화 및 반응형 차트 시스템
 */

class AdvancedChartManager {
    constructor() {
        this.charts = new Map();
        this.responsiveBreakpoints = {
            mobile: 768,
            tablet: 1024,
            desktop: 1440
        };
        this.currentDevice = this.detectDevice();
        
        console.log('📊 AdvancedChartManager 초기화 - 반응형 차트 시스템');
        this.setupResponsiveListeners();
    }

    /**
     * 디바이스 타입 감지
     */
    detectDevice() {
        const width = window.innerWidth;
        if (width < this.responsiveBreakpoints.mobile) return 'mobile';
        if (width < this.responsiveBreakpoints.tablet) return 'tablet';
        return 'desktop';
    }

    /**
     * 반응형 리스너 설정
     */
    setupResponsiveListeners() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const newDevice = this.detectDevice();
                if (newDevice !== this.currentDevice) {
                    this.currentDevice = newDevice;
                    this.handleDeviceChange();
                }
                this.resizeAllCharts();
            }, 250);
        });

        // 화면 회전 감지
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.handleOrientationChange();
            }, 500);
        });
    }

    /**
     * 디바이스 변경 처리
     */
    handleDeviceChange() {
        console.log(`📱 디바이스 변경 감지: ${this.currentDevice}`);
        this.charts.forEach((chart, canvasId) => {
            this.updateChartForDevice(chart, canvasId);
        });
    }

    /**
     * 화면 회전 처리
     */
    handleOrientationChange() {
        console.log('🔄 화면 회전 감지');
        this.resizeAllCharts();
    }

    /**
     * 모든 차트 리사이즈
     */
    resizeAllCharts() {
        this.charts.forEach((chart) => {
            chart.resize();
        });
    }

    /**
     * 디바이스별 차트 업데이트
     */
    updateChartForDevice(chart, canvasId) {
        const deviceConfig = this.getDeviceConfig();
        
        // 차트 옵션 업데이트
        chart.options = {
            ...chart.options,
            ...deviceConfig.chartOptions,
            plugins: {
                ...chart.options.plugins,
                legend: {
                    ...chart.options.plugins?.legend,
                    ...deviceConfig.legendConfig
                },
                title: {
                    ...chart.options.plugins?.title,
                    ...deviceConfig.titleConfig
                }
            }
        };

        chart.update('none');
    }

    /**
     * 디바이스별 설정 반환
     */
    getDeviceConfig() {
        const configs = {
            mobile: {
                chartOptions: {
                    maintainAspectRatio: false,
                    responsive: true,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                },
                legendConfig: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        font: { size: 10 },
                        padding: 8
                    }
                },
                titleConfig: {
                    font: { size: 14, weight: 'bold' },
                    padding: { bottom: 10 }
                }
            },
            tablet: {
                chartOptions: {
                    maintainAspectRatio: false,
                    responsive: true,
                    interaction: {
                        intersect: true,
                        mode: 'nearest'
                    }
                },
                legendConfig: {
                    position: 'top',
                    labels: {
                        boxWidth: 15,
                        font: { size: 12 },
                        padding: 10
                    }
                },
                titleConfig: {
                    font: { size: 16, weight: 'bold' },
                    padding: { bottom: 15 }
                }
            },
            desktop: {
                chartOptions: {
                    maintainAspectRatio: false,
                    responsive: true,
                    interaction: {
                        intersect: true,
                        mode: 'nearest'
                    }
                },
                legendConfig: {
                    position: 'top',
                    labels: {
                        boxWidth: 18,
                        font: { size: 14 },
                        padding: 12
                    }
                },
                titleConfig: {
                    font: { size: 18, weight: 'bold' },
                    padding: { bottom: 20 }
                }
            }
        };

        return configs[this.currentDevice] || configs.desktop;
    }

    /**
     * 밸류에이션 매트릭스 차트 (PER vs PBR 산점도)
     */
    createValuationMatrix(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        const scatterData = this.generateValuationMatrixData(data);
        const deviceConfig = this.getDeviceConfig();

        const chart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: '매수 영역 (저PER, 저PBR)',
                        data: scatterData.buyZone,
                        backgroundColor: 'rgba(34, 197, 94, 0.6)',
                        borderColor: 'rgba(34, 197, 94, 1)',
                        pointRadius: this.currentDevice === 'mobile' ? 4 : 6,
                        pointHoverRadius: this.currentDevice === 'mobile' ? 6 : 8
                    },
                    {
                        label: '관망 영역',
                        data: scatterData.holdZone,
                        backgroundColor: 'rgba(251, 191, 36, 0.6)',
                        borderColor: 'rgba(251, 191, 36, 1)',
                        pointRadius: this.currentDevice === 'mobile' ? 4 : 6,
                        pointHoverRadius: this.currentDevice === 'mobile' ? 6 : 8
                    },
                    {
                        label: '매도 영역 (고PER, 고PBR)',
                        data: scatterData.sellZone,
                        backgroundColor: 'rgba(239, 68, 68, 0.6)',
                        borderColor: 'rgba(239, 68, 68, 1)',
                        pointRadius: this.currentDevice === 'mobile' ? 4 : 6,
                        pointHoverRadius: this.currentDevice === 'mobile' ? 6 : 8
                    }
                ]
            },
            options: {
                ...deviceConfig.chartOptions,
                plugins: {
                    title: {
                        display: true,
                        text: '밸류에이션 매트릭스 (PER vs PBR)',
                        ...deviceConfig.titleConfig
                    },
                    legend: {
                        ...deviceConfig.legendConfig
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
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'PER (주가수익비율)',
                            font: { size: this.currentDevice === 'mobile' ? 10 : 12 }
                        },
                        min: 0,
                        max: 50
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'PBR (주가순자산비율)',
                            font: { size: this.currentDevice === 'mobile' ? 10 : 12 }
                        },
                        min: 0,
                        max: 10
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const element = elements[0];
                        const dataPoint = chart.data.datasets[element.datasetIndex].data[element.index];
                        this.handleMatrixClick(dataPoint);
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        return chart;
    }

    /**
     * 섹터 히트맵 차트
     */
    createSectorHeatmap(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        const heatmapData = this.generateSectorHeatmapData(data);
        const deviceConfig = this.getDeviceConfig();

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: heatmapData.sectors,
                datasets: [{
                    label: '섹터별 평균 수익률 (%)',
                    data: heatmapData.returns,
                    backgroundColor: heatmapData.colors,
                    borderColor: heatmapData.colors.map(color => color.replace('0.8', '1')),
                    borderWidth: 1
                }]
            },
            options: {
                ...deviceConfig.chartOptions,
                indexAxis: this.currentDevice === 'mobile' ? 'y' : 'x', // 모바일에서는 가로 바
                plugins: {
                    title: {
                        display: true,
                        text: '섹터별 성과 히트맵',
                        ...deviceConfig.titleConfig
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y || context.parsed.x;
                                return `${context.label}: ${value.toFixed(2)}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: this.currentDevice !== 'mobile',
                            text: this.currentDevice === 'mobile' ? '' : '수익률 (%)',
                            font: { size: this.currentDevice === 'mobile' ? 10 : 12 }
                        },
                        ticks: {
                            font: { size: this.currentDevice === 'mobile' ? 8 : 10 }
                        }
                    },
                    y: {
                        title: {
                            display: this.currentDevice !== 'mobile',
                            text: this.currentDevice === 'mobile' ? '' : '섹터',
                            font: { size: this.currentDevice === 'mobile' ? 10 : 12 }
                        },
                        ticks: {
                            font: { size: this.currentDevice === 'mobile' ? 8 : 10 }
                        }
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        return chart;
    }

    /**
     * 모멘텀 캔들차트 (3개월 추세)
     */
    createMomentumChart(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        const momentumData = this.generateMomentumData(data);
        const deviceConfig = this.getDeviceConfig();

        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: momentumData.dates,
                datasets: [
                    {
                        label: '상승 모멘텀',
                        data: momentumData.upTrend,
                        borderColor: 'rgba(34, 197, 94, 1)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: this.currentDevice === 'mobile' ? 2 : 4
                    },
                    {
                        label: '하락 모멘텀',
                        data: momentumData.downTrend,
                        borderColor: 'rgba(239, 68, 68, 1)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: this.currentDevice === 'mobile' ? 2 : 4
                    }
                ]
            },
            options: {
                ...deviceConfig.chartOptions,
                plugins: {
                    title: {
                        display: true,
                        text: '3개월 모멘텀 추세',
                        ...deviceConfig.titleConfig
                    },
                    legend: {
                        ...deviceConfig.legendConfig
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: this.currentDevice !== 'mobile',
                            text: '기간',
                            font: { size: this.currentDevice === 'mobile' ? 10 : 12 }
                        },
                        ticks: {
                            maxTicksLimit: this.currentDevice === 'mobile' ? 4 : 8,
                            font: { size: this.currentDevice === 'mobile' ? 8 : 10 }
                        }
                    },
                    y: {
                        title: {
                            display: this.currentDevice !== 'mobile',
                            text: '수익률 (%)',
                            font: { size: this.currentDevice === 'mobile' ? 10 : 12 }
                        },
                        ticks: {
                            font: { size: this.currentDevice === 'mobile' ? 8 : 10 }
                        }
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        return chart;
    }

    /**
     * 포트폴리오 구성 파이 차트
     */
    createPortfolioPieChart(canvasId, portfolioData) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        const deviceConfig = this.getDeviceConfig();

        const chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: portfolioData.labels,
                datasets: [{
                    data: portfolioData.values,
                    backgroundColor: [
                        'rgba(59, 130, 246, 0.8)',
                        'rgba(34, 197, 94, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(251, 191, 36, 0.8)',
                        'rgba(168, 85, 247, 0.8)',
                        'rgba(236, 72, 153, 0.8)',
                        'rgba(14, 165, 233, 0.8)',
                        'rgba(34, 197, 94, 0.8)'
                    ],
                    borderColor: '#ffffff',
                    borderWidth: 2
                }]
            },
            options: {
                ...deviceConfig.chartOptions,
                cutout: this.currentDevice === 'mobile' ? '50%' : '60%',
                plugins: {
                    title: {
                        display: true,
                        text: '포트폴리오 구성',
                        ...deviceConfig.titleConfig
                    },
                    legend: {
                        ...deviceConfig.legendConfig,
                        position: this.currentDevice === 'mobile' ? 'bottom' : 'right'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const percentage = ((context.parsed / portfolioData.total) * 100).toFixed(1);
                                return `${context.label}: ${percentage}%`;
                            }
                        }
                    }
                }
            }
        });

        this.charts.set(canvasId, chart);
        return chart;
    }

    /**
     * 밸류에이션 매트릭스 데이터 생성
     */
    generateValuationMatrixData(data) {
        if (!data || data.length === 0) return { buyZone: [], holdZone: [], sellZone: [] };

        const result = { buyZone: [], holdZone: [], sellZone: [] };

        data.forEach(company => {
            const per = parseFloat(company['PER (Oct-25)']) || 0;
            const pbr = parseFloat(company['PBR (Oct-25)']) || 0;
            
            if (per <= 0 || pbr <= 0 || per > 100 || pbr > 20) return;

            const point = {
                x: per,
                y: pbr,
                company: company.Ticker,
                name: company.corpName
            };

            // 매수/매도/관망 영역 분류
            if (per <= 15 && pbr <= 2) {
                result.buyZone.push(point);
            } else if (per >= 25 || pbr >= 4) {
                result.sellZone.push(point);
            } else {
                result.holdZone.push(point);
            }
        });

        return result;
    }

    /**
     * 섹터 히트맵 데이터 생성
     */
    generateSectorHeatmapData(data) {
        if (!data || data.length === 0) return { sectors: [], returns: [], colors: [] };

        const sectorReturns = {};
        const sectorCounts = {};

        // 섹터별 평균 수익률 계산
        data.forEach(company => {
            const sector = company.industry;
            const returnValue = parseFloat(company['Return (Y)']) || 0;
            
            if (!sectorReturns[sector]) {
                sectorReturns[sector] = 0;
                sectorCounts[sector] = 0;
            }
            
            sectorReturns[sector] += returnValue;
            sectorCounts[sector]++;
        });

        const sectors = Object.keys(sectorReturns);
        const returns = sectors.map(sector => 
            sectorCounts[sector] > 0 ? sectorReturns[sector] / sectorCounts[sector] : 0
        );

        // 수익률에 따른 색상 생성
        const maxReturn = Math.max(...returns);
        const minReturn = Math.min(...returns);
        const colors = returns.map(returnValue => {
            const intensity = (returnValue - minReturn) / (maxReturn - minReturn);
            if (returnValue > 0) {
                return `rgba(34, 197, 94, ${0.3 + intensity * 0.5})`; // 초록색 계열
            } else {
                return `rgba(239, 68, 68, ${0.3 + (1 - intensity) * 0.5})`; // 빨간색 계열
            }
        });

        return { sectors, returns, colors };
    }

    /**
     * 모멘텀 데이터 생성
     */
    generateMomentumData(data) {
        const dates = ['3개월 전', '2개월 전', '1개월 전', '현재'];
        
        // 실제로는 시계열 데이터가 필요하지만, 현재는 시뮬레이션
        const upTrend = [5, 8, 12, 15];
        const downTrend = [-3, -5, -2, -1];

        return { dates, upTrend, downTrend };
    }

    /**
     * 매트릭스 클릭 처리
     */
    handleMatrixClick(dataPoint) {
        console.log(`📊 밸류에이션 매트릭스 클릭: ${dataPoint.company}`);
        
        // 해당 기업 찾기
        const company = window.allData?.find(c => c.Ticker === dataPoint.company);
        if (company && window.showCompanyAnalysisModal) {
            window.showCompanyAnalysisModal(company);
        }
    }

    /**
     * 터치 제스처 설정 (ResponsiveManager에서 호출)
     */
    setupTouchGestures() {
        this.addTouchSupport();
    }

    /**
     * 터치 제스처 지원 추가
     */
    addTouchSupport() {
        if (this.currentDevice === 'mobile' || this.currentDevice === 'tablet') {
            this.charts.forEach((chart, canvasId) => {
                const canvas = document.getElementById(canvasId);
                if (canvas) {
                    // 핀치 줌 방지 (차트 자체 줌 사용)
                    canvas.addEventListener('touchstart', (e) => {
                        if (e.touches.length > 1) {
                            e.preventDefault();
                        }
                    }, { passive: false });

                    // 스와이프 제스처 추가
                    this.addSwipeGestures(canvas, chart);
                }
            });
        }
    }

    /**
     * 스와이프 제스처 추가
     */
    addSwipeGestures(canvas, chart) {
        let startX, startY, startTime;

        canvas.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
        });

        canvas.addEventListener('touchend', (e) => {
            if (!startX || !startY) return;

            const touch = e.changedTouches[0];
            const endX = touch.clientX;
            const endY = touch.clientY;
            const endTime = Date.now();

            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const deltaTime = endTime - startTime;

            // 스와이프 감지 (최소 거리와 최대 시간)
            if (Math.abs(deltaX) > 50 && deltaTime < 300) {
                if (deltaX > 0) {
                    this.handleSwipeRight(chart);
                } else {
                    this.handleSwipeLeft(chart);
                }
            }

            startX = startY = null;
        });
    }

    /**
     * 오른쪽 스와이프 처리
     */
    handleSwipeRight(chart) {
        console.log('👉 오른쪽 스와이프 감지');
        // 이전 데이터 또는 이전 페이지로 이동
    }

    /**
     * 왼쪽 스와이프 처리
     */
    handleSwipeLeft(chart) {
        console.log('👈 왼쪽 스와이프 감지');
        // 다음 데이터 또는 다음 페이지로 이동
    }

    /**
     * 차트 내보내기 (디바이스별 최적화)
     */
    exportChart(canvasId, format = 'png') {
        const chart = this.charts.get(canvasId);
        if (!chart) return;

        // 모바일에서는 더 높은 해상도로 내보내기
        const pixelRatio = this.currentDevice === 'mobile' ? 2 : 1;
        
        const url = chart.toBase64Image('image/' + format, 1.0);
        
        if (navigator.share && this.currentDevice === 'mobile') {
            // 모바일에서는 네이티브 공유 사용
            this.shareChart(url, canvasId);
        } else {
            // 데스크톱에서는 다운로드
            this.downloadChart(url, canvasId, format);
        }
    }

    /**
     * 차트 공유 (모바일)
     */
    async shareChart(dataUrl, canvasId) {
        try {
            const blob = await fetch(dataUrl).then(r => r.blob());
            const file = new File([blob], `chart-${canvasId}.png`, { type: 'image/png' });
            
            await navigator.share({
                title: '주식 분석 차트',
                text: '100xFenok 주식 분석기에서 생성된 차트입니다.',
                files: [file]
            });
        } catch (error) {
            console.log('공유 실패, 다운로드로 대체:', error);
            this.downloadChart(dataUrl, canvasId, 'png');
        }
    }

    /**
     * 차트 다운로드
     */
    downloadChart(dataUrl, canvasId, format) {
        const link = document.createElement('a');
        link.download = `chart-${canvasId}-${Date.now()}.${format}`;
        link.href = dataUrl;
        link.click();
    }

    /**
     * 모든 차트 제거
     */
    destroyAllCharts() {
        this.charts.forEach((chart, canvasId) => {
            chart.destroy();
        });
        this.charts.clear();
        console.log('📊 모든 고급 차트 제거 완료');
    }
}

// 전역 인스턴스 생성
window.advancedChartManager = new AdvancedChartManager();

console.log('✅ AdvancedChartManager 로드 완료 - 반응형 고급 차트 시스템');