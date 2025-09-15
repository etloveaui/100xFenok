// 미야코지마 웹 플랫폼 - Google Maps 통합
// Google Maps Integration for Miyakojima Web Platform

import { CONFIG } from './config.js';
import { Logger } from './utils.js';

/**
 * Google Maps 관리자 클래스
 */
class GoogleMapsManager {
    constructor() {
        this.map = null;
        this.markers = [];
        this.infoWindows = [];
        this.directionsService = null;
        this.directionsRenderer = null;
        this.placesService = null;
        this.currentLocationMarker = null;
        this.isInitialized = false;
        this.apiKey = '';
        this.center = { lat: 24.7449, lng: 125.2813 }; // 미야코지마 중심
        this.zoom = 12;

        this.mapOptions = {
            zoom: this.zoom,
            center: this.center,
            mapTypeId: google.maps.MapTypeId.ROADMAP,
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: true,
            scaleControl: true,
            streetViewControl: false,
            rotateControl: false,
            fullscreenControl: true
        };
    }

    /**
     * Google Maps 초기화
     */
    async initialize() {
        try {
            // Google Maps API 로드 확인
            if (typeof google === 'undefined' || !google.maps) {
                throw new Error('Google Maps API가 로드되지 않았습니다');
            }

            // 지도 컨테이너 확인 (poi-map 사용)
            const mapContainer = document.getElementById('poi-map');
            if (!mapContainer) {
                throw new Error('지도 컨테이너(poi-map)를 찾을 수 없습니다');
            }

            // 지도 생성
            this.map = new google.maps.Map(mapContainer, this.mapOptions);

            // 서비스 초기화
            this.directionsService = new google.maps.DirectionsService();
            this.directionsRenderer = new google.maps.DirectionsRenderer({
                draggable: true,
                suppressMarkers: false
            });
            this.directionsRenderer.setMap(this.map);

            this.placesService = new google.maps.places.PlacesService(this.map);

            // 지도 이벤트 리스너 설정
            this.setupMapEventListeners();

            // 현재 위치 마커 생성
            this.createCurrentLocationMarker();

            // POI 마커 로드
            await this.loadPOIMarkers();

            this.isInitialized = true;
            Logger.info('Google Maps 초기화 완료');

            return true;

        } catch (error) {
            Logger.error('Google Maps 초기화 실패:', error);
            throw error;
        }
    }

    /**
     * 지도 이벤트 리스너 설정
     */
    setupMapEventListeners() {
        // 지도 클릭 이벤트
        this.map.addListener('click', (event) => {
            this.handleMapClick(event);
        });

        // 마커 클러스터링 (선택사항)
        if (window.MarkerClusterer) {
            this.markerCluster = new MarkerClusterer(this.map, this.markers, {
                imagePath: 'https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/m'
            });
        }
    }

