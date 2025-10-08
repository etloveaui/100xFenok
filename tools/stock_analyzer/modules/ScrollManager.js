/**
 * ScrollManager - 가로 스크롤 UX 개선 시스템
 */

class ScrollManager {
    constructor() {
        this.topScrollbar = null;
        this.mainTable = null;
        this.scrollIndicator = null;
        this.columnGroups = {
            basic: { 
                name: '기본정보', 
                description: '티커, 회사명, 거래소, 업종 등 기업 식별 정보',
                columns: ['Ticker', 'corpName', 'Exchange', 'industry'],
                essential: true
            },
            price: { 
                name: '가격정보', 
                description: '현재가, 전일대비, 시가총액 등 주가 관련 정보',
                columns: ['현재가', '전일대비', '전주대비', '(USD mn)'],
                essential: true
            },
            valuation: { 
                name: '밸류에이션', 
                description: 'PER, PBR, PEG 등 기업 가치 평가 지표',
                columns: ['PER (Oct-25)', 'PBR (Oct-25)', 'PEG (Oct-25)', '% PER (Avg)'],
                essential: false
            },
            profitability: { 
                name: '수익성', 
                description: 'ROE, 영업이익률, 매출성장률 등 수익성 지표',
                columns: ['ROE (Fwd)', 'OPM (Fwd)', 'Sales (3)'],
                essential: false
            },
            performance: { 
                name: '수익률', 
                description: '기간별 주가 수익률 (1개월, 3개월, 6개월, 1년 등)',
                columns: ['Return (Y)', '1 M', '3 M', '6 M', 'YTD', '12 M'],
                essential: false
            },
            others: { 
                name: '기타지표', 
                description: '배당수익률, 현금전환주기 등 추가 분석 지표',
                columns: ['DY (FY+1)', 'Price (10)', 'CCC (FY 0)'],
                essential: false
            }
        };
        this.visibleGroups = new Set(Object.keys(this.columnGroups));
        
        console.log('📜 ScrollManager 초기화');
    }

    /**
     * 스크롤 시스템 초기화
     */
    initialize() {
        this.createTopScrollbar();
        this.createScrollIndicator();
        this.createColumnGroupControls();
        this.setupScrollSync();
        
        console.log('✅ 가로 스크롤 UX 개선 시스템 초기화 완료');
    }

    /**
     * 상단 스크롤바 생성
     */
    createTopScrollbar() {
        const tableContainer = document.getElementById('results-table');
        if (!tableContainer) {
            console.warn('테이블 컨테이너를 찾을 수 없습니다');
            return;
        }

        // 기존 상단 스크롤바 제거
        const existingScrollbar = document.querySelector('.top-scrollbar');
        if (existingScrollbar) {
            existingScrollbar.remove();
        }

        // 상단 스크롤바 생성
        const topScrollbar = document.createElement('div');
        topScrollbar.className = 'top-scrollbar';
        topScrollbar.innerHTML = '<div class="top-scrollbar-content"></div>';

        // 테이블 컨테이너 앞에 삽입
        tableContainer.parentNode.insertBefore(topScrollbar, tableContainer);
        
        this.topScrollbar = topScrollbar;
        this.mainTable = tableContainer;

        console.log('📜 상단 스크롤바 생성 완료');
    }

    /**
     * 컬럼 그룹 컨트롤 생성
     */
    createColumnGroupControls() {
        const tableContainer = document.getElementById('results-table');
        if (!tableContainer) return;

        // 기존 컨트롤 제거
        const existingControls = document.querySelector('.column-groups');
        if (existingControls) {
            existingControls.remove();
        }

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'column-groups';

        // 전체 표시/숨김 버튼
        const toggleAllBtn = document.createElement('button');
        toggleAllBtn.className = 'column-group-btn active';
        toggleAllBtn.textContent = '전체 표시';
        toggleAllBtn.title = '모든 컬럼 그룹을 한번에 표시/숨김';
        toggleAllBtn.addEventListener('click', () => this.toggleAllColumns());
        controlsContainer.appendChild(toggleAllBtn);

        // 각 그룹별 버튼
        Object.entries(this.columnGroups).forEach(([groupKey, group]) => {
            const btn = document.createElement('button');
            btn.className = `column-group-btn active ${group.essential ? 'essential' : ''}`;
            btn.textContent = `${group.name} (${group.columns.length})`;
            btn.dataset.group = groupKey;
            btn.title = group.description;
            btn.addEventListener('click', () => this.toggleColumnGroup(groupKey));
            
            if (group.essential) {
                const essentialIcon = document.createElement('span');
                essentialIcon.textContent = ' ⭐';
                essentialIcon.title = '필수 컬럼 그룹';
                btn.appendChild(essentialIcon);
            }
            
            controlsContainer.appendChild(btn);
        });

        // 테이블 앞에 삽입
        tableContainer.parentNode.insertBefore(controlsContainer, tableContainer);

        console.log('🎛️ 컬럼 그룹 컨트롤 생성 완료');
    }

