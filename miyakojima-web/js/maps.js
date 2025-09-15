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
                lat: 24.7831,
                lng: 125.2810
            },
            zoom: 12,
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

        // POI 카테고리별 아이콘 설정 (Google Maps 로드 후 초기화)
        this.categoryIcons = null;
    }

    // Google Maps API 대기 함수
    async waitForGoogleMaps() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Google Maps API 로드 타임아웃'));
            }, 30000);

            const checkGoogleMaps = () => {
                if (window.google && window.google.maps) {
                    clearTimeout(timeout);
                    this.initCategoryIcons();
                    resolve();
                } else {
                    setTimeout(checkGoogleMaps, 100);
                }
            };

            checkGoogleMaps();
        });
    }

    // Google Maps 로드 후 아이콘 초기화
    initCategoryIcons() {
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

    // 초기화 함수
    async init() {
        console.log('ℹ️ GoogleMapsManager 초기화 시작');

        try {
            // Google Maps JavaScript API 로드 확인
            await this.waitForGoogleMaps();

            // 지도 생성
            await this.createMap();

            // POI 데이터 로드 및 마커 생성
            await this.loadPOIs();

            // 사용자 위치 추적 시작
            this.startLocationTracking();

            console.log('ℹ️ GoogleMapsManager 초기화 완료');

        } catch (error) {
            console.error('❌ GoogleMapsManager 초기화 실패:', error);
            throw error;
        }
    }

    // 지도 생성
    async createMap() {
        const mapContainer = document.getElementById('poi-map');
        if (!mapContainer) {
            throw new Error('지도 컨테이너를 찾을 수 없습니다. (id="poi-map")');
        }

        // API 사용량 체크
        if (!this.apiTracker.canUseAPI('MAPS_JAVASCRIPT')) {
            throw new Error('Google Maps JavaScript API 일일 사용량이 초과되었습니다.');
        }

        this.map = new google.maps.Map(mapContainer, this.mapOptions);

        // 지도 서비스 초기화
        this.directionsService = new google.maps.DirectionsService();
        this.directionsRenderer = new google.maps.DirectionsRenderer();
        this.directionsRenderer.setMap(this.map);
        this.placesService = new google.maps.places.PlacesService(this.map);
        this.infoWindow = new google.maps.InfoWindow();

        // API 사용량 기록
        this.apiTracker.recordAPIUsage('MAPS_JAVASCRIPT');

        console.log('✅ 지도 생성 완료');
    }

    // POI 데이터 로드
    async loadPOIs() {
        try {
            const response = await fetch('./data/miyakojima_pois.json');
            const data = await response.json();

            if (data.pois && Array.isArray(data.pois)) {
                this.createPOIMarkers(data.pois);
                console.log(`✅ POI 마커 ${data.pois.length}개 생성 완료`);
            }
        } catch (error) {
            console.error('❌ POI 데이터 로드 실패:', error);
        }
    }

    // POI 마커 생성
    createPOIMarkers(pois) {
        pois.forEach(poi => {
            if (poi.coordinates && poi.coordinates.length === 2) {
                const [lat, lng] = poi.coordinates;
                const category = poi.category || 'other';
                const icon = this.categoryIcons[category] || this.categoryIcons.nature_views;

                const marker = new google.maps.Marker({
                    position: { lat, lng },
                    map: this.map,
                    title: poi.name,
                    icon: icon
                });

                // 정보창 내용 설정
                const infoContent = `
                    <div class="poi-info">
                        <h3>${poi.name}</h3>
                        <p><strong>카테고리:</strong> ${this.getCategoryName(category)}</p>
                        <p><strong>평점:</strong> ⭐ ${poi.rating || 'N/A'}</p>
                        ${poi.description ? `<p>${poi.description}</p>` : ''}
                        <button onclick="window.googleMapsManager.getDirections(${lat}, ${lng}, '${poi.name}')">
                            길찾기
                        </button>
                    </div>
                `;

                marker.addListener('click', () => {
                    this.infoWindow.setContent(infoContent);
                    this.infoWindow.open(this.map, marker);
                });

                this.markers.push(marker);
            }
        });
    }

    // 카테고리 이름 반환
    getCategoryName(category) {
        const names = {
            nature_views: '자연 경관',
            dining_cafe: '식당/카페',
            shopping: '쇼핑',
            culture_spots: '문화 명소',
            marine_activities: '해양 활동',
            transportation: '교통'
        };
        return names[category] || '기타';
    }

    // 사용자 위치 추적
    startLocationTracking() {
        if (navigator.geolocation) {
            this.watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };

                    if (this.userLocationMarker) {
                        this.userLocationMarker.setPosition(userLocation);
                    } else {
                        this.userLocationMarker = new google.maps.Marker({
                            position: userLocation,
                            map: this.map,
                            title: '현재 위치',
                            icon: {
                                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                                        <circle cx="12" cy="12" r="8" fill="#2196F3" stroke="#fff" stroke-width="3"/>
                                        <circle cx="12" cy="12" r="3" fill="#fff"/>
                                    </svg>
                                `),
                                scaledSize: new google.maps.Size(24, 24)
                            }
                        });
                    }
                },
                (error) => {
                    console.warn('위치 추적 실패:', error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 30000
                }
            );
        }
    }

    // 길찾기
    async getDirections(lat, lng, destinationName) {
        if (!this.directionsService) return;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const origin = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                const destination = { lat, lng };

                this.directionsService.route({
                    origin,
                    destination,
                    travelMode: google.maps.TravelMode.DRIVING
                }, (result, status) => {
                    if (status === 'OK') {
                        this.directionsRenderer.setDirections(result);
                        console.log(`길찾기 완료: ${destinationName}`);
                    } else {
                        console.error('길찾기 실패:', status);
                    }
                });
            },
            (error) => {
                console.error('현재 위치 확인 실패:', error);
            }
        );
    }
}

// 전역 접근을 위한 내보내기
window.GoogleMapsManager = GoogleMapsManager;

// 모듈 상태 관리
window.MapsStatus = {
    isReady: false,
    manager: null,

    init: async () => {
        console.log('🗺️ Google Maps 모듈 초기화 시작');

        try {
            window.MapsStatus.manager = new GoogleMapsManager();
            await window.MapsStatus.manager.init();

            window.MapsStatus.isReady = true;
            window.googleMapsManager = window.MapsStatus.manager; // 전역 참조

            console.log('✅ Google Maps 모듈 초기화 완료');

            // 모듈 초기화 완료 이벤트 발생
            window.dispatchEvent(new CustomEvent('moduleReady', {
                detail: { moduleName: 'maps' }
            }));

            return true;
        } catch (error) {
            console.error('❌ Google Maps 모듈 초기화 실패:', error);
            window.MapsStatus.isReady = false;
            throw error;
        }
    }
};