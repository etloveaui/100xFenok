// js/modules/location-ui.js - 위치 권한 및 알림 UI

class LocationUI {
    constructor() {
        this.permissionModal = null;
        this.statusIndicator = null;
        this.initialized = false;
    }

    /**
     * 위치 UI 초기화
     */
    initialize() {
        if (this.initialized) return;

        // 상태 표시기 생성
        this.createStatusIndicator();

        // 위치 권한 확인
        this.checkLocationPermission();

        this.initialized = true;
        console.log('✅ 위치 UI 초기화 완료');
    }

    /**
     * 위치 권한 확인
     */
    async checkLocationPermission() {
        if (!navigator.permissions) {
            // Permissions API를 지원하지 않는 브라우저
            this.requestLocationPermission();
            return;
        }

        try {
            const permission = await navigator.permissions.query({ name: 'geolocation' });

            if (permission.state === 'denied') {
                this.showPermissionDeniedMessage();
            } else if (permission.state === 'prompt') {
                this.showPermissionRequest();
            } else if (permission.state === 'granted') {
                this.updateStatusIndicator('active');
            }

            // 권한 상태 변경 감지
            permission.onchange = () => {
                if (permission.state === 'granted') {
                    this.updateStatusIndicator('active');
                    this.hidePermissionModal();
                } else if (permission.state === 'denied') {
                    this.updateStatusIndicator('denied');
                    this.showPermissionDeniedMessage();
                }
            };
        } catch (error) {
            console.warn('권한 확인 실패:', error);
            this.requestLocationPermission();
        }
    }

    /**
     * 위치 권한 요청 UI 표시
     */
    showPermissionRequest() {
        const modalHTML = `
            <div id="location-permission-modal" class="location-modal">
                <div class="location-modal-content">
                    <div class="location-icon">📍</div>
                    <h3>위치 권한이 필요합니다</h3>
                    <p>현재 위치를 기반으로 다음 기능을 제공합니다:</p>
                    <ul class="permission-features">
                        <li>✅ 가까운 관광지 추천</li>
                        <li>✅ 실시간 길찾기 안내</li>
                        <li>✅ 거리 기반 POI 정렬</li>
                        <li>✅ 현재 위치 날씨 정보</li>
                    </ul>
                    <div class="permission-actions">
                        <button class="btn-primary" onclick="locationUI.requestLocationPermission()">
                            위치 권한 허용
                        </button>
                        <button class="btn-secondary" onclick="locationUI.hidePermissionModal()">
                            나중에
                        </button>
                    </div>
                    <p class="permission-note">
                        💡 위치 정보는 여행 편의를 위해서만 사용되며,<br>
                        서버에 저장되지 않습니다.
                    </p>
                </div>
            </div>
        `;

        // 기존 모달 제거
        this.hidePermissionModal();

        // 새 모달 추가
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.permissionModal = document.getElementById('location-permission-modal');

        // 스타일 추가
        this.addModalStyles();
    }

    /**
     * 권한 거부 메시지 표시
     */
    showPermissionDeniedMessage() {
        const messageHTML = `
            <div id="location-denied-message" class="location-message warning">
                <span class="message-icon">⚠️</span>
                <span class="message-text">
                    위치 권한이 거부되었습니다.
                    브라우저 설정에서 위치 권한을 허용해주세요.
                </span>
                <button class="message-close" onclick="this.parentElement.remove()">✕</button>
            </div>
        `;

        // 메시지가 없을 때만 추가
        if (!document.getElementById('location-denied-message')) {
            document.body.insertAdjacentHTML('beforeend', messageHTML);

            // 10초 후 자동 제거
            setTimeout(() => {
                const message = document.getElementById('location-denied-message');
                if (message) message.remove();
            }, 10000);
        }
    }

