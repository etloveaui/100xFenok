(function () {
    const STAGE_LABELS = {
        validation: '데이터 검증',
        testing: '테스트 실행',
        staging: '스테이징 배포',
        canary: '카나리 배포',
        production: '프로덕션 전환'
    };

    class DeploymentDashboard {
        constructor() {
            this.root = null;
            this.stageStates = new Map();
            Object.keys(STAGE_LABELS).forEach(stage => {
                this.stageStates.set(stage, { status: 'pending', message: '' });
            });
        }

        render(container) {
            if (!container) return;
            container.innerHTML = this.createMarkup();
            this.root = container;
        }

        createMarkup() {
            return `
                <div class="dashboard-card space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-semibold text-gray-900">🚀 Smart Deployment Dashboard</h3>
                        <span id="deployment-status-pill" class="px-3 py-1 text-xs font-semibold bg-gray-200 text-gray-700 rounded-full">
                            Idle
                        </span>
                    </div>
                    <div id="deployment-stage-list" class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        ${this.renderStages()}
                    </div>
                    <div>
                        <h4 class="text-sm font-semibold text-gray-800 mb-2">실시간 로그</h4>
                        <div id="deployment-log" class="h-40 overflow-y-auto bg-gray-900 text-gray-100 text-xs rounded-md p-3 font-mono"></div>
                    </div>
                    <div>
                        <h4 class="text-sm font-semibold text-gray-800 mb-2">최근 배포 메트릭</h4>
                        <div id="deployment-metrics" class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-600"></div>
                    </div>
                </div>
            `;
        }

        renderStages() {
            return Object.entries(STAGE_LABELS)
                .map(([stage, label]) => {
                    const state = this.stageStates.get(stage) || { status: 'pending' };
                    return `
                        <div class="border border-gray-200 rounded-lg p-3 flex items-center gap-3" data-stage="${stage}">
                            <div class="w-3 h-3 rounded-full ${this.statusColor(state.status)}"></div>
                            <div class="flex-1">
                                <div class="text-sm font-medium text-gray-900">${label}</div>
                                <div class="text-xs text-gray-500 stage-message">${state.message || '대기 중'}</div>
                            </div>
                        </div>
                    `;
                })
                .join('');
        }

        updateStage(stage, status, message = '') {
            this.stageStates.set(stage, { status, message });
            if (!this.root) return;
            const stageEl = this.root.querySelector(`[data-stage="${stage}"]`);
            if (!stageEl) return;
            const indicator = stageEl.querySelector('div.w-3');
            const messageEl = stageEl.querySelector('.stage-message');
            indicator.className = `w-3 h-3 rounded-full ${this.statusColor(status)}`;
            messageEl.textContent = message || this.defaultMessage(status);
        }

        setGlobalStatus(status, message) {
            if (!this.root) return;
            const pill = this.root.querySelector('#deployment-status-pill');
            if (!pill) return;
            pill.textContent = message || status;
            pill.className = `px-3 py-1 text-xs font-semibold rounded-full ${this.statusPill(status)}`;
        }

        appendLog(line) {
            if (!this.root) return;
            const logEl = this.root.querySelector('#deployment-log');
            if (!logEl) return;
            const timestamp = new Date().toISOString();
            logEl.textContent += `[${timestamp}] ${line}\n`;
            logEl.scrollTop = logEl.scrollHeight;
        }

        updateMetrics(entries = {}) {
            if (!this.root) return;
            const metricsEl = this.root.querySelector('#deployment-metrics');
            if (!metricsEl) return;

            metricsEl.innerHTML = Object.entries(entries)
                .map(([key, value]) => `
                    <div class="border border-gray-200 rounded-md p-2">
                        <div class="text-[10px] uppercase text-gray-400">${key}</div>
                        <div class="text-sm font-semibold text-gray-800">${value}</div>
                    </div>
                `)
                .join('');
        }

        resetStages() {
            this.stageStates.forEach((_, stage) => {
                this.stageStates.set(stage, { status: 'pending', message: '' });
                this.updateStage(stage, 'pending');
            });
        }

        statusColor(status) {
            switch (status) {
                case 'success':
                    return 'bg-green-500';
                case 'running':
                    return 'bg-blue-500 animate-pulse';
                case 'failed':
                    return 'bg-red-500';
                default:
                    return 'bg-gray-300';
            }
        }

        statusPill(status) {
            switch (status) {
                case 'success':
                    return 'bg-green-100 text-green-700';
                case 'running':
                    return 'bg-blue-100 text-blue-700';
                case 'failed':
                    return 'bg-red-100 text-red-700';
                default:
                    return 'bg-gray-200 text-gray-700';
            }
        }

        defaultMessage(status) {
            switch (status) {
                case 'running':
                    return '진행 중...';
                case 'success':
                    return '완료';
                case 'failed':
                    return '실패';
                default:
                    return '대기 중';
            }
        }
    }

    window.DeploymentDashboard = DeploymentDashboard;
    console.log('✅ DeploymentDashboard 로드 완료');
})();
