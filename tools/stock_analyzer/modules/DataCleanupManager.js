/**
 * DataCleanupManager - 데이터 정제 및 검증 시스템
 */

class DataCleanupManager {
    constructor() {
        this.cleanupRules = this.initializeCleanupRules();
        this.validationRules = this.initializeValidationRules();
        this.cleanupStats = {
            totalProcessed: 0,
            totalCleaned: 0,
            invalidDataRemoved: 0,
            fieldsFixed: 0
        };
        
        console.log('🧹 DataCleanupManager 초기화');
    }

    /**
     * 데이터 정제 규칙 초기화
     */
    initializeCleanupRules() {
        return {
            // 잘못된 패턴들
            invalidPatterns: [
                /0-0x2a0x2a/g,
                /undefined/g,
                /null/g,
                /NaN/g,
                /^\s*$/g, // 빈 문자열
                /^-+$/g,  // 대시만 있는 경우
                /^N\/A$/gi,
                /^#N\/A$/gi,
                /^#DIV\/0!$/gi,
                /^#VALUE!$/gi,
                /^#REF!$/gi
            ],
            
            // 대체 규칙
            replacementRules: {
                invalidNumber: 0,
                invalidString: '',
                invalidPercentage: '0%',
                invalidDate: null,
                invalidBoolean: false
            },
            
            // 수치 필드 정제 규칙
            numericFields: [
                'PER (Oct-25)',
                'PBR (Oct-25)', 
                'ROE (Fwd)',
                'ROA (Fwd)',
                'Debt/Equity (Fwd)',
                'Current Ratio (Fwd)',
                'Quick Ratio (Fwd)',
                'Return (Y)',
                'Return (3Y)',
                'Return (5Y)',
                '(USD mn)',
                'Revenue (Fwd)',
                'EBITDA (Fwd)',
                'EPS (Fwd)',
                'DPS (Fwd)',
                'BVPS (Oct-25)',
                'Price (Oct-25)',
                'Target Price',
                'Upside (%)'
            ],
            
            // 백분율 필드
            percentageFields: [
                'ROE (Fwd)',
                'ROA (Fwd)',
                'Return (Y)',
                'Return (3Y)',
                'Return (5Y)',
                'Upside (%)'
            ],
            
            // 문자열 필드
            stringFields: [
                'Ticker',
                'corpName',
                'industry',
                'exchange',
                'Analyst',
                'Rating'
            ]
        };
    }

    /**
     * 데이터 검증 규칙 초기화
     */
    initializeValidationRules() {
        return {
            // 필수 필드
            requiredFields: [
                'Ticker',
                'corpName'
            ],
            
            // 필드별 검증 함수
            fieldValidators: {
                'Ticker': (value) => /^[A-Z0-9.-]+$/i.test(value) && value.length <= 10,
                'corpName': (value) => typeof value === 'string' && value.length > 0 && value.length <= 200,
                'industry': (value) => !value || (typeof value === 'string' && value.length <= 100),
                'exchange': (value) => !value || (typeof value === 'string' && value.length <= 50),
                'PER (Oct-25)': (value) => this.isValidNumber(value, 0, 1000),
                'PBR (Oct-25)': (value) => this.isValidNumber(value, 0, 100),
                'ROE (Fwd)': (value) => this.isValidNumber(value, -100, 200),
                'ROA (Fwd)': (value) => this.isValidNumber(value, -100, 100),
                '(USD mn)': (value) => this.isValidNumber(value, 0, 10000000),
                'Return (Y)': (value) => this.isValidNumber(value, -99, 1000)
            },
            
            // 데이터 타입 검증
            typeValidators: {
                number: (value) => !isNaN(parseFloat(value)) && isFinite(value),
                string: (value) => typeof value === 'string',
                percentage: (value) => /^-?\d+\.?\d*%?$/.test(String(value))
            }
        };
    }

