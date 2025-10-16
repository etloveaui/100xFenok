/**
 * ChartLifecycleManager - Chart Lazy Initialization 통합 관리
 *
 * Tab visibility 기반으로 차트를 lazy initialization하여
 * 초기 로딩 속도 향상 및 메모리 효율성 개선
 *
 * @class ChartLifecycleManager
 */
export default class ChartLifecycleManager {
    constructor() {
        // 차트 레지스트리: chartId → { component, state, retryCount }
        this.charts = new Map();

        // 차트 상태
        this.STATES = {
            NEEDS_INIT: 'needsInit',
            INITIALIZING: 'initializing',
            INITIALIZED: 'initialized',
            FAILED: 'failed'
        };

        // 재시도 설정
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 100; // ms

        console.log('✅ ChartLifecycleManager 생성됨');
    }

    /**
     * 차트 등록
     * @param {string} chartId - 차트 고유 ID
     * @param {Object} component - 차트 컴포넌트 인스턴스
     */
    registerChart(chartId, component) {
        if (!chartId || !component) {
            console.error('❌ ChartLifecycleManager: chartId와 component 필수');
            return false;
        }

        // 필수 메서드 확인
        if (typeof component.ensureInitialized !== 'function') {
            console.warn(`⚠️ ${chartId}: ensureInitialized() 메서드 없음`);
            return false;
        }

        this.charts.set(chartId, {
            component: component,
            state: this.STATES.NEEDS_INIT,
            retryCount: 0
        });

        console.log(`📋 Chart registered: ${chartId}`);
        return true;
    }

    /**
     * 차트 등록 해제
     * @param {string} chartId - 차트 ID
     */
    unregisterChart(chartId) {
        if (this.charts.has(chartId)) {
            this.charts.delete(chartId);
            console.log(`📋 Chart unregistered: ${chartId}`);
            return true;
        }
        return false;
    }

    /**
     * 차트 초기화 (개별)
     * @param {string} chartId - 초기화할 차트 ID
     * @returns {Promise<boolean>} 초기화 성공 여부
     */
    async ensureInitialized(chartId) {
        const chartInfo = this.charts.get(chartId);

        if (!chartInfo) {
            console.warn(`⚠️ Chart not found: ${chartId}`);
            return false;
        }

        // 이미 초기화됨
        if (chartInfo.state === this.STATES.INITIALIZED) {
            console.log(`ℹ️ ${chartId} already initialized`);
            return true;
        }

        // 초기화 중
        if (chartInfo.state === this.STATES.INITIALIZING) {
            console.log(`ℹ️ ${chartId} already initializing`);
            return true;
        }

        // 재시도 횟수 초과
        if (chartInfo.retryCount >= this.MAX_RETRIES) {
            console.error(`❌ ${chartId} max retries exceeded`);
            chartInfo.state = this.STATES.FAILED;
            return false;
        }

        // 초기화 시작
        chartInfo.state = this.STATES.INITIALIZING;

        try {
            // 컴포넌트의 ensureInitialized() 호출
            chartInfo.component.ensureInitialized();

            // 초기화 성공 확인 (chart 인스턴스 존재 확인)
            if (chartInfo.component.chart) {
                chartInfo.state = this.STATES.INITIALIZED;
                console.log(`✅ ${chartId} Lazy Initialization 완료`);
                return true;
            } else {
                // Canvas 준비 안됨 - 재시도
                chartInfo.retryCount++;
                chartInfo.state = this.STATES.NEEDS_INIT;
                console.warn(`⚠️ ${chartId} initialization incomplete (retry ${chartInfo.retryCount}/${this.MAX_RETRIES})`);

                // 재시도 스케줄링
                setTimeout(() => {
                    this.ensureInitialized(chartId);
                }, this.RETRY_DELAY);

                return false;
            }
        } catch (error) {
            console.error(`❌ ${chartId} initialization failed:`, error);
            chartInfo.state = this.STATES.FAILED;
            chartInfo.retryCount++;
            return false;
        }
    }

