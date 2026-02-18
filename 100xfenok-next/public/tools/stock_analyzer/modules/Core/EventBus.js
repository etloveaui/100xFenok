/**
 * EventBus - Central event management system
 * Implements pub/sub pattern for module communication
 *
 * @module Core/EventBus
 * @version 1.0.0
 */

class EventBus {
    constructor(config = {}) {
        this.events = new Map();
        this.history = [];
        this.config = {
            maxHistorySize: config.maxHistorySize || 100,
            enableLogging: config.enableLogging !== false,
            logLevel: config.logLevel || 'info',
            strictMode: config.strictMode || false
        };

        // Standard event types for validation
        this.standardEvents = new Set([
            // Module lifecycle events
            'module:registered',
            'module:loaded',
            'module:activated',
            'module:deactivated',
            'module:error',
            'module:reload',

            // Data events
            'data:loaded',
            'data:updated',
            'data:error',
            'data:cache:invalidated',

            // Navigation events
            'navigation:before',
            'navigation:after',
            'navigation:error',
            'navigation:module',

            // User action events
            'user:security:selected',
            'user:filter:applied',
            'user:sort:applied',
            'user:watchlist:updated',
            'user:comparison:added',
            'user:portfolio:updated',

            // System events
            'system:ready',
            'system:error',
            'system:performance:warning',
            'system:memory:warning'
        ]);

        // Event metadata tracking
        this.eventMetadata = new Map();

        console.log('✅ EventBus initialized');
    }

    /**
     * Subscribe to an event
     * @param {string} eventType - Event type to subscribe to
     * @param {Function} handler - Event handler function
     * @param {Object} options - Subscription options
     * @returns {Function} Unsubscribe function
     */
    on(eventType, handler, options = {}) {
        if (typeof handler !== 'function') {
            throw new TypeError('Handler must be a function');
        }

        // Validate event type in strict mode
        if (this.config.strictMode && !this.standardEvents.has(eventType)) {
            console.warn(`⚠️ Non-standard event type: ${eventType}`);
        }

        if (!this.events.has(eventType)) {
            this.events.set(eventType, new Set());
        }

        const subscription = {
            handler,
            once: options.once || false,
            priority: options.priority || 0,
            context: options.context || null,
            id: this.generateSubscriptionId()
        };

        // Add to sorted set by priority
        const subscribers = Array.from(this.events.get(eventType));
        subscribers.push(subscription);
        subscribers.sort((a, b) => b.priority - a.priority);
        this.events.set(eventType, new Set(subscribers));

        if (this.config.enableLogging && this.config.logLevel === 'debug') {
            console.log(`📡 Subscribed to ${eventType} (ID: ${subscription.id})`);
        }

        // Return unsubscribe function
        return () => this.off(eventType, subscription.id);
    }