    /**
     * 메인 데이터 정제 함수
     */
    cleanupData(rawData) {
        console.log(`🧹 데이터 정제 시작: ${rawData.length}개 항목`);
        
        if (!Array.isArray(rawData) || rawData.length === 0) {
            console.warn('⚠️ 유효하지 않은 데이터 배열');
            return [];
        }

        this.resetStats();
        const cleanedData = [];

        rawData.forEach((item, index) => {
            try {
                const cleanedItem = this.cleanupSingleItem(item, index);
                if (cleanedItem && this.validateItem(cleanedItem)) {
                    cleanedData.push(cleanedItem);
                } else {
                    this.cleanupStats.invalidDataRemoved++;
                    console.warn(`⚠️ 유효하지 않은 데이터 제거: 인덱스 ${index}`, item);
                }
            } catch (error) {
                console.error(`❌ 데이터 정제 오류 (인덱스 ${index}):`, error);
                this.cleanupStats.invalidDataRemoved++;
            }
        });

        this.cleanupStats.totalProcessed = rawData.length;
        this.cleanupStats.totalCleaned = cleanedData.length;

        console.log('✅ 데이터 정제 완료:', this.getCleanupSummary());
        return cleanedData;
    }

    /**
     * 단일 항목 정제
     */
    cleanupSingleItem(item, index) {
        if (!item || typeof item !== 'object') {
            return null;
        }

        let cleanedItem = { ...item };
        let fieldsFixed = 0;

        // 각 필드 정제
        Object.keys(cleanedItem).forEach(field => {
            const originalValue = cleanedItem[field];
            const cleanedValue = this.cleanupField(field, originalValue);
            
            if (cleanedValue !== originalValue) {
                cleanedItem[field] = cleanedValue;
                fieldsFixed++;
            }
        });

        // 특별 처리가 필요한 필드들
        cleanedItem = this.applySpecialCleanupRules(cleanedItem);

        this.cleanupStats.fieldsFixed += fieldsFixed;
        return cleanedItem;
    }

    /**
     * 필드별 정제
     */
    cleanupField(fieldName, value) {
        if (value === null || value === undefined) {
            return this.getDefaultValue(fieldName);
        }

        let stringValue = String(value).trim();

        // 잘못된 패턴 제거
        this.cleanupRules.invalidPatterns.forEach(pattern => {
            stringValue = stringValue.replace(pattern, '');
        });

        // 필드 타입별 정제
        if (this.cleanupRules.numericFields.includes(fieldName)) {
            return this.cleanupNumericField(stringValue);
        } else if (this.cleanupRules.percentageFields.includes(fieldName)) {
            return this.cleanupPercentageField(stringValue);
        } else if (this.cleanupRules.stringFields.includes(fieldName)) {
            return this.cleanupStringField(stringValue);
        }

        return stringValue || this.getDefaultValue(fieldName);
    }

    /**
     * 수치 필드 정제
     */
    cleanupNumericField(value) {
        if (!value || value === '') return 0;

        // 쉼표 제거
        let cleanValue = String(value).replace(/,/g, '');
        
        // 괄호 안의 음수 처리 (예: (123) -> -123)
        if (cleanValue.match(/^\(.*\)$/)) {
            cleanValue = '-' + cleanValue.replace(/[()]/g, '');
        }

        // 백분율 기호 제거
        cleanValue = cleanValue.replace(/%/g, '');

        // 숫자 추출
        const numericMatch = cleanValue.match(/-?\d+\.?\d*/);
        if (numericMatch) {
            const numericValue = parseFloat(numericMatch[0]);
            return isNaN(numericValue) ? 0 : numericValue;
        }

        return 0;
    }

    /**
     * 백분율 필드 정제
     */
    cleanupPercentageField(value) {
        const numericValue = this.cleanupNumericField(value);
        return numericValue;
    }

    /**
     * 문자열 필드 정제
     */
    cleanupStringField(value) {
        if (!value || value === '') return '';

        let cleanValue = String(value).trim();
        
        // HTML 태그 제거
        cleanValue = cleanValue.replace(/<[^>]*>/g, '');
        
        // 특수 문자 정제
        cleanValue = cleanValue.replace(/[^\w\s가-힣.-]/g, '');
        
        // 연속된 공백 제거
        cleanValue = cleanValue.replace(/\s+/g, ' ');

        return cleanValue.trim();
    }

