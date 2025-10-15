/**
 * ErrorBoundary - Error isolation and recovery system
 * Catches errors in module components and prevents cascade failures
 *
 * @module Core/ErrorBoundary
 * @version 1.0.0
 */

class ErrorBoundary {
    constructor(config = {}) {
        this.errorHandlers = new Map();
        this.errorLog = [];
        this.errorRecoveryStrategies = new Map();
        this.eventBus = null;

        this.config = {
            maxErrorLogSize: config.maxErrorLogSize || 100,
            enableErrorReporting: config.enableErrorReporting !== false,
            errorReportEndpoint: config.errorReportEndpoint || null,
            autoRecover: config.autoRecover !== false,
            recoveryAttempts: config.recoveryAttempts || 3,
            recoveryDelay: config.recoveryDelay || 1000,
            fallbackUI: config.fallbackUI || this.defaultFallbackUI
        };

        // Global error handlers
        this.setupGlobalErrorHandlers();

        // Recovery state
        this.recoveryState = new Map();

        console.log('✅ ErrorBoundary initialized');
    }

    /**
     * Initialize with event bus
     * @param {EventBus} eventBus - Event bus instance
     */
    initialize(eventBus) {
        this.eventBus = eventBus;
        this.setupEventListeners();
    }

    /**
     * Create module-specific error boundary
     * @param {string} moduleId - Module identifier
     * @param {HTMLElement} container - Module container element
     * @returns {Object} Error boundary instance
     */
    createModuleBoundary(moduleId, container) {
        const boundary = {
            moduleId,
            container,
            errorCount: 0,
            lastError: null,
            isRecovering: false,

            // Wrap module execution
            wrap: (fn, context = null) => {
                return (...args) => {
                    try {
                        const result = fn.apply(context, args);

                        // Handle promises
                        if (result && typeof result.then === 'function') {
                            return result.catch(error => {
                                this.handleModuleError(moduleId, error);
                                throw error;
                            });
                        }

                        return result;
                    } catch (error) {
                        this.handleModuleError(moduleId, error);
                        throw error;
                    }
                };
            },

            // Wrap async functions
            wrapAsync: (fn, context = null) => {
                return async (...args) => {
                    try {
                        return await fn.apply(context, args);
                    } catch (error) {
                        this.handleModuleError(moduleId, error);
                        throw error;
                    }
                };
            },

            // Reset error state
            reset: () => {
                boundary.errorCount = 0;
                boundary.lastError = null;
                boundary.isRecovering = false;
                this.clearModuleError(moduleId);
            }
        };

        // Store boundary reference
        this.errorHandlers.set(moduleId, boundary);

        return boundary;
    }

    /**
     * Handle module error
     * @param {string} moduleId - Module that errored
     * @param {Error} error - Error object
     */
    async handleModuleError(moduleId, error) {
        console.error(`❌ Error in module ${moduleId}:`, error);

        // Log error
        this.logError({
            moduleId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            url: window.location.href
        });

        // Update boundary state
        const boundary = this.errorHandlers.get(moduleId);
        if (boundary) {
            boundary.errorCount++;
            boundary.lastError = error;
        }

        // Emit error event
        if (this.eventBus) {
            await this.eventBus.emit('module:error', {
                moduleId,
                error: error.message,
                stack: error.stack,
                errorCount: boundary ? boundary.errorCount : 1
            });
        }

        // Show error UI
        this.showErrorUI(moduleId, error);

        // Attempt recovery
        if (this.config.autoRecover) {
            await this.attemptRecovery(moduleId, error);
        }

        // Report error
        if (this.config.enableErrorReporting) {
            this.reportError(moduleId, error);
        }
    }

