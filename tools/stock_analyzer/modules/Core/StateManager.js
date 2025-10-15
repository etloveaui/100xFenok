/**
 * StateManager - Global state management system
 * Implements centralized state with module isolation
 *
 * @module Core/StateManager
 * @version 1.0.0
 */

class StateManager {
    constructor(config = {}) {
        this.globalState = new Map();
        this.moduleStates = new Map();
        this.subscribers = new Map();
        this.history = [];
        this.eventBus = null;

        this.config = {
            maxHistorySize: config.maxHistorySize || 50,
            persistState: config.persistState !== false,
            storageKey: config.storageKey || 'stock-analyzer-state',
            debounceDelay: config.debounceDelay || 100
        };

        // Debounce timers
        this.saveTimer = null;

        // Initialize with persisted state if available
        if (this.config.persistState) {
            this.loadPersistedState();
        }

        console.log('✅ StateManager initialized');
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
     * Set global state
     * @param {string} key - State key
     * @param {*} value - State value
     * @param {Object} options - Set options
     */
    setGlobalState(key, value, options = {}) {
        const oldValue = this.globalState.get(key);

        // Check if value actually changed
        if (!options.force && this.isEqual(oldValue, value)) {
            return;
        }

        // Update state
        this.globalState.set(key, value);

        // Add to history
        this.addToHistory('global', key, oldValue, value);

        // Notify subscribers
        this.notifySubscribers('global', key, value, oldValue);

        // Persist if enabled
        if (this.config.persistState && !options.skipPersist) {
            this.debouncedSave();
        }

        // Emit event
        if (this.eventBus && !options.silent) {
            this.eventBus.emit('state:global:changed', {
                key,
                value,
                oldValue
            });
        }
    }

    /**
     * Get global state
     * @param {string} key - State key
     * @param {*} defaultValue - Default value if not found
     * @returns {*} State value
     */
    getGlobalState(key, defaultValue = undefined) {
        return this.globalState.has(key)
            ? this.globalState.get(key)
            : defaultValue;
    }

    /**
     * Set module-specific state
     * @param {string} moduleId - Module ID
     * @param {string} key - State key
     * @param {*} value - State value
     * @param {Object} options - Set options
     */
    setModuleState(moduleId, key, value, options = {}) {
        if (!this.moduleStates.has(moduleId)) {
            this.moduleStates.set(moduleId, new Map());
        }

        const moduleState = this.moduleStates.get(moduleId);
        const oldValue = moduleState.get(key);

        // Check if value actually changed
        if (!options.force && this.isEqual(oldValue, value)) {
            return;
        }

        // Update state
        moduleState.set(key, value);

        // Add to history
        this.addToHistory(moduleId, key, oldValue, value);

        // Notify subscribers
        this.notifySubscribers(moduleId, key, value, oldValue);

        // Persist if enabled
        if (this.config.persistState && !options.skipPersist) {
            this.debouncedSave();
        }

        // Emit event
        if (this.eventBus && !options.silent) {
            this.eventBus.emit('state:module:changed', {
                moduleId,
                key,
                value,
                oldValue
            });
        }
    }

    /**
     * Get module-specific state
     * @param {string} moduleId - Module ID
     * @param {string} key - State key
     * @param {*} defaultValue - Default value
     * @returns {*} State value
     */
    getModuleState(moduleId, key, defaultValue = undefined) {
        const moduleState = this.moduleStates.get(moduleId);

        if (!moduleState) {
            return defaultValue;
        }

        return moduleState.has(key)
            ? moduleState.get(key)
            : defaultValue;
    }

    /**
     * Get entire module state
     * @param {string} moduleId - Module ID
     * @returns {Object} Module state object
     */
    getAllModuleState(moduleId) {
        const moduleState = this.moduleStates.get(moduleId);

        if (!moduleState) {
            return {};
        }

        return Object.fromEntries(moduleState);
    }

    /**
     * Subscribe to state changes
     * @param {string} scope - Scope (global or moduleId)
     * @param {string} key - State key to watch (or * for all)
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    subscribe(scope, key, callback) {
        const subscriptionKey = `${scope}:${key}`;

        if (!this.subscribers.has(subscriptionKey)) {
            this.subscribers.set(subscriptionKey, new Set());
        }

        const subscription = {
            callback,
            id: this.generateSubscriptionId()
        };

        this.subscribers.get(subscriptionKey).add(subscription);

        // Return unsubscribe function
        return () => {
            const subs = this.subscribers.get(subscriptionKey);
            if (subs) {
                subs.delete(subscription);
                if (subs.size === 0) {
                    this.subscribers.delete(subscriptionKey);
                }
            }
        };
    }

    /**
     * Notify subscribers of state change
     * @private
     */
    notifySubscribers(scope, key, value, oldValue) {
        // Notify specific key subscribers
        const specificKey = `${scope}:${key}`;
        const specificSubs = this.subscribers.get(specificKey);

        if (specificSubs) {
            specificSubs.forEach(sub => {
                try {
                    sub.callback(value, oldValue, key);
                } catch (error) {
                    console.error('Error in state subscriber:', error);
                }
            });
        }

        // Notify wildcard subscribers
        const wildcardKey = `${scope}:*`;
        const wildcardSubs = this.subscribers.get(wildcardKey);

        if (wildcardSubs) {
            wildcardSubs.forEach(sub => {
                try {
                    sub.callback(value, oldValue, key);
                } catch (error) {
                    console.error('Error in state subscriber:', error);
                }
            });
        }
    }

    /**
     * Create computed state
     * @param {string} key - Computed state key
     * @param {Function} computeFn - Compute function
     * @param {Array} dependencies - State dependencies
     * @returns {Function} Unsubscribe function
     */
    createComputed(key, computeFn, dependencies = []) {
        const compute = () => {
            try {
                const value = computeFn(this);
                this.setGlobalState(key, value, { skipPersist: true });
            } catch (error) {
                console.error(`Error computing ${key}:`, error);
            }
        };

        // Initial computation
        compute();

        // Subscribe to dependencies
        const unsubscribers = dependencies.map(dep => {
            const [scope, depKey] = dep.includes(':')
                ? dep.split(':')
                : ['global', dep];

            return this.subscribe(scope, depKey, compute);
        });

        // Return cleanup function
        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    }

    /**
     * Reset module state
     * @param {string} moduleId - Module ID to reset
     */
    resetModuleState(moduleId) {
        this.moduleStates.delete(moduleId);

        // Clear related subscriptions
        const keysToDelete = [];
        for (const key of this.subscribers.keys()) {
            if (key.startsWith(`${moduleId}:`)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.subscribers.delete(key));

        // Emit event
        if (this.eventBus) {
            this.eventBus.emit('state:module:reset', { moduleId });
        }

        // Save state
        if (this.config.persistState) {
            this.debouncedSave();
        }

        console.log(`✅ Module state reset: ${moduleId}`);
    }

    /**
     * Reset all state
     */
    resetAll() {
        this.globalState.clear();
        this.moduleStates.clear();
        this.history = [];

        // Clear storage
        if (this.config.persistState) {
            try {
                localStorage.removeItem(this.config.storageKey);
            } catch (error) {
                console.error('Failed to clear persisted state:', error);
            }
        }

        // Emit event
        if (this.eventBus) {
            this.eventBus.emit('state:reset');
        }

        console.log('✅ All state reset');
    }

    /**
     * Load persisted state from localStorage
     * @private
     */
    loadPersistedState() {
        try {
            const stored = localStorage.getItem(this.config.storageKey);

            if (!stored) {
                return;
            }

            const parsed = JSON.parse(stored);

            // Restore global state
            if (parsed.global) {
                this.globalState = new Map(Object.entries(parsed.global));
            }

            // Restore module states
            if (parsed.modules) {
                for (const [moduleId, state] of Object.entries(parsed.modules)) {
                    this.moduleStates.set(moduleId, new Map(Object.entries(state)));
                }
            }

            console.log('✅ State restored from localStorage');

        } catch (error) {
            console.error('Failed to load persisted state:', error);
        }
    }

    /**
     * Save state to localStorage
     * @private
     */
    saveState() {
        if (!this.config.persistState) {
            return;
        }

        try {
            const toSave = {
                global: Object.fromEntries(this.globalState),
                modules: {},
                timestamp: Date.now()
            };

            // Convert module states
            for (const [moduleId, state] of this.moduleStates.entries()) {
                toSave.modules[moduleId] = Object.fromEntries(state);
            }

            localStorage.setItem(this.config.storageKey, JSON.stringify(toSave));

        } catch (error) {
            console.error('Failed to save state:', error);
        }
    }

    /**
     * Debounced save to localStorage
     * @private
     */
    debouncedSave() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        this.saveTimer = setTimeout(() => {
            this.saveState();
            this.saveTimer = null;
        }, this.config.debounceDelay);
    }

    /**
     * Add state change to history
     * @private
     */
    addToHistory(scope, key, oldValue, newValue) {
        this.history.push({
            timestamp: Date.now(),
            scope,
            key,
            oldValue,
            newValue
        });

        // Maintain max history size
        if (this.history.length > this.config.maxHistorySize) {
            this.history.shift();
        }
    }

    /**
     * Get state history
     * @param {Object} filter - Filter options
     * @returns {Array} Filtered history
     */
    getHistory(filter = {}) {
        let filtered = [...this.history];

        if (filter.scope) {
            filtered = filtered.filter(h => h.scope === filter.scope);
        }

        if (filter.key) {
            filtered = filtered.filter(h => h.key === filter.key);
        }

        if (filter.since) {
            const since = typeof filter.since === 'number'
                ? filter.since
                : Date.parse(filter.since);
            filtered = filtered.filter(h => h.timestamp >= since);
        }

        return filtered;
    }

    /**
     * Check if two values are equal
     * @private
     */
    isEqual(a, b) {
        if (a === b) return true;

        if (a == null || b == null) return false;

        if (typeof a !== 'object' || typeof b !== 'object') {
            return false;
        }

        // Simple object equality check
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) {
            return false;
        }

        for (const key of keysA) {
            if (!keysB.includes(key) || !this.isEqual(a[key], b[key])) {
                return false;
            }
        }

        return true;
    }

