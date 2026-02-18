/**
 * MomentumHeatmap - 모멘텀 히트맵 모듈
 *
 * Global Scouter의 Up & Down + Momentum 모듈을 웹 네이티브로 변환
 *
 * 기능:
 * - D3.js 트리맵 시각화
 * - 업종/국가/규모별 뷰 전환
 * - 기간별 필터링 (1주/1개월/3개월/6개월/1년)
 * - 드릴다운 인터랙션
 * - 모멘텀 색상 코딩 (상승률 기반)
 * - 실시간 데이터 업데이트
 *
 * @class MomentumHeatmap
 */

import TreemapRenderer from './components/TreemapRenderer.js';
import ViewSwitcher from './components/ViewSwitcher.js';
import TimeFilter from './components/TimeFilter.js';
import DrilldownPanel from './components/DrilldownPanel.js';
import TooltipManager from './components/TooltipManager.js';

export default class MomentumHeatmap {
    constructor(config = {}) {
        const {
            eventSystem,
            dataSkeleton,
            uiFramework,
            theme = 'dark',
            defaultView = 'sector',      // 'sector' | 'country' | 'size'
            defaultPeriod = '1M',         // '1W' | '1M' | '3M' | '6M' | '1Y'
            width = 1200,
            height = 600
        } = config;

        this.eventSystem = eventSystem;
        this.dataSkeleton = dataSkeleton;
        this.uiFramework = uiFramework;
        this.theme = theme;

        // 설정
        this.currentView = defaultView;
        this.currentPeriod = defaultPeriod;
        this.width = width;
        this.height = height;

        // 컴포넌트
        this.components = new Map();

        // 상태
        this.state = {
            isInitialized: false,
            lastUpdate: null,
            selectedItem: null,
            drilldownPath: [] // 드릴다운 경로 추적
        };

        // 데이터 캐시
        this.dataCache = {
            stocks: [],           // 전체 주식 데이터
            hierarchyData: null,  // 트리맵용 계층 데이터
            filteredData: null    // 필터링된 데이터
        };

        console.log('✅ MomentumHeatmap 생성됨');
    }

    /**
     * 초기화
     */
    async init() {
        // 컴포넌트 등록
        this.registerComponents();

        // 데이터 구독
        this.subscribeToData();

        // 이벤트 리스너 설정
        this.setupEventListeners();

        // 초기 데이터 로드
        await this.loadInitialData();

        this.state.isInitialized = true;
        console.log('✅ MomentumHeatmap 초기화 완료');

        return this;
    }

    /**
     * 컴포넌트 등록
     */
    registerComponents() {
        this.components.set('treemap', new TreemapRenderer({
            eventSystem: this.eventSystem,
            theme: this.theme,
            width: this.width,
            height: this.height
        }));

        this.components.set('viewSwitcher', new ViewSwitcher({
            eventSystem: this.eventSystem,
            theme: this.theme,
            currentView: this.currentView
        }));

        this.components.set('timeFilter', new TimeFilter({
            eventSystem: this.eventSystem,
            theme: this.theme,
            currentPeriod: this.currentPeriod
        }));

        this.components.set('drilldown', new DrilldownPanel({
            eventSystem: this.eventSystem,
            theme: this.theme
        }));

        this.components.set('tooltip', new TooltipManager({
            eventSystem: this.eventSystem,
            theme: this.theme
        }));

        console.log('✅ MomentumHeatmap 컴포넌트 등록 완료');
    }

    /**
     * 데이터 구독
     */
    subscribeToData() {
        if (this.dataSkeleton) {
            this.dataSkeleton.subscribe((data) => {
                this.handleDataUpdate(data);
            }, {
                events: ['data:updated']
            });
        }
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        if (!this.eventSystem) return;

        // 뷰 변경 이벤트
        this.eventSystem.on('momentum:view:changed', (event) => {
            this.handleViewChange(event.payload);
        });

        // 기간 변경 이벤트
        this.eventSystem.on('momentum:period:changed', (event) => {
            this.handlePeriodChange(event.payload);
        });

        // 드릴다운 이벤트
        this.eventSystem.on('momentum:drilldown', (event) => {
            this.handleDrilldown(event.payload);
        });

        // 드릴업 (뒤로가기) 이벤트
        this.eventSystem.on('momentum:drillup', (event) => {
            this.handleDrillup();
        });

        // 항목 선택 이벤트
        this.eventSystem.on('momentum:item:selected', (event) => {
            this.handleItemSelected(event.payload);
        });

        // 테마 변경 이벤트
        this.eventSystem.on('ui:theme:changed', (event) => {
            this.setTheme(event.payload.theme);
        });
    }

