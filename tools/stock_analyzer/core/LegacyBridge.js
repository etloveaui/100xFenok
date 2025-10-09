/**
 * LegacyBridge - 기존 시스템과 새 시스템 통합 브릿지
 *
 * 핵심 기능:
 * - 기존 매니저 래핑
 * - 데이터 형식 변환
 * - 이벤트 프록시
 * - 점진적 마이그레이션 지원
 *
 * @class LegacyBridge
 */
export default class LegacyBridge {
    constructor(dataSkeleton, eventSystem, uiFramework) {
        this.dataSkeleton = dataSkeleton;
        this.eventSystem = eventSystem;
        this.uiFramework = uiFramework;

        // 래핑된 매니저들
        this.legacyManagers = new Map();

        // 데이터 변환 맵
        this.dataTransformers = new Map();

        // 이벤트 매핑
        this.eventMap = new Map();

        // 마이그레이션 상태
        this.migrationStatus = {
            total: 0,
            migrated: 0,
            pending: []
        };

        console.log('✅ LegacyBridge 초기화 완료');
    }

    // ========================================
    // 매니저 래핑
    // ========================================

    /**
     * 레거시 매니저 래핑
     *
     * @param {string} name - 매니저 이름
     * @param {Object} manager - 레거시 매니저 인스턴스
     * @param {Object} options - 래핑 옵션
     * @returns {Object} 래핑된 매니저
     *
     * @example
     * const wrapped = bridge.wrapLegacyManager('columnManager', window.columnManager, {
     *     methods: ['initialize', 'toggleColumn'],
     *     events: { 'column:toggled': 'columnManager:toggle' }
     * });
     */
    wrapLegacyManager(name, manager, options = {}) {
        const {
            methods = [],
            events = {},
            dataAdapter = null
        } = options;

        const wrapper = {
            name,
            originalManager: manager,
            methods: {},
            events: {}
        };

        // 메서드 래핑
        methods.forEach(methodName => {
            if (typeof manager[methodName] === 'function') {
                wrapper.methods[methodName] = (...args) => {
                    console.log(`🔄 레거시 메서드 호출: ${name}.${methodName}`, args);

                    try {
                        const result = manager[methodName](...args);

                        // 이벤트 발행
                        this.eventSystem.emit(`legacy:${name}:${methodName}`, {
                            manager: name,
                            method: methodName,
                            args,
                            result
                        });

                        return result;

                    } catch (error) {
                        console.error(`❌ 레거시 메서드 실행 실패: ${name}.${methodName}`, error);
                        throw error;
                    }
                };
            }
        });

        // 이벤트 프록시
        Object.entries(events).forEach(([legacyEvent, newEvent]) => {
            wrapper.events[legacyEvent] = (data) => {
                this.eventSystem.emit(newEvent, data);
            };
        });

        // 데이터 어댑터
        if (dataAdapter) {
            wrapper.dataAdapter = dataAdapter;
        }

        // 저장
        this.legacyManagers.set(name, wrapper);

        console.log(`✅ 레거시 매니저 래핑 완료: ${name}`, {
            methods: methods.length,
            events: Object.keys(events).length
        });

        return wrapper;
    }

    /**
     * 래핑된 매니저 조회
     */
    getManager(name) {
        return this.legacyManagers.get(name);
    }

    /**
     * 레거시 메서드 호출
     */
    callLegacyMethod(managerName, methodName, ...args) {
        const manager = this.getManager(managerName);

        if (!manager) {
            throw new Error(`매니저를 찾을 수 없습니다: ${managerName}`);
        }

        if (!manager.methods[methodName]) {
            throw new Error(`메서드를 찾을 수 없습니다: ${managerName}.${methodName}`);
        }

        return manager.methods[methodName](...args);
    }

    // ========================================
    // 데이터 변환
    // ========================================

    /**
     * 레거시 데이터 → 새 형식 변환
     *
     * @param {any} legacyData - 레거시 데이터
     * @param {string} type - 데이터 타입
     * @returns {any} 변환된 데이터
     */
    convertFromLegacy(legacyData, type) {
        const transformer = this.dataTransformers.get(type);

        if (!transformer || !transformer.fromLegacy) {
            console.warn(`변환 함수가 없습니다: ${type} (fromLegacy)`);
            return legacyData;
        }

        try {
            return transformer.fromLegacy(legacyData);
        } catch (error) {
            console.error(`데이터 변환 실패: ${type}`, error);
            return legacyData;
        }
    }

