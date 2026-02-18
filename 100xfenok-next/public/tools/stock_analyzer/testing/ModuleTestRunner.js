/**
 * ModuleTestRunner - 단일 모듈 테스트 실행기
 *
 * 테스트 정의:
 * {
 *   name: 'should work',
 *   handler: async (context) => {},
 *   timeout: 5000,
 *   tags: ['smoke']
 * }
 */
(function () {
    class ModuleTestRunner {
        constructor(options = {}) {
            this.agentId = options.agentId || 'unknown-agent';
            this.defaultTimeout = options.defaultTimeout || 5000;
        }

        async runModuleTests(moduleName, tests = [], context = {}) {
            const results = [];
            let passed = 0;
            let failed = 0;

            for (const test of tests) {
                const outcome = await this.runSingleTest(moduleName, test, context);
                results.push(outcome);
                if (outcome.status === 'passed') {
                    passed += 1;
                } else {
                    failed += 1;
                }
            }

            return {
                module: moduleName,
                agentId: this.agentId,
                summary: {
                    total: tests.length,
                    passed,
                    failed
                },
                results
            };
        }

        async runSingleTest(moduleName, test, context) {
            const start = performance.now();
            const timeout = test.timeout || this.defaultTimeout;
            let status = 'passed';
            let error = null;

            try {
                await this.runWithTimeout(Promise.resolve(test.handler(context)), timeout);
            } catch (err) {
                status = 'failed';
                error = {
                    message: err.message,
                    stack: err.stack
                };
            }

            const end = performance.now();

            return {
                moduleName,
                testName: test.name,
                status,
                duration: end - start,
                tags: test.tags || [],
                error
            };
        }

        runWithTimeout(promise, timeout) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`Test timed out after ${timeout}ms`));
                }, timeout);

                promise
                    .then((value) => {
                        clearTimeout(timer);
                        resolve(value);
                    })
                    .catch((error) => {
                        clearTimeout(timer);
                        reject(error);
                    });
            });
        }
    }

    window.ModuleTestRunner = ModuleTestRunner;
    console.log('✅ ModuleTestRunner 로드 완료');
})();
