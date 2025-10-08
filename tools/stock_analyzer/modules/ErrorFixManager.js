/**
 * ErrorFixManager - 전역 오류 처리 및 수정 시스템
 */

class ErrorFixManager {
    constructor() {
        this.errorLog = [];
        this.maxLogSize = 100;
        this.isInitialized = false;
        
        console.log('🚨 ErrorFixManager 초기화');
    }

    /**
     * 전역 오류 처리 시스템 초기화
     */
    initialize() {
        if (this.isInitialized) return;
        
        this.setupGlobalErrorHandler();
        this.setupUnhandledRejectionHandler();
        this.setupConsoleErrorCapture();
        this.setupPerformanceMonitoring();
        
        this.isInitialized = true;
        console.log('✅ 전역 오류 처리 시스템 초기화 완료');
    }

    /**
     * 전역 JavaScript 오류 핸들러 설정
     */
    setupGlobalErrorHandler() {
        window.addEventListener('error', (event) => {
            const errorInfo = {
                type: 'JavaScript Error',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href
            };

            this.logError(errorInfo);
            this.handleError(errorInfo);
        });

        console.log('🔧 전역 JavaScript 오류 핸들러 설정 완료');
    }

    /**
     * Promise 거부 처리 핸들러 설정
     */
    setupUnhandledRejectionHandler() {
        window.addEventListener('unhandledrejection', (event) => {
            const errorInfo = {
                type: 'Unhandled Promise Rejection',
                message: event.reason?.message || event.reason,
                stack: event.reason?.stack,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href
            };

            this.logError(errorInfo);
            this.handleError(errorInfo);
            
            // 기본 동작 방지 (콘솔 출력 방지)
            event.preventDefault();
        });

        console.log('🔧 Promise 거부 처리 핸들러 설정 완료');
    }

    /**
     * 콘솔 오류 캡처 설정
     */
    setupConsoleErrorCapture() {
        const originalConsoleError = console.error;
        
        console.error = (...args) => {
            // 원본 console.error 호출
            originalConsoleError.apply(console, args);
            
            // 오류 정보 수집
            const errorInfo = {
                type: 'Console Error',
                message: args.join(' '),
                timestamp: new Date().toISOString(),
                stack: new Error().stack,
                url: window.location.href
            };

            this.logError(errorInfo);
        };

        console.log('🔧 콘솔 오류 캡처 설정 완료');
    }

