// js/services/location.js - 위치 추적 서비스

class LocationService {
    constructor() {
        this.currentLocation = null;
        this.watchId = null;
        this.subscribers = [];
        this.isTracking = false;
        this.lastUpdate = null;
        this.accuracy = null;

        // 설정
        this.options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
            updateInterval: 5000 // 5초마다 업데이트
        };

        // 미야코지마 기본 위치
        this.defaultLocation = {
            lat: 24.7392,
            lng: 125.2814,
            name: '미야코지마 중심부'
        };
    }

    /**
     * 위치 추적 시작
     */
    startTracking() {
        if (this.isTracking) {
            console.log('✅ 이미 위치 추적 중입니다');
            return;
        }

        if (!navigator.geolocation) {
            console.error('❌ Geolocation API를 지원하지 않는 브라우저입니다');
            this.notifySubscribers('error', 'Geolocation API not supported');
            return;
        }

        console.log('🎯 위치 추적 시작...');

        // 초기 위치 가져오기
        this.getCurrentPosition();

        // 위치 변경 감지 시작
        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.handlePositionUpdate(position),
            (error) => this.handlePositionError(error),
            this.options
        );

        this.isTracking = true;
        console.log('✅ 위치 추적 활성화됨');
    }

    /**
     * 위치 추적 중지
     */
    stopTracking() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        this.isTracking = false;
        console.log('⏹️ 위치 추적 중지됨');
    }

    /**
     * 현재 위치 한 번만 가져오기
     */
    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation API not supported'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const location = this.processPosition(position);
                    resolve(location);
                },
                (error) => {
                    console.warn('위치 정보 획득 실패, 기본 위치 사용:', error.message);
                    resolve(this.defaultLocation);
                },
                this.options
            );
        });
    }

    /**
     * 위치 업데이트 처리
     */
    handlePositionUpdate(position) {
        const location = this.processPosition(position);

        // 이전 위치와의 거리 계산
        if (this.currentLocation) {
            const distance = this.calculateDistance(
                this.currentLocation.lat, this.currentLocation.lng,
                location.lat, location.lng
            );

            // 10미터 이상 이동했을 때만 업데이트
            if (distance < 0.01) {
                return;
            }
        }

        this.currentLocation = location;
        this.lastUpdate = new Date();

        console.log('📍 위치 업데이트:', location);

        // 구독자들에게 알림
        this.notifySubscribers('update', location);

        // 지도 업데이트
        this.updateMapLocation(location);
    }

    /**
     * 위치 정보 처리
     */
    processPosition(position) {
        return {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: position.timestamp
        };
    }

    /**
     * 위치 오류 처리
     */
    handlePositionError(error) {
        let message = '';

        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = '위치 정보 사용 권한이 거부되었습니다';
                break;
            case error.POSITION_UNAVAILABLE:
                message = '위치 정보를 사용할 수 없습니다';
                break;
            case error.TIMEOUT:
                message = '위치 정보 요청 시간이 초과되었습니다';
                break;
            default:
                message = '알 수 없는 오류가 발생했습니다';
        }

        console.error('❌ 위치 오류:', message);
        this.notifySubscribers('error', { error, message });

        // 기본 위치 사용
        this.currentLocation = this.defaultLocation;
    }

    /**
     * 지도에 현재 위치 업데이트
     */
    updateMapLocation(location) {
        // GoogleMapsManager가 있으면 위치 업데이트
        if (window.app && window.app.modules.get('maps')) {
            const mapsManager = window.app.modules.get('maps');
            if (mapsManager.updateCurrentLocation) {
                mapsManager.updateCurrentLocation(location);
            }
        }
    }

    /**
     * 위치 변경 구독
     */
    subscribe(callback) {
        if (typeof callback === 'function') {
            this.subscribers.push(callback);

            // 현재 위치가 있으면 즉시 전달
            if (this.currentLocation) {
                callback('update', this.currentLocation);
            }
        }
    }

    /**
     * 구독 해제
     */
    unsubscribe(callback) {
        const index = this.subscribers.indexOf(callback);
        if (index > -1) {
            this.subscribers.splice(index, 1);
        }
    }

    /**
     * 구독자들에게 알림
     */
    notifySubscribers(event, data) {
        this.subscribers.forEach(callback => {
            try {
                callback(event, data);
            } catch (error) {
                console.error('구독자 알림 중 오류:', error);
            }
        });
    }

    /**
     * 두 지점 간 거리 계산 (km)
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // 지구 반지름 (km)
        const dLat = this.toRad(lat2 - lat1);
        const dLng = this.toRad(lng2 - lng1);

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * 도를 라디안으로 변환
     */
    toRad(degree) {
        return degree * (Math.PI / 180);
    }

    /**
     * 현재 위치 정보 가져오기
     */
    getLocation() {
        return this.currentLocation || this.defaultLocation;
    }

    /**
     * 위치 추적 상태 확인
     */
    isLocationTracking() {
        return this.isTracking;
    }

    /**
     * 위치 정확도 가져오기
     */
    getAccuracy() {
        return this.currentLocation ? this.currentLocation.accuracy : null;
    }

    /**
     * 마지막 업데이트 시간
     */
    getLastUpdateTime() {
        return this.lastUpdate;
    }
}

// 싱글톤 인스턴스 생성 및 내보내기
export const locationService = new LocationService();
export default LocationService;