    /**
     * 현재 위치 마커 생성
     */
    createCurrentLocationMarker() {
        this.currentLocationMarker = new google.maps.Marker({
            map: this.map,
            title: '현재 위치',
            icon: {
                url: 'data:image/svg+xml;base64,' + btoa(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#4285f4">
                        <circle cx="12" cy="12" r="8"/>
                        <circle cx="12" cy="12" r="3" fill="white"/>
                    </svg>
                `),
                scaledSize: new google.maps.Size(24, 24),
                anchor: new google.maps.Point(12, 12)
            }
        });
    }

    /**
     * POI 마커 로드
     */
    async loadPOIMarkers() {
        try {
            // POI 관리자에서 데이터 가져오기
            const pois = window.poiManager ? window.poiManager.pois : [];

            if (pois.length === 0) {
                Logger.warn('POI 데이터가 없습니다');
                return;
            }

            // 기존 마커 제거
            this.clearMarkers();

            // POI 마커 생성
            for (const poi of pois) {
                if (poi.coordinates) {
                    await this.createPOIMarker(poi);
                }
            }

            Logger.info(`${this.markers.length}개 POI 마커 로드 완료`);

        } catch (error) {
            Logger.error('POI 마커 로드 실패:', error);
        }
    }

    /**
     * POI 마커 생성
     */
    async createPOIMarker(poi) {
        try {
            let lat, lng;

            // 좌표 형태 확인
            if (Array.isArray(poi.coordinates)) {
                [lat, lng] = poi.coordinates;
            } else if (poi.coordinates.lat && poi.coordinates.lng) {
                lat = poi.coordinates.lat;
                lng = poi.coordinates.lng;
            } else {
                Logger.warn('POI 좌표 형식이 올바르지 않음:', poi.id);
                return;
            }

            // 카테고리별 마커 아이콘
            const category = CONFIG.config?.POI?.CATEGORIES?.[poi.category] || {};
            const markerIcon = this.getMarkerIcon(category);

            // 마커 생성
            const marker = new google.maps.Marker({
                position: { lat: parseFloat(lat), lng: parseFloat(lng) },
                map: this.map,
                title: poi.name,
                icon: markerIcon,
                data: poi
            });

            // 정보창 생성
            const infoWindow = new google.maps.InfoWindow({
                content: this.createInfoWindowContent(poi, lat, lng)
            });

            // 마커 클릭 이벤트
            marker.addListener('click', () => {
                // 다른 정보창 닫기
                this.closeAllInfoWindows();
                infoWindow.open(this.map, marker);
            });

            // 마커와 정보창 저장
            this.markers.push(marker);
            this.infoWindows.push(infoWindow);

        } catch (error) {
            Logger.error(`POI 마커 생성 실패 (${poi.id}):`, error);
        }
    }

    /**
     * 정보창 콘텐츠 생성
     */
    createInfoWindowContent(poi, lat, lng) {
        const category = CONFIG.config?.POI?.CATEGORIES?.[poi.category] || {};

        try {
            const infoContent = `
                <div class="poi-info">
                    <h3>${poi.name}</h3>
                    <p><strong>카테고리:</strong> ${this.getCategoryName(category)}</p>
                    <p><strong>평점:</strong> ⭐ ${poi.rating || 'N/A'}</p>
                    ${poi.description ? `<p>${poi.description}</p>` : ''}
                    <button onclick="window.googleMapsManager.getDirections(${lat}, ${lng}, ${JSON.stringify(poi.name)})">
                        길찾기
                    </button>
                </div>
            `;

            return infoContent;
        } catch (error) {
            Logger.error('정보창 콘텐츠 생성 실패:', error);
            return `<div class="poi-info"><h3>${poi.name}</h3><p>정보를 불러올 수 없습니다.</p></div>`;
        }
    }

    /**
     * 카테고리별 마커 아이콘 생성
     */
    getMarkerIcon(category) {
        const color = category.color || '#ff6b6b';
        const icon = category.icon || '📍';

        return {
            url: 'data:image/svg+xml;base64,' + btoa(`
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                    <circle cx="16" cy="16" r="12" fill="${color}" stroke="white" stroke-width="2"/>
                    <text x="16" y="20" text-anchor="middle" font-size="12" fill="white">${icon}</text>
                </svg>
            `),
            scaledSize: new google.maps.Size(32, 32),
            anchor: new google.maps.Point(16, 16)
        };
    }

    /**
     * 현재 위치로 지도 이동
     */
    async moveToCurrentLocation() {
        try {
            if (!navigator.geolocation) {
                throw new Error('브라우저에서 위치 서비스를 지원하지 않습니다');
            }

            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000
                });
            });

            const currentLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            // 지도 중심 이동
            this.map.setCenter(currentLocation);
            this.map.setZoom(15);

            // 현재 위치 마커 업데이트
            if (this.currentLocationMarker) {
                this.currentLocationMarker.setPosition(currentLocation);
            }

            Logger.info('현재 위치로 지도 이동 완료');
            return currentLocation;

        } catch (error) {
            Logger.error('현재 위치 이동 실패:', error);
            throw error;
        }
    }

    /**
     * 길찾기 서비스
     */
    async getDirections(destLat, destLng, destName = '목적지') {
        try {
            if (!this.directionsService || !this.directionsRenderer) {
                throw new Error('길찾기 서비스가 초기화되지 않았습니다');
            }

            // 현재 위치 가져오기
            const currentLocation = await this.getCurrentLocation();

            const request = {
                origin: new google.maps.LatLng(currentLocation.lat, currentLocation.lng),
                destination: new google.maps.LatLng(destLat, destLng),
                travelMode: google.maps.TravelMode.DRIVING,
                unitSystem: google.maps.UnitSystem.METRIC,
                avoidHighways: false,
                avoidTolls: false
            };

            // 길찾기 요청
            this.directionsService.route(request, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    this.directionsRenderer.setDirections(result);

                    // 경로 정보 표시
                    this.displayRouteInfo(result);

                    Logger.info(`${destName}까지 길찾기 완료`);
                } else {
                    throw new Error(`길찾기 실패: ${status}`);
                }
            });

        } catch (error) {
            Logger.error('길찾기 실패:', error);
            alert('길찾기에 실패했습니다: ' + error.message);
        }
    }

    /**
     * 경로 정보 표시
     */
    displayRouteInfo(directionsResult) {
        const route = directionsResult.routes[0];
        const leg = route.legs[0];

        const routeInfo = {
            distance: leg.distance.text,
            duration: leg.duration.text,
            steps: leg.steps.length
        };

        // 경로 정보 패널 업데이트
        const routePanel = document.getElementById('route-info');
        if (routePanel) {
            routePanel.innerHTML = `
                <div class="route-summary">
                    <h4>경로 정보</h4>
                    <p><strong>거리:</strong> ${routeInfo.distance}</p>
                    <p><strong>소요시간:</strong> ${routeInfo.duration}</p>
                    <p><strong>경유지:</strong> ${routeInfo.steps}개</p>
                    <button onclick="window.googleMapsManager.clearDirections()">경로 지우기</button>
                </div>
            `;
        }

        Logger.info('경로 정보 표시 완료:', routeInfo);
    }

    /**
     * 길찾기 경로 지우기
     */
    clearDirections() {
        if (this.directionsRenderer) {
            this.directionsRenderer.setDirections({ routes: [] });
        }

        const routePanel = document.getElementById('route-info');
        if (routePanel) {
            routePanel.innerHTML = '';
        }

        Logger.info('길찾기 경로 지우기 완료');
    }

    /**
     * 현재 위치 가져오기
     */
    async getCurrentLocation() {
        if (window.locationManager && window.locationManager.currentLocation) {
            return window.locationManager.currentLocation;
        }

        // GPS에서 직접 가져오기
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                (error) => {
                    // 기본 위치 반환 (미야코지마 중심)
                    resolve(this.center);
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        });
    }

    /**
     * 특정 POI로 지도 이동
     */
    focusOnPOI(poiId) {
        const marker = this.markers.find(marker => marker.data && marker.data.id === poiId);

        if (marker) {
            this.map.setCenter(marker.getPosition());
            this.map.setZoom(16);

            // 마커 클릭 트리거
            google.maps.event.trigger(marker, 'click');

            Logger.info(`POI ${poiId}로 지도 포커스 이동`);
        } else {
            Logger.warn(`POI ${poiId}를 찾을 수 없습니다`);
        }
    }

    /**
     * 주변 장소 검색 (Places API)
     */
    async searchNearbyPlaces(location, radius = 1000, type = 'tourist_attraction') {
        try {
            if (!this.placesService) {
                throw new Error('Places 서비스가 초기화되지 않았습니다');
            }

            const request = {
                location: new google.maps.LatLng(location.lat, location.lng),
                radius: radius,
                type: type
            };

            return new Promise((resolve, reject) => {
                this.placesService.nearbySearch(request, (results, status) => {
                    if (status === google.maps.places.PlacesServiceStatus.OK) {
                        resolve(results);
                    } else {
                        reject(new Error(`Places 검색 실패: ${status}`));
                    }
                });
            });

        } catch (error) {
            Logger.error('주변 장소 검색 실패:', error);
            throw error;
        }
    }

    /**
     * 지도 클릭 핸들러
     */
    handleMapClick(event) {
        const lat = event.latLng.lat();
        const lng = event.latLng.lng();

        Logger.info(`지도 클릭: ${lat}, ${lng}`);

        // 클릭한 위치에 임시 마커 생성 (필요시)
        // this.createTemporaryMarker(lat, lng);
    }

    /**
     * 모든 정보창 닫기
     */
    closeAllInfoWindows() {
        this.infoWindows.forEach(infoWindow => {
            infoWindow.close();
        });
    }

    /**
     * 모든 마커 제거
     */
    clearMarkers() {
        this.markers.forEach(marker => {
            marker.setMap(null);
        });
        this.markers = [];
        this.infoWindows = [];
    }

    /**
     * 카테고리명 반환
     */
    getCategoryName(category) {
        return category.name || '기타';
    }

    /**
     * 지도 리사이즈 (컨테이너 크기 변경 시)
     */
    resize() {
        if (this.map) {
            google.maps.event.trigger(this.map, 'resize');
            this.map.setCenter(this.center);
        }
    }

    /**
     * 지도 스타일 변경
     */
    setMapStyle(style) {
        if (this.map) {
            this.map.setOptions({ styles: style });
        }
    }

    /**
     * 상태 정보 반환
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            markersCount: this.markers.length,
            center: this.center,
            zoom: this.zoom
        };
    }
}

// 전역 인스턴스 생성
window.googleMapsManager = null;

// 모듈 상태 관리
window.MapsStatus = {
    isReady: false,
    manager: null,

    init: async () => {
        try {
            // Google Maps API 로드 확인
            if (typeof google === 'undefined' || !google.maps) {
                Logger.warn('Google Maps API가 로드되지 않음 - 선택적 모듈로 스킵');
                window.MapsStatus.isReady = true; // 선택적 모듈이므로 ready로 표시
                return;
            }

            // 지도 컨테이너 확인
            const mapContainer = document.getElementById('google-map');
            if (!mapContainer) {
                Logger.warn('지도 컨테이너가 없음 - 선택적 모듈로 스킵');
                window.MapsStatus.isReady = true; // 선택적 모듈이므로 ready로 표시
                return;
            }

            window.googleMapsManager = new GoogleMapsManager();
            await window.googleMapsManager.initialize();

            window.MapsStatus.manager = window.googleMapsManager;
            window.MapsStatus.isReady = true;

            // 모듈 초기화 완료 이벤트 발생
            window.dispatchEvent(new CustomEvent('moduleReady', {
                detail: { moduleName: 'maps' }
            }));

            Logger.info('Google Maps 모듈 초기화 완료');

        } catch (error) {
            Logger.warn('Google Maps 모듈 초기화 실패 (선택적 모듈):', error);
            // 선택적 모듈이므로 ready로 표시하여 앱 초기화 블록 방지
            window.MapsStatus.isReady = true;
        }
    }
};

// Google Maps API 로드 체크
function initGoogleMaps() {
    if (window.MapsStatus && window.MapsStatus.init) {
        window.MapsStatus.init();
    }
}

// Google Maps API가 이미 로드된 경우
if (typeof google !== 'undefined' && google.maps) {
    window.googleMapsLoaded = true;
}

Logger.info('Google Maps 모듈 로드 완료');

// ES6 모듈 export
export { GoogleMapsManager };
export default GoogleMapsManager;