    /**
     * Generate unique subscription ID
     * @private
     */
    generateSubscriptionId() {
        return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (!this.eventBus) return;

        // Listen for module cleanup
        this.eventBus.on('module:unloaded', (data) => {
            this.resetModuleState(data.moduleId);
        });

        // Listen for state sync requests
        this.eventBus.on('state:sync', () => {
            this.saveState();
        });
    }

    /**
     * Get state snapshot
     * @returns {Object} Current state snapshot
     */
    getSnapshot() {
        return {
            global: Object.fromEntries(this.globalState),
            modules: Object.fromEntries(
                Array.from(this.moduleStates.entries()).map(([id, state]) =>
                    [id, Object.fromEntries(state)]
                )
            ),
            timestamp: Date.now()
        };
    }

    /**
     * Restore from snapshot
     * @param {Object} snapshot - State snapshot
     */
    restoreSnapshot(snapshot) {
        if (snapshot.global) {
            this.globalState = new Map(Object.entries(snapshot.global));
        }

        if (snapshot.modules) {
            this.moduleStates.clear();
            for (const [moduleId, state] of Object.entries(snapshot.modules)) {
                this.moduleStates.set(moduleId, new Map(Object.entries(state)));
            }
        }

        // Notify all subscribers
        this.notifyAllSubscribers();

        // Save to storage
        if (this.config.persistState) {
            this.saveState();
        }

        console.log('✅ State restored from snapshot');
    }

    /**
     * Notify all subscribers (used after snapshot restore)
     * @private
     */
    notifyAllSubscribers() {
        for (const [key, subs] of this.subscribers.entries()) {
            const [scope, stateKey] = key.split(':');

            let value;
            if (scope === 'global') {
                value = this.globalState.get(stateKey);
            } else {
                const moduleState = this.moduleStates.get(scope);
                value = moduleState ? moduleState.get(stateKey) : undefined;
            }

            subs.forEach(sub => {
                try {
                    sub.callback(value, undefined, stateKey);
                } catch (error) {
                    console.error('Error notifying subscriber:', error);
                }
            });
        }
    }

    /**
     * Destroy the state manager
     */
    destroy() {
        // Clear timers
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        // Save final state
        if (this.config.persistState) {
            this.saveState();
        }

        // Clear all data
        this.globalState.clear();
        this.moduleStates.clear();
        this.subscribers.clear();
        this.history = [];

        console.log('✅ StateManager destroyed');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.StateManager = StateManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateManager;
}