    /**
     * 모든 등록된 차트 초기화
     * @returns {Promise<Object>} 초기화 결과 { success: number, failed: number }
     */
    async ensureAllInitialized() {
        console.log('🔄 Initializing all registered charts...');

        const results = {
            success: 0,
            failed: 0,
            total: this.charts.size
        };

        // 병렬 초기화
        const promises = Array.from(this.charts.keys()).map(async (chartId) => {
            const success = await this.ensureInitialized(chartId);
            if (success) {
                results.success++;
            } else {
                results.failed++;
            }
        });

        await Promise.all(promises);

        console.log(`✅ Chart initialization complete: ${results.success}/${results.total} succeeded, ${results.failed} failed`);
        return results;
    }

    /**
     * 특정 차트 상태 조회
     * @param {string} chartId - 차트 ID
     * @returns {string|null} 차트 상태
     */
    getChartState(chartId) {
        const chartInfo = this.charts.get(chartId);
        return chartInfo ? chartInfo.state : null;
    }

    /**
     * 모든 차트 상태 조회
     * @returns {Object} { chartId: state, ... }
     */
    getAllStates() {
        const states = {};
        this.charts.forEach((chartInfo, chartId) => {
            states[chartId] = chartInfo.state;
        });
        return states;
    }

    /**
     * 차트 재시도 카운트 리셋
     * @param {string} chartId - 차트 ID (없으면 전체 리셋)
     */
    resetRetryCount(chartId = null) {
        if (chartId) {
            const chartInfo = this.charts.get(chartId);
            if (chartInfo) {
                chartInfo.retryCount = 0;
                console.log(`🔄 ${chartId} retry count reset`);
            }
        } else {
            // 전체 리셋
            this.charts.forEach((chartInfo) => {
                chartInfo.retryCount = 0;
            });
            console.log('🔄 All retry counts reset');
        }
    }

    /**
     * 실패한 차트 재초기화
     * @returns {Promise<Object>} 재초기화 결과
     */
    async retryFailedCharts() {
        console.log('🔄 Retrying failed charts...');

        const failedCharts = Array.from(this.charts.entries())
            .filter(([_, info]) => info.state === this.STATES.FAILED)
            .map(([chartId, _]) => chartId);

        if (failedCharts.length === 0) {
            console.log('ℹ️ No failed charts to retry');
            return { success: 0, failed: 0, total: 0 };
        }

        // 재시도 카운트 리셋
        failedCharts.forEach(chartId => {
            const chartInfo = this.charts.get(chartId);
            chartInfo.state = this.STATES.NEEDS_INIT;
            chartInfo.retryCount = 0;
        });

        // 재초기화
        const results = {
            success: 0,
            failed: 0,
            total: failedCharts.length
        };

        const promises = failedCharts.map(async (chartId) => {
            const success = await this.ensureInitialized(chartId);
            if (success) {
                results.success++;
            } else {
                results.failed++;
            }
        });

        await Promise.all(promises);

        console.log(`✅ Retry complete: ${results.success}/${results.total} recovered`);
        return results;
    }

    /**
     * 차트 파괴 (cleanup)
     * @param {string} chartId - 파괴할 차트 ID (없으면 전체)
     */
    destroy(chartId = null) {
        if (chartId) {
            const chartInfo = this.charts.get(chartId);
            if (chartInfo && chartInfo.component.destroy) {
                chartInfo.component.destroy();
            }
            this.unregisterChart(chartId);
        } else {
            // 전체 파괴
            this.charts.forEach((chartInfo, id) => {
                if (chartInfo.component.destroy) {
                    chartInfo.component.destroy();
                }
            });
            this.charts.clear();
            console.log('✅ All charts destroyed');
        }
    }

    /**
     * 디버그 정보 출력
     */
    debugInfo() {
        console.log('\n📊 ===== ChartLifecycleManager Debug Info =====');
        console.log(`Total Charts: ${this.charts.size}`);

        const stateCount = {
            needsInit: 0,
            initializing: 0,
            initialized: 0,
            failed: 0
        };

        this.charts.forEach((chartInfo, chartId) => {
            console.log(`  ${chartId}: ${chartInfo.state} (retries: ${chartInfo.retryCount})`);
            stateCount[chartInfo.state]++;
        });

        console.log('\nState Summary:');
        console.log(`  Needs Init: ${stateCount.needsInit}`);
        console.log(`  Initializing: ${stateCount.initializing}`);
        console.log(`  Initialized: ${stateCount.initialized}`);
        console.log(`  Failed: ${stateCount.failed}`);
        console.log('=============================================\n');
    }
}
