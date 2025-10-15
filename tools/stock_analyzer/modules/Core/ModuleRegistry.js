/**
 * ModuleRegistry - Core module management system
 * Implements plugin architecture for Stock Analyzer Global Expansion
 *
 * @module Core/ModuleRegistry
 * @version 1.0.0
 */

class ModuleRegistry {
    constructor() {
        this.modules = new Map();
        this.loadedModules = new Set();
        this.activeModule = null;
        this.eventBus = null; // Will be injected
        this.config = {
            maxLoadTime: 1000, // 1 second module switch target
            retryAttempts: 3,
            errorBoundary: true
        };

        console.log('✅ ModuleRegistry initialized');
    }

    /**
     * Initialize the registry with event bus
     * @param {EventBus} eventBus - Event bus instance
     */
    initialize(eventBus) {
        this.eventBus = eventBus;
        this.setupEventListeners();
        console.log('✅ ModuleRegistry initialized with EventBus');
    }

    /**
     * Register a new module
     * @param {Object} moduleConfig - Module configuration
     * @returns {boolean} Registration success
     */
    registerModule(moduleConfig) {
        const { id, name, category, path, dependencies = [], priority = 0 } = moduleConfig;

        if (!id || !name || !path) {
            console.error('❌ Invalid module configuration:', moduleConfig);
            return false;
        }

        if (this.modules.has(id)) {
            console.warn(`⚠️ Module ${id} already registered, updating...`);
        }

        this.modules.set(id, {
            id,
            name,
            category,
            path,
            dependencies,
            priority,
            status: 'registered',
            instance: null,
            loadTime: null,
            errorCount: 0
        });

        console.log(`✅ Module registered: ${name} (${id})`);

        if (this.eventBus) {
            this.eventBus.emit('module:registered', { moduleId: id, name });
        }

        return true;
    }

