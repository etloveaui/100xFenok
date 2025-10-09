/**
 * IntegrationTests - 모듈 간 상호작용 테스트 관리
 */
(function () {
    class IntegrationTests {
        constructor(options = {}) {
            this.tests = [];
            this.defaultTimeout = options.defaultTimeout || 8000;
        }

        register(name, handler, metadata = {}) {
            this.tests.push({
                name,
                handler,
                metadata
            });
        }

        async run({ context = {}, agents = [] } = {}) {
            const results = [];
            let passed = 0;
            let failed = 0;

            for (const test of this.tests) {
                const start = performance.now();
                let status = 'passed';
                let error = null;

                try {
                    await this.runWithTimeout(
                        Promise.resolve(test.handler({ context, agents })),
                        this.defaultTimeout
                    );
                } catch (err) {
                    status = 'failed';
                    error = {
                        message: err.message,
                        stack: err.stack
                    };
                }

                const duration = performance.now() - start;
                results.push({
                    name: test.name,
                    status,
                    duration,
                    metadata: test.metadata,
                    error
                });

                if (status === 'passed') {
                    passed += 1;
                } else {
                    failed += 1;
                }
            }

            return {
                summary: {
                    total: this.tests.length,
                    passed,
                    failed
                },
                results
            };
        }

        runWithTimeout(promise, timeout) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`Integration test timed out after ${timeout}ms`));
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

    window.IntegrationTests = IntegrationTests;
    console.log('✅ IntegrationTests 로드 완료');
})();
