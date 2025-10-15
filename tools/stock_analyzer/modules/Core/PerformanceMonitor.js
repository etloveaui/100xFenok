/**
 * PerformanceMonitor - Performance metrics tracking and optimization
 * Monitors module performance, memory usage, and provides optimization insights
 *
 * @module Core/PerformanceMonitor
 * @version 1.0.0
 */

class PerformanceMonitor {
    constructor(config = {}) {
        this.metrics = new Map();
        this.timers = new Map();
        this.observers = new Map();
        this.thresholds = new Map();
        this.eventBus = null;

        this.config = {
            enableMonitoring: config.enableMonitoring !== false,
            sampleRate: config.sampleRate || 1, // 1 = 100% sampling
            metricsBufferSize: config.metricsBufferSize || 1000,
            reportingInterval: config.reportingInterval || 60000, // 1 minute
            enablePerformanceObserver: config.enablePerformanceObserver !== false,
            enableMemoryMonitoring: config.enableMemoryMonitoring !== false,
            enableNetworkMonitoring: config.enableNetworkMonitoring !== false
        };

        // Performance thresholds
        this.defaultThresholds = {
            moduleLoadTime: 1000, // 1 second
            dataFetchTime: 3000, // 3 seconds
            renderTime: 100, // 100ms
            memoryUsage: 50 * 1024 * 1024, // 50MB
            heapUsage: 100 * 1024 * 1024, // 100MB
            fps: 30 // 30 FPS minimum
        };

        // Initialize monitoring
        if (this.config.enableMonitoring) {
            this.initializeMonitoring();
        }

        console.log('✅ PerformanceMonitor initialized');
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
     * Initialize monitoring systems
     * @private
     */
    initializeMonitoring() {
        // Performance Observer
        if (this.config.enablePerformanceObserver && 'PerformanceObserver' in window) {
            this.setupPerformanceObserver();
        }

        // Memory monitoring
        if (this.config.enableMemoryMonitoring) {
            this.startMemoryMonitoring();
        }

        // Network monitoring
        if (this.config.enableNetworkMonitoring) {
            this.setupNetworkMonitoring();
        }

        // FPS monitoring
        this.startFPSMonitoring();

        // Periodic reporting
        this.startPeriodicReporting();
    }

    /**
     * Start timing a performance metric
     * @param {string} metricName - Name of the metric
     * @param {Object} metadata - Additional metadata
     * @returns {Function} Stop function
     */
    startTimer(metricName, metadata = {}) {
        if (!this.shouldSample()) {
            return () => {};
        }

        const startTime = performance.now();
        const timerId = `${metricName}_${Date.now()}_${Math.random()}`;

        this.timers.set(timerId, {
            name: metricName,
            startTime,
            metadata
        });

        // Return stop function
        return () => this.stopTimer(timerId);
    }

    /**
     * Stop timing a metric
     * @private
     */
    stopTimer(timerId) {
        const timer = this.timers.get(timerId);

        if (!timer) {
            return;
        }

        const endTime = performance.now();
        const duration = endTime - timer.startTime;

        // Record metric
        this.recordMetric(timer.name, {
            duration,
            ...timer.metadata,
            timestamp: Date.now()
        });

        // Check threshold
        this.checkThreshold(timer.name, duration);

        // Clean up
        this.timers.delete(timerId);

        return duration;
    }

    /**
     * Record a performance metric
     * @param {string} metricName - Name of the metric
     * @param {Object} value - Metric value
     */
    recordMetric(metricName, value) {
        if (!this.metrics.has(metricName)) {
            this.metrics.set(metricName, []);
        }

        const metricBuffer = this.metrics.get(metricName);
        metricBuffer.push(value);

        // Maintain buffer size
        if (metricBuffer.length > this.config.metricsBufferSize) {
            metricBuffer.shift();
        }

        // Log if significant
        if (this.isSignificantMetric(metricName, value)) {
            console.log(`📊 Performance: ${metricName}`, value);
        }
    }

    /**
     * Mark a performance event
     * @param {string} eventName - Event name
     * @param {Object} details - Event details
     */
    mark(eventName, details = {}) {
        if (!this.shouldSample()) {
            return;
        }

        // Use Performance API if available
        if ('performance' in window && 'mark' in performance) {
            performance.mark(eventName);
        }

        // Record custom metric
        this.recordMetric(`mark:${eventName}`, {
            timestamp: performance.now(),
            ...details
        });
    }

    /**
     * Measure between two marks
     * @param {string} name - Measurement name
     * @param {string} startMark - Start mark name
     * @param {string} endMark - End mark name
     */
    measure(name, startMark, endMark = null) {
        if (!this.shouldSample()) {
            return;
        }

        try {
            if ('performance' in window && 'measure' in performance) {
                if (endMark) {
                    performance.measure(name, startMark, endMark);
                } else {
                    performance.measure(name, startMark);
                }

                // Get the measurement
                const entries = performance.getEntriesByName(name, 'measure');
                const lastEntry = entries[entries.length - 1];

                if (lastEntry) {
                    this.recordMetric(`measure:${name}`, {
                        duration: lastEntry.duration,
                        startTime: lastEntry.startTime,
                        timestamp: Date.now()
                    });

                    return lastEntry.duration;
                }
            }
        } catch (error) {
            console.error('Failed to measure performance:', error);
        }
    }

    /**
     * Track module performance
     * @param {string} moduleId - Module identifier
     * @returns {Object} Module performance tracker
     */
    trackModule(moduleId) {
        return {
            // Track module load
            trackLoad: () => {
                const stop = this.startTimer(`module:${moduleId}:load`, { moduleId });
                return {
                    complete: () => {
                        const duration = stop();
                        if (this.eventBus && duration > this.getThreshold('moduleLoadTime')) {
                            this.eventBus.emit('system:performance:warning', {
                                type: 'slow-module-load',
                                moduleId,
                                duration
                            });
                        }
                    }
                };
            },

            // Track module render
            trackRender: () => {
                return this.startTimer(`module:${moduleId}:render`, { moduleId });
            },

            // Track data fetch
            trackDataFetch: (dataType) => {
                return this.startTimer(`module:${moduleId}:data`, { moduleId, dataType });
            },

            // Track custom operation
            track: (operation) => {
                return this.startTimer(`module:${moduleId}:${operation}`, { moduleId });
            }
        };
    }

    /**
     * Setup Performance Observer
     * @private
     */
    setupPerformanceObserver() {
        try {
            // Observe navigation timing
            const navObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.recordMetric('navigation', {
                        type: entry.type,
                        duration: entry.duration,
                        transferSize: entry.transferSize,
                        timestamp: Date.now()
                    });
                }
            });
            navObserver.observe({ entryTypes: ['navigation'] });
            this.observers.set('navigation', navObserver);

