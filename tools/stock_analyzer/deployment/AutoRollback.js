(function () {
    class AutoRollback {
        constructor(options = {}) {
            this.rollbackPoints = [];
            this.maxHistory = options.maxHistory || 10;
            this.listeners = new Set();
            this.onRollback = options.onRollback || null;
        }

        register(point) {
            const entry = {
                id: point.id || `rollback-${Date.now()}`,
                timestamp: new Date().toISOString(),
                description: point.description || 'Unnamed rollback point',
                snapshot: point.snapshot || null,
                meta: point.meta || {}
            };

            this.rollbackPoints.push(entry);
            if (this.rollbackPoints.length > this.maxHistory) {
                this.rollbackPoints.shift();
            }

            this._notify('registered', entry);
            return entry;
        }

        getLast() {
            return this.rollbackPoints[this.rollbackPoints.length - 1] || null;
        }

        async trigger(reason = 'Unknown') {
            const target = this.getLast();
            if (!target) {
                console.warn('AutoRollback: no rollback point available.');
                return { success: false, message: 'No rollback point available' };
            }

            this._notify('trigger', { target, reason });

            try {
                if (typeof this.onRollback === 'function') {
                    await this.onRollback(target, reason);
                }
                this._notify('complete', { target, reason });
                return { success: true, target, reason };
            } catch (error) {
                this._notify('error', { error, target, reason });
                return { success: false, error, target };
            }
        }

        clear() {
            this.rollbackPoints = [];
            this._notify('cleared');
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

        _notify(eventName, payload) {
            this.listeners.forEach(entry => {
                if (entry.eventName === eventName) {
                    try {
                        entry.listener(payload);
                    } catch (error) {
                        console.warn('AutoRollback listener error:', error);
                    }
                }
            });
        }
    }

    window.AutoRollback = AutoRollback;
    console.log('✅ AutoRollback 로드 완료');
})();
