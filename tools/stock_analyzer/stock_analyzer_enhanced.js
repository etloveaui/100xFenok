document.addEventListener('DOMContentLoaded', () => {
    init();
});

// Global state
let allData = [];
let config = {};
let columnConfig = {};
let metadata = {};
let indices = {
    quality: [],
    value: [],
    momentum: []
};
let currentFilter = 'all';
let sortState = { column: null, order: 'asc' };
let currentPage = 1;
let pageSize = 50;

// 페이징 관리자
class SimplePaginationManager {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 50;
        this.totalItems = 0;
        this.totalPages = 0;
        this.data = [];
    }
    
    setData(data) {
        this.data = data || [];
        this.totalItems = this.data.length;
        this.totalPages = Math.ceil(this.totalItems / this.pageSize) || 1;
        
        if (this.currentPage > this.totalPages) {
            this.currentPage = 1;
        }
        
        return this.getCurrentPageData();
    }
    
    getCurrentPageData() {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, this.totalItems);
        
        return {
            data: this.data.slice(startIndex, endIndex),
            pagination: {
                currentPage: this.currentPage,
                totalPages: this.totalPages,
                totalItems: this.totalItems,
                pageSize: this.pageSize,
                startIndex: startIndex + 1,
                endIndex: endIndex,
                hasNext: this.currentPage < this.totalPages,
                hasPrev: this.currentPage > 1
            }
        };
    }
    
    goToPage(pageNumber) {
        const targetPage = parseInt(pageNumber);
        if (targetPage >= 1 && targetPage <= this.totalPages) {
            this.currentPage = targetPage;
            return this.getCurrentPageData();
        }
        return null;
    }
    
    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            return this.getCurrentPageData();
        }
        return null;
    }
    
    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            return this.getCurrentPageData();
        }
        return null;
    }
    
    setPageSize(newSize) {
        const size = parseInt(newSize);
        if (size > 0) {
            const currentFirstItemIndex = (this.currentPage - 1) * this.pageSize;
            this.pageSize = size;
            this.totalPages = Math.ceil(this.totalItems / this.pageSize) || 1;
            this.currentPage = Math.floor(currentFirstItemIndex / this.pageSize) + 1;
            
            if (this.currentPage > this.totalPages) {
                this.currentPage = this.totalPages;
            }
            
            return this.getCurrentPageData();
        }
        return null;
    }
}

// 전역 페이징 관리자
let paginationManager = new SimplePaginationManager();

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
 * 애플리케이션 초기화
 */
async function init() {
    console.log("Stock Analyzer Enhanced Initializing...");
    await loadData();
    await loadScreenerIndices();
    renderScreenerPanel();
    
    // ColumnManager 초기화
    if (window.columnManager) {
        window.columnManager.initialize();
    }
    
    // CardViewManager 초기화
    if (window.cardViewManager) {
        window.cardViewManager.initialize();
    }
    
    // AdvancedFilterManager 초기화 (데이터 로딩 후)
    if (window.advancedFilterManager) {
        setTimeout(() => {
            if (window.allData && window.allData.length > 0) {
                window.advancedFilterManager.initialize();
            } else {
                console.log('⏳ 데이터 로딩 완료 대기 중... AdvancedFilterManager 초기화 지연');
                setTimeout(() => window.advancedFilterManager.initialize(), 2000);
            }
        }, 1500); // 데이터 로딩 후 충분한 시간 대기
    }
    
    // ScrollManager 초기화
    if (window.scrollManager) {
        setTimeout(() => {
            window.scrollManager.initialize();
        }, 1000); // 테이블 렌더링 후 초기화
    }
    
    // DashboardManager 초기화
    if (window.dashboardManager) {
        setTimeout(() => {
            window.dashboardManager.initialize();
        }, 1500); // 데이터 로딩 후 초기화
    }
    
    // ResponsiveManager 초기화
    if (window.responsiveManager) {
        window.responsiveManager.initialize();
    }
    
    // FilterManager 초기화
    if (window.filterManager) {
        setTimeout(() => {
            window.filterManager.initialize(window.allData);
        }, 2000); // 데이터 로딩 후 초기화
    }
    
    // PerformanceManager 초기화
    if (window.performanceManager) {
        window.performanceManager.startMonitoring();
    }
    
    // LoadingManager 초기화
    if (window.loadingManager) {
        window.loadingManager.initialize();
    }
    
    // TestManager 초기화
    if (window.testManager) {
        window.testManager.initialize();
    }
    
    // AdvancedSearchManager 초기화 (데이터 로딩 후)
    if (window.advancedSearchManager) {
        setTimeout(() => {
            if (window.allData && window.allData.length > 0) {
                window.advancedSearchManager.initialize(window.allData);
            } else {
                console.log('⏳ AdvancedSearchManager: 데이터 대기 중...');
            }
        }, 2500);
    }
    
    // SearchEnhancementManager 초기화
    if (window.searchEnhancementManager) {
        setTimeout(() => {
            window.searchEnhancementManager.initialize(window.allData);
        }, 3000); // 데이터 로딩 후 초기화
    }
    
    // PortfolioManager 초기화
    if (window.portfolioManager) {
        setTimeout(() => {
            window.portfolioManager.initialize();
        }, 3000); // 모든 시스템 로딩 후 초기화
    }
    
    applyFilters('all');
    setupEventListeners();
}

/**
 * 강화된 데이터 로딩
 */
async function loadData() {
    console.log("Loading enhanced data with 31 indicators...");
    
    showLoadingState('강화된 데이터를 로딩 중입니다... (31개 지표)');
    
    try {
        // 캐시 무효화를 위한 타임스탬프 추가
        const timestamp = new Date().getTime();
        const [enhancedRes, columnConfigRes, appConfigRes] = await Promise.all([
            fetch(`./data/enhanced_summary_data.json?v=${timestamp}`),
            fetch('./data/column_config.json'),
            fetch('./stock_analyzer_config.json')
        ]);

        if (!enhancedRes.ok) {
            throw new Error(`Failed to load enhanced data: ${enhancedRes.status} ${enhancedRes.statusText}`);
        }
        
        if (!columnConfigRes.ok) {
            throw new Error(`Failed to load column config: ${columnConfigRes.status} ${columnConfigRes.statusText}`);
        }

        const enhancedData = await enhancedRes.json();
        columnConfig = await columnConfigRes.json();
        
        if (appConfigRes.ok) {
            config = await appConfigRes.json();
        } else {
            config = {};
        }

        let rawData;
        if (enhancedData.companies && Array.isArray(enhancedData.companies)) {
            rawData = enhancedData.companies;
            metadata = enhancedData.metadata || {};
        } else if (Array.isArray(enhancedData)) {
            rawData = enhancedData;
            metadata = {};
        } else {
            throw new Error('Enhanced data is not in expected format');
        }

        // 데이터 정제 시스템 적용
        if (window.dataCleanupManager) {
            console.log('🧹 데이터 정제 시작...');
            allData = window.dataCleanupManager.cleanupData(rawData);
            
            // 정제 보고서 생성
            const cleanupReport = window.dataCleanupManager.generateCleanupReport(rawData, allData);
            console.log('📊 데이터 정제 완료:', cleanupReport.summary);
            
            // 심각한 데이터 품질 문제가 있는 경우 경고
            if (cleanupReport.summary.successRate < 90) {
                console.warn('⚠️ 데이터 품질 경고: 성공률이 90% 미만입니다.');
                if (window.loadingManager) {
                    window.loadingManager.showFeedback(
                        `데이터 품질 경고: ${cleanupReport.removedCount}개 항목이 제거되었습니다.`,
                        'warning',
                        5000
                    );
                }
            }
        } else {
            console.warn('⚠️ DataCleanupManager를 사용할 수 없습니다. 원본 데이터를 사용합니다.');
            allData = rawData;
        }

        console.log(`Successfully loaded ${allData.length} companies with ${metadata.total_columns || 31} indicators`);
        console.log('Available categories:', Object.keys(columnConfig.categories || {}));
        
        // 데이터 품질 확인 (엔비디아 예시)
        const nvidia = allData.find(company => company.Ticker === 'NVDA');
        if (nvidia) {
            console.log('🔍 엔비디아 데이터 확인:', {
                'Sales (3)': nvidia['Sales (3)'],
                'Return (Y)': nvidia['Return (Y)'],
                'ROE (Fwd)': nvidia['ROE (Fwd)'],
                'OPM (Fwd)': nvidia['OPM (Fwd)']
            });
        }
        
        // 검색 인덱스 생성 (성능 최적화)
        buildSearchIndex();

    } catch (error) {
        console.error("Error loading enhanced data:", error);
        
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
        
        console.error('Detailed error information:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        allData = [];
        config = {};
        columnConfig = {};
        metadata = {};
    }
}

/**
 * 스크리너 인덱스 로딩
 */
async function loadScreenerIndices() {
    console.log("Loading screener indices...");
    
    try {
        const [qualityRes, valueRes, momentumRes] = await Promise.all([
            fetch('./data/screener_indices/quality_index.json'),
            fetch('./data/screener_indices/value_index.json'),
            fetch('./data/screener_indices/momentum_index.json')
        ]);

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
    }
}

/**
 * 로딩 상태 표시
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
 * 오류 메시지 가져오기
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
 * 스크리너 패널 렌더링
 */
function renderScreenerPanel() {
    const screenerPanel = document.getElementById('screener-panel');
    if (!screenerPanel) return;

    // 실제 데이터 기반으로 개수 계산 (자동 반영)
    const qualityCount = getFilteredData('quality').length;
    const valueCount = getFilteredData('value').length;
    const momentumCount = getFilteredData('momentum').length;
    
    screenerPanel.innerHTML = `
        <div class="flex flex-wrap gap-2 mb-4">
            <button id="filter-all" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                전체 (${allData.length.toLocaleString()})
            </button>
            <button id="filter-quality" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                퀄리티 (${qualityCount.toLocaleString()})
            </button>
            <button id="filter-value" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                밸류 (${valueCount.toLocaleString()})
            </button>
            <button id="filter-momentum" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                모멘텀 (${momentumCount.toLocaleString()})
            </button>
        </div>
        <div id="filter-status" class="text-sm text-gray-600 mb-4"></div>
    `;
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 필터 버튼
    document.getElementById('filter-all')?.addEventListener('click', () => applyFilters('all'));
    document.getElementById('filter-quality')?.addEventListener('click', () => applyFilters('quality'));
    document.getElementById('filter-value')?.addEventListener('click', () => applyFilters('value'));
    document.getElementById('filter-momentum')?.addEventListener('click', () => applyFilters('momentum'));

    // 강화된 검색 기능
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const clearSearchButton = document.getElementById('clear-search');
    const searchSuggestions = document.getElementById('search-suggestions');
    
    if (searchInput) {
        // 실시간 검색 (디바운싱)
        searchInput.addEventListener('input', debounce((e) => {
            const value = e.target.value.trim();
            
            if (value) {
                // 검색 실행
                handleSearch();
                
                // 초기화 버튼 표시
                if (clearSearchButton) {
                    clearSearchButton.classList.remove('hidden');
                }
                
                // 자동완성 제안 (길이가 2 이상일 때)
                if (value.length >= 2) {
                    showSearchSuggestions(value);
                } else {
                    hideSearchSuggestions();
                }
            } else {
                // 빈 검색어면 초기화
                clearSearch();
                if (clearSearchButton) {
                    clearSearchButton.classList.add('hidden');
                }
                hideSearchSuggestions();
            }
        }, 300));
        
        // 엔터키 검색
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
                hideSearchSuggestions();
            }
        });
        
        // 포커스 시 자동완성 표시
        searchInput.addEventListener('focus', (e) => {
            const value = e.target.value.trim();
            if (value.length >= 2) {
                showSearchSuggestions(value);
            }
        });
        
        // 포커스 아웃 시 자동완성 숨김 (지연)
        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                hideSearchSuggestions();
            }, 200);
        });
    }
    
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.preventDefault();
            handleSearch();
            hideSearchSuggestions();
        });
    }
    
    // 검색 초기화 버튼
    if (clearSearchButton) {
        clearSearchButton.addEventListener('click', (e) => {
            e.preventDefault();
            clearSearch();
            clearSearchButton.classList.add('hidden');
            hideSearchSuggestions();
            searchInput?.focus();
        });
    }
    
    // 뷰 모드 변경
    const viewModeSelect = document.getElementById('view-mode');
    if (viewModeSelect) {
        viewModeSelect.addEventListener('change', () => {
            console.log(`View mode changed to: ${viewModeSelect.value}`);
            const currentData = getFilteredData(currentFilter);
            renderTable(currentData);
        });
    }
}

