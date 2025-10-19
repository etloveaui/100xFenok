/**
 * CompanyAnalyticsProvider.js
 * Sprint 4 Module 4: 기업 분석 데이터 제공자
 *
 * 기능:
 * - A_Company.json (1,250개 기업) 로딩
 * - O(1) 티커 조회 (companyMap)
 * - O(n) PEG 기반 필터링 (pegIndex)
 * - O(n) Return 기반 필터링 (returnIndex)
 * - O(n) Growth 기반 필터링 (growthIndex)
 * - 가치주 발굴 (Value Opportunities)
 * - 성장주 탐색 (High Growth Companies)
 * - 통계 분석 및 비교
 *
 * 데이터 소스: data/A_Company.json
 * 레코드 수: 1,250 companies
 * 필드 수: 50 fields (29 common + 21 calculated)
 */

class CompanyAnalyticsProvider {
    constructor() {
        // Raw data
        this.data = null;
        this.metadata = null;

        // Indexes for O(1) and O(n) lookup
        this.companyMap = new Map();        // ticker → company
        this.pegIndex = new Map();          // PEG bucket → companies[]
        this.returnIndex = new Map();       // Return bucket → companies[]
        this.growthIndex = new Map();       // Growth bucket → companies[]

        // State
        this.initialized = false;
        this.loadStartTime = null;
    }

