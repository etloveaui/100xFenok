/**
 * UIFramework - 모던 UI 컴포넌트 프레임워크
 *
 * 핵심 기능:
 * - 컴포넌트 팩토리 시스템
 * - Chart.js/D3.js 통합
 * - 반응형 레이아웃
 * - 테마 시스템
 * - 데이터 바인딩
 *
 * @class UIFramework
 */
export default class UIFramework {
    constructor(eventSystem, dataSkeleton) {
        this.eventSystem = eventSystem;
        this.dataSkeleton = dataSkeleton;

        // 컴포넌트 레지스트리
        this.componentRegistry = new Map();
        this.mountedComponents = new Map();

        // 테마 시스템
        this.themes = new Map();
        this.currentTheme = 'light';

        // 반응형 브레이크포인트
        this.breakpoints = {
            mobile: 768,
            tablet: 1024,
            desktop: 1440,
            wide: 1920
        };

        // 애니메이션 설정
        this.animations = {
            duration: 300,
            easing: 'ease-in-out'
        };

        // 통계
        this.stats = {
            totalComponents: 0,
            byType: new Map(),
            renderCount: 0
        };

        this.registerBaseComponents();
        this.setupThemes();

        console.log('✅ UIFramework 초기화 완료');
    }

    // ========================================
    // 컴포넌트 팩토리
    // ========================================

    /**
     * 컴포넌트 생성
     *
     * @param {string} type - 컴포넌트 타입
     * @param {Object} config - 설정
     * @returns {Component} 컴포넌트 인스턴스
     *
     * @example
     * const chart = uiFramework.createComponent('Chart.Line', {
     *     data: [1, 2, 3, 4, 5],
     *     options: { responsive: true }
     * });
     */
    createComponent(type, config = {}) {
        const ComponentClass = this.componentRegistry.get(type);

        if (!ComponentClass) {
            throw new Error(`컴포넌트를 찾을 수 없습니다: ${type}`);
        }

        const component = new ComponentClass({
            ...config,
            framework: this,
            eventSystem: this.eventSystem,
            dataSkeleton: this.dataSkeleton
        });

        // 통계 업데이트
        this.stats.totalComponents++;
        if (!this.stats.byType.has(type)) {
            this.stats.byType.set(type, 0);
        }
        this.stats.byType.set(type, this.stats.byType.get(type) + 1);

        console.log(`✅ 컴포넌트 생성: ${type}`, { id: component.id });

        return component;
    }

    /**
     * 컴포넌트 등록
     */
    registerComponent(type, ComponentClass) {
        this.componentRegistry.set(type, ComponentClass);
        console.log(`✅ 컴포넌트 등록: ${type}`);
    }

    /**
     * 기본 컴포넌트 등록
     * @private
     */
    registerBaseComponents() {
        // Chart 컴포넌트
        this.registerComponent('Chart.Line', LineChart);
        this.registerComponent('Chart.Bar', BarChart);
        this.registerComponent('Chart.Pie', PieChart);
        this.registerComponent('Chart.Bubble', BubbleChart);
        this.registerComponent('Chart.Heatmap', HeatmapChart);

        // Table 컴포넌트
        this.registerComponent('Table', DataTable);
        this.registerComponent('Table.Pivot', PivotTable);

        // Filter 컴포넌트
        this.registerComponent('Filter.Range', RangeFilter);
        this.registerComponent('Filter.Select', SelectFilter);
        this.registerComponent('Filter.Search', SearchFilter);

        // Layout 컴포넌트
        this.registerComponent('Layout.Grid', GridLayout);
        this.registerComponent('Layout.Flex', FlexLayout);
        this.registerComponent('Layout.Responsive', ResponsiveLayout);

        // Card 컴포넌트
        this.registerComponent('Card', Card);
        this.registerComponent('Card.Stat', StatCard);
    }

    // ========================================
    // 컴포넌트 마운트/언마운트
    // ========================================

    /**
     * 컴포넌트 마운트
     */
    mountComponent(component, container) {
        // beforeMount 훅
        if (typeof component.beforeMount === 'function') {
            component.beforeMount();
        }

        // 렌더링
        const element = component.render();

        // 컨테이너에 추가
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }

