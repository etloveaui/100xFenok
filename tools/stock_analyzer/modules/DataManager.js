/**
 * DataManager 모듈
 * 전체 데이터 관리, 상태 추적, 캐싱 담당
 */

class DataManager {
    constructor() {
        this.allData = [];
        this.metadata = {};
        this.columnConfig = {};
        this.indices = {
            quality: [],
            value: [],
            momentum: []
        };
        
        // 캐시
        this.cache = {
            filteredData: new Map(),
            sortedData: new Map(),
            searchResults: new Map()
        };
        
        // 이벤트 리스너
        this.eventListeners = new Map();
    }
    
    /**
     * 데이터 로딩
     */
    async loadData() {
        console.log("DataManager: Loading enhanced data...");
        
        try {
            // 강화된 데이터, 컬럼 설정, 앱 설정 병렬 로딩
            const [enhancedRes, columnConfigRes, appConfigRes] = await Promise.all([
                fetch('./data/enhanced_summary_data.json'),
                fetch('./data/column_config.json'),
                fetch('./stock_analyzer_config.json')
            ]);

            if (!enhancedRes.ok) {
                throw new Error(`Failed to load enhanced data: ${enhancedRes.status}`);
            }
            
            if (!columnConfigRes.ok) {
                throw new Error(`Failed to load column config: ${columnConfigRes.status}`);
            }

            // JSON 파싱
            const enhancedData = await enhancedRes.json();
            this.columnConfig = await columnConfigRes.json();
            
            if (appConfigRes.ok) {
                this.appConfig = await appConfigRes.json();
            }

            // 데이터 추출
            if (enhancedData.companies && Array.isArray(enhancedData.companies)) {
                this.allData = enhancedData.companies;
                this.metadata = enhancedData.metadata || {};
            } else if (Array.isArray(enhancedData)) {
                this.allData = enhancedData;
                this.metadata = {};
            } else {
                throw new Error('Enhanced data is not in expected format');
            }

            console.log(`DataManager: Loaded ${this.allData.length} companies with ${this.metadata.total_columns || 31} indicators`);
            
            // 데이터 로딩 완료 이벤트 발생
            this.emit('dataLoaded', {
                companies: this.allData,
                metadata: this.metadata,
                columnConfig: this.columnConfig
            });
            
            return true;

        } catch (error) {
            console.error("DataManager: Error loading data:", error);
            this.emit('dataLoadError', error);
            throw error;
        }
    }
    
    /**
     * 스크리너 인덱스 로딩
     */
    async loadScreenerIndices() {
        console.log("DataManager: Loading screener indices...");
        
        try {
            const [qualityRes, valueRes, momentumRes] = await Promise.all([
                fetch('./data/screener_indices/quality_index.json'),
                fetch('./data/screener_indices/value_index.json'),
                fetch('./data/screener_indices/momentum_index.json')
            ]);

            if (qualityRes.ok) {
                this.indices.quality = await qualityRes.json();
                console.log(`DataManager: Loaded ${this.indices.quality.length} quality stocks`);
            }

            if (valueRes.ok) {
                this.indices.value = await valueRes.json();
                console.log(`DataManager: Loaded ${this.indices.value.length} value stocks`);
            }

            if (momentumRes.ok) {
                this.indices.momentum = await momentumRes.json();
                console.log(`DataManager: Loaded ${this.indices.momentum.length} momentum stocks`);
            }
            
            this.emit('indicesLoaded', this.indices);

        } catch (error) {
            console.warn("DataManager: Error loading screener indices:", error);
        }
    }
    
    /**
     * 필터링된 데이터 가져오기 (캐시 활용)
     */
    getFilteredData(filterType) {
        const cacheKey = `filter_${filterType}`;
        
        if (this.cache.filteredData.has(cacheKey)) {
            return this.cache.filteredData.get(cacheKey);
        }
        
        let filteredData;
        
        switch (filterType) {
            case 'quality':
                filteredData = this.allData.filter(company => 
                    this.indices.quality.some(ticker => ticker === company.Ticker)
                );
                break;
            case 'value':
                filteredData = this.allData.filter(company => 
                    this.indices.value.some(ticker => ticker === company.Ticker)
                );
                break;
            case 'momentum':
                filteredData = this.allData.filter(company => 
                    this.indices.momentum.some(ticker => ticker === company.Ticker)
                );
                break;
            case 'all':
            default:
                filteredData = this.allData;
                break;
        }
        
        // 캐시에 저장
        this.cache.filteredData.set(cacheKey, filteredData);
        
        return filteredData;
    }
    
    /**
     * 검색 (캐시 활용)
     */
    searchCompanies(searchTerm, filterType = 'all') {
        const cacheKey = `search_${filterType}_${searchTerm.toLowerCase()}`;
        
        if (this.cache.searchResults.has(cacheKey)) {
            return this.cache.searchResults.get(cacheKey);
        }
        
        const currentData = this.getFilteredData(filterType);
        const searchResults = currentData.filter(company => {
            return company.Ticker?.toUpperCase().includes(searchTerm.toUpperCase()) ||
                   company.corpName?.toUpperCase().includes(searchTerm.toUpperCase()) ||
                   company.searchIndex?.includes(searchTerm.toLowerCase());
        });
        
        // 캐시에 저장
        this.cache.searchResults.set(cacheKey, searchResults);
        
        return searchResults;
    }
    
    /**
     * 데이터 정렬 (캐시 활용)
     */
    sortData(data, column, order) {
        const cacheKey = `sort_${column}_${order}_${data.length}`;
        
        if (this.cache.sortedData.has(cacheKey)) {
            return this.cache.sortedData.get(cacheKey);
        }
        
        const sortedData = [...data].sort((a, b) => {
            let aVal = a[column];
            let bVal = b[column];
            
            // null/undefined 처리
            if (aVal === null || aVal === undefined) aVal = order === 'asc' ? -Infinity : Infinity;
            if (bVal === null || bVal === undefined) bVal = order === 'asc' ? -Infinity : Infinity;
            
            // 문자열 처리
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return order === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            
            // 숫자 처리
            const numA = parseFloat(aVal);
            const numB = parseFloat(bVal);
            
            if (!isNaN(numA) && !isNaN(numB)) {
                return order === 'asc' ? numA - numB : numB - numA;
            }
            
            // 기본 문자열 비교
            return order === 'asc' ? 
                String(aVal).localeCompare(String(bVal)) : 
                String(bVal).localeCompare(String(aVal));
        });
        
        // 캐시에 저장
        this.cache.sortedData.set(cacheKey, sortedData);
        
        return sortedData;
    }
    
    /**
     * 캐시 초기화
     */
    clearCache() {
        this.cache.filteredData.clear();
        this.cache.sortedData.clear();
        this.cache.searchResults.clear();
        console.log("DataManager: Cache cleared");
    }
    
    /**
     * 이벤트 리스너 등록
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }
    
    /**
     * 이벤트 발생
     */
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`DataManager: Error in event listener for ${event}:`, error);
                }
            });
        }
    }
    
    /**
     * 데이터 통계 정보
     */
    getStats() {
        return {
            totalCompanies: this.allData.length,
            totalColumns: this.metadata.total_columns || 31,
            qualityStocks: this.indices.quality.length,
            valueStocks: this.indices.value.length,
            momentumStocks: this.indices.momentum.length,
            cacheSize: {
                filtered: this.cache.filteredData.size,
                sorted: this.cache.sortedData.size,
                search: this.cache.searchResults.size
            }
        };
    }
}

// 전역 DataManager 인스턴스
window.dataManager = new DataManager();

export default DataManager;