// js/modules/poi.js
import { DataService } from '../services/data.js';

class POIManager {
    constructor() {
        this.pois = [];
        this.filteredPOIs = [];
        this.currentCategory = 'all';
        this.currentSearchTerm = '';
        this.categories = {};
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

        // 검색 이벤트 리스너
        const searchInput = document.getElementById('poi-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchPOIs(e.target.value);
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

        this.filteredPOIs = filtered;
        this.renderPOIList();
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

        container.innerHTML = this.filteredPOIs.map(poi => `
            <div class="poi-item" data-id="${poi.id}">
                <div class="poi-header">
                    <h3 class="poi-name">${poi.name}</h3>
                    <span class="poi-category">${this.getCategoryLabel(poi.category)}</span>
                </div>
                <p class="poi-description">${poi.description || ''}</p>
                <div class="poi-features">
                    ${(poi.features || []).map(feature =>
                        `<span class="feature-tag">${feature}</span>`
                    ).join('')}
                </div>
                <div class="poi-meta">
                    <span class="open-hours">${poi.openHours || '운영시간 확인필요'}</span>
                </div>
                <div class="poi-actions">
                    <button class="btn-primary" onclick="poiManager.showDetails('${poi.id}')">
                        상세보기
                    </button>
                    <button class="btn-secondary" onclick="poiManager.getDirections(${poi.coordinates.lat}, ${poi.coordinates.lng})">
                        길찾기
                    </button>
                </div>
            </div>
        `).join('');
    }

    getCategoryLabel(category) {
        const categoryLabels = {
            'nature': '자연 경관',
            'dining': '식당/카페',
            'shopping': '쇼핑',
            'culture': '문화 명소',
            'marine': '해양 활동',
            'beach': '해변',
            'sightseeing': '관광지'
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
                        <button class="btn-primary" onclick="poiManager.getDirections(${poi.coordinates.lat}, ${poi.coordinates.lng})">
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

    getDirections(lat, lng) {
        // Google Maps 길찾기 열기
        const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        window.open(url, '_blank');
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