/**
 * TreasuryRateCurve - 국채 금리 곡선 애니메이션 차트
 *
 * Treasury Yield Curve = 만기별 국채 금리
 * 경제 전망 및 금리 정책 지표
 *
 * 곡선 형태:
 * - 정상 (Normal): 장기 > 단기 (경제 성장 예상)
 * - 평탄 (Flat): 장기 ≈ 단기 (불확실성)
 * - 역전 (Inverted): 장기 < 단기 (경기 침체 신호)
 *
 * 기능:
 * - 실시간 라인 차트 (Chart.js)
 * - 곡선 형태 자동 감지
 * - 부드러운 애니메이션 전환
 * - 시간 경과에 따른 변화 추적
 * - 곡선 비교 기능 (현재 vs 과거)
 *
 * @class TreasuryRateCurve
 */

export default class TreasuryRateCurve {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;

        // 차트 인스턴스
        this.chart = null;
        this.canvas = null;

        // 데이터
        this.currentData = {}; // { '1M': 4.5, '3M': 4.6, ... }
        this.previousData = {}; // 비교용 이전 데이터
        this.historicalData = []; // 시계열 데이터

        // 만기 목록 (단기 → 장기)
        this.maturities = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y', '30Y'];

        // 곡선 형태 임계값
        this.curveThresholds = {
            inverted: -0.1,  // 10Y - 2Y < -0.1% → 역전
            flat: 0.3        // 10Y - 2Y < 0.3% → 평탄
        };