/**
 * 디바운스 함수
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
 * 고급 검색 시스템
 */

// 검색 상태 관리 (성능 최적화 포함)
let searchState = {
    currentTerm: '',
    lastResults: [],
    searchHistory: [],
    suggestions: [],
    cache: new Map(), // 검색 결과 캐싱
    index: null // 검색 인덱스
};

/**
 * 검색 인덱스 생성 (성능 최적화)
 */
function buildSearchIndex() {
    console.log('🔍 검색 인덱스 생성 중...');
    
    const startTime = performance.now();
    const index = new Map();
    
    allData.forEach((company, idx) => {
        // 검색 가능한 모든 필드를 인덱스에 추가
        const searchableFields = [
            company.Ticker?.toLowerCase() || '',
            company.corpName?.toLowerCase() || '',
            company.industry?.toLowerCase() || '',
            company.Exchange?.toLowerCase() || ''
        ];
        
        searchableFields.forEach(field => {
            if (field) {
                // 각 단어별로 인덱스 생성
                const words = field.split(/\\s+/);
                words.forEach(word => {
                    if (word.length >= 2) { // 2글자 이상만 인덱싱
                        if (!index.has(word)) {
                            index.set(word, new Set());
                        }
                        index.get(word).add(idx);
                    }
                });
                
                // 전체 필드도 인덱싱
                if (!index.has(field)) {
                    index.set(field, new Set());
                }
                index.get(field).add(idx);
            }
        });
    });
    
    searchState.index = index;
    
    const endTime = performance.now();
    console.log(`✅ 검색 인덱스 생성 완료 (${(endTime - startTime).toFixed(2)}ms)`);
    console.log(`📊 인덱스 크기: ${index.size}개 키워드`);
}

/**
 * 고급 검색 처리 (정렬 상태 유지 + 성능 최적화)
 */
function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput?.value.trim();
    
    if (!searchTerm) {
        clearSearch();
        return;
    }
    
    console.log(`🔍 고급 검색: "${searchTerm}"`);
    
    // 검색 상태 업데이트
    searchState.currentTerm = searchTerm;
    
    // 검색 실행
    const searchResults = performAdvancedSearch(searchTerm);
    
    // 검색 기록 추가
    addToSearchHistory(searchTerm);
    
    console.log(`검색 결과: ${searchResults.length}개 발견`);
    
    // 결과 표시
    displaySearchResults(searchResults, searchTerm);
    
    // 단일 결과인 경우 상세 보기
    if (searchResults.length === 1) {
        showCompanyDetails(searchResults[0]);
    }
}

/**
 * 고급 검색 실행 (성능 최적화)
 */
function performAdvancedSearch(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    
    // 캐시 확인
    const cacheKey = `${currentFilter}_${term}`;
    if (searchState.cache.has(cacheKey)) {
        console.log(`🚀 캐시에서 검색 결과 반환: "${searchTerm}"`);
        return searchState.cache.get(cacheKey);
    }
    
    console.log(`🔍 새로운 검색 실행: "${searchTerm}"`);
    const startTime = performance.now();
    
    const currentData = getFilteredData(currentFilter);
    console.log(`검색 대상 데이터: ${currentData.length}개`);
    
    let searchResults;
    
    // 개선된 검색 로직
    searchResults = performEnhancedSearch(currentData, term);
    
    // 검색 결과 정확도별 정렬
    searchResults = sortSearchResultsByRelevance(searchResults, term);
    
    // 정렬 상태가 있으면 적용
    if (sortState.column) {
        console.log(`검색 결과에 정렬 적용: ${sortState.column} (${sortState.order})`);
        searchResults = performSort(searchResults, sortState.column, sortState.order);
    }
    
    // 결과 캐싱 (최대 50개 캐시)
    if (searchState.cache.size >= 50) {
        const firstKey = searchState.cache.keys().next().value;
        searchState.cache.delete(firstKey);
    }
    searchState.cache.set(cacheKey, searchResults);
    
    // 검색 결과 저장
    searchState.lastResults = searchResults;
    
    const endTime = performance.now();
    console.log(`✅ 검색 완료: ${searchResults.length}개 결과 (${(endTime - startTime).toFixed(2)}ms)`);
    
    return searchResults;
}

/**
 * 개선된 검색 실행
 */
function performEnhancedSearch(currentData, term) {
    const term = searchTerm.toLowerCase();
    
    // 캐시 확인
    const cacheKey = `${currentFilter}_${term}`;
    if (searchState.cache.has(cacheKey)) {
        console.log(`🚀 캐시에서 검색 결과 반환: "${searchTerm}"`);
        return searchState.cache.get(cacheKey);
    }
    
    console.log(`🔍 새로운 검색 실행: "${searchTerm}"`);
    const startTime = performance.now();
    
    const currentData = getFilteredData(currentFilter);
    console.log(`검색 대상 데이터: ${currentData.length}개`);
    
    let searchResults;
    
    // 인덱스 기반 검색 (성능 최적화)
    if (searchState.index && term.length >= 2) {
        searchResults = performIndexedSearch(currentData, term);
    } else {
        // 폴백: 기본 필터 검색
        searchResults = performBasicSearch(currentData, term);
    }
    
    // 검색 결과 정확도별 정렬
    searchResults = sortSearchResultsByRelevance(searchResults, term);
    
    // 정렬 상태가 있으면 적용
    if (sortState.column) {
        console.log(`검색 결과에 정렬 적용: ${sortState.column} (${sortState.order})`);
        searchResults = performSort(searchResults, sortState.column, sortState.order);
    }
    
    // 결과 캐싱 (최대 50개 캐시)
    if (searchState.cache.size >= 50) {
        const firstKey = searchState.cache.keys().next().value;
        searchState.cache.delete(firstKey);
    }
    searchState.cache.set(cacheKey, searchResults);
    
    // 검색 결과 저장
    searchState.lastResults = searchResults;
    
    const endTime = performance.now();
    console.log(`✅ 검색 완료: ${searchResults.length}개 결과 (${(endTime - startTime).toFixed(2)}ms)`);
    
    return searchResults;
}

/**
 * 인덱스 기반 고속 검색
 */
function performIndexedSearch(currentData, term) {
    const matchingIndices = new Set();
    
    // 인덱스에서 일치하는 항목 찾기
    for (const [key, indices] of searchState.index.entries()) {
        if (key.includes(term)) {
            indices.forEach(idx => matchingIndices.add(idx));
        }
    }
    
    // 현재 필터된 데이터에서 일치하는 항목만 반환
    const results = [];
    currentData.forEach((company, dataIdx) => {
        const originalIdx = allData.indexOf(company);
        if (matchingIndices.has(originalIdx)) {
            results.push(company);
        }
    });
    
    return results;
}

/**
 * 기본 검색 (폴백)
 */