    /**
     * 초기 데이터 로드
     */
    async loadInitialData() {
        // DataSkeleton에서 데이터 가져오기
        if (this.dataSkeleton) {
            const data = this.dataSkeleton.query();
            if (data && data.length > 0) {
                this.dataCache.stocks = data;
                this.updateHierarchyData();
            } else {
                // 샘플 데이터 생성
                this.dataCache.stocks = this.generateSampleData();
                this.updateHierarchyData();
            }
        } else {
            // DataSkeleton이 없으면 샘플 데이터 사용
            this.dataCache.stocks = this.generateSampleData();
            this.updateHierarchyData();
        }

        this.state.lastUpdate = new Date();
    }

    /**
     * 계층 데이터 업데이트
     */
    updateHierarchyData() {
        const data = this.dataCache.stocks;
        const view = this.currentView;
        const period = this.currentPeriod;

        // 기간별 모멘텀 필드 매핑
        const momentumField = this.getMomentumField(period);

        // 뷰에 따른 그룹화
        let hierarchyData;

        if (view === 'sector') {
            hierarchyData = this.groupBySector(data, momentumField);
        } else if (view === 'country') {
            hierarchyData = this.groupByCountry(data, momentumField);
        } else if (view === 'size') {
            hierarchyData = this.groupBySize(data, momentumField);
        }

        this.dataCache.hierarchyData = hierarchyData;

        // 트리맵 업데이트
        const treemap = this.components.get('treemap');
        if (treemap) {
            treemap.updateData(hierarchyData);
        }
    }

    /**
     * 업종별 그룹화
     */
    groupBySector(data, momentumField) {
        const sectors = {};

        data.forEach(stock => {
            const sector = stock.sector || 'Unknown';
            const momentum = stock[momentumField] || 0;
            const marketCap = stock.market_cap || 0;

            if (!sectors[sector]) {
                sectors[sector] = {
                    name: sector,
                    children: [],
                    value: 0,
                    momentum: 0,
                    count: 0
                };
            }

            sectors[sector].children.push({
                name: stock.name || stock.ticker,
                ticker: stock.ticker,
                value: marketCap,
                momentum: momentum,
                sector: sector,
                price: stock.price,
                volume: stock.volume
            });

            sectors[sector].value += marketCap;
            sectors[sector].momentum += momentum * marketCap; // 가중 평균
            sectors[sector].count += 1;
        });

        // 가중 평균 계산
        Object.values(sectors).forEach(sector => {
            if (sector.value > 0) {
                sector.momentum = sector.momentum / sector.value;
            }
        });

        return {
            name: 'root',
            children: Object.values(sectors)
        };
    }

    /**
     * 국가별 그룹화
     */
    groupByCountry(data, momentumField) {
        const countries = {};

        data.forEach(stock => {
            const country = stock.country || 'Unknown';
            const momentum = stock[momentumField] || 0;
            const marketCap = stock.market_cap || 0;

            if (!countries[country]) {
                countries[country] = {
                    name: country,
                    children: [],
                    value: 0,
                    momentum: 0,
                    count: 0
                };
            }

            countries[country].children.push({
                name: stock.name || stock.ticker,
                ticker: stock.ticker,
                value: marketCap,
                momentum: momentum,
                country: country,
                price: stock.price,
                volume: stock.volume
            });

            countries[country].value += marketCap;
            countries[country].momentum += momentum * marketCap;
            countries[country].count += 1;
        });

        Object.values(countries).forEach(country => {
            if (country.value > 0) {
                country.momentum = country.momentum / country.value;
            }
        });

        return {
            name: 'root',
            children: Object.values(countries)
        };
    }

