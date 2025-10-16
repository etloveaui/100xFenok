/**
 * EconomicDashboard - 실시간 경제지표 대시보드
 *
 * Global Scouter의 E_Indicators 모듈을 웹 네이티브로 변환
 *
 * 핵심 기능:
 * - TED 스프레드 실시간 차트
 * - 하이일드 스프레드 히트맵
 * - 국채금리 곡선 애니메이션
 * - 경제지표 알림 센터
 * - 위험도 색상 코딩 (빨강/노랑/초록)
 * - DataSkeleton 연동
 *
 * @class EconomicDashboard
 */

// 컴포넌트 import (상대 경로)
import TEDSpreadChart from './components/TEDSpreadChart.js';
import HighYieldHeatmap from './components/HighYieldHeatmap.js';
import TreasuryRateCurve from './components/TreasuryRateCurve.js';
import EconomicAlertCenter from './components/EconomicAlertCenter.js';

export default class EconomicDashboard {
    constructor(config = {}) {
        const {
            eventSystem,
            dataSkeleton,
            uiFramework,
            updateInterval = 30000, // 30초마다 업데이트
            theme = 'dark'
        } = config;

        // 시스템 참조
        this.eventSystem = eventSystem;
        this.dataSkeleton = dataSkeleton;
        this.uiFramework = uiFramework;

        // 설정
        this.updateInterval = updateInterval;
        this.theme = theme;
        this.autoUpdate = true;

        // 컴포넌트 레지스트리
        this.components = new Map();

        // 상태
        this.state = {
            isInitialized: false,
            lastUpdate: null,
            riskLevel: 'safe', // safe, warning, danger
            activeAlerts: []
        };

        // 데이터 캐시
        this.dataCache = {
            tedSpread: [],
            highYieldSpread: [],
            treasuryRates: {},
            economicIndicators: []
        };

        // 업데이트 타이머
        this.updateTimer = null;

        console.log('✅ EconomicDashboard 초기화 완료');
    }

    // ========================================
    // 초기화 및 생명주기
    // ========================================

    /**
     * 대시보드 초기화
     */
    async init() {
        try {
            console.log('🚀 EconomicDashboard 초기화 시작...');

            // 1. 컴포넌트 등록
            this.registerComponents();

            // 2. 데이터 구독
            this.subscribeToData();

            // 3. 이벤트 리스너 설정
            this.setupEventListeners();

            // 4. 초기 데이터 로드
            await this.loadInitialData();

            // 5. 자동 업데이트 시작
            if (this.autoUpdate) {
                this.startAutoUpdate();
            }

            this.state.isInitialized = true;
            console.log('✅ EconomicDashboard 초기화 완료');

            return this;
        } catch (error) {
            console.error('❌ EconomicDashboard 초기화 실패:', error);
            throw error;
        }
    }

    /**
     * 컴포넌트 등록
     */
    registerComponents() {
        // TED 스프레드 차트
        this.components.set('tedSpread', new TEDSpreadChart({
            eventSystem: this.eventSystem,
            theme: this.theme
        }));

        // 하이일드 히트맵
        this.components.set('highYieldHeatmap', new HighYieldHeatmap({
            eventSystem: this.eventSystem,
            theme: this.theme
        }));

        // 국채금리 곡선
        this.components.set('treasuryRateCurve', new TreasuryRateCurve({
            eventSystem: this.eventSystem,
            theme: this.theme
        }));

        // 경제지표 알림 센터
        this.components.set('alertCenter', new EconomicAlertCenter({
            eventSystem: this.eventSystem,
            theme: this.theme
        }));

        console.log(`✅ ${this.components.size}개 컴포넌트 등록 완료`);
    }

