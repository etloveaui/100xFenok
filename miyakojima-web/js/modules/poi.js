// js/modules/poi.js
import { DataService } from '../services/data.js';

class POIManager {
    constructor() {
        this.pois = [];
        this.filteredPOIs = [];
        this.currentCategory = 'all';
        this.currentSearchTerm = '';
        this.currentSortBy = 'default';
        this.categories = {};
        this.userLocation = null; // 사용자 위치
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            console.log('✅ POI 매니저 이미 초기화됨');
            return;
        }

        try {
            console.log('🔄 POI 매니저 초기화 시작...');

            // DataService에서 POI 데이터 로드
            this.pois = DataService.get('pois') || [];
            this.categories = DataService.get('pois_categories') || {};

            console.log(`✅ POI 데이터 로딩 완료: ${this.pois.length}개`);

            // 초기 필터링된 목록 설정
            this.filteredPOIs = [...this.pois];

            // 사용자 위치 설정 (미야코지마 중심)
            this.userLocation = {
                lat: 24.7392,  // 미야코지마 중심부
                lng: 125.2814
            };

            // UI 초기화
            this.initializeUI();
            this.renderPOIList();

            this.initialized = true;
            console.log('✅ POI 매니저 초기화 완료');
        } catch (error) {
            console.error('❌ POI 매니저 초기화 실패:', error);
            this.pois = [];
            this.filteredPOIs = [];
        }
    }

    initializeUI() {
        // 카테고리 필터 이벤트 리스너
        const categoryFilter = document.getElementById('category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.filterByCategory(e.target.value);
            });
        }

        // 정렬 필터 이벤트 리스너
        const sortFilter = document.getElementById('sort-filter');
        if (sortFilter) {
            sortFilter.addEventListener('change', (e) => {
                this.sortBy(e.target.value);
            });
        }

        // 검색 이벤트 리스너
        const searchInput = document.getElementById('poi-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchPOIs(e.target.value);
            });
        }

        // 검색 버튼 이벤트
        const searchBtn = document.getElementById('poi-search-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                const searchInput = document.getElementById('poi-search');
                if (searchInput) {
                    this.searchPOIs(searchInput.value);
                }
            });
        }
    }

    filterByCategory(category) {
        this.currentCategory = category;
        this.applyFilters();
    }

    searchPOIs(searchTerm) {
        this.currentSearchTerm = searchTerm.toLowerCase();
        this.applyFilters();
    }

    sortBy(sortType) {
        this.currentSortBy = sortType;
        this.applyFilters();
    }

    applyFilters() {
        let filtered = [...this.pois];

        // 카테고리 필터 적용
        if (this.currentCategory && this.currentCategory !== 'all') {
            filtered = filtered.filter(poi =>
                poi.category === this.currentCategory ||
                (poi.features && poi.features.some(feature =>
                    feature.toLowerCase().includes(this.currentCategory.toLowerCase())
                ))
            );
        }

        // 검색어 필터 적용
        if (this.currentSearchTerm) {
            filtered = filtered.filter(poi =>
                poi.name.toLowerCase().includes(this.currentSearchTerm) ||
                poi.nameEn.toLowerCase().includes(this.currentSearchTerm) ||
                poi.description.toLowerCase().includes(this.currentSearchTerm) ||
                (poi.features && poi.features.some(feature =>
                    feature.toLowerCase().includes(this.currentSearchTerm)
                ))
            );
        }

        // 정렬 적용
        filtered = this.applySorting(filtered);

        this.filteredPOIs = filtered;
        this.renderPOIList();
    }

    applySorting(pois) {
        switch (this.currentSortBy) {
            case 'name':
                return pois.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
            case 'distance':
                if (this.userLocation) {
                    return pois.sort((a, b) => {
                        const distA = this.calculateDistance(
                            this.userLocation.lat, this.userLocation.lng,
                            a.coordinates.lat, a.coordinates.lng
                        );
                        const distB = this.calculateDistance(
                            this.userLocation.lat, this.userLocation.lng,
                            b.coordinates.lat, b.coordinates.lng
                        );
                        return distA - distB;
                    });
                }
                return pois;
            default:
                return pois;
        }
    }

    renderPOIList() {
        const container = document.getElementById('poi-list');
        if (!container) {
            console.warn('POI 목록 컨테이너를 찾을 수 없습니다');
            return;
        }

        if (this.filteredPOIs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>검색 결과가 없습니다</h3>
                    <p>다른 키워드로 검색해보세요</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.filteredPOIs.map(poi => {
            let distanceText = '';
            if (this.userLocation && poi.coordinates) {
                const distance = this.calculateDistance(
                    this.userLocation.lat, this.userLocation.lng,
                    poi.coordinates.lat, poi.coordinates.lng
                );
                distanceText = `<span class="poi-distance">${distance.toFixed(1)}km</span>`;
            }

            return `
                <div class="poi-item" data-id="${poi.id}">
                    <div class="poi-header">
                        <div class="poi-title-group">
                            <h3 class="poi-name">${poi.name}</h3>
                            <span class="poi-category">${this.getCategoryLabel(poi.category)}</span>
                        </div>
                        ${distanceText}
                    </div>
                    <p class="poi-description">${poi.description || poi.nameEn || ''}</p>
                    <div class="poi-features">
                        ${(poi.features || []).map(feature =>
                            `<span class="feature-tag">${feature}</span>`
                        ).join('')}
                    </div>
                    <div class="poi-meta">
                        <span class="open-hours">
                            <svg class="meta-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12,6 12,12 16,14"></polyline></svg>
                            ${poi.openHours || '운영시간 확인필요'}
                        </span>
                        ${poi.address ? `
                        <span class="poi-address">
                            <svg class="meta-icon"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                            ${poi.address.split(',')[0]}
                        </span>` : ''}
                    </div>
                    <div class="poi-actions">
                        <button class="btn-primary" onclick="poiManager.showDetails('${poi.id}')">
                            <svg class="btn-icon"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path></svg>
                            상세보기
                        </button>
                        <button class="btn-secondary" onclick="poiManager.getDirections(${poi.coordinates.lat}, ${poi.coordinates.lng}, '${poi.name.replace(/'/g, "\\'")}')">
                            <svg class="btn-icon"><path d="M5 12h14m-7-7 7 7-7 7"></path></svg>
                            길찾기
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    getCategoryLabel(category) {
        const categoryLabels = {
            'beaches': '해변',
            'nature': '자연 경관',
            'restaurants': '음식점',
            'activities': '액티비티',
            'culture': '문화',
            'shopping': '쇼핑'
        };
        return categoryLabels[category] || category;
    }

    showDetails(poiId) {
        const poi = this.pois.find(p => p.id === poiId);
        if (!poi) {
            console.error('POI를 찾을 수 없습니다:', poiId);
            return;
        }

        // 모달 창으로 상세 정보 표시
        this.showPOIModal(poi);
    }

    showPOIModal(poi) {
        // 동적으로 모달 생성
        const modalHTML = `
            <div id="poi-modal" class="modal active">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${poi.name}</h3>
                        <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="poi-detail-category">${this.getCategoryLabel(poi.category)}</div>
                        <p class="poi-detail-description">${poi.description}</p>

                        <div class="poi-detail-info">
                            <div class="info-item">
                                <strong>운영시간:</strong> ${poi.openHours || '확인 필요'}
                            </div>
                            ${poi.address ? `
                            <div class="info-item">
                                <strong>주소:</strong> ${poi.address}
                            </div>` : ''}
                            ${poi.tips ? `
                            <div class="info-item">
                                <strong>팁:</strong> ${poi.tips}
                            </div>` : ''}
                        </div>

                        <div class="poi-detail-features">
                            ${(poi.features || []).map(feature =>
                                `<span class="feature-tag">${feature}</span>`
                            ).join('')}
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-primary" onclick="poiManager.getDirections(${poi.coordinates.lat}, ${poi.coordinates.lng}, '${poi.name.replace(/'/g, "\\'")}')">
                            길찾기
                        </button>
                        <button class="btn-secondary" onclick="this.closest('.modal').remove()">
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 기존 모달 제거 후 새 모달 추가
        const existingModal = document.getElementById('poi-modal');
        if (existingModal) {
            existingModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    async getDirections(lat, lng, poiName = '') {
        try {
            // 먼저 사용자의 현재 위치를 가져오기
            const userLocation = await this.getCurrentLocation();

            if (userLocation) {
                // 현재 위치가 있으면 현재 위치에서 목적지까지 길찾기
                const url = `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${lat},${lng}&travelmode=driving`;
                window.open(url, '_blank');

                // 구글맵 매니저가 있으면 지도에도 경로 표시
                if (window.app && window.app.modules.get('maps')) {
                    const mapsManager = window.app.modules.get('maps');
                    mapsManager.showRoute(userLocation, {lat, lng}, poiName);
                }
            } else {
                // 현재 위치를 가져올 수 없으면 기본 동작
                const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('길찾기 실행 중 오류:', error);
            // 오류 발생시 기본 동작
            const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            window.open(url, '_blank');
        }
    }

    // 사용자의 현재 위치 가져오기
    async getCurrentLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('Geolocation API를 지원하지 않는 브라우저입니다.');
                resolve(null);
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const location = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    };

                    // 사용자 위치 업데이트
                    this.userLocation = location;
                    console.log('✅ 현재 위치 획득:', location);
                    resolve(location);
                },
                (error) => {
                    console.warn('위치 정보를 가져올 수 없습니다:', error.message);
                    // 실패시 미야코지마 중심 좌표 반환
                    const defaultLocation = {
                        lat: 24.7392,
                        lng: 125.2814
                    };
                    this.userLocation = defaultLocation;
                    resolve(defaultLocation);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 0
                }
            );
        });
    }

    // 주변 POI 찾기 (현재 위치 기준)
    async findNearbyPOIs(userLat, userLng, radiusKm = 5) {
        const nearbyPOIs = this.pois.filter(poi => {
            if (!poi.coordinates || !poi.coordinates.lat || !poi.coordinates.lng) {
                return false;
            }

            const distance = this.calculateDistance(
                userLat, userLng,
                poi.coordinates.lat, poi.coordinates.lng
            );

            return distance <= radiusKm;
        });

        // 거리순으로 정렬
        nearbyPOIs.sort((a, b) => {
            const distA = this.calculateDistance(userLat, userLng, a.coordinates.lat, a.coordinates.lng);
            const distB = this.calculateDistance(userLat, userLng, b.coordinates.lat, b.coordinates.lng);
            return distA - distB;
        });

        return nearbyPOIs;
    }

    // 두 지점 간 거리 계산 (Haversine formula)
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // 지구 반지름 (km)
        const dLat = this.deg2rad(lat2 - lat1);
        const dLng = this.deg2rad(lng2 - lng1);
        const a =
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    deg2rad(deg) {
        return deg * (Math.PI/180);
    }

    // 통계 정보
    getStats() {
        return {
            total: this.pois.length,
            categories: Object.keys(this.categories).length,
            filtered: this.filteredPOIs.length
        };
    }
}

// 전역 인스턴스 생성
const poiManager = new POIManager();

// 전역 접근을 위해 window에 할당
if (typeof window !== 'undefined') {
    window.poiManager = poiManager;
}

export { POIManager, poiManager };
export default poiManager;