    /**
     * Load a module asynchronously
     * @param {string} moduleId - Module ID to load
     * @returns {Promise<Object>} Loaded module instance
     */
    async loadModule(moduleId) {
        const module = this.modules.get(moduleId);

        if (!module) {
            throw new Error(`Module ${moduleId} not registered`);
        }

        if (this.loadedModules.has(moduleId)) {
            console.log(`ℹ️ Module ${moduleId} already loaded`);
            return module.instance;
        }

        const startTime = performance.now();

        try {
            // Check dependencies first
            await this.loadDependencies(module.dependencies);

            // Dynamic import with timeout
            const loadPromise = this.dynamicImport(module.path);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Module load timeout')), this.config.maxLoadTime)
            );

            const ModuleClass = await Promise.race([loadPromise, timeoutPromise]);

            // Create instance
            module.instance = new ModuleClass({
                registry: this,
                eventBus: this.eventBus
            });

            // Initialize if method exists
            if (typeof module.instance.initialize === 'function') {
                await module.instance.initialize();
            }

            const loadTime = performance.now() - startTime;
            module.loadTime = loadTime;
            module.status = 'loaded';

            this.loadedModules.add(moduleId);

            console.log(`✅ Module ${module.name} loaded in ${loadTime.toFixed(2)}ms`);

            if (this.eventBus) {
                this.eventBus.emit('module:loaded', {
                    moduleId,
                    name: module.name,
                    loadTime
                });
            }

            return module.instance;

        } catch (error) {
            module.errorCount++;
            module.status = 'error';

            console.error(`❌ Failed to load module ${module.name}:`, error);

            if (this.eventBus) {
                this.eventBus.emit('module:error', {
                    moduleId,
                    error: error.message,
                    errorCount: module.errorCount
                });
            }

            // Retry logic
            if (module.errorCount < this.config.retryAttempts) {
                console.log(`🔄 Retrying module load (${module.errorCount}/${this.config.retryAttempts})...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.loadModule(moduleId);
            }

            throw error;
        }
    }

    /**
     * Load module dependencies
     * @private
     */
    async loadDependencies(dependencies) {
        for (const depId of dependencies) {
            if (!this.loadedModules.has(depId)) {
                await this.loadModule(depId);
            }
        }
    }

    /**
     * Dynamic import wrapper for browser/node compatibility
     * @private
     */
    async dynamicImport(path) {
        // Browser environment - use import()
        if (typeof window !== 'undefined') {
            const module = await import(path);
            return module.default || module;
        }

        // Node environment - use require
        return require(path);
    }

    /**
     * Activate a module (make it current)
     * @param {string} moduleId - Module ID to activate
     */
    async activateModule(moduleId) {
        try {
            // Load if not already loaded
            if (!this.loadedModules.has(moduleId)) {
                await this.loadModule(moduleId);
            }

            const module = this.modules.get(moduleId);

            // Deactivate current module
            if (this.activeModule && this.activeModule !== moduleId) {
                await this.deactivateModule(this.activeModule);
            }

            // Activate new module
            if (module.instance && typeof module.instance.activate === 'function') {
                await module.instance.activate();
            }

            this.activeModule = moduleId;
            module.status = 'active';

            console.log(`✅ Module ${module.name} activated`);

            if (this.eventBus) {
                this.eventBus.emit('module:activated', {
                    moduleId,
                    name: module.name
                });
            }

        } catch (error) {
            console.error(`❌ Failed to activate module ${moduleId}:`, error);
            throw error;
        }
    }

    /**
     * Deactivate a module
     * @param {string} moduleId - Module ID to deactivate
     */
    async deactivateModule(moduleId) {
        const module = this.modules.get(moduleId);

        if (!module || !module.instance) {
            return;
        }

        if (typeof module.instance.deactivate === 'function') {
            await module.instance.deactivate();
        }

        module.status = 'loaded';

        console.log(`✅ Module ${module.name} deactivated`);

        if (this.eventBus) {
            this.eventBus.emit('module:deactivated', {
                moduleId,
                name: module.name
            });
        }
    }

    /**
     * Unload a module from memory
     * @param {string} moduleId - Module ID to unload
     */
    async unloadModule(moduleId) {
        const module = this.modules.get(moduleId);

        if (!module) {
            return;
        }

        // Deactivate if active
        if (this.activeModule === moduleId) {
            await this.deactivateModule(moduleId);
        }

        // Cleanup if method exists
        if (module.instance && typeof module.instance.cleanup === 'function') {
            await module.instance.cleanup();
        }

        module.instance = null;
        module.status = 'registered';
        this.loadedModules.delete(moduleId);

        console.log(`✅ Module ${module.name} unloaded`);
    }

    /**
     * Get module by ID
     * @param {string} moduleId - Module ID
     * @returns {Object|null} Module configuration
     */
    getModule(moduleId) {
        return this.modules.get(moduleId) || null;
    }

    /**
     * Get all registered modules
     * @returns {Array} Array of module configurations
     */
    getAllModules() {
        return Array.from(this.modules.values());
    }

    /**
     * Get modules by category
     * @param {string} category - Module category
     * @returns {Array} Filtered modules
     */
    getModulesByCategory(category) {
        return this.getAllModules().filter(m => m.category === category);
    }

    /**
     * Get module status report
     * @returns {Object} Status summary
     */
    getStatusReport() {
        const modules = this.getAllModules();

        return {
            total: modules.length,
            loaded: this.loadedModules.size,
            active: this.activeModule,
            byStatus: modules.reduce((acc, m) => {
                acc[m.status] = (acc[m.status] || 0) + 1;
                return acc;
            }, {}),
            averageLoadTime: modules
                .filter(m => m.loadTime)
                .reduce((sum, m) => sum + m.loadTime, 0) /
                modules.filter(m => m.loadTime).length || 0,
            errors: modules.filter(m => m.errorCount > 0).map(m => ({
                id: m.id,
                name: m.name,
                errorCount: m.errorCount
            }))
        };
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (!this.eventBus) return;

        // Listen for module navigation requests
        this.eventBus.on('navigation:module', async (data) => {
            const { moduleId } = data;
            try {
                await this.activateModule(moduleId);
            } catch (error) {
                console.error('Navigation error:', error);
                this.eventBus.emit('navigation:error', {
                    moduleId,
                    error: error.message
                });
            }
        });

        // Listen for module reload requests
        this.eventBus.on('module:reload', async (data) => {
            const { moduleId } = data;
            await this.unloadModule(moduleId);
            await this.loadModule(moduleId);
            if (this.activeModule === moduleId) {
                await this.activateModule(moduleId);
            }
        });
    }

    /**
     * Cleanup and destroy registry
     */
    async destroy() {
        // Unload all modules
        for (const moduleId of this.loadedModules) {
            await this.unloadModule(moduleId);
        }

        this.modules.clear();
        this.loadedModules.clear();
        this.activeModule = null;

        console.log('✅ ModuleRegistry destroyed');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.ModuleRegistry = ModuleRegistry;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModuleRegistry;
}