    /**
     * 규모별 그룹화
     */
    groupBySize(data, momentumField) {
        const sizes = {
            'Large Cap': { name: 'Large Cap (>$10B)', children: [], value: 0, momentum: 0, count: 0 },
            'Mid Cap': { name: 'Mid Cap ($2B-$10B)', children: [], value: 0, momentum: 0, count: 0 },
            'Small Cap': { name: 'Small Cap (<$2B)', children: [], value: 0, momentum: 0, count: 0 }
        };

        data.forEach(stock => {
            const momentum = stock[momentumField] || 0;
            const marketCap = stock.market_cap || 0;

            let sizeCategory;
            if (marketCap >= 10_000_000_000) {
                sizeCategory = 'Large Cap';
            } else if (marketCap >= 2_000_000_000) {
                sizeCategory = 'Mid Cap';
            } else {
                sizeCategory = 'Small Cap';
            }

            sizes[sizeCategory].children.push({
                name: stock.name || stock.ticker,
                ticker: stock.ticker,
                value: marketCap,
                momentum: momentum,
                size: sizeCategory,
                price: stock.price,
                volume: stock.volume
            });

            sizes[sizeCategory].value += marketCap;
            sizes[sizeCategory].momentum += momentum * marketCap;
            sizes[sizeCategory].count += 1;
        });

        Object.values(sizes).forEach(size => {
            if (size.value > 0) {
                size.momentum = size.momentum / size.value;
            }
        });

        return {
            name: 'root',
            children: Object.values(sizes)
        };
    }

    /**
     * 모멘텀 필드 매핑
     */
    getMomentumField(period) {
        const mapping = {
            '1W': 'momentum_1w',
            '1M': 'momentum_1m',
            '3M': 'momentum_3m',
            '6M': 'momentum_6m',
            '1Y': 'momentum_1y'
        };
        return mapping[period] || 'momentum_1m';
    }

    /**
     * 뷰 변경 처리
     */
    handleViewChange(payload) {
        this.currentView = payload.view;
        this.state.drilldownPath = []; // 드릴다운 경로 초기화
        this.updateHierarchyData();
        console.log(`✅ 뷰 변경: ${this.currentView}`);
    }

    /**
     * 기간 변경 처리
     */
    handlePeriodChange(payload) {
        this.currentPeriod = payload.period;
        this.updateHierarchyData();
        console.log(`✅ 기간 변경: ${this.currentPeriod}`);
    }

    /**
     * 드릴다운 처리
     */
    handleDrilldown(payload) {
        const { item } = payload;

        // 드릴다운 경로에 추가
        this.state.drilldownPath.push({
            name: item.name,
            view: this.currentView
        });

        // 드릴다운 패널에 상세 정보 표시
        const drilldownPanel = this.components.get('drilldown');
        if (drilldownPanel) {
            drilldownPanel.show(item);
        }

        console.log(`✅ 드릴다운: ${item.name}`);
    }

    /**
     * 드릴업 처리
     */
    handleDrillup() {
        if (this.state.drilldownPath.length > 0) {
            this.state.drilldownPath.pop();

            // 드릴다운 패널 숨기기
            const drilldownPanel = this.components.get('drilldown');
            if (drilldownPanel && this.state.drilldownPath.length === 0) {
                drilldownPanel.hide();
            }

            console.log(`✅ 드릴업`);
        }
    }

    /**
     * 항목 선택 처리
     */
    handleItemSelected(payload) {
        this.state.selectedItem = payload.item;

        // 툴팁 표시
        const tooltip = this.components.get('tooltip');
        if (tooltip) {
            tooltip.show(payload.item, payload.x, payload.y);
        }
    }

    /**
     * 데이터 업데이트 처리
     */
    handleDataUpdate(data) {
        if (!data || data.length === 0) return;

        this.dataCache.stocks = data;
        this.updateHierarchyData();
        this.state.lastUpdate = new Date();

        console.log(`✅ MomentumHeatmap 데이터 업데이트 (${data.length}개 종목)`);
    }

