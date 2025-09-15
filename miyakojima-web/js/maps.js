// 미야코지마 Google Maps 통합 시스템
// Miyakojima Google Maps Integration System

/**
 * Google Maps Manager - 미야코지마 지도 관리 클래스
 */
class GoogleMapsManager {
    constructor() {
        this.map = null;
        this.markers = [];
        this.infoWindow = null;
        this.directionsService = null;
        this.directionsRenderer = null;
        this.placesService = null;
        this.userLocationMarker = null;
        this.watchId = null;
        this.markerCluster = null;

        // API 사용량 추적
        this.apiTracker = new APIUsageTracker();

        // 지도 설정
        this.mapOptions = {
            center: {
                lat: parseFloat(import.meta?.env?.VITE_MAP_CENTER_LAT) || 24.7831,
                lng: parseFloat(import.meta?.env?.VITE_MAP_CENTER_LNG) || 125.2810
            },
            zoom: parseInt(import.meta?.env?.VITE_MAP_DEFAULT_ZOOM) || 12,
            mapTypeId: 'roadmap',
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: true,
            scaleControl: true,
            streetViewControl: false,
            rotateControl: false,
            fullscreenControl: true,
            gestureHandling: 'greedy'
        };

        // POI 카테고리별 아이콘 설정
        this.categoryIcons = {
            nature_views: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="12" fill="#4CAF50" stroke="#fff" stroke-width="2"/>
                        <text x="16" y="20" text-anchor="middle" fill="white" font-size="14">🌅</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(32, 32)
            },
            dining_cafe: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="12" fill="#FF9800" stroke="#fff" stroke-width="2"/>
                        <text x="16" y="20" text-anchor="middle" fill="white" font-size="14">🍽️</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(32, 32)
            },
            shopping: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="12" fill="#9C27B0" stroke="#fff" stroke-width="2"/>
                        <text x="16" y="20" text-anchor="middle" fill="white" font-size="14">🛍️</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(32, 32)
            },
            culture_spots: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="12" fill="#3F51B5" stroke="#fff" stroke-width="2"/>
                        <text x="16" y="20" text-anchor="middle" fill="white" font-size="14">🏛️</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(32, 32)
            },
            marine_activities: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="12" fill="#00BCD4" stroke="#fff" stroke-width="2"/>
                        <text x="16" y="20" text-anchor="middle" fill="white" font-size="14">🏄‍♀️</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(32, 32)
            },
            transportation: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="12" fill="#607D8B" stroke="#fff" stroke-width="2"/>
                        <text x="16" y="20" text-anchor="middle" fill="white" font-size="14">🚗</text>
                    </svg>
                `),
                scaledSize: new google.maps.Size(32, 32)
            }
        };

        // 기본 아이콘
        this.defaultIcon = {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                    <circle cx="16" cy="16" r="12" fill="#2196F3" stroke="#fff" stroke-width="2"/>
                    <text x="16" y="20" text-anchor="middle" fill="white" font-size="14">📍</text>
                </svg>
            `),
            scaledSize: new google.maps.Size(32, 32)
        };
    }

    // Google Maps API 로드 및 초기화
    async init() {
        try {
            Logger.info('Google Maps 초기화 시작');

            // Google Maps API 스크립트 로드
            await this.loadGoogleMapsAPI();

            // 지도 생성
            await this.createMap();

            // 서비스 초기화
            this.initServices();

            // POI 데이터 로드 및 마커 생성
            await this.loadPOIMarkers();

            // 사용자 위치 추적 시작
            this.startLocationTracking();

            Logger.info('Google Maps 초기화 완료');
            return true;

        } catch (error) {
            Logger.error('Google Maps 초기화 실패:', error);
            return false;
        }
    }

    // Google Maps API 동적 로드
    async loadGoogleMapsAPI() {
        return new Promise((resolve, reject) => {
            // 이미 로드됨
            if (window.google && window.google.maps) {
                resolve();
                return;
            }

            // API 키 확인
            const apiKey = import.meta?.env?.VITE_GOOGLE_MAPS_API_KEY;
            if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY') {
                reject(new Error('Google Maps API 키가 설정되지 않았습니다.'));
                return;
            }

            // 스크립트 생성 및 로드
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&callback=initMap`;
            script.async = true;
            script.defer = true;

            // 콜백 함수 등록
            window.initMap = () => {
                delete window.initMap;
                resolve();
            };

            script.onerror = () => {
                delete window.initMap;
                reject(new Error('Google Maps API 로드 실패'));
            };

            document.head.appendChild(script);
        });
    }

    // 지도 생성
    async createMap() {
        const mapContainer = document.getElementById('poi-map');
        if (!mapContainer) {
            throw new Error('지도 컨테이너를 찾을 수 없습니다. (id="poi-map")');
        }

        // API 사용량 체크
        if (!this.apiTracker.canUseAPI('MAPS_JAVASCRIPT')) {
            throw new Error('Google Maps JavaScript API 일일 한도 초과');
        }

        // 지도 생성
        this.map = new google.maps.Map(mapContainer, this.mapOptions);

        // 사용량 기록
        this.apiTracker.recordUsage('MAPS_JAVASCRIPT');

        // 지도 이벤트 리스너
        this.map.addListener('click', (event) => {
            if (this.infoWindow) {
                this.infoWindow.close();
            }
        });

        // 미야코지마 경계 설정
        const miyakojimaBounds = new google.maps.LatLngBounds(
            new google.maps.LatLng(24.65, 125.2),  // 남서
            new google.maps.LatLng(24.8, 125.35)   // 북동
        );

        // 지도 범위 제한
        this.map.setOptions({
            restriction: {
                latLngBounds: miyakojimaBounds,
                strictBounds: false
            }
        });

        Logger.info('지도 생성 완료');
    }

    // 지도 서비스 초기화
    initServices() {
        this.directionsService = new google.maps.DirectionsService();
        this.directionsRenderer = new google.maps.DirectionsRenderer({
            draggable: true,
            panel: document.getElementById('directions-panel')
        });
        this.directionsRenderer.setMap(this.map);

        this.placesService = new google.maps.places.PlacesService(this.map);
        this.infoWindow = new google.maps.InfoWindow();

        Logger.info('지도 서비스 초기화 완료');
    }

    // POI 마커 로드
    async loadPOIMarkers() {
        try {
            Logger.info('POI 마커 로드 시작');

            // POI 데이터 로드
            const response = await fetch('./data/miyakojima_pois.json');
            const poiData = await response.json();

            if (!poiData.pois || !Array.isArray(poiData.pois)) {
                throw new Error('POI 데이터 형식이 올바르지 않습니다.');
            }

            // 기존 마커 정리
            this.clearMarkers();

            // 마커 생성
            poiData.pois.forEach((poi, index) => {
                this.createPOIMarker(poi, index);
            });

            // 마커 클러스터링 적용
            this.initMarkerClustering();

            Logger.info(`POI 마커 ${poiData.pois.length}개 로드 완료`);

        } catch (error) {
            Logger.error('POI 마커 로드 실패:', error);

            // 오프라인 또는 파일 로드 실패 시 기본 마커 생성
            this.createFallbackMarkers();
        }
    }

    // 개별 POI 마커 생성
    createPOIMarker(poi, index) {
        if (!poi.coordinates || poi.coordinates.length !== 2) {
            Logger.warn(`POI ${poi.id} 좌표 정보 없음`);
            return;
        }

        const position = {
            lat: poi.coordinates[0],
            lng: poi.coordinates[1]
        };

        // 카테고리별 아이콘 선택
        const icon = this.categoryIcons[poi.category] || this.defaultIcon;

        // 마커 생성
        const marker = new google.maps.Marker({
            position: position,
            map: this.map,
            title: poi.name || poi.name_en,
            icon: icon,
            animation: google.maps.Animation.DROP,
            optimized: false
        });

        // 마커 데이터 저장
        marker.poiData = poi;

        // 클릭 이벤트
        marker.addListener('click', () => {
            this.showPOIInfo(poi, marker);
        });

        this.markers.push(marker);
    }

    // POI 정보 표시
    showPOIInfo(poi, marker) {
        const content = this.createInfoWindowContent(poi);

        this.infoWindow.setContent(content);
        this.infoWindow.open(this.map, marker);

        // 마커 바운스 애니메이션
        marker.setAnimation(google.maps.Animation.BOUNCE);
        setTimeout(() => {
            marker.setAnimation(null);
        }, 1400);
    }

    // 정보창 컨텐츠 생성
    createInfoWindowContent(poi) {
        const rating = poi.rating ? `⭐ ${poi.rating}` : '';
        const category = CONFIG.POI.CATEGORIES[poi.category]?.name || poi.category;

        return `
            <div class="poi-info">
                <h3>${poi.name}</h3>
                <p class="poi-category">${CONFIG.POI.CATEGORIES[poi.category]?.icon || '📍'} ${category}</p>
                ${poi.name_en ? `<p class="poi-name-en">${poi.name_en}</p>` : ''}
                ${rating ? `<p class="poi-rating">${rating}</p>` : ''}
                ${poi.description ? `<p class="poi-description">${poi.description}</p>` : ''}
                <div class="poi-actions">
                    <button onclick="window.MapsManager.navigateTo('${poi.id}')" class="btn-navigate">
                        🧭 길찾기
                    </button>
                    <button onclick="window.POIManager.showDetails('${poi.id}')" class="btn-details">
                        ℹ️ 상세정보
                    </button>
                </div>
            </div>
        `;
    }

    // 마커 클러스터링 초기화
    initMarkerClustering() {
        // 마커 클러스터링 (Google Maps Marker Clustering 라이브러리 필요)
        if (window.MarkerClusterer) {
            this.markerCluster = new MarkerClusterer(this.map, this.markers, {
                imagePath: 'https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/m',
                gridSize: 60,
                maxZoom: 15
            });
            Logger.info('마커 클러스터링 적용 완료');
        } else {
            Logger.warn('마커 클러스터링 라이브러리 없음');
        }
    }

    // 사용자 위치 추적 시작
    startLocationTracking() {
        if (!navigator.geolocation) {
            Logger.warn('위치 서비스를 지원하지 않는 브라우저입니다.');
            return;
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
        };

        // 현재 위치 한 번 조회
        navigator.geolocation.getCurrentPosition(
            (position) => this.updateUserLocation(position),
            (error) => this.handleLocationError(error),
            options
        );

        // 지속적 위치 추적
        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.updateUserLocation(position),
            (error) => this.handleLocationError(error),
            options
        );

        Logger.info('위치 추적 시작');
    }

    // 사용자 위치 업데이트
    updateUserLocation(position) {
        const userPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        // 기존 사용자 위치 마커 제거
        if (this.userLocationMarker) {
            this.userLocationMarker.setMap(null);
        }

        // 새 사용자 위치 마커 생성
        this.userLocationMarker = new google.maps.Marker({
            position: userPos,
            map: this.map,
            title: '현재 위치',
            icon: {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8" fill="#4285F4" stroke="#fff" stroke-width="2"/>
                        <circle cx="12" cy="12" r="3" fill="#fff"/>
                    </svg>
                `),
                scaledSize: new google.maps.Size(24, 24)
            },
            zIndex: 1000
        });

        // 위치 정보 저장
        if (window.LocationTracker) {
            window.LocationTracker.updateLocation(userPos);
        }

        Logger.log('사용자 위치 업데이트:', userPos);
    }

    // 위치 오류 처리
    handleLocationError(error) {
        let message = '위치 정보를 가져올 수 없습니다.';

        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = '위치 접근이 거부되었습니다.';
                break;
            case error.POSITION_UNAVAILABLE:
                message = '위치 정보를 사용할 수 없습니다.';
                break;
            case error.TIMEOUT:
                message = '위치 요청 시간이 초과되었습니다.';
                break;
        }

        Logger.warn('위치 오류:', message);
    }

    // 길찾기
    async navigateTo(poiId) {
        if (!this.apiTracker.canUseAPI('DIRECTIONS')) {
            Logger.error('Directions API 일일 한도 초과');
            return;
        }

        try {
            // POI 정보 찾기
            const poi = this.findPOIById(poiId);
            if (!poi) {
                throw new Error('POI를 찾을 수 없습니다.');
            }

            // 현재 위치 확인
            const userLocation = this.getCurrentUserLocation();
            if (!userLocation) {
                throw new Error('현재 위치를 알 수 없습니다.');
            }

            // 경로 요청
            const request = {
                origin: userLocation,
                destination: { lat: poi.coordinates[0], lng: poi.coordinates[1] },
                travelMode: google.maps.TravelMode.DRIVING,
                language: 'ko',
                region: 'JP'
            };

            this.directionsService.route(request, (result, status) => {
                if (status === 'OK') {
                    this.directionsRenderer.setDirections(result);
                    this.apiTracker.recordUsage('DIRECTIONS');
                    Logger.info(`${poi.name}까지 경로 표시 완료`);
                } else {
                    Logger.error('경로 요청 실패:', status);
                }
            });

        } catch (error) {
            Logger.error('길찾기 오류:', error);
        }
    }

    // POI ID로 검색
    findPOIById(poiId) {
        return this.markers.find(marker => marker.poiData?.id === poiId)?.poiData;
    }

    // 현재 사용자 위치 반환
    getCurrentUserLocation() {
        if (this.userLocationMarker) {
            const pos = this.userLocationMarker.getPosition();
            return { lat: pos.lat(), lng: pos.lng() };
        }
        return null;
    }

    // 마커 정리
    clearMarkers() {
        this.markers.forEach(marker => marker.setMap(null));
        this.markers = [];

        if (this.markerCluster) {
            this.markerCluster.clearMarkers();
        }
    }

    // Fallback 마커 (오프라인 시)
    createFallbackMarkers() {
        const fallbackPOIs = [
            { name: '나하 공항', coordinates: [26.1958, 127.6458], category: 'transportation' },
            { name: '미야코 공항', coordinates: [24.7828, 125.2956], category: 'transportation' },
            { name: '요나하 마에하마 해변', coordinates: [25.2074, 125.1361], category: 'nature_views' }
        ];

        fallbackPOIs.forEach((poi, index) => {
            this.createPOIMarker(poi, index);
        });

        Logger.info('기본 마커 생성 완료');
    }

    // 정리
    destroy() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
        }

        this.clearMarkers();

        if (this.userLocationMarker) {
            this.userLocationMarker.setMap(null);
        }

        if (this.directionsRenderer) {
            this.directionsRenderer.setMap(null);
        }
    }
}

// 전역 접근을 위한 내보내기
window.GoogleMapsManager = GoogleMapsManager;

// 모듈 상태 관리
window.MapsStatus = {
    isReady: false,
    manager: null,

    init: async () => {
        console.log('🗺️ Google Maps 초기화 시작!');

        try {
            window.MapsStatus.manager = new GoogleMapsManager();
            const success = await window.MapsStatus.manager.init();

            if (success) {
                window.MapsStatus.isReady = true;
                window.MapsManager = window.MapsStatus.manager; // 편의성을 위한 전역 참조

                console.log('✅ Google Maps 초기화 성공!');

                // 모듈 초기화 완료 이벤트 발생
                window.dispatchEvent(new CustomEvent('moduleReady', {
                    detail: { moduleName: 'maps' }
                }));
            } else {
                throw new Error('지도 초기화 실패');
            }
        } catch (error) {
            console.error('❌ Google Maps 초기화 실패:', error);
            throw error;
        }
    }
};