function performBasicSearch(currentData, term) {
    return currentData.filter(company => {
        // 1. 티커 검색 (정확도 높음)
        if (company.Ticker?.toLowerCase().includes(term)) {
            return true;
        }
        
        // 2. 회사명 검색 (정확도 높음)
        if (company.corpName?.toLowerCase().includes(term)) {
            return true;
        }
        
        // 3. 업종 검색
        if (company.industry?.toLowerCase().includes(term)) {
            return true;
        }
        
        // 4. 거래소 검색
        if (company.Exchange?.toLowerCase().includes(term)) {
            return true;
        }
        
        // 5. 검색 인덱스 (최적화된 검색)
        if (company.searchIndex?.includes(term)) {
            return true;
        }
        
        return false;
    });
}

/**
 * 검색 결과를 정확도별로 정렬
 */
function sortSearchResultsByRelevance(results, searchTerm) {
    return results.sort((a, b) => {
        const aScore = calculateRelevanceScore(a, searchTerm);
        const bScore = calculateRelevanceScore(b, searchTerm);
        return bScore - aScore; // 높은 점수가 먼저
    });
}

/**
 * 검색 정확도 점수 계산
 */
function calculateRelevanceScore(company, searchTerm) {
    let score = 0;
    const term = searchTerm.toLowerCase();
    
    // 티커 정확 일치 (최고 점수)
    if (company.Ticker?.toLowerCase() === term) {
        score += 100;
    } else if (company.Ticker?.toLowerCase().startsWith(term)) {
        score += 80;
    } else if (company.Ticker?.toLowerCase().includes(term)) {
        score += 60;
    }
    
    // 회사명 정확 일치
    if (company.corpName?.toLowerCase() === term) {
        score += 90;
    } else if (company.corpName?.toLowerCase().startsWith(term)) {
        score += 70;
    } else if (company.corpName?.toLowerCase().includes(term)) {
        score += 50;
    }
    
    // 업종 일치
    if (company.industry?.toLowerCase().includes(term)) {
        score += 30;
    }
    
    // 거래소 일치
    if (company.Exchange?.toLowerCase().includes(term)) {
        score += 20;
    }
    
    return score;
}

/**
 * 검색 결과 표시
 */
function displaySearchResults(results, searchTerm) {
    updateFilterStatus(`검색 결과: "${searchTerm}" (${results.length.toLocaleString()}개)`);
    renderTable(results);
    
    // 검색 결과 하이라이팅 적용
    highlightSearchResults(searchTerm);
}

/**
 * 검색 결과 하이라이팅
 */
function highlightSearchResults(searchTerm) {
    if (!searchTerm) return;
    
    const tableContainer = document.getElementById('results-table');
    if (!tableContainer) return;
    
    const term = searchTerm.toLowerCase();
    const cells = tableContainer.querySelectorAll('td');
    
    cells.forEach(cell => {
        const text = cell.textContent;
        if (text && text.toLowerCase().includes(term)) {
            const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
            const highlightedText = text.replace(regex, '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
            cell.innerHTML = highlightedText;
        }
    });
}

/**
 * 정규식 특수문자 이스케이프
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
}

/**
 * 검색 기록 추가
 */
function addToSearchHistory(searchTerm) {
    if (!searchTerm || searchState.searchHistory.includes(searchTerm)) {
        return;
    }
    
    searchState.searchHistory.unshift(searchTerm);
    
    // 최대 10개까지만 보관
    if (searchState.searchHistory.length > 10) {
        searchState.searchHistory = searchState.searchHistory.slice(0, 10);
    }
    
    console.log('검색 기록 업데이트:', searchState.searchHistory);
}

/**
 * 검색 자동완성 제안
 */
function generateSearchSuggestions(partialTerm) {
    if (!partialTerm || partialTerm.length < 2) {
        return [];
    }
    
    const currentData = getFilteredData(currentFilter);
    const term = partialTerm.toLowerCase();
    const suggestions = new Set();
    
    // 티커 제안
    currentData.forEach(company => {
        if (company.Ticker?.toLowerCase().startsWith(term)) {
            suggestions.add(company.Ticker);
        }
        
        // 회사명 제안 (첫 단어가 일치하는 경우)
        if (company.corpName?.toLowerCase().startsWith(term)) {
            suggestions.add(company.corpName);
        }
    });
    
    // 최대 5개 제안
    return Array.from(suggestions).slice(0, 5);
}

/**
 * 검색 초기화
 */
function clearSearch() {
    console.log('검색 초기화');
    
    searchState.currentTerm = '';
    searchState.lastResults = [];
    
    // 검색창 초기화
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // 필터 상태로 복원
    applyFilters(currentFilter);
}

/**
 * 검색 자동완성 표시
 */
function showSearchSuggestions(searchTerm) {
    const suggestionsContainer = document.getElementById('search-suggestions');
    if (!suggestionsContainer) return;
    
    const suggestions = generateSearchSuggestions(searchTerm);
    
    if (suggestions.length === 0) {
        hideSearchSuggestions();
        return;
    }
    
    let suggestionsHTML = '';
    suggestions.forEach(suggestion => {
        suggestionsHTML += `
            <div class="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0" 
                 onclick="selectSearchSuggestion('${suggestion}')">
                <div class="flex items-center gap-2">
                    <i class="fas fa-search text-gray-400 text-sm"></i>
                    <span class="text-sm">${suggestion}</span>
                </div>
            </div>
        `;
    });
    
    // 검색 기록도 표시 (최근 3개)
    if (searchState.searchHistory.length > 0) {
        suggestionsHTML += '<div class="border-t border-gray-200 px-4 py-2 bg-gray-50 text-xs text-gray-600">최근 검색</div>';
        
        searchState.searchHistory.slice(0, 3).forEach(historyItem => {
            if (historyItem.toLowerCase().includes(searchTerm.toLowerCase())) {
                suggestionsHTML += `
                    <div class="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0" 
                         onclick="selectSearchSuggestion('${historyItem}')">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-history text-gray-400 text-sm"></i>
                            <span class="text-sm text-gray-600">${historyItem}</span>
                        </div>
                    </div>
                `;
            }
        });
    }
    
    suggestionsContainer.innerHTML = suggestionsHTML;
    suggestionsContainer.classList.remove('hidden');
}

/**
 * 자동완성 숨김
 */
function hideSearchSuggestions() {
    const suggestionsContainer = document.getElementById('search-suggestions');
    if (suggestionsContainer) {
        suggestionsContainer.classList.add('hidden');
    }
}

/**
 * 자동완성 항목 선택
 */
function selectSearchSuggestion(suggestion) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = suggestion;
        handleSearch();
        hideSearchSuggestions();
        
        // 초기화 버튼 표시
        const clearSearchButton = document.getElementById('clear-search');
        if (clearSearchButton) {
            clearSearchButton.classList.remove('hidden');
        }
    }
}

/**
 * 검색 통계 정보
 */
function getSearchStats() {
    return {
        currentTerm: searchState.currentTerm,
        resultCount: searchState.lastResults.length,
        historyCount: searchState.searchHistory.length,
        isActive: !!searchState.currentTerm,
        suggestions: searchState.suggestions.length
    };
}

/**
 * 검색 상태 정보
 */
function getSearchState() {
    return {
        ...searchState,
        isSearching: !!searchState.currentTerm,
        hasResults: searchState.lastResults.length > 0
    };
}

/**
 * 기업 상세 정보 표시
 */