    /**
     * 스크롤 동기화 설정
     */
    setupScrollSync() {
        if (!this.topScrollbar || !this.mainTable) return;

        this.topScrollbar.addEventListener('scroll', () => {
            this.mainTable.scrollLeft = this.topScrollbar.scrollLeft;
        });

        this.mainTable.addEventListener('scroll', () => {
            this.topScrollbar.scrollLeft = this.mainTable.scrollLeft;
        });

        console.log('🔄 스크롤 동기화 설정 완료');
    }

    /**
     * 컬럼 그룹 토글
     */
    toggleColumnGroup(groupKey) {
        const btn = document.querySelector(`[data-group="${groupKey}"]`);
        if (!btn) return;

        const group = this.columnGroups[groupKey];
        if (!group) return;

        if (this.visibleGroups.has(groupKey)) {
            this.visibleGroups.delete(groupKey);
            btn.classList.remove('active');
            console.log(`🎛️ 컬럼 그룹 숨김: ${group.name}`);
        } else {
            this.visibleGroups.add(groupKey);
            btn.classList.add('active');
            console.log(`🎛️ 컬럼 그룹 표시: ${group.name}`);
        }

        this.applyColumnVisibility();
    }

    /**
     * 전체 컬럼 토글
     */
    toggleAllColumns() {
        const toggleBtn = document.querySelector('.column-groups .column-group-btn');
        if (!toggleBtn) return;

        const isAllVisible = this.visibleGroups.size === Object.keys(this.columnGroups).length;

        if (isAllVisible) {
            this.visibleGroups.clear();
            toggleBtn.textContent = '전체 표시';
            toggleBtn.classList.remove('active');
            
            document.querySelectorAll('[data-group]').forEach(btn => {
                btn.classList.remove('active');
            });
        } else {
            this.visibleGroups = new Set(Object.keys(this.columnGroups));
            toggleBtn.textContent = '전체 숨김';
            toggleBtn.classList.add('active');
            
            document.querySelectorAll('[data-group]').forEach(btn => {
                btn.classList.add('active');
            });
        }

        this.applyColumnVisibility();
    }

    /**
     * 컬럼 가시성 적용
     */
    applyColumnVisibility() {
        const table = this.mainTable?.querySelector('table');
        if (!table) return;

        const hiddenColumns = new Set();
        Object.entries(this.columnGroups).forEach(([groupKey, group]) => {
            if (!this.visibleGroups.has(groupKey)) {
                group.columns.forEach(col => hiddenColumns.add(col));
            }
        });

        // 헤더 처리
        const headerCells = table.querySelectorAll('thead th');
        headerCells.forEach((th) => {
            const columnKey = th.dataset.column || th.textContent.trim();
            if (hiddenColumns.has(columnKey)) {
                th.style.display = 'none';
            } else {
                th.style.display = '';
            }
        });

        // 데이터 행 처리
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            cells.forEach((td, index) => {
                const header = headerCells[index];
                if (header && header.style.display === 'none') {
                    td.style.display = 'none';
                } else {
                    td.style.display = '';
                }
            });
        });

        console.log(`🎛️ 컬럼 가시성 적용: ${hiddenColumns.size}개 컬럼 숨김`);
    }

    /**
     * 스크롤 위치 표시기 생성
     */
    createScrollIndicator() {
        if (!this.mainTable) return;

        const indicator = document.createElement('div');
        indicator.className = 'scroll-indicator';
        indicator.textContent = '← 좌우 스크롤 →';
        
        this.mainTable.parentNode.style.position = 'relative';
        this.mainTable.parentNode.appendChild(indicator);
        
        this.scrollIndicator = indicator;

        console.log('📍 스크롤 위치 표시기 생성 완료');
    }

    /**
     * 테이블 렌더링 후 호출
     */
    onTableRendered() {
        setTimeout(() => {
            this.updateScrollbarWidth();
        }, 100);
    }

    /**
     * 스크롤바 너비 업데이트
     */
    updateScrollbarWidth() {
        if (!this.topScrollbar || !this.mainTable) return;

        const table = this.mainTable.querySelector('table');
        if (table) {
            const scrollContent = this.topScrollbar.querySelector('.top-scrollbar-content');
            if (scrollContent) {
                scrollContent.style.width = `${table.scrollWidth}px`;
            }
        }
    }
}

// 전역 인스턴스 생성
window.scrollManager = new ScrollManager();

console.log('✅ ScrollManager 로드 완료 - 가로 스크롤 UX 개선 시스템');