/**
 * EventSystem - 모듈 간 통신 이벤트 버스
 *
 * 핵심 기능:
 * - 우선순위 기반 이벤트 처리
 * - 에러 격리 및 복구
 * - 이벤트 히스토리 추적
 * - 디버깅 모드
 *
 * @class EventSystem
 */
export default class EventSystem {
    constructor() {
        // 이벤트 버스
        this.eventBus = new Map();           // { eventName: Set<subscription> }
        this.eventQueue = [];                // 처리 대기 중인 이벤트
        this.processing = false;              // 처리 중 플래그
        this.queueScheduled = false;          // 큐 처리 예약 플래그

        // 이벤트 히스토리
        this.history = [];                    // 최근 이벤트 기록
        this.maxHistorySize = 100;           // 최대 히스토리 크기

        // 에러 처리
        this.errorHandlers = new Set();      // 에러 핸들러
        this.errorStats = {
            totalErrors: 0,
            byEvent: new Map()
        };

        // 성능 모니터링
        this.stats = {
            totalEvents: 0,
            byType: new Map(),
            avgProcessingTime: 0
        };

        // 디버깅
        this.debugMode = false;
        this.logger = console;

        console.log('✅ EventSystem 초기화 완료');
    }

    // ========================================
    // 이벤트 발행 (Emit)
    // ========================================

    /**
     * 이벤트 발행
     *
     * @param {string} eventName - 이벤트 이름
     * @param {any} payload - 이벤트 데이터
     * @param {Object} options - 옵션
     * @param {number} [options.priority=0] - 우선순위 (높을수록 먼저 처리)
     * @param {boolean} [options.async=true] - 비동기 처리 여부
     *
     * @example
     * eventSystem.emit('data:updated', { records: 100 });
     * eventSystem.emit('module:error', { error }, { priority: 10 });
     */
    emit(eventName, payload, options = {}) {
        const { priority = 0, async = true } = options;

        const event = {
            name: eventName,
            payload,
            priority,
            timestamp: Date.now(),
            source: this.getCallSource(),
            id: crypto.randomUUID()
        };

        if (this.debugMode) {
            this.logger.log(`📤 이벤트 발행: ${eventName}`, event);
        }

        // 히스토리에 추가
        this.addToHistory(event);

        // 통계 업데이트
        this.updateStats(eventName);

        // 큐에 추가
        this.eventQueue.push(event);

        // 우선순위 정렬
        this.eventQueue.sort((a, b) => b.priority - a.priority);

        // 비동기 처리 (마이크로태스크로 실행하여 우선순위 큐 정렬 보장)
        if (async && !this.processing && !this.queueScheduled) {
            this.queueScheduled = true;
            queueMicrotask(() => {
                this.queueScheduled = false;
                this.processQueue();
            });
        }

        // 동기 처리
        if (!async) {
            return this.processEventSync(event);
        }
    }

    /**
     * 동기 이벤트 처리
     * @private
     */
    processEventSync(event) {
        const handlers = this.eventBus.get(event.name);
        if (!handlers || handlers.size === 0) {
            return;
        }

        const sortedHandlers = Array.from(handlers)
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        for (const subscription of sortedHandlers) {
            try {
                subscription.handler(event);

                if (subscription.once) {
                    handlers.delete(subscription);
                }
            } catch (error) {
                this.handleError(error, event);
            }
        }
    }

    // ========================================
    // 이벤트 구독 (On)
    // ========================================

    /**
     * 이벤트 구독
     *
     * @param {string} eventName - 이벤트 이름
     * @param {Function} handler - 핸들러 함수
     * @param {Object} options - 옵션
     * @param {number} [options.priority=0] - 핸들러 우선순위
     * @param {boolean} [options.once=false] - 한 번만 실행
     * @param {string} [options.module] - 모듈명
     * @returns {Function} 언구독 함수
     *
     * @example
     * const unsubscribe = eventSystem.on('data:updated', (event) => {
     *     console.log('데이터 업데이트:', event.payload);
     * }, { priority: 5, module: 'dashboard' });
     *
     * // 구독 해제
     * unsubscribe();
     */
    on(eventName, handler, options = {}) {
        const { priority = 0, once = false, module = 'unknown' } = options;

        if (!this.eventBus.has(eventName)) {
            this.eventBus.set(eventName, new Set());
        }

        const subscription = {
            id: crypto.randomUUID(),
            handler,
            priority,
            once,
            module,
            createdAt: Date.now()
        };

        this.eventBus.get(eventName).add(subscription);

        if (this.debugMode) {
            this.logger.log(`✅ 구독 등록: ${eventName} (모듈: ${module})`);
        }

        // 언구독 함수 반환
        return () => {
            const handlers = this.eventBus.get(eventName);
            if (handlers) {
                handlers.delete(subscription);
                if (this.debugMode) {
                    this.logger.log(`✅ 구독 해제: ${eventName} (모듈: ${module})`);
                }
            }
        };
    }

    /**
     * 한 번만 실행되는 이벤트 구독
     */
    once(eventName, handler, options = {}) {
        return this.on(eventName, handler, { ...options, once: true });
    }

    /**
     * 모든 핸들러 제거
     */
    off(eventName, handler = null) {
        if (!this.eventBus.has(eventName)) {
            return;
        }

        if (handler === null) {
            // 모든 핸들러 제거
            this.eventBus.delete(eventName);
        } else {
            // 특정 핸들러 제거
            const handlers = this.eventBus.get(eventName);
            for (const subscription of handlers) {
                if (subscription.handler === handler) {
                    handlers.delete(subscription);
                }
            }
        }
    }

    // ========================================
    // 이벤트 큐 처리
    // ========================================