    /**
     * 특별 정제 규칙 적용
     */
    applySpecialCleanupRules(item) {
        const cleanedItem = { ...item };

        // Ticker 정제
        if (cleanedItem.Ticker) {
            cleanedItem.Ticker = String(cleanedItem.Ticker).toUpperCase().trim();
        }

        // 기업명 정제
        if (cleanedItem.corpName) {
            cleanedItem.corpName = this.cleanupCompanyName(cleanedItem.corpName);
        }

        // 업종 정제
        if (cleanedItem.industry) {
            cleanedItem.industry = this.cleanupIndustryName(cleanedItem.industry);
        }

        // 거래소 정제
        if (cleanedItem.exchange) {
            cleanedItem.exchange = this.cleanupExchangeName(cleanedItem.exchange);
        }

        // 시가총액 단위 통일 (USD mn)
        if (cleanedItem['(USD mn)']) {
            cleanedItem['(USD mn)'] = this.normalizeMarketCap(cleanedItem['(USD mn)']);
        }

        return cleanedItem;
    }

    /**
     * 기업명 정제
     */
    cleanupCompanyName(name) {
        let cleanName = String(name).trim();
        
        // 일반적인 기업명 정제
        cleanName = cleanName.replace(/\s+(Inc\.?|Corp\.?|Ltd\.?|LLC|Co\.?)$/i, ' $1');
        cleanName = cleanName.replace(/\s+/g, ' ');
        
        return cleanName.trim();
    }

    /**
     * 업종명 정제
     */
    cleanupIndustryName(industry) {
        let cleanIndustry = String(industry).trim();
        
        // 업종명 표준화
        const industryMappings = {
            'Tech': 'Technology',
            'Pharma': 'Pharmaceuticals',
            'Auto': 'Automotive',
            'Fin': 'Financial Services',
            'RE': 'Real Estate'
        };

        Object.keys(industryMappings).forEach(key => {
            if (cleanIndustry.toLowerCase().includes(key.toLowerCase())) {
                cleanIndustry = industryMappings[key];
            }
        });

        return cleanIndustry;
    }

    /**
     * 거래소명 정제
     */
    cleanupExchangeName(exchange) {
        let cleanExchange = String(exchange).trim().toUpperCase();
        
        // 거래소명 표준화
        const exchangeMappings = {
            'NASDAQ': 'NASDAQ',
            'NYSE': 'NYSE',
            'KOSPI': 'KOSPI',
            'KOSDAQ': 'KOSDAQ'
        };

        return exchangeMappings[cleanExchange] || cleanExchange;
    }

    /**
     * 시가총액 정규화
     */
    normalizeMarketCap(value) {
        const numericValue = this.cleanupNumericField(value);
        
        // 음수 시가총액은 0으로 처리
        return Math.max(0, numericValue);
    }

    /**
     * 기본값 반환
     */
    getDefaultValue(fieldName) {
        if (this.cleanupRules.numericFields.includes(fieldName)) {
            return 0;
        } else if (this.cleanupRules.stringFields.includes(fieldName)) {
            return '';
        }
        return null;
    }

    /**
     * 항목 검증
     */
    validateItem(item) {
        // 필수 필드 검증
        for (const field of this.validationRules.requiredFields) {
            if (!item[field] || item[field] === '') {
                return false;
            }
        }

        // 필드별 검증
        for (const [field, validator] of Object.entries(this.validationRules.fieldValidators)) {
            if (item.hasOwnProperty(field) && !validator(item[field])) {
                console.warn(`⚠️ 필드 검증 실패: ${field} = ${item[field]}`);
                return false;
            }
        }

        return true;
    }

    /**
     * 유효한 숫자 검증
     */
    isValidNumber(value, min = -Infinity, max = Infinity) {
        const num = parseFloat(value);
        return !isNaN(num) && isFinite(num) && num >= min && num <= max;
    }