    /**
     * Attempt to recover from error
     * @param {string} moduleId - Module to recover
     * @param {Error} error - Original error
     */
    async attemptRecovery(moduleId, error) {
        const boundary = this.errorHandlers.get(moduleId);
        if (!boundary || boundary.isRecovering) {
            return;
        }

        boundary.isRecovering = true;

        // Get recovery state
        let recoveryInfo = this.recoveryState.get(moduleId) || {
            attempts: 0,
            lastAttempt: 0
        };

        // Check if we should attempt recovery
        if (recoveryInfo.attempts >= this.config.recoveryAttempts) {
            console.error(`⛔ Module ${moduleId} exceeded recovery attempts`);
            this.handleFatalError(moduleId, error);
            return;
        }

        // Check cooldown period
        const timeSinceLastAttempt = Date.now() - recoveryInfo.lastAttempt;
        if (timeSinceLastAttempt < this.config.recoveryDelay) {
            boundary.isRecovering = false;
            return;
        }

        console.log(`🔄 Attempting recovery for module ${moduleId} (attempt ${recoveryInfo.attempts + 1})`);

        // Update recovery state
        recoveryInfo.attempts++;
        recoveryInfo.lastAttempt = Date.now();
        this.recoveryState.set(moduleId, recoveryInfo);

        try {
            // Get recovery strategy
            const strategy = this.getRecoveryStrategy(moduleId, error);

            // Execute recovery
            await strategy(moduleId, error);

            // Success - reset error state
            boundary.reset();
            this.recoveryState.delete(moduleId);

            console.log(`✅ Module ${moduleId} recovered successfully`);

            // Emit recovery event
            if (this.eventBus) {
                await this.eventBus.emit('module:recovered', { moduleId });
            }

        } catch (recoveryError) {
            console.error(`❌ Recovery failed for module ${moduleId}:`, recoveryError);

            // Try again later
            setTimeout(() => {
                boundary.isRecovering = false;
                this.attemptRecovery(moduleId, error);
            }, this.config.recoveryDelay * Math.pow(2, recoveryInfo.attempts));

        } finally {
            boundary.isRecovering = false;
        }
    }

    /**
     * Get recovery strategy for module
     * @param {string} moduleId - Module ID
     * @param {Error} error - Error to recover from
     * @returns {Function} Recovery strategy
     */
    getRecoveryStrategy(moduleId, error) {
        // Check for custom strategy
        if (this.errorRecoveryStrategies.has(moduleId)) {
            return this.errorRecoveryStrategies.get(moduleId);
        }

        // Default strategies based on error type
        if (error.name === 'NetworkError' || error.message.includes('fetch')) {
            return this.networkRecoveryStrategy;
        }

        if (error.name === 'TypeError' || error.name === 'ReferenceError') {
            return this.moduleReloadStrategy;
        }

        if (error.message.includes('memory') || error.message.includes('storage')) {
            return this.resourceRecoveryStrategy;
        }

        // Default strategy
        return this.defaultRecoveryStrategy;
    }

    /**
     * Network recovery strategy
     */
    networkRecoveryStrategy = async (moduleId, error) => {
        console.log('🔧 Attempting network recovery...');

        // Wait for network
        await this.waitForNetwork();

        // Reload module data
        if (this.eventBus) {
            await this.eventBus.emit('data:refresh', { moduleId });
        }

        // Reload module
        if (this.eventBus) {
            await this.eventBus.emit('module:reload', { moduleId });
        }
    };

    /**
     * Module reload strategy
     */
    moduleReloadStrategy = async (moduleId, error) => {
        console.log('🔧 Attempting module reload...');

        // Clear module state
        if (this.eventBus) {
            await this.eventBus.emit('state:module:reset', { moduleId });
        }

        // Reload module
        if (this.eventBus) {
            await this.eventBus.emit('module:reload', { moduleId });
        }
    };

    /**
     * Resource recovery strategy
     */
    resourceRecoveryStrategy = async (moduleId, error) => {
        console.log('🔧 Attempting resource recovery...');

        // Clear caches
        if (this.eventBus) {
            await this.eventBus.emit('data:cache:invalidated', { moduleId });
        }

        // Clear old data
        this.clearOldData();

        // Reload module
        if (this.eventBus) {
            await this.eventBus.emit('module:reload', { moduleId });
        }
    };

    /**
     * Default recovery strategy
     */
    defaultRecoveryStrategy = async (moduleId, error) => {
        console.log('🔧 Attempting default recovery...');

        // Simple module reload
        if (this.eventBus) {
            await this.eventBus.emit('module:reload', { moduleId });
        }
    };

    /**
     * Register custom recovery strategy
     * @param {string} moduleId - Module ID
     * @param {Function} strategy - Recovery strategy function
     */
    registerRecoveryStrategy(moduleId, strategy) {
        this.errorRecoveryStrategies.set(moduleId, strategy);
    }

    /**
     * Handle fatal error (unrecoverable)
     * @param {string} moduleId - Module that failed
     * @param {Error} error - Fatal error
     */
    handleFatalError(moduleId, error) {
        console.error(`💀 Fatal error in module ${moduleId}:`, error);

        // Show fatal error UI
        this.showFatalErrorUI(moduleId, error);

        // Disable module
        if (this.eventBus) {
            this.eventBus.emit('module:disable', { moduleId });
        }

        // Report fatal error
        if (this.config.enableErrorReporting) {
            this.reportError(moduleId, error, true);
        }
    }

