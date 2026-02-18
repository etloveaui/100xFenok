/**
 * DataInterface - DataSkeleton 표준 API 인터페이스
 *
 * 다중 에이전트가 일관되게 데이터에 접근할 수 있도록 하는 표준 인터페이스
 *
 * 사용 예시:
 * ```javascript
 * import DataInterface from './core/interfaces/DataInterface.js';
 *
 * // 데이터 쿼리
 * const companies = DataInterface.query({
 *     filter: { country: 'USA' },
 *     sort: { field: 'marketCap', order: 'desc' },
 *     limit: 100
 * });
 *
 * // 데이터 변경 구독
 * const unsubscribe = DataInterface.subscribe((event) => {
 *     console.log('데이터 업데이트:', event.data);
 * });
 * ```
 *
 * @class DataInterface
 */
export default class DataInterface {
    /**
     * DataSkeleton 인스턴스 가져오기
     * @private
     * @returns {DataSkeleton}
     */
    static getDataSkeleton() {
        if (typeof window === 'undefined' || !window.dataSkeleton) {
            throw new Error('DataSkeleton이 초기화되지 않았습니다');
        }
        return window.dataSkeleton;
    }

    // ========================================
    // 데이터 쿼리 API
    // ========================================

    /**
     * 데이터 쿼리
     *
     * @param {Object} options - 쿼리 옵션
     * @param {Object} [options.filter] - 필터 조건
     * @param {Object} [options.sort] - 정렬 { field, order }
     * @param {number} [options.limit] - 제한 개수
     * @param {number} [options.offset] - 시작 위치
     * @param {Array<string>} [options.projection] - 선택 필드
     * @returns {Array<Object>} 쿼리 결과
     *
     * @example
     * // 미국 기업 중 시가총액 상위 10개
     * const topCompanies = DataInterface.query({
     *     filter: { country: 'USA' },
     *     sort: { field: 'marketCap', order: 'desc' },
     *     limit: 10
     * });
     *
     * @example
     * // 고급 필터 (연산자 사용)
     * const largeCaps = DataInterface.query({
     *     filter: {
     *         marketCap: { $gt: 1000000000 },
     *         revenue: { $gte: 500000000 }
     *     }
     * });
     */
    static query(options = {}) {
        return this.getDataSkeleton().query(options);
    }

    /**
     * 단일 레코드 조회
     *
     * @param {Object} filter - 필터 조건
     * @returns {Object|null} 첫 번째 매칭 레코드
     *
     * @example
     * const apple = DataInterface.findOne({ ticker: 'AAPL' });
     */
    static findOne(filter) {
        const results = this.query({ filter, limit: 1 });
        return results.length > 0 ? results[0] : null;
    }

    /**
     * 레코드 개수 조회
     *
     * @param {Object} [filter] - 필터 조건 (선택)
     * @returns {number} 레코드 개수
     *
     * @example
     * const totalCompanies = DataInterface.count();
     * const usCompanies = DataInterface.count({ country: 'USA' });
     */
    static count(filter = null) {
        if (filter === null) {
            return this.getDataSkeleton().count();
        }
        return this.getDataSkeleton().countWhere(filter);
    }

    /**
     * 고유 값 목록 조회
     *
     * @param {string} field - 필드명
     * @param {Object} [filter] - 필터 조건 (선택)
     * @returns {Array} 고유 값 목록
     *
     * @example
     * const countries = DataInterface.distinct('country');
     * const usIndustries = DataInterface.distinct('industry', { country: 'USA' });
     */
    static distinct(field, filter = null) {
        const data = filter ? this.query({ filter }) : this.query({});
        const values = data.map(row => row[field]);
        return [...new Set(values)].filter(v => v !== null && v !== undefined);
    }

    /**
     * 집계 함수
     *
     * @param {string} field - 집계할 필드
     * @param {string} operation - 집계 연산 (sum, avg, min, max)
     * @param {Object} [filter] - 필터 조건 (선택)
     * @returns {number} 집계 결과
     *
     * @example
     * const totalMarketCap = DataInterface.aggregate('marketCap', 'sum');
     * const avgRevenue = DataInterface.aggregate('revenue', 'avg', { country: 'USA' });
     */
    static aggregate(field, operation, filter = null) {
        const data = filter ? this.query({ filter }) : this.query({});
        const values = data.map(row => row[field]).filter(v => typeof v === 'number');

        switch (operation.toLowerCase()) {
            case 'sum':
                return values.reduce((sum, val) => sum + val, 0);
            case 'avg':
                return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
            case 'min':
                return values.length > 0 ? Math.min(...values) : null;
            case 'max':
                return values.length > 0 ? Math.max(...values) : null;
            default:
                throw new Error(`지원하지 않는 집계 연산: ${operation}`);
        }
    }

    // ========================================
    // 데이터 구독 API
    // ========================================

    /**
     * 데이터 변경 구독
     *
     * @param {Function} callback - 콜백 함수
     * @param {Object} [options] - 구독 옵션
     * @param {string} [options.module] - 모듈명
     * @param {Array<string>} [options.events] - 이벤트 타입
     * @returns {Function} 언구독 함수
     *
     * @example
     * const unsubscribe = DataInterface.subscribe((event) => {
     *     console.log('데이터 업데이트:', event.type, event.data);
     * }, { module: 'myModule', events: ['data:updated'] });
     *
     * // 구독 해제
     * unsubscribe();
     */
    static subscribe(callback, options = {}) {
        return this.getDataSkeleton().subscribe(callback, options);
    }

    // ========================================
    // 스키마 및 메타데이터 API
    // ========================================

    /**
     * 데이터 스키마 조회
     *
     * @returns {Object} 스키마 정보
     *
     * @example
     * const schema = DataInterface.getSchema();
     * console.log('필드 목록:', schema.fields);
     */
    static getSchema() {
        return this.getDataSkeleton().getSchema();
    }