    /**
     * 성능 모니터링 설정
     */
    setupPerformanceMonitoring() {
        // Long Task 감지
        if ('PerformanceObserver' in window) {
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.duration > 50) { // 50ms 이상의 긴 작업
                            const errorInfo = {
                                type: 'Performance Warning',
                                message: `Long Task detected: ${entry.duration.toFixed(2)}ms`,
                                duration: entry.duration,
                                startTime: entry.startTime,
                                timestamp: new Date().toISOString()
                            };
                            
                            this.logError(errorInfo);
                        }
                    }
                });
                
                observer.observe({ entryTypes: ['longtask'] });
            } catch (e) {
                console.warn('PerformanceObserver not supported for longtask');
            }
        }

        console.log('🔧 성능 모니터링 설정 완료');
    }

    /**
     * 오류 로깅
     */
    logError(errorInfo) {
        // 로그 크기 제한
        if (this.errorLog.length >= this.maxLogSize) {
            this.errorLog.shift(); // 가장 오래된 로그 제거
        }

        this.errorLog.push(errorInfo);

        // 심각한 오류인 경우 즉시 처리
        if (this.isCriticalError(errorInfo)) {
            this.handleCriticalError(errorInfo);
        }
    }

    /**
     * 오류 처리
     */
    handleError(errorInfo) {
        // 개발 모드에서는 상세 로그 출력
        if (this.isDevelopmentMode()) {
            console.group(`🚨 ${errorInfo.type}`);
            console.error('Message:', errorInfo.message);
            if (errorInfo.filename) console.error('File:', errorInfo.filename);
            if (errorInfo.lineno) console.error('Line:', errorInfo.lineno);
            if (errorInfo.stack) console.error('Stack:', errorInfo.stack);
            console.groupEnd();
        }

        // 사용자에게 친화적인 알림 (심각한 오류가 아닌 경우)
        if (!this.isCriticalError(errorInfo)) {
            this.showUserFriendlyNotification(errorInfo);
        }

        // 자동 복구 시도
        this.attemptAutoRecovery(errorInfo);
    }

    /**
     * 심각한 오류 판단
     */
    isCriticalError(errorInfo) {
        const criticalPatterns = [
            /Cannot read properties of undefined/,
            /Cannot read property .* of undefined/,
            /is not a function/,
            /Network Error/,
            /Failed to fetch/
        ];

        return criticalPatterns.some(pattern => 
            pattern.test(errorInfo.message)
        );
    }

    /**
     * 심각한 오류 처리
     */
    handleCriticalError(errorInfo) {
        console.error('🔥 Critical Error Detected:', errorInfo);
        
        // 사용자에게 알림
        if (window.loadingManager) {
            window.loadingManager.showFeedback(
                '시스템 오류가 발생했습니다. 페이지를 새로고침해주세요.',
                'error',
                5000
            );
        }

        // 자동 복구 시도
        setTimeout(() => {
            this.attemptSystemRecovery();
        }, 1000);
    }

    /**
     * 사용자 친화적 알림 표시
     */
    showUserFriendlyNotification(errorInfo) {
        // 너무 빈번한 알림 방지
        if (this.shouldSuppressNotification(errorInfo)) {
            return;
        }

        let userMessage = '일시적인 오류가 발생했습니다.';
        
        // 오류 유형별 맞춤 메시지
        if (errorInfo.message.includes('fetch')) {
            userMessage = '데이터 로딩 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
        } else if (errorInfo.message.includes('undefined')) {
            userMessage = '데이터 처리 중 오류가 발생했습니다.';
        } else if (errorInfo.type === 'Performance Warning') {
            userMessage = '시스템이 느려질 수 있습니다. 잠시만 기다려주세요.';
        }

        if (window.loadingManager) {
            window.loadingManager.showFeedback(userMessage, 'warning', 3000);
        }
    }

    /**
     * 알림 억제 판단
     */
    shouldSuppressNotification(errorInfo) {
        const recentErrors = this.errorLog.filter(log => 
            Date.now() - new Date(log.timestamp).getTime() < 5000 // 5초 이내
        );

        // 같은 유형의 오류가 3개 이상이면 억제
        const sameTypeErrors = recentErrors.filter(log => 
            log.type === errorInfo.type && 
            log.message === errorInfo.message
        );

        return sameTypeErrors.length >= 3;
    }

    /**
     * 자동 복구 시도
     */
    attemptAutoRecovery(errorInfo) {
        // 검색 인덱스 관련 오류
        if (errorInfo.message.includes('buildSearchIndex')) {
            console.log('🔄 검색 인덱스 자동 복구 시도');
            setTimeout(() => {
                if (window.advancedSearchManager) {
                    window.advancedSearchManager.rebuildSearchIndex();
                }
            }, 2000);
        }

        // 데이터 로딩 관련 오류
        if (errorInfo.message.includes('allData') || errorInfo.message.includes('undefined')) {
            console.log('🔄 데이터 재로딩 시도');
            setTimeout(() => {
                if (window.location.reload) {
                    // 데이터 재로딩 시도 (전체 새로고침은 마지막 수단)
                    this.attemptDataReload();
                }
            }, 3000);
        }

        // 차트 렌더링 오류
        if (errorInfo.message.includes('chart') || errorInfo.message.includes('Chart')) {
            console.log('🔄 차트 재렌더링 시도');
            setTimeout(() => {
                if (window.chartManager) {
                    window.chartManager.reinitialize();
                }
            }, 1000);
        }
    }

    /**
     * 데이터 재로딩 시도
     */
    attemptDataReload() {
        if (window.dataManager && typeof window.dataManager.reloadData === 'function') {
            window.dataManager.reloadData();
        } else if (window.loadEnhancedData && typeof window.loadEnhancedData === 'function') {
            window.loadEnhancedData();
        }
    }

    /**
     * 시스템 복구 시도
     */
    attemptSystemRecovery() {
        console.log('🔄 시스템 자동 복구 시도');
        
        try {
            // 주요 매니저들 재초기화
            if (window.loadingManager) {
                window.loadingManager.hideLoading();
            }
            
            if (window.advancedSearchManager) {
                window.advancedSearchManager.initialize();
            }
            
            if (window.cardViewManager) {
                window.cardViewManager.initialize();
            }
            
            console.log('✅ 시스템 복구 완료');
        } catch (recoveryError) {
            console.error('❌ 시스템 복구 실패:', recoveryError);
            
            // 최후의 수단: 페이지 새로고침 제안
            if (confirm('시스템 복구에 실패했습니다. 페이지를 새로고침하시겠습니까?')) {
                window.location.reload();
            }
        }
    }

    /**
     * 개발 모드 판단
     */
    isDevelopmentMode() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1' ||
               window.location.protocol === 'file:';
    }

    /**
     * 오류 통계 반환
     */
    getErrorStats() {
        const stats = {
            total: this.errorLog.length,
            byType: {},
            recent: 0,
            critical: 0
        };

        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        this.errorLog.forEach(error => {
            // 타입별 통계
            stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
            
            // 최근 1시간 내 오류
            if (new Date(error.timestamp).getTime() > oneHourAgo) {
                stats.recent++;
            }
            
            // 심각한 오류
            if (this.isCriticalError(error)) {
                stats.critical++;
            }
        });

        return stats;
    }

    /**
     * 오류 로그 내보내기
     */
    exportErrorLog() {
        const logData = {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            stats: this.getErrorStats(),
            errors: this.errorLog
        };

        const blob = new Blob([JSON.stringify(logData, null, 2)], {
            type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `error-log-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('📁 오류 로그 내보내기 완료');
    }

    /**
     * 오류 로그 초기화
     */
    clearErrorLog() {
        this.errorLog = [];
        console.log('🗑️ 오류 로그 초기화 완료');
    }

    /**
     * 디버그 정보 표시
     */
    showDebugInfo() {
        const stats = this.getErrorStats();
        
        console.group('🔍 ErrorFixManager Debug Info');
        console.log('Total Errors:', stats.total);
        console.log('Recent Errors (1h):', stats.recent);
        console.log('Critical Errors:', stats.critical);
        console.log('Errors by Type:', stats.byType);
        console.log('Latest Errors:', this.errorLog.slice(-5));
        console.groupEnd();
        
        return stats;
    }
}

// 전역 인스턴스 생성 및 즉시 초기화
window.errorFixManager = new ErrorFixManager();

// DOM이 로드되면 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.errorFixManager.initialize();
    });
} else {
    window.errorFixManager.initialize();
}

console.log('✅ ErrorFixManager 로드 완료 - 전역 오류 처리 시스템');