    /**
     * Show error UI
     * @param {string} moduleId - Module with error
     * @param {Error} error - Error object
     */
    showErrorUI(moduleId, error) {
        const boundary = this.errorHandlers.get(moduleId);
        if (!boundary || !boundary.container) {
            return;
        }

        const errorUI = document.createElement('div');
        errorUI.className = 'module-error-boundary';
        errorUI.innerHTML = `
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <h3>Something went wrong</h3>
                <p class="error-message">${this.sanitizeError(error.message)}</p>
                <div class="error-actions">
                    <button class="btn-retry" data-module="${moduleId}">
                        🔄 Retry
                    </button>
                    <button class="btn-dismiss" data-module="${moduleId}">
                        ❌ Dismiss
                    </button>
                </div>
                ${this.config.autoRecover ? '<p class="recovery-status">Attempting automatic recovery...</p>' : ''}
            </div>
        `;

        // Add event listeners
        errorUI.querySelector('.btn-retry')?.addEventListener('click', () => {
            this.retryModule(moduleId);
        });

        errorUI.querySelector('.btn-dismiss')?.addEventListener('click', () => {
            this.dismissError(moduleId);
        });

        // Replace module content
        boundary.container.innerHTML = '';
        boundary.container.appendChild(errorUI);
    }

    /**
     * Show fatal error UI
     * @param {string} moduleId - Module with fatal error
     * @param {Error} error - Fatal error
     */
    showFatalErrorUI(moduleId, error) {
        const boundary = this.errorHandlers.get(moduleId);
        if (!boundary || !boundary.container) {
            return;
        }

        const fatalUI = document.createElement('div');
        fatalUI.className = 'module-fatal-error';
        fatalUI.innerHTML = `
            <div class="fatal-container">
                <div class="fatal-icon">💀</div>
                <h3>Module Failed</h3>
                <p>This module has encountered a fatal error and cannot recover.</p>
                <details class="error-details">
                    <summary>Error Details</summary>
                    <pre>${this.sanitizeError(error.stack || error.message)}</pre>
                </details>
                <button class="btn-report" data-module="${moduleId}">
                    📧 Report Issue
                </button>
            </div>
        `;

        // Add event listeners
        fatalUI.querySelector('.btn-report')?.addEventListener('click', () => {
            this.reportError(moduleId, error, true);
        });

        boundary.container.innerHTML = '';
        boundary.container.appendChild(fatalUI);
    }

    /**
     * Retry module after error
     * @param {string} moduleId - Module to retry
     */
    async retryModule(moduleId) {
        const boundary = this.errorHandlers.get(moduleId);
        if (!boundary) return;

        // Reset error state
        boundary.reset();
        this.recoveryState.delete(moduleId);

        // Reload module
        if (this.eventBus) {
            await this.eventBus.emit('module:reload', { moduleId });
        }
    }

    /**
     * Dismiss error UI
     * @param {string} moduleId - Module ID
     */
    dismissError(moduleId) {
        const boundary = this.errorHandlers.get(moduleId);
        if (!boundary) return;

        // Clear error UI
        boundary.container.innerHTML = '';

        // Reset error state
        boundary.reset();
    }

    /**
     * Clear module error state
     * @param {string} moduleId - Module ID
     */
    clearModuleError(moduleId) {
        this.recoveryState.delete(moduleId);
    }

    /**
     * Log error
     * @param {Object} errorInfo - Error information
     */
    logError(errorInfo) {
        this.errorLog.push(errorInfo);

        // Maintain max log size
        if (this.errorLog.length > this.config.maxErrorLogSize) {
            this.errorLog.shift();
        }

        // Persist to storage
        try {
            const stored = localStorage.getItem('error-log') || '[]';
            const log = JSON.parse(stored);
            log.push(errorInfo);

            // Keep only recent errors
            const recentLog = log.slice(-this.config.maxErrorLogSize);
            localStorage.setItem('error-log', JSON.stringify(recentLog));
        } catch (e) {
            console.error('Failed to persist error log:', e);
        }
    }