    /**
     * 이벤트 큐 처리
     * @private
     */
    async processQueue() {
        if (this.processing || this.eventQueue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift();
            await this.processEvent(event);
        }

        this.processing = false;
    }

    /**
     * 개별 이벤트 처리
     * @private
     */
    async processEvent(event) {
        const startTime = performance.now();

        const handlers = this.eventBus.get(event.name);
        if (!handlers || handlers.size === 0) {
            return;
        }

        // 우선순위순으로 정렬
        const sortedHandlers = Array.from(handlers)
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        // 핸들러 실행
        for (const subscription of sortedHandlers) {
            try {
                const result = subscription.handler(event);

                // Promise 처리
                if (result instanceof Promise) {
                    await result;
                }

                // 한 번만 실행하는 구독 제거
                if (subscription.once) {
                    handlers.delete(subscription);
                }

            } catch (error) {
                this.handleError(error, event, subscription);
            }
        }

        // 성능 측정
        const processingTime = performance.now() - startTime;
        this.updateProcessingTime(processingTime);

        if (this.debugMode) {
            this.logger.log(`⚡ 이벤트 처리 완료: ${event.name} (${processingTime.toFixed(2)}ms)`);
        }
    }

    // ========================================
    // 에러 처리 시스템
    // ========================================

    /**
     * 에러 처리
     * @private
     */
    handleError(error, event, subscription = null) {
        this.errorStats.totalErrors++;

        // 이벤트별 에러 카운트
        if (!this.errorStats.byEvent.has(event.name)) {
            this.errorStats.byEvent.set(event.name, 0);
        }
        this.errorStats.byEvent.set(
            event.name,
            this.errorStats.byEvent.get(event.name) + 1
        );

        const errorEvent = {
            type: 'system:error',
            error: {
                message: error.message,
                stack: error.stack
            },
            originalEvent: event,
            subscription: subscription ? {
                module: subscription.module,
                priority: subscription.priority
            } : null,
            timestamp: Date.now()
        };

        this.logger.error(`❌ 이벤트 처리 에러:`, errorEvent);

        // 에러 핸들러 호출
        for (const errorHandler of this.errorHandlers) {
            try {
                errorHandler(errorEvent);
            } catch (handlerError) {
                this.logger.error('에러 핸들러 실행 실패:', handlerError);
            }
        }

        // 시스템 에러 이벤트 발행 (무한 루프 방지)
        if (event.name !== 'system:error') {
            this.emit('system:error', errorEvent, { priority: 10 });
        }
    }

    /**
     * 에러 핸들러 등록
     */
    onError(handler) {
        this.errorHandlers.add(handler);

        return () => {
            this.errorHandlers.delete(handler);
        };
    }

    // ========================================
    // 유틸리티 메서드
    // ========================================

    /**
     * 호출 소스 추적
     * @private
     */
    getCallSource() {
        try {
            const stack = new Error().stack;
            const lines = stack.split('\n');
            return lines[3] ? lines[3].trim() : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    /**
     * 히스토리에 추가
     * @private
     */
    addToHistory(event) {
        this.history.push({
            ...event,
            recordedAt: Date.now()
        });

        // 히스토리 크기 제한
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    /**
     * 통계 업데이트
     * @private
     */
    updateStats(eventName) {
        this.stats.totalEvents++;

        if (!this.stats.byType.has(eventName)) {
            this.stats.byType.set(eventName, 0);
        }
        this.stats.byType.set(
            eventName,
            this.stats.byType.get(eventName) + 1
        );
    }

    /**
     * 처리 시간 업데이트
     * @private
     */
    updateProcessingTime(time) {
        const total = this.stats.avgProcessingTime * (this.stats.totalEvents - 1) + time;
        this.stats.avgProcessingTime = total / this.stats.totalEvents;
    }

    // ========================================
    // 정보 조회 API
    // ========================================

    /**
     * 이벤트 히스토리 조회
     */
    getHistory(eventName = null) {
        if (eventName === null) {
            return this.history;
        }
        return this.history.filter(e => e.name === eventName);
    }

    /**
     * 통계 조회
     */
    getStats() {
        return {
            ...this.stats,
            errorStats: this.errorStats,
            queueSize: this.eventQueue.length,
            subscriberCount: Array.from(this.eventBus.values())
                .reduce((sum, handlers) => sum + handlers.size, 0)
        };
    }

    /**
     * 구독자 목록 조회
     */
    getSubscribers(eventName = null) {
        if (eventName === null) {
            const all = {};
            for (const [name, handlers] of this.eventBus.entries()) {
                all[name] = Array.from(handlers).map(s => ({
                    module: s.module,
                    priority: s.priority,
                    once: s.once
                }));
            }
            return all;
        }

        const handlers = this.eventBus.get(eventName);
        if (!handlers) return [];

        return Array.from(handlers).map(s => ({
            module: s.module,
            priority: s.priority,
            once: s.once
        }));
    }

    /**
     * 디버그 모드 설정
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.logger.log(`✅ 디버그 모드: ${enabled ? '활성화' : '비활성화'}`);
    }

    /**
     * 큐 클리어
     */
    clearQueue() {
        this.eventQueue = [];
        this.logger.log('✅ 이벤트 큐 클리어 완료');
    }

    /**
     * 모든 구독 제거
     */
    clearAllSubscriptions() {
        this.eventBus.clear();
        this.logger.log('✅ 모든 구독 제거 완료');
    }
}

// 전역 인스턴스로 노출
if (typeof window !== 'undefined') {
    window.eventSystem = new EventSystem();
    console.log('✅ EventSystem 전역 인스턴스 생성됨: window.eventSystem');
}
