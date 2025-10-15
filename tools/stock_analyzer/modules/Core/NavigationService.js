/**
 * NavigationService - Module navigation and routing system
 * Handles module switching, browser history, and deep linking
 *
 * @module Core/NavigationService
 * @version 1.0.0
 */

class NavigationService {
    constructor(config = {}) {
        this.currentModule = null;
        this.previousModule = null;
        this.navigationStack = [];
        this.moduleRegistry = null;
        this.eventBus = null;
        this.stateManager = null;

        this.config = {
            enableHistory: config.enableHistory !== false,
            historyMode: config.historyMode || 'hash', // 'hash' or 'push'
            baseUrl: config.baseUrl || '/',
            defaultModule: config.defaultModule || 'dashboard',
            transitionDuration: config.transitionDuration || 300,
            maxStackSize: config.maxStackSize || 50
        };

        // Navigation guards
        this.beforeNavGuards = [];
        this.afterNavGuards = [];

        // Route definitions
        this.routes = new Map();

        // Initialize history handler
        if (this.config.enableHistory) {
            this.setupHistoryHandler();
        }

        console.log('✅ NavigationService initialized');
    }

    /**
     * Initialize with dependencies
     * @param {Object} dependencies - Service dependencies
     */
    initialize({ moduleRegistry, eventBus, stateManager }) {
        this.moduleRegistry = moduleRegistry;
        this.eventBus = eventBus;
        this.stateManager = stateManager;

        this.setupEventListeners();
        this.loadInitialRoute();
    }

    /**
     * Register a route
     * @param {string} path - Route path
     * @param {Object} config - Route configuration
     */
    registerRoute(path, config) {
        this.routes.set(path, {
            moduleId: config.moduleId,
            params: config.params || {},
            meta: config.meta || {},
            beforeEnter: config.beforeEnter,
            afterEnter: config.afterEnter
        });

        console.log(`📍 Route registered: ${path} → ${config.moduleId}`);
    }

    /**
     * Navigate to a module
     * @param {string} moduleId - Module to navigate to
     * @param {Object} options - Navigation options
     * @returns {Promise<boolean>} Navigation success
     */
    async navigateTo(moduleId, options = {}) {
        const from = this.currentModule;
        const to = moduleId;

        // Create navigation context
        const navContext = {
            from,
            to,
            params: options.params || {},
            query: options.query || {},
            meta: options.meta || {}
        };

        try {
            // Run before navigation guards
            const canNavigate = await this.runBeforeGuards(navContext);

            if (!canNavigate) {
                console.log(`🚫 Navigation to ${to} cancelled by guard`);
                return false;
            }

            // Emit navigation start event
            if (this.eventBus) {
                await this.eventBus.emit('navigation:before', navContext);
            }

            // Deactivate current module
            if (from) {
                await this.deactivateModule(from);
            }

            // Update navigation state
            this.previousModule = from;
            this.currentModule = to;

            // Add to navigation stack
            this.addToStack({
                moduleId: to,
                timestamp: Date.now(),
                params: navContext.params,
                query: navContext.query
            });

            // Update browser URL
            if (this.config.enableHistory && !options.skipHistory) {
                this.updateUrl(to, navContext);
            }

            // Activate new module
            await this.activateModule(to, navContext);

            // Save navigation state
            if (this.stateManager) {
                this.stateManager.setGlobalState('currentModule', to);
                this.stateManager.setGlobalState('navigationHistory', this.navigationStack);
            }

            // Run after navigation guards
            await this.runAfterGuards(navContext);

            // Emit navigation complete event
            if (this.eventBus) {
                await this.eventBus.emit('navigation:after', navContext);
                await this.eventBus.emit('navigation:module', {
                    moduleId: to,
                    ...navContext
                });
            }

            console.log(`✅ Navigated to ${to}`);
            return true;

        } catch (error) {
            console.error(`❌ Navigation error:`, error);

            // Emit navigation error event
            if (this.eventBus) {
                await this.eventBus.emit('navigation:error', {
                    error: error.message,
                    from,
                    to
                });
            }

            // Attempt recovery
            if (from) {
                await this.navigateTo(from, { skipHistory: true });
            }

            return false;
        }
    }