    /**
     * 렌더링
     */
    render() {
        const container = document.createElement('div');
        container.className = 'momentum-heatmap';

        // 헤더
        const header = document.createElement('div');
        header.className = 'heatmap-header';
        header.innerHTML = `
            <h2 class="heatmap-title">📊 Momentum Heatmap</h2>
            <p class="heatmap-subtitle">실시간 모멘텀 분석 - Up & Down 트리맵</p>
        `;
        container.appendChild(header);

        // 컨트롤 영역
        const controls = document.createElement('div');
        controls.className = 'heatmap-controls';

        // ViewSwitcher
        const viewSwitcher = this.components.get('viewSwitcher');
        if (viewSwitcher) {
            controls.appendChild(viewSwitcher.render());
        }

        // TimeFilter
        const timeFilter = this.components.get('timeFilter');
        if (timeFilter) {
            controls.appendChild(timeFilter.render());
        }

        container.appendChild(controls);

        // 트리맵 컨테이너
        const treemapContainer = document.createElement('div');
        treemapContainer.className = 'treemap-container';

        const treemap = this.components.get('treemap');
        if (treemap) {
            treemapContainer.appendChild(treemap.render());
        }

        container.appendChild(treemapContainer);

        // 드릴다운 패널
        const drilldown = this.components.get('drilldown');
        if (drilldown) {
            container.appendChild(drilldown.render());
        }

        // 툴팁
        const tooltip = this.components.get('tooltip');
        if (tooltip) {
            container.appendChild(tooltip.render());
        }

        return container;
    }

    /**
     * 테마 변경
     */
    setTheme(newTheme) {
        this.theme = newTheme;

        // 모든 컴포넌트에 테마 전파
        this.components.forEach(component => {
            if (component.setTheme) {
                component.setTheme(newTheme);
            }
        });

        console.log(`✅ MomentumHeatmap 테마 변경: ${newTheme}`);
    }

    /**
     * 샘플 데이터 생성
     */
    generateSampleData() {
        const sectors = ['Technology', 'Financial', 'Healthcare', 'Energy', 'Consumer', 'Industrial'];
        const countries = ['USA', 'China', 'Japan', 'Germany', 'UK'];
        const companies = [
            'Apple', 'Microsoft', 'Google', 'Amazon', 'Meta',
            'Tesla', 'Nvidia', 'AMD', 'Intel', 'Cisco',
            'JPMorgan', 'Bank of America', 'Goldman Sachs', 'Morgan Stanley', 'Citigroup',
            'Johnson & Johnson', 'Pfizer', 'Merck', 'AbbVie', 'Bristol Myers',
            'ExxonMobil', 'Chevron', 'Shell', 'BP', 'TotalEnergies',
            'Walmart', 'Coca-Cola', 'PepsiCo', 'Nike', 'McDonald\'s',
            'Boeing', 'Lockheed Martin', 'General Electric', 'Caterpillar', '3M'
        ];

        const data = [];

        companies.forEach((company, index) => {
            const sector = sectors[Math.floor(index / 6)];
            const country = countries[Math.floor(Math.random() * countries.length)];
            const marketCap = Math.random() * 2000000000000 + 10000000000; // $10B - $2T

            data.push({
                ticker: company.substring(0, 4).toUpperCase(),
                name: company,
                sector: sector,
                country: country,
                price: Math.random() * 500 + 10,
                volume: Math.floor(Math.random() * 100000000) + 1000000,
                market_cap: marketCap,
                momentum_1w: (Math.random() - 0.5) * 20,  // -10% ~ +10%
                momentum_1m: (Math.random() - 0.5) * 40,  // -20% ~ +20%
                momentum_3m: (Math.random() - 0.5) * 60,  // -30% ~ +30%
                momentum_6m: (Math.random() - 0.5) * 80,  // -40% ~ +40%
                momentum_1y: (Math.random() - 0.5) * 100  // -50% ~ +50%
            });
        });

        return data;
    }

    /**
     * 컴포넌트 파괴
     */
    destroy() {
        this.components.forEach(component => {
            if (component.destroy) {
                component.destroy();
            }
        });
        this.components.clear();
        console.log('✅ MomentumHeatmap 파괴됨');
    }
}