        if (!container) {
            throw new Error('컨테이너를 찾을 수 없습니다');
        }

        container.appendChild(element);

        // mounted 상태 설정
        component._mounted = true;
        component._container = container;

        // afterMount 훅
        if (typeof component.afterMount === 'function') {
            component.afterMount();
        }

        // 마운트된 컴포넌트 추적
        this.mountedComponents.set(component.id, component);

        // 이벤트 발행
        this.eventSystem.emit('component:mounted', {
            id: component.id,
            type: component.type
        });

        console.log(`✅ 컴포넌트 마운트: ${component.type}`, { id: component.id });

        return element;
    }

    /**
     * 컴포넌트 언마운트
     */
    unmountComponent(component) {
        if (!component._mounted) {
            return;
        }

        // beforeUnmount 훅
        if (typeof component.beforeUnmount === 'function') {
            component.beforeUnmount();
        }

        // DOM 제거
        if (component._element && component._element.parentNode) {
            component._element.parentNode.removeChild(component._element);
        }

        // mounted 상태 해제
        component._mounted = false;
        component._container = null;
        component._element = null;

        // afterUnmount 훅
        if (typeof component.afterUnmount === 'function') {
            component.afterUnmount();
        }

        // 추적에서 제거
        this.mountedComponents.delete(component.id);

        // 이벤트 발행
        this.eventSystem.emit('component:unmounted', {
            id: component.id,
            type: component.type
        });

        console.log(`✅ 컴포넌트 언마운트: ${component.type}`, { id: component.id });
    }

    // ========================================
    // 반응형 레이아웃 시스템
    // ========================================

    /**
     * 반응형 레이아웃 생성
     */
    createResponsiveLayout(container, layouts = {}) {
        const layout = new ResponsiveLayout({
            layouts,
            framework: this
        });

        // element는 전달받은 container
        layout.element = container;
        layout._element = container;
        layout.layouts = layouts;

        // 반응형 감지
        this.setupResponsiveListener(layout, this.breakpoints, layouts);

        return layout;
    }

    /**
     * 반응형 리스너 설정
     * @private
     */
    setupResponsiveListener(layout, breakpoints, layouts) {
        const checkBreakpoint = () => {
            const width = window.innerWidth;

            let currentBreakpoint = 'mobile';
            if (width >= breakpoints.wide) {
                currentBreakpoint = 'wide';
            } else if (width >= breakpoints.desktop) {
                currentBreakpoint = 'desktop';
            } else if (width >= breakpoints.tablet) {
                currentBreakpoint = 'tablet';
            }

            // 레이아웃 변경
            if (layouts[currentBreakpoint]) {
                layout.applyLayout(layouts[currentBreakpoint]);
            }

            // 이벤트 발행
            this.eventSystem.emit('breakpoint:changed', {
                breakpoint: currentBreakpoint,
                width
            });
        };

        // 초기 체크
        checkBreakpoint();

        // 리사이즈 리스너
        window.addEventListener('resize', checkBreakpoint);

        // 정리 함수 저장
        layout._cleanupResponsive = () => {
            window.removeEventListener('resize', checkBreakpoint);
        };
    }

    /**
     * 현재 브레이크포인트 조회
     */
    getCurrentBreakpoint() {
        const width = window.innerWidth;

        if (width >= this.breakpoints.wide) return 'wide';
        if (width >= this.breakpoints.desktop) return 'desktop';
        if (width >= this.breakpoints.tablet) return 'tablet';
        return 'mobile';
    }

    /**
     * 브레이크포인트 설정
     */
    setBreakpoints(breakpoints) {
        this.breakpoints = breakpoints;  // 완전 교체 (병합 X)
        console.log('✅ 브레이크포인트 설정:', this.breakpoints);
    }

    // ========================================
    // 테마 시스템
    // ========================================

    /**
     * 테마 설정
     * @private
     */
    setupThemes() {
        // Default 테마 (Light와 동일)
        const defaultTheme = {
            name: 'default',
            colors: {
                primary: '#2563eb',
                secondary: '#64748b',
                success: '#10b981',
                warning: '#f59e0b',
                danger: '#ef4444',
                background: '#ffffff',
                surface: '#f8fafc',
                text: '#1e293b',
                textSecondary: '#64748b',
                border: '#e2e8f0'
            },
            fonts: {
                primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                mono: 'Monaco, Consolas, "Courier New", monospace'
            },
            spacing: {
                xs: '4px',
                sm: '8px',
                md: '16px',
                lg: '24px',
                xl: '32px'
            },
            shadows: {
                sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
            }
        };

        this.themes.set('default', defaultTheme);

        // Light 테마
        this.themes.set('light', {
            name: 'light',
            colors: {
                primary: '#2563eb',
                secondary: '#64748b',
                success: '#10b981',
                warning: '#f59e0b',
                danger: '#ef4444',
                background: '#ffffff',
                surface: '#f8fafc',
                text: '#1e293b',
                textSecondary: '#64748b',
                border: '#e2e8f0'
            },
            fonts: {
                primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                mono: 'Monaco, Consolas, "Courier New", monospace'
            },
            spacing: {
                xs: '4px',
                sm: '8px',
                md: '16px',
                lg: '24px',
                xl: '32px'
            },
            shadows: {
                sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
            }
        });

        // Dark 테마
        this.themes.set('dark', {
            name: 'dark',
            colors: {
                primary: '#3b82f6',
                secondary: '#64748b',
                success: '#10b981',
                warning: '#f59e0b',
                danger: '#ef4444',
                background: '#0f172a',
                surface: '#1e293b',
                text: '#f1f5f9',
                textSecondary: '#94a3b8',
                border: '#334155'
            },
            fonts: {
                primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                mono: 'Monaco, Consolas, "Courier New", monospace'
            },
            spacing: {
                xs: '4px',
                sm: '8px',
                md: '16px',
                lg: '24px',
                xl: '32px'
            },
            shadows: {
                sm: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
                md: '0 4px 6px -1px rgba(0, 0, 0, 0.4)',
                lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
            }
        });
    }

    /**
     * 테마 적용
     */
    applyTheme(themeName) {
        const theme = this.themes.get(themeName);

        if (!theme) {
            throw new Error(`테마를 찾을 수 없습니다: ${themeName}`);
        }

        this.currentTheme = themeName;

        // CSS 변수 설정 (document가 있을 때만)
        if (typeof document !== 'undefined' && document.documentElement) {
            const root = document.documentElement;

            // 색상
            if (theme.colors) {
                Object.entries(theme.colors).forEach(([key, value]) => {
                    root.style.setProperty(`--color-${key}`, value);
                });
            }

            // 폰트
            if (theme.fonts) {
                Object.entries(theme.fonts).forEach(([key, value]) => {
                    root.style.setProperty(`--font-${key}`, value);
                });
            }

            // 간격
            if (theme.spacing) {
                Object.entries(theme.spacing).forEach(([key, value]) => {
                    root.style.setProperty(`--spacing-${key}`, value);
                });
            }

            // 그림자
            if (theme.shadows) {
                Object.entries(theme.shadows).forEach(([key, value]) => {
                    root.style.setProperty(`--shadow-${key}`, value);
                });
            }

            // data 속성 설정
            root.setAttribute('data-theme', themeName);
        }

        // 이벤트 발행 (동기 모드로 테스트 호환성 확보)
        this.eventSystem.emit('ui:theme:changed', { theme: themeName }, { async: false });

        console.log(`✅ 테마 적용: ${themeName}`);
    }

    /**
     * 현재 테마 조회
     */
    getTheme(name = null) {
        if (name === null) {
            return this.themes.get(this.currentTheme);
        }
        return this.themes.get(name);
    }

    /**
     * 테마 등록
     */
    registerTheme(name, theme) {
        this.themes.set(name, theme);
        console.log(`✅ 테마 등록: ${name}`);
    }

    // ========================================
    // 데이터 바인딩
    // ========================================

    /**
     * 데이터 바인딩 설정
     */
    bindData(component, dataSource, options = {}) {
        const { autoUpdate = true, transform = null } = options;

        // 데이터 구독
        const unsubscribe = this.dataSkeleton.subscribe((event) => {
            if (event.type === 'data:updated') {
                let data = event.data;

                // 변환 함수 적용
                if (transform && typeof transform === 'function') {
                    data = transform(data);
                }

                // 컴포넌트 업데이트
                if (typeof component.updateData === 'function') {
                    component.updateData(data);
                }
            }
        });

        // 정리 함수 저장
        component._unbindData = unsubscribe;

        console.log(`✅ 데이터 바인딩: ${component.type}`, { id: component.id });
    }

    // ========================================
    // 애니메이션
    // ========================================

    /**
     * 애니메이션 적용
     */
    animate(element, animation, options = {}) {
        const {
            duration = this.animations.duration,
            easing = this.animations.easing,
            delay = 0
        } = options;

        return new Promise((resolve) => {
            element.style.transition = `all ${duration}ms ${easing} ${delay}ms`;

            // 애니메이션 적용
            Object.entries(animation).forEach(([property, value]) => {
                element.style[property] = value;
            });

            // 완료 대기
            setTimeout(() => {
                element.style.transition = '';
                resolve();
            }, duration + delay);
        });
    }

    /**
     * 페이드인 애니메이션
     */
    fadeIn(element, duration = this.animations.duration) {
        element.style.opacity = '0';

        return this.animate(element, { opacity: '1' }, { duration });
    }

    /**
     * 페이드아웃 애니메이션
     */
    fadeOut(element, duration = this.animations.duration) {
        return this.animate(element, { opacity: '0' }, { duration });
    }

    /**
     * 슬라이드인 애니메이션
     */
    slideIn(element, direction = 'left', duration = this.animations.duration) {
        const transforms = {
            left: 'translateX(-100%)',
            right: 'translateX(100%)',
            top: 'translateY(-100%)',
            bottom: 'translateY(100%)'
        };

        element.style.transform = transforms[direction];

        return this.animate(element, { transform: 'translate(0, 0)' }, { duration });
    }

    // ========================================
    // 유틸리티
    // ========================================

    /**
     * 통계 조회
     */
    getStats() {
        return {
            totalComponents: this.stats.totalComponents,
            componentCount: this.stats.totalComponents,  // 테스트 호환성
            byType: Object.fromEntries(this.stats.byType),
            renderCount: this.stats.renderCount,
            mountedCount: this.mountedComponents.size,
            themeCount: this.themes.size,  // 테스트 호환성
            currentTheme: this.currentTheme,
            currentBreakpoint: this.getCurrentBreakpoint()
        };
    }

    /**
     * 마운트된 컴포넌트 조회
     */
    getMountedComponents() {
        return Array.from(this.mountedComponents.values());
    }

    /**
     * 모든 컴포넌트 언마운트
     */
    unmountAll() {
        for (const component of this.mountedComponents.values()) {
            this.unmountComponent(component);
        }
        console.log('✅ 모든 컴포넌트 언마운트 완료');
    }

    /**
     * 등록된 컴포넌트 목록 조회
     */
    listComponents() {
        return Array.from(this.componentRegistry.keys());
    }

    /**
     * CSS 클래스 생성 헬퍼
     */
    createClasses(classList) {
        const classes = [];

        classList.forEach(item => {
            if (typeof item === 'string') {
                classes.push(item);
            } else if (typeof item === 'object') {
                Object.entries(item).forEach(([className, condition]) => {
                    if (condition) {
                        classes.push(className);
                    }
                });
            }
        });

        return classes.join(' ');
    }
}