    /**
     * Navigate back
     * @returns {Promise<boolean>} Navigation success
     */
    async back() {
        if (this.navigationStack.length <= 1) {
            console.log('📍 No navigation history to go back');
            return false;
        }

        // Remove current from stack
        this.navigationStack.pop();

        // Get previous entry
        const previous = this.navigationStack[this.navigationStack.length - 1];

        if (previous) {
            return await this.navigateTo(previous.moduleId, {
                params: previous.params,
                query: previous.query,
                skipHistory: true
            });
        }

        return false;
    }

    /**
     * Navigate forward (if possible)
     * @returns {Promise<boolean>} Navigation success
     */
    async forward() {
        // This would require maintaining a forward stack
        // For now, just use browser's forward
        if (this.config.enableHistory) {
            window.history.forward();
            return true;
        }
        return false;
    }

    /**
     * Reload current module
     * @returns {Promise<boolean>} Reload success
     */
    async reload() {
        if (!this.currentModule) {
            return false;
        }

        const moduleId = this.currentModule;

        // Deactivate and reactivate
        await this.deactivateModule(moduleId);
        await this.activateModule(moduleId);

        if (this.eventBus) {
            await this.eventBus.emit('module:reload', { moduleId });
        }

        return true;
    }

    /**
     * Deactivate a module
     * @private
     */
    async deactivateModule(moduleId) {
        if (!this.moduleRegistry) {
            return;
        }

        try {
            await this.moduleRegistry.deactivateModule(moduleId);
            this.applyTransition('exit', moduleId);
        } catch (error) {
            console.error(`Failed to deactivate module ${moduleId}:`, error);
        }
    }

    /**
     * Activate a module
     * @private
     */
    async activateModule(moduleId, context = {}) {
        if (!this.moduleRegistry) {
            throw new Error('ModuleRegistry not initialized');
        }

        // Load module if needed
        if (!this.moduleRegistry.isLoaded(moduleId)) {
            await this.moduleRegistry.loadModule(moduleId);
        }

        // Activate module
        await this.moduleRegistry.activateModule(moduleId);
        this.applyTransition('enter', moduleId);

        // Pass context to module
        const module = this.moduleRegistry.getModule(moduleId);
        if (module && module.onNavigate) {
            await module.onNavigate(context);
        }
    }

    /**
     * Apply navigation transition
     * @private
     */
    applyTransition(type, moduleId) {
        const container = document.getElementById(`module-${moduleId}`);

        if (!container) {
            return;
        }

        if (type === 'exit') {
            container.classList.add('module-exit');
            setTimeout(() => {
                container.classList.remove('module-active');
                container.classList.remove('module-exit');
            }, this.config.transitionDuration);

        } else if (type === 'enter') {
            container.classList.add('module-enter');
            container.classList.add('module-active');
            setTimeout(() => {
                container.classList.remove('module-enter');
            }, this.config.transitionDuration);
        }
    }

    /**
     * Register a before navigation guard
     * @param {Function} guard - Guard function
     * @returns {Function} Unregister function
     */
    beforeEach(guard) {
        this.beforeNavGuards.push(guard);

        return () => {
            const index = this.beforeNavGuards.indexOf(guard);
            if (index !== -1) {
                this.beforeNavGuards.splice(index, 1);
            }
        };
    }

    /**
     * Register an after navigation guard
     * @param {Function} guard - Guard function
     * @returns {Function} Unregister function
     */
    afterEach(guard) {
        this.afterNavGuards.push(guard);

        return () => {
            const index = this.afterNavGuards.indexOf(guard);
            if (index !== -1) {
                this.afterNavGuards.splice(index, 1);
            }
        };
    }

    /**
     * Run before navigation guards
     * @private
     */
    async runBeforeGuards(context) {
        for (const guard of this.beforeNavGuards) {
            try {
                const result = await guard(context);
                if (result === false) {
                    return false;
                }
            } catch (error) {
                console.error('Error in navigation guard:', error);
                return false;
            }
        }
        return true;
    }

