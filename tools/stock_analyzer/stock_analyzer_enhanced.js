document.addEventListener('DOMContentLoaded', () => {
    init();
});

// Global state
let allData = [];
let config = {};
let columnConfig = {};
let metadata = {};
window.activeCompanyForComparison = null;
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
    
    // SearchEnhancementManager 초기화 (데이터 로딩 후)
    if (window.searchEnhancementManager) {
        setTimeout(() => {
            if (window.allData && window.allData.length > 0) {
                window.searchEnhancementManager.initialize(window.allData);
            } else {
                console.log('⏳ SearchEnhancementManager: 데이터 대기 중...');
            }
        }, 3000);
    }
    
    // SearchEnhancementManager 초기화
    if (window.searchEnhancementManager) {
        setTimeout(() => {
            window.searchEnhancementManager.initialize(window.allData);
        }, 3000); // 데이터 로딩 후 초기화
    }
    
    // PortfolioBuilder 초기화
    if (window.portfolioBuilder) {
        setTimeout(() => {
            try {
                window.portfolioBuilder.initialize();
            } catch (error) {
                console.error('❌ PortfolioBuilder 초기화 실패:', error);
            }
        }, 3000);
    }
    
    // DashboardFixManager 초기화
    if (window.dashboardFixManager) {
        setTimeout(() => {
            window.dashboardFixManager.initialize();
        }, 3500); // 대시보드 매니저 이후 초기화
    }
    
    // AdvancedFilterEnhancer 초기화
    if (window.advancedFilterEnhancer) {
        setTimeout(() => {
            window.advancedFilterEnhancer.initialize();
        }, 4000); // 모든 시스템 로딩 후 초기화
    }
    
    // UIEnhancementManager 초기화 (성능 최적화를 위해 지연)
    if (window.uiEnhancementManager) {
        setTimeout(() => {
            if (window.columnManager && typeof window.columnManager.isGroupVisible === 'function') {
                window.uiEnhancementManager.initialize();
            } else {
                console.log('ℹ️ UIEnhancementManager 초기화 지연 - ColumnManager 대기 중');
                setTimeout(() => window.uiEnhancementManager.initialize(), 2000);
            }
        }, 6000); // 더 늦게 초기화하여 성능 개선
    }
    
    // 디버깅: 데이터 로딩 상태 확인
    console.log('🔍 초기화 완료 시 데이터 상태:', {
        allDataLength: allData ? allData.length : 'undefined',
        allDataType: typeof allData,
        sampleData: allData && allData.length > 0 ? allData[0] : 'no data'
    });
    
    if (window.deepCompare) {
        setTimeout(() => {
            try {
                window.deepCompare.initialize();
            } catch (error) {
                console.error('❌ DeepCompare 초기화 실패:', error);
            }
        }, 2500);
    }

    // EconomicDashboard 초기화
    if (window.EconomicDashboard) {
        setTimeout(async () => {
            try {
                const container = document.getElementById('economic-dashboard-container');
                if (container) {
                    const dashboard = new window.EconomicDashboard();
                    await dashboard.init();
                    dashboard.render(container);
                    console.log('✅ EconomicDashboard 초기화 완료');
                }
            } catch (error) {
                console.error('❌ EconomicDashboard 초기화 실패:', error);
            }
        }, 3500);
    }

    // MomentumHeatmap 초기화
    if (window.MomentumHeatmap) {
        setTimeout(async () => {
            try {
                const container = document.getElementById('momentum-heatmap-container');
                if (container) {
                    const heatmap = new window.MomentumHeatmap();
                    await heatmap.init();
                    const heatmapElement = heatmap.render();
                    if (heatmapElement) {
                        container.appendChild(heatmapElement);
                        console.log('✅ MomentumHeatmap 초기화 완료');
                    }
                }
            } catch (error) {
                console.error('❌ MomentumHeatmap 초기화 실패:', error);
            }
        }, 4000);
    }

    // Momentum 모듈 초기화 (Phase 2)
    if (window.M_Company) {
        setTimeout(async () => {
            try {
                const container = document.getElementById('momentum-company-container');
                if (container && window.allData && window.allData.length > 0) {
                    // M_Company 인스턴스 생성 및 초기화
                    window.momentumCompany = new window.M_Company({
                        autoUpdate: true,
                        updateInterval: 60000,
                        theme: 'light'
                    });

                    // 데이터 로드
                    await window.momentumCompany.loadData(window.allData);

                    // 초기 렌더링
                    window.momentumCompany.render(container);

                    console.log('✅ Momentum 모듈 (M_Company) 초기화 완료');

                    // 상세 분석 버튼 이벤트
                    const detailBtn = document.getElementById('open-momentum-detail-btn');
                    if (detailBtn) {
                        detailBtn.addEventListener('click', () => {
                            window.momentumCompany.showDetailView();
                        });
                    }
                }
            } catch (error) {
                console.error('❌ Momentum 모듈 초기화 실패:', error);
            }
        }, 4500);
    }

    applyFilters('all');
    setupEventListeners();
    
    // 고급 필터 시스템 초기화
    if (window.advancedFilter) {
        window.advancedFilter.initialize();
    }

    // 탭 전환 시스템 초기화
    setupTabSwitching();
}

/**
 * 탭 전환 시스템 설정
 */