            // Observe resource timing
            const resourceObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.recordMetric('resource', {
                        name: entry.name,
                        duration: entry.duration,
                        transferSize: entry.transferSize,
                        initiatorType: entry.initiatorType,
                        timestamp: Date.now()
                    });
                }
            });
            resourceObserver.observe({ entryTypes: ['resource'] });
            this.observers.set('resource', resourceObserver);

            // Observe long tasks
            if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
                const taskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.recordMetric('longtask', {
                            duration: entry.duration,
                            startTime: entry.startTime,
                            timestamp: Date.now()
                        });

                        // Warn about long tasks
                        if (this.eventBus && entry.duration > 50) {
                            this.eventBus.emit('system:performance:warning', {
                                type: 'long-task',
                                duration: entry.duration
                            });
                        }
                    }
                });
                taskObserver.observe({ entryTypes: ['longtask'] });
                this.observers.set('longtask', taskObserver);
            }

        } catch (error) {
            console.error('Failed to setup PerformanceObserver:', error);
        }
    }

    /**
     * Setup network monitoring
     * @private
     */
    setupNetworkMonitoring() {
        // Monitor fetch requests
        const originalFetch = window.fetch;
        window.fetch = (...args) => {
            const startTime = performance.now();
            const url = args[0];

            return originalFetch.apply(window, args)
                .then(response => {
                    const duration = performance.now() - startTime;

                    this.recordMetric('network:fetch', {
                        url: typeof url === 'string' ? url : url.url,
                        duration,
                        status: response.status,
                        ok: response.ok,
                        timestamp: Date.now()
                    });

                    // Check for slow requests
                    if (duration > this.getThreshold('dataFetchTime')) {
                        if (this.eventBus) {
                            this.eventBus.emit('system:performance:warning', {
                                type: 'slow-network',
                                url,
                                duration
                            });
                        }
                    }

                    return response;
                })
                .catch(error => {
                    const duration = performance.now() - startTime;

                    this.recordMetric('network:error', {
                        url: typeof url === 'string' ? url : url.url,
                        duration,
                        error: error.message,
                        timestamp: Date.now()
                    });

                    throw error;
                });
        };
    }

    /**
     * Start memory monitoring
     * @private
     */
    startMemoryMonitoring() {
        if (!performance.memory) {
            console.warn('Performance.memory API not available');
            return;
        }

        const checkMemory = () => {
            const memoryInfo = {
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                timestamp: Date.now()
            };

            this.recordMetric('memory', memoryInfo);

            // Check for memory warnings
            if (memoryInfo.usedJSHeapSize > this.getThreshold('heapUsage')) {
                if (this.eventBus) {
                    this.eventBus.emit('system:memory:warning', {
                        used: memoryInfo.usedJSHeapSize,
                        total: memoryInfo.totalJSHeapSize,
                        limit: memoryInfo.jsHeapSizeLimit
                    });
                }
            }
        };

        // Check memory periodically
        setInterval(checkMemory, 10000); // Every 10 seconds
    }

    /**
     * Start FPS monitoring
     * @private
     */
    startFPSMonitoring() {
        let lastTime = performance.now();
        let frames = 0;
        let fps = 0;

        const measureFPS = () => {
            frames++;
            const currentTime = performance.now();

            if (currentTime >= lastTime + 1000) {
                fps = Math.round((frames * 1000) / (currentTime - lastTime));
                frames = 0;
                lastTime = currentTime;

                this.recordMetric('fps', {
                    value: fps,
                    timestamp: Date.now()
                });

                // Check for low FPS
                if (fps < this.getThreshold('fps')) {
                    if (this.eventBus) {
                        this.eventBus.emit('system:performance:warning', {
                            type: 'low-fps',
                            fps
                        });
                    }
                }
            }

            requestAnimationFrame(measureFPS);
        };

        requestAnimationFrame(measureFPS);
    }

    /**
     * Start periodic reporting
     * @private
     */
    startPeriodicReporting() {
        setInterval(() => {
            this.generateReport();
        }, this.config.reportingInterval);
    }

    /**
     * Generate performance report
     * @returns {Object} Performance report
     */
    generateReport() {
        const report = {
            timestamp: Date.now(),
            summary: {},
            metrics: {},
            warnings: []
        };

        // Calculate summary statistics for each metric
        for (const [metricName, values] of this.metrics.entries()) {
            if (values.length === 0) continue;

            const stats = this.calculateStats(values);
            report.metrics[metricName] = stats;

            // Add to summary if significant
            if (this.isSignificantMetric(metricName, stats)) {
                report.summary[metricName] = {
                    avg: stats.avg,
                    p95: stats.p95
                };
            }

            // Check for warnings
            const threshold = this.getThreshold(metricName);
            if (threshold && stats.avg > threshold) {
                report.warnings.push({
                    metric: metricName,
                    avg: stats.avg,
                    threshold,
                    severity: stats.avg > threshold * 2 ? 'high' : 'medium'
                });
            }
        }

        // Emit report
        if (this.eventBus) {
            this.eventBus.emit('performance:report', report);
        }

        console.log('📊 Performance Report:', report.summary);

        if (report.warnings.length > 0) {
            console.warn('⚠️ Performance Warnings:', report.warnings);
        }

        return report;
    }

    /**
     * Calculate statistics for metric values
     * @private
     */
    calculateStats(values) {
        const numericValues = values
            .map(v => typeof v === 'object' ? v.duration || v.value : v)
            .filter(v => typeof v === 'number');

        if (numericValues.length === 0) {
            return { count: 0 };
        }

        numericValues.sort((a, b) => a - b);

        const sum = numericValues.reduce((a, b) => a + b, 0);
        const avg = sum / numericValues.length;

        return {
            count: numericValues.length,
            min: numericValues[0],
            max: numericValues[numericValues.length - 1],
            avg: Math.round(avg),
            median: numericValues[Math.floor(numericValues.length / 2)],
            p95: numericValues[Math.floor(numericValues.length * 0.95)],
            p99: numericValues[Math.floor(numericValues.length * 0.99)]
        };
    }

    /**
     * Set performance threshold
     * @param {string} metricName - Metric name
     * @param {number} threshold - Threshold value
     */
    setThreshold(metricName, threshold) {
        this.thresholds.set(metricName, threshold);
    }

    /**
     * Get threshold for metric
     * @private
     */
    getThreshold(metricName) {
        return this.thresholds.get(metricName) || this.defaultThresholds[metricName];
    }

    /**
     * Check if threshold exceeded
     * @private
     */
    checkThreshold(metricName, value) {
        const threshold = this.getThreshold(metricName);

        if (threshold && value > threshold) {
            console.warn(`⚠️ Performance threshold exceeded for ${metricName}: ${value}ms > ${threshold}ms`);

            if (this.eventBus) {
                this.eventBus.emit('performance:threshold:exceeded', {
                    metric: metricName,
                    value,
                    threshold
                });
            }
        }
    }

    /**
     * Check if metric is significant
     * @private
     */
    isSignificantMetric(metricName, value) {
        // Define significant metrics
        const significantMetrics = [
            'module:load',
            'navigation',
            'longtask',
            'memory'
        ];

        return significantMetrics.some(metric => metricName.includes(metric));
    }

    /**
     * Should sample this metric
     * @private
     */
    shouldSample() {
        return Math.random() < this.config.sampleRate;
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (!this.eventBus) return;

        // Track module lifecycle events
        this.eventBus.on('module:loaded', (data) => {
            this.mark(`module:${data.moduleId}:loaded`);
        });

        this.eventBus.on('module:activated', (data) => {
            this.mark(`module:${data.moduleId}:activated`);
        });

        this.eventBus.on('data:loaded', (data) => {
            this.recordMetric('data:loaded', {
                dataType: data.dataType,
                recordCount: data.recordCount,
                timestamp: Date.now()
            });
        });
    }

    /**
     * Get current performance metrics
     * @returns {Object} Current metrics
     */
    getCurrentMetrics() {
        const current = {};

        // Get latest value for each metric
        for (const [metricName, values] of this.metrics.entries()) {
            if (values.length > 0) {
                const latest = values[values.length - 1];
                current[metricName] = latest;
            }
        }

        // Add current memory if available
        if (performance.memory) {
            current.memory = {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit
            };
        }

        return current;
    }

    /**
     * Clear metrics
     * @param {string} metricName - Optional specific metric to clear
     */
    clearMetrics(metricName = null) {
        if (metricName) {
            this.metrics.delete(metricName);
        } else {
            this.metrics.clear();
        }
    }

    /**
     * Export metrics for analysis
     * @returns {Object} All metrics data
     */
    exportMetrics() {
        const exported = {
            timestamp: Date.now(),
            config: this.config,
            thresholds: Object.fromEntries(this.thresholds),
            metrics: {}
        };

        for (const [metricName, values] of this.metrics.entries()) {
            exported.metrics[metricName] = {
                values,
                stats: this.calculateStats(values)
            };
        }

        return exported;
    }

    /**
     * Enable/disable monitoring
     * @param {boolean} enable - Enable or disable
     */
    setMonitoring(enable) {
        this.config.enableMonitoring = enable;

        if (!enable) {
            // Stop observers
            for (const observer of this.observers.values()) {
                observer.disconnect();
            }
            this.observers.clear();
        } else {
            this.initializeMonitoring();
        }
    }

    /**
     * Destroy the performance monitor
     */
    destroy() {
        // Disconnect observers
        for (const observer of this.observers.values()) {
            observer.disconnect();
        }

        // Clear data
        this.metrics.clear();
        this.timers.clear();
        this.observers.clear();
        this.thresholds.clear();

        console.log('✅ PerformanceMonitor destroyed');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.PerformanceMonitor = PerformanceMonitor;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceMonitor;
}