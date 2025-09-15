// js/modules/dining.js
import { DataService } from '../services/data.js';

class DiningManager {
    constructor() {
        this.restaurants = [];
        this.filteredRestaurants = [];
        this.currentCategory = 'all';
        this.currentSearchTerm = '';
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            console.log('✅ 다이닝 매니저 이미 초기화됨');
            return;
        }

        try {
            console.log('🔄 다이닝 매니저 초기화 시작...');

            // DataService에서 레스토랑 데이터 로드
            const restaurantData = DataService.get('restaurants') || {};
            this.restaurants = restaurantData.restaurants || [];

            console.log(`✅ 레스토랑 데이터 로딩 완료: ${this.restaurants.length}개`);

            // 초기 필터링된 목록 설정
            this.filteredRestaurants = [...this.restaurants];

            // UI 초기화
            this.initializeUI();
            this.renderRestaurantList();

            this.initialized = true;
            console.log('✅ 다이닝 매니저 초기화 완료');
        } catch (error) {
            console.error('❌ 다이닝 매니저 초기화 실패:', error);
            this.restaurants = [];
            this.filteredRestaurants = [];
        }
    }

    initializeUI() {
        // 검색 이벤트 리스너
        const searchInput = document.getElementById('restaurant-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchRestaurants(e.target.value);
            });
        }

        // 카테고리 필터 이벤트 리스너
        const categoryFilter = document.getElementById('restaurant-category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.filterByCategory(e.target.value);
            });
        }

        // 가격대 필터 이벤트 리스너
        const priceFilter = document.getElementById('restaurant-price-filter');
        if (priceFilter) {
            priceFilter.addEventListener('change', (e) => {
                this.filterByPrice(e.target.value);
            });
        }
    }

    searchRestaurants(searchTerm) {
        this.currentSearchTerm = searchTerm.toLowerCase();
        this.applyFilters();
    }

    filterByCategory(category) {
        this.currentCategory = category;
        this.applyFilters();
    }

    filterByPrice(priceRange) {
        this.currentPriceRange = priceRange;
        this.applyFilters();
    }

    applyFilters() {
        let filtered = [...this.restaurants];

        // 카테고리 필터 적용
        if (this.currentCategory && this.currentCategory !== 'all') {
            filtered = filtered.filter(restaurant =>
                restaurant.category === this.currentCategory ||
                (restaurant.cuisineType && restaurant.cuisineType.includes(this.currentCategory))
            );
        }

        // 가격대 필터 적용
        if (this.currentPriceRange && this.currentPriceRange !== 'all') {
            filtered = filtered.filter(restaurant =>
                restaurant.priceRange === this.currentPriceRange
            );
        }

        // 검색어 필터 적용
        if (this.currentSearchTerm) {
            filtered = filtered.filter(restaurant =>
                restaurant.name.toLowerCase().includes(this.currentSearchTerm) ||
                restaurant.nameEn.toLowerCase().includes(this.currentSearchTerm) ||
                restaurant.description.toLowerCase().includes(this.currentSearchTerm) ||
                (restaurant.cuisineType && restaurant.cuisineType.some(type =>
                    type.toLowerCase().includes(this.currentSearchTerm)
                ))
            );
        }

        this.filteredRestaurants = filtered;
        this.renderRestaurantList();
    }

    renderRestaurantList() {
        const container = document.getElementById('restaurant-list');
        if (!container) {
            console.warn('레스토랑 목록 컨테이너를 찾을 수 없습니다');
            return;
        }

        if (this.filteredRestaurants.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🍽️</div>
                    <h3>검색 결과가 없습니다</h3>
                    <p>다른 키워드나 필터를 시도해보세요</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.filteredRestaurants.map(restaurant => `
            <div class="restaurant-item" data-id="${restaurant.id}">
                <div class="restaurant-header">
                    <h3 class="restaurant-name">${restaurant.name}</h3>
                    <div class="restaurant-rating">
                        ${this.renderStars(restaurant.rating || 0)}
                        <span class="rating-text">${restaurant.rating || 'N/A'}</span>
                    </div>
                </div>
                <div class="restaurant-info">
                    <div class="restaurant-category">${this.getCategoryLabel(restaurant.category)}</div>
                    <div class="restaurant-price">${this.getPriceLabel(restaurant.priceRange)}</div>
                </div>
                <p class="restaurant-description">${restaurant.description || ''}</p>
                <div class="restaurant-cuisine-types">
                    ${(restaurant.cuisineType || []).map(type =>
                        `<span class="cuisine-tag">${type}</span>`
                    ).join('')}
                </div>
                <div class="restaurant-meta">
                    <div class="opening-hours">
                        ${restaurant.openingHours || '운영시간 확인필요'}
                    </div>
                    ${restaurant.phone ? `
                    <div class="restaurant-phone">
                        📞 ${restaurant.phone}
                    </div>` : ''}
                </div>
                <div class="restaurant-actions">
                    <button class="btn-primary" onclick="diningManager.showDetails('${restaurant.id}')">
                        상세보기
                    </button>
                    ${restaurant.phone ? `
                    <button class="btn-secondary" onclick="diningManager.callRestaurant('${restaurant.phone}')">
                        전화하기
                    </button>` : ''}
                    ${restaurant.coordinates ? `
                    <button class="btn-secondary" onclick="diningManager.getDirections(${restaurant.coordinates.lat}, ${restaurant.coordinates.lng})">
                        길찾기
                    </button>` : ''}
                </div>
            </div>
        `).join('');
    }

    renderStars(rating) {
        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 !== 0;
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

        return '★'.repeat(fullStars) +
               (hasHalfStar ? '☆' : '') +
               '☆'.repeat(emptyStars);
    }

    getCategoryLabel(category) {
        const labels = {
            'local': '현지 요리',
            'japanese': '일식',
            'cafe': '카페',
            'international': '세계 요리',
            'seafood': '해산물',
            'BBQ': '바베큐',
            'noodles': '면류'
        };
        return labels[category] || category;
    }

    getPriceLabel(priceRange) {
        const labels = {
            'budget': '💴 저렴함',
            'mid': '💴💴 보통',
            'expensive': '💴💴💴 비쌈'
        };
        return labels[priceRange] || priceRange;
    }

    showDetails(restaurantId) {
        const restaurant = this.restaurants.find(r => r.id === restaurantId);
        if (!restaurant) {
            console.error('레스토랑을 찾을 수 없습니다:', restaurantId);
            return;
        }

        this.showRestaurantModal(restaurant);
    }

    showRestaurantModal(restaurant) {
        const modalHTML = `
            <div id="restaurant-modal" class="modal active">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${restaurant.name}</h3>
                        <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="restaurant-detail-header">
                            <div class="restaurant-rating">
                                ${this.renderStars(restaurant.rating || 0)}
                                <span class="rating-text">${restaurant.rating || 'N/A'}</span>
                            </div>
                            <div class="restaurant-category">${this.getCategoryLabel(restaurant.category)}</div>
                            <div class="restaurant-price">${this.getPriceLabel(restaurant.priceRange)}</div>
                        </div>

                        <p class="restaurant-description">${restaurant.description}</p>

                        <div class="restaurant-cuisine-types">
                            <strong>요리 종류:</strong>
                            ${(restaurant.cuisineType || []).map(type =>
                                `<span class="cuisine-tag">${type}</span>`
                            ).join('')}
                        </div>

                        <div class="restaurant-detail-info">
                            <div class="info-item">
                                <strong>운영시간:</strong> ${restaurant.openingHours || '확인 필요'}
                            </div>
                            ${restaurant.phone ? `
                            <div class="info-item">
                                <strong>전화번호:</strong>
                                <a href="tel:${restaurant.phone}">${restaurant.phone}</a>
                            </div>` : ''}
                            ${restaurant.address ? `
                            <div class="info-item">
                                <strong>주소:</strong> ${restaurant.address}
                            </div>` : ''}
                            ${restaurant.averagePrice ? `
                            <div class="info-item">
                                <strong>평균 가격:</strong> ${restaurant.averagePrice}
                            </div>` : ''}
                        </div>

                        ${restaurant.specialties && restaurant.specialties.length > 0 ? `
                        <div class="restaurant-specialties">
                            <strong>추천 메뉴:</strong>
                            <ul>
                                ${restaurant.specialties.map(specialty => `<li>${specialty}</li>`).join('')}
                            </ul>
                        </div>` : ''}

                        ${restaurant.tips ? `
                        <div class="restaurant-tips">
                            <strong>팁:</strong> ${restaurant.tips}
                        </div>` : ''}
                    </div>
                    <div class="modal-actions">
                        ${restaurant.phone ? `
                        <button class="btn-primary" onclick="diningManager.callRestaurant('${restaurant.phone}')">
                            전화 예약
                        </button>` : ''}
                        ${restaurant.coordinates ? `
                        <button class="btn-secondary" onclick="diningManager.getDirections(${restaurant.coordinates.lat}, ${restaurant.coordinates.lng})">
                            길찾기
                        </button>` : ''}
                        <button class="btn-secondary" onclick="this.closest('.modal').remove()">
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 기존 모달 제거 후 새 모달 추가
        const existingModal = document.getElementById('restaurant-modal');
        if (existingModal) {
            existingModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    callRestaurant(phone) {
        // 모바일에서는 전화 앱으로 연결
        window.location.href = `tel:${phone}`;
    }

    getDirections(lat, lng) {
        // Google Maps 길찾기 열기
        const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        window.open(url, '_blank');
    }

    // 주변 레스토랑 찾기
    async findNearbyRestaurants(userLat, userLng, radiusKm = 5) {
        const nearbyRestaurants = this.restaurants.filter(restaurant => {
            if (!restaurant.coordinates || !restaurant.coordinates.lat || !restaurant.coordinates.lng) {
                return false;
            }

            const distance = this.calculateDistance(
                userLat, userLng,
                restaurant.coordinates.lat, restaurant.coordinates.lng
            );

            return distance <= radiusKm;
        });

        // 거리순으로 정렬
        nearbyRestaurants.sort((a, b) => {
            const distA = this.calculateDistance(userLat, userLng, a.coordinates.lat, a.coordinates.lng);
            const distB = this.calculateDistance(userLat, userLng, b.coordinates.lat, b.coordinates.lng);
            return distA - distB;
        });

        return nearbyRestaurants;
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

    // 카테고리별 통계
    getCategoryStats() {
        const stats = {};
        this.restaurants.forEach(restaurant => {
            const category = restaurant.category || 'unknown';
            stats[category] = (stats[category] || 0) + 1;
        });
        return stats;
    }

    // 가격대별 통계
    getPriceStats() {
        const stats = {};
        this.restaurants.forEach(restaurant => {
            const price = restaurant.priceRange || 'unknown';
            stats[price] = (stats[price] || 0) + 1;
        });
        return stats;
    }

    // 평점 높은 레스토랑 추천
    getTopRatedRestaurants(limit = 5) {
        return [...this.restaurants]
            .filter(restaurant => restaurant.rating && restaurant.rating > 0)
            .sort((a, b) => (b.rating || 0) - (a.rating || 0))
            .slice(0, limit);
    }

    // 통계 정보
    getStats() {
        return {
            total: this.restaurants.length,
            filtered: this.filteredRestaurants.length,
            categories: Object.keys(this.getCategoryStats()).length,
            averageRating: this.restaurants
                .filter(r => r.rating)
                .reduce((sum, r) => sum + r.rating, 0) / this.restaurants.filter(r => r.rating).length || 0
        };
    }
}

// 전역 인스턴스 생성
const diningManager = new DiningManager();

// 전역 접근을 위해 window에 할당
if (typeof window !== 'undefined') {
    window.diningManager = diningManager;
}

export { DiningManager, diningManager };
export default diningManager;