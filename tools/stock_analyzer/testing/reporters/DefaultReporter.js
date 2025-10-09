/**
 * DefaultReporter - 콘솔 기반 기본 리포터
 */
(function () {
    class DefaultReporter {
        report(results) {
            console.group('🤝 Collaborative Test Report');
            console.info('Timestamp:', results.timestamp);

            results.agents.forEach(agent => {
                console.group(`Agent ${agent.agentId}`);
                agent.modules.forEach(module => {
                    console.group(`Module ${module.module}`);
                    console.info('Summary:', module.summary);
                    module.results.forEach(test => {
                        if (test.status === 'passed') {
                            console.log(`✅ ${test.testName} (${test.duration.toFixed(1)}ms)`);
                        } else {
                            console.error(`❌ ${test.testName} (${test.duration.toFixed(1)}ms)`, test.error);
                        }
                    });
                    console.groupEnd();
                });
                console.groupEnd();
            });

            if (results.integration) {
                console.group('🔗 Integration Tests');
                console.info('Summary:', results.integration.summary);
                results.integration.results.forEach(test => {
                    if (test.status === 'passed') {
                        console.log(`✅ ${test.name} (${test.duration.toFixed(1)}ms)`);
                    } else {
                        console.error(`❌ ${test.name} (${test.duration.toFixed(1)}ms)`, test.error);
                    }
                });
                console.groupEnd();
            }

            if (results.performance.length) {
                console.group('⚡ Performance Hooks');
                results.performance.forEach(item => console.info(item));
                console.groupEnd();
            }

            if (results.regression.length) {
                console.group('🛡️ Regression Hooks');
                results.regression.forEach(item => console.info(item));
                console.groupEnd();
            }

            if (results.errors.length) {
                console.group('🚨 Errors');
                results.errors.forEach(error => console.error(`[${error.phase}] ${error.message}`, error.stack));
                console.groupEnd();
            }

            console.groupEnd();
        }
    }

    window.DefaultTestReporter = DefaultReporter;
    console.log('✅ DefaultTestReporter 로드 완료');
})();