    /**
     * 데이터 구독 설정
     */
    subscribeToData() {
        if (!this.dataSkeleton) {
            console.warn('⚠️ DataSkeleton이 없어 데이터 구독을 건너뜁니다');
            return;
        }

        // 데이터 업데이트 구독
        this.dataSkeleton.subscribe((event) => {
            if (event.type === 'data:updated') {
                console.log('📊 경제 데이터 업데이트 감지');
                this.handleDataUpdate(event);
            }
        }, { events: ['data:updated'] });

        console.log('✅ 데이터 구독 설정 완료');
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        if (!this.eventSystem) return;

        // 위험도 변경 이벤트
        this.eventSystem.on('economic:risk:changed', (event) => {
            this.handleRiskChange(event.payload);
        }, { module: 'EconomicDashboard' });

        // 알림 발생 이벤트
        this.eventSystem.on('economic:alert', (event) => {
            this.handleAlert(event.payload);
        }, { module: 'EconomicDashboard' });

        // 테마 변경 이벤트
        this.eventSystem.on('ui:theme:changed', (event) => {
            this.handleThemeChange(event.payload.theme);
        }, { module: 'EconomicDashboard' });

        console.log('✅ 이벤트 리스너 설정 완료');
    }

    /**
     * 초기 데이터 로드
     */
    async loadInitialData() {
        console.log('📥 초기 데이터 로드 시작...');

        try {
            // DataSkeleton에서 경제 데이터 쿼리
            if (this.dataSkeleton) {
                const economicData = this.dataSkeleton.query({
                    filter: { category: 'economic_indicators' }
                });

                if (economicData && economicData.length > 0) {
                    this.processEconomicData(economicData);
                    console.log(`✅ ${economicData.length}개 경제지표 로드 완료`);
                } else {
                    console.warn('⚠️ 경제 데이터가 없습니다. 샘플 데이터를 생성합니다.');
                    this.generateSampleData();
                }
            } else {
                // DataSkeleton 없으면 샘플 데이터
                this.generateSampleData();
            }

            this.state.lastUpdate = new Date();
        } catch (error) {
            console.error('❌ 초기 데이터 로드 실패:', error);
            this.generateSampleData();
        }
    }

    // ========================================
    // 렌더링
    // ========================================

    /**
     * 대시보드 렌더링
     * @param {HTMLElement} container - 컨테이너 엘리먼트
     */
    render(container) {
        if (!container) {
            throw new Error('컨테이너가 필요합니다');
        }

        // 메인 컨테이너 생성
        const dashboard = document.createElement('div');
        dashboard.className = `economic-dashboard theme-${this.theme}`;
        dashboard.id = 'economic-dashboard';

        // 헤더
        dashboard.appendChild(this.renderHeader());

        // 메인 그리드
        dashboard.appendChild(this.renderMainGrid());

        // 푸터 (마지막 업데이트 시간)
        dashboard.appendChild(this.renderFooter());

        // 컨테이너에 추가
        container.appendChild(dashboard);

        console.log('✅ EconomicDashboard 렌더링 완료');

        return dashboard;
    }

    /**
     * 헤더 렌더링
     */
    renderHeader() {
        const header = document.createElement('div');
        header.className = 'dashboard-header';

        // 타이틀
        const title = document.createElement('h1');
        title.className = 'dashboard-title';
        title.textContent = '📊 Economic Dashboard';
        header.appendChild(title);

        // 위험도 인디케이터
        const riskIndicator = document.createElement('div');
        riskIndicator.className = `risk-indicator risk-${this.state.riskLevel}`;
        riskIndicator.id = 'risk-indicator';
        riskIndicator.innerHTML = `
            <span class="risk-icon">${this.getRiskIcon()}</span>
            <span class="risk-label">${this.getRiskLabel()}</span>
        `;
        header.appendChild(riskIndicator);

        // 컨트롤 버튼
        const controls = document.createElement('div');
        controls.className = 'dashboard-controls';

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'btn btn-refresh';
        refreshBtn.innerHTML = '🔄 새로고침';
        refreshBtn.onclick = () => this.refresh();

        const autoUpdateToggle = document.createElement('button');
        autoUpdateToggle.className = 'btn btn-toggle';
        autoUpdateToggle.innerHTML = this.autoUpdate ? '⏸ 자동 업데이트 중지' : '▶ 자동 업데이트 시작';
        autoUpdateToggle.onclick = () => this.toggleAutoUpdate();

        controls.appendChild(refreshBtn);
        controls.appendChild(autoUpdateToggle);
        header.appendChild(controls);

        return header;
    }