// ========================================
// 베이스 컴포넌트 클래스
// ========================================

/**
 * BaseComponent - 모든 컴포넌트의 기본 클래스
 */
class BaseComponent {
    constructor(config) {
        this.id = crypto.randomUUID();
        this.type = this.constructor.name;
        this.config = config;

        this.framework = config.framework;
        this.eventSystem = config.eventSystem;
        this.dataSkeleton = config.dataSkeleton;

        this._mounted = false;
        this._element = null;
        this._container = null;
    }

    /**
     * 렌더링 (하위 클래스에서 구현)
     */
    render() {
        throw new Error('render() 메서드를 구현해야 합니다');
    }

    /**
     * DOM 요소 생성 헬퍼
     */
    createElement(tag, attrs = {}, children = []) {
        const element = document.createElement(tag);

        // 속성 설정
        Object.entries(attrs).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else if (key.startsWith('on') && typeof value === 'function') {
                const event = key.substring(2).toLowerCase();
                element.addEventListener(event, value);
            } else {
                element.setAttribute(key, value);
            }
        });

        // 자식 추가
        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof HTMLElement) {
                element.appendChild(child);
            }
        });

        return element;
    }

    /**
     * 업데이트
     */
    update() {
        if (!this._mounted) {
            return;
        }

        // 재렌더링
        const newElement = this.render();
        if (this._element && this._element.parentNode) {
            this._element.parentNode.replaceChild(newElement, this._element);
        }
        this._element = newElement;
        this.element = newElement; // 테스트 호환성
    }

    /**
     * 파괴
     */
    destroy() {
        if (this._mounted) {
            this.framework.unmountComponent(this);
        }

        // 데이터 바인딩 해제
        if (this._unbindData) {
            this._unbindData();
        }

        // 반응형 리스너 제거
        if (this._cleanupResponsive) {
            this._cleanupResponsive();
        }
    }
}

