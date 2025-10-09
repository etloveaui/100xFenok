(function () {
    class SmartDeploymentSystem {
        constructor(options = {}) {
            this.canaryDeployment = new window.CanaryDeployment(options.canary);
            this.autoRollback = new window.AutoRollback({
                ...options.rollback,
                onRollback: async (target, reason) => {
                    this.dashboard.appendLog(`🔁 자동 롤백 실행: ${reason}`);
                    if (typeof options.onRollback === 'function') {
                        await options.onRollback(target, reason);
                    }
                }
            });
            this.healthMonitor = new window.HealthMonitor(options.health);
            this.dashboard = new window.DeploymentDashboard();
            this.metrics = {};
            this.activeDeployment = null;
            this.listeners = new Set();

            this.canaryDeployment.on('start', payload => {
                this.dashboard.updateStage('canary', 'running', '카나리 배포 진행 중...');
                this.dashboard.appendLog(`🟡 카나리 배포 시작 (traffic=${(payload.trafficShare * 100).toFixed(1)}%)`);
            });

            this.canaryDeployment.on('failure', report => {
                this.dashboard.updateStage('canary', 'failed', report.issues.join(', '));
            });

            this.canaryDeployment.on('success', report => {
                this.dashboard.updateStage('canary', 'success', '카나리 배포 통과');
                this.dashboard.appendLog('🟢 카나리 배포 통과');
            });
        }

        mountDashboard(container) {
            this.dashboard.render(container);
        }

        startHealthMonitoring() {
            this.healthMonitor.start();
        }

        setupAutoRollback() {
            // Example health check registration
            if (!this.healthMonitor.checks.has('availability')) {
                this.healthMonitor.registerCheck('availability', async () => {
                    const simulatedAvailability = 0.998 + Math.random() * 0.002;
                    if (simulatedAvailability < 0.997) {
                        throw new Error(`Availability degraded: ${(simulatedAvailability * 100).toFixed(2)}%`);
                    }
                    return { availability: simulatedAvailability };
                }, 120_000);
            }

            this.healthMonitor.on('unhealthy', payload => {
                this.dashboard.appendLog(`⚠️ 헬스 체크 실패: ${payload.name} (${payload.result.error})`);
            });
        }

        async deployWeeklyUpdate(csvFile) {
            this._beginDeployment('weekly-update');
            const rollbackPoint = this.autoRollback.register({
                description: 'Weekly data update',
                meta: { type: 'weekly-update', csvName: csvFile?.name || 'unknown' }
            });

            try {
                this.dashboard.setGlobalStatus('running', 'Weekly update in progress');
                this.dashboard.updateStage('validation', 'running');
                const validationResult = await this.validateWeeklyData(csvFile);
                this.dashboard.updateStage('validation', 'success', validationResult.message);

                this.dashboard.updateStage('testing', 'running');
                const testResult = await this.runAutomatedTests();
                if (!testResult.success) {
                    throw new Error('Automated tests failed');
                }
                this.dashboard.updateStage('testing', 'success', '자동 테스트 통과');

                this.dashboard.updateStage('staging', 'running');
                await this.promoteToStaging({ csvFile });
                this.dashboard.updateStage('staging', 'success', '스테이징 배포 완료');

                const canaryResult = await this.canaryDeployment.execute(
                    { type: 'weekly-update', csvFile },
                    { trafficShare: 0.05 }
                );
                if (!canaryResult.success) {
                    throw new Error(`Canary deployment failed: ${canaryResult.evaluation.issues.join(', ')}`);
                }

                this.dashboard.updateStage('production', 'running');
                await this.promoteToProduction({ csvFile, canaryResult });
                this.dashboard.updateStage('production', 'success', '프로덕션 반영 완료');

                this.metrics = {
                    Completed: new Date().toLocaleString(),
                    Duration: this._formatDuration(this.activeDeployment.startTime),
                    'Canary ErrorRate': `${(canaryResult.evaluation.metrics.errorRate * 100).toFixed(2)}%`,
                    'Canary Latency': `${canaryResult.evaluation.metrics.latencyP95}ms`
                };
                this.dashboard.updateMetrics(this.metrics);

                this.dashboard.setGlobalStatus('success', 'Weekly update deployed');
                this._notify('deployment:success', { type: 'weekly-update' });

                return { success: true };
            } catch (error) {
                this.dashboard.updateStage('production', 'failed', error.message);
                this.dashboard.setGlobalStatus('failed', 'Deployment failed');
                this.dashboard.appendLog(`❌ 배포 실패: ${error.message}`);
                await this.autoRollback.trigger(error.message);
                this._notify('deployment:failed', { error, rollbackPoint });
                return { success: false, error };
            } finally {
                this._endDeployment();
            }
        }

        async deployModule(moduleName, agentId, moduleFiles = []) {
            this._beginDeployment(`module-${moduleName}`);
            const rollbackPoint = this.autoRollback.register({
                description: `Module deployment ${moduleName}`,
                meta: { type: 'module', moduleName, agentId, files: moduleFiles }
            });

            try {
                this.dashboard.setGlobalStatus('running', `${moduleName} 배포 중`);
                this.dashboard.updateStage('validation', 'running', '모듈 패키지 검증');
                await this.validateModulePackage(moduleName, moduleFiles);
                this.dashboard.updateStage('validation', 'success', '모듈 패키지 검증 통과');

                this.dashboard.updateStage('testing', 'running', '모듈 전용 테스트 실행');
                const moduleTestResult = await this.runModuleTests(moduleName);
                if (!moduleTestResult.success) {
                    throw new Error(`Module tests failed for ${moduleName}`);
                }
                this.dashboard.updateStage('testing', 'success', '모듈 테스트 통과');

                this.dashboard.updateStage('staging', 'running', '스테이징 배포 중');
                await this.promoteModuleToStaging(moduleName, moduleFiles);
                this.dashboard.updateStage('staging', 'success', '스테이징 배포 완료');

                const canaryResult = await this.canaryDeployment.execute(
                    { type: 'module', moduleName, moduleFiles },
                    { trafficShare: 0.05 }
                );
                if (!canaryResult.success) {
                    throw new Error(`Canary failure for module ${moduleName}`);
                }

                this.dashboard.updateStage('production', 'running');
                await this.promoteModuleToProduction(moduleName, moduleFiles, canaryResult);
                this.dashboard.updateStage('production', 'success', '프로덕션 반영 완료');

                this.dashboard.setGlobalStatus('success', `${moduleName} 배포 완료`);
                this.dashboard.updateMetrics({
                    Module: moduleName,
                    Agent: agentId,
                    Completed: new Date().toLocaleString()
                });

                this._notify('deployment:success', { type: 'module', moduleName, agentId });
                return { success: true };
            } catch (error) {
                this.dashboard.updateStage('production', 'failed', error.message);
                this.dashboard.setGlobalStatus('failed', `${moduleName} 배포 실패`);
                this.dashboard.appendLog(`❌ 모듈 배포 실패(${moduleName}): ${error.message}`);
                await this.autoRollback.trigger(error.message);
                this._notify('deployment:failed', { error, rollbackPoint });
                return { success: false, error };
            } finally {
                this._endDeployment();
            }
        }

        async validateWeeklyData(csvFile) {
            // Placeholder for actual validation logic
            await this._wait(500);
            if (!csvFile) {
                throw new Error('CSV 파일이 제공되지 않았습니다.');
            }
            return { message: '데이터 검증 통과' };
        }

        async runAutomatedTests() {
            if (window.collaborativeTestSuite) {
                const result = await window.collaborativeTestSuite.runAllTests({ trigger: 'deployment' });
                const failedAgents = result.agents.flatMap(agent =>
                    agent.modules.filter(module => module.summary.failed > 0)
                );
                if (failedAgents.length) {
                    return { success: false, result };
                }
            }
            return { success: true };
        }

        async promoteToStaging(payload) {
            await this._wait(600);
            this.dashboard.appendLog('📦 스테이징 환경으로 패키지 반영');
        }

        async promoteToProduction(payload) {
            await this._wait(800);
            this.dashboard.appendLog('🚀 프로덕션으로 승격 완료');
        }

        async validateModulePackage(moduleName, moduleFiles) {
            await this._wait(400);
            if (!moduleFiles.length) {
                throw new Error('모듈 패키지 파일이 비어 있습니다.');
            }
            return true;
        }

        async runModuleTests(moduleName) {
            if (window.collaborativeTestSuite) {
                const result = await window.collaborativeTestSuite.runAllTests({
                    trigger: `module-${moduleName}`
                });
                const failed = result.agents.some(agent =>
                    agent.modules.some(module => module.module === moduleName && module.summary.failed > 0)
                );
                if (failed) {
                    return { success: false, result };
                }
            }
            return { success: true };
        }

        async promoteModuleToStaging(moduleName, moduleFiles) {
            await this._wait(500);
            this.dashboard.appendLog(`📦 ${moduleName} 스테이징 반영`);
        }

        async promoteModuleToProduction(moduleName, moduleFiles, canaryResult) {
            await this._wait(600);
            this.dashboard.appendLog(`🚀 ${moduleName} 프로덕션 반영`);
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
                        console.warn('SmartDeploymentSystem listener error:', error);
                    }
                }
            });
        }

        _beginDeployment(type) {
            this.activeDeployment = {
                type,
                startTime: Date.now()
            };
            this.dashboard.resetStages();
            this.dashboard.appendLog(`🚀 배포 시작 (${type})`);
        }

        _endDeployment() {
            this.activeDeployment = null;
        }

        _formatDuration(startTime) {
            if (!startTime) return '-';
            const elapsed = Date.now() - startTime;
            const seconds = Math.round(elapsed / 1000);
            return `${seconds}s`;
        }

        _wait(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    const smartDeploymentSystem = new SmartDeploymentSystem();
    window.smartDeploymentSystem = smartDeploymentSystem;

    smartDeploymentSystem.setupAutoRollback();
    smartDeploymentSystem.startHealthMonitoring();

    document.addEventListener('DOMContentLoaded', () => {
        const dashboardContainer = document.getElementById('deployment-dashboard');
        if (dashboardContainer) {
            smartDeploymentSystem.mountDashboard(dashboardContainer);
        }
    });

    console.log('✅ SmartDeploymentSystem 로드 완료');
})();
