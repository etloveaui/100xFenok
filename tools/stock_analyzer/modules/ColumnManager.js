/**
 * ColumnManager - 32개 지표 컬럼 표시 및 관리 시스템
 */

class ColumnManager {
    constructor() {
        this.viewModes = {
            basic: 'basic',
            key_metrics: 'key_metrics', 
            valuation: 'valuation',
            performance: 'performance',
            all_32_indicators: 'all_32_indicators'
        };
        this.currentViewMode = 'basic';
        this.columnVisibility = new Map();
        
        console.log('📊 ColumnManager 초기화 - 32개 지표 지원');
    }

    /**
     * 뷰 모드 선택 UI 추가
     */
    addViewModeSelector() {
        const controlsContainer = document.querySelector('.controls-container') || 
                                document.querySelector('#filter-controls') ||
                                document.querySelector('.mb-4');
        
        if (!controlsContainer) {
            console.warn('컨트롤 컨테이너를 찾을 수 없습니다');
            return;
        }

        const viewModeHTML = `
            <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">표시 모드</label>
                <select id="view-mode-selector" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                    <option value="basic">기본 정보 (6개 컬럼)</option>
                    <option value="key_metrics">핵심 지표 (11개 컬럼)</option>
                    <option value="valuation">밸류에이션 (10개 컬럼)</option>
                    <option value="performance">수익률 (12개 컬럼)</option>
                    <option value="all_32_indicators">전체 지표 (32개 컬럼)</option>
                </select>
            </div>
        `;

        controlsContainer.insertAdjacentHTML('beforeend', viewModeHTML);
        
        // 이벤트 리스너 추가
        const selector = document.getElementById('view-mode-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                this.changeViewMode(e.target.value);
            });
        }
    }

    /**
     * 뷰 모드 변경
     */
    changeViewMode(newMode) {
        console.log(`🔄 뷰 모드 변경: ${this.currentViewMode} → ${newMode}`);
        this.currentViewMode = newMode;
        
        // 테이블 다시 렌더링
        if (window.currentData && window.currentData.length > 0) {
            renderTable(window.currentData);
        }
        
        // 페이지네이션 업데이트
        if (window.paginationManager) {
            window.paginationManager.updateData(window.currentData || []);
        }
    }

    /**
     * 현재 뷰 모드에 따른 컬럼 설정 반환
     */
    getColumnConfig() {
        const allColumns = this.getAllColumnDefinitions();
        
        switch (this.currentViewMode) {
            case 'basic':
                return allColumns.slice(0, 6);
            case 'key_metrics':
                return allColumns.slice(0, 11);
            case 'valuation':
                return this.getValuationColumns();
            case 'performance':
                return this.getPerformanceColumns();
            case 'all_32_indicators':
                return allColumns;
            default:
                return allColumns.slice(0, 6);
        }
    }

    /**
     * 전체 32개 지표 컬럼 정의
     */
    getAllColumnDefinitions() {
        return [
            // 기본 정보 (고정 컬럼)
            { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600 sticky left-0 bg-white z-30 min-w-16 shadow-sm', sortable: true },
            { key: 'corpName', label: '회사명', className: 'font-medium sticky left-16 bg-white z-30 min-w-32 shadow-sm', sortable: true },
            { key: 'Exchange', label: '거래소', className: 'text-gray-600 min-w-20', sortable: true },
            { key: 'industry', label: '업종', className: 'text-gray-700 min-w-24', sortable: true },
            { key: '현재가', label: '현재가', formatter: this.formatNumber, className: 'text-right font-mono min-w-20', sortable: true },
            { key: '전일대비', label: '전일%', formatter: this.formatPercentage, className: 'text-right font-mono min-w-16', sortable: true },
            
            // 규모 정보
            { key: '(USD mn)', label: '시총(M$)', formatter: this.formatMarketCap, className: 'text-right font-mono min-w-20', sortable: true },
            { key: '설립', label: '설립', formatter: this.formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'FY 0', label: '회계', formatter: this.formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            
            // 밸류에이션 지표
            { key: 'PER (Oct-25)', label: 'PER', formatter: this.formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: '% PER (Avg)', label: 'PER평균%', formatter: this.formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'PBR (Oct-25)', label: 'PBR', formatter: this.formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PEG (Oct-25)', label: 'PEG', formatter: this.formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PER (Avg)', label: 'PER평균', formatter: this.formatNumber, className: 'text-right font-mono min-w-18', sortable: true },
            { key: 'PER (3)', label: 'PER3Y', formatter: this.formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PER (5)', label: 'PER5Y', formatter: this.formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PER (10)', label: 'PER10Y', formatter: this.formatNumber, className: 'text-right font-mono min-w-18', sortable: true },
            
            // 수익성 지표
            { key: 'ROE (Fwd)', label: 'ROE예상', formatter: this.formatPercentage, className: 'text-right font-mono min-w-18', sortable: true },
            { key: 'OPM (Fwd)', label: '영업이익률', formatter: this.formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'Sales (3)', label: '매출성장3Y', formatter: this.formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            
            // 배당 지표
            { key: 'DY (FY+1)', label: '배당수익률', formatter: this.formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            
            // 수익률 지표
            { key: 'Return (Y)', label: '연간수익률', formatter: this.formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'W', label: '주간수익률', formatter: this.formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: '1 M', label: '1개월', formatter: this.formatPercentage, className: 'text-right font-mono min-w-16', sortable: true },
            { key: '3 M', label: '3개월', formatter: this.formatPercentage, className: 'text-right font-mono min-w-16', sortable: true },
            { key: '6 M', label: '6개월', formatter: this.formatPercentage, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'YTD', label: '연초대비', formatter: this.formatPercentage, className: 'text-right font-mono min-w-18', sortable: true },
            { key: '12 M', label: '12개월', formatter: this.formatPercentage, className: 'text-right font-mono min-w-18', sortable: true },
            
            // 기술적 지표
            { key: 'Price (10)', label: '10년평균가', formatter: this.formatNumber, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'CCC (FY 0)', label: '현금전환', formatter: this.formatNumber, className: 'text-right font-mono min-w-18', sortable: true },
            
            // 과거 데이터 (대표 1개)
            { key: '45933', label: '과거데이터', formatter: this.formatNumber, className: 'text-right font-mono min-w-18', sortable: true }
        ];
    }

    /**
     * 밸류에이션 전용 컬럼
     */
    getValuationColumns() {
        const allColumns = this.getAllColumnDefinitions();
        return [
            ...allColumns.slice(0, 4), // 기본 정보
            allColumns[6], // 시총
            allColumns[9], // PER
            allColumns[10], // PER 평균%
            allColumns[11], // PBR
            allColumns[12], // PEG
            allColumns[13], // PER 평균
            allColumns[14], // PER 3Y
            allColumns[15], // PER 5Y
            allColumns[16]  // PER 10Y
        ];
    }

    /**
     * 수익률 전용 컬럼
     */
    getPerformanceColumns() {
        const allColumns = this.getAllColumnDefinitions();
        return [
            ...allColumns.slice(0, 4), // 기본 정보
            allColumns[21], // 연간수익률
            allColumns[22], // 주간수익률
            allColumns[23], // 1개월
            allColumns[24], // 3개월
            allColumns[25], // 6개월
            allColumns[26], // YTD
            allColumns[27]  // 12개월
        ];
    }

    /**
     * 숫자 포맷터
     */
    formatNumber(value) {
        if (value === null || value === undefined || value === '' || value === '-') return '-';
        const num = parseFloat(value);
        if (isNaN(num)) return '-';
        return num.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    }

    /**
     * 퍼센트 포맷터
     */
    formatPercentage(value) {
        if (value === null || value === undefined || value === '' || value === '-') return '-';
        const num = parseFloat(value);
        if (isNaN(num)) return '-';
        const formatted = num.toFixed(2);
        return num > 0 ? `+${formatted}%` : `${formatted}%`;
    }

    /**
     * 시가총액 포맷터
     */
    formatMarketCap(value) {
        if (value === null || value === undefined || value === '' || value === '-') return '-';
        const num = parseFloat(value);
        if (isNaN(num)) return '-';
        
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}B`;
        } else {
            return `${num.toFixed(0)}M`;
        }
    }

    /**
     * 컬럼 표시/숨김 토글
     */
    toggleColumnVisibility(columnKey, visible) {
        this.columnVisibility.set(columnKey, visible);
        console.log(`컬럼 ${columnKey} ${visible ? '표시' : '숨김'}`);
        
        // 테이블 다시 렌더링
        if (window.currentData && window.currentData.length > 0) {
            renderTable(window.currentData);
        }
    }

    /**
     * 초기화
     */
    initialize() {
        this.addViewModeSelector();
        console.log('✅ ColumnManager 초기화 완료 - 32개 지표 지원');
    }
}

// 전역 인스턴스 생성
window.columnManager = new ColumnManager();

console.log('✅ ColumnManager 로드 완료 - 32개 지표 컬럼 시스템');