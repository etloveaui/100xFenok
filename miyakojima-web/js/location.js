// 미야코지마 웹 플랫폼 - GPS 위치 추적 모듈
// Miyakojima Web Platform - GPS Location Tracking Module

/**
 * 위치 관리 클래스
 */
class LocationManager {
    constructor() {
        this.currentLocation = null;
        this.watchId = null;
        this.locationHistory = [];
        this.isTracking = false;
        this.lastUpdateTime = 0;
        this.accuracy = null;
        
        // 미야코지마 중심점
        this.centerPoint = CONFIG.LOCATION.CENTER;
        this.bounds = CONFIG.LOCATION.BOUNDS;
        
        // 위치 업데이트 콜백들
        this.callbacks = [];
        
        this.init();
    }
    
    async init() {
        Logger.info('위치 관리자 초기화 중...');
        
        // 저장된 위치 기록 로드
        this.loadLocationHistory();
        
        // 위치 서비스 권한 확인
        await this.checkLocationPermission();
        
        // 초기 위치 가져오기
        await this.getCurrentLocation();
        
        // UI 이벤트 리스너 설정
        this.setupEventListeners();
        
        // 자동 위치 추적 시작 (여행 기간 중인 경우)
        if (DateUtils.isInTripPeriod()) {
            await this.startLocationTracking();
        }
        
        Logger.info('위치 관리자 초기화 완료');
    }
    
    /**
     * 위치 서비스 권한 확인
     */
    async checkLocationPermission() {
        if (!('geolocation' in navigator)) {
            throw new Error('이 기기는 위치 서비스를 지원하지 않습니다.');
        }
        
        if ('permissions' in navigator) {
            try {
                const permission = await navigator.permissions.query({ name: 'geolocation' });
                Logger.info('위치 권한 상태:', permission.state);
                
                // 권한 상태 변경 감지
                permission.addEventListener('change', () => {
                    Logger.info('위치 권한 상태 변경됨:', permission.state);
                    if (permission.state === 'granted' && !this.isTracking) {
                        this.startLocationTracking();
                    } else if (permission.state === 'denied') {
                        this.stopLocationTracking();
                    }
                });
                
                return permission.state;
            } catch (error) {
                Logger.warn('권한 확인 실패:', error);
                return 'unknown';
            }
        }
        
        return 'unknown';
    }
    
