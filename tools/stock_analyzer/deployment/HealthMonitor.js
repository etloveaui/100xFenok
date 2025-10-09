(function () {
    class HealthMonitor {
        constructor(options = {}) {
            this.checks = new Map();
            this.intervalHandles = new Map();
            this.defaultInterval = options.defaultInterval || 60 * 1000;
            this.listeners = new Set();
        }

        registerCheck(name, handler, interval) {
            if (typeof handler !== 'function') {
                throw new Error(`Health check "${name}" requires a handler function.`);
            }

            const entry = {
                name,
                handler,
                interval: interval || this.defaultInterval,
                lastResult: null
            };

            this.checks.set(name, entry);
            this._schedule(entry);
            return entry;
        }

        unregisterCheck(name) {
            this.checks.delete(name);
            const handle = this.intervalHandles.get(name);
            if (handle) {
                clearInterval(handle);
                this.intervalHandles.delete(name);
            }
        }

        start() {
            this.checks.forEach(entry => this._schedule(entry));
        }

        stop() {
            this.intervalHandles.forEach(handle => clearInterval(handle));
            this.intervalHandles.clear();
        }

        async evaluateNow(name) {
            const entry = this.checks.get(name);
            if (!entry) {
                throw new Error(`Health check "${name}" not found.`);
            }
            return this._execute(entry);
        }

        on(eventName, listener) {
            this.listeners.add({ eventName, listener });
        }

        off(listener) {
            this.listeners.forEach(entry => {
                if (entry.listener === listener) {
                    this.listeners.delete(entry);
                }
            });
        }

        _schedule(entry) {
            if (this.intervalHandles.has(entry.name)) {
                clearInterval(this.intervalHandles.get(entry.name));
            }

            const handle = setInterval(() => {
                this._execute(entry).catch(error => {
                    console.warn(`Health check ${entry.name} failed:`, error);
                });
            }, entry.interval);

            this.intervalHandles.set(entry.name, handle);
        }

        async _execute(entry) {
            const start = performance.now();
            try {
                const result = await entry.handler();
                const duration = performance.now() - start;
                entry.lastResult = {
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    duration,
                    data: result
                };
                this._notify('healthy', { name: entry.name, result: entry.lastResult });
                return entry.lastResult;
            } catch (error) {
                const duration = performance.now() - start;
                entry.lastResult = {
                    status: 'unhealthy',
                    timestamp: new Date().toISOString(),
                    duration,
                    error: error.message
                };
                this._notify('unhealthy', { name: entry.name, result: entry.lastResult });
                throw error;
            }
        }

        _notify(eventName, payload) {
            this.listeners.forEach(entry => {
                if (entry.eventName === eventName) {
                    try {
                        entry.listener(payload);
                    } catch (error) {
                        console.warn('HealthMonitor listener error:', error);
                    }
                }
            });
        }
    }

    window.HealthMonitor = HealthMonitor;
    console.log('✅ HealthMonitor 로드 완료');
})();