    /**
     * 위치 권한 요청
     */
    requestLocationPermission() {
        if (!navigator.geolocation) {
            this.showNotSupported();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✅ 위치 권한 획득 성공');
                this.updateStatusIndicator('active');
                this.hidePermissionModal();
                this.showSuccessMessage();

                // 위치 서비스 시작
                if (window.app && window.app.modules.get('location')) {
                    window.app.modules.get('location').startTracking();
                }
            },
            (error) => {
                console.error('❌ 위치 권한 획득 실패:', error);
                this.updateStatusIndicator('denied');

                if (error.code === error.PERMISSION_DENIED) {
                    this.showPermissionDeniedMessage();
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    }

    /**
     * 성공 메시지 표시
     */
    showSuccessMessage() {
        const messageHTML = `
            <div id="location-success-message" class="location-message success">
                <span class="message-icon">✅</span>
                <span class="message-text">
                    위치 서비스가 활성화되었습니다!
                </span>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', messageHTML);

        // 3초 후 자동 제거
        setTimeout(() => {
            const message = document.getElementById('location-success-message');
            if (message) {
                message.style.animation = 'slideDown 0.3s ease';
                setTimeout(() => message.remove(), 300);
            }
        }, 3000);
    }

    /**
     * 미지원 브라우저 메시지
     */
    showNotSupported() {
        const messageHTML = `
            <div class="location-message error">
                <span class="message-icon">❌</span>
                <span class="message-text">
                    이 브라우저는 위치 서비스를 지원하지 않습니다.
                </span>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', messageHTML);
    }

    /**
     * 상태 표시기 생성
     */
    createStatusIndicator() {
        const indicatorHTML = `
            <div id="location-status" class="location-status" title="위치 서비스 상태">
                <span class="status-icon">📍</span>
                <span class="status-text">위치 확인 중...</span>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', indicatorHTML);
        this.statusIndicator = document.getElementById('location-status');
    }

    /**
     * 상태 표시기 업데이트
     */
    updateStatusIndicator(status) {
        if (!this.statusIndicator) return;

        const statusConfig = {
            active: {
                icon: '📍',
                text: '위치 추적 중',
                className: 'active'
            },
            denied: {
                icon: '🚫',
                text: '위치 권한 없음',
                className: 'denied'
            },
            error: {
                icon: '⚠️',
                text: '위치 오류',
                className: 'error'
            },
            loading: {
                icon: '⏳',
                text: '위치 확인 중...',
                className: 'loading'
            }
        };

        const config = statusConfig[status] || statusConfig.loading;

        this.statusIndicator.querySelector('.status-icon').textContent = config.icon;
        this.statusIndicator.querySelector('.status-text').textContent = config.text;
        this.statusIndicator.className = `location-status ${config.className}`;
    }

    /**
     * 권한 모달 숨기기
     */
    hidePermissionModal() {
        if (this.permissionModal) {
            this.permissionModal.remove();
            this.permissionModal = null;
        }
    }

    /**
     * 모달 스타일 추가
     */
    addModalStyles() {
        if (document.getElementById('location-ui-styles')) return;

        const styles = `
            <style id="location-ui-styles">
                .location-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    animation: fadeIn 0.3s ease;
                }

                .location-modal-content {
                    background: white;
                    border-radius: 16px;
                    padding: 30px;
                    max-width: 400px;
                    width: 90%;
                    text-align: center;
                    animation: slideUp 0.3s ease;
                }

                .location-icon {
                    font-size: 48px;
                    margin-bottom: 20px;
                }

                .permission-features {
                    list-style: none;
                    padding: 0;
                    margin: 20px 0;
                    text-align: left;
                }

                .permission-features li {
                    padding: 8px 0;
                    font-size: 14px;
                }

                .permission-actions {
                    display: flex;
                    gap: 10px;
                    justify-content: center;
                    margin: 20px 0;
                }

                .permission-note {
                    font-size: 12px;
                    color: #666;
                    margin-top: 20px;
                }

                .location-message {
                    position: fixed;
                    top: 80px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: white;
                    padding: 12px 20px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    z-index: 10001;
                    animation: slideDown 0.3s ease;
                }

                .location-message.success {
                    background: #4CAF50;
                    color: white;
                }

                .location-message.warning {
                    background: #FF9800;
                    color: white;
                }

                .location-message.error {
                    background: #f44336;
                    color: white;
                }

                .message-close {
                    background: none;
                    border: none;
                    color: inherit;
                    font-size: 20px;
                    cursor: pointer;
                    margin-left: 10px;
                }

                .location-status {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: white;
                    padding: 8px 16px;
                    border-radius: 20px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    z-index: 1000;
                    transition: all 0.3s ease;
                }

                .location-status.active {
                    background: #4CAF50;
                    color: white;
                }

                .location-status.denied {
                    background: #f44336;
                    color: white;
                }

                .location-status.error {
                    background: #FF9800;
                    color: white;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }

                @keyframes slideDown {
                    from { transform: translate(-50%, -20px); opacity: 0; }
                    to { transform: translate(-50%, 0); opacity: 1; }
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }
}

// 싱글톤 인스턴스 생성 및 내보내기
export const locationUI = new LocationUI();
export default LocationUI;