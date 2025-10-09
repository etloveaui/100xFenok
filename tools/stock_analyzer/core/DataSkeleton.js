/**
 * DataSkeleton - 매주 데이터 교체 최적화 엔진
 *
 * 핵심 기능:
 * - CSV 데이터 자동 정제 (0-0x2a0x2a 패턴 제거)
 * - 스키마 자동 감지 및 매핑
 * - 실시간 데이터 구독 시스템
 * - 스마트 쿼리 엔진
 * - 캐싱 시스템
 *
 * @class DataSkeleton
 */
export default class DataSkeleton {
    constructor() {
        // 데이터 스토어
        this.rawData = new Map();           // 원본 데이터
        this.processedData = new Map();     // 처리된 데이터 캐시
        this.schema = null;                  // 데이터 스키마
        this.fieldMappings = new Map();     // 필드 매핑

        // 구독 시스템
        this.subscribers = new Set();        // 전역 구독자
        this.moduleSubscribers = new Map(); // 모듈별 구독자

        // 검증 및 통계
        this.validators = new Map();         // 검증 규칙
        this.stats = {
            lastUpdate: null,
            recordCount: 0,
            fieldCount: 0,
            cacheHitRate: 0
        };

        // 캐시 관리
        this.cacheEnabled = true;
        this.maxCacheSize = 1000;
        this.cacheStats = {
            hits: 0,
            misses: 0
        };

        console.log('✅ DataSkeleton 초기화 완료');
    }

    // ========================================
    // 매주 데이터 교체 파이프라인
    // ========================================

    /**
     * 매주 CSV 데이터 교체 (원클릭)
     * @param {Array<Object>} csvData - CSV 파싱된 데이터
     * @returns {Promise<Object>} 처리 결과
     */
    async replaceWeeklyData(csvData) {
        console.log('📥 주간 데이터 교체 시작...', {
            inputRecords: csvData?.length || 0
        });

        try {
            // 1단계: CSV 데이터 정제
            const cleaned = await this.cleanCSVData(csvData);
            console.log('✅ 1단계 완료: 데이터 정제', { records: cleaned.length });

            // 2단계: 스키마 자동 감지
            const schema = await this.detectSchema(cleaned);
            this.schema = schema;
            console.log('✅ 2단계 완료: 스키마 감지', { fields: schema.fields.length });

            // 3단계: 필드 매핑 (설정 파일 기반)
            const mapped = await this.mapFields(cleaned, schema);
            console.log('✅ 3단계 완료: 필드 매핑', { records: mapped.length });

            // 4단계: 데이터 검증
            const validated = await this.validate(mapped);
            console.log('✅ 4단계 완료: 데이터 검증', { valid: validated.length });

            // 5단계: 저장 및 캐시
            await this.store(validated);
            console.log('✅ 5단계 완료: 데이터 저장');

            // 6단계: 구독자 알림
            await this.notifyAll({
                type: 'data:updated',
                data: validated,
                stats: this.stats
            });
            console.log('✅ 6단계 완료: 구독자 알림', { subscribers: this.subscribers.size });

            // 통계 업데이트
            this.stats.lastUpdate = new Date();
            this.stats.recordCount = validated.length;
            this.stats.fieldCount = schema.fields.length;

            console.log('✅ 주간 데이터 교체 완료!', this.stats);

            return {
                success: true,
                recordCount: validated.length,
                fieldCount: schema.fields.length,
                stats: this.stats
            };

        } catch (error) {
            console.error('❌ 데이터 교체 실패:', error);

            // 에러 이벤트 발행
            await this.notifyAll({
                type: 'data:error',
                error: error.message,
                stack: error.stack
            });

            return {
                success: false,
                error: error.message
            };
        }
    }

    // ========================================
    // CSV 데이터 정제 시스템
    // ========================================

    /**
     * CSV 데이터 자동 정제
     * - 0-0x2a0x2a 패턴 제거
     * - 빈 행 제거
     * - 공백 정리
     *
     * @param {Array<Object>} csvData
     * @returns {Promise<Array<Object>>}
     */
    async cleanCSVData(csvData) {
        if (!Array.isArray(csvData)) {
            throw new Error('CSV 데이터는 배열이어야 합니다');
        }

        return csvData
            .filter(row => this.hasValidData(row))
            .map(row => this.cleanRow(row));
    }