function showCompanyDetails(company) {
    console.log('Showing details for:', company.Ticker);
    
    const existingPanel = document.getElementById('company-details');
    if (existingPanel) {
        existingPanel.remove();
    }
    
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
    `;
    
    const tableContainer = document.getElementById('results-table');
    if (tableContainer && tableContainer.nextSibling) {
        tableContainer.parentNode.insertBefore(detailsPanel, tableContainer.nextSibling);
    } else if (tableContainer) {
        tableContainer.parentNode.appendChild(detailsPanel);
    }
}

/**
 * 상세 지표 생성
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
 * 상세 패널 숨기기
 */
function hideCompanyDetails() {
    const detailsPanel = document.getElementById('company-details');
    if (detailsPanel) {
        detailsPanel.remove();
    }
}

/**
 * 필터 적용 (정렬 상태 유지)
 */
function applyFilters(filterType) {
    console.log(`Applying filter: ${filterType}`);
    
    currentFilter = filterType;
    paginationManager.currentPage = 1; // 페이지 리셋
    
    try {
        let filteredData = getFilteredData(filterType);
        
        // 정렬 상태가 있으면 정렬 적용
        if (sortState.column) {
            console.log(`필터 적용 후 정렬 유지: ${sortState.column} (${sortState.order})`);
            filteredData = performSort(filteredData, sortState.column, sortState.order);
        }
        
        updateButtonStyles();
        updateFilterStatus();
        renderTable(filteredData);
        
        console.log(`Filter applied: ${filteredData.length} companies shown`);
        
    } catch (error) {
        console.error('Error applying filters:', error);
        updateFilterStatus(ERROR_MESSAGES.FILTER_ERROR);
        renderTable(allData);
    }
}

/**
 * 필터링된 데이터 가져오기
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
 * 버튼 스타일 업데이트
 */
function updateButtonStyles() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.className = 'filter-btn px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors duration-200';
    });
    
    const activeButton = document.getElementById(`filter-${currentFilter}`);
    if (activeButton) {
        activeButton.className = 'filter-btn px-4 py-2 rounded-lg border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors duration-200';
    }
}

/**
 * 필터 상태 업데이트
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
 * 테이블 렌더링 (31개 지표 지원 + 페이징)
 */
function renderTable(data) {
    console.log(`Rendering table with ${data.length} companies`);
    
    // 카드 뷰 모드인 경우 카드 뷰로 렌더링
    if (window.cardViewManager && window.cardViewManager.getCurrentView() === 'card') {
        window.cardViewManager.renderCardView(data);
        return;
    }
    
    const tableContainer = document.getElementById('results-table');
    if (!tableContainer) {
        console.error('Table container not found');
        return;
    }
    
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
        renderPaginationControls(null);
        return;
    }
    
    // 정렬이 적용된 전체 데이터를 페이징에 전달
    let sortedData = data;
    if (sortState.column) {
        console.log(`🔄 테이블 렌더링 시 정렬 적용: ${sortState.column} (${sortState.order})`);
        sortedData = performSortWithEmptyDataHandling(data, sortState.column, sortState.order);
    }
    
    // 정렬된 데이터를 페이징 적용
    const pageResult = paginationManager.setData(sortedData);
    const pageData = pageResult.data;
    const pagination = pageResult.pagination;
    
    const table = document.createElement('table');
    table.className = 'w-full border-collapse bg-white shadow-sm rounded-lg overflow-hidden';
    
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50';
    
    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-gray-200';
    
    // 표시할 컬럼 가져오기
    const columns = getDisplayColumns();
    
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
            sortIcon.className = 'sort-icon text-xs ml-1';
            
            // 현재 정렬 상태에 따른 아이콘 표시
            if (sortState.column === col.key) {
                sortIcon.textContent = sortState.order === 'asc' ? '▲' : '▼';
                sortIcon.className += ' text-blue-600 font-bold';
                th.className += ' bg-blue-50'; // 정렬된 컬럼 하이라이트
                console.log(`정렬 상태 표시: ${col.key} (${sortState.order})`);
            } else {
                sortIcon.textContent = '⇅';
                sortIcon.className += ' text-gray-400';
            }
            
            headerContent.appendChild(sortIcon);
            
            // 정렬 클릭 이벤트 (개선된 버전)
            th.addEventListener('click', (e) => {
                e.preventDefault();
                console.log(`헤더 클릭: ${col.key}`);
                
                // 시각적 피드백
                th.style.backgroundColor = '#e0f2fe';
                setTimeout(() => {
                    th.style.backgroundColor = '';
                }, 150);
                
                // 정렬 실행
                sortTable(col.key);
            });
            
            // 호버 효과 강화
            th.addEventListener('mouseenter', () => {
                if (sortState.column !== col.key) {
                    th.style.backgroundColor = '#f8fafc';
                }
            });
            
            th.addEventListener('mouseleave', () => {
                if (sortState.column !== col.key) {
                    th.style.backgroundColor = '';
                }
            });
        }
        
        th.appendChild(headerContent);
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    
    // 데이터 행 생성 (페이징된 데이터 사용)
    pageData.forEach((company, index) => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 cursor-pointer';
        
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
        
        // 행 클릭 시 상세 분석 모달 표시
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
            showCompanyAnalysisModal(company);
        });
        
        tbody.appendChild(row);
    });
    
    table.appendChild(thead);
    table.appendChild(tbody);
    tableContainer.appendChild(table);
    
    // 페이징 정보로 결과 수 업데이트
    updateResultsCount(pagination.totalItems, pagination);
    
    // 페이징 컨트롤 렌더링
    renderPaginationControls(pagination);
    
    // ScrollManager 테이블 렌더링 완료 알림
    if (window.scrollManager) {
        window.scrollManager.onTableRendered();
    }
}

/**
 * 표시할 컬럼 설정 가져오기 (31개 지표 활용)
 */
function getDisplayColumns() {
    const viewMode = document.getElementById('view-mode')?.value || 'basic';
    
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
        comprehensive: [
            { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600 min-w-16', sortable: true },
            { key: 'corpName', label: '회사명', className: 'font-medium min-w-32', sortable: true },
            { key: 'Exchange', label: '거래소', className: 'text-gray-600 min-w-16', sortable: true },
            { key: 'industry', label: '업종', className: 'text-gray-700 min-w-20', sortable: true },
            { key: '현재가', label: '현재가', formatter: formatNumber, className: 'text-right font-mono min-w-18', sortable: true },
            { key: '(USD mn)', label: '시총(M$)', formatter: formatMarketCap, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'PER (Oct-25)', label: 'PER', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PBR (Oct-25)', label: 'PBR', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PEG (Oct-25)', label: 'PEG', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'ROE (Fwd)', label: 'ROE예상', formatter: formatPercentage, className: 'text-right font-mono min-w-18', sortable: true },
            { key: 'OPM (Fwd)', label: '영업이익률', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'Sales (3)', label: '매출성장3Y', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'Return (Y)', label: '연간수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'DY (FY+1)', label: '배당수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: '12 M', label: '12개월수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-22', sortable: true }
        ],
        all: [
            // 기본 정보 (고정 컬럼)
            { key: 'Ticker', label: '티커', className: 'font-mono font-bold text-blue-600 sticky left-0 bg-white z-30 min-w-16 shadow-sm', sortable: true },
            { key: 'corpName', label: '회사명', className: 'font-medium sticky left-16 bg-white z-30 min-w-32 shadow-sm', sortable: true },
            { key: 'Exchange', label: '거래소', className: 'text-gray-600 min-w-20', sortable: true },
            { key: 'industry', label: '업종', className: 'text-gray-700 min-w-24', sortable: true },
            { key: '설립', label: '설립', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'FY 0', label: '회계', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            
            // 가격 정보
            { key: '현재가', label: '현재가', formatter: formatNumber, className: 'text-right font-mono min-w-20', sortable: true },
            { key: '전일대비', label: '전일%', formatter: formatPercentage, className: 'text-right font-mono min-w-16', sortable: true },
            { key: '전주대비', label: '전주%', formatter: formatPercentage, className: 'text-right font-mono min-w-16', sortable: true },
            { key: '(USD mn)', label: '시총(M$)', formatter: formatMarketCap, className: 'text-right font-mono min-w-20', sortable: true },
            
            // 밸류에이션
            { key: 'PER (Oct-25)', label: 'PER', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PBR (Oct-25)', label: 'PBR', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PEG (Oct-25)', label: 'PEG', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: '% PER (Avg)', label: 'PER평균%', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'PER (3)', label: 'PER3Y', formatter: formatNumber, className: 'text-right font-mono min-w-16', sortable: true },
            { key: 'PER (5)', label: 'PER(5Y)', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
            { key: 'PER (10)', label: 'PER(10Y)', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
            { key: 'PER (Avg)', label: 'PER평균', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
            { key: 'Price (10)', label: '10년평균가격($)', formatter: formatNumber, className: 'text-right font-mono', sortable: true },
            
            // 수익성
            { key: 'ROE (Fwd)', label: 'ROE예상(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
            { key: 'OPM (Fwd)', label: '영업이익률예상(%)', formatter: formatPercentage, className: 'text-right font-mono', sortable: true },
            { key: 'Sales (3)', label: '매출성장3Y', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'CCC (FY 0)', label: '현금전환', formatter: formatNumber, className: 'text-right font-mono min-w-18', sortable: true },
            
            // 배당
            { key: 'DY (FY+1)', label: '배당수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            
            // 수익률
            { key: 'Return (Y)', label: '연간수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: 'W', label: '주간수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-20', sortable: true },
            { key: '1 M', label: '1개월수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-22', sortable: true },
            { key: '3 M', label: '3개월수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-22', sortable: true },
            { key: '6 M', label: '6개월수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-22', sortable: true },
            { key: 'YTD', label: '연초대비', formatter: formatPercentage, className: 'text-right font-mono min-w-18', sortable: true },
            { key: '12 M', label: '12개월수익률', formatter: formatPercentage, className: 'text-right font-mono min-w-22', sortable: true }
        ]
    };
    
    return columnConfigs[viewMode] || columnConfigs.basic;
}

/**
 * 강화된 정렬 시스템
 */

// sortState는 파일 상단에서 이미 선언됨 (중복 제거)

/**
 * 정렬 처리 (완전히 새로운 구현)
 */
function sortTable(column) {
    console.log(`🔄 Sorting by ${column}`);
    
    // 정렬 상태 업데이트
    if (sortState.column === column) {
        sortState.order = sortState.order === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.column = column;
        sortState.order = 'asc';
    }
    
    console.log(`정렬 상태: ${column} (${sortState.order})`);
    
    // 현재 필터된 데이터 가져오기
    const filteredData = getFilteredData(currentFilter);
    console.log(`정렬할 데이터 수: ${filteredData.length}`);
    
    // 정렬 실행
    const sortedData = performSort(filteredData, column, sortState.order);
    console.log(`정렬 완료: ${sortedData.length}개 항목`);
    
    // 정렬된 데이터 저장
    sortState.lastSortedData = sortedData;
    
    // 테이블 다시 렌더링
    renderTable(sortedData);
    
    console.log(`✅ 정렬 완료: ${column} (${sortState.order})`);
}

/**
 * 실제 정렬 수행 (타입별 최적화)
 */
function performSort(data, column, order) {
    if (!data || data.length === 0) {
        console.warn('정렬할 데이터가 없습니다.');
        return [];
    }
    
    console.log(`정렬 실행: ${column}, ${order}, ${data.length}개 항목`);
    
    // 데이터 복사 (원본 보호)
    const dataToSort = [...data];
    
    // 컬럼 타입 분석
    const columnType = analyzeColumnType(dataToSort, column);
    console.log(`컬럼 타입 분석: ${column} -> ${columnType}`);
    
    // 타입별 정렬
    const sortedData = dataToSort.sort((a, b) => {
        return compareValues(a[column], b[column], columnType, order);
    });
    
    // 정렬 결과 검증
    console.log(`정렬 결과 샘플:`, sortedData.slice(0, 3).map(item => ({
        ticker: item.Ticker,
        value: item[column]
    })));
    
    return sortedData;
}

/**
 * 컬럼 데이터 타입 분석
 */
function analyzeColumnType(data, column) {
    const sampleSize = Math.min(10, data.length);
    let numericCount = 0;
    let stringCount = 0;
    
    for (let i = 0; i < sampleSize; i++) {
        const value = data[i][column];
        
        if (value === null || value === undefined || value === '') {
            continue;
        }
        
        if (typeof value === 'number' || (!isNaN(parseFloat(value)) && isFinite(value))) {
            numericCount++;
        } else {
            stringCount++;
        }
    }
    
    // 숫자가 더 많으면 numeric, 아니면 string
    return numericCount > stringCount ? 'numeric' : 'string';
}

/**
 * 값 비교 (타입별 최적화)
 */
function compareValues(aVal, bVal, columnType, order) {
    // null/undefined 처리
    const aIsEmpty = aVal === null || aVal === undefined || aVal === '';
    const bIsEmpty = bVal === null || bVal === undefined || bVal === '';
    
    if (aIsEmpty && bIsEmpty) return 0;
    if (aIsEmpty) return order === 'asc' ? 1 : -1;  // 빈 값을 뒤로
    if (bIsEmpty) return order === 'asc' ? -1 : 1;
    
    let result = 0;
    
    if (columnType === 'numeric') {
        // 숫자 비교
        const numA = parseFloat(aVal);
        const numB = parseFloat(bVal);
        
        if (!isNaN(numA) && !isNaN(numB)) {
            result = numA - numB;
        } else {
            // 숫자로 변환 실패 시 문자열 비교
            result = String(aVal).localeCompare(String(bVal));
        }
    } else {
        // 문자열 비교
        result = String(aVal).localeCompare(String(bVal));
    }
    
    // 정렬 순서 적용
    return order === 'asc' ? result : -result;
}

/**
 * 정렬 상태 초기화
 */
function resetSort() {
    sortState = {
        column: null,
        order: 'asc',
        lastSortedData: null
    };
    console.log('정렬 상태 초기화됨');
}

/**
 * 현재 정렬 상태 가져오기
 */
function getCurrentSortState() {
    return { ...sortState };
}

/**
 * 결과 수 업데이트 (페이징 정보 포함)
 */
function updateResultsCount(totalCount, pagination = null) {
    const resultsCountElement = document.getElementById('results-count');
    if (resultsCountElement) {
        if (pagination) {
            resultsCountElement.innerHTML = `
                <span class="text-gray-700">
                    총 <strong class="text-blue-600">${totalCount.toLocaleString()}</strong>개 기업 
                    (${pagination.startIndex}-${pagination.endIndex} 표시)
                </span>
            `;
        } else {
            resultsCountElement.innerHTML = `
                <span class="text-gray-700">
                    총 <strong class="text-blue-600">${totalCount.toLocaleString()}</strong>개 기업
                </span>
            `;
        }
    }
}

/**
 * 페이징 컨트롤 렌더링
 */
function renderPaginationControls(pagination) {
    const paginationContainer = document.getElementById('pagination-controls');
    if (!paginationContainer) return;
    
    if (!pagination || pagination.totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    const { currentPage, totalPages, hasNext, hasPrev } = pagination;
    
    // 페이지 번호 버튼 생성
    const maxVisiblePages = 5;
    const halfVisible = Math.floor(maxVisiblePages / 2);
    
    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    let paginationHTML = `
        <div class="flex items-center gap-2">
            <!-- 페이지 크기 선택 -->
            <div class="flex items-center gap-2">
                <span class="text-sm text-gray-600">페이지당:</span>
                <select id="page-size-select" class="px-2 py-1 border border-gray-300 rounded text-sm">
                    <option value="25" ${paginationManager.pageSize === 25 ? 'selected' : ''}>25</option>
                    <option value="50" ${paginationManager.pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${paginationManager.pageSize === 100 ? 'selected' : ''}>100</option>
                    <option value="200" ${paginationManager.pageSize === 200 ? 'selected' : ''}>200</option>
                </select>
            </div>
        </div>
        
        <div class="flex items-center gap-1">
            <!-- 첫 페이지 -->
            <button onclick="goToFirstPage()" 
                    class="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 ${!hasPrev ? 'opacity-50 cursor-not-allowed' : ''}"
                    ${!hasPrev ? 'disabled' : ''}>
                ⟪
            </button>
            
            <!-- 이전 페이지 -->
            <button onclick="goToPrevPage()" 
                    class="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 ${!hasPrev ? 'opacity-50 cursor-not-allowed' : ''}"
                    ${!hasPrev ? 'disabled' : ''}>
                ⟨
            </button>
            
            <!-- 페이지 번호들 -->
    `;
    
    for (let i = startPage; i <= endPage; i++) {
        const isCurrentPage = i === currentPage;
        paginationHTML += `
            <button onclick="goToSpecificPage(${i})" 
                    class="px-3 py-1 text-sm border rounded ${
                        isCurrentPage 
                            ? 'bg-blue-500 text-white border-blue-500' 
                            : 'border-gray-300 hover:bg-gray-50'
                    }">
                ${i}
            </button>
        `;
    }
    
    paginationHTML += `
            <!-- 다음 페이지 -->
            <button onclick="goToNextPage()" 
                    class="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 ${!hasNext ? 'opacity-50 cursor-not-allowed' : ''}"
                    ${!hasNext ? 'disabled' : ''}>
                ⟩
            </button>
            
            <!-- 마지막 페이지 -->
            <button onclick="goToLastPage()" 
                    class="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 ${!hasNext ? 'opacity-50 cursor-not-allowed' : ''}"
                    ${!hasNext ? 'disabled' : ''}>
                ⟫
            </button>
            
            <!-- 페이지 정보 -->
            <span class="ml-2 text-sm text-gray-600">
                ${currentPage} / ${totalPages}
            </span>
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
    
    // 페이지 크기 변경 이벤트
    const pageSizeSelect = document.getElementById('page-size-select');
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
            changePageSize(parseInt(e.target.value));
        });
    }
}

