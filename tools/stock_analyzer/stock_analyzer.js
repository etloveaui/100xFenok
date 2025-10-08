document.addEventListener('DOMContentLoaded', () => {
    // Entry point for the application
    init();
});

// Global state
let allData = [];
let config = {};
let columnConfig = {}; // Column configuration with 47 indicators
let metadata = {}; // Data metadata
let indices = {
    quality: [],
    value: [],
    momentum: []
};
let currentFilter = 'all'; // Track current active filter
let currentSort = { column: null, order: 'asc' }; // Current sort state
let currentPage = 1; // Current page number
let pageSize = 50; // Items per page

// Error messages
const ERROR_MESSAGES = {
    LOAD_FAILED: '데이터 로딩에 실패했습니다. 페이지를 새로고침해주세요.',
    NETWORK_ERROR: '네트워크 연결을 확인해주세요.',
    CORS_ERROR: '로컬 서버에서 실행해주세요. file:// 프로토콜은 지원되지 않습니다.',
    FILTER_ERROR: '필터링 중 오류가 발생했습니다. 전체 목록을 표시합니다.',
    NO_DATA: '표시할 데이터가 없습니다.',
    JSON_PARSE_ERROR: '데이터 파일이 손상되었습니다.',
    SERVER_ERROR: '서버에서 데이터를 가져올 수 없습니다.'
};

/**
 * Initializes the application, loads data, and sets up event listeners.
 */
async function init() {
    console.log("Stock Analyzer Initializing...");
    await loadData();
    await loadScreenerIndices();
    renderScreenerPanel();
    
    // Apply initial filter (all stocks)
    applyFilters('all');
    
    setupEventListeners();
}

/**
 * Loads the enhanced summary data and configuration files.
 */
