/**
 * EconomicAlertCenter - 경제 지표 알림 센터
 *
 * 경제 지표의 임계값 초과 및 중요 이벤트 알림
 *
 * 알림 유형:
 * - 위험 (Danger): 즉시 주의 필요
 * - 경고 (Warning): 모니터링 필요
 * - 정보 (Info): 참고 사항
 *
 * 기능:
 * - 실시간 알림 표시
 * - 알림 우선순위 정렬
 * - 알림 히스토리 관리
 * - 필터링 및 검색
 * - 알림 확인 및 삭제
 *
 * @class EconomicAlertCenter
 */

export default class EconomicAlertCenter {
    constructor(config = {}) {
        const { eventSystem, theme = 'dark' } = config;

        this.eventSystem = eventSystem;
        this.theme = theme;

        // 알림 목록
        this.alerts = []; // { id, type, title, message, timestamp, read }

        // 알림 유형 우선순위
        this.alertPriority = {
            danger: 1,
            warning: 2,
            info: 3
        };

        // 필터 상태
        this.filter = 'all'; // 'all' | 'danger' | 'warning' | 'info' | 'unread'

        // 최대 알림 수 (메모리 관리)
        this.maxAlerts = 100;

        console.log('✅ EconomicAlertCenter 생성됨');
    }

    /**
     * 렌더링
     */
    render() {
        const container = document.createElement('div');
        container.className = 'alert-center-container';

        // 헤더
        const header = document.createElement('div');
        header.className = 'widget-header';
        header.innerHTML = `
            <h3 class="widget-title">🔔 Economic Alerts</h3>
            <span class="widget-subtitle">경제 지표 알림 센터</span>
        `;
        container.appendChild(header);

        // 통계 및 필터
        const controls = document.createElement('div');
        controls.className = 'alert-controls';
        controls.id = 'alert-controls';
        controls.innerHTML = this.renderControls();
        container.appendChild(controls);

        // 알림 목록
        const alertList = document.createElement('div');
        alertList.className = 'alert-list';
        alertList.id = 'alert-list';
        alertList.innerHTML = this.renderAlertList();
        container.appendChild(alertList);

        // 이벤트 리스너 설정
        setTimeout(() => this.attachEventListeners(), 0);

        return container;
    }

    /**
     * 컨트롤 렌더링
     */
    renderControls() {
        const unreadCount = this.alerts.filter(a => !a.read).length;
        const dangerCount = this.alerts.filter(a => a.type === 'danger').length;
        const warningCount = this.alerts.filter(a => a.type === 'warning').length;

        return `
            <div class="alert-stats">
                <div class="stat-item">
                    <span class="stat-value">${this.alerts.length}</span>
                    <span class="stat-label">전체</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color: ${this.getThemeColor('danger')}">${dangerCount}</span>
                    <span class="stat-label">위험</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color: ${this.getThemeColor('warning')}">${warningCount}</span>
                    <span class="stat-label">경고</span>
                </div>
                <div class="stat-item ${unreadCount > 0 ? 'unread-badge' : ''}">
                    <span class="stat-value">${unreadCount}</span>
                    <span class="stat-label">미확인</span>
                </div>
            </div>
            <div class="alert-filters">
                <button class="filter-btn ${this.filter === 'all' ? 'active' : ''}" data-filter="all">전체</button>
                <button class="filter-btn ${this.filter === 'danger' ? 'active' : ''}" data-filter="danger">위험</button>
                <button class="filter-btn ${this.filter === 'warning' ? 'active' : ''}" data-filter="warning">경고</button>
                <button class="filter-btn ${this.filter === 'info' ? 'active' : ''}" data-filter="info">정보</button>
                <button class="filter-btn ${this.filter === 'unread' ? 'active' : ''}" data-filter="unread">미확인</button>
                <button class="clear-btn" id="clear-all-btn">전체 삭제</button>
            </div>
        `;
    }

    /**
     * 알림 목록 렌더링
     */
    renderAlertList() {
        const filteredAlerts = this.getFilteredAlerts();

        if (filteredAlerts.length === 0) {
            return '<div class="alert-empty">알림이 없습니다.</div>';
        }

        // 우선순위 정렬 (위험도 높은 순 → 최신순)
        const sortedAlerts = filteredAlerts.sort((a, b) => {
            const priorityDiff = this.alertPriority[a.type] - this.alertPriority[b.type];
            if (priorityDiff !== 0) return priorityDiff;
            return b.timestamp - a.timestamp; // 최신순
        });

        return sortedAlerts.map(alert => this.renderAlertItem(alert)).join('');
    }

    /**
     * 알림 항목 렌더링
     */
    renderAlertItem(alert) {
        const icon = this.getAlertIcon(alert.type);
        const color = this.getThemeColor(alert.type);
        const readClass = alert.read ? 'read' : 'unread';
        const timeAgo = this.getTimeAgo(alert.timestamp);

        return `
            <div class="alert-item ${readClass}" data-alert-id="${alert.id}">
                <div class="alert-icon" style="color: ${color}">${icon}</div>
                <div class="alert-content">
                    <div class="alert-header">
                        <span class="alert-title">${alert.title}</span>
                        <span class="alert-time">${timeAgo}</span>
                    </div>
                    <div class="alert-message">${alert.message}</div>
                    <div class="alert-type-badge" style="background-color: ${this.hexToRgba(color, 0.2)}; color: ${color}">
                        ${this.getAlertTypeLabel(alert.type)}
                    </div>
                </div>
                <div class="alert-actions">
                    <button class="alert-action-btn mark-read-btn" title="읽음 표시">✓</button>
                    <button class="alert-action-btn delete-btn" title="삭제">✕</button>
                </div>
            </div>
        `;
    }

