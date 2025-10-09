/**
 * HighYieldHeatmap - 하이일드 스프레드 히트맵
 *
 * High-Yield Spread = 기업채 금리 - 국채 금리
 * 섹터별 신용 위험 지표 (높을수록 위험)
 *
 * 기능:
 * - 섹터별 히트맵 시각화
 * - 위험도 색상 코딩 (초록/노랑/빨강)
 * - 시간 경과에 따른 변화 추적
 * - 부드러운 색상 전환 애니메이션
 * - 섹터 클릭 시 상세 정보 표시
 *
 * @class HighYieldHeatmap
 */

export default class HighYieldHeatmap {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;

        // 데이터
        this.data = []; // { sector, spread, date, change }
        this.historicalData = new Map(); // sector -> [historical spreads]

        // 섹터 목록
        this.sectors = [
            'Technology',
            'Financial',
            'Healthcare',
            'Energy',
            'Consumer',
            'Industrial',
            'Utilities',
            'Materials'
        ];

        // 위험도 임계값 (basis points)
        this.thresholds = {
            safe: 300,      // < 300 bps
            warning: 500    // 300-500 bps
                           // > 500 bps = danger
        };

        console.log('✅ HighYieldHeatmap 생성됨');
    }

    /**
     * 렌더링
     */
    render() {
        const container = document.createElement('div');
        container.className = 'high-yield-heatmap-container';

        // 헤더
        const header = document.createElement('div');
        header.className = 'widget-header';
        header.innerHTML = `
            <h3 class="widget-title">🔥 High-Yield Spreads</h3>
            <span class="widget-subtitle">섹터별 신용 위험 히트맵</span>
        `;
        container.appendChild(header);

        // 히트맵 그리드
        const heatmapGrid = document.createElement('div');
        heatmapGrid.className = 'heatmap-grid';
        heatmapGrid.id = 'heatmap-grid';
        heatmapGrid.innerHTML = this.renderHeatmapCells();
        container.appendChild(heatmapGrid);

        // 범례
        const legend = document.createElement('div');
        legend.className = 'heatmap-legend';
        legend.innerHTML = `
            <div class="legend-item">
                <span class="legend-color" style="background: ${this.getThemeColor('safe')}"></span>
                <span>안전 (< 300 bps)</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: ${this.getThemeColor('warning')}"></span>
                <span>주의 (300-500 bps)</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: ${this.getThemeColor('danger')}"></span>
                <span>위험 (> 500 bps)</span>
            </div>
        `;
        container.appendChild(legend);

        // 상세 정보 패널 (초기에는 숨김)
        const detailPanel = document.createElement('div');
        detailPanel.className = 'heatmap-detail-panel';
        detailPanel.id = 'heatmap-detail-panel';
        detailPanel.style.display = 'none';
        container.appendChild(detailPanel);

        // 이벤트 리스너 설정
        setTimeout(() => this.attachEventListeners(), 0);

        return container;
    }

    /**
     * 히트맵 셀 렌더링
     */
    renderHeatmapCells() {
        if (this.data.length === 0) {
            return '<div class="heatmap-loading">데이터 로딩 중...</div>';
        }

        return this.sectors.map(sector => {
            const sectorData = this.data.find(d => d.sector === sector);

            if (!sectorData) {
                return `
                    <div class="heatmap-cell" data-sector="${sector}">
                        <div class="cell-sector">${sector}</div>
                        <div class="cell-value">N/A</div>
                    </div>
                `;
            }

            const spread = sectorData.spread;
            const change = sectorData.change || 0;
            const riskLevel = this.getRiskLevelKey(spread);
            const backgroundColor = this.getThemeColor(riskLevel);
            const textColor = this.getTextColor(riskLevel);

            return `
                <div class="heatmap-cell"
                     data-sector="${sector}"
                     style="background-color: ${backgroundColor}; color: ${textColor}; transition: all 0.5s ease;">
                    <div class="cell-sector">${sector}</div>
                    <div class="cell-value">${spread.toFixed(0)} bps</div>
                    <div class="cell-change ${change >= 0 ? 'positive' : 'negative'}">
                        ${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * 이벤트 리스너 설정
     */
    attachEventListeners() {
        const grid = document.getElementById('heatmap-grid');
        if (!grid) return;

        grid.addEventListener('click', (event) => {
            const cell = event.target.closest('.heatmap-cell');
            if (cell) {
                const sector = cell.dataset.sector;
                this.showSectorDetail(sector);
            }
        });
    }

    /**
     * 섹터 상세 정보 표시
     */
    showSectorDetail(sector) {
        const sectorData = this.data.find(d => d.sector === sector);
        if (!sectorData) return;

        const detailPanel = document.getElementById('heatmap-detail-panel');
        if (!detailPanel) return;

        const historical = this.historicalData.get(sector) || [];
        const avgSpread = historical.length > 0
            ? historical.reduce((sum, val) => sum + val, 0) / historical.length
            : sectorData.spread;

        const riskLevel = this.getRiskLevel(sectorData.spread);
        const trend = this.calculateTrend(historical);

        detailPanel.innerHTML = `
            <div class="detail-header">
                <h4>${sector} 섹터</h4>
                <button class="detail-close" onclick="this.parentElement.parentElement.style.display='none'">✕</button>
            </div>
            <div class="detail-content">
                <div class="detail-row">
                    <span class="detail-label">현재 스프레드:</span>
                    <span class="detail-value">${sectorData.spread.toFixed(2)} bps</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">위험도:</span>
                    <span class="detail-value" style="color: ${this.getThemeColor(this.getRiskLevelKey(sectorData.spread))}">${riskLevel}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">변화:</span>
                    <span class="detail-value ${sectorData.change >= 0 ? 'positive' : 'negative'}">
                        ${sectorData.change >= 0 ? '+' : ''}${sectorData.change.toFixed(2)} bps
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">평균 (30일):</span>
                    <span class="detail-value">${avgSpread.toFixed(2)} bps</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">추세:</span>
                    <span class="detail-value">${trend}</span>
                </div>
            </div>
        `;

        detailPanel.style.display = 'block';
    }

    /**
     * 추세 계산
     */
    calculateTrend(historical) {
        if (historical.length < 2) return '불충분';

        const recent = historical.slice(-7); // 최근 7일
        const older = historical.slice(-14, -7); // 이전 7일

        const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
        const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;

        const change = recentAvg - olderAvg;

        if (Math.abs(change) < 10) return '안정적 (±10 bps)';
        if (change > 0) return `상승 중 (+${change.toFixed(0)} bps)`;
        return `하락 중 (${change.toFixed(0)} bps)`;
    }

    /**
     * 데이터 업데이트
     * @param {Array} newData - 새로운 하이일드 스프레드 데이터
     */
    updateData(newData) {
        if (!newData || newData.length === 0) return;

        // 변화량 계산
        const updatedData = newData.map(item => {
            const oldData = this.data.find(d => d.sector === item.sector);
            const change = oldData ? item.spread - oldData.spread : 0;
            return { ...item, change };
        });

        this.data = updatedData;

        // 히스토리 업데이트
        updatedData.forEach(item => {
            if (!this.historicalData.has(item.sector)) {
                this.historicalData.set(item.sector, []);
            }
            const history = this.historicalData.get(item.sector);
            history.push(item.spread);
            if (history.length > 30) history.shift(); // 최근 30일만 유지
        });

        // 히트맵 다시 렌더링
        const grid = document.getElementById('heatmap-grid');
        if (grid) {
            grid.innerHTML = this.renderHeatmapCells();
            this.attachEventListeners();
        }

        console.log(`✅ High-Yield Heatmap 데이터 업데이트 (${newData.length}개 섹터)`);
    }

    /**
     * 위험도 계산
     * @param {number} spread - 하이일드 스프레드 값 (bps)
     * @returns {string} 위험도 레벨 키
     */
    getRiskLevelKey(spread) {
        if (spread > this.thresholds.warning) return 'danger';
        if (spread > this.thresholds.safe) return 'warning';
        return 'safe';
    }

    /**
     * 위험도 라벨
     */
    getRiskLevel(spread) {
        const key = this.getRiskLevelKey(spread);
        const labels = {
            safe: '안전',
            warning: '주의',
            danger: '위험'
        };
        return labels[key];
    }

    /**
     * 텍스트 색상 (배경에 따라)
     */
    getTextColor(riskLevel) {
        // 밝은 배경에는 어두운 텍스트, 어두운 배경에는 밝은 텍스트
        if (this.theme === 'dark') {
            return '#f3f4f6'; // 항상 밝은 텍스트
        } else {
            // light 테마에서는 배경에 따라
            return riskLevel === 'safe' ? '#1f2937' : '#f3f4f6';
        }
    }

    /**
     * 테마 색상 가져오기
     */
    getThemeColor(type) {
        const colors = {
            light: {
                safe: '#10b981',
                warning: '#f59e0b',
                danger: '#ef4444',
                text: '#1f2937',
                grid: '#e5e7eb'
            },
            dark: {
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
     * 테마 변경
     */
    setTheme(newTheme) {
        this.theme = newTheme;

        // 히트맵 다시 렌더링
        const grid = document.getElementById('heatmap-grid');
        if (grid) {
            grid.innerHTML = this.renderHeatmapCells();
            this.attachEventListeners();
        }

        // 범례 업데이트
        const legend = document.querySelector('.heatmap-legend');
        if (legend) {
            legend.innerHTML = `
                <div class="legend-item">
                    <span class="legend-color" style="background: ${this.getThemeColor('safe')}"></span>
                    <span>안전 (< 300 bps)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: ${this.getThemeColor('warning')}"></span>
                    <span>주의 (300-500 bps)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: ${this.getThemeColor('danger')}"></span>
                    <span>위험 (> 500 bps)</span>
                </div>
            `;
        }
    }

    /**
     * 컴포넌트 파괴
     */
    destroy() {
        this.data = [];
        this.historicalData.clear();
        console.log('✅ HighYieldHeatmap 파괴됨');
    }
}