/**
 * 값 포맷팅
 */
function formatValue(value, column) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }
    
    if (column === '(USD mn)') {
        return formatMarketCap(value);
    }
    
    if (column.includes('(%)') || column.includes('Growth') || column.includes('Return') || 
        column.includes('Yield') || column.includes('ROE') || column.includes('OPM')) {
        return formatPercentage(value);
    }
    
    if (typeof value === 'number') {
        return formatNumber(value);
    }
    
    return String(value);
}

function formatMarketCap(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    
    const num = parseFloat(value);
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}B`;
    } else {
        return `${num.toFixed(0)}M`;
    }
}

function formatPercentage(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    
    const num = parseFloat(value);
    return `${num.toFixed(1)}%`;
}

function formatNumber(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    
    const num = parseFloat(value);
    return num.toFixed(2);
}

/**
 * 페이징 네비게이션 함수들
 */
function goToFirstPage() {
    const result = paginationManager.goToPage(1);
    if (result) {
        renderTableWithCurrentData();
    }
}

function goToPrevPage() {
    const result = paginationManager.prevPage();
    if (result) {
        renderTableWithCurrentData();
    }
}

function goToNextPage() {
    const result = paginationManager.nextPage();
    if (result) {
        renderTableWithCurrentData();
    }
}

function goToLastPage() {
    const result = paginationManager.goToPage(paginationManager.totalPages);
    if (result) {
        renderTableWithCurrentData();
    }
}

function goToSpecificPage(pageNumber) {
    const result = paginationManager.goToPage(pageNumber);
    if (result) {
        renderTableWithCurrentData();
    }
}

function changePageSize(newSize) {
    const result = paginationManager.setPageSize(newSize);
    if (result) {
        renderTableWithCurrentData();
    }
}

/**
 * 현재 데이터로 테이블 다시 렌더링 (정렬 상태 유지)
 */
function renderTableWithCurrentData() {
    let currentData = getFilteredData(currentFilter);
    
    // 정렬 상태가 있으면 정렬 적용
    if (sortState.column && sortState.lastSortedData) {
        console.log(`정렬 상태 유지: ${sortState.column} (${sortState.order})`);
        currentData = performSort(currentData, sortState.column, sortState.order);
    }
    
    renderTable(currentData);
}

/**
 * 필터 리셋 (정렬도 함께 리셋)
 */
function resetFilter() {
    console.log('Resetting filter and sort to show all data');
    currentFilter = 'all';
    paginationManager.currentPage = 1; // 페이지도 리셋
    resetSort(); // 정렬도 리셋
    
    // 검색창도 초기화
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
    }
    
    updateButtonStyles();
    updateFilterStatus();
    renderTable(allData);
}

/**
 * 정렬만 리셋 (필터는 유지)
 */
function resetSortOnly() {
    console.log('Resetting sort only');
    resetSort();
    renderTableWithCurrentData();
}
/*
*
 * Chart.js 기반 시각화 시스템
 */
let chartInstances = {}; // 차트 인스턴스 관리
let compareList = []; // 비교 목록

/**
 * 개별 기업 상세 분석 모달 표시
 */
function showCompanyAnalysisModal(companyData) {
    console.log('🔍 기업 상세 분석 모달 표시:', companyData.Ticker);
    
    const modal = document.getElementById('company-analysis-modal');
    const title = document.getElementById('modal-company-title');
    const subtitle = document.getElementById('modal-company-subtitle');
    
    // 모달 제목 설정
    title.textContent = `${companyData.Ticker} - ${companyData.corpName}`;
    subtitle.textContent = `${companyData.industry} | ${companyData.Exchange} | 시가총액: $${formatMarketCap(companyData['(USD mn)'])}`;
    
    // 핵심 지표 카드 업데이트
    updateModalSummaryCards(companyData);
    
    // ChartManager를 사용한 차트 생성
    if (window.chartManager) {
        setTimeout(() => {
            try {
                window.chartManager.createRadarChart('radar-chart', companyData);
                window.chartManager.createComparisonChart('comparison-bar-chart', companyData);
            } catch (error) {
                console.warn('차트 생성 중 오류:', error);
                // 차트 생성 실패 시 기본 메시지 표시
                const radarCanvas = document.getElementById('radar-chart');
                const comparisonCanvas = document.getElementById('comparison-bar-chart');
                
                if (radarCanvas) {
                    const ctx = radarCanvas.getContext('2d');
                    ctx.fillStyle = '#f3f4f6';
                    ctx.fillRect(0, 0, radarCanvas.width, radarCanvas.height);
                    ctx.fillStyle = '#6b7280';
                    ctx.font = '16px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('차트 로딩 중...', radarCanvas.width/2, radarCanvas.height/2);
                }
                
                if (comparisonCanvas) {
                    const ctx = comparisonCanvas.getContext('2d');
                    ctx.fillStyle = '#f3f4f6';
                    ctx.fillRect(0, 0, comparisonCanvas.width, comparisonCanvas.height);
                    ctx.fillStyle = '#6b7280';
                    ctx.font = '16px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('차트 로딩 중...', comparisonCanvas.width/2, comparisonCanvas.height/2);
                }
            }
        }, 200); // 모달이 완전히 표시된 후 차트 생성
    }
    
    // 상세 지표 테이블 생성
    createEnhancedDetailTable(companyData);
    
    // 모달 표시
    modal.classList.add('active');
}

/**
 * 레이더 차트 생성 (7개 핵심 지표)
 */
function createRadarChart(companyData) {
    const canvas = document.getElementById('radar-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // 기존 차트 제거
    if (chartInstances.radar) {
        chartInstances.radar.destroy();
    }
    
    // 핵심 지표 데이터 준비
    const radarData = {
        labels: [
            'PER (현재)',
            'PBR (현재)', 
            'ROE 예상(%)',
            '영업이익률 예상(%)',
            '매출성장률 3Y(%)',
            '연간수익률(%)',
            '배당수익률(%)'
        ],
        datasets: [{
            label: companyData.Ticker,
            data: [
                normalizeValue(companyData['PER (Oct-25)'], 0, 50, true), // PER (역방향)
                normalizeValue(companyData['PBR (Oct-25)'], 0, 10, true), // PBR (역방향)
                normalizeValue(companyData['ROE (Fwd)'], 0, 30), // ROE
                normalizeValue(companyData['OPM (Fwd)'], 0, 50), // 영업이익률
                normalizeValue(companyData['Sales (3)'], -10, 30), // 매출성장률
                normalizeValue(companyData['Return (Y)'], -50, 100), // 연간수익률
                normalizeValue(companyData['DY (FY+1)'], 0, 10) // 배당수익률
            ],
            backgroundColor: 'rgba(30, 64, 175, 0.2)',
            borderColor: 'rgba(30, 64, 175, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(30, 64, 175, 1)',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(30, 64, 175, 1)'
        }]
    };
    
    chartInstances.radar = new Chart(ctx, {
        type: 'radar',
        data: radarData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        stepSize: 20
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const originalValue = getOriginalValue(context.dataIndex, companyData);
                            return originalValue;
                        }
                    }
                }
            }
        }
    });
}

/**
 * 업종 평균 비교 바 차트 생성
 */
function createComparisonBarChart(companyData) {
    const canvas = document.getElementById('comparison-bar-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // 기존 차트 제거
    if (chartInstances.comparison) {
        chartInstances.comparison.destroy();
    }
    
    // 업종 평균 데이터 (실제로는 전체 데이터에서 계산해야 함)
    const industryAverages = getIndustryAverages(companyData.industry);
    
    const comparisonData = {
        labels: ['PER', 'PBR', 'ROE(%)', '영업이익률(%)', '매출성장률(%)'],
        datasets: [
            {
                label: '업종 평균',
                data: [
                    industryAverages.per || 20,
                    industryAverages.pbr || 3,
                    industryAverages.roe || 15,
                    industryAverages.opm || 20,
                    industryAverages.sales || 10
                ],
                backgroundColor: 'rgba(156, 163, 175, 0.6)',
                borderColor: 'rgba(156, 163, 175, 1)',
                borderWidth: 1
            },
            {
                label: companyData.Ticker,
                data: [
                    parseFloat(companyData['PER (Oct-25)']) || 0,
                    parseFloat(companyData['PBR (Oct-25)']) || 0,
                    parseFloat(companyData['ROE (Fwd)']) || 0,
                    parseFloat(companyData['OPM (Fwd)']) || 0,
                    parseFloat(companyData['Sales (3)']) || 0
                ],
                backgroundColor: 'rgba(30, 64, 175, 0.6)',
                borderColor: 'rgba(30, 64, 175, 1)',
                borderWidth: 1
            }
        ]
    };
    
    chartInstances.comparison = new Chart(ctx, {
        type: 'bar',
        data: comparisonData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                }
            }
        }
    });
}

/**
 * 상세 지표 테이블 생성
 */
function createDetailTable(companyData) {
    const tbody = document.getElementById('modal-detail-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    // 32개 지표를 카테고리별로 분류
    const categories = {
        '기본 정보': {
            '거래소': companyData.Exchange,
            '업종': companyData.industry,
            '설립년도': companyData['설립'],
            '회계연도': companyData['FY 0']
        },
        '가격 및 변동': {
            '현재가($)': companyData['현재가'],
            '전일대비(%)': companyData['전일대비'],
            '전주대비(%)': companyData['전주대비']
        },
        '규모': {
            '시가총액(M$)': companyData['(USD mn)']
        },
        '밸류에이션': {
            'PER(현재)': companyData['PER (Oct-25)'],
            'PER평균대비(%)': companyData['% PER (Avg)'],
            'PBR(현재)': companyData['PBR (Oct-25)'],
            'PEG비율': companyData['PEG (Oct-25)'],
            'PER(3Y평균)': companyData['PER (3)'],
            'PER(5Y평균)': companyData['PER (5)'],
            'PER(10Y평균)': companyData['PER (10)']
        },
        '수익성': {
            'ROE예상(%)': companyData['ROE (Fwd)'],
            '영업이익률예상(%)': companyData['OPM (Fwd)'],
            '현금전환주기(일)': companyData['CCC (FY 0)']
        },
        '성장성': {
            '매출성장률3Y(%)': companyData['Sales (3)']
        },
        '수익률': {
            '연간수익률(%)': companyData['Return (Y)'],
            '배당수익률(%)': companyData['DY (FY+1)'],
            '주간수익률(%)': companyData['W'],
            '1개월수익률(%)': companyData['1 M'],
            '3개월수익률(%)': companyData['3 M'],
            '6개월수익률(%)': companyData['6 M'],
            '연초대비수익률(%)': companyData['YTD'],
            '12개월수익률(%)': companyData['12 M']
        }
    };
    
    Object.entries(categories).forEach(([category, metrics]) => {
        Object.entries(metrics).forEach(([metric, value]) => {
            const row = document.createElement('tr');
            row.className = 'border-b hover:bg-gray-50';
            
            const evaluation = getMetricEvaluation(metric, value);
            
            row.innerHTML = `
                <td class="px-4 py-2 font-medium text-gray-600">${category}</td>
                <td class="px-4 py-2">${metric}</td>
                <td class="px-4 py-2 text-right font-mono">${formatMetricValue(metric, value)}</td>
                <td class="px-4 py-2 text-right font-mono text-gray-500">-</td>
                <td class="px-4 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs font-medium ${evaluation.class}">
                        ${evaluation.text}
                    </span>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    });
}