    /**
     * 새 형식 → 레거시 데이터 변환
     */
    convertToLegacy(newData, type) {
        const transformer = this.dataTransformers.get(type);

        if (!transformer || !transformer.toLegacy) {
            console.warn(`변환 함수가 없습니다: ${type} (toLegacy)`);
            return newData;
        }

        try {
            return transformer.toLegacy(newData);
        } catch (error) {
            console.error(`데이터 변환 실패: ${type}`, error);
            return newData;
        }
    }

    /**
     * 데이터 변환 함수 등록
     */
    registerDataTransformer(type, transformer) {
        this.dataTransformers.set(type, transformer);
        console.log(`✅ 데이터 변환 함수 등록: ${type}`);
    }

    // ========================================
    // 기존 시스템 데이터 마이그레이션
    // ========================================

    /**
     * 기존 allData를 DataSkeleton으로 마이그레이션
     */
    async migrateData() {
        console.log('⚙️ 데이터 마이그레이션 시작...');

        try {
            // 전역 allData 확인
            if (typeof window === 'undefined' || !window.allData) {
                throw new Error('window.allData를 찾을 수 없습니다');
            }

            const legacyData = window.allData;

            console.log(`📥 레거시 데이터 로드:`, {
                records: legacyData.length,
                sample: legacyData[0] ? Object.keys(legacyData[0]).length : 0
            });

            // DataSkeleton으로 저장
            await this.dataSkeleton.replaceWeeklyData(legacyData);

            console.log('✅ 데이터 마이그레이션 완료');

            return {
                success: true,
                recordCount: legacyData.length
            };

        } catch (error) {
            console.error('❌ 데이터 마이그레이션 실패:', error);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 기존 필터 상태 마이그레이션
     */
    migrateFilterState() {
        if (typeof window === 'undefined') {
            return null;
        }

        const legacyState = {
            currentFilter: window.currentFilter || 'all',
            sortState: window.sortState || { column: null, order: 'asc' },
            currentPage: window.currentPage || 1,
            pageSize: window.pageSize || 50
        };

        console.log('✅ 필터 상태 마이그레이션:', legacyState);

        return legacyState;
    }

    // ========================================
    // 점진적 마이그레이션 지원
    // ========================================

    /**
     * 매니저 마이그레이션 체크리스트 생성
     */
    createMigrationChecklist() {
        const managers = [
            'SimplePaginationManager',
            'ColumnManager',
            'FilterManager',
            'DashboardManager',
            'AdvancedFilterManager',
            'SearchEnhancementManager',
            'PortfolioManager',
            'PerformanceManager',
            'LoadingManager',
            'ScrollManager',
            'ResponsiveManager',
            'TestManager',
            'AdvancedSearchManager',
            'UIEnhancementManager',
            'DashboardFixManager',
            'AdvancedFilterEnhancer'
        ];

        this.migrationStatus.total = managers.length;
        this.migrationStatus.pending = [...managers];

        console.log('📋 마이그레이션 체크리스트 생성:', {
            total: managers.length,
            managers
        });

        return managers;
    }

    /**
     * 매니저 마이그레이션 완료 표시
     */
    markManagerMigrated(managerName) {
        const index = this.migrationStatus.pending.indexOf(managerName);

        if (index > -1) {
            this.migrationStatus.pending.splice(index, 1);
            this.migrationStatus.migrated++;

            console.log(`✅ 매니저 마이그레이션 완료: ${managerName}`, {
                progress: `${this.migrationStatus.migrated}/${this.migrationStatus.total}`
            });

            // 이벤트 발행
            this.eventSystem.emit('migration:progress', {
                manager: managerName,
                progress: this.getMigrationProgress()
            });
        }
    }

    /**
     * 마이그레이션 진행률
     */
    getMigrationProgress() {
        return {
            total: this.migrationStatus.total,
            migrated: this.migrationStatus.migrated,
            pending: this.migrationStatus.pending,
            percentage: this.migrationStatus.total > 0
                ? (this.migrationStatus.migrated / this.migrationStatus.total) * 100
                : 0
        };
    }

    // ========================================
    // SimplePaginationManager 통합
    // ========================================

    /**
     * 기존 페이징 시스템을 DataSkeleton 쿼리로 변환
     */
    createPaginationAdapter() {
        return {
            /**
             * 페이지 데이터 조회
             */
            getPageData: (page = 1, pageSize = 50, filter = {}, sort = null) => {
                const offset = (page - 1) * pageSize;

                return this.dataSkeleton.query({
                    filter,
                    sort,
                    limit: pageSize,
                    offset
                });
            },

            /**
             * 페이지 정보 계산
             */
            getPageInfo: (page = 1, pageSize = 50, filter = {}) => {
                const totalItems = this.dataSkeleton.countWhere(filter);
                const totalPages = Math.ceil(totalItems / pageSize);

                return {
                    currentPage: page,
                    pageSize,
                    totalPages,
                    totalItems,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                };
            }
        };
    }

    // ========================================
    // 이벤트 프록시
    // ========================================

    /**
     * 레거시 이벤트 → 새 이벤트 매핑
     */
    mapLegacyEvent(legacyEventName, newEventName) {
        this.eventMap.set(legacyEventName, newEventName);
        console.log(`✅ 이벤트 매핑: ${legacyEventName} → ${newEventName}`);
    }

    /**
     * 레거시 이벤트 프록시
     */
    proxyLegacyEvent(legacyEventName, data) {
        const newEventName = this.eventMap.get(legacyEventName);

        if (newEventName) {
            this.eventSystem.emit(newEventName, {
                source: 'legacy',
                originalEvent: legacyEventName,
                data
            });
        }
    }

    // ========================================
    // 기존 함수 래핑
    // ========================================

    /**
     * 기존 전역 함수 래핑
     */
    wrapGlobalFunction(functionName, wrapper) {
        if (typeof window === 'undefined') {
            return;
        }

        const originalFunction = window[functionName];

        if (typeof originalFunction !== 'function') {
            console.warn(`전역 함수를 찾을 수 없습니다: ${functionName}`);
            return;
        }

        window[functionName] = (...args) => {
            console.log(`🔄 전역 함수 호출: ${functionName}`, args);

            // wrapper 실행 (true 반환 시 원본 실행 스킵)
            const shouldSkip = wrapper(args, originalFunction);

            if (shouldSkip !== true) {
                return originalFunction(...args);
            }
        };

        console.log(`✅ 전역 함수 래핑: ${functionName}`);
    }

    // ========================================
    // 호환성 레이어
    // ========================================

    /**
     * 기존 API를 새 시스템으로 프록시
     */
    setupCompatibilityLayer() {
        if (typeof window === 'undefined') {
            return;
        }

        // 기존 applyFilters → DataSkeleton query
        const originalApplyFilters = window.applyFilters;
        if (typeof originalApplyFilters === 'function') {
            window.applyFilters = (filterType) => {
                console.log(`🔄 호환성 레이어: applyFilters(${filterType})`);

                // 새 시스템 사용
                const filter = this.convertFilterType(filterType);
                const results = this.dataSkeleton.query({ filter });

                // 기존 시스템도 호출 (점진적 마이그레이션)
                originalApplyFilters(filterType);

                return results;
            };
        }

        console.log('✅ 호환성 레이어 설정 완료');
    }

    /**
     * 필터 타입 변환
     * @private
     */
    convertFilterType(filterType) {
        const filterMap = {
            'all': {},
            'quality': { quality: { $gte: 7 } },
            'value': { value: { $gte: 7 } },
            'momentum': { momentum: { $gte: 7 } }
        };

        return filterMap[filterType] || {};
    }

    // ========================================
    // 유틸리티
    // ========================================

    /**
     * 통계 조회
     */
    getStats() {
        return {
            wrappedManagers: this.legacyManagers.size,
            dataTransformers: this.dataTransformers.size,
            eventMappings: this.eventMap.size,
            migration: this.getMigrationProgress()
        };
    }

    /**
     * 전체 초기화
     */
    async initialize() {
        console.log('⚙️ LegacyBridge 전체 초기화 시작...');

        // 1. 마이그레이션 체크리스트 생성
        this.createMigrationChecklist();

        // 2. 데이터 마이그레이션
        await this.migrateData();

        // 3. 필터 상태 마이그레이션
        this.migrateFilterState();

        // 4. 호환성 레이어 설정
        this.setupCompatibilityLayer();

        console.log('✅ LegacyBridge 전체 초기화 완료');

        // 이벤트 발행
        this.eventSystem.emit('legacy:initialized', {
            stats: this.getStats()
        });
    }
}

// 전역 인스턴스로 노출
if (typeof window !== 'undefined' && window.dataSkeleton && window.eventSystem && window.uiFramework) {
    window.legacyBridge = new LegacyBridge(
        window.dataSkeleton,
        window.eventSystem,
        window.uiFramework
    );
    console.log('✅ LegacyBridge 전역 인스턴스 생성됨: window.legacyBridge');
}
