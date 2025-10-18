/**
 * CompanyMasterProvider.js
 * Sprint 4 Module 1: 기업 마스터 데이터 제공자
 *
 * 기능:
 * - M_Company.json (6,176개 기업) 로딩
 * - O(1) 티커 조회 (companyMap)
 * - O(1) 산업별 조회 (industryIndex)
 * - O(1) 거래소별 조회 (exchangeIndex)
 * - 시가총액/PER 필터링 (O(n))
 * - 기업명 검색 (O(n))
 *
 * 데이터 소스: data/M_Company.json
 * 레코드 수: 6,176 companies
 * 필드 수: 33 fields
 */

class CompanyMasterProvider {
    constructor() {
        // Raw data
        this.companies = null;
        this.metadata = null;

        // Indexes for O(1) lookup
        this.companyMap = new Map();        // ticker → company
        this.industryIndex = new Map();     // industry → companies[]
        this.exchangeIndex = new Map();     // exchange → companies[]

        // State
        this.initialized = false;
        this.loadStartTime = null;
    }

    /**
     * M_Company.json 로딩 및 초기화
     * @param {string} jsonPath - JSON 파일 경로 (기본: 'data/M_Company.json')
     * @returns {Promise<boolean>} 성공 여부
     */
    async loadFromJSON(jsonPath = 'data/M_Company.json') {
        console.log(`[CompanyMasterProvider] Loading from ${jsonPath}...`);
        this.loadStartTime = Date.now();

        try {
            const response = await fetch(jsonPath);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const jsonData = await response.json();

            // Validate structure
            if (!jsonData.metadata || !jsonData.data) {
                throw new Error('Invalid JSON structure: missing metadata or data');
            }

            this.metadata = jsonData.metadata;
            this.companies = this.processData(jsonData.data);

            // Build indexes
            this.buildIndexes();

            this.initialized = true;

            const duration = Date.now() - this.loadStartTime;
            console.log(`✅ [CompanyMasterProvider] Loaded ${this.companies.length} companies in ${duration}ms`);

            return true;

        } catch (error) {
            console.error('[CompanyMasterProvider] Load failed:', error);
            return false;
        }
    }

    /**
     * 원시 데이터 처리 및 정규화
     * @param {Array} rawData - JSON에서 로딩한 원시 데이터
     * @returns {Array} 처리된 데이터
     */
    processData(rawData) {
        return rawData.map(company => {
            // String → Number 변환 (data quality issue 해결)
            const processed = {
                ...company,

                // Identity (keep original)
                ticker: company.Ticker,
                corp: company.Corp,
                exchange: company.Exchange,

                // Company Info (add aliases)
                industry: company.WI26,             // 한글 → 영문 alias
                fiscalYearEnd: company['결산'],      // 한글 → 영문 alias
                foundingYear: company['설립'],       // 한글 → 영문 alias

                // Valuation (convert to number)
                price: parseFloat(company.Price) || null,
                marketCap: company['(USD mn)'],     // already number

                // Financial Ratios (convert to number)
                roe: parseFloat(company['ROE (Fwd)']) || null,
                opm: parseFloat(company['OPM (Fwd)']) || null,
                per: parseFloat(company['PER (Fwd)']) || null,
                pbr: parseFloat(company['PBR (Fwd)']) || null,

                // Performance (already numbers)
                returns: {
                    week: company['W'],
                    month1: company['1 M'],
                    month3: company['3 M'],
                    month6: company['6 M'],
                    month12: company['12 M'],
                },

                // Relative Performance
                returnsVsBenchmark: {
                    week: company['W.1'],
                    month1: company['1 M.1'],
                    month3: company['3 M.1'],
                    month6: company['6 M.1'],
                    month12: company['12 M.1'],
                },

                // Industry Relative Performance
                returnsVsIndustry: {
                    week: company['W.2'],
                    month1: company['1 M.2'],
                    month3: company['3 M.2'],
                    month6: company['6 M.2'],
                    month12: company['12 M.2'],
                },
            };

            return processed;
        });
    }

    /**
     * O(n) 인덱스 구축
     */
    buildIndexes() {
        console.log(`[CompanyMasterProvider] Building indexes for ${this.companies.length} companies...`);
        const start = Date.now();

        this.companyMap.clear();
        this.industryIndex.clear();
        this.exchangeIndex.clear();

        for (const company of this.companies) {
            // Ticker index (O(1) lookup)
            this.companyMap.set(company.ticker, company);

            // Industry index
            if (company.industry) {
                if (!this.industryIndex.has(company.industry)) {
                    this.industryIndex.set(company.industry, []);
                }
                this.industryIndex.get(company.industry).push(company);
            }

            // Exchange index
            if (company.exchange) {
                if (!this.exchangeIndex.has(company.exchange)) {
                    this.exchangeIndex.set(company.exchange, []);
                }
                this.exchangeIndex.get(company.exchange).push(company);
            }
        }

        const duration = Date.now() - start;
        console.log(`✅ [CompanyMasterProvider] Indexes built in ${duration}ms`);
        console.log(`   - Companies: ${this.companyMap.size}`);
        console.log(`   - Industries: ${this.industryIndex.size}`);
        console.log(`   - Exchanges: ${this.exchangeIndex.size}`);
    }