    /**
     * Report error to backend
     * @param {string} moduleId - Module ID
     * @param {Error} error - Error object
     * @param {boolean} isFatal - Whether error is fatal
     */
    async reportError(moduleId, error, isFatal = false) {
        if (!this.config.errorReportEndpoint) {
            console.log('📧 Error reporting endpoint not configured');
            return;
        }

        const report = {
            moduleId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            isFatal,
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            context: {
                errorCount: this.errorHandlers.get(moduleId)?.errorCount || 1,
                recoveryAttempts: this.recoveryState.get(moduleId)?.attempts || 0
            }
        };

        try {
            await fetch(this.config.errorReportEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(report)
            });

            console.log('📧 Error reported successfully');

        } catch (e) {
            console.error('Failed to report error:', e);
        }
    }

    /**
     * Setup global error handlers
     * @private
     */
    setupGlobalErrorHandlers() {
        // Catch unhandled errors
        window.addEventListener('error', (event) => {
            console.error('🔥 Unhandled error:', event.error);
            this.handleGlobalError(event.error, event);
        });

        // Catch unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            console.error('🔥 Unhandled promise rejection:', event.reason);
            this.handleGlobalError(event.reason, event);
        });
    }

    /**
     * Handle global error
     * @private
     */
    handleGlobalError(error, event) {
        // Log error
        this.logError({
            type: 'global',
            error: {
                message: error?.message || String(error),
                stack: error?.stack || '',
                name: error?.name || 'UnknownError'
            },
            timestamp: Date.now(),
            url: window.location.href
        });

        // Emit global error event
        if (this.eventBus) {
            this.eventBus.emit('system:error', {
                error: error?.message || String(error),
                stack: error?.stack
            });
        }

        // Prevent default error handling
        if (event && event.preventDefault) {
            event.preventDefault();
        }
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (!this.eventBus) return;

        // Listen for performance warnings
        this.eventBus.on('system:performance:warning', (data) => {
            console.warn('⚠️ Performance warning:', data);
        });

        // Listen for memory warnings
        this.eventBus.on('system:memory:warning', (data) => {
            console.warn('⚠️ Memory warning:', data);
            this.clearOldData();
        });
    }

    /**
     * Wait for network connection
     * @private
     */
    waitForNetwork() {
        return new Promise((resolve) => {
            if (navigator.onLine) {
                resolve();
                return;
            }

            const checkNetwork = setInterval(() => {
                if (navigator.onLine) {
                    clearInterval(checkNetwork);
                    resolve();
                }
            }, 1000);
        });
    }

    /**
     * Clear old cached data
     * @private
     */
    clearOldData() {
        try {
            // Clear old localStorage entries
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.includes('cache-')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));

        } catch (e) {
            console.error('Failed to clear old data:', e);
        }
    }

    /**
     * Sanitize error message for display
     * @private
     */
    sanitizeError(message) {
        return String(message)
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Default fallback UI
     * @private
     */
    defaultFallbackUI = () => {
        return `
            <div class="error-fallback">
                <h3>⚠️ Error</h3>
                <p>An unexpected error occurred.</p>
            </div>
        `;
    };

    /**
     * Get error statistics
     * @returns {Object} Error stats
     */
    getStats() {
        const stats = {
            totalErrors: this.errorLog.length,
            moduleErrors: {},
            fatalErrors: 0,
            recoveryAttempts: 0,
            successfulRecoveries: 0
        };

        // Count errors by module
        this.errorLog.forEach(entry => {
            if (entry.moduleId) {
                stats.moduleErrors[entry.moduleId] = (stats.moduleErrors[entry.moduleId] || 0) + 1;
            }
            if (entry.isFatal) {
                stats.fatalErrors++;
            }
        });

        // Count recovery attempts
        this.recoveryState.forEach(state => {
            stats.recoveryAttempts += state.attempts;
        });

        return stats;
    }

    /**
     * Get error log
     * @param {Object} filter - Filter options
     * @returns {Array} Filtered error log
     */
    getErrorLog(filter = {}) {
        let log = [...this.errorLog];

        if (filter.moduleId) {
            log = log.filter(e => e.moduleId === filter.moduleId);
        }

        if (filter.since) {
            const since = typeof filter.since === 'number' ? filter.since : Date.parse(filter.since);
            log = log.filter(e => e.timestamp >= since);
        }

        if (filter.type) {
            log = log.filter(e => e.type === filter.type);
        }

        return log;
    }

    /**
     * Clear error log
     */
    clearErrorLog() {
        this.errorLog = [];
        try {
            localStorage.removeItem('error-log');
        } catch (e) {
            console.error('Failed to clear persisted error log:', e);
        }
    }

    /**
     * Destroy error boundary
     */
    destroy() {
        // Remove global handlers
        window.removeEventListener('error', this.handleGlobalError);
        window.removeEventListener('unhandledrejection', this.handleGlobalError);

        // Clear data
        this.errorHandlers.clear();
        this.errorRecoveryStrategies.clear();
        this.recoveryState.clear();
        this.errorLog = [];

        console.log('✅ ErrorBoundary destroyed');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.ErrorBoundary = ErrorBoundary;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorBoundary;
}