        console.log('✅ TreasuryRateCurve 생성됨');
    }

    /**
     * 렌더링
     */
    render() {
        const container = document.createElement('div');
        container.className = 'treasury-curve-container';

        // 헤더
        const header = document.createElement('div');
        header.className = 'widget-header';
        header.innerHTML = `
            <h3 class="widget-title">📊 Treasury Yield Curve</h3>
            <span class="widget-subtitle">국채 금리 곡선</span>
        `;
        container.appendChild(header);

        // 곡선 형태 표시
        const curveStatus = document.createElement('div');
        curveStatus.className = 'curve-status';
        curveStatus.id = 'curve-status';
        curveStatus.innerHTML = this.getCurveStatusHTML();
        container.appendChild(curveStatus);

        // 캔버스
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'treasury-curve-canvas';
        this.canvas.width = 600;
        this.canvas.height = 300;
        container.appendChild(this.canvas);

        // 금리 차이 표시 (2Y-10Y spread)
        const spreadInfo = document.createElement('div');
        spreadInfo.className = 'spread-info';
        spreadInfo.id = 'spread-info';
        spreadInfo.innerHTML = this.getSpreadInfoHTML();
        container.appendChild(spreadInfo);

        // 범례
        const legend = document.createElement('div');
        legend.className = 'chart-legend';
        legend.innerHTML = `
            <div class="legend-item">
                <span class="legend-color" style="background: ${this.getThemeColor('primary')}; height: 3px;"></span>
                <span>현재 곡선</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: #888; border-style: dashed; height: 2px;"></span>
                <span>이전 곡선 (7일 전)</span>
            </div>
        `;
        container.appendChild(legend);

        // 차트 초기화
        setTimeout(() => this.initChart(), 0);

        return container;
    }

    /**
     * Chart.js 초기화
     */
    initChart() {
        if (!this.canvas || typeof Chart === 'undefined') {
            console.warn('⚠️ Chart.js가 로드되지 않았습니다');
            return;
        }

        const ctx = this.canvas.getContext('2d');

        // 데이터 준비
        const currentRates = this.maturities.map(m => this.currentData[m] || null);
        const previousRates = this.maturities.map(m => this.previousData[m] || null);

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.maturities,
                datasets: [
                    {
                        label: '현재 금리',
                        data: currentRates,
                        borderColor: this.getThemeColor('primary'),
                        backgroundColor: this.hexToRgba(this.getThemeColor('primary'), 0.1),
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: this.getThemeColor('primary')
                    },
                    {
                        label: '이전 금리 (7일 전)',
                        data: previousRates,
                        borderColor: '#888',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#888'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 1000,
                    easing: 'easeInOutQuart'
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: 'Yield (%)',
                            color: this.getThemeColor('text')
                        },
                        grid: {
                            color: this.getThemeColor('grid')
                        },
                        ticks: {
                            color: this.getThemeColor('text'),
                            callback: function(value) {
                                return value.toFixed(2) + '%';
                            }
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: '만기',
                            color: this.getThemeColor('text')
                        },
                        grid: {
                            color: this.getThemeColor('grid')
                        },
                        ticks: {
                            color: this.getThemeColor('text')
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: this.getThemeColor('text'),
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: this.getThemeColor('primary'),
                        borderWidth: 1,
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                if (value === null) return '';
                                return `${context.dataset.label}: ${value.toFixed(3)}%`;
                            }
                        }
                    }
                }
            }
        });

        console.log('✅ Treasury Yield Curve 차트 초기화 완료');
    }

    /**
     * 데이터 업데이트
     * @param {Object} newData - 새로운 금리 데이터 { '1M': 4.5, '3M': 4.6, ... }
     */
    updateData(newData) {
        if (!newData || Object.keys(newData).length === 0) return;

        // 이전 데이터 저장
        this.previousData = { ...this.currentData };
        this.currentData = newData;

        // 히스토리 저장
        this.historicalData.push({
            date: new Date(),
            rates: { ...newData }
        });

        // 최근 30일만 유지
        if (this.historicalData.length > 30) {
            this.historicalData.shift();
        }

        // 차트 업데이트
        if (this.chart) {
            const currentRates = this.maturities.map(m => newData[m] || null);
            const previousRates = this.maturities.map(m => this.previousData[m] || null);

            this.chart.data.datasets[0].data = currentRates;
            this.chart.data.datasets[1].data = previousRates;

            this.chart.update('active');
        }

        // 곡선 형태 업데이트
        this.updateCurveStatus();
        this.updateSpreadInfo();

        console.log(`✅ Treasury Curve 데이터 업데이트`);
    }

    /**
     * 곡선 형태 HTML 생성
     */
    getCurveStatusHTML() {
        const curveType = this.detectCurveType();
        const { color, icon, label, description } = this.getCurveTypeInfo(curveType);

        return `
            <div class="curve-type" style="color: ${color}">
                <span class="curve-icon">${icon}</span>
                <span class="curve-label">${label}</span>
            </div>
            <div class="curve-description">${description}</div>
        `;
    }

    /**
     * 곡선 형태 감지
     * @returns {string} 'normal' | 'flat' | 'inverted'
     */
    detectCurveType() {
        const rate10Y = this.currentData['10Y'];
        const rate2Y = this.currentData['2Y'];

        if (!rate10Y || !rate2Y) return 'normal';

        const spread = rate10Y - rate2Y;

        if (spread < this.curveThresholds.inverted) return 'inverted';
        if (spread < this.curveThresholds.flat) return 'flat';
        return 'normal';
    }

    /**
     * 곡선 형태 정보
     */
    getCurveTypeInfo(curveType) {
        const info = {
            normal: {
                color: this.getThemeColor('safe'),
                icon: '📈',
                label: '정상 (Normal)',
                description: '장기 금리 > 단기 금리 (경제 성장 예상)'
            },
            flat: {
                color: this.getThemeColor('warning'),
                icon: '➡️',
                label: '평탄 (Flat)',
                description: '장기 ≈ 단기 금리 (불확실성 증가)'
            },
            inverted: {
                color: this.getThemeColor('danger'),
                icon: '📉',
                label: '역전 (Inverted)',
                description: '장기 < 단기 금리 (경기 침체 신호)'
            }
        };

        return info[curveType] || info.normal;
    }

    /**
     * 곡선 형태 표시 업데이트
     */
    updateCurveStatus() {
        const element = document.getElementById('curve-status');
        if (element) {
            element.innerHTML = this.getCurveStatusHTML();
        }
    }

    /**
     * 금리 스프레드 정보 HTML
     */
    getSpreadInfoHTML() {
        const rate10Y = this.currentData['10Y'];
        const rate2Y = this.currentData['2Y'];

        if (!rate10Y || !rate2Y) {
            return '<div class="spread-loading">데이터 로딩 중...</div>';
        }

        const spread = rate10Y - rate2Y;
        const spreadBps = spread * 100; // basis points

        const previous10Y = this.previousData['10Y'];
        const previous2Y = this.previousData['2Y'];
        const previousSpread = (previous10Y && previous2Y) ? previous10Y - previous2Y : spread;
        const spreadChange = spread - previousSpread;

        return `
            <div class="spread-main">
                <span class="spread-label">10Y-2Y 스프레드:</span>
                <span class="spread-value" style="color: ${spread >= 0 ? this.getThemeColor('safe') : this.getThemeColor('danger')}">
                    ${spreadBps.toFixed(1)} bps
                </span>
            </div>
            <div class="spread-change ${spreadChange >= 0 ? 'positive' : 'negative'}">
                ${spreadChange >= 0 ? '▲' : '▼'} ${Math.abs(spreadChange * 100).toFixed(1)} bps (7일 대비)
            </div>
        `;
    }

    /**
     * 스프레드 정보 업데이트
     */
    updateSpreadInfo() {
        const element = document.getElementById('spread-info');
        if (element) {
            element.innerHTML = this.getSpreadInfoHTML();
        }
    }

    /**
     * 7일 전 데이터 가져오기
     */
    getDataFromDaysAgo(days) {
        if (this.historicalData.length < days) {
            return this.currentData;
        }

        const index = this.historicalData.length - days;
        return this.historicalData[index].rates;
    }

    /**
     * 테마 색상 가져오기
     */
    getThemeColor(type) {
        const colors = {
            light: {
                primary: '#2563eb',
                safe: '#10b981',
                warning: '#f59e0b',
                danger: '#ef4444',
                text: '#1f2937',
                grid: '#e5e7eb'
            },
            dark: {
                primary: '#3b82f6',
                safe: '#34d399',
                warning: '#fbbf24',
                danger: '#f87171',
                text: '#f3f4f6',
                grid: '#374151'
            }
        };

        return colors[this.theme]?.[type] || colors.dark[type];
    }

    /**
     * Hex to RGBA 변환
     */
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * 테마 변경
     */
    setTheme(newTheme) {
        this.theme = newTheme;

        if (this.chart) {
            // 차트 색상 업데이트
            this.chart.options.scales.y.title.color = this.getThemeColor('text');
            this.chart.options.scales.y.grid.color = this.getThemeColor('grid');
            this.chart.options.scales.y.ticks.color = this.getThemeColor('text');
            this.chart.options.scales.x.title.color = this.getThemeColor('text');
            this.chart.options.scales.x.grid.color = this.getThemeColor('grid');
            this.chart.options.scales.x.ticks.color = this.getThemeColor('text');
            this.chart.options.plugins.legend.labels.color = this.getThemeColor('text');

            this.chart.data.datasets[0].borderColor = this.getThemeColor('primary');
            this.chart.data.datasets[0].backgroundColor = this.hexToRgba(this.getThemeColor('primary'), 0.1);
            this.chart.data.datasets[0].pointBackgroundColor = this.getThemeColor('primary');

            this.chart.update();
        }

        // 곡선 상태 업데이트
        this.updateCurveStatus();
    }

    /**
     * 차트 파괴
     */
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        console.log('✅ TreasuryRateCurve 파괴됨');
    }
}