/**
 * 헬퍼 함수들
 */
function normalizeValue(value, min, max, reverse = false) {
    if (value === null || value === undefined || value === '') return 0;
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return 0;
    
    let normalized = ((numValue - min) / (max - min)) * 100;
    normalized = Math.max(0, Math.min(100, normalized));
    
    return reverse ? 100 - normalized : normalized;
}

function getOriginalValue(dataIndex, companyData) {
    const metrics = [
        companyData['PER (Oct-25)'],
        companyData['PBR (Oct-25)'],
        companyData['ROE (Fwd)'],
        companyData['OPM (Fwd)'],
        companyData['Sales (3)'],
        companyData['Return (Y)'],
        companyData['DY (FY+1)']
    ];
    
    const labels = ['PER', 'PBR', 'ROE(%)', '영업이익률(%)', '매출성장률(%)', '연간수익률(%)', '배당수익률(%)'];
    
    return `${labels[dataIndex]}: ${formatNumber(metrics[dataIndex])}`;
}

function getIndustryAverages(industry) {
    // 실제로는 전체 데이터에서 업종별 평균을 계산해야 함
    const averages = {
        'Technology': { per: 25, pbr: 4, roe: 18, opm: 25, sales: 15 },
        'Healthcare': { per: 22, pbr: 3.5, roe: 16, opm: 22, sales: 12 },
        'Financial': { per: 12, pbr: 1.2, roe: 12, opm: 30, sales: 8 },
        'default': { per: 20, pbr: 3, roe: 15, opm: 20, sales: 10 }
    };
    
    return averages[industry] || averages.default;
}