    /**
     * 메인 그리드 렌더링
     */
    renderMainGrid() {
        const grid = document.createElement('div');
        grid.className = 'dashboard-grid';

        // 그리드 레이아웃 (2x2)
        const layout = [
            { component: 'tedSpread', span: 'col-span-2' },
            { component: 'highYieldHeatmap', span: 'col-span-1' },
            { component: 'treasuryRateCurve', span: 'col-span-1' },
            { component: 'alertCenter', span: 'col-span-2' }
        ];

        layout.forEach(({ component, span }) => {
            const widget = document.createElement('div');
            widget.className = `dashboard-widget ${span}`;
            widget.id = `widget-${component}`;

            // 컴포넌트 렌더링
            const comp = this.components.get(component);
            if (comp) {
                try {
                    const rendered = comp.render();
                    widget.appendChild(rendered);
                } catch (error) {
                    console.error(`❌ ${component} 렌더링 실패:`, error);
                    widget.innerHTML = `<div class="error">컴포넌트 렌더링 실패</div>`;
                }
            }

            grid.appendChild(widget);
        });

        return grid;
    }

    /**
     * 푸터 렌더링
     */
    renderFooter() {
        const footer = document.createElement('div');
        footer.className = 'dashboard-footer';

        const lastUpdate = document.createElement('span');
        lastUpdate.className = 'last-update';
        lastUpdate.id = 'last-update';
        lastUpdate.textContent = this.getLastUpdateText();

        const dataSource = document.createElement('span');
        dataSource.className = 'data-source';
        dataSource.textContent = '데이터 출처: Global Scouter / GEMINI CLI';

        footer.appendChild(lastUpdate);
        footer.appendChild(dataSource);

        return footer;
    }

    // ========================================
    // 데이터 처리
    // ========================================

    /**
     * 데이터 업데이트 처리
     */
    handleDataUpdate(event) {
        const { data } = event;

        if (data && Array.isArray(data)) {
            this.processEconomicData(data);
            this.updateComponents();
            this.state.lastUpdate = new Date();
            this.updateLastUpdateDisplay();
        }
    }

    /**
     * 경제 데이터 처리
     */
    processEconomicData(data) {
        // TED 스프레드 데이터 추출
        this.dataCache.tedSpread = data.filter(d => d.indicator === 'ted_spread');

        // 하이일드 스프레드 데이터 추출
        this.dataCache.highYieldSpread = data.filter(d => d.indicator === 'high_yield_spread');

        // 국채금리 데이터 추출
        const treasuryData = data.filter(d => d.category === 'treasury_rates');
        this.dataCache.treasuryRates = this.parseTreasuryRates(treasuryData);

        // 전체 경제지표
        this.dataCache.economicIndicators = data;

        // 위험도 계산
        this.calculateRiskLevel();
    }

    /**
     * 국채금리 데이터 파싱
     */
    parseTreasuryRates(data) {
        const rates = {};
        const maturities = ['3M', '6M', '1Y', '2Y', '5Y', '10Y', '30Y'];

        maturities.forEach(maturity => {
            const found = data.find(d => d.maturity === maturity);
            rates[maturity] = found ? found.rate : null;
        });

        return rates;
    }

    /**
     * 위험도 계산
     */
    calculateRiskLevel() {
        // TED 스프레드 기준 위험도 계산
        const latestTED = this.dataCache.tedSpread[this.dataCache.tedSpread.length - 1];
        const tedValue = latestTED ? latestTED.value : 0;

        let newRiskLevel = 'safe';

        if (tedValue > 100) {
            newRiskLevel = 'danger'; // 위험 (빨강)
        } else if (tedValue > 50) {
            newRiskLevel = 'warning'; // 주의 (노랑)
        } else {
            newRiskLevel = 'safe'; // 안전 (초록)
        }

        // 위험도 변경 시 이벤트 발행
        if (newRiskLevel !== this.state.riskLevel) {
            this.state.riskLevel = newRiskLevel;

            if (this.eventSystem) {
                this.eventSystem.emit('economic:risk:changed', {
                    level: newRiskLevel,
                    tedSpread: tedValue
                });
            }
        }
    }

