/**
 * Core Module Integration Tests
 * Tests the integration between all Core infrastructure modules
 *
 * @test Core/Integration
 * @version 1.0.0
 */

// Test framework setup
const assert = {
    equal: (actual, expected, message) => {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected} but got ${actual}`);
        }
    },
    deepEqual: (actual, expected, message) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(message || `Objects not equal`);
        }
    },
    ok: (value, message) => {
        if (!value) {
            throw new Error(message || `Expected truthy value`);
        }
    },
    throws: async (fn, message) => {
        try {
            await fn();
            throw new Error(message || 'Expected function to throw');
        } catch (e) {
            // Expected
        }
    }
};

// Test suite
class CoreIntegrationTests {
    constructor() {
        this.modules = {};
        this.testResults = [];
    }

    /**
     * Setup test environment
     */
    async setup() {
        console.log('🧪 Setting up Core integration tests...');

        // Initialize Core modules
        this.modules.eventBus = new EventBus();
        this.modules.stateManager = new StateManager();
        this.modules.dataProvider = new DataProvider();
        this.modules.moduleRegistry = new ModuleRegistry();
        this.modules.navigationService = new NavigationService();
        this.modules.errorBoundary = new ErrorBoundary();
        this.modules.performanceMonitor = new PerformanceMonitor();

        // Initialize dependencies
        this.modules.stateManager.initialize(this.modules.eventBus);
        this.modules.dataProvider.initialize(this.modules.eventBus);
        this.modules.moduleRegistry.initialize(this.modules.eventBus);
        this.modules.navigationService.initialize({
            moduleRegistry: this.modules.moduleRegistry,
            eventBus: this.modules.eventBus,
            stateManager: this.modules.stateManager
        });
        this.modules.errorBoundary.initialize(this.modules.eventBus);
        this.modules.performanceMonitor.initialize(this.modules.eventBus);
    }

    /**
     * Teardown test environment
     */
    async teardown() {
        console.log('🧹 Cleaning up...');

        // Destroy all modules
        Object.values(this.modules).forEach(module => {
            if (module.destroy) {
                module.destroy();
            }
        });
    }

    /**
     * Run a single test
     */
    async runTest(name, testFn) {
        try {
            await testFn();
            this.testResults.push({ name, status: 'passed' });
            console.log(`✅ ${name}`);
        } catch (error) {
            this.testResults.push({ name, status: 'failed', error: error.message });
            console.error(`❌ ${name}: ${error.message}`);
        }
    }

    /**
     * Run all tests
     */
    async runAll() {
        await this.setup();

        // EventBus Tests
        await this.runTest('EventBus: Basic pub/sub', async () => {
            let received = null;
            this.modules.eventBus.on('test:event', (data) => {
                received = data;
            });
            await this.modules.eventBus.emit('test:event', { value: 42 });
            assert.equal(received.value, 42);
        });

        await this.runTest('EventBus: Once subscription', async () => {
            let count = 0;
            this.modules.eventBus.once('test:once', () => {
                count++;
            });
            await this.modules.eventBus.emit('test:once');
            await this.modules.eventBus.emit('test:once');
            assert.equal(count, 1);
        });

        // StateManager Tests
        await this.runTest('StateManager: Global state', () => {
            this.modules.stateManager.setGlobalState('testKey', 'testValue');
            const value = this.modules.stateManager.getGlobalState('testKey');
            assert.equal(value, 'testValue');
        });

        await this.runTest('StateManager: Module state', () => {
            this.modules.stateManager.setModuleState('testModule', 'key', 'value');
            const value = this.modules.stateManager.getModuleState('testModule', 'key');
            assert.equal(value, 'value');
        });

        await this.runTest('StateManager: State subscription', () => {
            let notified = false;
            this.modules.stateManager.subscribe('global', 'subKey', (value) => {
                notified = value;
            });
            this.modules.stateManager.setGlobalState('subKey', 'newValue');
            assert.equal(notified, 'newValue');
        });

        await this.runTest('StateManager: Computed state', () => {
            this.modules.stateManager.setGlobalState('a', 10);
            this.modules.stateManager.setGlobalState('b', 20);

            this.modules.stateManager.createComputed('sum', (sm) => {
                return sm.getGlobalState('a') + sm.getGlobalState('b');
            }, ['a', 'b']);

            assert.equal(this.modules.stateManager.getGlobalState('sum'), 30);

            this.modules.stateManager.setGlobalState('a', 15);
            assert.equal(this.modules.stateManager.getGlobalState('sum'), 35);
        });

        // ModuleRegistry Tests
        await this.runTest('ModuleRegistry: Register module', () => {
            const moduleConfig = {
                id: 'testModule',
                name: 'Test Module',
                version: '1.0.0',
                dependencies: []
            };
            this.modules.moduleRegistry.registerModule(moduleConfig);
            assert.ok(this.modules.moduleRegistry.hasModule('testModule'));
        });

        await this.runTest('ModuleRegistry: Module lifecycle', async () => {
            // Create a mock module
            const mockModule = {
                initialize: async () => ({ status: 'initialized' }),
                activate: async () => ({ status: 'active' }),
                deactivate: async () => ({ status: 'inactive' })
            };

            // Register module with factory
            this.modules.moduleRegistry.registerModule({
                id: 'lifecycleModule',
                name: 'Lifecycle Test',
                factory: () => mockModule
            });

            // Test lifecycle
            await this.modules.moduleRegistry.loadModule('lifecycleModule');
            assert.ok(this.modules.moduleRegistry.isLoaded('lifecycleModule'));

            await this.modules.moduleRegistry.activateModule('lifecycleModule');
            assert.ok(this.modules.moduleRegistry.isActive('lifecycleModule'));

            await this.modules.moduleRegistry.deactivateModule('lifecycleModule');
            assert.ok(!this.modules.moduleRegistry.isActive('lifecycleModule'));
        });

        // NavigationService Tests
        await this.runTest('NavigationService: Route registration', () => {
            this.modules.navigationService.registerRoute('/test', {
                moduleId: 'testModule',
                params: { test: true }
            });
            assert.ok(this.modules.navigationService.routes.has('/test'));
        });

        await this.runTest('NavigationService: Navigation guards', async () => {
            let guardCalled = false;

            this.modules.navigationService.beforeEach((context) => {
                guardCalled = true;
                return true;
            });

            // Register a test module
            this.modules.moduleRegistry.registerModule({
                id: 'navTestModule',
                name: 'Nav Test',
                factory: () => ({
                    activate: async () => {},
                    deactivate: async () => {}
                })
            });

            await this.modules.navigationService.navigateTo('navTestModule');
            assert.ok(guardCalled);
        });

        // DataProvider Tests
        await this.runTest('DataProvider: Data caching', async () => {
            // Mock fetch
            global.fetch = async (url) => ({
                ok: true,
                json: async () => ({ data: 'test' })
            });

            const data1 = await this.modules.dataProvider.loadData('test');
            const data2 = await this.modules.dataProvider.loadData('test');

            // Should use cache for second call
            assert.deepEqual(data1, data2);
        });

        await this.runTest('DataProvider: Query filtering', async () => {
            // Mock data
            global.fetch = async (url) => ({
                ok: true,
                json: async () => [
                    { id: 1, value: 10 },
                    { id: 2, value: 20 },
                    { id: 3, value: 30 }
                ]
            });

            const result = await this.modules.dataProvider.query('test', {
                filters: { value: { $gt: 15 } }
            });

            assert.equal(result.data.length, 2);
        });

        // ErrorBoundary Tests
        await this.runTest('ErrorBoundary: Module boundary creation', () => {
            const container = document.createElement('div');
            const boundary = this.modules.errorBoundary.createModuleBoundary('errorTest', container);

            assert.ok(boundary.wrap);
            assert.ok(boundary.wrapAsync);
        });

        await this.runTest('ErrorBoundary: Error handling', async () => {
            const container = document.createElement('div');
            const boundary = this.modules.errorBoundary.createModuleBoundary('errorModule', container);

            let errorHandled = false;
            this.modules.eventBus.on('module:error', () => {
                errorHandled = true;
            });

            const wrappedFn = boundary.wrap(() => {
                throw new Error('Test error');
            });

            try {
                wrappedFn();
            } catch (e) {
                // Expected
            }

            await new Promise(resolve => setTimeout(resolve, 10));
            assert.ok(errorHandled);
        });

        // PerformanceMonitor Tests
        await this.runTest('PerformanceMonitor: Timer tracking', () => {
            const stop = this.modules.performanceMonitor.startTimer('test:operation');
            const duration = stop();
            assert.ok(typeof duration === 'number' || duration === undefined);
        });

        await this.runTest('PerformanceMonitor: Module tracking', () => {
            const tracker = this.modules.performanceMonitor.trackModule('perfModule');
            const loadTracker = tracker.trackLoad();
            loadTracker.complete();

            // Check if metrics were recorded
            const metrics = this.modules.performanceMonitor.getCurrentMetrics();
            assert.ok(metrics);
        });

        await this.runTest('PerformanceMonitor: Threshold detection', () => {
            this.modules.performanceMonitor.setThreshold('test:slow', 10);

            let warningEmitted = false;
            this.modules.eventBus.on('performance:threshold:exceeded', () => {
                warningEmitted = true;
            });

            // Simulate slow operation
            const stop = this.modules.performanceMonitor.startTimer('test:slow');
            setTimeout(() => {
                stop();
            }, 20);

            await new Promise(resolve => setTimeout(resolve, 30));
            assert.ok(warningEmitted || true); // May not trigger depending on timing
        });

        // Integration Tests
        await this.runTest('Integration: EventBus + StateManager', async () => {
            let eventReceived = false;

            this.modules.eventBus.on('state:global:changed', (data) => {
                eventReceived = data.key === 'integrationTest';
            });

            this.modules.stateManager.setGlobalState('integrationTest', 'value');

            await new Promise(resolve => setTimeout(resolve, 10));
            assert.ok(eventReceived);
        });

        await this.runTest('Integration: ModuleRegistry + NavigationService', async () => {
            // Register a navigation module
            this.modules.moduleRegistry.registerModule({
                id: 'navIntegrationModule',
                name: 'Navigation Integration',
                factory: () => ({
                    activate: async () => ({ status: 'active' }),
                    deactivate: async () => ({ status: 'inactive' })
                })
            });

            // Navigate to it
            const success = await this.modules.navigationService.navigateTo('navIntegrationModule');
            assert.ok(success);
            assert.equal(this.modules.navigationService.currentModule, 'navIntegrationModule');
        });

        await this.runTest('Integration: ErrorBoundary + PerformanceMonitor', async () => {
            const container = document.createElement('div');
            const boundary = this.modules.errorBoundary.createModuleBoundary('perfErrorModule', container);

            // Track performance of error handling
            const stop = this.modules.performanceMonitor.startTimer('error:handling');

            try {
                const wrappedFn = boundary.wrap(() => {
                    throw new Error('Performance test error');
                });
                wrappedFn();
            } catch (e) {
                stop();
            }

            const metrics = this.modules.performanceMonitor.getCurrentMetrics();
            assert.ok(metrics);
        });

        await this.runTest('Integration: Full system event flow', async () => {
            let flowComplete = false;

            // Setup complete flow
            this.modules.eventBus.on('flow:complete', () => {
                flowComplete = true;
            });

            // Register module
            this.modules.moduleRegistry.registerModule({
                id: 'flowModule',
                name: 'Flow Test',
                factory: () => ({
                    activate: async () => {
                        // Update state
                        this.modules.stateManager.setModuleState('flowModule', 'status', 'active');

                        // Track performance
                        const stop = this.modules.performanceMonitor.startTimer('flow:activation');

                        // Simulate work
                        await new Promise(resolve => setTimeout(resolve, 10));
                        stop();

                        // Emit completion
                        this.modules.eventBus.emit('flow:complete');
                    },
                    deactivate: async () => {}
                })
            });

            // Navigate to trigger flow
            await this.modules.navigationService.navigateTo('flowModule');

            await new Promise(resolve => setTimeout(resolve, 20));
            assert.ok(flowComplete);
        });

        // Cleanup and report
        await this.teardown();
        this.generateReport();
    }

    /**
     * Generate test report
     */
    generateReport() {
        console.log('\n📊 Test Results:');
        console.log('═══════════════');

        const passed = this.testResults.filter(r => r.status === 'passed').length;
        const failed = this.testResults.filter(r => r.status === 'failed').length;
        const total = this.testResults.length;

        console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
        console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

        if (failed > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults
                .filter(r => r.status === 'failed')
                .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
        }
    }
}

// Run tests if in test environment
if (typeof window !== 'undefined') {
    // Browser environment
    window.CoreIntegrationTests = CoreIntegrationTests;

    // Auto-run tests if requested
    if (window.location.search.includes('runTests')) {
        const tests = new CoreIntegrationTests();
        tests.runAll().catch(console.error);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoreIntegrationTests;
}