    /**
     * 행에 유효한 데이터가 있는지 확인
     * @param {Object} row
     * @returns {boolean}
     */
    hasValidData(row) {
        return Object.values(row).some(value => {
            if (!value) return false;

            const stringValue = value.toString().trim();

            // 빈 문자열 체크
            if (stringValue === '') return false;

            // 0-0x2a0x2a 패턴 체크
            if (stringValue === '0-0x2a0x2a') return false;

            return true;
        });
    }

    /**
     * 개별 행 정제
     * @param {Object} row
     * @returns {Object}
     */
    cleanRow(row) {
        const cleanedRow = {};

        Object.keys(row).forEach(key => {
            let value = row[key];

            // 문자열 처리
            if (typeof value === 'string') {
                // 0-0x2a0x2a 패턴 제거
                value = value.replace(/0-0x2a0x2a/g, '').trim();

                // 다중 공백을 단일 공백으로
                value = value.replace(/\s+/g, ' ');
            }

            // 빈 값을 null로 변환
            cleanedRow[key] = value === '' || value === null ? null : value;
        });

        return cleanedRow;
    }

    // ========================================
    // 스키마 자동 감지 시스템
    // ========================================

    /**
     * 데이터 스키마 자동 감지
     * @param {Array<Object>} data
     * @returns {Promise<Object>}
     */
    async detectSchema(data) {
        if (!data || data.length === 0) {
            throw new Error('스키마 감지: 데이터가 비어있습니다');
        }

        const sampleSize = Math.min(100, data.length);
        const samples = data.slice(0, sampleSize);

        const fields = [];
        const firstRow = data[0];

        for (const [key, value] of Object.entries(firstRow)) {
            const fieldSchema = {
                name: key,
                type: this.detectFieldType(key, value, samples),
                nullable: this.isFieldNullable(key, samples),
                unique: this.isFieldUnique(key, samples)
            };

            fields.push(fieldSchema);
        }

        const schema = {
            version: '1.0',
            generatedAt: new Date().toISOString(),
            recordCount: data.length,
            fields
        };

        // this.schema 설정 (테스트 호환성)
        this.schema = schema;

        return schema;
    }

    /**
     * 필드 타입 자동 감지
     * @param {string} fieldName
     * @param {any} value
     * @param {Array} samples
     * @returns {string}
     */
    detectFieldType(fieldName, value, samples) {
        // 샘플 데이터에서 타입 추론
        const types = samples
            .map(row => row[fieldName])
            .filter(v => v !== null && v !== undefined)
            .map(v => typeof v);

        const uniqueTypes = [...new Set(types)];

        if (uniqueTypes.length === 1) {
            return uniqueTypes[0];
        }

        // 혼합 타입인 경우 'mixed'
        return 'mixed';
    }

    /**
     * 필드가 null 허용인지 확인
     * @param {string} fieldName
     * @param {Array} samples
     * @returns {boolean}
     */
    isFieldNullable(fieldName, samples) {
        return samples.some(row =>
            row[fieldName] === null || row[fieldName] === undefined
        );
    }

    /**
     * 필드 값이 유니크한지 확인
     * @param {string} fieldName
     * @param {Array} samples
     * @returns {boolean}
     */
    isFieldUnique(fieldName, samples) {
        const values = samples
            .map(row => row[fieldName])
            .filter(v => v !== null && v !== undefined);

        const uniqueValues = new Set(values);

        return uniqueValues.size === values.length;
    }

    // ========================================
    // 필드 매핑 엔진
    // ========================================

    /**
     * 필드 자동 매핑
     * @param {Array<Object>} data
     * @param {Object} schema
     * @returns {Promise<Array<Object>>}
     */
    async mapFields(data, schema) {
        // 필드 매핑 규칙이 없으면 원본 그대로 반환
        if (this.fieldMappings.size === 0) {
            return data;
        }

        return data.map(row => {
            const mappedRow = {};

            Object.keys(row).forEach(originalField => {
                const mappedField = this.fieldMappings.get(originalField) || originalField;
                mappedRow[mappedField] = row[originalField];
            });

            return mappedRow;
        });
    }

    /**
     * 필드 매핑 규칙 설정
     * @param {Object} mappings - { 원본필드: 대상필드 }
     */
    setFieldMappings(mappings) {
        this.fieldMappings = new Map(Object.entries(mappings));
        console.log('✅ 필드 매핑 설정 완료:', mappings);
    }

    // ========================================
    // 데이터 검증 시스템
    // ========================================