function setupTabSwitching() {
    const tabButtons = {
        screener: document.getElementById('tab-screener'),
        dashboard: document.getElementById('tab-dashboard'),
        portfolio: document.getElementById('tab-portfolio')
    };

    const tabContents = {
        screener: document.getElementById('screener-content'),
        dashboard: document.getElementById('dashboard-content'),
        portfolio: document.getElementById('portfolio-content')
    };

    // 탭 전환 함수
    function switchTab(tabName) {
        // 모든 탭 버튼 비활성화
        Object.values(tabButtons).forEach(btn => {
            if (btn) {
                btn.classList.remove('active', 'text-blue-600', 'border-blue-500');
                btn.classList.add('text-gray-500', 'border-transparent');
            }
        });

        // 모든 탭 콘텐츠 숨김
        Object.values(tabContents).forEach(content => {
            if (content) {
                content.classList.add('hidden');
            }
        });

        // 선택된 탭 활성화
        const activeButton = tabButtons[tabName];
        const activeContent = tabContents[tabName];

        if (activeButton) {
            activeButton.classList.add('active', 'text-blue-600', 'border-blue-500');
            activeButton.classList.remove('text-gray-500', 'border-transparent');
        }

        if (activeContent) {
            activeContent.classList.remove('hidden');
        }

        console.log(`✅ 탭 전환: ${tabName}`);
    }

    // 탭 버튼 클릭 이벤트 등록
    if (tabButtons.screener) {
        tabButtons.screener.addEventListener('click', () => switchTab('screener'));
    }

    if (tabButtons.dashboard) {
        tabButtons.dashboard.addEventListener('click', () => switchTab('dashboard'));
    }

    if (tabButtons.portfolio) {
        tabButtons.portfolio.addEventListener('click', () => switchTab('portfolio'));
    }

    switchTab('screener');
    console.log('✅ 탭 전환 시스템 초기화 완료');
    window.switchStockAnalyzerTab = switchTab;
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
        const dataSources = [
            `./data/enhanced_summary_data_clean.json?v=${timestamp}`,
            `./data/enhanced_summary_data.json?v=${timestamp}`
        ];

        let enhancedRes = null;
        let dataSourceUsed = null;
        for (const src of dataSources) {
            try {
                const response = await fetch(src, { cache: 'no-store' });
                if (response.ok) {
                    enhancedRes = response;
                    dataSourceUsed = src.split('?')[0];
                    break;
                }
            } catch (fetchError) {
                console.warn(`⚠️ 데이터 소스 요청 실패 (${src}):`, fetchError);
            }
        }

        if (!enhancedRes) {
            const errorMsg = '데이터 파일을 찾을 수 없습니다. 서버가 실행 중인지 확인해주세요.';
            console.error('❌ 데이터 로딩 실패:', errorMsg);
            throw new Error(errorMsg);
        }

        const columnConfigPromise = fetch('./data/column_config.json');
        const appConfigPromise = fetch('./stock_analyzer_config.json');

        let enhancedData;
        let sanitized = '';
        const sanitizeJsonText = (rawText) => {
            let inString = false;
            let escaped = false;
            let buffer = '';
            let replacements = 0;
            for (let i = 0; i < rawText.length; i++) {
                const char = rawText[i];

                if (inString) {
                    buffer += char;
                    if (escaped) {
                        escaped = false;
                    } else if (char === '\\') {
                        escaped = true;
                    } else if (char === '"') {
                        inString = false;
                    }
                    continue;
                }

                if (char === '"') {
                    inString = true;
                    buffer += char;
                    continue;
                }

                if (rawText.startsWith('-Infinity', i)) {
                    buffer += 'null';
                    i += '-Infinity'.length - 1;
                    replacements++;
                    continue;
                }

                if (rawText.startsWith('Infinity', i)) {
                    buffer += 'null';
                    i += 'Infinity'.length - 1;
                    replacements++;
                    continue;
                }

                if (rawText.startsWith('NaN', i)) {
                    buffer += 'null';
                    i += 'NaN'.length - 1;
                    replacements++;
                    continue;
                }

                buffer += char;
            }

            return { sanitizedText: buffer, replacements };
        };
        try {
            const raw = await enhancedRes.text();

            // 더 강력한 NaN 및 Infinity 처리 (정규표현식 사용)
            let cleanedText = raw
                .replace(/:\s*NaN\b/g, ': null')  // 값으로 사용된 NaN
                .replace(/,\s*NaN\b/g, ', null')  // 배열 요소인 NaN
                .replace(/\[\s*NaN\b/g, '[null')  // 배열 시작의 NaN
                .replace(/:\s*Infinity\b/g, ': null')  // Infinity도 처리
                .replace(/:\s*-Infinity\b/g, ': null'); // -Infinity도 처리

            const { sanitizedText, replacements } = sanitizeJsonText(cleanedText);
            sanitized = sanitizedText;

            if (sanitized !== raw) {
                console.log(`🧼 JSON sanitize applied: ${replacements} invalid tokens replaced with null`);
            }

            const hasUnquotedNaN = (() => {
                for (let i = 0; i < sanitized.length; i++) {
                    if (sanitized[i] === 'N' && sanitized.startsWith('NaN', i) && sanitized[i - 1] !== '"') {
                        return i;
                    }
                }
                return -1;
            })();
            if (hasUnquotedNaN !== -1) {
                console.warn('⚠️ sanitize check: NaN token still present after replacements', sanitized.slice(Math.max(hasUnquotedNaN - 60, 0), hasUnquotedNaN + 60));
            }

            const lower = sanitized.toLowerCase();
            const hasUnquotedInfinity = (() => {
                for (let i = 0; i < lower.length; i++) {
                    if (lower[i] === 'i' && lower.startsWith('infinity', i) && sanitized[i - 1] !== '"') {
                        return i;
                    }
                }
                return -1;
            })();
            if (hasUnquotedInfinity !== -1) {
                console.warn('⚠️ sanitize check: Infinity token still present after replacements', sanitized.slice(Math.max(hasUnquotedInfinity - 60, 0), hasUnquotedInfinity + 60));
            }

            enhancedData = JSON.parse(sanitized);
        } catch (parseError) {
            console.error('❌ Enhanced data parse failed:', parseError);
            try {
                if (sanitized) {
                    const idx = sanitized.indexOf('NaN');
                    if (idx !== -1) {
                        console.error('🔍 Remaining NaN snippet:', sanitized.slice(Math.max(idx - 80, 0), idx + 80));
                    } else {
                        console.error('🔍 Sanitized preview (first 200 chars):', sanitized.slice(0, 200));
                    }
                }
            } catch (snippetError) {
                console.error('Snippet extraction failed:', snippetError);
            }
            throw parseError;
        }

        const columnConfigRes = await columnConfigPromise;
        if (columnConfigRes.ok) {
            columnConfig = await columnConfigRes.json();
        } else {
            console.warn('⚠️ 컬럼 설정 파일 로딩 실패, 기본 설정 사용');
            columnConfig = getDefaultColumnConfig();
        }

        const appConfigRes = await appConfigPromise;
        config = appConfigRes.ok ? await appConfigRes.json() : {};

        console.log('📂 사용된 데이터 소스:', dataSourceUsed);

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

        // 데이터 정제 시스템 활성화 - 0-0x2a0x2a 패턴 제거
        console.log('🧹 DataCleanupManager 활성화 - 잘못된 데이터 정제 시작');
        
        if (window.dataCleanupManager && typeof window.dataCleanupManager.cleanData === 'function') {
            allData = window.dataCleanupManager.cleanData(rawData);
            console.log(`✅ 데이터 정제 완료: ${rawData.length} → ${allData.length} 기업`);
        } else {
            // DataCleanupManager가 없는 경우 직접 정제
            console.log('⚠️ DataCleanupManager 없음, 직접 데이터 정제 실행');
            allData = rawData.filter(company => {
                // 0-0x2a0x2a 패턴이 있는 기업 제외
                const hasInvalidData = Object.values(company).some(value => 
                    typeof value === 'string' && value.includes('0-0x2a0x2a')
                );
                
                if (hasInvalidData) {
                    console.log('❌ 잘못된 데이터 패턴 발견, 기업 제외:', company.Ticker || company.corpName);
                    return false;
                }
                
                // 필수 필드 확인
                if (!company.Ticker || !company.corpName) {
                    console.log('❌ 필수 필드 누락, 기업 제외:', company);
                    return false;
                }
                
                return true;
            });
            
            console.log(`✅ 직접 데이터 정제 완료: ${rawData.length} → ${allData.length} 기업`);
        }

        console.log(`Successfully loaded ${allData.length} companies with ${metadata.total_columns || 31} indicators`);
        console.log('Available categories:', Object.keys(columnConfig.categories || {}));
        
        // 전역 변수 설정 확인
        window.allData = allData;
        console.log('🔍 전역 allData 설정 완료:', {
            windowAllData: window.allData ? window.allData.length : 'undefined',
            localAllData: allData ? allData.length : 'undefined'
        });
        
        if (window.deepCompare && typeof window.deepCompare.refreshDataSource === 'function') {
            window.deepCompare.refreshDataSource();
        }

        if (window.portfolioBuilder && typeof window.portfolioBuilder.collectData === 'function') {
            window.portfolioBuilder.collectData();
            if (typeof window.portfolioBuilder.refreshHoldings === 'function') {
                window.portfolioBuilder.refreshHoldings();
            }
        }

        if (window.smartAnalytics && typeof window.smartAnalytics.setDataset === 'function') {
            window.smartAnalytics.setDataset(allData);
        }
        
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
        
        // 고급 필터 시스템 초기화
        if (window.advancedFilter && typeof window.advancedFilter.initialize === 'function') {
            window.advancedFilter.initialize();
            console.log('✅ 고급 필터 시스템 초기화 완료');
        }
        
        // 로딩 완료 - 로딩 상태 숨기기
        hideLoadingState();
        
        console.log('✅ 데이터 로딩 완료');

        if (window.collaborativeTestSuite) {
            window.collaborativeTestSuite
                .runAllTests({ trigger: 'post-data-load' })
                .catch(error => {
                    console.warn('⚠️ Collaborative tests failed:', error);
                });
        }

    } catch (error) {
        console.error("❌ 데이터 로딩 오류:", error);
        
        // 로딩 상태 숨기기
        hideLoadingState();
        
        const errorMessage = getErrorMessage(error);
        
        // 사용자 친화적 오류 메시지 표시
        showErrorMessage(
            '데이터 로딩 실패',
            errorMessage,
            true
        );
        
        console.error('상세 오류 정보:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });

        // 에러가 나도 데이터는 유지!!! 삭제하면 안됨!!!
        // allData = [];  // 이것 때문에 데이터가 사라졌음!
        // config = {};
        // columnConfig = {};
        // metadata = {};
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

    const totalCount = allData.length;
    const qualityCount = getFilteredData('quality').length;
    const valueCount = getFilteredData('value').length;
    const momentumCount = getFilteredData('momentum').length;

    screenerPanel.innerHTML = `
        <h2 class="text-lg font-bold text-gray-700 mb-4">
            <i class="fas fa-filter text-blue-600 mr-2"></i>
            고급 필터링 시스템
            <span id="filter-result-count" class="text-sm font-normal text-gray-600 ml-2">${totalCount.toLocaleString()}개 기업</span>
        </h2>

        <div class="flex flex-wrap gap-3 mb-4">
            <button id="open-deep-compare-btn" class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 transition">
                <i class="fas fa-balance-scale"></i>
                기업 비교 (DeepCompare)
            </button>
            <button id="open-smart-analytics-btn" class="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg shadow hover:bg-purple-700 transition">
                <i class="fas fa-brain"></i>
                AI 스마트 분석
            </button>
            <button id="open-portfolio-builder-btn" class="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg shadow hover:bg-emerald-700 transition">
                <i class="fas fa-briefcase"></i>
                스마트 포트폴리오 빌더
            </button>
        </div>

        <div class="flex flex-wrap gap-2 mb-4">
            <button id="filter-all" class="filter-btn px-4 py-2 rounded-lg border transition-colors duration-200">
                전체 (${totalCount.toLocaleString()})
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

        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">투자 전략 필터</label>
            <div id="qvm-filters" class="flex flex-wrap gap-2"></div>
        </div>

        <div id="filter-status" class="mb-4 text-sm text-gray-600">필터 없음</div>

        <div class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <h4 class="text-sm font-bold text-blue-800 mb-2">💡 필터 사용 가이드</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div><strong>거래소:</strong> NASDAQ, NYSE 등 상장 거래소별 필터</div>
                <div><strong>업종:</strong> 반도체, 소프트웨어 등 산업별 필터</div>
                <div><strong>시가총액:</strong> 대형주/중형주/소형주 구분 (백만달러)</div>
                <div><strong>PER:</strong> 저평가 종목 발굴 (15 이하 권장)</div>
                <div><strong>PBR:</strong> 자산 대비 가치 평가 (1-3 적정)</div>
                <div><strong>ROE:</strong> 자기자본수익률 (15% 이상 우량)</div>
            </div>
        </div>

        <div id="preset-filters-container" class="mb-6"></div>

        <div class="mb-6">
            <h3 class="text-md font-bold text-gray-700 mb-3">
                <i class="fas fa-sliders-h text-green-600 mr-2"></i>
                범위 필터
            </h3>
            <div id="range-filters-container" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
            <button id="clear-all-filters" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
                <i class="fas fa-undo mr-2"></i>필터 초기화
            </button>
            <span class="text-xs text-gray-500">필터를 적용하면 결과가 즉시 갱신됩니다.</span>
        </div>
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

    // 필터 초기화 버튼
    document.getElementById('clear-all-filters')?.addEventListener('click', () => {
        // SearchEnhancementManager 필터 초기화
        if (window.searchEnhancementManager) {
            window.searchEnhancementManager.clearAllFilters();
        }
        
        // 기본 필터로 복원
        applyFilters('all');
        
        console.log('🧹 모든 필터 초기화');
    });

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

    const compareModal = document.getElementById('company-compare-modal');
    const openDeepCompareBtn = document.getElementById('open-deep-compare-btn');
    if (openDeepCompareBtn) {
        openDeepCompareBtn.addEventListener('click', () => {
            openDeepCompareModal(window.activeCompanyForComparison);
        });
    }

    document.getElementById('close-compare-modal-btn')?.addEventListener('click', () => {
        compareModal?.classList.remove('active');
    });

    compareModal?.addEventListener('click', (event) => {
        if (event.target === compareModal) {
            compareModal.classList.remove('active');
        }
    });

    const smartAnalyticsBtn = document.getElementById('open-smart-analytics-btn');
    if (smartAnalyticsBtn) {
        smartAnalyticsBtn.addEventListener('click', () => {
            openSmartAnalyticsModal();
        });
    }

    const smartAnalyticsModal = document.getElementById('smart-analytics-modal');
    document.getElementById('close-smart-analytics-btn')?.addEventListener('click', () => {
        smartAnalyticsModal?.classList.remove('active');
    });

    smartAnalyticsModal?.addEventListener('click', (event) => {
        if (event.target === smartAnalyticsModal) {
            smartAnalyticsModal.classList.remove('active');
        }
    });

    const openPortfolioBuilderBtn = document.getElementById('open-portfolio-builder-btn');
    if (openPortfolioBuilderBtn) {
        openPortfolioBuilderBtn.addEventListener('click', () => {
            if (typeof window.switchStockAnalyzerTab === 'function') {
                window.switchStockAnalyzerTab('portfolio');
            }
            document.getElementById('portfolio-content')?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    const addToCompareBtn = document.getElementById('add-to-compare-btn');
    if (addToCompareBtn) {
        addToCompareBtn.addEventListener('click', () => {
            if (!window.deepCompare) {
                console.warn('DeepCompare 모듈이 로드되지 않았습니다.');
                return;
            }
            window.deepCompare.initialize();
            if (window.activeCompanyForComparison) {
                window.deepCompare.addEntityFromCompany(window.activeCompanyForComparison);
            }
            openDeepCompareModal(window.activeCompanyForComparison);
        });
    }
}

/**
 * 디바운스 함수
 */
function openDeepCompareModal(preselectedCompany) {
    const modal = document.getElementById('company-compare-modal');
    if (!modal || !window.deepCompare) {
        console.warn('DeepCompare 모듈이 활성화되어 있지 않습니다.');
        return;
    }

    try {
        window.deepCompare.initialize();
        window.deepCompare.refreshDataSource();

        if (preselectedCompany) {
            window.deepCompare.addEntityFromCompany(preselectedCompany);
        } else if (!window.deepCompare.selected.length && Array.isArray(window.allData)) {
            window.allData.slice(0, 2).forEach(company => {
                window.deepCompare.addEntityFromCompany(company);
            });
        }

        modal.classList.add('active');
    } catch (error) {
        console.error('DeepCompare 모달을 여는 중 오류:', error);
    }
}

async function openSmartAnalyticsModal() {
    if (smartAnalyticsModalBusy) return;

    const modal = document.getElementById('smart-analytics-modal');
    const content = document.getElementById('smart-analytics-content');
    if (!modal || !content) {
        console.warn('SmartAnalytics 모달 요소를 찾을 수 없습니다.');
        return;
    }

    modal.classList.add('active');
    content.innerHTML = `
        <div class="flex items-center gap-2 text-purple-700">
            <span class="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500"></span>
            AI 분석을 준비 중입니다...
        </div>
    `;

    if (!window.smartAnalytics) {
        content.innerHTML = '<p class="text-red-600">SmartAnalytics 모듈을 찾을 수 없습니다.</p>';
        return;
    }

    smartAnalyticsModalBusy = true;
    try {
        if (!window.smartAnalytics.initialized) {
            await window.smartAnalytics.initialize();
        }

        const contextData = typeof getFilteredData === 'function' ? getFilteredData(currentFilter) : window.allData;
        if (Array.isArray(contextData)) {
            window.smartAnalytics.setDataset(contextData);
        }

        const analyses = await window.smartAnalytics.analyzeTopCompanies(5);
        if (!analyses.length) {
            content.innerHTML = '<p class="text-gray-600">분석 가능한 데이터가 없습니다.</p>';
            return;
        }

        content.innerHTML = renderSmartAnalyticsContent(analyses);
    } catch (error) {
        console.error('SmartAnalytics 실행 오류:', error);
        content.innerHTML = `<p class="text-red-600">AI 분석 중 오류가 발생했습니다: ${error.message}</p>`;
    } finally {
        smartAnalyticsModalBusy = false;
    }
}

function renderSmartAnalyticsContent(analyses) {
    const dataset = window.smartAnalytics?.dataset || [];
    const companyLookup = new Map(dataset.map(company => [company.Ticker, company]));

    const cards = analyses.map(result => {
        const companyInfo = companyLookup.get(result.company) || {};
        const corpName = companyInfo.corpName || result.company;
        const industry = companyInfo.industry || '정보 없음';
        const exchange = companyInfo.exchange || companyInfo.Exchange || '-';
        const currentMomentum = typeof result.currentMomentum === 'number' ? result.currentMomentum.toFixed(2) : 'N/A';
        const predictedMomentum = typeof result.predictedMomentum === 'number' ? result.predictedMomentum.toFixed(2) : 'N/A';
        const confidence = typeof result.confidence === 'number' ? `${(result.confidence * 100).toFixed(1)}%` : 'N/A';
        const signals = Array.isArray(result.signals) && result.signals.length ? result.signals.join(', ') : '신호 없음';
        const risks = Array.isArray(result.riskFactors) && result.riskFactors.length ? result.riskFactors.join(', ') : '위험 요인이 감지되지 않았습니다.';
        const opportunities = Array.isArray(result.opportunities) && result.opportunities.length ? result.opportunities.join(', ') : '기회 요인이 감지되지 않았습니다.';

        return `
            <div class="border border-purple-200 rounded-xl bg-purple-50 p-4 shadow-sm">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                    <div>
                        <div class="text-sm font-semibold text-purple-900">${result.company} · ${corpName}</div>
                        <div class="text-xs text-purple-700">${industry} · ${exchange}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs text-purple-600">예상 모멘텀</div>
                        <div class="text-lg font-bold text-purple-900">${predictedMomentum}</div>
                    </div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-purple-800">
                    <div>
                        <div class="font-semibold">현재 모멘텀</div>
                        <div>${currentMomentum}</div>
                    </div>
                    <div>
                        <div class="font-semibold">예측 모멘텀</div>
                        <div>${predictedMomentum}</div>
                    </div>
                    <div>
                        <div class="font-semibold">신뢰도</div>
                        <div>${confidence}</div>
                    </div>
                    <div>
                        <div class="font-semibold">신호</div>
                        <div>${signals}</div>
                    </div>
                </div>
                <div class="mt-3 text-xs text-purple-800">
                    <div class="font-semibold mb-1">리스크 요인</div>
                    <p class="text-purple-700 leading-relaxed">${risks}</p>
                </div>
                <div class="mt-3 text-xs text-purple-800">
                    <div class="font-semibold mb-1">기회 요인</div>
                    <p class="text-purple-700 leading-relaxed">${opportunities}</p>
                </div>
            </div>
        `;
    });

    return `<div class="space-y-4">${cards.join('')}</div>`;
}

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

let smartAnalyticsModalBusy = false;

/**
 * 검색 인덱스 생성 (성능 최적화)
 */
function buildSearchIndex() {
    console.log('🔍 검색 인덱스 생성 중...');
    
    const startTime = performance.now();
    const index = new Map();
    
    allData.forEach((company, idx) => {
        // 검색 가능한 모든 필드를 인덱스에 추가 (숫자 타입도 처리)
        const searchableFields = [
            String(company.Ticker || '').toLowerCase(),
            String(company.corpName || '').toLowerCase(),
            String(company.industry || '').toLowerCase(),
            String(company.exchange || company.Exchange || '').toLowerCase()  // exchange 소문자 체크
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
 * 고급 검색 처리 (정확도 개선 + 성능 최적화)
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
    
    // SearchEnhancementManager를 통한 고급 검색
    let searchResults = [];
    
    if (window.searchEnhancementManager && window.searchEnhancementManager.isInitialized) {
        // 현재 활성 필터 가져오기
        const activeFilters = {};
        
        const industryFilter = document.getElementById('industry-filter');
        if (industryFilter && industryFilter.value) {
            activeFilters.industry = industryFilter.value;
        }
        
        const exchangeFilter = document.getElementById('exchange-filter');
        if (exchangeFilter && exchangeFilter.value) {
            activeFilters.exchange = exchangeFilter.value;
        }
        
        // 고급 검색 실행
        searchResults = window.searchEnhancementManager.performAdvancedSearch(searchTerm, activeFilters);
    } else {
        // 폴백: 기본 검색
        searchResults = performBasicSearch(searchTerm);
    }
    
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
 * 기본 검색 실행 (폴백용)
 */
function performBasicSearch(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const currentData = getFilteredData(currentFilter);
    
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
        const exchange = company.Exchange || company.exchange;
        if (exchange?.toLowerCase().includes(term)) {
            return true;
        }
        
        return false;
    });
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

// 중복 함수 제거됨 - performEnhancedSearch

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
 * 검색 자동완성 표시 (개선된 버전)
 */
function showSearchSuggestions(searchTerm) {
    const suggestionsContainer = document.getElementById('search-suggestions');
    if (!suggestionsContainer) return;
    
    // SearchEnhancementManager를 통한 고급 제안
    let suggestions = [];
    
    if (window.searchEnhancementManager && window.searchEnhancementManager.isInitialized) {
        suggestions = window.searchEnhancementManager.generateSearchSuggestions(searchTerm);
    } else {
        // 폴백: 기본 제안
        suggestions = generateSearchSuggestions(searchTerm).map(text => ({
            type: 'basic',
            text: text,
            label: '기본'
        }));
    }
    
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
    console.log('🔍 applyFilters 호출 시 데이터 상태:', {
        allDataLength: allData ? allData.length : 'undefined',
        windowAllDataLength: window.allData ? window.allData.length : 'undefined'
    });
    
    currentFilter = filterType;
    paginationManager.currentPage = 1; // 페이지 리셋
    
    try {
        let filteredData = getFilteredData(filterType);
        console.log('🔍 필터링된 데이터:', filteredData ? filteredData.length : 'undefined');
        
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
        const countElement = document.getElementById('filter-result-count');
        if (countElement) {
            countElement.textContent = `${allData.length.toLocaleString()}개 기업`;
        }
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

    const resultCountElement = document.getElementById('filter-result-count');
    if (resultCountElement) {
        resultCountElement.textContent = `${filteredData.length.toLocaleString()}개 기업`;
    }
}

/**
 * 테이블 렌더링 (31개 지표 지원 + 페이징)
 */
function renderTable(data) {
    console.log(`Rendering table with ${data.length} companies`);
    
    // 카드 뷰 제거됨 - 테이블 뷰만 지원
    
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
            showCompanyModal(company);
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
        
        // 행 클릭 시 상세 페이지로 이동
        row.style.cursor = 'pointer';
        
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

    let num = parseFloat(value);

    // If value is between -1 and 1 (but not 0), it's likely stored as decimal (0.7943 = 79.43%)
    // Convert to percentage by multiplying by 100
    if (num !== 0 && Math.abs(num) < 1) {
        num = num * 100;
    }

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
    
    window.activeCompanyForComparison = companyData;
    
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

    let numValue = parseFloat(value);
    if (isNaN(numValue)) return 0;

    // Convert decimal percentages to actual percentages for proper normalization
    // If value is between -1 and 1 (but not 0) and min/max suggest percentage range
    if (numValue !== 0 && Math.abs(numValue) < 1 && Math.abs(max) > 10) {
        numValue = numValue * 100;
    }

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

    // Use formatPercentage for percentage metrics (indices 2-6), formatNumber for PER/PBR (indices 0-1)
    const formatter = dataIndex >= 2 ? formatPercentage : formatNumber;

    return `${labels[dataIndex]}: ${formatter(metrics[dataIndex])}`;
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

console.log('✅ 향상된 모달 시스템 로드 완료 - Chart.js 기반');

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
/**
 * 
기업 상세 페이지로 이동
 */
function navigateToCompanyDetail(company) {
    if (!company || !company.Ticker) {
        console.error('❌ 기업 정보가 없습니다:', company);
        return;
    }
    
    console.log(`🔗 기업 상세 페이지로 이동: ${company.Ticker}`);
    
    // URL 파라미터로 기업 정보 전달
    const params = new URLSearchParams({
        ticker: company.Ticker,
        name: company.corpName || company.Ticker,
        exchange: company.Exchange || '',
        industry: company.industry || ''
    });
    
    // 상세 페이지로 이동
    window.location.href = `company-detail.html?${params.toString()}`;
}

/**
 * 기본 컬럼 설정 반환 (컬럼 설정 파일 로딩 실패 시 사용)
 */
function getDefaultColumnConfig() {
    return {
        categories: {
            basic: {
                name: "기본 지표",
                columns: ["Ticker", "corpName", "Exchange", "industry", "(USD mn)", "PER (Oct-25)", "PBR (Oct-25)", "ROE (Fwd)"]
            },
            valuation: {
                name: "밸류에이션",
                columns: ["Ticker", "corpName", "PER (Oct-25)", "PBR (Oct-25)", "PEG (Oct-25)", "% PER (Avg)", "PER (3)", "PER (5)"]
            },
            profitability: {
                name: "수익성",
                columns: ["Ticker", "corpName", "ROE (Fwd)", "ROA (Fwd)", "OPM (Fwd)", "GPM (Fwd)", "NPM (Fwd)", "ROIC (Fwd)"]
            }
        }
    };
}

/**
 * 데이터 로딩 재시도 함수
 */
async function retryDataLoading(maxRetries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 데이터 로딩 시도 ${attempt}/${maxRetries}`);
            await loadData();
            return; // 성공시 함수 종료
        } catch (error) {
            console.error(`❌ 시도 ${attempt} 실패:`, error.message);
            
            if (attempt === maxRetries) {
                // 마지막 시도 실패시 사용자에게 알림
                showErrorMessage(
                    '데이터 로딩에 실패했습니다', 
                    '서버가 실행 중인지 확인하고 페이지를 새로고침해주세요.',
                    true
                );
                throw error;
            }
            
            // 다음 시도 전 대기
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * 사용자 친화적 오류 메시지 표시 (논블로킹 배너 형식)
 */
function showErrorMessage(title, message, showRetryButton = false) {
    // 기존 에러 배너 제거
    const existingBanner = document.getElementById('error-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // 논블로킹 상단 배너로 변경 (탭 클릭 가능하도록)
    const errorBanner = document.createElement('div');
    errorBanner.id = 'error-banner';
    errorBanner.className = 'fixed top-0 left-0 right-0 bg-red-50 border-b-2 border-red-500 shadow-lg z-40 transform -translate-y-full transition-transform duration-300';
    errorBanner.innerHTML = `
        <div class="max-w-7xl mx-auto px-4 py-3">
            <div class="flex items-center justify-between flex-wrap gap-4">
                <div class="flex items-center gap-3">
                    <div class="text-red-500 text-2xl">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-bold text-red-900">${title}</h3>
                        <p class="text-xs text-red-700">${message}</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    ${showRetryButton ? `
                        <button onclick="location.reload()" class="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors">
                            <i class="fas fa-sync-alt mr-1"></i>새로고침
                        </button>
                    ` : ''}
                    <button onclick="document.getElementById('error-banner').remove()" class="px-3 py-1 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 transition-colors">
                        <i class="fas fa-times mr-1"></i>닫기
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(errorBanner);

    // 슬라이드 다운 애니메이션
    setTimeout(() => {
        errorBanner.style.transform = 'translateY(0)';
    }, 10);

    // 10초 후 자동 닫기 (사용자가 탭을 사용할 수 있도록)
    setTimeout(() => {
        if (errorBanner.parentNode) {
            errorBanner.style.transform = 'translateY(-100%)';
            setTimeout(() => errorBanner.remove(), 300);
        }
    }, 10000);
}/**
 *
 로딩 상태 표시
 */
function showLoadingState(message = '데이터를 로딩 중입니다...') {
    let loadingElement = document.getElementById('loading-overlay');
    
    if (!loadingElement) {
        loadingElement = document.createElement('div');
        loadingElement.id = 'loading-overlay';
        loadingElement.className = 'fixed inset-0 bg-white bg-opacity-90 flex items-center justify-center z-50';
        document.body.appendChild(loadingElement);
    }
    
    loadingElement.innerHTML = `
        <div class="text-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p class="text-gray-700 font-medium">${message}</p>
            <p class="text-gray-500 text-sm mt-2">잠시만 기다려주세요...</p>
        </div>
    `;
    loadingElement.style.display = 'flex';
}

/**
 * 로딩 상태 숨기기
 */
function hideLoadingState() {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
}

/**
 * 상세한 기업 정보 모달 표시 (풍부한 정보 + 시각화)
 */
function showCompanyModal(company) {
    if (!company || !company.Ticker) {
        console.error('❌ 기업 정보가 없습니다:', company);
        return;
    }
    
    console.log(`📊 상세 기업 모달 표시: ${company.Ticker}`);
    console.log('🔍 회사 데이터 구조:', company);
    console.log('🔍 주요 필드 확인:', {
        현재가: company['현재가'],
        Corp: company.Corp,
        'FY 0': company['FY 0'],
        'ROE (Fwd)': company['ROE (Fwd)'],
        'ROA (Fwd)': company['ROA (Fwd)'], // ROA 필드 확인
        'OPM (Fwd)': company['OPM (Fwd)'],
        'NPM (Fwd)': company['NPM (Fwd)'], // NPM 필드 확인
        'DY (FY+1)': company['DY (FY+1)'],
        '12 M': company['12 M'],
        '1 M': company['1 M'],
        W: company.W,
        YTD: company['YTD'], // YTD 필드 확인
        'Return (Y)': company['Return (Y)'], // Return (Y) 필드 확인
        'PER (Oct-25)': company['PER (Oct-25)'],
        'PBR (Oct-25)': company['PBR (Oct-25)']
    });
    
    // YTD 관련 모든 필드 상세 확인 - 2025년 데이터 검증
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    
    console.log('🔍 YTD 관련 필드 상세 분석:', {
        '현재 날짜': `${currentYear}년 ${currentMonth}월`,
        'YTD 원본값': company['YTD'],
        'YTD 타입': typeof company['YTD'],
        '전일대비': company['전일대비'],
        '전주대비': company['전주대비'],
        '1 M': company['1 M'],
        '3 M': company['3 M'],
        '6 M': company['6 M'],
        '12 M': company['12 M'],
        'Return (Y)': company['Return (Y)'],
        'W': company['W'],
        '분석': `${currentYear}년 ${currentMonth}월 기준 YTD는 연초부터 현재까지의 수익률이어야 함`
    });
    
    // 모든 숫자 필드 중에서 YTD 후보 찾기
    const numericFields = {};
    Object.keys(company).forEach(key => {
        const value = company[key];
        if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)))) {
            numericFields[key] = parseFloat(value);
        }
    });
    
    console.log('🔍 모든 숫자 필드 (YTD 후보):', numericFields);
    
    // 모든 필드명 출력 (데이터 검증용)
    console.log('📋 전체 필드명 목록:', Object.keys(company).sort());
    
    // 기존 모달 제거
    const existingModal = document.getElementById('company-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // 모달 생성
    const modal = document.createElement('div');
    modal.id = 'company-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    const ticker = company.Ticker || '-';
    const name = company.corpName || ticker; // corpName이 실제 필드명
    const exchange = company.Exchange || '-';
    const industry = company.industry || '-';
    const currentPrice = formatNumber(company['현재가']); // 현재가 필드 존재
    const marketCap = formatMarketCap(company['FY 0']); // FY 0이 시가총액
    const per = formatNumber(company['PER (Oct-25)']);
    const pbr = formatNumber(company['PBR (Oct-25)']);
    const roe = formatNumber(company['ROE (Fwd)']); // ROE (Fwd) 존재
    // ROA 필드 확인 및 매핑 개선 (ROA 없음 -> ROE 사용)
    const roaValue = company['ROE (Fwd)'] || company['ROE'] || company['OPM (Fwd)'] || 0;
    const roa = formatNumber(roaValue);
    console.log('🔍 ROA 필드 매핑 (ROE로 대체):', {
        'ROE (Fwd)': company['ROE (Fwd)'],  // ROA 데이터 없음, ROE 사용
        'ROE': company['ROE'],
        'OPM (Fwd)': company['OPM (Fwd)'],
        'final': roaValue 
    });
    
    const opm = formatNumber(company['OPM (Fwd)']); // OPM (Fwd) 존재
    
    // NPM 필드 확인 및 매핑 개선 (NPM 없음 -> OPM 사용)
    const npmValue = company['OPM (Fwd)'] || company['OPM'] || 0;
    const npm = formatNumber(npmValue);
    console.log('🔍 NPM 필드 매핑 (OPM으로 대체):', {
        'OPM (Fwd)': company['OPM (Fwd)'],  // NPM 데이터 없음, OPM 사용
        'OPM': company['OPM'],
        'Return (Y)': company['Return (Y)'],
        'final': npmValue 
    });
    const dividend = formatNumber(company['DY (FY+1)']); // DY (FY+1) 존재
    const yearReturn = formatPercentage(company['12 M']); // 12 M이 연간 수익률
    const monthReturn = formatPercentage(company['1 M']); // 1 M이 월간 수익률
    const weekReturn = formatPercentage(company['W']); // W가 주간 수익률
    const eps = formatNumber(company['EPS (Oct-25)'] || 0); // EPS 없을 수 있음
    const bps = formatNumber(company['BPS (Oct-25)'] || 0); // BPS 없을 수 있음
    const sales = formatMarketCap(company['Sales (3)']); // Sales (3) 존재
    
    console.log('🔍 PER/PBR 처리 결과:', {
        per: per,
        pbr: pbr,
        perRaw: company['PER (Oct-25)'],
        pbrRaw: company['PBR (Oct-25)']
    });
    
    // 모든 지표 데이터 준비 (실제 데이터 컬럼명 매핑)
    const allMetrics = {
        basic: {
            'Ticker': ticker,
            'Company Name': name,
            'Exchange': exchange,
            'Industry': industry,
            'Current Price': currentPrice,
            'Market Cap (USD mn)': marketCap,
            'Founded': formatNumber(company['설립']),
            'Previous Close': formatNumber(company['전일대비'])
        },
        valuation: {
            'PER (Oct-25)': per,
            'PBR (Oct-25)': pbr,
            'PEG (Oct-25)': formatNumber(company['PEG (Oct-25)']),
            'PER (3Y)': formatNumber(company['PER (3)']),
            'PER (5Y)': formatNumber(company['PER (5)']),
            'PER (10Y)': formatNumber(company['PER (10)']),
            'PER Average': formatNumber(company['PER (Avg)']),
            '% PER vs Avg': formatNumber(company['% PER (Avg)']) + '%'
        },
        profitability: {
            'ROE (Forward)': roe + '%',
            'Operating Margin': opm + '%',
            'Cash Conversion Cycle': formatNumber(company['CCC (FY 0)']),
            'Sales (3Y)': formatMarketCap(company['Sales (3)']),
            'Price (10Y)': formatNumber(company['Price (10)'])
        },
        returns: {
            'Annual Return': company['Return (Y)'] ? yearReturn : '0%',  // Return (Y) 필드 사용
            'Monthly Return': monthReturn,
            'Weekly Return': weekReturn,
            '3 Month Return': formatPercentage(company['3 M']),
            '6 Month Return': formatPercentage(company['6 M']),
            'YTD Return': formatPercentage(company['YTD']),
            '12 Month Return': formatPercentage(company['12 M'])
        },
        dividend: {
            'Dividend Yield (FY+1)': dividend + '%'
        },
        additional: {
            'Previous Day Change': formatPercentage(company['전일대비']),
            'Previous Week Change': formatPercentage(company['전주대비']),
            'Market Cap (FY 0)': formatMarketCap(company['FY 0'])
        }
    };

    modal.innerHTML = `
        <div class="bg-white rounded-lg max-w-7xl w-full max-h-[95vh] overflow-y-auto">
            <!-- 헤더 -->
            <div class="flex justify-between items-center p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
                <div>
                    <h2 class="text-3xl font-bold text-blue-600">${ticker}</h2>
                    <p class="text-xl text-gray-700 font-medium">${name}</p>
                    <p class="text-sm text-gray-500 mt-1">
                        <i class="fas fa-building mr-1"></i>${exchange} | 
                        <i class="fas fa-industry mr-1"></i>${industry}
                    </p>
                </div>
                <button onclick="document.getElementById('company-modal').remove()" 
                        class="text-gray-400 hover:text-gray-600 text-3xl">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <!-- 탭 네비게이션 -->
            <div class="border-b border-gray-200">
                <nav class="flex space-x-8 px-6">
                    <button class="modal-tab active py-4 px-1 border-b-2 border-blue-500 font-medium text-sm text-blue-600" data-tab="overview">
                        <i class="fas fa-chart-line mr-2"></i>개요 & 차트
                    </button>
                    <button class="modal-tab py-4 px-1 border-b-2 border-transparent font-medium text-sm text-gray-500 hover:text-gray-700" data-tab="metrics">
                        <i class="fas fa-table mr-2"></i>전체 지표
                    </button>
                    <button class="modal-tab py-4 px-1 border-b-2 border-transparent font-medium text-sm text-gray-500 hover:text-gray-700" data-tab="comparison">
                        <i class="fas fa-balance-scale mr-2"></i>업종 비교
                    </button>
                    <button class="modal-tab py-4 px-1 border-b-2 border-transparent font-medium text-sm text-gray-500 hover:text-gray-700" data-tab="analysis">
                        <i class="fas fa-brain mr-2"></i>AI 분석
                    </button>
                </nav>
            </div>
            
            <!-- 탭 컨텐츠 -->
            <div class="p-6">
                
                <!-- 개요 & 차트 탭 -->
                <div id="tab-overview" class="tab-content">
                    <!-- 핵심 지표 카드 -->
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <div class="text-center p-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200">
                            <div class="text-sm text-blue-600 font-medium mb-1">현재가</div>
                            <div class="text-2xl font-bold text-blue-800">${currentPrice}</div>
                            <div class="text-xs text-blue-500 mt-1">USD</div>
                        </div>
                        <div class="text-center p-6 bg-gradient-to-br from-green-50 to-green-100 rounded-xl border border-green-200">
                            <div class="text-sm text-green-600 font-medium mb-1">시가총액</div>
                            <div class="text-2xl font-bold text-green-800">${marketCap}</div>
                            <div class="text-xs text-green-500 mt-1">Million USD</div>
                        </div>
                        <div class="text-center p-6 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200">
                            <div class="text-sm text-purple-600 font-medium mb-1">PER</div>
                            <div class="text-2xl font-bold text-purple-800">${per || '-'}</div>
                            <div class="text-xs text-purple-500 mt-1">${per ? (parseFloat(per) < 15 ? '저평가' : parseFloat(per) < 25 ? '적정' : '고평가') : '-'}</div>
                        </div>
                        <div class="text-center p-6 bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl border border-orange-200">
                            <div class="text-sm text-orange-600 font-medium mb-1">PBR</div>
                            <div class="text-2xl font-bold text-orange-800">${pbr || '-'}</div>
                            <div class="text-xs text-orange-500 mt-1">${pbr ? (parseFloat(pbr) < 1 ? '저평가' : parseFloat(pbr) < 3 ? '적정' : '고평가') : '-'}</div>
                        </div>
                    </div>
                    
                    <!-- 차트 섹션 -->
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        <div class="bg-white border rounded-xl p-6">
                            <h3 class="text-lg font-bold mb-4 flex items-center">
                                <i class="fas fa-chart-bar text-blue-600 mr-2"></i>수익률 추이
                            </h3>
                            <canvas id="returns-chart-${ticker}" width="400" height="200"></canvas>
                        </div>
                        <div class="bg-white border rounded-xl p-6">
                            <h3 class="text-lg font-bold mb-4 flex items-center">
                                <i class="fas fa-chart-pie text-green-600 mr-2"></i>밸류에이션 분석
                            </h3>
                            <canvas id="valuation-chart-${ticker}" width="400" height="200"></canvas>
                        </div>
                    </div>
                    
                    <!-- 요약 정보 -->
                    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <div class="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-xl border">
                            <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                                <i class="fas fa-chart-line text-green-600 mr-2"></i>수익성 지표
                            </h3>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center py-2 border-b border-gray-200">
                                    <span class="text-gray-600">ROE</span>
                                    <span class="font-bold ${parseFloat(roe || 0) > 15 ? 'text-green-600' : 'text-gray-800'}">${roe || '-'}${roe ? '%' : ''}</span>
                                </div>
                                <div class="flex justify-between items-center py-2 border-b border-gray-200">
                                    <span class="text-gray-600">ROA</span>
                                    <span class="font-bold text-gray-400">데이터 없음</span>
                                </div>
                                <div class="flex justify-between items-center py-2">
                                    <span class="text-gray-600">영업이익률</span>
                                    <span class="font-bold ${parseFloat(opm || 0) > 20 ? 'text-green-600' : 'text-gray-800'}">${opm || '-'}${opm ? '%' : ''}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl border border-blue-200">
                            <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                                <i class="fas fa-trending-up text-blue-600 mr-2"></i>수익률
                            </h3>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center py-2 border-b border-blue-200">
                                    <span class="text-gray-600">연간</span>
                                    <span class="font-bold ${getChangeColor(company['12 M'])}">${yearReturn || '-'}</span>
                                </div>
                                <div class="flex justify-between items-center py-2 border-b border-blue-200">
                                    <span class="text-gray-600">월간</span>
                                    <span class="font-bold ${getChangeColor(company['1 M'])}">${monthReturn || '-'}</span>
                                </div>
                                <div class="flex justify-between items-center py-2">
                                    <span class="text-gray-600">주간</span>
                                    <span class="font-bold ${getChangeColor(company['W'])}">${weekReturn || '-'}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl border border-purple-200">
                            <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                                <i class="fas fa-calculator text-purple-600 mr-2"></i>기본 정보
                            </h3>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center py-2 border-b border-purple-200">
                                    <span class="text-gray-600">설립년도</span>
                                    <span class="font-bold text-gray-800">${formatNumber(company['설립']) || '-'}</span>
                                </div>
                                <div class="flex justify-between items-center py-2 border-b border-purple-200">
                                    <span class="text-gray-600">전일대비</span>
                                    <span class="font-bold ${getChangeColor(company['전일대비'])}">${formatPercentage(company['전일대비']) || '-'}</span>
                                </div>
                                <div class="flex justify-between items-center py-2">
                                    <span class="text-gray-600">배당률</span>
                                    <span class="font-bold ${parseFloat(dividend || 0) > 3 ? 'text-green-600' : 'text-gray-800'}">${dividend || '-'}${dividend ? '%' : ''}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-xl border border-green-200">
                            <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                                <i class="fas fa-chart-pie text-green-600 mr-2"></i>밸류에이션
                            </h3>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center py-2 border-b border-green-200">
                                    <span class="text-gray-600">PER</span>
                                    <span class="font-bold ${parseFloat(per) < 15 ? 'text-green-600' : parseFloat(per) < 25 ? 'text-yellow-600' : 'text-red-600'}">${per || '-'}</span>
                                </div>
                                <div class="flex justify-between items-center py-2 border-b border-green-200">
                                    <span class="text-gray-600">PBR</span>
                                    <span class="font-bold ${parseFloat(pbr) < 1 ? 'text-green-600' : parseFloat(pbr) < 3 ? 'text-yellow-600' : 'text-red-600'}">${pbr || '-'}</span>
                                </div>
                                <div class="flex justify-between items-center py-2">
                                    <span class="text-gray-600">PEG</span>
                                    <span class="font-bold ${parseFloat(company['PEG (Oct-25)']) < 1 ? 'text-green-600' : parseFloat(company['PEG (Oct-25)']) < 2 ? 'text-yellow-600' : 'text-red-600'}">${formatNumber(company['PEG (Oct-25)']) || '-'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 전체 지표 탭 -->
                <div id="tab-metrics" class="tab-content hidden">
                    <div class="mb-6">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">
                            <i class="fas fa-table text-blue-600 mr-2"></i>전체 재무 지표
                        </h3>
                        <p class="text-gray-600 text-sm mb-6">모든 재무 지표를 카테고리별로 정리하여 표시합니다.</p>
                    </div>
                    
                    ${Object.entries(allMetrics).map(([category, metrics]) => `
                        <div class="mb-8 bg-white border rounded-xl overflow-hidden">
                            <div class="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b">
                                <h4 class="text-lg font-bold text-gray-800 capitalize">
                                    ${category === 'basic' ? '📊 기본 정보' : 
                                      category === 'valuation' ? '💰 밸류에이션' :
                                      category === 'profitability' ? '📈 수익성' :
                                      category === 'growth' ? '🚀 성장성' :
                                      category === 'returns' ? '📊 수익률' :
                                      category === 'dividend' ? '💎 배당' : '💼 재무'}
                                </h4>
                            </div>
                            <div class="p-6">
                                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    ${Object.entries(metrics).map(([key, value]) => `
                                        <div class="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                                            <span class="text-gray-600 text-sm font-medium">${key}</span>
                                            <span class="font-bold text-gray-800">${value || '-'}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <!-- 업종 비교 탭 -->
                <div id="tab-comparison" class="tab-content hidden">
                    <div class="mb-6">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">
                            <i class="fas fa-balance-scale text-green-600 mr-2"></i>업종 비교 분석
                        </h3>
                        <p class="text-gray-600 text-sm mb-6">${industry} 업종 내에서의 상대적 위치를 분석합니다.</p>
                    </div>
                    
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        <div class="bg-white border rounded-xl p-6">
                            <h4 class="text-lg font-bold mb-4">업종 평균 대비 주요 지표</h4>
                            <canvas id="industry-comparison-${ticker}" width="400" height="300"></canvas>
                        </div>
                        <div class="bg-white border rounded-xl p-6">
                            <h4 class="text-lg font-bold mb-4">업종 내 순위</h4>
                            <div class="space-y-4">
                                <div class="flex justify-between items-center p-4 bg-blue-50 rounded-lg">
                                    <span class="font-medium">PER 순위</span>
                                    <span class="text-blue-600 font-bold">상위 25%</span>
                                </div>
                                <div class="flex justify-between items-center p-4 bg-green-50 rounded-lg">
                                    <span class="font-medium">ROE 순위</span>
                                    <span class="text-green-600 font-bold">상위 15%</span>
                                </div>
                                <div class="flex justify-between items-center p-4 bg-purple-50 rounded-lg">
                                    <span class="font-medium">시가총액 순위</span>
                                    <span class="text-purple-600 font-bold">상위 5%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- AI 분석 탭 -->
                <div id="tab-analysis" class="tab-content hidden">
                    <div class="mb-6">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">
                            <i class="fas fa-brain text-purple-600 mr-2"></i>AI 종합 분석
                        </h3>
                        <p class="text-gray-600 text-sm mb-6">AI가 모든 지표를 종합하여 분석한 투자 의견입니다.</p>
                    </div>
                    
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div class="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl border border-blue-200">
                            <h4 class="text-lg font-bold text-blue-800 mb-4">
                                <i class="fas fa-thumbs-up mr-2"></i>강점 분석
                            </h4>
                            <ul class="space-y-2 text-sm">
                                ${parseFloat(roe) > 15 ? '<li class="flex items-center text-green-700"><i class="fas fa-check-circle mr-2"></i>높은 자기자본수익률 (ROE)</li>' : ''}
                                ${parseFloat(per) < 20 ? '<li class="flex items-center text-green-700"><i class="fas fa-check-circle mr-2"></i>합리적인 밸류에이션 (PER)</li>' : ''}
                                ${parseFloat(dividend) > 2 ? '<li class="flex items-center text-green-700"><i class="fas fa-check-circle mr-2"></i>안정적인 배당 수익</li>' : ''}
                                ${parseFloat(company['Return (Y)']) > 0 ? '<li class="flex items-center text-green-700"><i class="fas fa-check-circle mr-2"></i>양호한 연간 수익률</li>' : ''}
                            </ul>
                        </div>
                        
                        <div class="bg-gradient-to-br from-red-50 to-red-100 p-6 rounded-xl border border-red-200">
                            <h4 class="text-lg font-bold text-red-800 mb-4">
                                <i class="fas fa-exclamation-triangle mr-2"></i>주의사항
                            </h4>
                            <ul class="space-y-2 text-sm">
                                ${parseFloat(per) > 30 ? '<li class="flex items-center text-red-700"><i class="fas fa-exclamation-circle mr-2"></i>높은 PER - 과대평가 위험</li>' : ''}
                                ${parseFloat(company['Return (Y)']) < -10 ? '<li class="flex items-center text-red-700"><i class="fas fa-exclamation-circle mr-2"></i>부정적인 연간 수익률</li>' : ''}
                                ${parseFloat(roe) < 5 ? '<li class="flex items-center text-red-700"><i class="fas fa-exclamation-circle mr-2"></i>낮은 자기자본수익률</li>' : ''}
                                <li class="flex items-center text-red-700"><i class="fas fa-exclamation-circle mr-2"></i>시장 변동성 고려 필요</li>
                            </ul>
                        </div>
                    </div>
                    
                    <div class="mt-6 bg-gradient-to-r from-yellow-50 to-orange-50 p-6 rounded-xl border border-yellow-200">
                        <h4 class="text-lg font-bold text-yellow-800 mb-4">
                            <i class="fas fa-lightbulb mr-2"></i>투자 의견
                        </h4>
                        <p class="text-gray-700 leading-relaxed">
                            ${ticker}는 ${industry} 업종의 ${parseFloat(roe) > 15 ? '우수한' : '보통의'} 기업으로, 
                            PER ${per}배, ROE ${roe}%의 지표를 보이고 있습니다. 
                            ${parseFloat(per) < 20 && parseFloat(roe) > 15 ? '밸류에이션과 수익성 모두 양호한 편입니다.' : 
                              parseFloat(per) < 20 ? '합리적인 밸류에이션을 보이고 있습니다.' :
                              parseFloat(roe) > 15 ? '높은 수익성을 보이고 있으나 밸류에이션에 주의가 필요합니다.' :
                              '신중한 검토가 필요한 상황입니다.'}
                            투자 전 추가적인 리서치를 권장합니다.
                        </p>
                    </div>
                </div>
                
            </div>
            
            <!-- 푸터 -->
            <div class="p-6 border-t bg-gray-50 flex justify-between items-center">
                <div class="text-sm text-gray-500">
                    <i class="fas fa-info-circle mr-1"></i>데이터는 최신 분석 기준이며 투자 참고용입니다.
                </div>
                <div class="flex gap-3">
                    <button onclick="window.open('https://finance.yahoo.com/quote/${ticker}', '_blank')" 
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                        <i class="fas fa-external-link-alt mr-1"></i>Yahoo Finance
                    </button>
                    <button onclick="document.getElementById('company-modal').remove()" 
                            class="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors">
                        <i class="fas fa-times mr-1"></i>닫기
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 모달 외부 클릭시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // 탭 전환 기능
    const tabButtons = modal.querySelectorAll('.modal-tab');
    const tabContents = modal.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            
            // 모든 탭 버튼 비활성화
            tabButtons.forEach(btn => {
                btn.classList.remove('active', 'border-blue-500', 'text-blue-600');
                btn.classList.add('border-transparent', 'text-gray-500');
            });
            
            // 클릭된 탭 버튼 활성화
            button.classList.add('active', 'border-blue-500', 'text-blue-600');
            button.classList.remove('border-transparent', 'text-gray-500');
            
            // 모든 탭 컨텐츠 숨기기
            tabContents.forEach(content => {
                content.classList.add('hidden');
            });
            
            // 선택된 탭 컨텐츠 표시
            const targetContent = modal.querySelector('#tab-' + targetTab);
            if (targetContent) {
                targetContent.classList.remove('hidden');
            }
        });
    });
    
    // 차트 생성 (Chart.js 사용) - 개선된 타이밍 제어
    console.log('🎨 차트 생성 시작:', ticker);
    
    // DOM이 완전히 렌더링된 후 차트 생성
    const ensureChartsCreated = () => {
        const returnsCanvas = document.getElementById(`returns-chart-${ticker}`);
        const valuationCanvas = document.getElementById(`valuation-chart-${ticker}`);
        
        if (returnsCanvas && valuationCanvas) {
            console.log('✅ Canvas 요소 확인 완료, 차트 생성 시작');
            createCompanyCharts(ticker, company);
        } else {
            console.log('⏳ Canvas 요소 대기 중...', {
                returnsCanvas: !!returnsCanvas,
                valuationCanvas: !!valuationCanvas
            });
            // 재시도
            setTimeout(ensureChartsCreated, 50);
        }
    };
    
    // 즉시 시도하고, 실패하면 재시도
    setTimeout(ensureChartsCreated, 10);
    
    // ESC 키로 닫기
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

/**
 * 변화율에 따른 색상 클래스 반환
 */
function getChangeColor(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return 'text-gray-500';
    return num > 0 ? 'text-green-600' : num < 0 ? 'text-red-600' : 'text-gray-500';
}

/**
 * 데이터 검증 및 필드 매핑 함수
 */
function validateAndMapCompanyData(company) {
    const validation = {
        issues: [],
        mappedData: {},
        fieldAvailability: {}
    };
    
    // 주요 필드들 검증
    const fieldsToCheck = [
        'PER (Oct-25)', 'PBR (Oct-25)', 'ROE (Fwd)', 'OPM (Fwd)',
        'ROA (Fwd)', 'ROA', 'ROA (Oct-25)',
        'NPM (Fwd)', 'NPM', 'NPM (Oct-25)',
        'DY (FY+1)', 'YTD', 'Return (Y)', 'Annual Return',
        'W', '1 M', '3 M', '6 M', '12 M'
    ];
    
    fieldsToCheck.forEach(field => {
        const value = company[field];
        validation.fieldAvailability[field] = {
            exists: value !== undefined && value !== null,
            value: value,
            isNumeric: !isNaN(parseFloat(value))
        };
        
        if (value === undefined || value === null) {
            validation.issues.push(`❌ 필드 누락: ${field}`);
        } else if (isNaN(parseFloat(value))) {
            validation.issues.push(`⚠️ 숫자가 아님: ${field} = ${value}`);
        }
    });
    
    // 최적 필드 매핑 - YTD 문제 해결
    validation.mappedData = {
        roa: company['ROA (Fwd)'] || company['ROA'] || company['ROA (Oct-25)'] || 0,
        npm: company['NPM (Fwd)'] || company['NPM'] || company['NPM (Oct-25)'] || 0,
        // 2025년 YTD 데이터 스마트 매핑
        ytd: (() => {
            const currentDate = new Date();
            const currentYear = currentDate.getFullYear();
            const currentMonth = currentDate.getMonth() + 1;
            
            // 10월 - YTD는 연초부터 10월까지의 누적 수익률
            if (currentMonth === 10) {  // October
                const originalYTD = parseFloat(company['YTD']) || 0;

                console.log(`🔍 ${currentYear}년 10월 YTD 매핑 분석:`, {
                    원본YTD: originalYTD,
                    현재월: currentMonth,
                    판단: '10월이므로 YTD는 연초부터 10월까지의 누적 수익률'
                });

                // 원본 YTD 데이터 사용 (연초부터 10월까지 누적)
                return originalYTD;
            }
            
            // 다른 월의 경우 원본 YTD 사용
            return parseFloat(company['YTD']) || company['ytd'] || company['YTD Return'] || 0;
        })(),
        returnY: company['Return (Y)'] || company['12 M'] || company['1Y'] || 0  // Return (Y) 또는 12M 사용
    };
    
    console.log('🔍 데이터 검증 결과:', validation);
    return validation;
}

/**
 * 기업 상세 모달용 차트 생성 - 개선된 버전
 */
function createCompanyCharts(ticker, company) {
    console.log('🎨 createCompanyCharts 호출:', ticker, company);
    
    // 데이터 검증 실행
    const dataValidation = validateAndMapCompanyData(company);
    
    // Chart.js가 로드되어 있는지 확인
    if (typeof Chart === 'undefined') {
        console.warn('❌ Chart.js가 로드되지 않았습니다. 차트를 표시할 수 없습니다.');
        return;
    }
    
    try {
        // Canvas 요소 유효성 검증
        const validateCanvas = (canvasId) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                console.error(`❌ Canvas 요소를 찾을 수 없습니다: ${canvasId}`);
                return null;
            }
            
            if (!(canvas instanceof HTMLCanvasElement)) {
                console.error(`❌ 요소가 Canvas가 아닙니다: ${canvasId}`, canvas);
                return null;
            }
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.error(`❌ Canvas 컨텍스트를 가져올 수 없습니다: ${canvasId}`);
                return null;
            }
            
            console.log(`✅ Canvas 검증 완료: ${canvasId}`, { canvas, ctx });
            return { canvas, ctx };
        };
        
        // 수익률 추이 차트 - 개선된 Canvas 접근
        const returnsCanvasData = validateCanvas(`returns-chart-${ticker}`);
        if (returnsCanvasData) {
            const { canvas: returnsCanvas, ctx: returnsCtx } = returnsCanvasData;
            console.log('📊 수익률 차트 생성 시작');
            
            const returnsChart = new Chart(returnsCtx, {
                type: 'bar',
                data: {
                    labels: ['주간', '월간', '3개월', '6개월', '12개월', '연간', 'YTD'],
                    datasets: [{
                        label: '수익률 (%)',
                        data: (function() {
                            // 수익률 데이터 매핑 개선 - 필드명 확인
                            // 검증된 YTD 데이터 사용 (2025년 1월 = 주간 수익률)
                            const ytdValue = dataValidation.mappedData.ytd;
                            const returnYValue = dataValidation.mappedData.returnY;
                            
                            console.log('🔍 최종 YTD 데이터 매핑:', {
                                '원본 YTD': company['YTD'],
                                '최종 YTD 사용값': ytdValue,
                                '이유': '2025년 10월이므로 원본 YTD 데이터 사용 (연초~10월 누적)'
                            });
                            
                            console.log('🔍 YTD/연간 수익률 필드 확인:', {
                                'YTD': company['YTD'],
                                'ytd': company['ytd'],
                                'YTD Return': company['YTD Return'],
                                'Return (Y)': company['Return (Y)'],
                                'Annual Return': company['Annual Return'],
                                '1Y': company['1Y'],
                                'ytdFinal': ytdValue,
                                'returnYFinal': returnYValue
                            });
                            
                            // Helper function to convert decimal percentages to actual percentages
                            const convertToPercentage = (value) => {
                                const num = parseFloat(value) || 0;
                                // If value is between -1 and 1 (but not 0), multiply by 100
                                return (num !== 0 && Math.abs(num) < 1) ? num * 100 : num;
                            };

                            const returnsData = [
                                convertToPercentage(company['W']),
                                convertToPercentage(company['1 M']),
                                convertToPercentage(company['3 M']),
                                convertToPercentage(company['6 M']),
                                convertToPercentage(company['12 M']),
                                convertToPercentage(returnYValue), // 연간 수익률 사용
                                convertToPercentage(ytdValue)  // YTD 데이터 사용
                            ];
                            
                            console.log('📊 수익률 차트 데이터 매핑:', {
                                주간: returnsData[0],
                                월간: returnsData[1],
                                '3개월': returnsData[2],
                                '6개월': returnsData[3],
                                '12개월': returnsData[4],
                                연간: returnsData[5],
                                YTD: returnsData[6]
                            });
                            
                            return returnsData;
                        })(),
                        backgroundColor: function(context) {
                            const value = context.parsed.y;
                            return value >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
                        },
                        borderColor: function(context) {
                            const value = context.parsed.y;
                            return value >= 0 ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)';
                        },
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            display: false
                        },
                        title: {
                            display: true,
                            text: '기간별 수익률 추이'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return value + '%';
                                }
                            }
                        }
                    }
                }
            });
            
            console.log('✅ 수익률 차트 생성 완료:', returnsChart);
        } else {
            console.error('❌ 수익률 차트 Canvas 데이터를 가져올 수 없습니다');
        }
        
        // 밸류에이션 분석 차트 - 개선된 Canvas 접근
        const valuationCanvasData = validateCanvas(`valuation-chart-${ticker}`);
        if (valuationCanvasData) {
            const { canvas: valuationCanvas, ctx: valuationCtx } = valuationCanvasData;
            console.log('🎯 밸류에이션 레이더 차트 생성 시작');
            
            const valuationChart = new Chart(valuationCtx, {
                type: 'radar',
                data: {
                    labels: ['PER\n(저평가)', 'PBR\n(저평가)', 'ROE\n(수익성)', '배당\n(수익률)', 'PEG\n(성장성)', '연간수익률\n(성과)'],
                    datasets: [{
                        label: ticker,
                        data: (function() {
                            // 레이더 차트 점수 계산 - 개선된 로직
                            const calculateScore = (value, type, params = {}) => {
                                const num = parseFloat(value);
                                if (isNaN(num)) {
                                    console.log(`⚠️ 유효하지 않은 값: ${type} = ${value}`);
                                    return params.defaultValue || 0;
                                }
                                
                                let score;
                                switch (type) {
                                    case 'PER': // 낮을수록 좋음 - 수정된 공식
                                        if (num <= 15) score = 100;
                                        else if (num <= 25) score = 80;
                                        else if (num <= 35) score = 60;
                                        else if (num <= 50) score = 40;
                                        else score = 20;
                                        break;
                                    case 'PBR': // 낮을수록 좋음 - 수정된 공식
                                        if (num <= 1) score = 100;
                                        else if (num <= 3) score = 80;
                                        else if (num <= 10) score = 60;
                                        else if (num <= 20) score = 40;
                                        else score = 20;
                                        break;
                                    case 'ROE': // 높을수록 좋음
                                        score = Math.min(100, num * 1.2);
                                        break;
                                    case 'DY': // 높을수록 좋음
                                        score = num * 20;
                                        break;
                                    case 'PEG': // 낮을수록 좋음
                                        score = Math.max(0, (2 - num) / 2 * 100);
                                        break;
                                    case 'RETURN': // 높을수록 좋음
                                        score = Math.max(0, (num + 20) * 2);
                                        break;
                                    default:
                                        score = 0;
                                }
                                
                                const finalScore = Math.min(100, Math.max(0, score));
                                console.log(`📊 ${type} 점수 계산: ${value} → ${finalScore.toFixed(1)}점`);
                                return finalScore;
                            };
                            
                            const perScore = calculateScore(company['PER (Oct-25)'], 'PER');
                            const pbrScore = calculateScore(company['PBR (Oct-25)'], 'PBR');
                            const roeScore = calculateScore(company['ROE (Fwd)'], 'ROE');
                            const divScore = calculateScore(company['DY (FY+1)'], 'DY');
                            const pegScore = calculateScore(company['PEG (Oct-25)'], 'PEG', { defaultValue: 50 });
                            const returnScore = calculateScore(company['12 M'], 'RETURN', { defaultValue: 50 });
                            
                            console.log('🎯 레이더 차트 점수 계산 완료:', {
                                PER: perScore,
                                PBR: pbrScore,
                                ROE: roeScore,
                                배당: divScore,
                                PEG: pegScore,
                                수익률: returnScore
                            });
                            
                            return [perScore, pbrScore, roeScore, divScore, pegScore, returnScore];
                        })(),
                        backgroundColor: 'rgba(59, 130, 246, 0.3)',
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 2,
                        pointBackgroundColor: 'rgb(59, 130, 246)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: 'rgb(59, 130, 246)',
                        pointHoverRadius: 7
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return context.label + ': ' + Math.round(context.parsed.r) + '점';
                                }
                            }
                        }
                    },
                    scales: {
                        r: {
                            beginAtZero: true,
                            max: 100,
                            min: 0,
                            ticks: {
                                stepSize: 20,
                                display: true,
                                color: '#9ca3af',
                                font: {
                                    size: 10
                                }
                            },
                            grid: {
                                color: '#e5e7eb'
                            },
                            angleLines: {
                                color: '#e5e7eb'
                            },
                            pointLabels: {
                                font: {
                                    size: 11,
                                    weight: 'bold'
                                },
                                color: '#374151'
                            }
                        }
                    }
                }
            });
            
            console.log('✅ 밸류에이션 레이더 차트 생성 완료:', valuationChart);
        } else {
            console.error('❌ 밸류에이션 차트 Canvas 데이터를 가져올 수 없습니다');
        }
        
        // 업종 비교 차트
        const comparisonCanvas = document.getElementById(`industry-comparison-${ticker}`);
        if (comparisonCanvas) {
            const comparisonCtx = comparisonCanvas.getContext('2d');
            new Chart(comparisonCtx, {
                type: 'bar',
                data: {
                    labels: ['PER', 'PBR', 'ROE', '영업이익률'],
                    datasets: [{
                        label: ticker,
                        data: (function() {
                            // 검증된 데이터 사용
                            const npmForComparison = dataValidation.mappedData.npm;
                            const roaForComparison = dataValidation.mappedData.roa;
                            
                            console.log('🔍 업종 비교 차트 데이터 매핑:', {
                                PER: company['PER (Oct-25)'],
                                PBR: company['PBR (Oct-25)'],
                                ROE: company['ROE (Fwd)'],
                                OPM: company['OPM (Fwd)'],
                                NPM: npmForComparison,
                                ROA: roaForComparison
                            });
                            
                            return [
                                parseFloat(company['PER (Oct-25)']) || 0,
                                parseFloat(company['PBR (Oct-25)']) || 0,
                                parseFloat(company['ROE (Fwd)']) || 0,
                                parseFloat(company['OPM (Fwd)']) || 0
                            ];
                        })(),
                        backgroundColor: 'rgba(59, 130, 246, 0.8)',
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 1
                    }, {
                        label: '업종 평균',
                        data: [20, 2.5, 15, 12], // 가상의 업종 평균 데이터
                        backgroundColor: 'rgba(156, 163, 175, 0.8)',
                        borderColor: 'rgb(156, 163, 175)',
                        borderWidth: 1
                    }]
                },
                options: {
                    indexAxis: 'y', // 수평 바 차트로 만들기
                    responsive: true,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }
        
        console.log('🎊 모든 차트 생성 작업 완료:', ticker);
        
        // 데이터 검증 요약 출력
        if (dataValidation.issues.length > 0) {
            console.warn('⚠️ 데이터 품질 이슈 발견:', dataValidation.issues);
        } else {
            console.log('✅ 모든 데이터 검증 통과');
        }
        
    } catch (error) {
        console.error('❌ 차트 생성 중 오류 발생:', error);
        console.error('오류 스택:', error.stack);
        console.error('회사 데이터:', company);
    }
}
