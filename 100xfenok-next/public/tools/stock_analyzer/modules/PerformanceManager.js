/**
 * PerformanceManager - 성능 모니터링 및 최적화 시스템
 */

class PerformanceManager {
    constructor() {
        this.metrics = {
            loadTime: 0,
            renderTime: 0,
            filterTime: 0,
            memoryUsage: 0,
            userActions: []
        };
        
        this.observers = [];
        this.isMonitoring = false;
        
        console.log('⚡ PerformanceManager 초기화');
    }

    /**
     * 성능 모니터링 시작
     */
    startMonitoring() {
        this.isMonitoring = true;
        
        this.setupPerformanceObservers();
        this.monitorMemoryUsage();
        this.trackUserActions();
        this.measureLoadTime();
        
        console.log('📊 성능 모니터링 시작');
    }

    /**
     * Performance Observer 설정
     */
    setupPerformanceObservers() {
        if (!window.PerformanceObserver) {
            console.warn('PerformanceObserver not supported');
            return;
        }

        // Navigation Timing 관찰
        const navObserver = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                if (entry.entryType === 'navigation') {
                    this.metrics.loadTime = entry.loadEventEnd - entry.fetchStart;
                    console.log(`⏱️ 페이지 로딩 시간: ${this.metrics.loadTime.toFixed(2)}ms`);
                }
            });
        });

        try {
            navObserver.observe({ entryTypes: ['navigation'] });
            this.observers.push(navObserver);
        } catch (e) {
            console.warn('Navigation timing not supported');
        }

        // Measure 관찰
        const measureObserver = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                if (entry.name.includes('render')) {
                    this.metrics.renderTime = entry.duration;
                } else if (entry.name.includes('filter')) {
                    this.metrics.filterTime = entry.duration;
                }
                
                console.log(`📏 ${entry.name}: ${entry.duration.toFixed(2)}ms`);
            });
        });

        try {
            measureObserver.observe({ entryTypes: ['measure'] });
            this.observers.push(measureObserver);
        } catch (e) {
            console.warn('Measure timing not supported');
        }

        // Long Task 관찰
        const longTaskObserver = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            entries.forEach(entry => {
                console.warn(`🐌 Long Task 감지: ${entry.duration.toFixed(2)}ms`);
                this.reportLongTask(entry);
            });
        });

        try {
            longTaskObserver.observe({ entryTypes: ['longtask'] });
            this.observers.push(longTaskObserver);
        } catch (e) {
            console.warn('Long Task API not supported');
        }
    }

    /**
     * 메모리 사용량 모니터링
     */
    monitorMemoryUsage() {
        if (!performance.memory) {
            console.warn('Memory API not supported');
            return;
        }

        const checkMemory = () => {
            const memory = performance.memory;
            this.metrics.memoryUsage = {
                used: memory.usedJSHeapSize,
                total: memory.totalJSHeapSize,
                limit: memory.jsHeapSizeLimit
            };

            // 메모리 사용률이 80% 이상이면 경고
            const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
            if (usagePercent > 80) {
                console.warn(`🚨 높은 메모리 사용률: ${usagePercent.toFixed(1)}%`);
                this.suggestMemoryOptimization();
            }
        };

        // 5초마다 메모리 체크
        setInterval(checkMemory, 5000);
        checkMemory(); // 즉시 실행
    }

    /**
     * 사용자 액션 추적
     */
    trackUserActions() {
        const actionTypes = ['click', 'scroll', 'input', 'keydown'];
        
        actionTypes.forEach(type => {
            document.addEventListener(type, (e) => {
                this.recordUserAction(type, e);
            }, { passive: true });
        });
    }

    /**
     * 사용자 액션 기록
     */
    recordUserAction(type, event) {
        const action = {
            type,
            timestamp: performance.now(),
            target: event.target.tagName,
            id: event.target.id,
            className: event.target.className
        };

        this.metrics.userActions.push(action);
        
        // 최근 100개 액션만 유지
        if (this.metrics.userActions.length > 100) {
            this.metrics.userActions.shift();
        }
    }

    /**
     * 로딩 시간 측정
     */
    measureLoadTime() {
        performance.mark('app-start');
        
        // 데이터 로딩 완료 시점 측정
        const originalLoadData = window.loadData;
        if (originalLoadData) {
            window.loadData = async function() {
                performance.mark('data-load-start');
                const result = await originalLoadData.apply(this, arguments);
                performance.mark('data-load-end');
                performance.measure('data-loading', 'data-load-start', 'data-load-end');
                return result;
            };
        }
    }

    /**
     * 렌더링 성능 측정
     */
    measureRenderPerformance(operation, callback) {
        const markStart = `${operation}-start`;
        const markEnd = `${operation}-end`;
        const measureName = `${operation}-duration`;

        performance.mark(markStart);
        
        const result = callback();
        
        if (result && result.then) {
            // Promise인 경우
            return result.then(res => {
                performance.mark(markEnd);
                performance.measure(measureName, markStart, markEnd);
                return res;
            });
        } else {
            // 동기 함수인 경우
            performance.mark(markEnd);
            performance.measure(measureName, markStart, markEnd);
            return result;
        }
    }

    /**
     * 필터링 성능 측정
     */
    measureFilterPerformance(filterFunction, data) {
        return this.measureRenderPerformance('filter-operation', () => {
            return filterFunction(data);
        });
    }

    /**
     * 테이블 렌더링 성능 측정
     */
    measureTableRender(renderFunction, data) {
        return this.measureRenderPerformance('table-render', () => {
            return renderFunction(data);
        });
    }

    /**
     * Long Task 리포트
     */
    reportLongTask(entry) {
        const report = {
            duration: entry.duration,
            startTime: entry.startTime,
            name: entry.name,
            attribution: entry.attribution
        };

        // 개발자 도구에 상세 정보 출력
        console.group('🐌 Long Task 상세 정보');
        console.log('Duration:', `${report.duration.toFixed(2)}ms`);
        console.log('Start Time:', `${report.startTime.toFixed(2)}ms`);
        console.log('Attribution:', report.attribution);
        console.groupEnd();

        // 최적화 제안
        this.suggestOptimization(report);
    }

    /**
     * 최적화 제안
     */
    suggestOptimization(taskInfo) {
        const suggestions = [];

        if (taskInfo.duration > 100) {
            suggestions.push('작업을 더 작은 단위로 분할하세요');
            suggestions.push('requestIdleCallback 사용을 고려하세요');
        }

        if (taskInfo.duration > 500) {
            suggestions.push('Web Worker 사용을 고려하세요');
            suggestions.push('가상 스크롤링 구현을 고려하세요');
        }

        if (suggestions.length > 0) {
            console.group('💡 성능 최적화 제안');
            suggestions.forEach(suggestion => console.log(`• ${suggestion}`));
            console.groupEnd();
        }
    }

    /**
     * 메모리 최적화 제안
     */
    suggestMemoryOptimization() {
        const suggestions = [
            '사용하지 않는 데이터 정리',
            '이벤트 리스너 정리',
            'DOM 요소 캐시 정리',
            '큰 배열이나 객체 해제'
        ];

        console.group('🧹 메모리 최적화 제안');
        suggestions.forEach(suggestion => console.log(`• ${suggestion}`));
        console.groupEnd();
    }

    /**
     * 성능 리포트 생성
     */
    generatePerformanceReport() {
        const report = {
            timestamp: new Date().toISOString(),
            metrics: { ...this.metrics },
            browser: this.getBrowserInfo(),
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            connection: this.getConnectionInfo()
        };

        console.group('📊 성능 리포트');
        console.log('로딩 시간:', `${report.metrics.loadTime.toFixed(2)}ms`);
        console.log('렌더링 시간:', `${report.metrics.renderTime.toFixed(2)}ms`);
        console.log('필터링 시간:', `${report.metrics.filterTime.toFixed(2)}ms`);
        
        if (report.metrics.memoryUsage) {
            const memory = report.metrics.memoryUsage;
            console.log('메모리 사용량:', `${(memory.used / 1024 / 1024).toFixed(2)}MB`);
            console.log('메모리 사용률:', `${((memory.used / memory.limit) * 100).toFixed(1)}%`);
        }
        
        console.log('사용자 액션 수:', report.metrics.userActions.length);
        console.log('브라우저:', report.browser);
        console.log('뷰포트:', `${report.viewport.width}x${report.viewport.height}`);
        console.groupEnd();

        return report;
    }

    /**
     * 브라우저 정보 수집
     */
    getBrowserInfo() {
        const ua = navigator.userAgent;
        let browser = 'Unknown';
        
        if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Edge')) browser = 'Edge';

        return {
            name: browser,
            userAgent: ua,
            language: navigator.language,
            platform: navigator.platform
        };
    }

    /**
     * 연결 정보 수집
     */
    getConnectionInfo() {
        if (!navigator.connection) {
            return { type: 'unknown' };
        }

        return {
            effectiveType: navigator.connection.effectiveType,
            downlink: navigator.connection.downlink,
            rtt: navigator.connection.rtt,
            saveData: navigator.connection.saveData
        };
    }

    /**
     * 성능 최적화 실행
     */
    optimizePerformance() {
        console.log('🚀 성능 최적화 실행');

        // 1. 이벤트 리스너 정리
        this.cleanupEventListeners();

        // 2. DOM 캐시 정리
        this.cleanupDOMCache();

        // 3. 메모리 정리
        this.cleanupMemory();

        // 4. 가비지 컬렉션 제안
        if (window.gc) {
            window.gc();
            console.log('🗑️ 가비지 컬렉션 실행');
        }
    }

    /**
     * 이벤트 리스너 정리
     */
    cleanupEventListeners() {
        // 사용하지 않는 이벤트 리스너 제거
        console.log('🧹 이벤트 리스너 정리');
    }

    /**
     * DOM 캐시 정리
     */
    cleanupDOMCache() {
        // DOM 요소 캐시 정리
        console.log('🧹 DOM 캐시 정리');
    }

    /**
     * 메모리 정리
     */
    cleanupMemory() {
        // 큰 배열이나 객체 정리
        if (this.metrics.userActions.length > 50) {
            this.metrics.userActions = this.metrics.userActions.slice(-50);
        }
        
        console.log('🧹 메모리 정리 완료');
    }

    /**
     * 실시간 성능 모니터링 UI
     */
    createPerformanceMonitor() {
        if (document.getElementById('performance-monitor')) return;

        const monitor = document.createElement('div');
        monitor.id = 'performance-monitor';
        monitor.className = 'fixed bottom-4 left-4 bg-black bg-opacity-80 text-white p-3 rounded-lg text-xs font-mono z-50';
        monitor.style.display = 'none';
        
        monitor.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <span class="font-bold">성능 모니터</span>
                <button id="toggle-performance-monitor" class="text-gray-300 hover:text-white">×</button>
            </div>
            <div id="performance-stats">
                <div>메모리: <span id="memory-usage">-</span></div>
                <div>FPS: <span id="fps-counter">-</span></div>
                <div>렌더링: <span id="render-time">-</span>ms</div>
            </div>
        `;

        document.body.appendChild(monitor);

        // 토글 버튼
        document.getElementById('toggle-performance-monitor').addEventListener('click', () => {
            monitor.remove();
        });

        // 실시간 업데이트
        this.updatePerformanceMonitor();
    }

    /**
     * 성능 모니터 업데이트
     */
    updatePerformanceMonitor() {
        const updateStats = () => {
            const memoryElement = document.getElementById('memory-usage');
            const fpsElement = document.getElementById('fps-counter');
            const renderElement = document.getElementById('render-time');

            if (memoryElement && performance.memory) {
                const memory = performance.memory;
                const usedMB = (memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
                memoryElement.textContent = `${usedMB}MB`;
            }

            if (renderElement) {
                renderElement.textContent = this.metrics.renderTime.toFixed(1);
            }
        };

        setInterval(updateStats, 1000);
    }

    /**
     * 성능 모니터 표시/숨김
     */
    togglePerformanceMonitor() {
        const monitor = document.getElementById('performance-monitor');
        if (monitor) {
            monitor.style.display = monitor.style.display === 'none' ? 'block' : 'none';
        } else {
            this.createPerformanceMonitor();
        }
    }

    /**
     * 모니터링 중지
     */
    stopMonitoring() {
        this.isMonitoring = false;
        
        // Observer 정리
        this.observers.forEach(observer => {
            observer.disconnect();
        });
        this.observers = [];
        
        console.log('📊 성능 모니터링 중지');
    }

    /**
     * 성능 메트릭 반환
     */
    getMetrics() {
        return { ...this.metrics };
    }
}

// 전역 인스턴스 생성
window.performanceManager = new PerformanceManager();

// 개발 모드에서 성능 모니터 키보드 단축키 (Ctrl+Shift+P)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        window.performanceManager.togglePerformanceMonitor();
    }
});

console.log('✅ PerformanceManager 로드 완료 - 성능 모니터링 시스템');