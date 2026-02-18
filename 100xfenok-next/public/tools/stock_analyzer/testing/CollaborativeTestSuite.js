/**
 * CollaborativeTestSuite - 다중 에이전트 테스트 오케스트레이션
 */
(function () {
    class CollaborativeTestSuite {
        constructor(options = {}) {
            this.runners = new Map();
            this.agentTests = new Map();
            this.integrationTests = new window.IntegrationTests(options.integrationSuite);
            const ReporterClass = options.reporter || window.DefaultTestReporter;
            this.reporter = ReporterClass ? new ReporterClass() : null;
            this.concurrentAgents = options.concurrentAgents || 3;
            this.performanceHooks = options.performanceHooks || [];
            this.regressionHooks = options.regressionHooks || [];
        }

        getRunner(agentId) {
            if (!this.runners.has(agentId)) {
                const RunnerClass = window.ModuleTestRunner;
                this.runners.set(agentId, new RunnerClass({ agentId }));
            }
            return this.runners.get(agentId);
        }

        registerAgentTests(agentId, moduleName, tests = []) {
            if (!this.agentTests.has(agentId)) {
                this.agentTests.set(agentId, new Map());
            }
            const moduleMap = this.agentTests.get(agentId);
            moduleMap.set(moduleName, tests);
        }

        registerIntegrationTest(name, handler, metadata = {}) {
            this.integrationTests.register(name, handler, metadata);
        }

        registerPerformanceHook(hookFn) {
            this.performanceHooks.push(hookFn);
        }

        registerRegressionHook(hookFn) {
            this.regressionHooks.push(hookFn);
        }

        async runAllTests(context = {}) {
            const results = {
                timestamp: new Date().toISOString(),
                agents: [],
                integration: null,
                performance: [],
                regression: [],
                errors: []
            };

            try {
                const agentEntries = Array.from(this.agentTests.entries());
                const chunks = this.chunk(agentEntries, this.concurrentAgents);

                for (const chunk of chunks) {
                    const chunkResults = await Promise.all(
                        chunk.map(([agentId, modules]) => this.runAgentSuite(agentId, modules, context))
                    );
                    results.agents.push(...chunkResults);
                }
            } catch (error) {
                results.errors.push({
                    phase: 'agent-tests',
                    message: error.message,
                    stack: error.stack
                });
            }

            try {
                results.integration = await this.integrationTests.run({
                    context,
                    agents: results.agents
                });
            } catch (error) {
                results.errors.push({
                    phase: 'integration-tests',
                    message: error.message,
                    stack: error.stack
                });
            }

            for (const hook of this.performanceHooks) {
                try {
                    const perf = await hook(context, results);
                    results.performance.push(perf);
                } catch (error) {
                    results.errors.push({
                        phase: 'performance-hooks',
                        message: error.message,
                        stack: error.stack
                    });
                }
            }

            for (const hook of this.regressionHooks) {
                try {
                    const regression = await hook(context, results);
                    results.regression.push(regression);
                } catch (error) {
                    results.errors.push({
                        phase: 'regression-hooks',
                        message: error.message,
                        stack: error.stack
                    });
                }
            }

            if (this.reporter) {
                this.reporter.report(results);
            }

            return results;
        }

        async runAgentSuite(agentId, modules, context) {
            const runner = this.getRunner(agentId);
            const moduleResults = [];

            for (const [moduleName, tests] of modules.entries()) {
                const result = await runner.runModuleTests(moduleName, tests, context);
                moduleResults.push(result);
            }

            return {
                agentId,
                modules: moduleResults
            };
        }

        chunk(items, size) {
            const result = [];
            for (let i = 0; i < items.length; i += size) {
                result.push(items.slice(i, i + size));
            }
            return result;
        }
    }

    window.CollaborativeTestSuite = CollaborativeTestSuite;
    console.log('✅ CollaborativeTestSuite 로드 완료');
})();