    /**
     * A_Company.json 로딩 및 초기화
     * @param {string} jsonPath - JSON 파일 경로 (기본: 'data/A_Company.json')
     * @returns {Promise<boolean>} 성공 여부
     */
    async loadFromJSON(jsonPath = 'data/A_Company.json') {
        console.log(`[CompanyAnalyticsProvider] Loading from ${jsonPath}...`);
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
            this.data = this.processData(jsonData.data);

            // Build indexes
            this.buildIndexes();

            this.initialized = true;

            const duration = Date.now() - this.loadStartTime;
            console.log(`✅ [CompanyAnalyticsProvider] Loaded ${this.data.length} companies in ${duration}ms`);

            return true;

        } catch (error) {
            console.error('[CompanyAnalyticsProvider] Load failed:', error);
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
            // String → Number 변환 및 Null safety
            const processed = {
                ...company,

                // Identity (keep original)
                ticker: company.Ticker,
                corp: company.Corp,
                exchange: company.Exchange,
                industry: company.WI26,

                // Valuation metrics (convert to number with null safety)
                per: this.parseNumber(company['PER (Oct-25)']),
                perAvg: this.parseNumber(company['PER (Avg)']),
                perDeviation: this.parseNumber(company['% PER (Avg)']),
                pbr: this.parseNumber(company['PBR (Oct-25)']),
                peg: this.parseNumber(company['PEG (Oct-25)']),

                // Forward PER metrics
                per3: this.parseNumber(company['PER (3)']),
                per5: this.parseNumber(company['PER (5)']),
                per10: this.parseNumber(company['PER (10)']),

                // Growth metrics
                salesCAGR3: this.parseNumber(company['Sales (3)']),

                // Return metrics
                returnY: this.parseNumber(company['Return (Y)']),
                dividendYield: this.parseNumber(company['DY (FY+1)']),

                // Price and change metrics
                currentPrice: this.parseNumber(company['현재가']),
                price10: this.parseNumber(company['Price (10)']),
                dailyChange: this.parseNumber(company['전일대비']),
                weeklyChange: this.parseNumber(company['전주대비']),

                // Market cap and financial ratios
                marketCap: company['(USD mn)'],
                roe: this.parseNumber(company['ROE (Fwd)']),
                opm: this.parseNumber(company['OPM (Fwd)']),
                ccc: this.parseNumber(company['CCC (FY 0)']),

                // Performance metrics
                returns: {
                    week: company['W'],
                    month1: company['1 M'],
                    month3: company['3 M'],
                    month6: company['6 M'],
                    month12: company['12 M'],
                    ytd: company['YTD']
                },

                // Relative performance vs benchmark
                returnsVsBenchmark: {
                    week: company['W.1'],
                    month1: company['1 M.1'],
                    month3: company['3 M.1'],
                    month6: company['6 M.1'],
                    month12: company['12 M.1'],
                    ytd: company['YTD.1']
                },

                // Relative performance vs industry
                returnsVsIndustry: {
                    week: company['W.2'],
                    month1: company['1 M.2'],
                    month3: company['3 M.2'],
                    month6: company['6 M.2'],
                    month12: company['12 M.2'],
                    ytd: company['YTD.2']
                }
            };

            return processed;
        });
    }

    /**
     * 문자열 → 숫자 변환 (Null safety + Infinity 처리)
     * @param {*} value - 변환할 값
     * @returns {number|null} 숫자 또는 null
     */
    parseNumber(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const num = parseFloat(value);
        if (isNaN(num)) {
            return null;
        }
        // Infinity는 null로 처리 (분석 용이성)
        if (!isFinite(num)) {
            return null;
        }
        return num;
    }

    /**
     * O(n) 인덱스 구축
     */
    buildIndexes() {
        console.log(`[CompanyAnalyticsProvider] Building indexes for ${this.data.length} companies...`);
        const start = Date.now();

        this.companyMap.clear();
        this.pegIndex.clear();
        this.returnIndex.clear();
        this.growthIndex.clear();

        // Initialize bucket arrays
        this.pegIndex.set('undervalued', []);     // PEG < 1.0
        this.pegIndex.set('fair', []);            // 1.0 ≤ PEG < 1.5
        this.pegIndex.set('overvalued', []);      // PEG ≥ 1.5
        this.pegIndex.set('invalid', []);         // null or invalid

        this.returnIndex.set('excellent', []);    // Return ≥ 20%
        this.returnIndex.set('good', []);         // 15% ≤ Return < 20%
        this.returnIndex.set('average', []);      // 10% ≤ Return < 15%
        this.returnIndex.set('low', []);          // 5% ≤ Return < 10%
        this.returnIndex.set('poor', []);         // Return < 5%
        this.returnIndex.set('invalid', []);      // null

        this.growthIndex.set('hypergrowth', []);  // Growth ≥ 30%
        this.growthIndex.set('high', []);         // 20% ≤ Growth < 30%
        this.growthIndex.set('moderate', []);     // 10% ≤ Growth < 20%
        this.growthIndex.set('slow', []);         // 0% ≤ Growth < 10%
        this.growthIndex.set('negative', []);     // Growth < 0%
        this.growthIndex.set('invalid', []);      // null

        for (const company of this.data) {
            // Ticker index (O(1) lookup)
            this.companyMap.set(company.ticker, company);

            // PEG index
            const peg = company.peg;
            if (peg === null) {
                this.pegIndex.get('invalid').push(company);
            } else if (peg < 1.0) {
                this.pegIndex.get('undervalued').push(company);
            } else if (peg < 1.5) {
                this.pegIndex.get('fair').push(company);
            } else {
                this.pegIndex.get('overvalued').push(company);
            }

            // Return index (using 12M return)
            const returnY = company.returnY;
            if (returnY === null) {
                this.returnIndex.get('invalid').push(company);
            } else if (returnY >= 0.20) {
                this.returnIndex.get('excellent').push(company);
            } else if (returnY >= 0.15) {
                this.returnIndex.get('good').push(company);
            } else if (returnY >= 0.10) {
                this.returnIndex.get('average').push(company);
            } else if (returnY >= 0.05) {
                this.returnIndex.get('low').push(company);
            } else {
                this.returnIndex.get('poor').push(company);
            }

            // Growth index (using Sales CAGR 3Y)
            const growth = company.salesCAGR3;
            if (growth === null) {
                this.growthIndex.get('invalid').push(company);
            } else if (growth >= 0.30) {
                this.growthIndex.get('hypergrowth').push(company);
            } else if (growth >= 0.20) {
                this.growthIndex.get('high').push(company);
            } else if (growth >= 0.10) {
                this.growthIndex.get('moderate').push(company);
            } else if (growth >= 0) {
                this.growthIndex.get('slow').push(company);
            } else {
                this.growthIndex.get('negative').push(company);
            }
        }

        const duration = Date.now() - start;
        console.log(`✅ [CompanyAnalyticsProvider] Indexes built in ${duration}ms`);
        console.log(`   - Companies: ${this.companyMap.size}`);
        console.log(`   - PEG buckets: undervalued(${this.pegIndex.get('undervalued').length}), fair(${this.pegIndex.get('fair').length}), overvalued(${this.pegIndex.get('overvalued').length})`);
        console.log(`   - Return buckets: excellent(${this.returnIndex.get('excellent').length}), good(${this.returnIndex.get('good').length}), average(${this.returnIndex.get('average').length})`);
        console.log(`   - Growth buckets: hypergrowth(${this.growthIndex.get('hypergrowth').length}), high(${this.growthIndex.get('high').length}), moderate(${this.growthIndex.get('moderate').length})`);
    }

    // ==================== CORE ANALYTICS METHODS (5) ====================

    /**
     * 티커로 기업 조회 (O(1))
     * @param {string} ticker - 종목 코드 (예: "NVDA", "MSFT")
     * @returns {Object|null} 기업 데이터 또는 null
     */
    getCompanyByTicker(ticker) {
        if (!ticker) {
            console.warn('[CompanyAnalyticsProvider] Invalid ticker');
            return null;
        }
        return this.companyMap.get(ticker) || null;
    }

    /**
     * Return 기준 Top N 기업 조회
     * @param {number} limit - 상위 N개 (기본: 10)
     * @returns {Array} Return 기준 상위 기업 배열
     */
    getTopByReturn(limit = 10) {
        if (!this.data) return [];

        return this.data
            .filter(c => c.returnY !== null && isFinite(c.returnY))
            .sort((a, b) => b.returnY - a.returnY)
            .slice(0, limit);
    }

    /**
     * PEG 기준 Top N 기업 조회 (undervalued first)
     * @param {number} limit - 상위 N개 (기본: 10)
     * @param {boolean} ascending - 오름차순 (기본: true, 낮은 PEG = 저평가)
     * @returns {Array} PEG 기준 상위 기업 배열
     */
    getTopByPEG(limit = 10, ascending = true) {
        if (!this.data) return [];

        return this.data
            .filter(c => c.peg !== null && c.peg > 0 && isFinite(c.peg))
            .sort((a, b) => ascending ? a.peg - b.peg : b.peg - a.peg)
            .slice(0, limit);
    }

    /**
     * 고성장 기업 조회 (Sales CAGR 기준)
     * @param {number} minGrowth - 최소 성장률 (기본: 0.20 = 20%)
     * @returns {Array} 고성장 기업 배열
     */
    getHighGrowthCompanies(minGrowth = 0.20) {
        const result = [];

        // Use growth index for O(n) performance
        if (minGrowth >= 0.30) {
            result.push(...this.growthIndex.get('hypergrowth'));
        } else if (minGrowth >= 0.20) {
            result.push(...this.growthIndex.get('hypergrowth'));
            result.push(...this.growthIndex.get('high'));
        } else if (minGrowth >= 0.10) {
            result.push(...this.growthIndex.get('hypergrowth'));
            result.push(...this.growthIndex.get('high'));
            result.push(...this.growthIndex.get('moderate'));
        } else {
            result.push(...this.growthIndex.get('hypergrowth'));
            result.push(...this.growthIndex.get('high'));
            result.push(...this.growthIndex.get('moderate'));
            result.push(...this.growthIndex.get('slow'));
        }

        // Filter by exact threshold
        return result.filter(c => c.salesCAGR3 >= minGrowth);
    }

    /**
     * 가치 투자 기회 발굴 (PEG < 1.5 && Return > 15%)
     * @returns {Array} 가치 투자 후보 기업 배열
     */
    getValueOpportunities() {
        const result = [];

        // Get companies from PEG buckets (undervalued + fair)
        const pegCandidates = [
            ...this.pegIndex.get('undervalued'),
            ...this.pegIndex.get('fair')
        ];

        // Filter by Return > 15% (excellent + good buckets)
        const goodReturnTickers = new Set();
        this.returnIndex.get('excellent').forEach(c => goodReturnTickers.add(c.ticker));
        this.returnIndex.get('good').forEach(c => goodReturnTickers.add(c.ticker));

        // Intersection: PEG < 1.5 && Return > 15%
        for (const company of pegCandidates) {
            if (goodReturnTickers.has(company.ticker)) {
                result.push(company);
            }
        }

        // Sort by PEG (ascending - best value first)
        return result.sort((a, b) => a.peg - b.peg);
    }

    // ==================== FILTERING & SEARCH METHODS (5) ====================

    /**
     * Return 범위로 필터링 (O(n))
     * @param {number} min - 최소 Return (기본: 0.0)
     * @param {number} max - 최대 Return (기본: Infinity)
     * @returns {Array} 필터링된 기업 배열
     */
    filterByReturn(min = 0.0, max = Infinity) {
        if (!this.data) return [];

        const result = [];

        // Use return index for O(n) performance
        const buckets = ['excellent', 'good', 'average', 'low', 'poor'];
        for (const bucket of buckets) {
            const companies = this.returnIndex.get(bucket) || [];
            result.push(...companies.filter(c =>
                c.returnY !== null && c.returnY >= min && c.returnY <= max
            ));
        }

        return result;
    }

    /**
     * PEG 범위로 필터링 (O(n))
     * @param {number} min - 최소 PEG (기본: 0.0)
     * @param {number} max - 최대 PEG (기본: Infinity)
     * @returns {Array} 필터링된 기업 배열
     */
    filterByPEG(min = 0.0, max = Infinity) {
        if (!this.data) return [];

        const result = [];

        // Use PEG index for O(n) performance
        const buckets = ['undervalued', 'fair', 'overvalued'];
        for (const bucket of buckets) {
            const companies = this.pegIndex.get(bucket) || [];
            result.push(...companies.filter(c =>
                c.peg !== null && c.peg >= min && c.peg <= max
            ));
        }

        return result;
    }

    /**
     * Growth 범위로 필터링 (O(n))
     * @param {number} min - 최소 Growth (기본: 0.0)
     * @param {number} max - 최대 Growth (기본: Infinity)
     * @returns {Array} 필터링된 기업 배열
     */
    filterByGrowth(min = 0.0, max = Infinity) {
        if (!this.data) return [];

        const result = [];

        // Use growth index for O(n) performance
        const buckets = ['hypergrowth', 'high', 'moderate', 'slow', 'negative'];
        for (const bucket of buckets) {
            const companies = this.growthIndex.get(bucket) || [];
            result.push(...companies.filter(c =>
                c.salesCAGR3 !== null && c.salesCAGR3 >= min && c.salesCAGR3 <= max
            ));
        }

        return result;
    }

    /**
     * 기업명으로 검색 (부분 일치, O(n))
     * @param {string} query - 검색어 (최소 2자)
     * @returns {Array} 검색 결과 배열
     */
    searchByName(query) {
        if (!query || typeof query !== 'string' || query.length < 2) {
            console.warn('[CompanyAnalyticsProvider] Query too short (min 2 chars)');
            return [];
        }

        if (!this.data) return [];

        const lowerQuery = query.toLowerCase();
        return this.data.filter(c =>
            c.corp && c.corp.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * 기업 요약 정보 조회
     * @param {string} ticker - 종목 코드
     * @returns {Object|null} 요약 정보 또는 null
     */
    getCompanySummary(ticker) {
        const company = this.getCompanyByTicker(ticker);
        if (!company) return null;

        return {
            // Basic info
            ticker: company.ticker,
            corp: company.corp,
            exchange: company.exchange,
            industry: company.industry,

            // Valuation
            valuation: {
                per: company.per,
                pbr: company.pbr,
                peg: company.peg,
                perAvg: company.perAvg,
                perDeviation: company.perDeviation
            },

            // Growth
            growth: {
                salesCAGR3: company.salesCAGR3,
                per3: company.per3,
                per5: company.per5,
                per10: company.per10
            },

            // Return
            return: {
                returnY: company.returnY,
                returns: company.returns
            },

            // Dividend
            dividend: {
                dividendYield: company.dividendYield
            },

            // Financial health
            financial: {
                marketCap: company.marketCap,
                roe: company.roe,
                opm: company.opm,
                ccc: company.ccc
            }
        };
    }

    // ==================== STATISTICAL ANALYSIS METHODS (5) ====================

    /**
     * 시장 전체 통계 조회
     * @returns {Object} 통계 객체
     */
    getMarketStatistics() {
        if (!this.initialized || !this.data) {
            return null;
        }

        // Filter valid data
        const validPEG = this.data.filter(c => c.peg !== null && isFinite(c.peg) && c.peg > 0);
        const validReturn = this.data.filter(c => c.returnY !== null && isFinite(c.returnY));
        const validGrowth = this.data.filter(c => c.salesCAGR3 !== null && isFinite(c.salesCAGR3));

        // Calculate statistics
        const avgPEG = validPEG.length > 0
            ? validPEG.reduce((sum, c) => sum + c.peg, 0) / validPEG.length
            : null;

        const medianReturn = validReturn.length > 0
            ? this.calculateMedian(validReturn.map(c => c.returnY))
            : null;

        const avgGrowth = validGrowth.length > 0
            ? validGrowth.reduce((sum, c) => sum + c.salesCAGR3, 0) / validGrowth.length
            : null;

        return {
            totalCompanies: this.data.length,
            validPEGCount: validPEG.length,
            validReturnCount: validReturn.length,
            validGrowthCount: validGrowth.length,

            avgPEG: avgPEG,
            medianReturn: medianReturn,
            avgGrowth: avgGrowth,

            valuationDistribution: this.getValuationDistribution(),

            topIndustries: this.getTopIndustriesByCount(5)
        };
    }

    /**
     * 산업별 분석 (M_Company integration required)
     * @param {string} industry - 산업명
     * @returns {Object|null} 산업 분석 결과 (현재 구현 안 됨 - M_Company 통합 필요)
     */
    getIndustryAnalytics(industry) {
        // TODO: Requires M_Company integration for full industry analysis
        if (!industry || !this.data) return null;

        const companies = this.data.filter(c => c.industry === industry);

        if (companies.length === 0) {
            return null;
        }

        const validPEG = companies.filter(c => c.peg !== null && isFinite(c.peg) && c.peg > 0);
        const validReturn = companies.filter(c => c.returnY !== null && isFinite(c.returnY));
        const validGrowth = companies.filter(c => c.salesCAGR3 !== null && isFinite(c.salesCAGR3));

        return {
            industry: industry,
            companyCount: companies.length,

            avgPEG: validPEG.length > 0
                ? validPEG.reduce((sum, c) => sum + c.peg, 0) / validPEG.length
                : null,

            avgReturn: validReturn.length > 0
                ? validReturn.reduce((sum, c) => sum + c.returnY, 0) / validReturn.length
                : null,

            avgGrowth: validGrowth.length > 0
                ? validGrowth.reduce((sum, c) => sum + c.salesCAGR3, 0) / validGrowth.length
                : null,

            topCompanies: companies
                .filter(c => c.returnY !== null)
                .sort((a, b) => b.returnY - a.returnY)
                .slice(0, 5)
        };
    }

    /**
     * 평가 지표 분포 조회
     * @returns {Object} 분포 통계
     */
    getValuationDistribution() {
        return {
            pegBuckets: {
                undervalued: this.pegIndex.get('undervalued').length,
                fair: this.pegIndex.get('fair').length,
                overvalued: this.pegIndex.get('overvalued').length,
                invalid: this.pegIndex.get('invalid').length
            },

            returnBuckets: {
                excellent: this.returnIndex.get('excellent').length,
                good: this.returnIndex.get('good').length,
                average: this.returnIndex.get('average').length,
                low: this.returnIndex.get('low').length,
                poor: this.returnIndex.get('poor').length,
                invalid: this.returnIndex.get('invalid').length
            },

            growthBuckets: {
                hypergrowth: this.growthIndex.get('hypergrowth').length,
                high: this.growthIndex.get('high').length,
                moderate: this.growthIndex.get('moderate').length,
                slow: this.growthIndex.get('slow').length,
                negative: this.growthIndex.get('negative').length,
                invalid: this.growthIndex.get('invalid').length
            }
        };
    }

    /**
     * 이상치 탐지 (Outlier detection)
     * @returns {Object} 이상치 기업 목록
     */
    identifyOutliers() {
        if (!this.data) return null;

        const pegOutliers = this.data.filter(c =>
            c.peg !== null && (c.peg > 100 || c.peg < -10)
        );

        const returnOutliers = this.data.filter(c =>
            c.returnY !== null && (c.returnY > 1.0 || c.returnY < -0.5)
        );

        const growthOutliers = this.data.filter(c =>
            c.salesCAGR3 !== null && (c.salesCAGR3 > 1.0 || c.salesCAGR3 < -0.5)
        );

        return {
            pegOutliers: pegOutliers.slice(0, 20),  // Top 20
            returnOutliers: returnOutliers.slice(0, 20),
            growthOutliers: growthOutliers.slice(0, 20),

            summary: {
                pegOutlierCount: pegOutliers.length,
                returnOutlierCount: returnOutliers.length,
                growthOutlierCount: growthOutliers.length
            }
        };
    }

    /**
     * 두 기업 비교 (Side-by-side comparison)
     * @param {string} ticker1 - 첫 번째 종목 코드
     * @param {string} ticker2 - 두 번째 종목 코드
     * @returns {Object|null} 비교 결과 또는 null
     */
    compareCompanies(ticker1, ticker2) {
        const company1 = this.getCompanyByTicker(ticker1);
        const company2 = this.getCompanyByTicker(ticker2);

        if (!company1 || !company2) {
            console.warn('[CompanyAnalyticsProvider] One or both companies not found');
            return null;
        }

        return {
            company1: {
                ticker: company1.ticker,
                corp: company1.corp,
                industry: company1.industry,

                valuation: {
                    per: company1.per,
                    pbr: company1.pbr,
                    peg: company1.peg
                },

                growth: {
                    salesCAGR3: company1.salesCAGR3
                },

                return: {
                    returnY: company1.returnY,
                    month12: company1.returns.month12
                },

                financial: {
                    marketCap: company1.marketCap,
                    roe: company1.roe,
                    opm: company1.opm
                }
            },

            company2: {
                ticker: company2.ticker,
                corp: company2.corp,
                industry: company2.industry,

                valuation: {
                    per: company2.per,
                    pbr: company2.pbr,
                    peg: company2.peg
                },

                growth: {
                    salesCAGR3: company2.salesCAGR3
                },

                return: {
                    returnY: company2.returnY,
                    month12: company2.returns.month12
                },

                financial: {
                    marketCap: company2.marketCap,
                    roe: company2.roe,
                    opm: company2.opm
                }
            },

            comparison: {
                pegDiff: company1.peg !== null && company2.peg !== null
                    ? company1.peg - company2.peg
                    : null,

                returnDiff: company1.returnY !== null && company2.returnY !== null
                    ? company1.returnY - company2.returnY
                    : null,

                growthDiff: company1.salesCAGR3 !== null && company2.salesCAGR3 !== null
                    ? company1.salesCAGR3 - company2.salesCAGR3
                    : null,

                marketCapRatio: company1.marketCap && company2.marketCap
                    ? company1.marketCap / company2.marketCap
                    : null
            }
        };
    }

    // ==================== HELPER METHODS ====================

    /**
     * 중앙값 계산
     * @param {Array} values - 숫자 배열
     * @returns {number|null} 중앙값
     */
    calculateMedian(values) {
        if (!values || values.length === 0) return null;

        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);

        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    /**
     * 상위 N개 산업 (기업 수 기준)
     * @param {number} n - 상위 N개 (기본: 5)
     * @returns {Array} [{ industry, count }]
     */
    getTopIndustriesByCount(n = 5) {
        const industryCount = new Map();

        for (const company of this.data) {
            if (company.industry) {
                industryCount.set(
                    company.industry,
                    (industryCount.get(company.industry) || 0) + 1
                );
            }
        }

        return Array.from(industryCount.entries())
            .map(([industry, count]) => ({ industry, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, n);
    }

    /**
     * 통계 정보 조회
     * @returns {Object} 통계 객체
     */
    getStatistics() {
        return this.getMarketStatistics();
    }
}

// Export (for module systems)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CompanyAnalyticsProvider;
}