// ========================================
// Chart 컴포넌트들
// ========================================

class LineChart extends BaseComponent {
    render() {
        const canvas = this.createElement('canvas', {
            id: `chart-${this.id}`,
            width: 400,
            height: 400
        });

        // Chart.js 통합 - 항상 초기화 시도
        this._initChart(canvas);

        this._element = canvas;
        return canvas;
    }

    _initChart(canvas) {
        const { data, options = {} } = this.config;

        // Chart.js가 사용 가능한 경우에만 생성
        if (typeof Chart !== 'undefined') {
            this.chartInstance = new Chart(canvas, {
                type: 'line',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    ...options
                }
            });
        }
    }

    updateData(data) {
        if (this.chartInstance) {
            this.chartInstance.data = data;
            this.chartInstance.update();
        }
    }

    destroy() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }
        super.destroy();
    }
}

class BarChart extends BaseComponent {
    render() {
        const canvas = this.createElement('canvas', {
            id: `chart-${this.id}`,
            width: 400,
            height: 400
        });

        // Chart.js 통합 - 항상 초기화 시도
        this._initChart(canvas);

        this._element = canvas;
        return canvas;
    }

    _initChart(canvas) {
        const { data, options = {} } = this.config;

        // Chart.js가 사용 가능한 경우에만 생성
        if (typeof Chart !== 'undefined') {
            this.chartInstance = new Chart(canvas, {
                type: 'bar',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    ...options
                }
            });
        }
    }

    updateData(data) {
        if (this.chartInstance) {
            this.chartInstance.data = data;
            this.chartInstance.update();
        }
    }

    destroy() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }
        super.destroy();
    }
}