    /**
     * 필드 목록 조회
     *
     * @returns {Array<string>} 필드명 목록
     *
     * @example
     * const fields = DataInterface.getFields();
     */
    static getFields() {
        const schema = this.getSchema();
        return schema ? schema.fields.map(f => f.name) : [];
    }

    /**
     * 통계 정보 조회
     *
     * @returns {Object} 통계 정보
     *
     * @example
     * const stats = DataInterface.getStats();
     * console.log('레코드 수:', stats.recordCount);
     * console.log('캐시 적중률:', stats.cacheHitRate);
     */
    static getStats() {
        return this.getDataSkeleton().getStats();
    }

    // ========================================
    // 데이터 갱신 API
    // ========================================

    /**
     * 주간 데이터 교체
     *
     * @param {Array<Object>} csvData - CSV 파싱된 데이터
     * @returns {Promise<Object>} 처리 결과
     *
     * @example
     * const result = await DataInterface.replaceWeeklyData(csvData);
     * if (result.success) {
     *     console.log('데이터 교체 성공:', result.recordCount);
     * }
     */
    static async replaceWeeklyData(csvData) {
        return await this.getDataSkeleton().replaceWeeklyData(csvData);
    }

    // ========================================
    // 캐시 관리 API
    // ========================================

    /**
     * 캐시 클리어
     *
     * @example
     * DataInterface.clearCache();
     */
    static clearCache() {
        this.getDataSkeleton().clearCache();
    }

    /**
     * 캐시 활성화/비활성화
     *
     * @param {boolean} enabled - 활성화 여부
     *
     * @example
     * DataInterface.setCacheEnabled(false); // 캐시 비활성화
     */
    static setCacheEnabled(enabled) {
        this.getDataSkeleton().setCacheEnabled(enabled);
    }

    // ========================================
    // 검증 및 필드 매핑 API
    // ========================================

    /**
     * 검증 규칙 추가
     *
     * @param {string} field - 필드명
     * @param {Function} validator - 검증 함수
     *
     * @example
     * DataInterface.addValidator('marketCap', (value) => value > 0);
     */
    static addValidator(field, validator) {
        this.getDataSkeleton().addValidator(field, validator);
    }

    /**
     * 필드 매핑 설정
     *
     * @param {Object} mappings - { 원본필드: 대상필드 }
     *
     * @example
     * DataInterface.setFieldMappings({
     *     'Old_Field_Name': 'newFieldName',
     *     'Another_Old': 'anotherNew'
     * });
     */
    static setFieldMappings(mappings) {
        this.getDataSkeleton().setFieldMappings(mappings);
    }

    // ========================================
    // 헬퍼 메서드
    // ========================================

    /**
     * 페이지네이션 헬퍼
     *
     * @param {Object} options - 쿼리 옵션
     * @param {number} page - 페이지 번호 (1부터 시작)
     * @param {number} pageSize - 페이지 크기
     * @returns {Object} { data, pagination }
     *
     * @example
     * const result = DataInterface.paginate({
     *     filter: { country: 'USA' },
     *     sort: { field: 'marketCap', order: 'desc' }
     * }, 1, 50);
     *
     * console.log(result.data); // 50개 레코드
     * console.log(result.pagination.totalPages); // 전체 페이지 수
     */
    static paginate(options = {}, page = 1, pageSize = 50) {
        // 전체 개수 조회
        const total = this.count(options.filter);
        const totalPages = Math.ceil(total / pageSize);

        // 페이지 데이터 조회
        const offset = (page - 1) * pageSize;
        const data = this.query({
            ...options,
            offset,
            limit: pageSize
        });

        return {
            data,
            pagination: {
                currentPage: page,
                pageSize,
                totalPages,
                totalRecords: total,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        };
    }

    /**
     * 검색 헬퍼
     *
     * @param {string} keyword - 검색 키워드
     * @param {Array<string>} fields - 검색할 필드 목록
     * @param {Object} [options] - 추가 옵션
     * @returns {Array<Object>} 검색 결과
     *
     * @example
     * const results = DataInterface.search('apple', ['ticker', 'name', 'industry']);
     */
    static search(keyword, fields, options = {}) {
        const allData = this.query({});
        const lowerKeyword = keyword.toLowerCase();

        const results = allData.filter(row => {
            return fields.some(field => {
                const value = row[field];
                if (!value) return false;
                return value.toString().toLowerCase().includes(lowerKeyword);
            });
        });

        // 추가 옵션 적용
        if (options.sort) {
            const { field, order = 'asc' } = options.sort;
            results.sort((a, b) => {
                const aVal = a[field];
                const bVal = b[field];
                if (order === 'asc') {
                    return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                } else {
                    return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
                }
            });
        }

        if (options.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    /**
     * 그룹화 헬퍼
     *
     * @param {string} field - 그룹화할 필드
     * @param {Object} [filter] - 필터 조건 (선택)
     * @returns {Object} { 그룹값: [레코드들] }
     *
     * @example
     * const byCountry = DataInterface.groupBy('country');
     * console.log(byCountry['USA']); // 미국 기업 목록
     */
    static groupBy(field, filter = null) {
        const data = filter ? this.query({ filter }) : this.query({});

        return data.reduce((groups, row) => {
            const key = row[field] || 'undefined';
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(row);
            return groups;
        }, {});
    }
}

// 전역 네임스페이스에 노출
if (typeof window !== 'undefined') {
    if (!window.globalScouter) {
        window.globalScouter = {};
    }
    window.globalScouter.data = DataInterface;
    console.log('✅ DataInterface 전역 노출: window.globalScouter.data');
}