async function loadData() {
    console.log("Loading enhanced data with 47 indicators...");
    
    // Show loading state
    showLoadingState('강화된 데이터를 로딩 중입니다... (47개 지표)');
    
    try {
        // Load enhanced data, column config, and app config in parallel
        const [enhancedRes, columnConfigRes, appConfigRes] = await Promise.all([
            fetch('./data/enhanced_summary_data.json'),
            fetch('./data/column_config.json'),
            fetch('./stock_analyzer_config.json')
        ]);

        // Check if requests were successful
        if (!enhancedRes.ok) {
            throw new Error(`Failed to load enhanced data: ${enhancedRes.status} ${enhancedRes.statusText}`);
        }
        
        if (!columnConfigRes.ok) {
            throw new Error(`Failed to load column config: ${columnConfigRes.status} ${columnConfigRes.statusText}`);
        }

        // Parse JSON data
        const enhancedData = await enhancedRes.json();
        columnConfig = await columnConfigRes.json();
        
        if (appConfigRes.ok) {
            config = await appConfigRes.json();
        } else {
            config = {}; // Use default config if not available
        }

        // Extract companies data from enhanced structure
        if (enhancedData.companies && Array.isArray(enhancedData.companies)) {
            allData = enhancedData.companies;
            metadata = enhancedData.metadata || {};
        } else if (Array.isArray(enhancedData)) {
            // Fallback for old format
            allData = enhancedData;
            metadata = {};
        } else {
            throw new Error('Enhanced data is not in expected format');
        }

        console.log(`Successfully loaded ${allData.length} companies with ${metadata.total_columns || 47} indicators`);
        console.log('Available categories:', Object.keys(columnConfig.categories || {}));

    } catch (error) {
        console.error("Error loading enhanced data:", error);
        
        // Provide user-friendly error messages
        const errorMessage = getErrorMessage(error);
        
        const resultsCountElement = document.getElementById('results-count');
        if (resultsCountElement) {
            resultsCountElement.innerHTML = `
                <span class="text-red-600">오류: ${errorMessage}</span>
                <button onclick="location.reload()" class="ml-2 px-2 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
                    다시 시도
                </button>
            `;
        }
        
        // Show detailed error in console for debugging
        console.error('Detailed error information:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        // Initialize with empty data to prevent further errors
        allData = [];
        config = {};
        columnConfig = {};
        metadata = {};
    }
}

/**
 * Loads the screener index files for filtering.
 */
async function loadScreenerIndices() {
    console.log("Loading screener indices...");
    
    try {
        // Load all screener index files in parallel
        const [qualityRes, valueRes, momentumRes] = await Promise.all([
            fetch('./data/screener_indices/quality_index.json'),
            fetch('./data/screener_indices/value_index.json'),
            fetch('./data/screener_indices/momentum_index.json')
        ]);

        // Parse successful responses, but don't fail if some are missing
        if (qualityRes.ok) {
            indices.quality = await qualityRes.json();
            console.log(`Loaded ${indices.quality.length} quality stocks`);
        } else {
            console.warn('Quality index file not found or failed to load');
        }

        if (valueRes.ok) {
            indices.value = await valueRes.json();
            console.log(`Loaded ${indices.value.length} value stocks`);
        } else {
            console.warn('Value index file not found or failed to load');
        }

        if (momentumRes.ok) {
            indices.momentum = await momentumRes.json();
            console.log(`Loaded ${indices.momentum.length} momentum stocks`);
        } else {
            console.warn('Momentum index file not found or failed to load');
        }

    } catch (error) {
        console.warn("Error loading screener indices:", error);
        // Continue without indices - they're optional
    }
}

/**
 * Shows loading state in the results area
 */
function showLoadingState(message) {
    const resultsCountElement = document.getElementById('results-count');
    if (resultsCountElement) {
        resultsCountElement.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span class="text-blue-600">${message}</span>
            </div>
        `;
    }
}

/**
 * Gets user-friendly error message based on error type
 */
function getErrorMessage(error) {
    if (error.message.includes('Failed to fetch')) {
        return ERROR_MESSAGES.NETWORK_ERROR;
    } else if (error.message.includes('CORS')) {
        return ERROR_MESSAGES.CORS_ERROR;
    } else if (error.message.includes('JSON')) {
        return ERROR_MESSAGES.JSON_PARSE_ERROR;
    } else if (error.message.includes('404') || error.message.includes('500')) {
        return ERROR_MESSAGES.SERVER_ERROR;
    } else {
        return ERROR_MESSAGES.LOAD_FAILED;
    }
}

/**
 * Renders the screener panel with filter buttons
 */
function renderScreenerPanel() {
    const screenerPanel = document.getElementById('screener-panel');
    if (!screenerPanel) return;

    screenerPanel.innerHTML = `
        <div class="flex flex-wrap gap-2 mb-4">
            <button id="filter-all" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                전체 (${allData.length.toLocaleString()})
            </button>
            <button id="filter-quality" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                퀄리티 (${indices.quality.length.toLocaleString()})
            </button>
            <button id="filter-value" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                밸류 (${indices.value.length.toLocaleString()})
            </button>
            <button id="filter-momentum" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                모멘텀 (${indices.momentum.length.toLocaleString()})
            </button>
        </div>
        <div id="filter-status" class="text-sm text-gray-600 mb-4"></div>
    `;
}

/**
 * Sets up event listeners for the application
 */
function setupEventListeners() {
    // Filter buttons
    document.getElementById('filter-all')?.addEventListener('click', () => applyFilters('all'));
    document.getElementById('filter-quality')?.addEventListener('click', () => applyFilters('quality'));
    document.getElementById('filter-value')?.addEventListener('click', () => applyFilters('value'));
    document.getElementById('filter-momentum')?.addEventListener('click', () => applyFilters('momentum'));

    // Search functionality
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    
    if (searchInput) {
        // Real-time search as user types
        searchInput.addEventListener('input', debounce(handleSearch, 300));
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }
    
    if (searchButton) {
        searchButton.addEventListener('click', handleSearch);
    }
    
    // View mode change event
    const viewModeSelect = document.getElementById('view-mode');
    if (viewModeSelect) {
        viewModeSelect.addEventListener('change', () => {
            console.log(`View mode changed to: ${viewModeSelect.value}`);
            // Re-render table with current data and new view mode
            const currentData = getFilteredData(currentFilter);
            renderTable(currentData);
        });
    }
}

/**
 * Debounce function to limit API calls
 */
function debounce(func, wait) {
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
 * Handles search functionality
 */
function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput?.value.trim().toUpperCase();
    
    if (!searchTerm) {
        // If search is empty, show current filter
        applyFilters(currentFilter);
        return;
    }
    
    console.log(`Searching for: ${searchTerm}`);
    
    // Search in current filtered data
    const currentData = getFilteredData(currentFilter);
    const searchResults = currentData.filter(company => {
        return company.Ticker?.toUpperCase().includes(searchTerm) ||
               company.corpName?.toUpperCase().includes(searchTerm) ||
               company.searchIndex?.includes(searchTerm.toLowerCase());
    });
    
    console.log(`Search results: ${searchResults.length} companies found`);
    
    // Update filter status
    updateFilterStatus(`검색 결과: "${searchTerm}" (${searchResults.length.toLocaleString()}개)`);
    
    // Render search results
    renderTable(searchResults);
    
    // If single result, show detailed view
    if (searchResults.length === 1) {
        showCompanyDetails(searchResults[0]);
    }
}

/**
 * Shows detailed view for a single company
 */
function showCompanyDetails(company) {
    console.log('Showing details for:', company.Ticker);
    
    // Create detailed view panel
    const detailsPanel = document.createElement('div');
    detailsPanel.id = 'company-details';
    detailsPanel.className = 'mt-6 p-6 bg-blue-50 rounded-lg border';
    
    detailsPanel.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <h3 class="text-xl font-bold text-blue-800">
                ${company.Ticker} - ${company.corpName}
            </h3>
            <button onclick="hideCompanyDetails()" class="text-gray-500 hover:text-gray-700">
                ✕
            </button>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${generateDetailedMetrics(company)}
        </div>
        
        <div class="mt-4 p-4 bg-white rounded border">
            <h4 class="font-bold mb-2">주요 지표 분석</h4>
            <div class="text-sm text-gray-700">
                ${generateAnalysisInsights(company)}
            </div>
        </div>
    `;
    
    // Insert after the table
    const tableContainer = document.getElementById('results-table');
    if (tableContainer && tableContainer.nextSibling) {
        tableContainer.parentNode.insertBefore(detailsPanel, tableContainer.nextSibling);
    } else if (tableContainer) {
        tableContainer.parentNode.appendChild(detailsPanel);
    }
}

/**
 * Generates detailed metrics for company details view
 */
function generateDetailedMetrics(company) {
    const categories = columnConfig.categories || {};
    let html = '';
    
    Object.entries(categories).forEach(([key, category]) => {
        html += `
            <div class="bg-white p-3 rounded border">
                <h5 class="font-semibold text-gray-800 mb-2">${category.name}</h5>
                <div class="space-y-1 text-sm">
        `;
        
        category.columns.forEach(col => {
            const value = company[col];
            const koreanName = columnConfig.korean_names?.[col] || col;
            const formattedValue = formatValue(value, col);
            
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
 * Generates analysis insights for a company
 */
function generateAnalysisInsights(company) {
    const insights = [];
    
    // Valuation analysis
    if (company.PER && company.PER > 0) {
        if (company.PER < 10) {
            insights.push('🟢 PER이 낮아 저평가 가능성이 있습니다.');
        } else if (company.PER > 25) {
            insights.push('🔴 PER이 높아 고평가 가능성이 있습니다.');
        }
    }
    
    // Profitability analysis
    if (company.ROE && company.ROE > 15) {
        insights.push('🟢 ROE가 우수하여 수익성이 좋습니다.');
    }
    
    // Growth analysis
    if (company.SalesGrowth1Y && company.SalesGrowth1Y > 10) {
        insights.push('🟢 매출 성장률이 양호합니다.');
    }
    
    // Dividend analysis
    if (company.DividendYield && company.DividendYield > 3) {
        insights.push('🟢 배당수익률이 양호합니다.');
    }
    
    // Financial stability
    if (company.DebtRatio && company.DebtRatio < 30) {
        insights.push('🟢 부채비율이 낮아 재무 안정성이 좋습니다.');
    }
    
    return insights.length > 0 ? insights.join('<br>') : '추가 분석이 필요합니다.';
}

/**
 * Hides company details panel
 */
function hideCompanyDetails() {
    const detailsPanel = document.getElementById('company-details');
    if (detailsPanel) {
        detailsPanel.remove();
    }
}

/**
 * Applies filters and renders the table
 */
function applyFilters(filterType) {
    console.log(`Applying filter: ${filterType}`);
    
    currentFilter = filterType;
    currentPage = 1; // Reset to first page
    
    try {
        const filteredData = getFilteredData(filterType);
        
        updateButtonStyles();
        updateFilterStatus();
        renderTable(filteredData);
        
        console.log(`Filter applied: ${filteredData.length} companies shown`);
        
    } catch (error) {
        console.error('Error applying filters:', error);
        
        // Show error message and fallback to all data
        updateFilterStatus(ERROR_MESSAGES.FILTER_ERROR);
        renderTable(allData);
    }
}

/**
 * Gets filtered data based on filter type
 */
function getFilteredData(filterType) {
    switch (filterType) {
        case 'quality':
            return allData.filter(company => 
                indices.quality.some(ticker => ticker === company.Ticker)
            );
        case 'value':
            return allData.filter(company => 
                indices.value.some(ticker => ticker === company.Ticker)
            );
        case 'momentum':
            return allData.filter(company => 
                indices.momentum.some(ticker => ticker === company.Ticker)
            );
        case 'all':
        default:
            return allData;
    }
}

/**
 * Updates button styles based on current filter
 */
function updateButtonStyles() {
    // Reset all buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.className = 'filter-btn px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors duration-200';
    });
    
    // Highlight active button
    const activeButton = document.getElementById(`filter-${currentFilter}`);
    if (activeButton) {
        activeButton.className = 'filter-btn px-4 py-2 rounded-lg border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors duration-200';
    }
}

/**
 * Updates filter status display
 */
function updateFilterStatus(customMessage = null) {
    const statusElement = document.getElementById('filter-status');
    if (!statusElement) return;
    
    if (customMessage) {
        statusElement.textContent = customMessage;
        return;
    }
    
    const filterNames = {
        'all': '전체',
        'quality': '퀄리티',
        'value': '밸류',
        'momentum': '모멘텀'
    };
    
    const filteredData = getFilteredData(currentFilter);
    statusElement.textContent = `현재 필터: ${filterNames[currentFilter]} (${filteredData.length.toLocaleString()}개 기업)`;
}

/**
 * Renders the data table with enhanced features
 */
function renderTable(data) {
    console.log(`Rendering table with ${data.length} companies`);
    
    const tableContainer = document.getElementById('results-table');
    if (!tableContainer) {
        console.error('Table container not found');
        return;
    }
    
    // Clear existing content
    tableContainer.innerHTML = '';
    
    if (!data || data.length === 0) {
        tableContainer.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <p class="text-lg">${ERROR_MESSAGES.NO_DATA}</p>
                <button onclick="applyFilters('all')" class="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                    전체 목록 보기
                </button>
            </div>
        `;
        return;
    }
    
    // Create table structure
    const table = document.createElement('table');
    table.className = 'w-full border-collapse bg-white shadow-sm rounded-lg overflow-hidden';
    
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50';
    
    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-gray-200';
    
    // Define table columns based on current view mode
    const columns = getDisplayColumns();
    
    function getDisplayColumns() {
        // Get current view mode from dropdown
        const viewMode = document.getElementById('view-mode')?.value || 'basic';
        
        // Column configurations for different view modes
        const columnConfigs = {
            basic: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'Exchange', label: '거래소', className: 'text-gray-600', sortable: true },
                { key: 'industry', label: '업종', className: 'text-gray-700', sortable: true },
                { key: '(USD mn)', label: '시가총액(M$)', formatter: formatMarketCap, className: 'text-right font-mono', sortable: true },
                { key: 'PER (Oct-25)', label: 'PER', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PBR (Oct-25)', label: 'PBR', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'ROE (Fwd)', label: 'ROE예상(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true }
            ],
            valuation: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'PER (Oct-25)', label: 'PER(현재)', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PBR (Oct-25)', label: 'PBR(현재)', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PEG (Oct-25)', label: 'PEG비율', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: '% PER (Avg)', label: 'PER평균대비(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'PER (3)', label: 'PER(3Y)', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PER (5)', label: 'PER(5Y)', formatter: formatNumber, className: 'text-right font-mono', sortable: true }
            ],
            profitability: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'ROE (Fwd)', label: 'ROE예상(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'OPM (Fwd)', label: '영업이익률예상(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'Sales (3)', label: '매출성장률3Y(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'CCC (FY 0)', label: '현금전환주기(일)', formatter: formatNumber, className: 'text-right font-mono', sortable: true }
            ],
            performance: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'Return (Y)', label: '연간수익률(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '1 M', label: '1개월(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '3 M', label: '3개월(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '6 M', label: '6개월(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'YTD', label: '연초대비(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: '12 M', label: '12개월(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true }
            ],
            all: [
                { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600', sortable: true },
                { key: 'corpName', label: '회사명', className: 'font-medium', sortable: true },
                { key: 'Exchange', label: '거래소', className: 'text-gray-600', sortable: true },
                { key: 'industry', label: '업종', className: 'text-gray-700', sortable: true },
                { key: '현재가', label: '현재가($)', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: '(USD mn)', label: '시가총액(M$)', formatter: formatMarketCap, className: 'text-right font-mono', sortable: true },
                { key: 'PER (Oct-25)', label: 'PER', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'PBR (Oct-25)', label: 'PBR', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
                { key: 'ROE (Fwd)', label: 'ROE예상(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'OPM (Fwd)', label: '영업이익률예상(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'Sales (3)', label: '매출성장률3Y(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'Return (Y)', label: '연간수익률(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
                { key: 'DY (FY+1)', label: '배당수익률(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true }
            ]
        };
        
        const basicColumns = columnConfigs[viewMode] || columnConfigs.basic;
        
        return basicColumns;
    }
    
    // Create header with sorting functionality
    const headerRow = document.createElement('tr');
    columns.forEach(col => {
        const th = document.createElement('th');
        th.className = `px-4 py-2 font-bold border-b-2 border-gray-200 ${
            col.className && col.className.includes('text-right') ? 'text-right' : 'text-left'
        } ${col.sortable ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`;
        
        // Create header content with sort indicator
        const headerContent = document.createElement('div');
        headerContent.className = 'flex items-center gap-1';
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = col.label;
        headerContent.appendChild(labelSpan);
        
        if (col.sortable) {
            const sortIcon = document.createElement('span');
            sortIcon.className = 'sort-icon text-xs';
            
            if (currentSort.column === col.key) {
                sortIcon.textContent = currentSort.order === 'asc' ? '▲' : '▼';
                sortIcon.className += ' text-blue-600';
            } else {
                sortIcon.textContent = '⇅';
                sortIcon.className += ' text-gray-400';
            }
            
            headerContent.appendChild(sortIcon);
            
            // Add click event for sorting
            th.addEventListener('click', () => {
                sortTable(col.key);
            });
        }
        
        th.appendChild(headerContent);
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    
    // Create table rows
    data.forEach((company, index) => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 cursor-pointer';
        
        // Add click event to show company details
        row.addEventListener('click', () => {
            showCompanyDetails(company);
        });
        
        columns.forEach(col => {
            const td = document.createElement('td');
            td.className = `px-4 py-2 ${col.className || ''}`;
            
            const value = company[col.key];
            let displayValue;
            
            if (col.formatter && typeof col.formatter === 'function') {
                displayValue = col.formatter(value);
            } else {
                displayValue = formatValue(value, col.key);
            }
            
            td.textContent = displayValue;
            row.appendChild(td);
        });
        
        tbody.appendChild(row);
    });
    
    // Assemble table
    table.appendChild(thead);
    table.appendChild(tbody);
    tableContainer.appendChild(table);
    
    // Update results count
    updateResultsCount(data.length);
}

/**
 * Sorts the table by the specified column
 */
function sortTable(column) {
    console.log(`Sorting by ${column}`);
    
    // Toggle sort order if same column, otherwise default to ascending
    if (currentSort.column === column) {
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.order = 'asc';
    }
    
    // Get current filtered data
    const filteredData = getFilteredData(currentFilter);
    
    // Sort the data
    const sortedData = sortData(filteredData, column, currentSort.order);
    
    // Re-render table
    renderTable(sortedData);
    
    console.log(`Sorted by ${column} (${currentSort.order}): ${sortedData.length} items`);
}

/**
 * Sorts data array by specified column and order
 */
function sortData(data, column, order) {
    return [...data].sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];
        
        // Handle null/undefined values
        if (aVal === null || aVal === undefined) aVal = order === 'asc' ? -Infinity : Infinity;
        if (bVal === null || bVal === undefined) bVal = order === 'asc' ? -Infinity : Infinity;
        
        // Handle string values
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return order === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        
        // Handle numeric values
        const numA = parseFloat(aVal);
        const numB = parseFloat(bVal);
        
        if (!isNaN(numA) && !isNaN(numB)) {
            return order === 'asc' ? numA - numB : numB - numA;
        }
        
        // Fallback to string comparison
        return order === 'asc' ? 
            String(aVal).localeCompare(String(bVal)) : 
            String(bVal).localeCompare(String(aVal));
    });
}

/**
 * Updates the results count display
 */
function updateResultsCount(count) {
    const resultsCountElement = document.getElementById('results-count');
    if (resultsCountElement) {
        resultsCountElement.innerHTML = `
            <span class="text-gray-700">
                총 <strong class="text-blue-600">${count.toLocaleString()}</strong>개 기업
            </span>
        `;
    }
}

/**
 * Formats values for display based on column type
 */
function formatValue(value, column) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }
    
    // Market cap formatting
    if (column === 'MarketCapUSD') {
        return formatMarketCap(value);
    }
    
    // Percentage formatting
    if (column.includes('Growth') || column.includes('Yield') || column.includes('Ratio') || 
        column === 'ROE' || column === 'ROA' || column === 'OPM' || column === 'NPM') {
        return formatPercentage(value);
    }
    
    // Number formatting
    if (typeof value === 'number') {
        return formatNumber(value);
    }
    
    return String(value);
}

/**
 * Formats market cap values
 */
function formatMarketCap(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    
    const num = parseFloat(value);
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}B`;
    } else {
        return `${num.toFixed(0)}M`;
    }
}

/**
 * Formats percentage values
 */
function formatPercentage(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    
    const num = parseFloat(value);
    return `${num.toFixed(1)}%`;
}

/**
 * Formats number values
 */
function formatNumber(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    
    const num = parseFloat(value);
    return num.toFixed(2);
}

/**
 * Resets filter to show all data (used for error recovery)
 */
function resetFilter() {
    console.log('Resetting filter to show all data');
    currentFilter = 'all';
    updateButtonStyles();
    updateFilterStatus();
    renderTable(allData);
}