function getMetricEvaluation(metric, value) {
    const numValue = parseFloat(value);
    
    if (isNaN(numValue)) {
        return { class: 'bg-gray-100 text-gray-600', text: 'N/A' };
    }
    
    // 지표별 평가 기준 (간단한 예시)
    if (metric.includes('PER')) {
        if (numValue < 15) return { class: 'bg-green-100 text-green-800', text: '양호' };
        if (numValue < 25) return { class: 'bg-yellow-100 text-yellow-800', text: '보통' };
        return { class: 'bg-red-100 text-red-800', text: '높음' };
    }
    
    if (metric.includes('ROE') || metric.includes('수익률')) {
        if (numValue > 15) return { class: 'bg-green-100 text-green-800', text: '우수' };
        if (numValue > 10) return { class: 'bg-yellow-100 text-yellow-800', text: '보통' };
        return { class: 'bg-red-100 text-red-800', text: '저조' };
    }
    
    return { class: 'bg-gray-100 text-gray-600', text: '-' };
}

function formatMetricValue(metric, value) {
    if (value === null || value === undefined || value === '') return '-';
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return value;
    
    if (metric.includes('%') || metric.includes('수익률')) {
        return numValue.toFixed(2) + '%';
    }
    
    if (metric.includes('$') || metric.includes('시가총액')) {
        return formatMarketCap(numValue);
    }
    
    return formatNumber(numValue);
}

/**
 * 모달 이벤트 핸들러 초기화
 */
function initializeModalHandlers() {
    // 모달 닫기 버튼
    const closeModalBtn = document.getElementById('close-modal-btn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            document.getElementById('company-analysis-modal').classList.remove('active');
        });
    }
    
    // 모달 배경 클릭 시 닫기
    const modal = document.getElementById('company-analysis-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    }
    
    // 비교 목록에 추가 버튼
    const addToCompareBtn = document.getElementById('add-to-compare-btn');
    if (addToCompareBtn) {
        addToCompareBtn.addEventListener('click', () => {
            // 비교 기능 구현 예정
            console.log('비교 목록에 추가');
        });
    }
}

// 초기화 시 모달 핸들러 등록
document.addEventListener('DOMContentLoaded', () => {
    initializeModalHandlers();
});
/**
 * 정렬 시스템 완전 재구현 (빈 데이터 처리 개선)
 */

// 기존 sortState 사용 (중복 선언 제거)

/**
 * 테이블 정렬 함수 (빈 데이터 처리 완전 개선)
 */
function sortTable(columnKey) {
    console.log(`🔄 정렬 실행: ${columnKey}`);
    
    try {
        // 정렬 상태 업데이트
        if (sortState.column === columnKey) {
            sortState.order = sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.column = columnKey;
            sortState.order = 'asc';
        }
        
        console.log(`정렬 상태: ${columnKey} (${sortState.order})`);
        
        // 현재 데이터 가져오기
        let currentData;
        if (searchState.currentTerm) {
            // 검색 중이면 검색 결과 사용
            currentData = searchState.lastResults;
            console.log(`검색 결과 정렬: ${currentData.length}개`);
        } else {
            // 일반 필터 데이터 사용
            currentData = getFilteredData(currentFilter);
            console.log(`필터 데이터 정렬: ${currentData.length}개`);
        }
        
        if (!currentData || currentData.length === 0) {
            console.warn('정렬할 데이터가 없습니다.');
            return;
        }
        
        // 정렬 실행 (빈 데이터 처리 개선)
        const sortedData = performSortWithEmptyDataHandling(currentData, columnKey, sortState.order);
        console.log(`✅ 정렬 완료: ${sortedData.length}개 결과`);
        
        // 정렬 결과 저장
        sortState.lastSortedData = sortedData;
        
        // 테이블 다시 렌더링
        renderTable(sortedData);
        
    } catch (error) {
        console.error('❌ 정렬 실행 오류:', error);
    }
}

/**
 * 빈 데이터 처리가 개선된 정렬 함수
 */
function performSortWithEmptyDataHandling(data, column, order) {
    console.log(`🔧 정렬 처리: ${column} (${order}) - ${data.length}개 데이터`);
    
    return data.sort((a, b) => {
        const valueA = a[column];
        const valueB = b[column];
        
        // 빈 데이터 처리 (null, undefined, '', '-', 'N/A' 등)
        const isEmptyA = isEmptyValue(valueA);
        const isEmptyB = isEmptyValue(valueB);
        
        // 둘 다 빈 값이면 원래 순서 유지
        if (isEmptyA && isEmptyB) {
            return 0;
        }
        
        // 빈 값은 항상 맨 뒤로 (오름차순/내림차순 관계없이)
        if (isEmptyA && !isEmptyB) {
            return 1; // A가 뒤로
        }
        if (!isEmptyA && isEmptyB) {
            return -1; // B가 뒤로
        }
        
        // 둘 다 유효한 값인 경우 실제 정렬
        return compareValues(valueA, valueB, column, order);
    });
}

/**
 * 빈 값 판별 함수
 */
function isEmptyValue(value) {
    if (value === null || value === undefined) return true;
    if (value === '' || value === '-' || value === 'N/A' || value === 'n/a') return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (typeof value === 'number' && isNaN(value)) return true;
    
    return false;
}

/**
 * 값 비교 함수 (타입별 처리)
 */
function compareValues(valueA, valueB, column, order) {
    // 숫자형 컬럼 처리
    if (isNumericColumn(column)) {
        const numA = parseFloat(valueA);
        const numB = parseFloat(valueB);
        
        // 숫자 변환 실패 시 문자열로 처리
        if (isNaN(numA) || isNaN(numB)) {
            return compareStrings(String(valueA), String(valueB), order);
        }
        
        return order === 'asc' ? numA - numB : numB - numA;
    }
    
    // 문자열 컬럼 처리
    return compareStrings(String(valueA), String(valueB), order);
}

/**
 * 숫자형 컬럼 판별
 */
function isNumericColumn(column) {
    const numericColumns = [
        '(USD mn)', 'PER (Oct-25)', 'PBR (Oct-25)', 'PEG (Oct-25)',
        'ROE (Fwd)', 'OPM (Fwd)', 'Sales (3)', 'Return (Y)', 'DY (FY+1)',
        '현재가', '전일대비', '전주대비', 'PER (3)', 'PER (5)', 'PER (10)',
        '% PER (Avg)', 'CCC (FY 0)', 'W', '1 M', '3 M', '6 M', 'YTD', '12 M',
        '설립', 'FY 0', 'Price (10)', 'PER (Avg)'
    ];
    
    return numericColumns.includes(column) || 
           column.includes('(%)') || 
           column.includes('Return') || 
           column.includes('Growth') ||
           column.includes('Yield') ||
           column.includes('PER') ||
           column.includes('PBR') ||
           column.includes('ROE') ||
           column.includes('OPM');
}

/**
 * 문자열 비교 함수
 */
function compareStrings(strA, strB, order) {
    const comparison = strA.localeCompare(strB, 'ko', { 
        numeric: true, 
        sensitivity: 'base' 
    });
    
    return order === 'asc' ? comparison : -comparison;
}

/**
 * 정렬 상태 초기화
 */
function resetSortState() {
    sortState = {
        column: null,
        order: 'asc',
        lastSortedData: null
    };
    console.log('정렬 상태 초기화');
}

/**
 * 현재 정렬 상태 가져오기
 */
function getCurrentSortState() {
    return {
        ...sortState,
        isActive: !!sortState.column
    };
}

console.log('✅ 정렬 시스템 완전 재구현 완료 - 빈 데이터 처리 개선');/**
 *
 모달 상단 요약 카드 업데이트
 */
function updateModalSummaryCards(companyData) {
    const perElement = document.getElementById('modal-per');
    const pbrElement = document.getElementById('modal-pbr');
    const roeElement = document.getElementById('modal-roe');
    const marketCapElement = document.getElementById('modal-market-cap');
    
    if (perElement) perElement.textContent = formatNumber(companyData['PER (Oct-25)']);
    if (pbrElement) pbrElement.textContent = formatNumber(companyData['PBR (Oct-25)']);
    if (roeElement) roeElement.textContent = formatPercentage(companyData['ROE (Fwd)']);
    if (marketCapElement) marketCapElement.textContent = formatMarketCap(companyData['(USD mn)']);
}

/**
 * 향상된 상세 지표 테이블 생성
 */