    /**
     * 현재 위치 한 번 가져오기
     */
    async getCurrentLocation(highAccuracy = true) {
        return new Promise((resolve, reject) => {
            // 개발 모드에서 모킹된 위치 사용
            if (CONFIG.DEBUG.MOCK_GPS && CONFIG.DEBUG.ENABLED) {
                const mockLocation = {
                    lat: this.centerPoint.lat + (Math.random() - 0.5) * 0.01,
                    lng: this.centerPoint.lng + (Math.random() - 0.5) * 0.01,
                    accuracy: 10,
                    timestamp: Date.now(),
                    isMocked: true
                };
                
                this.updateLocation(mockLocation);
                resolve(mockLocation);
                return;
            }
            
            const options = {
                enableHighAccuracy: highAccuracy,
                timeout: highAccuracy ? 15000 : 10000,
                maximumAge: highAccuracy ? 30000 : 60000
            };
            
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const location = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        heading: position.coords.heading,
                        speed: position.coords.speed,
                        timestamp: position.timestamp,
                        altitude: position.coords.altitude
                    };
                    
                    // 미야코지마 경계 확인
                    if (!LocationUtils.isInMiyakojima(location.lat, location.lng)) {
                        Logger.warn('미야코지마 경계 밖의 위치입니다:', location);
                    }
                    
                    await this.updateLocation(location);
                    resolve(location);
                },
                (error) => {
                    Logger.error('위치 가져오기 실패:', error);
                    this.handleLocationError(error);
                    reject(error);
                },
                options
            );
        });
    }
    
    /**
     * 위치 추적 시작
     */
    async startLocationTracking() {
        if (this.isTracking) {
            Logger.info('이미 위치 추적이 진행 중입니다.');
            return;
        }
        
        Logger.info('위치 추적을 시작합니다...');
        
        const options = CONFIG.BROWSER_APIS.GEOLOCATION;
        
        this.watchId = navigator.geolocation.watchPosition(
            async (position) => {
                const location = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    heading: position.coords.heading,
                    speed: position.coords.speed,
                    timestamp: position.timestamp,
                    altitude: position.coords.altitude
                };
                
                // 위치 업데이트 빈도 제한 (30초 간격 또는 100m 이상 이동시)
                const timeDiff = Date.now() - this.lastUpdateTime;
                const distanceDiff = this.currentLocation ? 
                    LocationUtils.calculateDistance(
                        this.currentLocation.lat, this.currentLocation.lng,
                        location.lat, location.lng
                    ) : Infinity;
                
                if (timeDiff > 30000 || distanceDiff > 100) {
                    await this.updateLocation(location);
                }
            },
            (error) => {
                Logger.error('위치 추적 오류:', error);
                this.handleLocationError(error);
            },
            options
        );
        
        this.isTracking = true;
        this.updateLocationButton('tracking');
        
        Logger.info('위치 추적이 시작되었습니다.');
    }
    
    /**
     * 위치 추적 중지
     */
    stopLocationTracking() {
        if (!this.isTracking) return;
        
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        
        this.isTracking = false;
        this.updateLocationButton('stopped');
        
        Logger.info('위치 추적이 중지되었습니다.');
    }
    
    /**
     * 위치 업데이트 처리
     */
    async updateLocation(location) {
        this.currentLocation = location;
        this.lastUpdateTime = Date.now();
        this.accuracy = location.accuracy;
        
        // 위치 기록에 추가
        this.addToLocationHistory(location);
        
        // 주소 변환 시도
        try {
            if (NetworkUtils.isOnline() && !location.isMocked && window.geocodingAPI) {
                const addressInfo = await window.geocodingAPI.getAddressFromCoords(location.lat, location.lng);
                location.address = addressInfo.formatted;
                location.addressComponents = addressInfo.components;
            }
        } catch (error) {
            Logger.warn('주소 변환 실패:', error);
        }
        
        // UI 업데이트
        this.updateLocationUI(location);
        
        // 등록된 콜백들 실행
        this.notifyLocationCallbacks(location);
        
        // 백엔드에 위치 정보 전송 (5분마다)
        const timeSinceLastSync = Date.now() - (this.lastSyncTime || 0);
        if (timeSinceLastSync > 5 * 60 * 1000) {
            this.syncLocationToBackend(location);
        }
        
        Logger.info('위치 업데이트됨:', {
            lat: location.lat.toFixed(6),
            lng: location.lng.toFixed(6),
            accuracy: location.accuracy + 'm',
            address: location.address?.substring(0, 30) + '...'
        });
    }
    
    /**
     * 위치 기록 추가
     */
    addToLocationHistory(location) {
        const historyEntry = {
            ...location,
            id: 'loc_' + Date.now()
        };
        
        this.locationHistory.push(historyEntry);
        
        // 최근 100개 위치만 유지
        if (this.locationHistory.length > 100) {
            this.locationHistory = this.locationHistory.slice(-100);
        }
        
        // 로컬 저장소에 저장
        const expiration = Date.now() + CONFIG.STORAGE.CACHE_DURATION.LOCATION;
        StorageUtils.set(CONFIG.STORAGE.CACHE_KEYS.LOCATION_HISTORY, this.locationHistory, expiration);
    }
    
    /**
     * 위치 기록 로드
     */
    loadLocationHistory() {
        const history = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.LOCATION_HISTORY);
        if (history && Array.isArray(history)) {
            this.locationHistory = history;
            Logger.info('위치 기록 로드됨:', this.locationHistory.length + '개');
        }
    }
    
    /**
     * 위치 UI 업데이트
     */
    updateLocationUI(location) {
        // 현재 위치 표시 업데이트
        const locationElement = DOMUtils.$('#current-location');
        const detailElement = DOMUtils.$('#location-detail');
        
        if (locationElement) {
            if (location.address) {
                locationElement.textContent = location.address;
            } else {
                locationElement.textContent = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
            }
        }
        
        if (detailElement) {
            let detail = '';
            
            if (location.accuracy) {
                detail += `정확도: ${Math.round(location.accuracy)}m`;
            }
            
            if (location.isMocked) {
                detail += ' (개발 모드)';
            }
            
            if (location.speed && location.speed > 1) {
                detail += ` • 속도: ${Math.round(location.speed * 3.6)}km/h`;
            }
            
            detailElement.textContent = detail || '위치 정보 업데이트됨';
        }
        
        // 위치 정확도에 따른 스타일 적용
        const locationCard = DOMUtils.$('.location-card');
        if (locationCard) {
            locationCard.classList.remove('accuracy-good', 'accuracy-fair', 'accuracy-poor');
            
            if (location.accuracy <= 10) {
                locationCard.classList.add('accuracy-good');
            } else if (location.accuracy <= 50) {
                locationCard.classList.add('accuracy-fair');
            } else {
                locationCard.classList.add('accuracy-poor');
            }
        }
    }
    
    /**
     * 위치 버튼 상태 업데이트
     */
    updateLocationButton(state) {
        const refreshButton = DOMUtils.$('#refresh-location');
        if (!refreshButton) return;
        
        switch (state) {
            case 'tracking':
                refreshButton.innerHTML = '<svg class="icon"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path></svg>';
                refreshButton.title = '위치 추적 중';
                refreshButton.style.color = 'var(--success-color)';
                break;
                
            case 'updating':
                refreshButton.innerHTML = '<svg class="icon rotating"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path></svg>';
                refreshButton.title = '위치 업데이트 중...';
                refreshButton.disabled = true;
                break;
                
            case 'stopped':
            default:
                refreshButton.innerHTML = '<svg class="icon"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
                refreshButton.title = '위치 새로고침';
                refreshButton.style.color = '';
                refreshButton.disabled = false;
                break;
        }
    }
    
    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 위치 새로고침 버튼
        const refreshButton = DOMUtils.$('#refresh-location');
        if (refreshButton) {
            refreshButton.addEventListener('click', async () => {
                this.updateLocationButton('updating');
                try {
                    await this.getCurrentLocation(true);
                    this.showToast('위치가 업데이트되었습니다.', 'success');
                } catch (error) {
                    this.showToast('위치 업데이트에 실패했습니다.', 'error');
                } finally {
                    this.updateLocationButton(this.isTracking ? 'tracking' : 'stopped');
                }
            });
        }
        
        // 주변 장소 버튼
        const nearbyButton = DOMUtils.$('#nearby-pois');
        if (nearbyButton) {
            nearbyButton.addEventListener('click', () => {
                if (this.currentLocation) {
                    this.findNearbyPOIs();
                } else {
                    this.showToast('먼저 위치를 확인해주세요.', 'warning');
                }
            });
        }
        
        // 길찾기 버튼
        const navigationButton = DOMUtils.$('#start-navigation');
        if (navigationButton) {
            navigationButton.addEventListener('click', () => {
                this.startNavigation();
            });
        }
        
        Logger.log('위치 이벤트 리스너 설정 완료');
    }
    
    /**
     * 주변 POI 찾기
     */
    async findNearbyPOIs() {
        if (!this.currentLocation) {
            this.showToast('현재 위치를 확인할 수 없습니다.', 'error');
            return;
        }
        
        try {
            // POI 관리자가 있다면 호출
            if (window.poiManager) {
                await window.poiManager.searchNearbyPOIs(
                    this.currentLocation.lat,
                    this.currentLocation.lng
                );
                
                // POI 섹션으로 이동
                const poiSection = DOMUtils.$('#poi-section');
                if (poiSection && window.app) {
                    window.app.navigateToSection('poi');
                }
                
                this.showToast('주변 장소를 찾았습니다.', 'success');
            } else {
                Logger.warn('POI 관리자가 아직 초기화되지 않았습니다.');
                this.showToast('POI 시스템을 로딩 중입니다...', 'info');
            }
            
        } catch (error) {
            Logger.error('주변 POI 검색 실패:', error);
            this.showToast('주변 장소 검색에 실패했습니다.', 'error');
        }
    }
    
    /**
     * 길찾기 시작
     */
    startNavigation() {
        if (!this.currentLocation) {
            this.showToast('현재 위치를 확인할 수 없습니다.', 'error');
            return;
        }
        
        // 다음 목적지 정보 가져오기
        const destinationName = DOMUtils.$('#next-destination-name')?.textContent;
        
        if (!destinationName) {
            this.showToast('목적지가 설정되지 않았습니다.', 'warning');
            return;
        }
        
        // Google Maps 길찾기 URL 생성
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${this.currentLocation.lat},${this.currentLocation.lng}&destination=${encodeURIComponent(destinationName)}&travelmode=driving`;
        
        // 새 탭에서 Google Maps 열기
        window.open(mapsUrl, '_blank');
        
        this.showToast('Google Maps에서 길찾기를 시작합니다.', 'success');
    }
    
    /**
     * 위치 콜백 등록
     */
    onLocationUpdate(callback) {
        if (typeof callback === 'function') {
            this.callbacks.push(callback);
        }
    }
    
    /**
     * 위치 콜백 제거
     */
    removeLocationCallback(callback) {
        const index = this.callbacks.indexOf(callback);
        if (index > -1) {
            this.callbacks.splice(index, 1);
        }
    }
    
    /**
     * 위치 콜백들에게 알림
     */
    notifyLocationCallbacks(location) {
        this.callbacks.forEach(callback => {
            try {
                callback(location);
            } catch (error) {
                Logger.error('위치 콜백 실행 오류:', error);
            }
        });
    }
    
    /**
     * 백엔드에 위치 동기화
     */
    async syncLocationToBackend(location) {
        try {
            if (NetworkUtils.isOnline() && window.backendAPI) {
                const locationData = {
                    lat: location.lat,
                    lng: location.lng,
                    accuracy: location.accuracy,
                    timestamp: location.timestamp,
                    address: location.address,
                    trip_day: DateUtils.getTripDay()
                };
                
                await window.backendAPI.request('update_location', locationData);
                this.lastSyncTime = Date.now();
                Logger.info('위치 정보 백엔드 동기화 완료');
            }
        } catch (error) {
            Logger.warn('위치 백엔드 동기화 실패:', error);
        }
    }
    
    /**
     * 위치 오류 처리
     */
    handleLocationError(error) {
        let message = '위치 서비스 오류가 발생했습니다.';
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = '위치 접근 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.';
                break;
                
            case error.POSITION_UNAVAILABLE:
                message = '위치 정보를 가져올 수 없습니다. GPS 신호를 확인해주세요.';
                break;
                
            case error.TIMEOUT:
                message = '위치 확인 시간이 초과되었습니다. 다시 시도해주세요.';
                break;
        }
        
        this.showToast(message, 'error');
        
        // UI 업데이트
        const locationElement = DOMUtils.$('#current-location');
        const detailElement = DOMUtils.$('#location-detail');
        
        if (locationElement) {
            locationElement.textContent = '위치 확인 불가';
        }
        
        if (detailElement) {
            detailElement.textContent = message;
        }
    }
    
    /**
     * 거리 계산
     */
    calculateDistance(targetLat, targetLng) {
        if (!this.currentLocation) return null;
        
        return LocationUtils.calculateDistance(
            this.currentLocation.lat,
            this.currentLocation.lng,
            targetLat,
            targetLng
        );
    }
    
    /**
     * 이동 시간 추정
     */
    estimateTravelTime(targetLat, targetLng, mode = 'car') {
        const distance = this.calculateDistance(targetLat, targetLng);
        if (!distance) return null;
        
        return LocationUtils.estimateTravelTime(distance, mode);
    }
    
    /**
     * 현재 위치 정보 반환 (다른 모듈에서 사용)
     */
    getCurrentLocationData() {
        return Promise.resolve({
            location: this.currentLocation,
            isTracking: this.isTracking,
            accuracy: this.accuracy,
            history: this.locationHistory.slice(-10), // 최근 10개만
            lastUpdate: this.lastUpdateTime
        });
    }
    
    /**
     * 현재 위치 정보 반환 (기존 호환성)
     */
    getCurrentLocationInfo() {
        return {
            location: this.currentLocation,
            isTracking: this.isTracking,
            accuracy: this.accuracy,
            history: this.locationHistory.slice(-10), // 최근 10개만
            lastUpdate: this.lastUpdateTime
        };
    }
    
    /**
     * 위치 기반 추천 업데이트
     */
    async updateLocationBasedRecommendations() {
        if (!this.currentLocation) return;
        
        try {
            // 추천 시스템이 준비되면 호출
            if (window.poiManager) {
                const recommendations = await window.poiManager.getLocationBasedRecommendations(
                    this.currentLocation.lat,
                    this.currentLocation.lng
                );
                
                this.updateRecommendationsUI(recommendations);
            }
        } catch (error) {
            Logger.error('위치 기반 추천 업데이트 실패:', error);
        }
    }
    
    /**
     * 추천 UI 업데이트
     */
    updateRecommendationsUI(recommendations) {
        const container = DOMUtils.$('#recommendations-list');
        if (!container || !recommendations.length) return;
        
        container.innerHTML = '';
        
        recommendations.slice(0, 3).forEach(rec => {
            const distance = this.calculateDistance(rec.coordinates.lat, rec.coordinates.lng);
            const recElement = DOMUtils.createElement('div', 'recommendation-item', `
                <div class="rec-icon">${rec.icon || '📍'}</div>
                <div class="rec-content">
                    <h5>${rec.name}</h5>
                    <p>${rec.description || rec.category}</p>
                </div>
                <span class="rec-distance">${LocationUtils.formatDistance(distance)}</span>
            `);
            
            // 클릭 이벤트 추가
            recElement.addEventListener('click', () => {
                if (window.poiManager) {
                    window.poiManager.showPOIDetail(rec.id);
                }
            });
            
            container.appendChild(recElement);
        });
    }
    
    /**
     * 토스트 알림 표시
     */
    showToast(message, type = 'info') {
        const container = DOMUtils.$('#toast-container');
        if (!container) return;
        
        const toast = DOMUtils.createElement('div', `toast ${type}`, `
            <span>${message}</span>
        `);
        
        container.appendChild(toast);
        
        // 애니메이션
        setTimeout(() => toast.classList.add('show'), 100);
        
        // 자동 제거
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 300);
        }, CONFIG.UI.TOAST_DURATION);
    }
}

// CSS 추가 (회전 애니메이션)
const locationStyle = document.createElement('style');
locationStyle.textContent = `
    .rotating {
        animation: rotate 2s linear infinite;
    }
    
    @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    
    .accuracy-good .card-header {
        border-left-color: var(--success-color);
    }
    
    .accuracy-fair .card-header {
        border-left-color: var(--warning-color);
    }
    
    .accuracy-poor .card-header {
        border-left-color: var(--error-color);
    }
`;
document.head.appendChild(locationStyle);

// 전역 접근을 위한 인스턴스 생성
window.locationManager = null;
window.LocationTracker = LocationManager; // 별칭

// 모듈 상태 관리
window.LocationStatus = {
    isReady: false,
    init: async () => {
        window.locationManager = new LocationManager();
        window.LocationStatus.isReady = true;
        
        // 모듈 초기화 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'location' }
        }));
        
        Logger.info('위치 관리자 초기화 완료');
    }
};

// 중앙 초기화 시스템에 의해 호출됨 (DOMContentLoaded 제거)
// document.addEventListener('DOMContentLoaded', () => {
//     window.locationManager = new LocationManager();
// });

Logger.info('GPS 위치 추적 모듈 로드 완료');