    /**
     * 데이터 무결성 검증
     */
    validateDataIntegrity(data) {
        console.log('🔍 데이터 무결성 검증 시작');
        
        const issues = {
            duplicates: [],
            missingFields: [],
            invalidValues: [],
            outliers: []
        };

        const tickerSet = new Set();
        
        data.forEach((item, index) => {
            // 중복 Ticker 검사
            if (tickerSet.has(item.Ticker)) {
                issues.duplicates.push({ index, ticker: item.Ticker });
            } else {
                tickerSet.add(item.Ticker);
            }

            // 누락 필드 검사
            this.validationRules.requiredFields.forEach(field => {
                if (!item[field]) {
                    issues.missingFields.push({ index, field, ticker: item.Ticker });
                }
            });

            // 이상값 검사
            this.detectOutliers(item, index, issues.outliers);
        });

        console.log('✅ 데이터 무결성 검증 완료:', {
            총항목: data.length,
            중복: issues.duplicates.length,
            누락필드: issues.missingFields.length,
            이상값: issues.outliers.length
        });

        return issues;
    }

    /**
     * 이상값 감지
     */
    detectOutliers(item, index, outliers) {
        // PER 이상값 (음수이거나 1000 초과)
        const per = parseFloat(item['PER (Oct-25)']);
        if (!isNaN(per) && (per < 0 || per > 1000)) {
            outliers.push({ 
                index, 
                ticker: item.Ticker, 
                field: 'PER (Oct-25)', 
                value: per,
                reason: 'PER 이상값'
            });
        }

        // ROE 이상값 (절댓값이 200% 초과)
        const roe = parseFloat(item['ROE (Fwd)']);
        if (!isNaN(roe) && Math.abs(roe) > 200) {
            outliers.push({ 
                index, 
                ticker: item.Ticker, 
                field: 'ROE (Fwd)', 
                value: roe,
                reason: 'ROE 이상값'
            });
        }

        // 시가총액 이상값 (0 또는 음수)
        const marketCap = parseFloat(item['(USD mn)']);
        if (!isNaN(marketCap) && marketCap <= 0) {
            outliers.push({ 
                index, 
                ticker: item.Ticker, 
                field: '(USD mn)', 
                value: marketCap,
                reason: '시가총액 이상값'
            });
        }
    }

    /**
     * 통계 초기화
     */
    resetStats() {
        this.cleanupStats = {
            totalProcessed: 0,
            totalCleaned: 0,
            invalidDataRemoved: 0,
            fieldsFixed: 0
        };
    }

    /**
     * 정제 요약 반환
     */
    getCleanupSummary() {
        return {
            ...this.cleanupStats,
            successRate: this.cleanupStats.totalProcessed > 0 ? 
                (this.cleanupStats.totalCleaned / this.cleanupStats.totalProcessed * 100).toFixed(1) + '%' : '0%'
        };
    }

    /**
     * 정제 보고서 생성
     */
    generateCleanupReport(originalData, cleanedData) {
        const report = {
            timestamp: new Date().toISOString(),
            summary: this.getCleanupSummary(),
            originalCount: originalData.length,
            cleanedCount: cleanedData.length,
            removedCount: originalData.length - cleanedData.length,
            integrityIssues: this.validateDataIntegrity(cleanedData),
            fieldAnalysis: this.analyzeFields(cleanedData)
        };

        console.log('📊 데이터 정제 보고서:', report);
        return report;
    }

    /**
     * 필드 분석
     */
    analyzeFields(data) {
        const analysis = {};
        
        if (data.length === 0) return analysis;

        const sampleItem = data[0];
        Object.keys(sampleItem).forEach(field => {
            const values = data.map(item => item[field]).filter(v => v !== null && v !== undefined && v !== '');
            
            analysis[field] = {
                totalCount: data.length,
                validCount: values.length,
                nullCount: data.length - values.length,
                completeness: ((values.length / data.length) * 100).toFixed(1) + '%'
            };

            // 수치 필드 추가 분석
            if (this.cleanupRules.numericFields.includes(field)) {
                const numericValues = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
                if (numericValues.length > 0) {
                    analysis[field].min = Math.min(...numericValues);
                    analysis[field].max = Math.max(...numericValues);
                    analysis[field].avg = (numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2);
                }
            }
        });

        return analysis;
    }
}

// 전역 인스턴스 생성
window.dataCleanupManager = new DataCleanupManager();

console.log('✅ DataCleanupManager 로드 완료 - 데이터 정제 및 검증 시스템');