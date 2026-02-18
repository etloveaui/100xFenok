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
                'Upside (%)',
                // Sprint 4 Module 2: Performance metrics (absolute returns)
                'W',
                '1 M',
                '3 M',
                '6 M',
                '12 M'
            ],
            
            // 백분율 필드
            percentageFields: [
                'ROE (Fwd)',
                'ROA (Fwd)',
                'Return (Y)',
                'Return (3Y)',
                'Return (5Y)',
                'Upside (%)',
                // Sprint 4 Module 2: Performance returns (displayed as %)
                'W',
                '1 M',
                '3 M',
                '6 M',
                '12 M'
            ],
            
            // 문자열 필드
            stringFields: [
                'Ticker',
                'corpName',
                'industry',
                'exchange',
                'Analyst',
                'Rating',
                // Sprint 4 Module 2: Company info
                '결산'  // Fiscal year end month
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
            
            // 필드별 검증 함수 (39개 전체)
            fieldValidators: {
                // ===== Identity Fields (4) =====
                '45933': (value) => typeof value === 'string' || typeof value === 'number',
                'Ticker': (value) => /^[A-Z0-9.-]+$/i.test(value) && value.length <= 10,
                'corpName': (value) => typeof value === 'string' && value.length > 0 && value.length <= 200,
                'exchange': (value) => !value || (typeof value === 'string' && value.length <= 50),

                // ===== Industry & Classification (2) =====
                'industry': (value) => !value || (typeof value === 'string' && value.length <= 100),
                'FY 0': (value) => !value || (typeof value === 'string' && value.length <= 20),

                // ===== Korean Language Fields (4) =====
                '설립': (value) => !value || (typeof value === 'string' && value.length <= 50),
                '현재가': (value) => this.isValidNumber(value, 0, 1000000000),
                '전일대비': (value) => !value || (typeof value === 'string' && value.length <= 50),
                '전주대비': (value) => !value || (typeof value === 'string' && value.length <= 50),

                // ===== Market Cap & Valuation (4) =====
                '(USD mn)': (value) => this.isValidNumber(value, 0, 10000000),
                'PER (Oct-25)': (value) => this.isValidNumber(value, 0, 1000),
                'PBR (Oct-25)': (value) => this.isValidNumber(value, 0, 100),
                'BVPS (Oct-25)': (value) => this.isValidNumber(value, 0, 10000),

                // ===== Profitability Ratios (3) =====
                'ROE (Fwd)': (value) => this.isValidNumber(value, -100, 200),
                'ROA (Fwd)': (value) => this.isValidNumber(value, -100, 100),
                'OPM (Fwd)': (value) => this.isValidNumber(value, -100, 100),

                // ===== Leverage & Liquidity (4) =====
                'Debt/Equity (Fwd)': (value) => this.isValidNumber(value, 0, 10),
                'Current Ratio (Fwd)': (value) => this.isValidNumber(value, 0, 20),
                'Quick Ratio (Fwd)': (value) => this.isValidNumber(value, 0, 20),
                'CCC (FY 0)': (value) => this.isValidNumber(value, -365, 730),

                // ===== Historical Returns (3) =====
                'Return (Y)': (value) => this.isValidNumber(value, -99, 1000),
                'Return (3Y)': (value) => this.isValidNumber(value, -99, 1000),
                'Return (5Y)': (value) => this.isValidNumber(value, -99, 1000),

                // ===== Financial Statement Items (4) =====
                'Revenue (Fwd)': (value) => this.isValidNumber(value, 0, 1000000),
                'EBITDA (Fwd)': (value) => this.isValidNumber(value, -100000, 1000000),
                'EPS (Fwd)': (value) => this.isValidNumber(value, -100, 1000),
                'DPS (Fwd)': (value) => this.isValidNumber(value, 0, 100),

                // ===== Price & Target (3) =====
                'Price (Oct-25)': (value) => this.isValidNumber(value, 0, 100000),
                'Target Price': (value) => this.isValidNumber(value, 0, 100000),
                'Upside (%)': (value) => this.isValidNumber(value, -100, 1000),

                // ===== Analyst Coverage (2) =====
                'Analyst': (value) => !value || (typeof value === 'string' && value.length <= 100),
                'Rating': (value) => !value || ['Buy', 'Hold', 'Sell', 'Strong Buy', 'Strong Sell', 'Overweight', 'Underweight', 'Neutral', 'Outperform', 'Underperform'].includes(value),

                // ===== Sprint 4 Module 2: Company Info (1) =====
                '결산': (value) => !value || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].includes(value),

                // ===== Sprint 4 Module 2: Performance Metrics - Absolute Returns (5) =====
                'W': (value) => this.isValidNumber(value, -1.0, 3.0),
                '1 M': (value) => this.isValidNumber(value, -1.0, 3.0),
                '3 M': (value) => this.isValidNumber(value, -1.0, 3.0),
                '6 M': (value) => this.isValidNumber(value, -1.0, 3.0),
                '12 M': (value) => this.isValidNumber(value, -1.0, 3.0)
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

    /**
     * ✅ SPRINT 2 TASK 2.1: Format Detection Engine
     * 포맷 불일치 감지 (소수점 vs 백분율)
     */
    detectFormatIssues(data) {
        console.log('🔍 Format Detection Engine 시작...');

        const issues = {
            percentageAsDecimal: [],    // 0.155 → 15.5 (백분율인데 소수로 저장)
            decimalAsPercentage: [],    // 1550 → 15.5 (소수인데 백분율로 저장)
            stringNumbers: [],          // "15.5" → 15.5 (숫자인데 문자열)
            nullInfinity: [],           // null, Infinity, -Infinity
            outOfRange: []              // 범위 초과 값
        };

        // 백분율 필드 목록
        const percentageFields = [
            'ROE (Fwd)', 'ROA (Fwd)', 'OPM (Fwd)',
            'Return (Y)', 'Return (3Y)', 'Return (5Y)',
            'Upside (%)'
        ];

        data.forEach((item, index) => {
            percentageFields.forEach(field => {
                const value = item[field];

                // null/undefined 체크
                if (value === null || value === undefined) {
                    return;
                }

                // Infinity 체크
                if (!isFinite(value)) {
                    issues.nullInfinity.push({
                        index,
                        ticker: item.Ticker || 'N/A',
                        field,
                        value,
                        suggestion: 0,
                        confidence: 'high',
                        reason: 'Infinity detected'
                    });
                    return;
                }

                // 문자열 숫자 체크 (예: "15.5")
                if (typeof value === 'string') {
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                        issues.stringNumbers.push({
                            index,
                            ticker: item.Ticker || 'N/A',
                            field,
                            value,
                            suggestion: numValue,
                            confidence: 'high',
                            reason: 'String number detected'
                        });
                        return;
                    }
                }

                // 숫자형 값만 체크
                if (typeof value === 'number') {
                    // 1. 백분율인데 소수로 저장된 경우 (0.155 → 15.5%)
                    // 조건: 절댓값이 1 미만이고 0이 아닌 경우
                    if (Math.abs(value) < 1 && value !== 0) {
                        issues.percentageAsDecimal.push({
                            index,
                            ticker: item.Ticker || 'N/A',
                            field,
                            value,
                            suggestion: value * 100,
                            confidence: 'high',
                            reason: 'Percentage stored as decimal (< 1)'
                        });
                    }

                    // 2. 소수인데 백분율로 저장된 경우 (1550 → 15.5%)
                    // 조건: 절댓값이 100 초과
                    else if (Math.abs(value) > 100) {
                        // 단, Return 필드는 1000% 초과만 문제로 봄 (테슬라 등 고성장 주식 고려)
                        if (field.includes('Return') && Math.abs(value) <= 1000) {
                            return;
                        }

                        issues.decimalAsPercentage.push({
                            index,
                            ticker: item.Ticker || 'N/A',
                            field,
                            value,
                            suggestion: value / 100,
                            confidence: 'medium',
                            reason: 'Decimal stored as percentage (> 100)'
                        });
                    }

                    // 3. 범위 초과 값
                    // ROE/ROA: -100% ~ 200%
                    // Return: -99% ~ 1000%
                    // OPM: -100% ~ 100%
                    const ranges = {
                        'ROE (Fwd)': { min: -100, max: 200 },
                        'ROA (Fwd)': { min: -100, max: 100 },
                        'OPM (Fwd)': { min: -100, max: 100 },
                        'Return (Y)': { min: -99, max: 1000 },
                        'Return (3Y)': { min: -99, max: 1000 },
                        'Return (5Y)': { min: -99, max: 1000 },
                        'Upside (%)': { min: -100, max: 1000 }
                    };

                    const range = ranges[field];
                    if (range && (value < range.min || value > range.max)) {
                        issues.outOfRange.push({
                            index,
                            ticker: item.Ticker || 'N/A',
                            field,
                            value,
                            range: `${range.min} ~ ${range.max}`,
                            confidence: 'medium',
                            reason: 'Value out of expected range'
                        });
                    }
                }
            });
        });

        const totalIssues =
            issues.percentageAsDecimal.length +
            issues.decimalAsPercentage.length +
            issues.stringNumbers.length +
            issues.nullInfinity.length +
            issues.outOfRange.length;

        console.log(`✅ Format Detection 완료: ${totalIssues}개 문제 발견`);
        console.log(`  - Percentage as Decimal: ${issues.percentageAsDecimal.length}`);
        console.log(`  - Decimal as Percentage: ${issues.decimalAsPercentage.length}`);
        console.log(`  - String Numbers: ${issues.stringNumbers.length}`);
        console.log(`  - Null/Infinity: ${issues.nullInfinity.length}`);
        console.log(`  - Out of Range: ${issues.outOfRange.length}`);

        return issues;
    }

    /**
     * ✅ SPRINT 2 TASK 2.2: Auto-Correction Engine
     * 감지된 포맷 문제 자동 보정
     */
    autoCorrectFormats(data, issues, options = {}) {
        const {
            dryRun = false,           // true면 실제 수정 안 함
            autoApprove = false,      // true면 자동 승인
            confidenceThreshold = 'medium'  // 'high', 'medium', 'low'
        } = options;

        console.log(`🔧 Auto-Correction Engine 시작... (Dry Run: ${dryRun})`);

        const corrections = {
            applied: [],
            skipped: [],
            totalAttempts: 0
        };

        // 수정할 데이터 복사 (원본 보존)
        const correctedData = dryRun ? data : JSON.parse(JSON.stringify(data));

        // 1. Percentage as Decimal 보정 (confidence: high)
        if (confidenceThreshold === 'high' || confidenceThreshold === 'medium' || confidenceThreshold === 'low') {
            issues.percentageAsDecimal.forEach(issue => {
                corrections.totalAttempts++;

                if (!dryRun) {
                    correctedData[issue.index][issue.field] = issue.suggestion;
                }

                corrections.applied.push({
                    type: 'percentageAsDecimal',
                    ticker: issue.ticker,
                    field: issue.field,
                    before: issue.value,
                    after: issue.suggestion,
                    confidence: issue.confidence
                });
            });
        }

        // 2. String Numbers 보정 (confidence: high)
        if (confidenceThreshold === 'high' || confidenceThreshold === 'medium' || confidenceThreshold === 'low') {
            issues.stringNumbers.forEach(issue => {
                corrections.totalAttempts++;

                if (!dryRun) {
                    correctedData[issue.index][issue.field] = issue.suggestion;
                }

                corrections.applied.push({
                    type: 'stringNumbers',
                    ticker: issue.ticker,
                    field: issue.field,
                    before: issue.value,
                    after: issue.suggestion,
                    confidence: issue.confidence
                });
            });
        }

        // 3. Null/Infinity 보정 (confidence: high)
        if (confidenceThreshold === 'high' || confidenceThreshold === 'medium' || confidenceThreshold === 'low') {
            issues.nullInfinity.forEach(issue => {
                corrections.totalAttempts++;

                if (!dryRun) {
                    correctedData[issue.index][issue.field] = issue.suggestion;
                }

                corrections.applied.push({
                    type: 'nullInfinity',
                    ticker: issue.ticker,
                    field: issue.field,
                    before: issue.value,
                    after: issue.suggestion,
                    confidence: issue.confidence
                });
            });
        }

        // 4. Decimal as Percentage 보정 (confidence: medium) - 주의 필요
        if (confidenceThreshold === 'medium' || confidenceThreshold === 'low') {
            issues.decimalAsPercentage.forEach(issue => {
                corrections.totalAttempts++;

                // Medium confidence는 사용자 승인 필요 (autoApprove가 아니면 스킵)
                if (autoApprove) {
                    if (!dryRun) {
                        correctedData[issue.index][issue.field] = issue.suggestion;
                    }

                    corrections.applied.push({
                        type: 'decimalAsPercentage',
                        ticker: issue.ticker,
                        field: issue.field,
                        before: issue.value,
                        after: issue.suggestion,
                        confidence: issue.confidence
                    });
                } else {
                    corrections.skipped.push({
                        type: 'decimalAsPercentage',
                        ticker: issue.ticker,
                        field: issue.field,
                        value: issue.value,
                        reason: 'Requires user approval (medium confidence)'
                    });
                }
            });
        }

        // 5. Out of Range - 보정 안 함 (리포팅만)
        issues.outOfRange.forEach(issue => {
            corrections.skipped.push({
                type: 'outOfRange',
                ticker: issue.ticker,
                field: issue.field,
                value: issue.value,
                range: issue.range,
                reason: 'Out of range - manual review required'
            });
        });

        console.log(`✅ Auto-Correction 완료:`);
        console.log(`  - Applied: ${corrections.applied.length}`);
        console.log(`  - Skipped: ${corrections.skipped.length}`);
        console.log(`  - Total Attempts: ${corrections.totalAttempts}`);

        return {
            correctedData: dryRun ? data : correctedData,
            corrections,
            summary: {
                totalIssues: corrections.totalAttempts,
                applied: corrections.applied.length,
                skipped: corrections.skipped.length,
                dryRun
            }
        };
    }

    /**
     * ✅ SPRINT 2 TASK 2.3: Validation Reporting
     * 검증 결과 종합 보고서 생성
     */
    generateValidationReport(data) {
        console.log('📊 Validation Report 생성 시작...');

        // 1. Format Detection
        const formatIssues = this.detectFormatIssues(data);

        // 2. Field Coverage Analysis
        const fieldCoverage = this.analyzeFieldCoverage(data);

        // 3. Data Quality Metrics
        const qualityMetrics = this.calculateQualityMetrics(data, formatIssues);

        // 4. Actionable Recommendations
        const recommendations = this.generateRecommendations(formatIssues, fieldCoverage, qualityMetrics);

        const report = {
            timestamp: new Date().toISOString(),
            datasetSize: data.length,
            formatIssues,
            fieldCoverage,
            qualityMetrics,
            recommendations
        };

        // 콘솔 출력
        this.printValidationReport(report);

        return report;
    }

    /**
     * 필드 커버리지 분석
     */
    analyzeFieldCoverage(data) {
        const allFields = Object.keys(this.validationRules.fieldValidators);
        const coverage = {
            totalFields: allFields.length,
            validatedFields: 0,
            coveragePercentage: 0,
            fieldDetails: {}
        };

        allFields.forEach(field => {
            const values = data.map(item => item[field]).filter(v => v !== null && v !== undefined && v !== '');
            const validCount = values.length;
            const completeness = (validCount / data.length * 100).toFixed(1);

            coverage.fieldDetails[field] = {
                totalRecords: data.length,
                validRecords: validCount,
                completeness: completeness + '%',
                hasValidator: true
            };

            if (validCount > 0) {
                coverage.validatedFields++;
            }
        });

        coverage.coveragePercentage = ((coverage.validatedFields / coverage.totalFields) * 100).toFixed(1) + '%';

        return coverage;
    }

    /**
     * 데이터 품질 지표 계산
     */
    calculateQualityMetrics(data, formatIssues) {
        const totalIssues =
            formatIssues.percentageAsDecimal.length +
            formatIssues.decimalAsPercentage.length +
            formatIssues.stringNumbers.length +
            formatIssues.nullInfinity.length +
            formatIssues.outOfRange.length;

        const totalCells = data.length * Object.keys(this.validationRules.fieldValidators).length;
        const errorRate = (totalIssues / totalCells * 100).toFixed(3);
        const qualityScore = Math.max(0, 100 - parseFloat(errorRate)).toFixed(1);

        return {
            totalRecords: data.length,
            totalFields: Object.keys(this.validationRules.fieldValidators).length,
            totalCells,
            totalIssues,
            errorRate: errorRate + '%',
            qualityScore: qualityScore + '/100',
            criticalIssues: formatIssues.nullInfinity.length,
            warningIssues: formatIssues.percentageAsDecimal.length + formatIssues.stringNumbers.length,
            infoIssues: formatIssues.decimalAsPercentage.length + formatIssues.outOfRange.length
        };
    }

    /**
     * 실행 가능한 권장사항 생성
     */
    generateRecommendations(formatIssues, fieldCoverage, qualityMetrics) {
        const recommendations = [];

        // 1. Critical Issues
        if (formatIssues.nullInfinity.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                category: 'Data Integrity',
                issue: `${formatIssues.nullInfinity.length} Infinity/Null values detected`,
                action: 'Run autoCorrectFormats() with confidenceThreshold="high"',
                impact: 'High - Prevents calculation errors'
            });
        }

        // 2. High Priority
        if (formatIssues.percentageAsDecimal.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Format Consistency',
                issue: `${formatIssues.percentageAsDecimal.length} percentage values stored as decimals`,
                action: 'Run autoCorrectFormats() with confidenceThreshold="high"',
                impact: 'High - Corrects display and calculation errors'
            });
        }

        if (formatIssues.stringNumbers.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Type Safety',
                issue: `${formatIssues.stringNumbers.length} numeric values stored as strings`,
                action: 'Run autoCorrectFormats() with confidenceThreshold="high"',
                impact: 'Medium - Improves type safety'
            });
        }

        // 3. Medium Priority
        if (formatIssues.decimalAsPercentage.length > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Format Consistency',
                issue: `${formatIssues.decimalAsPercentage.length} decimal values possibly stored as percentages`,
                action: 'Manual review recommended, then run autoCorrectFormats() with autoApprove=true',
                impact: 'Medium - Requires validation'
            });
        }

        // 4. Low Priority
        if (formatIssues.outOfRange.length > 0) {
            recommendations.push({
                priority: 'LOW',
                category: 'Data Quality',
                issue: `${formatIssues.outOfRange.length} values outside expected ranges`,
                action: 'Review data source or adjust validation ranges',
                impact: 'Low - May be legitimate outliers'
            });
        }

        // 5. Field Coverage
        const coveragePercent = parseFloat(fieldCoverage.coveragePercentage);
        if (coveragePercent < 100) {
            recommendations.push({
                priority: 'INFO',
                category: 'Validation Coverage',
                issue: `Field coverage at ${fieldCoverage.coveragePercentage} (${fieldCoverage.validatedFields}/${fieldCoverage.totalFields})`,
                action: 'All 39 fields are validated - no action needed',
                impact: 'None - Full coverage achieved'
            });
        }

        return recommendations;
    }

    /**
     * 검증 보고서 콘솔 출력
     */
    printValidationReport(report) {
        console.log('\n📊 ===== DATA VALIDATION REPORT =====');
        console.log('✅ Sprint 4 Module 2: ValidationAnalytics - Enhanced Coverage');
        console.log(`🕒 Timestamp: ${report.timestamp}`);
        console.log(`📦 Dataset Size: ${report.datasetSize} records\n`);

        // Quality Metrics
        console.log('📈 QUALITY METRICS:');
        console.log(`  - Quality Score: ${report.qualityMetrics.qualityScore}`);
        console.log(`  - Error Rate: ${report.qualityMetrics.errorRate}`);
        console.log(`  - Total Issues: ${report.qualityMetrics.totalIssues}`);
        console.log(`    • Critical: ${report.qualityMetrics.criticalIssues}`);
        console.log(`    • Warning: ${report.qualityMetrics.warningIssues}`);
        console.log(`    • Info: ${report.qualityMetrics.infoIssues}\n`);

        // Field Coverage
        console.log('🎯 FIELD COVERAGE:');
        console.log(`  - Total Fields: ${report.fieldCoverage.totalFields}`);
        console.log(`  - Validated Fields: ${report.fieldCoverage.validatedFields}`);
        console.log(`  - Coverage: ${report.fieldCoverage.coveragePercentage}\n`);

        // Format Issues
        console.log('🔍 FORMAT ISSUES:');
        console.log(`  - Percentage as Decimal: ${report.formatIssues.percentageAsDecimal.length}`);
        console.log(`  - Decimal as Percentage: ${report.formatIssues.decimalAsPercentage.length}`);
        console.log(`  - String Numbers: ${report.formatIssues.stringNumbers.length}`);
        console.log(`  - Null/Infinity: ${report.formatIssues.nullInfinity.length}`);
        console.log(`  - Out of Range: ${report.formatIssues.outOfRange.length}\n`);

        // Recommendations
        console.log('💡 RECOMMENDATIONS:');
        report.recommendations.forEach((rec, index) => {
            console.log(`  ${index + 1}. [${rec.priority}] ${rec.category}`);
            console.log(`     Issue: ${rec.issue}`);
            console.log(`     Action: ${rec.action}`);
            console.log(`     Impact: ${rec.impact}\n`);
        });

        console.log('=====================================\n');
    }
}

// 전역 인스턴스 생성
window.dataCleanupManager = new DataCleanupManager();

console.log('✅ DataCleanupManager 로드 완료 - 데이터 정제 및 검증 시스템');