function createEnhancedDetailTable(companyData) {
    const tbody = document.getElementById('modal-detail-tbody');
    if (!tbody) return;
    
    // 32개 지표를 카테고리별로 분류
    const categories = {
        '기본 정보': {
            '티커': companyData.Ticker,
            '회사명': companyData.corpName,
            '거래소': companyData.Exchange,
            '업종': companyData.industry,
            '설립년도': companyData['설립'],
            '회계연도': companyData['FY 0']
        },
        '가격 정보': {
            '현재가': formatNumber(companyData['현재가']),
            '전일대비(%)': formatPercentage(companyData['전일대비']),
            '전주대비(%)': formatPercentage(companyData['전주대비']),
            '시가총액(백만달러)': formatMarketCap(companyData['(USD mn)'])
        },
        '밸류에이션': {
            'PER(현재)': formatNumber(companyData['PER (Oct-25)']),
            'PER 평균대비(%)': formatPercentage(companyData['% PER (Avg)']),
            'PBR(현재)': formatNumber(companyData['PBR (Oct-25)']),
            'PEG비율': formatNumber(companyData['PEG (Oct-25)']),
            'PER 평균': formatNumber(companyData['PER (Avg)']),
            'PER(3년)': formatNumber(companyData['PER (3)']),
            'PER(5년)': formatNumber(companyData['PER (5)']),
            'PER(10년)': formatNumber(companyData['PER (10)'])
        },
        '수익성': {
            'ROE 예상(%)': formatPercentage(companyData['ROE (Fwd)']),
            '영업이익률 예상(%)': formatPercentage(companyData['OPM (Fwd)']),
            '매출성장률(3년)(%)': formatPercentage(companyData['Sales (3)'])
        },
        '배당': {
            '배당수익률(%)': formatPercentage(companyData['DY (FY+1)'])
        },
        '수익률': {
            '연간수익률(%)': formatPercentage(companyData['Return (Y)']),
            '주간수익률(%)': formatPercentage(companyData['W']),
            '1개월수익률(%)': formatPercentage(companyData['1 M']),
            '3개월수익률(%)': formatPercentage(companyData['3 M']),
            '6개월수익률(%)': formatPercentage(companyData['6 M']),
            '연초대비(%)': formatPercentage(companyData['YTD']),
            '12개월수익률(%)': formatPercentage(companyData['12 M'])
        },
        '기타 지표': {
            '10년 평균가격': formatNumber(companyData['Price (10)']),
            '현금전환주기': formatNumber(companyData['CCC (FY 0)'])
        }
    };
    
    // 테이블 내용 생성
    let tableHTML = '';
    Object.entries(categories).forEach(([categoryName, metrics]) => {
        Object.entries(metrics).forEach(([metricName, value], index) => {
            const isFirstInCategory = index === 0;
            const categoryCell = isFirstInCategory 
                ? `<td class="px-4 py-2 font-bold text-gray-700 bg-gray-50" rowspan="${Object.keys(metrics).length}">${categoryName}</td>`
                : '';
            
            // 업종 평균 계산 (간단한 예시)
            const industryAvg = calculateIndustryAverage(companyData.industry, metricName);
            const evaluation = evaluateMetric(metricName, value, industryAvg);
            
            tableHTML += `
                <tr class="border-b hover:bg-gray-50">
                    ${categoryCell}
                    <td class="px-4 py-2">${metricName}</td>
                    <td class="px-4 py-2 text-right font-mono">${value || '-'}</td>
                    <td class="px-4 py-2 text-right font-mono text-gray-600">${industryAvg || '-'}</td>
                    <td class="px-4 py-2 text-center">${evaluation}</td>
                </tr>
            `;
        });
    });
    
    tbody.innerHTML = tableHTML;
}

/**
 * 업종 평균 계산 (간단한 구현)
 */
function calculateIndustryAverage(industry, metricName) {
    // 실제로는 전체 데이터에서 계산해야 하지만, 여기서는 간단한 예시
    const averages = {
        'PER(현재)': '22.5',
        'PBR(현재)': '2.8',
        'ROE 예상(%)': '15.2%',
        '영업이익률 예상(%)': '12.8%',
        '매출성장률(3년)(%)': '8.5%'
    };
    
    return averages[metricName] || '-';
}

/**
 * 지표 평가 (우수/보통/개선필요)
 */
function evaluateMetric(metricName, value, industryAvg) {
    if (!value || value === '-' || !industryAvg || industryAvg === '-') {
        return '<span class="text-gray-500">-</span>';
    }
    
    const numValue = parseFloat(value.toString().replace(/[%,]/g, ''));
    const numAvg = parseFloat(industryAvg.toString().replace(/[%,]/g, ''));
    
    if (isNaN(numValue) || isNaN(numAvg)) {
        return '<span class="text-gray-500">-</span>';
    }
    
    // 지표별 평가 로직
    let isGood = false;
    if (metricName.includes('PER') || metricName.includes('PBR')) {
        // PER, PBR은 낮을수록 좋음
        isGood = numValue < numAvg;
    } else {
        // 나머지는 높을수록 좋음
        isGood = numValue > numAvg;
    }
    
    if (isGood) {
        return '<span class="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">우수</span>';
    } else {
        const diff = Math.abs(numValue - numAvg) / numAvg;
        if (diff < 0.1) {
            return '<span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">보통</span>';
        } else {
            return '<span class="px-2 py-1 bg-red-100 text-red-800 rounded text-xs">개선필요</span>';
        }
    }
}

console.log('✅ 향상된 모달 시스템 로드 완료 - Chart.js 기반');/
**
 * 개선된 검색 실행
 */
function performEnhancedSearch(currentData, term) {
    const results = [];
    const termLower = term.toLowerCase();
    
    currentData.forEach(company => {
        let relevanceScore = 0;
        let matchFound = false;
        
        // 1. 티커 검색 (최고 우선순위)
        if (company.Ticker && company.Ticker.toLowerCase().includes(termLower)) {
            if (company.Ticker.toLowerCase() === termLower) {
                relevanceScore += 100; // 정확 일치
            } else if (company.Ticker.toLowerCase().startsWith(termLower)) {
                relevanceScore += 80; // 시작 일치
            } else {
                relevanceScore += 60; // 부분 일치
            }
            matchFound = true;
        }
        
        // 2. 회사명 검색
        if (company.corpName && company.corpName.toLowerCase().includes(termLower)) {
            if (company.corpName.toLowerCase() === termLower) {
                relevanceScore += 90;
            } else if (company.corpName.toLowerCase().startsWith(termLower)) {
                relevanceScore += 70;
            } else {
                relevanceScore += 50;
            }
            matchFound = true;
        }
        
        // 3. 업종 검색
        if (company.industry && company.industry.toLowerCase().includes(termLower)) {
            relevanceScore += 30;
            matchFound = true;
        }
        
        // 4. 거래소 검색
        const exchange = company.Exchange || company.exchange;
        if (exchange && exchange.toLowerCase().includes(termLower)) {
            relevanceScore += 20;
            matchFound = true;
        }
        
        // 5. 단어별 검색 (회사명)
        if (company.corpName) {
            const words = company.corpName.toLowerCase().split(/\s+/);
            words.forEach(word => {
                if (word.includes(termLower)) {
                    relevanceScore += 25;
                    matchFound = true;
                }
            });
        }
        
        if (matchFound) {
            results.push({
                ...company,
                _relevanceScore: relevanceScore
            });
        }
    });
    
    return results;
}

/**
 * 검색 결과를 정확도별로 정렬
 */
function sortSearchResultsByRelevance(results, searchTerm) {
    return results.sort((a, b) => {
        // 관련성 점수로 정렬
        const scoreA = a._relevanceScore || 0;
        const scoreB = b._relevanceScore || 0;
        
        if (scoreA !== scoreB) {
            return scoreB - scoreA; // 높은 점수가 먼저
        }
        
        // 점수가 같으면 티커 알파벳 순
        return (a.Ticker || '').localeCompare(b.Ticker || '');
    });
}

/**
 * 검색 결과 표시
 */
function displaySearchResults(results, searchTerm) {
    // 관련성 점수 제거 (표시용)
    const cleanResults = results.map(result => {
        const { _relevanceScore, ...cleanResult } = result;
        return cleanResult;
    });
    
    updateFilterStatus(`검색 결과: "${searchTerm}" (${cleanResults.length.toLocaleString()}개)`);
    renderTable(cleanResults);
    
    // 검색 결과 하이라이팅 적용
    highlightSearchResults(searchTerm);
    
    // 전역 데이터 업데이트 (다른 기능들과의 호환성)
    window.currentData = cleanResults;
}

/**
 * 검색 결과 하이라이팅
 */
function highlightSearchResults(searchTerm) {
    if (!searchTerm) return;
    
    const tableContainer = document.getElementById('results-table');
    if (!tableContainer) return;
    
    const term = searchTerm.toLowerCase();
    const cells = tableContainer.querySelectorAll('td');
    
    cells.forEach(cell => {
        const text = cell.textContent;
        if (text && text.toLowerCase().includes(term)) {
            const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
            const highlightedText = text.replace(regex, '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
            cell.innerHTML = highlightedText;
        }
    });
}

/**
 * 정규식 특수문자 이스케이프
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 검색 초기화
 */
function clearSearch() {
    console.log('🔄 검색 초기화');
    
    searchState.currentTerm = '';
    searchState.lastResults = [];
    
    // 검색창 초기화
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // 초기화 버튼 숨김
    const clearSearchButton = document.getElementById('clear-search');
    if (clearSearchButton) {
        clearSearchButton.classList.add('hidden');
    }
    
    // 필터 상태로 복원
    applyFilters(currentFilter);
}

/**
 * 검색 자동완성 제안 생성
 */
function generateSearchSuggestions(partialTerm) {
    if (!partialTerm || partialTerm.length < 2) {
        return [];
    }
    
    const currentData = getFilteredData(currentFilter);
    const term = partialTerm.toLowerCase();
    const suggestions = new Set();
    
    // 티커 제안 (최대 3개)
    currentData.forEach(company => {
        if (company.Ticker && company.Ticker.toLowerCase().startsWith(term)) {
            suggestions.add({
                text: company.Ticker,
                type: 'ticker',
                company: company.corpName || company.Ticker
            });
        }
    });
    
    // 회사명 제안 (최대 3개)
    currentData.forEach(company => {
        if (company.corpName && company.corpName.toLowerCase().includes(term)) {
            suggestions.add({
                text: company.corpName,
                type: 'company',
                ticker: company.Ticker
            });
        }
    });
    
    // 업종 제안 (최대 2개)
    const industries = new Set();
    currentData.forEach(company => {
        if (company.industry && company.industry.toLowerCase().includes(term)) {
            industries.add(company.industry);
        }
    });
    
    Array.from(industries).slice(0, 2).forEach(industry => {
        suggestions.add({
            text: industry,
            type: 'industry',
            count: currentData.filter(c => c.industry === industry).length
        });
    });
    
    return Array.from(suggestions).slice(0, 8);
}

/**
 * 검색 통계 반환
 */
function getSearchStats() {
    return {
        currentTerm: searchState.currentTerm,
        resultCount: searchState.lastResults.length,
        historyCount: searchState.searchHistory.length,
        cacheSize: searchState.cache.size,
        indexSize: searchState.index ? searchState.index.size : 0,
        isActive: searchState.currentTerm.length > 0
    };
}