    /**
     * Run after navigation guards
     * @private
     */
    async runAfterGuards(context) {
        for (const guard of this.afterNavGuards) {
            try {
                await guard(context);
            } catch (error) {
                console.error('Error in after navigation guard:', error);
            }
        }
    }

    /**
     * Setup browser history handler
     * @private
     */
    setupHistoryHandler() {
        if (this.config.historyMode === 'hash') {
            window.addEventListener('hashchange', this.handleUrlChange.bind(this));
        } else {
            window.addEventListener('popstate', this.handleUrlChange.bind(this));
        }
    }

    /**
     * Handle URL change
     * @private
     */
    async handleUrlChange(event) {
        const moduleId = this.getModuleFromUrl();

        if (moduleId && moduleId !== this.currentModule) {
            await this.navigateTo(moduleId, { skipHistory: true });
        }
    }

    /**
     * Get module from current URL
     * @private
     */
    getModuleFromUrl() {
        if (this.config.historyMode === 'hash') {
            const hash = window.location.hash.slice(1);
            const path = hash.split('?')[0];

            // Check routes first
            const route = this.routes.get(path);
            if (route) {
                return route.moduleId;
            }

            // Fall back to direct module ID
            return path || this.config.defaultModule;
        } else {
            const path = window.location.pathname.replace(this.config.baseUrl, '');

            // Check routes
            const route = this.routes.get(path);
            if (route) {
                return route.moduleId;
            }

            return path || this.config.defaultModule;
        }
    }

    /**
     * Update browser URL
     * @private
     */
    updateUrl(moduleId, context = {}) {
        const params = new URLSearchParams(context.query || {});
        const queryString = params.toString();
        const url = queryString ? `${moduleId}?${queryString}` : moduleId;

        if (this.config.historyMode === 'hash') {
            window.location.hash = url;
        } else {
            const fullUrl = `${this.config.baseUrl}${url}`;
            window.history.pushState(
                { moduleId, ...context },
                '',
                fullUrl
            );
        }
    }

    /**
     * Load initial route from URL
     * @private
     */
    async loadInitialRoute() {
        const moduleId = this.getModuleFromUrl();

        if (moduleId) {
            await this.navigateTo(moduleId, { skipHistory: false });
        }
    }

    /**
     * Add entry to navigation stack
     * @private
     */
    addToStack(entry) {
        this.navigationStack.push(entry);

        // Maintain max stack size
        if (this.navigationStack.length > this.config.maxStackSize) {
            this.navigationStack.shift();
        }
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (!this.eventBus) return;

        // Listen for module navigation requests
        this.eventBus.on('navigate:to', async (data) => {
            await this.navigateTo(data.moduleId, data.options);
        });

        // Listen for back navigation
        this.eventBus.on('navigate:back', async () => {
            await this.back();
        });

        // Listen for reload requests
        this.eventBus.on('navigate:reload', async () => {
            await this.reload();
        });
    }

    /**
     * Get navigation statistics
     * @returns {Object} Navigation stats
     */
    getStats() {
        return {
            currentModule: this.currentModule,
            previousModule: this.previousModule,
            stackSize: this.navigationStack.length,
            routeCount: this.routes.size,
            guardCount: {
                before: this.beforeNavGuards.length,
                after: this.afterNavGuards.length
            }
        };
    }

    /**
     * Clear navigation history
     */
    clearHistory() {
        this.navigationStack = [];
        this.previousModule = null;

        if (this.stateManager) {
            this.stateManager.setGlobalState('navigationHistory', []);
        }
    }

    /**
     * Destroy the navigation service
     */
    destroy() {
        // Remove event listeners
        if (this.config.enableHistory) {
            if (this.config.historyMode === 'hash') {
                window.removeEventListener('hashchange', this.handleUrlChange);
            } else {
                window.removeEventListener('popstate', this.handleUrlChange);
            }
        }

        // Clear data
        this.routes.clear();
        this.navigationStack = [];
        this.beforeNavGuards = [];
        this.afterNavGuards = [];

        console.log('✅ NavigationService destroyed');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.NavigationService = NavigationService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigationService;
}