    /**
     * 샘플 데이터 생성 (테스트용)
     */
    generateSampleData() {
        console.log('🔧 샘플 경제 데이터 생성...');

        const now = Date.now();

        // TED 스프레드 (30일치)
        this.dataCache.tedSpread = Array.from({ length: 30 }, (_, i) => ({
            date: new Date(now - (29 - i) * 24 * 60 * 60 * 1000),
            value: 30 + Math.random() * 40,
            indicator: 'ted_spread'
        }));

        // 하이일드 스프레드 (섹터별)
        const sectors = ['Technology', 'Financial', 'Energy', 'Healthcare', 'Consumer'];
        this.dataCache.highYieldSpread = sectors.map(sector => ({
            sector,
            spread: 200 + Math.random() * 300,
            change: (Math.random() - 0.5) * 50,
            indicator: 'high_yield_spread'
        }));

        // 국채금리
        this.dataCache.treasuryRates = {
            '3M': 5.20,
            '6M': 5.25,
            '1Y': 5.30,
            '2Y': 4.80,
            '5Y': 4.50,
            '10Y': 4.30,
            '30Y': 4.40
        };

        console.log('✅ 샘플 데이터 생성 완료');
    }

    // ========================================
    // 컴포넌트 업데이트
    // ========================================

    /**
     * 모든 컴포넌트 업데이트
     */
    updateComponents() {
        this.components.forEach((component, name) => {
            try {
                switch (name) {
                    case 'tedSpread':
                        component.updateData(this.dataCache.tedSpread);
                        break;
                    case 'highYieldHeatmap':
                        component.updateData(this.dataCache.highYieldSpread);
                        break;
                    case 'treasuryRateCurve':
                        component.updateData(this.dataCache.treasuryRates);
                        break;
                    case 'alertCenter':
                        // alertCenter는 이벤트 기반으로 자동 업데이트됨 (skip)
                        break;
                }
            } catch (error) {
                console.error(`❌ ${name} 업데이트 실패:`, error);
            }
        });
    }

    /**
     * 수동 새로고침
     */
    async refresh() {
        console.log('🔄 수동 새로고침 시작...');

        try {
            await this.loadInitialData();
            this.updateComponents();
            console.log('✅ 새로고침 완료');

            // 새로고침 버튼 애니메이션
            const btn = document.querySelector('.btn-refresh');
            if (btn) {
                btn.classList.add('spinning');
                setTimeout(() => btn.classList.remove('spinning'), 1000);
            }
        } catch (error) {
            console.error('❌ 새로고침 실패:', error);
        }
    }

    // ========================================
    // 자동 업데이트
    // ========================================

    /**
     * 자동 업데이트 시작
     */
    startAutoUpdate() {
        if (this.updateTimer) return;

        this.updateTimer = setInterval(() => {
            console.log('⏰ 자동 업데이트 실행...');
            this.refresh();
        }, this.updateInterval);

        console.log(`✅ 자동 업데이트 시작 (${this.updateInterval / 1000}초마다)`);
    }