    /**
     * 이벤트 리스너 설정
     */
    attachEventListeners() {
        // 필터 버튼
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.filter = e.target.dataset.filter;
                this.refreshUI();
            });
        });

        // 전체 삭제
        const clearAllBtn = document.getElementById('clear-all-btn');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                if (confirm('모든 알림을 삭제하시겠습니까?')) {
                    this.clearAllAlerts();
                }
            });
        }

        // 알림 항목 클릭 이벤트 (읽음 표시, 삭제)
        document.querySelectorAll('.alert-item').forEach(item => {
            const alertId = item.dataset.alertId;

            // 읽음 표시
            const markReadBtn = item.querySelector('.mark-read-btn');
            if (markReadBtn) {
                markReadBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.markAsRead(alertId);
                });
            }

            // 삭제
            const deleteBtn = item.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteAlert(alertId);
                });
            }

            // 항목 클릭 시 읽음 표시
            item.addEventListener('click', () => {
                this.markAsRead(alertId);
            });
        });

        // 이벤트 구독
        if (this.eventSystem) {
            this.eventSystem.on('economic:risk:changed', (event) => {
                this.handleRiskChange(event.payload);
            });

            this.eventSystem.on('economic:alert:new', (event) => {
                this.addAlert(event.payload);
            });
        }
    }

    /**
     * 위험도 변경 처리
     */
    handleRiskChange(payload) {
        const { level, tedSpread } = payload;

        let alertType = 'info';
        let title = '';
        let message = '';

        if (level === 'danger') {
            alertType = 'danger';
            title = '⚠️ 금융 스트레스 위험 수준';
            message = `TED Spread가 ${tedSpread.toFixed(2)} bps로 위험 임계값을 초과했습니다. 즉시 모니터링이 필요합니다.`;
        } else if (level === 'warning') {
            alertType = 'warning';
            title = '⚠️ 금융 스트레스 주의';
            message = `TED Spread가 ${tedSpread.toFixed(2)} bps로 주의 임계값을 초과했습니다.`;
        } else {
            alertType = 'info';
            title = '✓ 금융 스트레스 안정';
            message = `TED Spread가 ${tedSpread.toFixed(2)} bps로 안정 수준입니다.`;
        }

        this.addAlert({ type: alertType, title, message });
    }

    /**
     * 알림 추가
     * @param {Object} alertData - { type, title, message }
     */
    addAlert(alertData) {
        const alert = {
            id: this.generateAlertId(),
            type: alertData.type || 'info',
            title: alertData.title,
            message: alertData.message,
            timestamp: Date.now(),
            read: false
        };

        this.alerts.unshift(alert); // 최신 알림을 앞에 추가

        // 최대 알림 수 제한
        if (this.alerts.length > this.maxAlerts) {
            this.alerts = this.alerts.slice(0, this.maxAlerts);
        }

        this.refreshUI();

        console.log(`✅ 새 알림 추가: ${alert.title}`);
    }

    /**
     * 읽음 표시
     */
    markAsRead(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.read = true;
            this.refreshUI();
        }
    }

    /**
     * 알림 삭제
     */
    deleteAlert(alertId) {
        this.alerts = this.alerts.filter(a => a.id !== alertId);
        this.refreshUI();
    }

    /**
     * 모든 알림 삭제
     */
    clearAllAlerts() {
        this.alerts = [];
        this.refreshUI();
    }

    /**
     * UI 새로고침
     */
    refreshUI() {
        const controls = document.getElementById('alert-controls');
        if (controls) {
            controls.innerHTML = this.renderControls();
        }

        const alertList = document.getElementById('alert-list');
        if (alertList) {
            alertList.innerHTML = this.renderAlertList();
        }

        this.attachEventListeners();
    }

    /**
     * 필터링된 알림 가져오기
     */
    getFilteredAlerts() {
        if (this.filter === 'all') {
            return this.alerts;
        } else if (this.filter === 'unread') {
            return this.alerts.filter(a => !a.read);
        } else {
            return this.alerts.filter(a => a.type === this.filter);
        }
    }

    /**
     * 알림 ID 생성
     */
    generateAlertId() {
        return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 알림 아이콘
     */
    getAlertIcon(type) {
        const icons = {
            danger: '🚨',
            warning: '⚠️',
            info: 'ℹ️'
        };
        return icons[type] || icons.info;
    }

    /**
     * 알림 유형 라벨
     */
    getAlertTypeLabel(type) {
        const labels = {
            danger: '위험',
            warning: '경고',
            info: '정보'
        };
        return labels[type] || labels.info;
    }

    /**
     * 시간 경과 표시
     */
    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}일 전`;
        if (hours > 0) return `${hours}시간 전`;
        if (minutes > 0) return `${minutes}분 전`;
        return `방금`;
    }

    /**
     * 테마 색상 가져오기
     */
    getThemeColor(type) {
        const colors = {
            light: {
                danger: '#ef4444',
                warning: '#f59e0b',
                info: '#3b82f6',
                text: '#1f2937',
                background: '#f9fafb'
            },
            dark: {
                danger: '#f87171',
                warning: '#fbbf24',
                info: '#60a5fa',
                text: '#f3f4f6',
                background: '#1f2937'
            }
        };

        return colors[this.theme]?.[type] || colors.dark[type];
    }

    /**
     * Hex to RGBA 변환
     */
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * 테마 변경
     */
    setTheme(newTheme) {
        this.theme = newTheme;
        this.refreshUI();
    }

    /**
     * 컴포넌트 파괴
     */
    destroy() {
        this.alerts = [];
        console.log('✅ EconomicAlertCenter 파괴됨');
    }
}