    /**
     * 데이터 검증
     * @param {Array<Object>} data
     * @returns {Promise<Array<Object>>}
     */
    async validate(data) {
        // 검증 규칙이 없으면 그대로 반환
        if (this.validators.size === 0) {
            return data;
        }

        return data.filter(row => {
            for (const [field, validator] of this.validators.entries()) {
                if (!validator(row[field], row)) {
                    console.warn(`검증 실패: ${field}`, row[field]);
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * 검증 규칙 추가
     * @param {string} field - 필드명
     * @param {Function} validator - 검증 함수
     */
    addValidator(field, validator) {
        this.validators.set(field, validator);
    }

    // ========================================
    // 데이터 저장 시스템
    // ========================================

    /**
     * 데이터 저장
     * @param {Array<Object>} data
     * @returns {Promise<void>}
     */
    async store(data) {
        // 기존 데이터 클리어
        this.rawData.clear();

        // 새 데이터 저장
        data.forEach((row, index) => {
            this.rawData.set(index, row);
        });

        // 캐시 클리어
        if (this.cacheEnabled) {
            this.clearCache();
        }

        console.log(`✅ ${data.length}개 레코드 저장 완료`);
    }

    // ========================================
    // 스마트 쿼리 엔진
    // ========================================

    /**
     * 데이터 쿼리
     * @param {Object} options
     * @param {Object} options.filter - 필터 조건
     * @param {Object} options.sort - 정렬 조건 { field, order }
     * @param {number} options.limit - 제한 개수
     * @param {number} options.offset - 시작 위치
     * @param {Array<string>} options.projection - 선택 필드
     * @returns {Array<Object>}
     */
    query(options = {}) {
        const {
            filter = {},
            sort = null,
            limit = null,
            offset = 0,
            projection = null
        } = options;

        // 캐시 확인
        const cacheKey = this.getCacheKey(options);
        if (this.cacheEnabled && this.processedData.has(cacheKey)) {
            this.cacheStats.hits++;
            return this.processedData.get(cacheKey);
        }

        this.cacheStats.misses++;

        // 전체 데이터 배열로 변환
        let result = Array.from(this.rawData.values());

        // 1. 필터 적용
        if (Object.keys(filter).length > 0) {
            result = result.filter(row => this.matchesFilter(row, filter));
        }

        // 2. 정렬 적용
        if (sort && sort.field) {
            result.sort((a, b) => this.compareValues(
                a[sort.field],
                b[sort.field],
                sort.order || 'asc'
            ));
        }

        // 3. 오프셋 및 제한 적용
        if (offset > 0 || limit !== null) {
            const start = offset;
            const end = limit ? offset + limit : result.length;
            result = result.slice(start, end);
        }

        // 4. 프로젝션 적용 (필드 선택)
        if (projection && Array.isArray(projection)) {
            result = result.map(row => {
                const projected = {};
                projection.forEach(field => {
                    if (field in row) {
                        projected[field] = row[field];
                    }
                });
                return projected;
            });
        }

        // 캐시 저장
        if (this.cacheEnabled) {
            this.saveToCache(cacheKey, result);
        }

        // 캐시 적중률 계산
        this.stats.cacheHitRate = this.cacheStats.hits /
            (this.cacheStats.hits + this.cacheStats.misses);

        return result;
    }

    /**
     * 필터 매칭 확인
     * @param {Object} row
     * @param {Object} filter
     * @returns {boolean}
     */
    matchesFilter(row, filter) {
        return Object.keys(filter).every(field => {
            const filterValue = filter[field];
            const rowValue = row[field];

            // 연산자 지원 ($gt, $lt, $gte, $lte, $ne, $in)
            if (typeof filterValue === 'object' && filterValue !== null) {
                return this.matchesOperator(rowValue, filterValue);
            }

            // 단순 매칭
            return rowValue === filterValue;
        });
    }

    /**
     * 연산자 매칭
     * @param {any} value
     * @param {Object} operators
     * @returns {boolean}
     */
    matchesOperator(value, operators) {
        for (const [op, opValue] of Object.entries(operators)) {
            switch (op) {
                case '$gt':
                    if (!(value > opValue)) return false;
                    break;
                case '$gte':
                    if (!(value >= opValue)) return false;
                    break;
                case '$lt':
                    if (!(value < opValue)) return false;
                    break;
                case '$lte':
                    if (!(value <= opValue)) return false;
                    break;
                case '$ne':
                    if (value === opValue) return false;
                    break;
                case '$in':
                    if (!Array.isArray(opValue) || !opValue.includes(value)) return false;
                    break;
            }
        }
        return true;
    }

    /**
     * 값 비교 (정렬용)
     * @param {any} a
     * @param {any} b
     * @param {string} order - 'asc' or 'desc'
     * @returns {number}
     */
    compareValues(a, b, order = 'asc') {
        // null/undefined 처리
        if (a === null || a === undefined) return order === 'asc' ? 1 : -1;
        if (b === null || b === undefined) return order === 'asc' ? -1 : 1;

        // 숫자 비교
        if (typeof a === 'number' && typeof b === 'number') {
            return order === 'asc' ? a - b : b - a;
        }

        // 문자열 비교
        const aStr = String(a).toLowerCase();
        const bStr = String(b).toLowerCase();

        if (order === 'asc') {
            return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
        } else {
            return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
        }
    }

    // ========================================
    // 구독 시스템 (Pub/Sub)
    // ========================================

    /**
     * 데이터 변경 구독
     * @param {Function} callback - 콜백 함수
     * @param {Object} options - { module, events }
     * @returns {Function} unsubscribe 함수
     */
    subscribe(callback, options = {}) {
        const { module = 'global', events = ['data:change'] } = options;

        const subscription = {
            id: crypto.randomUUID(),
            callback,
            events,
            module
        };

        this.subscribers.add(subscription);

        // 모듈별 구독자 추적
        if (!this.moduleSubscribers.has(module)) {
            this.moduleSubscribers.set(module, new Set());
        }
        this.moduleSubscribers.get(module).add(subscription);

        console.log(`✅ 구독 등록: ${module}`, { events });

        // 언구독 함수 반환
        return () => {
            this.subscribers.delete(subscription);
            if (this.moduleSubscribers.has(module)) {
                this.moduleSubscribers.get(module).delete(subscription);
            }
            console.log(`✅ 구독 해제: ${module}`);
        };
    }

    /**
     * 모든 구독자에게 알림
     * @param {Object} event
     * @returns {Promise<void>}
     */
    async notifyAll(event) {
        const notifications = [];

        for (const subscription of this.subscribers) {
            // 이벤트 타입 필터링
            if (!subscription.events.includes(event.type)) {
                continue;
            }

            try {
                const notification = subscription.callback(event);
                if (notification instanceof Promise) {
                    notifications.push(notification);
                }
            } catch (error) {
                console.error('구독자 알림 실패:', subscription.module, error);
            }
        }

        // 모든 비동기 알림 완료 대기
        await Promise.all(notifications);
    }

    // ========================================
    // 캐싱 시스템
    // ========================================

    /**
     * 캐시 키 생성
     * @param {Object} options
     * @returns {string}
     */
    getCacheKey(options) {
        return JSON.stringify(options);
    }

    /**
     * 캐시에 저장
     * @param {string} key
     * @param {any} value
     */
    saveToCache(key, value) {
        // 캐시 크기 제한
        if (this.processedData.size >= this.maxCacheSize) {
            // LRU: 가장 오래된 항목 삭제
            const firstKey = this.processedData.keys().next().value;
            this.processedData.delete(firstKey);
        }

        this.processedData.set(key, value);
    }

    /**
     * 캐시 클리어
     */
    clearCache() {
        this.processedData.clear();
        this.cacheStats.hits = 0;
        this.cacheStats.misses = 0;
        console.log('✅ 캐시 클리어 완료');
    }

    /**
     * 캐시 활성화/비활성화
     * @param {boolean} enabled
     */
    setCacheEnabled(enabled) {
        this.cacheEnabled = enabled;
        if (!enabled) {
            this.clearCache();
        }
        console.log(`✅ 캐시 ${enabled ? '활성화' : '비활성화'}`);
    }

    // ========================================
    // 유틸리티 메서드
    // ========================================

    /**
     * 데이터 통계 조회
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            cacheStats: this.cacheStats,
            subscriberCount: this.subscribers.size,
            moduleCount: this.moduleSubscribers.size
        };
    }

    /**
     * 스키마 조회
     * @returns {Object}
     */
    getSchema() {
        return this.schema;
    }

    /**
     * 전체 데이터 개수
     * @returns {number}
     */
    count() {
        return this.rawData.size;
    }

    /**
     * 특정 조건의 데이터 개수
     * @param {Object} filter
     * @returns {number}
     */
    countWhere(filter) {
        return this.query({ filter }).length;
    }
}

// 전역 인스턴스로 노출
if (typeof window !== 'undefined') {
    window.dataSkeleton = new DataSkeleton();
    console.log('✅ DataSkeleton 전역 인스턴스 생성됨: window.dataSkeleton');
}