    /**
     * 자동 업데이트 중지
     */
    stopAutoUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
            console.log('⏸ 자동 업데이트 중지');
        }
    }

    /**
     * 자동 업데이트 토글
     */
    toggleAutoUpdate() {
        this.autoUpdate = !this.autoUpdate;

        if (this.autoUpdate) {
            this.startAutoUpdate();
        } else {
            this.stopAutoUpdate();
        }

        // 버튼 텍스트 업데이트
        const btn = document.querySelector('.btn-toggle');
        if (btn) {
            btn.innerHTML = this.autoUpdate ? '⏸ 자동 업데이트 중지' : '▶ 자동 업데이트 시작';
        }
    }

    // ========================================
    // 이벤트 핸들러
    // ========================================

    /**
     * 위험도 변경 처리
     */
    handleRiskChange(data) {
        console.log('⚠️ 위험도 변경:', data);

        // 위험도 인디케이터 업데이트
        const indicator = document.getElementById('risk-indicator');
        if (indicator) {
            indicator.className = `risk-indicator risk-${data.level}`;
            indicator.innerHTML = `
                <span class="risk-icon">${this.getRiskIcon()}</span>
                <span class="risk-label">${this.getRiskLabel()}</span>
            `;
        }
    }

    /**
     * 알림 처리
     */
    handleAlert(alert) {
        console.log('🔔 경제지표 알림:', alert);

        this.state.activeAlerts.push({
            ...alert,
            timestamp: new Date()
        });

        // 최대 10개까지만 유지
        if (this.state.activeAlerts.length > 10) {
            this.state.activeAlerts.shift();
        }

        // 알림 센터에 새 알림 추가
        const alertCenter = this.components.get('alertCenter');
        if (alertCenter && alert) {
            alertCenter.addAlert(alert);
        }
    }

    /**
     * 테마 변경 처리
     */
    handleThemeChange(newTheme) {
        this.theme = newTheme;

        // 대시보드 테마 클래스 업데이트
        const dashboard = document.getElementById('economic-dashboard');
        if (dashboard) {
            dashboard.className = `economic-dashboard theme-${newTheme}`;
        }

        // 모든 컴포넌트에 테마 전파
        this.components.forEach(component => {
            if (component.setTheme) {
                component.setTheme(newTheme);
            }
        });
    }

    // ========================================
    // 유틸리티
    // ========================================

    /**
     * 위험도 아이콘 가져오기
     */
    getRiskIcon() {
        const icons = {
            safe: '🟢',
            warning: '🟡',
            danger: '🔴'
        };
        return icons[this.state.riskLevel] || '⚪';
    }

    /**
     * 위험도 라벨 가져오기
     */
    getRiskLabel() {
        const labels = {
            safe: '안전',
            warning: '주의',
            danger: '위험'
        };
        return labels[this.state.riskLevel] || '알 수 없음';
    }

    /**
     * 마지막 업데이트 시간 텍스트
     */
    getLastUpdateText() {
        if (!this.state.lastUpdate) {
            return '업데이트 대기 중...';
        }

        const now = new Date();
        const diff = Math.floor((now - this.state.lastUpdate) / 1000);

        if (diff < 60) {
            return `마지막 업데이트: ${diff}초 전`;
        } else if (diff < 3600) {
            return `마지막 업데이트: ${Math.floor(diff / 60)}분 전`;
        } else {
            return `마지막 업데이트: ${this.state.lastUpdate.toLocaleTimeString()}`;
        }
    }

    /**
     * 마지막 업데이트 표시 갱신
     */
    updateLastUpdateDisplay() {
        const element = document.getElementById('last-update');
        if (element) {
            element.textContent = this.getLastUpdateText();
        }
    }

    /**
     * 대시보드 파괴
     */
    destroy() {
        // 자동 업데이트 중지
        this.stopAutoUpdate();

        // 모든 컴포넌트 파괴
        this.components.forEach(component => {
            if (component.destroy) {
                component.destroy();
            }
        });

        this.components.clear();

        console.log('✅ EconomicDashboard 파괴 완료');
    }

    /**
     * 현재 상태 조회
     */
    getState() {
        return {
            ...this.state,
            dataCache: {
                tedSpreadCount: this.dataCache.tedSpread.length,
                highYieldSpreadCount: this.dataCache.highYieldSpread.length,
                treasuryRatesCount: Object.keys(this.dataCache.treasuryRates).length
            }
        };
    }
}

// 전역 인스턴스 생성 헬퍼
if (typeof window !== 'undefined') {
    window.EconomicDashboard = EconomicDashboard;
    console.log('✅ EconomicDashboard 전역으로 노출됨: window.EconomicDashboard');
}
