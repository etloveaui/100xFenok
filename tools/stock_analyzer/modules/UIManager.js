/**
 * UIManager 모듈
 * UI 렌더링, 이벤트 처리, 상태 관리 담당
 */

class UIManager {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.currentFilter = 'all';
        this.currentSort = { column: null, order: 'asc' };
        this.currentPage = 1;
        this.pageSize = 50;
        
        // UI 요소 참조
        this.elements = {};
        
        this.init();
    }
    
    /**
     * 초기화
     */
    init() {
        this.cacheElements();
        this.setupEventListeners();
        
        // DataManager 이벤트 구독
        this.dataManager.on('dataLoaded', (data) => {
            this.onDataLoaded(data);
        });
        
        this.dataManager.on('dataLoadError', (error) => {
            this.showError(error);
        });
    }
    
    /**
     * DOM 요소 캐싱
     */
    cacheElements() {
        this.elements = {
            screenerPanel: document.getElementById('screener-panel'),
            searchInput: document.getElementById('search-input'),
            searchButton: document.getElementById('search-button'),
            viewModeSelect: document.getElementById('view-mode'),
            resetButton: document.getElementById('reset-filters'),
            resultsTable: document.getElementById('results-table'),
            resultsCount: document.getElementById('results-count'),
            filterStatus: document.getElementById('filter-status')
        };
    }
    
    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 검색 기능
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', 
                this.debounce(this.handleSearch.bind(this), 300)
            );
            this.elements.searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleSearch();
                }
            });
        }
        
        if (this.elements.searchButton) {
            this.elements.searchButton.addEventListener('click', this.handleSearch.bind(this));
        }
        
        // 뷰 모드 변경
        if (this.elements.viewModeSelect) {
            this.elements.viewModeSelect.addEventListener('change', () => {
                console.log(`View mode changed to: ${this.elements.viewModeSelect.value}`);
                const currentData = this.dataManager.getFilteredData(this.currentFilter);
                this.renderTable(currentData);
            });
        }
        
        // 리셋 버튼
        if (this.elements.resetButton) {
            this.elements.resetButton.addEventListener('click', this.resetFilters.bind(this));
        }
    }
    
    /**
     * 데이터 로딩 완료 시 호출
     */
    onDataLoaded(data) {
        console.log("UIManager: Data loaded, rendering UI...");
        
        this.renderScreenerPanel();
        this.applyFilters('all');
        
        this.showLoadingComplete();
    }
    
    /**
     * 스크리너 패널 렌더링
     */
    renderScreenerPanel() {
        if (!this.elements.screenerPanel) return;
        
        const stats = this.dataManager.getStats();
        
        this.elements.screenerPanel.innerHTML = `
            <div class="flex flex-wrap gap-2 mb-4">
                <button id="filter-all" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                    전체 (${stats.totalCompanies.toLocaleString()})
                </button>
                <button id="filter-quality" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                    퀄리티 (${stats.qualityStocks.toLocaleString()})
                </button>
                <button id="filter-value" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                    밸류 (${stats.valueStocks.toLocaleString()})
                </button>
                <button id="filter-momentum" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                    모멘텀 (${stats.momentumStocks.toLocaleString()})
                </button>
            </div>
            <div id="filter-status" class="text-sm text-gray-600 mb-4"></div>
        `;
        
        // 필터 버튼 이벤트 추가
        document.getElementById('filter-all')?.addEventListener('click', () => this.applyFilters('all'));
        document.getElementById('filter-quality')?.addEventListener('click', () => this.applyFilters('quality'));
        document.getElementById('filter-value')?.addEventListener('click', () => this.applyFilters('value'));
        document.getElementById('filter-momentum')?.addEventListener('click', () => this.applyFilters('momentum'));
        
        // filter-status 요소 업데이트
        this.elements.filterStatus = document.getElementById('filter-status');
    }
    
    /**
     * 필터 적용
     */
    applyFilters(filterType) {
        console.log(`UIManager: Applying filter: ${filterType}`);
        
        this.currentFilter = filterType;
        this.currentPage = 1;
        
        try {
            const filteredData = this.dataManager.getFilteredData(filterType);
            
            this.updateButtonStyles();
            this.updateFilterStatus();
            this.renderTable(filteredData);
            
            console.log(`UIManager: Filter applied: ${filteredData.length} companies shown`);
            
        } catch (error) {
            console.error('UIManager: Error applying filters:', error);
            this.showError('필터링 중 오류가 발생했습니다.');
        }
    }
    
    /**
     * 검색 처리
     */
    handleSearch() {
        const searchTerm = this.elements.searchInput?.value.trim();
        
        if (!searchTerm) {
            this.applyFilters(this.currentFilter);
            return;
        }
        
        console.log(`UIManager: Searching for: ${searchTerm}`);
        
        const searchResults = this.dataManager.searchCompanies(searchTerm, this.currentFilter);
        
        console.log(`UIManager: Search results: ${searchResults.length} companies found`);
        
        this.updateFilterStatus(`검색 결과: "${searchTerm}" (${searchResults.length.toLocaleString()}개)`);
        this.renderTable(searchResults);
        
        // 단일 결과인 경우 상세 보기
        if (searchResults.length === 1) {
            this.showCompanyDetails(searchResults[0]);
        }
    }
    
    /**
     * 테이블 렌더링
     */
    renderTable(data) {
        console.log(`UIManager: Rendering table with ${data.length} companies`);
        
        if (!this.elements.resultsTable) {
            console.error('UIManager: Table container not found');
            return;
        }
        
        this.elements.resultsTable.innerHTML = '';
        
        if (!data || data.length === 0) {
            this.elements.resultsTable.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <p class="text-lg">표시할 데이터가 없습니다.</p>
                    <button onclick="window.uiManager.resetFilters()" class="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                        전체 목록 보기
                    </button>
                </div>
            `;
            return;
        }
        
        // 테이블 생성
        const table = document.createElement('table');
        table.className = 'w-full border-collapse bg-white shadow-sm rounded-lg overflow-hidden';
        
        const thead = document.createElement('thead');
        thead.className = 'bg-gray-50';
        
        const tbody = document.createElement('tbody');
        tbody.className = 'divide-y divide-gray-200';
        
        // 컬럼 설정 가져오기
        const columns = this.getDisplayColumns();
        
        // 헤더 생성
        const headerRow = document.createElement('tr');
        columns.forEach(col => {
            const th = document.createElement('th');
            th.className = `px-4 py-2 font-bold border-b-2 border-gray-200 ${
                col.className && col.className.includes('text-right') ? 'text-right' : 'text-left'
            } ${col.sortable ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`;
            
            const headerContent = document.createElement('div');
            headerContent.className = 'flex items-center gap-1';
            
            const labelSpan = document.createElement('span');
            labelSpan.textContent = col.label;
            headerContent.appendChild(labelSpan);
            
            if (col.sortable) {
                const sortIcon = document.createElement('span');
                sortIcon.className = 'sort-icon text-xs';
                
                if (this.currentSort.column === col.key) {
                    sortIcon.textContent = this.currentSort.order === 'asc' ? '▲' : '▼';
                    sortIcon.className += ' text-blue-600';
                } else {
                    sortIcon.textContent = '⇅';
                    sortIcon.className += ' text-gray-400';
                }
                
                headerContent.appendChild(sortIcon);
                
                th.addEventListener('click', () => {
                    this.sortTable(col.key);
                });
            }
            
            th.appendChild(headerContent);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        
        // 데이터 행 생성
        data.forEach((company, index) => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 cursor-pointer';
            
            row.addEventListener('click', () => {
                this.showCompanyDetails(company);
            });
            
            columns.forEach(col => {
                const td = document.createElement('td');
                td.className = `px-4 py-2 ${col.className || ''}`;
                
                const value = company[col.key];
                let displayValue;
                
                if (col.formatter && typeof col.formatter === 'function') {
                    displayValue = col.formatter(value);
                } else {
                    displayValue = this.formatValue(value, col.key);
                }
                
                td.textContent = displayValue;
                row.appendChild(td);
            });
            
            tbody.appendChild(row);
        });
        
        table.appendChild(thead);
        table.appendChild(tbody);
        this.elements.resultsTable.appendChild(table);
        
        this.updateResultsCount(data.length);
    }
    
    /**
     * 표시할 컬럼 설정 가져오기
     */
    getDisplayColumns() {
        const viewMode = this.elements.viewModeSelect?.value || 'basic';
        
        const columnConfigs = {
            basic: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'Exchange', label: '거래소', className: 'text-gray-600', sortable: true },
                { key: 'industry', label: '업종', className: 'text-gray-700', sortable: true },
                { key: '(USD mn)', label: '시가총액(M$)', formatter: this.formatMarketCap, className: 'text-right font-mono', sortable: true },
                { key: 'PER (Oct-25)', label: 'PER', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PBR (Oct-25)', label: 'PBR', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'ROE (Fwd)', label: 'ROE예상(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true }
            ],
            valuation: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'PER (Oct-25)', label: 'PER(현재)', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PBR (Oct-25)', label: 'PBR(현재)', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PEG (Oct-25)', label: 'PEG비율', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true },
                { key: '% PER (Avg)', label: 'PER평균대비(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'PER (3)', label: 'PER(3Y)', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PER (5)', label: 'PER(5Y)', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true }
            ],
            profitability: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'ROE (Fwd)', label: 'ROE예상(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'OPM (Fwd)', label: '영업이익률예상(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'Sales (3)', label: '매출성장률3Y(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'CCC (FY 0)', label: '현금전환주기(일)', formatter: this.formatNumber, className: 'text-right font-mono', sortable: true }
            ],
            performance: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'Return (Y)', label: '연간수익률(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '1 M', label: '1개월(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '3 M', label: '3개월(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '6 M', label: '6개월(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'YTD', label: '연초대비(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '12 M', label: '12개월(%)', formatter: this.formatPercentage, className: 'text-right font-mono', sortable: true }
            ]
        };
        
        return columnConfigs[viewMode] || columnConfigs.basic;
    }
    
    /**
     * 정렬 처리
     */
    sortTable(column) {
        console.log(`UIManager: Sorting by ${column}`);
        
        if (this.currentSort.column === column) {
            this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.column = column;
            this.currentSort.order = 'asc';
        }
        
        const filteredData = this.dataManager.getFilteredData(this.currentFilter);
        const sortedData = this.dataManager.sortData(filteredData, column, this.currentSort.order);
        
        this.renderTable(sortedData);
        
        console.log(`UIManager: Sorted by ${column} (${this.currentSort.order}): ${sortedData.length} items`);
    }
    
    /**
     * 기업 상세 정보 표시
     */
    showCompanyDetails(company) {
        console.log('UIManager: Showing details for:', company.Ticker);
        
        // 기존 상세 패널 제거
        const existingPanel = document.getElementById('company-details');
        if (existingPanel) {
            existingPanel.remove();
        }
        
        // 상세 패널 생성
        const detailsPanel = document.createElement('div');
        detailsPanel.id = 'company-details';
        detailsPanel.className = 'mt-6 p-6 bg-blue-50 rounded-lg border';
        
        detailsPanel.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <h3 class="text-xl font-bold text-blue-800">
                    ${company.Ticker} - ${company.corpName}
                </h3>
                <button onclick="document.getElementById('company-details').remove()" class="text-gray-500 hover:text-gray-700">
                    ✕
                </button>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${this.generateDetailedMetrics(company)}
            </div>
        `;
        
        // 테이블 다음에 삽입
        if (this.elements.resultsTable && this.elements.resultsTable.nextSibling) {
            this.elements.resultsTable.parentNode.insertBefore(detailsPanel, this.elements.resultsTable.nextSibling);
        } else if (this.elements.resultsTable) {
            this.elements.resultsTable.parentNode.appendChild(detailsPanel);
        }
    }
    
    /**
     * 상세 지표 생성
     */
    generateDetailedMetrics(company) {
        const categories = this.dataManager.columnConfig.categories || {};
        let html = '';
        
        Object.entries(categories).forEach(([key, category]) => {
            html += `
                <div class="bg-white p-3 rounded border">
                    <h5 class="font-semibold text-gray-800 mb-2">${category.name}</h5>
                    <div class="space-y-1 text-sm">
            `;
            
            category.columns.forEach(col => {
                const value = company[col];
                const koreanName = this.dataManager.columnConfig.korean_names?.[col] || col;
                const formattedValue = this.formatValue(value, col);
                
                if (value !== null && value !== undefined) {
                    html += `
                        <div class="flex justify-between">
                            <span class="text-gray-600">${koreanName}:</span>
                            <span class="font-mono">${formattedValue}</span>
                        </div>
                    `;
                }
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        return html;
    }
    
    /**
     * 버튼 스타일 업데이트
     */
    updateButtonStyles() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.className = 'filter-btn px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors duration-200';
        });
        
        const activeButton = document.getElementById(`filter-${this.currentFilter}`);
        if (activeButton) {
            activeButton.className = 'filter-btn px-4 py-2 rounded-lg border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors duration-200';
        }
    }
    
    /**
     * 필터 상태 업데이트
     */
    updateFilterStatus(customMessage = null) {
        if (!this.elements.filterStatus) return;
        
        if (customMessage) {
            this.elements.filterStatus.textContent = customMessage;
            return;
        }
        
        const filterNames = {
            'all': '전체',
            'quality': '퀄리티',
            'value': '밸류',
            'momentum': '모멘텀'
        };
        
        const filteredData = this.dataManager.getFilteredData(this.currentFilter);
        this.elements.filterStatus.textContent = `현재 필터: ${filterNames[this.currentFilter]} (${filteredData.length.toLocaleString()}개 기업)`;
    }
    
    /**
     * 결과 수 업데이트
     */
    updateResultsCount(count) {
        if (this.elements.resultsCount) {
            this.elements.resultsCount.innerHTML = `
                <span class="text-gray-700">
                    총 <strong class="text-blue-600">${count.toLocaleString()}</strong>개 기업
                </span>
            `;
        }
    }
    
    /**
     * 필터 리셋
     */
    resetFilters() {
        console.log('UIManager: Resetting filters');
        this.currentFilter = 'all';
        this.currentSort = { column: null, order: 'asc' };
        
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
        }
        
        this.dataManager.clearCache();
        this.applyFilters('all');
    }
    
    /**
     * 로딩 상태 표시
     */
    showLoadingState(message) {
        if (this.elements.resultsCount) {
            this.elements.resultsCount.innerHTML = `
                <div class="flex items-center gap-2">
                    <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    <span class="text-blue-600">${message}</span>
                </div>
            `;
        }
    }
    
    /**
     * 로딩 완료 표시
     */
    showLoadingComplete() {
        console.log("UIManager: Loading complete");
    }
    
    /**
     * 오류 표시
     */
    showError(error) {
        const errorMessage = typeof error === 'string' ? error : '오류가 발생했습니다.';
        
        if (this.elements.resultsCount) {
            this.elements.resultsCount.innerHTML = `
                <span class="text-red-600">오류: ${errorMessage}</span>
                <button onclick="location.reload()" class="ml-2 px-2 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
                    다시 시도
                </button>
            `;
        }
    }
    
    /**
     * 디바운스 함수
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    /**
     * 값 포맷팅
     */
    formatValue(value, column) {
        if (value === null || value === undefined || value === '') {
            return '-';
        }
        
        if (column === '(USD mn)') {
            return this.formatMarketCap(value);
        }
        
        if (column.includes('(%)') || column.includes('Growth') || column.includes('Return') || 
            column.includes('Yield') || column.includes('ROE') || column.includes('OPM')) {
            return this.formatPercentage(value);
        }
        
        if (typeof value === 'number') {
            return this.formatNumber(value);
        }
        
        return String(value);
    }
    
    formatMarketCap(value) {
        if (value === null || value === undefined || isNaN(value)) return '-';
        
        const num = parseFloat(value);
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}B`;
        } else {
            return `${num.toFixed(0)}M`;
        }
    }
    
    formatPercentage(value) {
        if (value === null || value === undefined || isNaN(value)) return '-';
        
        const num = parseFloat(value);
        return `${num.toFixed(1)}%`;
    }
    
    formatNumber(value) {
        if (value === null || value === undefined || isNaN(value)) return '-';
        
        const num = parseFloat(value);
        return num.toFixed(2);
    }
}

export default UIManager;