class PieChart extends BaseComponent {
    render() {
        const canvas = this.createElement('canvas', {
            id: `chart-${this.id}`,
            width: 400,
            height: 400
        });

        // Chart.js 통합 - 항상 초기화 시도
        this._initChart(canvas);

        this._element = canvas;
        return canvas;
    }

    _initChart(canvas) {
        const { data, options = {} } = this.config;

        // Chart.js가 사용 가능한 경우에만 생성
        if (typeof Chart !== 'undefined') {
            this.chartInstance = new Chart(canvas, {
                type: 'pie',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    ...options
                }
            });
        }
    }

    updateData(data) {
        if (this.chartInstance) {
            this.chartInstance.data = data;
            this.chartInstance.update();
        }
    }

    destroy() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }
        super.destroy();
    }
}

class BubbleChart extends BaseComponent {
    render() {
        const container = this.createElement('div', {
            className: 'chart-container bubble-chart',
            style: { width: '100%', height: '600px' }
        });

        this._element = container;
        return container;
    }
}

class HeatmapChart extends BaseComponent {
    render() {
        const container = this.createElement('div', {
            className: 'chart-container heatmap-chart',
            style: { width: '100%', height: '500px' }
        });

        this._element = container;
        return container;
    }
}

// ========================================
// Table 컴포넌트들
// ========================================

