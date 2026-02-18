/**
 * TEDSpreadChart - TED 스프레드 실시간 차트
 *
 * TED Spread = 3개월 LIBOR - 3개월 국채 금리
 * 금융시장 스트레스 지표 (높을수록 위험)
 *
 * 기능:
 * - 실시간 라인 차트 (Chart.js)
 * - 위험도 색상 코딩 (초록/노랑/빨강)
 * - 부드러운 애니메이션 전환
 * - 역사적 평균선 표시
 *
 * @class TEDSpreadChart
 */

export default class TEDSpreadChart {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;

        // 차트 인스턴스
        this.chart = null;
        this.canvas = null;

        // 데이터
        this.data = [];
        this.historicalAverage = 35; // 역사적 평균 (bps)

        // 위험도 임계값 (basis points)
        this.thresholds = {
            safe: 50,
            warning: 100
        };

        console.log('✅ TEDSpreadChart 생성됨');
    }

    /**
     * 렌더링
     */
    render() {
        const container = document.createElement('div');
        container.className = 'ted-spread-chart-container';

        // 헤더
        const header = document.createElement('div');
        header.className = 'widget-header';
        header.innerHTML = `
            <h3 class="widget-title">📈 TED Spread</h3>
            <span class="widget-subtitle">금융시장 스트레스 지표</span>
        `;
        container.appendChild(header);

        // 현재값 표시
        const currentValue = document.createElement('div');
        currentValue.className = 'current-value';
        currentValue.id = 'ted-current-value';
        currentValue.innerHTML = this.getCurrentValueHTML();
        container.appendChild(currentValue);

        // 캔버스
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'ted-spread-canvas';
        this.canvas.width = 600;
        this.canvas.height = 300;
        container.appendChild(this.canvas);

        // 범례
        const legend = document.createElement('div');
        legend.className = 'chart-legend';
        legend.innerHTML = `
            <div class="legend-item">
                <span class="legend-color" style="background: ${this.getThemeColor('safe')}"></span>
                <span>안전 (< 50 bps)</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: ${this.getThemeColor('warning')}"></span>
                <span>주의 (50-100 bps)</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: ${this.getThemeColor('danger')}"></span>
                <span>위험 (> 100 bps)</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: #888; border-style: dashed;"></span>
                <span>역사적 평균 (${this.historicalAverage} bps)</span>
            </div>
        `;
        container.appendChild(legend);

        // ✅ Lazy Initialization: 탭 활성화 시에만 초기화
        // setTimeout(() => this.initChart(), 0); // 제거
        this._needsInitialization = true;

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
        const labels = this.data.map(d => this.formatDate(d.date));
        const values = this.data.map(d => d.value);

        // 배경 색상 (위험도 기반)
        const backgroundColors = values.map(v => this.getBackgroundColor(v));

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'TED Spread (bps)',
                        data: values,
                        borderColor: this.getThemeColor('primary'),
                        backgroundColor: backgroundColors,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4, // 부드러운 곡선
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: '역사적 평균',
                        data: Array(values.length).fill(this.historicalAverage),
                        borderColor: '#888',
                        borderWidth: 1,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 750,
                    easing: 'easeInOutQuart'
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Basis Points (bps)',
                            color: this.getThemeColor('text')
                        },
                        grid: {
                            color: this.getThemeColor('grid')
                        },
                        ticks: {
                            color: this.getThemeColor('text')
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: '날짜',
                            color: this.getThemeColor('text')
                        },
                        grid: {
                            color: this.getThemeColor('grid')
                        },
                        ticks: {
                            color: this.getThemeColor('text'),
                            maxRotation: 45,
                            minRotation: 45
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
                                const risk = this.getRiskLevel(value);
                                return `${context.dataset.label}: ${value.toFixed(2)} bps (${risk})`;
                            }
                        }
                    }
                }
            }
        });

        console.log('✅ TED Spread 차트 초기화 완료');
    }

    /**
     * 데이터 업데이트
     * @param {Array} newData - 새로운 TED 스프레드 데이터
     */
    updateData(newData) {
        if (!newData || newData.length === 0) return;

        this.data = newData.slice(-30); // 최근 30일

        // 차트 업데이트
        if (this.chart) {
            const labels = this.data.map(d => this.formatDate(d.date));
            const values = this.data.map(d => d.value);
            const backgroundColors = values.map(v => this.getBackgroundColor(v));

            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = values;
            this.chart.data.datasets[0].backgroundColor = backgroundColors;
            this.chart.data.datasets[1].data = Array(values.length).fill(this.historicalAverage);

            this.chart.update('active'); // 부드러운 애니메이션
        }

        // 현재값 표시 업데이트
        this.updateCurrentValue();

        console.log(`✅ TED Spread 데이터 업데이트 (${newData.length}개 포인트)`);
    }

    /**
     * 현재값 표시 업데이트
     */
    updateCurrentValue() {
        const element = document.getElementById('ted-current-value');
        if (element) {
            element.innerHTML = this.getCurrentValueHTML();
        }
    }

    /**
     * 현재값 HTML 생성
     */
    getCurrentValueHTML() {
        if (this.data.length === 0) {
            return '<div class="value-loading">데이터 로딩 중...</div>';
        }

        const latest = this.data[this.data.length - 1];
        const previous = this.data.length > 1 ? this.data[this.data.length - 2] : null;
        const change = previous ? latest.value - previous.value : 0;
        const changePercent = previous ? (change / previous.value) * 100 : 0;

        const riskLevel = this.getRiskLevel(latest.value);
        const riskColor = this.getThemeColor(this.getRiskLevelKey(latest.value));

        return `
            <div class="value-main" style="color: ${riskColor}">
                <span class="value-number">${latest.value.toFixed(2)}</span>
                <span class="value-unit">bps</span>
            </div>
            <div class="value-change ${change >= 0 ? 'positive' : 'negative'}">
                ${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)} (${changePercent.toFixed(1)}%)
            </div>
            <div class="value-risk">
                위험도: <strong>${riskLevel}</strong>
            </div>
        `;
    }

    /**
     * 위험도 계산
     * @param {number} value - TED 스프레드 값 (bps)
     * @returns {string} 위험도 레벨 키
     */
    getRiskLevelKey(value) {
        if (value > this.thresholds.warning) return 'danger';
        if (value > this.thresholds.safe) return 'warning';
        return 'safe';
    }

    /**
     * 위험도 라벨
     */
    getRiskLevel(value) {
        const key = this.getRiskLevelKey(value);
        const labels = {
            safe: '안전',
            warning: '주의',
            danger: '위험'
        };
        return labels[key];
    }

    /**
     * 배경 색상 (그라데이션)
     */
    getBackgroundColor(value) {
        const key = this.getRiskLevelKey(value);
        const baseColor = this.getThemeColor(key);

        // RGBA로 변환하여 투명도 적용
        return this.hexToRgba(baseColor, 0.3);
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
     * 날짜 포맷
     */
    formatDate(date) {
        if (typeof date === 'string') {
            date = new Date(date);
        }

        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${month}/${day}`;
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

            this.chart.update();
        }
    }

    /**
     * 차트가 필요한 경우 초기화 (Lazy Initialization)
     */
    ensureInitialized() {
        if (this._needsInitialization && !this.chart && this.isVisible()) {
            this.initChart();
            this._needsInitialization = false;
            console.log('✅ TEDSpreadChart Lazy Initialization 완료');
        }
    }

    /**
     * 차트 가시성 확인
     */
    isVisible() {
        return this.canvas && this.canvas.offsetParent !== null;
    }

    /**
     * 차트 크기 재조정
     */
    resize() {
        if (this.chart && typeof this.chart.resize === 'function') {
            this.chart.resize();
            console.log('📊 TEDSpreadChart resize 완료');
        }
    }

    /**
     * 차트 파괴
     */
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        console.log('✅ TEDSpreadChart 파괴됨');
    }
}