    /**
     * 티커로 기업 조회 (O(1))
     * @param {string} ticker - 종목 코드 (예: "NVDA", "005930")
     * @returns {Object|null} 기업 데이터 또는 null
     */
    getCompanyByTicker(ticker) {
        if (!ticker) {
            console.warn('[CompanyMasterProvider] Invalid ticker');
            return null;
        }
        return this.companyMap.get(ticker) || null;
    }

    /**
     * 산업별 기업 목록 조회 (O(1) lookup + O(k) result)
     * @param {string} industry - 산업명 (예: "반도체", "소프트웨어")
     * @returns {Array} 기업 배열 (빈 배열 가능)
     */
    getCompaniesByIndustry(industry) {
        if (!industry) return [];
        return this.industryIndex.get(industry) || [];
    }

    /**
     * 거래소별 기업 목록 조회 (O(1) lookup + O(k) result)
     * @param {string} exchange - 거래소명 (예: "NASDAQ", "KOSPI")
     * @returns {Array} 기업 배열 (빈 배열 가능)
     */
    getCompaniesByExchange(exchange) {
        if (!exchange) return [];
        return this.exchangeIndex.get(exchange) || [];
    }

    /**
     * 시가총액 범위로 필터링 (O(n))
     * @param {number} min - 최소 시가총액 (millions USD, 기본: 0)
     * @param {number} max - 최대 시가총액 (millions USD, 기본: Infinity)
     * @returns {Array} 필터링된 기업 배열
     */
    filterByMarketCap(min = 0, max = Infinity) {
        if (!this.companies) return [];

        return this.companies.filter(c => {
            const marketCap = c.marketCap;
            if (marketCap === null || marketCap === undefined) return false;
            return marketCap >= min && marketCap <= max;
        });
    }

    /**
     * PER 범위로 필터링 (O(n))
     * @param {number} min - 최소 PER (기본: 0)
     * @param {number} max - 최대 PER (기본: Infinity)
     * @returns {Array} 필터링된 기업 배열
     */
    filterByPER(min = 0, max = Infinity) {
        if (!this.companies) return [];

        return this.companies.filter(c => {
            const per = c.per;
            if (per === null || per === undefined) return false;
            return per >= min && per <= max;
        });
    }

    /**
     * 기업명으로 검색 (부분 일치, O(n))
     * @param {string} query - 검색어 (최소 2자)
     * @returns {Array} 검색 결과 배열
     */
    searchByName(query) {
        if (!query || query.length < 2) {
            console.warn('[CompanyMasterProvider] Query too short (min 2 chars)');
            return [];
        }

        if (!this.companies) return [];

        const lowerQuery = query.toLowerCase();
        return this.companies.filter(c =>
            c.corp.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * 모든 산업 목록 조회
     * @returns {Array} 산업명 배열 (정렬됨)
     */
    getAllIndustries() {
        return Array.from(this.industryIndex.keys()).sort();
    }

    /**
     * 모든 거래소 목록 조회
     * @returns {Array} 거래소명 배열 (정렬됨)
     */
    getAllExchanges() {
        return Array.from(this.exchangeIndex.keys()).sort();
    }

    /**
     * 통계 정보 조회
     * @returns {Object} 통계 객체
     */
    getStatistics() {
        if (!this.initialized || !this.companies) {
            return null;
        }

        return {
            totalCompanies: this.companies.length,
            totalIndustries: this.industryIndex.size,
            totalExchanges: this.exchangeIndex.size,
            loadTime: this.loadStartTime ? Date.now() - this.loadStartTime : null,
            topIndustries: this.getTopIndustries(5),
            topExchanges: this.getTopExchanges(5),
        };
    }

    /**
     * 상위 N개 산업 (기업 수 기준)
     * @param {number} n - 상위 N개 (기본: 5)
     * @returns {Array} [{ industry, count }]
     */
    getTopIndustries(n = 5) {
        const industries = Array.from(this.industryIndex.entries()).map(([industry, companies]) => ({
            industry,
            count: companies.length,
        }));

        return industries
            .sort((a, b) => b.count - a.count)
            .slice(0, n);
    }

    /**
     * 상위 N개 거래소 (기업 수 기준)
     * @param {number} n - 상위 N개 (기본: 5)
     * @returns {Array} [{ exchange, count }]
     */
    getTopExchanges(n = 5) {
        const exchanges = Array.from(this.exchangeIndex.entries()).map(([exchange, companies]) => ({
            exchange,
            count: companies.length,
        }));

        return exchanges
            .sort((a, b) => b.count - a.count)
            .slice(0, n);
    }
}

// Export (for module systems)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CompanyMasterProvider;
}