class DataTable extends BaseComponent {
    constructor(config) {
        super(config);
        this.sortColumn = null;
        this.sortOrder = 'asc';
        this.currentPage = 1;
        this.filteredData = null;
        this.currentFilter = null;

        // dataSource 처리
        if (config.dataSource === 'dataSkeleton' && this.dataSkeleton) {
            this.config.data = this.dataSkeleton.query();
        }

        // 필터 이벤트 구독 (constructor에서 직접 설정)
        if (this.eventSystem) {
            this.eventSystem.on('ui:filter:changed', (event) => {
                this.handleFilterChange(event.payload);
            });
        }
    }

    handleFilterChange(filterData) {
        const { field, value } = filterData;

        // dataSkeleton이 있으면 쿼리로 필터링
        if (this.dataSkeleton) {
            if (value !== null && value !== undefined && value !== '') {
                // DataSkeleton.query()는 { filter: {...} } 형태를 기대
                const filterObj = {};
                filterObj[field] = value;
                this.filteredData = this.dataSkeleton.query({ filter: filterObj });
                this.currentFilter = { field, value };
            } else {
                this.filteredData = null;
                this.currentFilter = null;
            }
        } else {
            // dataSkeleton이 없으면 메모리에서 필터링
            if (value !== null && value !== undefined && value !== '') {
                this.filteredData = (this.config.data || []).filter(row => row[field] === value);
                this.currentFilter = { field, value };
            } else {
                this.filteredData = null;
                this.currentFilter = null;
            }
        }
    }