    /**
     * Subscribe to an event once
     * @param {string} eventType - Event type
     * @param {Function} handler - Handler function
     * @returns {Function} Unsubscribe function
     */
    once(eventType, handler) {
        return this.on(eventType, handler, { once: true });
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventType - Event type
     * @param {string} subscriptionId - Subscription ID
     */
    off(eventType, subscriptionId) {
        const subscribers = this.events.get(eventType);

        if (!subscribers) {
            return;
        }

        const filtered = Array.from(subscribers).filter(
            sub => sub.id !== subscriptionId
        );

        if (filtered.length === 0) {
            this.events.delete(eventType);
        } else {
            this.events.set(eventType, new Set(filtered));
        }

        if (this.config.enableLogging && this.config.logLevel === 'debug') {
            console.log(`📡 Unsubscribed from ${eventType} (ID: ${subscriptionId})`);
        }
    }

    /**
     * Emit an event
     * @param {string} eventType - Event type
     * @param {*} data - Event data
     * @returns {Promise<Array>} Results from all handlers
     */
    async emit(eventType, data = {}) {
        const timestamp = Date.now();
        const eventId = this.generateEventId();

        // Log to history
        this.addToHistory({
            id: eventId,
            type: eventType,
            data,
            timestamp
        });

        if (this.config.enableLogging) {
            console.log(`📤 Emitting ${eventType}`, data);
        }

        const subscribers = this.events.get(eventType);

        if (!subscribers || subscribers.size === 0) {
            if (this.config.enableLogging && this.config.logLevel === 'debug') {
                console.log(`ℹ️ No subscribers for ${eventType}`);
            }
            return [];
        }

        const results = [];
        const toRemove = [];

        for (const subscription of subscribers) {
            try {
                // Call handler with context if provided
                const result = subscription.context
                    ? await subscription.handler.call(subscription.context, data)
                    : await subscription.handler(data);

                results.push(result);

                // Mark for removal if once
                if (subscription.once) {
                    toRemove.push(subscription.id);
                }

            } catch (error) {
                console.error(`❌ Error in handler for ${eventType}:`, error);

                // Emit error event (avoid infinite loop)
                if (eventType !== 'system:error') {
                    this.emit('system:error', {
                        originalEvent: eventType,
                        error: error.message,
                        stack: error.stack
                    });
                }
            }
        }

        // Remove one-time subscriptions
        toRemove.forEach(id => this.off(eventType, id));

        return results;
    }

    /**
     * Emit an event synchronously (blocking)
     * @param {string} eventType - Event type
     * @param {*} data - Event data
     * @returns {Array} Results from all handlers
     */
    emitSync(eventType, data = {}) {
        const timestamp = Date.now();
        const eventId = this.generateEventId();

        // Log to history
        this.addToHistory({
            id: eventId,
            type: eventType,
            data,
            timestamp
        });

        if (this.config.enableLogging) {
            console.log(`📤 Emitting (sync) ${eventType}`, data);
        }

        const subscribers = this.events.get(eventType);

        if (!subscribers || subscribers.size === 0) {
            return [];
        }

        const results = [];
        const toRemove = [];

        for (const subscription of subscribers) {
            try {
                const result = subscription.context
                    ? subscription.handler.call(subscription.context, data)
                    : subscription.handler(data);

                results.push(result);

                if (subscription.once) {
                    toRemove.push(subscription.id);
                }

            } catch (error) {
                console.error(`❌ Error in handler for ${eventType}:`, error);
            }
        }

        toRemove.forEach(id => this.off(eventType, id));

        return results;
    }

    /**
     * Wait for an event to occur
     * @param {string} eventType - Event type to wait for
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise} Resolves with event data
     */
    waitFor(eventType, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off(eventType, subscriptionId);
                reject(new Error(`Timeout waiting for ${eventType}`));
            }, timeout);

            const unsubscribe = this.once(eventType, (data) => {
                clearTimeout(timer);
                resolve(data);
            });

            const subscriptionId = unsubscribe.toString();
        });
    }

    /**
     * Clear all subscriptions for an event type
     * @param {string} eventType - Event type
     */
    clear(eventType) {
        if (eventType) {
            this.events.delete(eventType);
        } else {
            this.events.clear();
        }

        if (this.config.enableLogging) {
            console.log(`🧹 Cleared ${eventType || 'all'} subscriptions`);
        }
    }

    /**
     * Get all subscribers for an event
     * @param {string} eventType - Event type
     * @returns {Array} Array of subscribers
     */
    getSubscribers(eventType) {
        const subscribers = this.events.get(eventType);
        return subscribers ? Array.from(subscribers) : [];
    }

    /**
     * Get event history
     * @param {string} eventType - Optional filter by event type
     * @returns {Array} Event history
     */
    getHistory(eventType = null) {
        if (eventType) {
            return this.history.filter(event => event.type === eventType);
        }
        return [...this.history];
    }

    /**
     * Clear event history
     */
    clearHistory() {
        this.history = [];
        if (this.config.enableLogging) {
            console.log('🧹 Event history cleared');
        }
    }

    /**
     * Add event to history
     * @private
     */
    addToHistory(event) {
        this.history.push(event);

        // Maintain max history size
        if (this.history.length > this.config.maxHistorySize) {
            this.history.shift();
        }
    }

    /**
     * Generate unique subscription ID
     * @private
     */
    generateSubscriptionId() {
        return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate unique event ID
     * @private
     */
    generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get statistics about event bus usage
     * @returns {Object} Usage statistics
     */
    getStats() {
        const stats = {
            totalEventTypes: this.events.size,
            totalSubscriptions: 0,
            eventTypes: {},
            historySize: this.history.length
        };

        for (const [eventType, subscribers] of this.events.entries()) {
            stats.totalSubscriptions += subscribers.size;
            stats.eventTypes[eventType] = subscribers.size;
        }

        return stats;
    }

    /**
     * Enable/disable logging
     * @param {boolean} enable - Enable logging
     */
    setLogging(enable) {
        this.config.enableLogging = enable;
        console.log(`📡 EventBus logging ${enable ? 'enabled' : 'disabled'}`);
    }

    /**
     * Destroy the event bus
     */
    destroy() {
        this.events.clear();
        this.history = [];
        this.eventMetadata.clear();
        console.log('✅ EventBus destroyed');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.EventBus = EventBus;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventBus;
}