    render(container) {
        const { columns = [], data = [] } = this.config;

        const table = this.createElement('table', {
            className: 'data-table'
        });

        // 헤더
        const thead = this.createElement('thead');
        const headerRow = this.createElement('tr');

        columns.forEach(col => {
            const colName = typeof col === 'string' ? col : col.label || col.field || col;
            const th = this.createElement('th', {}, [colName]);
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // 바디
        const tbody = this.createElement('tbody');
        const tableData = this.getDisplayData();

        tableData.forEach(row => {
            const tr = this.createElement('tr');

            columns.forEach(col => {
                const field = typeof col === 'string' ? col : col.field || col;
                const td = this.createElement('td', {}, [String(row[field] || '')]);
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);

        this._element = table;
        this.element = table;
        return table;
    }

    getDisplayData() {
        return this.filteredData || this.config.data || [];
    }

    sort(column, order = 'asc') {
        this.sortColumn = column;
        this.sortOrder = order;
        const data = [...(this.config.data || [])];

        data.sort((a, b) => {
            const aVal = a[column];
            const bVal = b[column];

            if (aVal < bVal) return order === 'asc' ? -1 : 1;
            if (aVal > bVal) return order === 'asc' ? 1 : -1;
            return 0;
        });

        this.filteredData = data;
    }

    getSortedData() {
        if (!this.sortColumn) return this.config.data || [];

        const data = [...(this.config.data || [])];
        data.sort((a, b) => {
            const aVal = a[this.sortColumn];
            const bVal = b[this.sortColumn];

            if (aVal < bVal) return this.sortOrder === 'asc' ? -1 : 1;
            if (aVal > bVal) return this.sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return data;
    }

    getCurrentPageData() {
        const { pageSize = 10 } = this.config;
        const data = this.getFilteredData();
        const start = (this.currentPage - 1) * pageSize;
        return data.slice(start, start + pageSize);
    }

    getFilteredData() {
        return this.filteredData || this.config.data || [];
    }
}

class PivotTable extends BaseComponent {
    render() {
        const container = this.createElement('div', {
            className: 'pivot-table-container'
        });

        this._element = container;
        return container;
    }
}

// ========================================
// Filter 컴포넌트들
// ========================================

class RangeFilter extends BaseComponent {
    render() {
        const container = this.createElement('div', {
            className: 'filter-range'
        });

        const { field, min = 0, max = 100, label } = this.config;

        if (label) {
            const labelEl = this.createElement('label', {}, [label]);
            container.appendChild(labelEl);
        }

        this.input = this.createElement('input', {
            type: 'range',
            min: String(min),
            max: String(max),
            onInput: (e) => {
                this.eventSystem.emit('filter:changed', {
                    field,
                    value: Number(e.target.value)
                });
            }
        });

        container.appendChild(this.input);

        this._element = container;
        return container;
    }

    setValue(value) {
        if (this.input) {
            this.input.value = value;
            this.eventSystem.emit('ui:filter:changed', {
                field: this.config.field,
                value: Number(value)
            }, { async: false });  // 동기 모드
        }
    }
}

class SelectFilter extends BaseComponent {
    render() {
        const { field, options = [] } = this.config;

        const select = this.createElement('select', {
            onChange: (e) => {
                this.eventSystem.emit('filter:changed', {
                    field,
                    value: e.target.value
                });
            }
        });

        options.forEach(opt => {
            const optValue = typeof opt === 'string' ? opt : opt.value || opt;
            const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value || opt;
            const option = this.createElement('option', {
                value: optValue
            }, [optLabel]);
            select.appendChild(option);
        });

        this._element = select;
        return select;
    }

    setValue(value) {
        if (this._element) {
            this._element.value = value;
            this.eventSystem.emit('ui:filter:changed', {
                field: this.config.field,
                value
            }, { async: false });  // 동기 모드
        }
    }
}

class SearchFilter extends BaseComponent {
    render() {
        const { field, placeholder = 'Search...' } = this.config;

        const input = this.createElement('input', {
            type: 'search',
            placeholder,
            onInput: (e) => {
                this.eventSystem.emit('filter:changed', {
                    field,
                    value: e.target.value
                });
            }
        });

        this._element = input;
        return input;
    }

    setValue(value) {
        if (this._element) {
            this._element.value = value;
            this.eventSystem.emit('ui:filter:changed', {
                field: this.config.field,
                value
            }, { async: false });  // 동기 모드
        }
    }
}

// ========================================
// Layout 컴포넌트들
// ========================================

class GridLayout extends BaseComponent {
    render() {
        const { columns = 12, gap = '16px' } = this.config;

        const grid = this.createElement('div', {
            className: 'layout-grid',
            style: {
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap
            }
        });

        this._element = grid;
        return grid;
    }
}

class FlexLayout extends BaseComponent {
    render() {
        const { direction = 'row', gap = '16px', align = 'stretch', justify = 'flex-start' } = this.config;

        const flex = this.createElement('div', {
            className: 'layout-flex',
            style: {
                display: 'flex',
                flexDirection: direction,
                gap,
                alignItems: align,
                justifyContent: justify
            }
        });

        this._element = flex;
        return flex;
    }
}

class ResponsiveLayout extends BaseComponent {
    render(container) {
        const layoutContainer = this.createElement('div', {
            className: 'layout-responsive'
        });

        this._element = layoutContainer;
        this.element = layoutContainer;
        this.layouts = this.config.layouts || {};
        return layoutContainer;
    }

    applyLayout(layout) {
        if (this._element) {
            Object.assign(this._element.style, layout);
        }
    }
}

// ========================================
// Card 컴포넌트들
// ========================================

class Card extends BaseComponent {
    render() {
        const { title, content } = this.config;

        const card = this.createElement('div', {
            className: 'card'
        });

        if (title) {
            const titleEl = this.createElement('div', {
                className: 'card-title'
            }, [title]);
            card.appendChild(titleEl);
        }

        const body = this.createElement('div', {
            className: 'card-body'
        }, typeof content === 'string' ? [content] : []);

        card.appendChild(body);

        this._element = card;
        return card;
    }
}

class StatCard extends BaseComponent {
    render() {
        const { label, value, change, trend, icon } = this.config;

        const card = this.createElement('div', {
            className: 'stat-card'
        });

        const labelEl = this.createElement('div', {
            className: 'stat-label'
        }, [label]);

        const valueEl = this.createElement('div', {
            className: 'stat-value'
        }, [String(value)]);

        card.appendChild(labelEl);
        card.appendChild(valueEl);

        // Support both 'change' and 'trend' props
        const changeValue = change || trend;
        if (changeValue) {
            const trendEl = this.createElement('div', {
                className: 'stat-change'
            }, [String(changeValue)]);
            card.appendChild(trendEl);
        }

        this._element = card;
        return card;
    }
}

// 전역 인스턴스로 노출
if (typeof window !== 'undefined' && window.eventSystem && window.dataSkeleton) {
    window.uiFramework = new UIFramework(window.eventSystem, window.dataSkeleton);
    console.log('✅ UIFramework 전역 인스턴스 생성됨: window.uiFramework');
}
