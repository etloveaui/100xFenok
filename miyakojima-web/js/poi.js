// 미야코지마 웹 플랫폼 - POI 관리 및 추천 모듈
// Miyakojima Web Platform - POI Management and Recommendation Module

/**
 * POI 관리 클래스
 */
class POIManager {
    constructor() {
        this.pois = [];
        this.filteredPOIs = [];
        this.currentFilters = {
            category: '',
            search: '',
            distance: CONFIG.POI.DEFAULT_RADIUS,
            preferences: CONFIG.PERSONALIZATION.PREFERENCES,
            avoid: CONFIG.PERSONALIZATION.AVOID
        };
        this.userLocation = null;
        this.favorites = [];
        this.visited = [];
        this.recommendations = [];
        
        this.init();
    }
    
    async init() {
        Logger.info('POI 관리자 초기화 중...');
        
        // POI 데이터 로드
        await this.loadPOIData();
        
        // 사용자 선호도 로드
        this.loadUserPreferences();
        
        // 이벤트 리스너 설정
        this.setupEventListeners();
        
        // 위치 관리자 콜백 등록
        if (window.locationManager) {
            window.locationManager.onLocationUpdate((location) => {
                this.userLocation = location;
                this.updateLocationBasedRecommendations();
            });
        }
        
        // 초기 UI 업데이트
        await this.updateUI();
        
        Logger.info('POI 관리자 초기화 완료:', this.pois.length + '개 POI 로드됨');
    }
    
    /**
     * POI 데이터 로드
     */
    async loadPOIData() {
        try {
            // 캐시된 POI 데이터 확인
            const cachedPOIs = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.POI_DATA);
            
            if (cachedPOIs && Array.isArray(cachedPOIs)) {
                this.pois = cachedPOIs;
                Logger.info('캐시된 POI 데이터 로드됨:', this.pois.length + '개');
            } else {
                // POI 파일에서 로드
                const response = await fetch('./data/miyakojima_pois.json');
                const poiData = await response.json();

                // 새로운 데이터 구조 처리 (v4.0.0+)
                if (poiData.pois && Array.isArray(poiData.pois)) {
                    this.pois = poiData.pois;
                    Logger.info('POI 데이터 파일에서 로드됨:', this.pois.length + '개 (v' + poiData.version + ')');
                } else if (Array.isArray(poiData)) {
                    // 이전 버전 호환성
                    this.pois = poiData;
                    Logger.info('POI 데이터 파일에서 로드됨:', this.pois.length + '개 (레거시 형식)');
                } else {
                    throw new Error('POI 데이터 형식이 올바르지 않습니다');
                }

                // 캐시에 저장
                const expiration = Date.now() + CONFIG.STORAGE.CACHE_DURATION.POI;
                StorageUtils.set(CONFIG.STORAGE.CACHE_KEYS.POI_DATA, this.pois, expiration);
            }
            
            // POI 데이터 전처리
            this.preprocessPOIData();
            
        } catch (error) {
            Logger.error('POI 데이터 로드 실패:', error);
            this.pois = [];
        }
    }
    
    /**
     * POI 데이터 전처리
     */
    preprocessPOIData() {
        this.pois.forEach(poi => {
            // 거리 계산 (사용자 위치가 있는 경우)
            if (this.userLocation) {
                poi.distance = LocationUtils.calculateDistance(
                    this.userLocation.lat,
                    this.userLocation.lng,
                    poi.coordinates.lat,
                    poi.coordinates.lng
                );
            }
            
            // 개인화 점수 계산
            poi.personalization_score = this.calculatePersonalizationScore(poi);
            
            // 혼잡도 현재 시간 기준 설정
            const currentHour = new Date().getHours();
            if (currentHour < 12) {
                poi.current_crowd_level = poi.crowd_level.morning;
            } else if (currentHour < 18) {
                poi.current_crowd_level = poi.crowd_level.afternoon;
            } else {
                poi.current_crowd_level = poi.crowd_level.evening;
            }
        });
    }
    
    /**
     * 사용자 선호도 로드
     */
    loadUserPreferences() {
        const userProfile = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.USER_PROFILE);
        
        if (userProfile) {
            this.favorites = userProfile.favorites || [];
            this.visited = userProfile.visited || [];
            Logger.info('사용자 선호도 로드됨:', {
                favorites: this.favorites.length,
                visited: this.visited.length
            });
        }
    }
    
    /**
     * 사용자 선호도 저장
     */
    saveUserPreferences() {
        const userProfile = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.USER_PROFILE) || {};
        userProfile.favorites = this.favorites;
        userProfile.visited = this.visited;
        userProfile.lastUpdated = Date.now();
        
        StorageUtils.set(CONFIG.STORAGE.CACHE_KEYS.USER_PROFILE, userProfile);
    }
    
    /**
     * 개인화 점수 계산
     */
    calculatePersonalizationScore(poi) {
        let score = 0;
        const weights = CONFIG.PERSONALIZATION.WEIGHTS;
        
        // 기본 평점 가중치
        score += poi.rating * weights.rating;
        
        // 선호 태그 가중치
        if (poi.tags && Array.isArray(poi.tags)) {
            const preferenceMatches = poi.tags.filter(tag => 
                this.currentFilters.preferences.includes(tag)
            ).length;
            score += preferenceMatches * weights.preferences;
        }
        
        // 회피 태그 감점
        if (poi.tags && Array.isArray(poi.tags)) {
            const avoidMatches = poi.tags.filter(tag => 
                this.currentFilters.avoid.includes(tag)
            ).length;
            score += avoidMatches * weights.avoid; // 음수 가중치
        }
        
        // 혼잡도 감점
        score += (10 - poi.current_crowd_level) * Math.abs(weights.crowd);
        
        // 즐겨찾기 보너스
        if (this.favorites.includes(poi.id)) {
            score += 2;
        }
        
        // 이미 방문한 곳 감점
        if (this.visited.includes(poi.id)) {
            score -= 1;
        }
        
        return Math.max(0, score);
    }
    
    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 검색 입력
        const searchInput = DOMUtils.$('#poi-search');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.currentFilters.search = e.target.value.trim();
                    this.filterAndUpdatePOIs();
                }, 300);
            });
        }
        
        // 카테고리 필터
        const categoryFilter = DOMUtils.$('#category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.currentFilters.category = e.target.value;
                this.filterAndUpdatePOIs();
            });
        }
        
        // 추천 새로고침 버튼
        const refreshRecommendations = DOMUtils.$('#refresh-recommendations');
        if (refreshRecommendations) {
            refreshRecommendations.addEventListener('click', () => {
                this.updateLocationBasedRecommendations();
            });
        }
        
        Logger.log('POI 이벤트 리스너 설정 완료');
    }
    
    /**
     * POI 필터링 및 UI 업데이트
     */
    async filterAndUpdatePOIs() {
        this.filteredPOIs = this.pois.filter(poi => {
            // 카테고리 필터
            if (this.currentFilters.category && poi.category !== this.currentFilters.category) {
                return false;
            }
            
            // 검색어 필터
            if (this.currentFilters.search) {
                const searchTerm = this.currentFilters.search.toLowerCase();
                const searchableText = [
                    poi.name,
                    poi.name_japanese,
                    poi.description,
                    poi.address,
                    ...(poi.tags || [])
                ].join(' ').toLowerCase();
                
                if (!searchableText.includes(searchTerm)) {
                    return false;
                }
            }
            
            // 거리 필터 (사용자 위치가 있는 경우)
            if (this.userLocation && poi.distance && poi.distance > this.currentFilters.distance) {
                return false;
            }
            
            return true;
        });
        
        // 개인화 점수로 정렬
        this.filteredPOIs.sort((a, b) => b.personalization_score - a.personalization_score);
        
        await this.updatePOIListUI();
    }
    
    /**
     * 주변 POI 검색
     */
    async searchNearbyPOIs(lat, lng, radius = CONFIG.POI.DEFAULT_RADIUS) {
        this.userLocation = { lat, lng };
        
        // 모든 POI에 대해 거리 계산
        this.pois.forEach(poi => {
            poi.distance = LocationUtils.calculateDistance(lat, lng, poi.coordinates.lat, poi.coordinates.lng);
        });
        
        // 반경 내 POI 필터링
        this.filteredPOIs = this.pois.filter(poi => poi.distance <= radius);
        
        // 거리순 정렬 후 개인화 점수 적용
        this.filteredPOIs.sort((a, b) => {
            const scoreA = a.personalization_score + (1 / (a.distance + 1)) * 1000;
            const scoreB = b.personalization_score + (1 / (b.distance + 1)) * 1000;
            return scoreB - scoreA;
        });
        
        await this.updatePOIListUI();
        
        this.showToast(`${radius}m 반경에서 ${this.filteredPOIs.length}개 장소를 찾았습니다.`, 'success');
        
        return this.filteredPOIs;
    }
    
    /**
     * 위치 기반 추천 업데이트
     */
    async updateLocationBasedRecommendations() {
        if (!this.userLocation) return;
        
        try {
            // 현재 위치 근처의 상위 추천 장소들
            const nearbyPOIs = this.pois
                .filter(poi => {
                    const distance = LocationUtils.calculateDistance(
                        this.userLocation.lat,
                        this.userLocation.lng,
                        poi.coordinates.lat,
                        poi.coordinates.lng
                    );
                    return distance <= 5000; // 5km 반경
                })
                .map(poi => ({
                    ...poi,
                    distance: LocationUtils.calculateDistance(
                        this.userLocation.lat,
                        this.userLocation.lng,
                        poi.coordinates.lat,
                        poi.coordinates.lng
                    )
                }))
                .sort((a, b) => b.personalization_score - a.personalization_score)
                .slice(0, 5);
            
            this.recommendations = nearbyPOIs;
            this.updateRecommendationUI();
            
            Logger.info('위치 기반 추천 업데이트됨:', this.recommendations.length + '개');
            
        } catch (error) {
            Logger.error('위치 기반 추천 업데이트 실패:', error);
        }
    }
    
    /**
     * 추천 UI 업데이트
     */
    updateRecommendationUI() {
        const container = DOMUtils.$('#recommendations-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.recommendations.length === 0) {
            container.innerHTML = '<p class="text-center text-secondary">추천 장소를 찾는 중...</p>';
            return;
        }
        
        this.recommendations.forEach(poi => {
            const category = CONFIG.POI.CATEGORIES[poi.category];
            const recElement = DOMUtils.createElement('div', 'recommendation-item', `
                <div class="rec-icon">${poi.icon || category?.icon || '📍'}</div>
                <div class="rec-content">
                    <h5>${poi.name}</h5>
                    <p>${poi.description}</p>
                </div>
                <div class="rec-meta">
                    <span class="rec-distance">${poi.distance ? LocationUtils.formatDistance(poi.distance) : ''}</span>
                    <span class="rec-rating">★${poi.rating}</span>
                </div>
            `);
            
            // 클릭 이벤트 추가
            recElement.addEventListener('click', () => {
                this.showPOIDetail(poi.id);
            });
            
            container.appendChild(recElement);
        });
    }
    
    /**
     * POI 리스트 UI 업데이트
     */
    async updatePOIListUI() {
        const container = DOMUtils.$('#poi-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.filteredPOIs.length === 0) {
            container.innerHTML = `
                <div class="no-results">
                    <p>검색 결과가 없습니다.</p>
                    <button class="btn-secondary" onclick="window.poiManager.clearFilters()">필터 초기화</button>
                </div>
            `;
            return;
        }
        
        // 결과 수 표시
        const resultsCount = DOMUtils.createElement('div', 'results-count', `
            <p>${this.filteredPOIs.length}개의 장소를 찾았습니다.</p>
        `);
        container.appendChild(resultsCount);
        
        // POI 카드들 생성
        this.filteredPOIs.slice(0, 20).forEach(poi => { // 최대 20개까지만 표시
            const poiCard = this.createPOICard(poi);
            container.appendChild(poiCard);
        });
    }
    
    /**
     * POI 카드 생성
     */
    createPOICard(poi) {
        const category = CONFIG.POI.CATEGORIES[poi.category];
        const isFavorite = this.favorites.includes(poi.id);
        const isVisited = this.visited.includes(poi.id);
        
        const card = DOMUtils.createElement('div', 'poi-card', `
            <div class="poi-header">
                <div class="poi-icon" style="color: ${category?.color || '#666'}">
                    ${poi.icon || category?.icon || '📍'}
                </div>
                <div class="poi-info">
                    <h4 class="poi-name">${poi.name}</h4>
                    <p class="poi-category">${category?.name || poi.category}</p>
                </div>
                <div class="poi-actions">
                    <button class="btn-icon favorite-btn ${isFavorite ? 'active' : ''}" data-poi-id="${poi.id}">
                        ${isFavorite ? '❤️' : '🤍'}
                    </button>
                </div>
            </div>
            
            <div class="poi-content">
                <p class="poi-description">${poi.description}</p>
                
                <div class="poi-meta">
                    <div class="poi-rating">
                        <span class="rating-stars">★</span>
                        <span class="rating-value">${poi.rating}</span>
                    </div>
                    
                    ${poi.distance ? `
                        <div class="poi-distance">
                            <span class="distance-icon">📍</span>
                            <span class="distance-value">${LocationUtils.formatDistance(poi.distance)}</span>
                        </div>
                    ` : ''}
                    
                    ${poi.price_level !== 'free' ? `
                        <div class="poi-price">
                            <span class="price-icon">💰</span>
                            <span class="price-level">${this.getPriceLevelText(poi.price_level)}</span>
                        </div>
                    ` : '<span class="free-badge">무료</span>'}
                </div>
                
                <div class="poi-details">
                    <div class="poi-hours">
                        <strong>운영시간:</strong> ${poi.contact.hours}
                    </div>
                    
                    ${poi.amenities && poi.amenities.length > 0 ? `
                        <div class="poi-amenities">
                            <strong>편의시설:</strong> ${poi.amenities.join(', ')}
                        </div>
                    ` : ''}
                    
                    ${poi.activities && poi.activities.length > 0 ? `
                        <div class="poi-activities">
                            <strong>활동:</strong> ${poi.activities.join(', ')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="poi-footer">
                    <button class="btn-primary poi-detail-btn" data-poi-id="${poi.id}">
                        자세히 보기
                    </button>
                    
                    ${poi.distance ? `
                        <button class="btn-secondary poi-navigate-btn" data-poi-id="${poi.id}">
                            길찾기
                        </button>
                    ` : ''}
                    
                    ${isVisited ? `
                        <span class="visited-badge">방문완료</span>
                    ` : `
                        <button class="btn-secondary poi-visit-btn" data-poi-id="${poi.id}">
                            방문 기록
                        </button>
                    `}
                </div>
            </div>
        `);
        
        // 이벤트 리스너 추가
        this.addPOICardEventListeners(card, poi);
        
        return card;
    }
    
    /**
     * POI 카드 이벤트 리스너 추가
     */
    addPOICardEventListeners(card, poi) {
        // 즐겨찾기 버튼
        const favoriteBtn = card.querySelector('.favorite-btn');
        favoriteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFavorite(poi.id);
        });
        
        // 자세히 보기 버튼
        const detailBtn = card.querySelector('.poi-detail-btn');
        detailBtn?.addEventListener('click', () => {
            this.showPOIDetail(poi.id);
        });
        
        // 길찾기 버튼
        const navigateBtn = card.querySelector('.poi-navigate-btn');
        navigateBtn?.addEventListener('click', () => {
            this.startNavigation(poi);
        });
        
        // 방문 기록 버튼
        const visitBtn = card.querySelector('.poi-visit-btn');
        visitBtn?.addEventListener('click', () => {
            this.markAsVisited(poi.id);
        });
        
        // 카드 전체 클릭
        card.addEventListener('click', (e) => {
            // 버튼 클릭이 아닌 경우에만
            if (!e.target.closest('button')) {
                this.showPOIDetail(poi.id);
            }
        });
    }
    
    /**
     * 즐겨찾기 토글
     */
    toggleFavorite(poiId) {
        const index = this.favorites.indexOf(poiId);
        const favoriteBtn = DOMUtils.$(`[data-poi-id="${poiId}"].favorite-btn`);
        
        if (index > -1) {
            // 즐겨찾기 제거
            this.favorites.splice(index, 1);
            if (favoriteBtn) {
                favoriteBtn.textContent = '🤍';
                favoriteBtn.classList.remove('active');
            }
            this.showToast('즐겨찾기에서 제거했습니다.', 'info');
        } else {
            // 즐겨찾기 추가
            this.favorites.push(poiId);
            if (favoriteBtn) {
                favoriteBtn.textContent = '❤️';
                favoriteBtn.classList.add('active');
            }
            this.showToast('즐겨찾기에 추가했습니다.', 'success');
            DeviceUtils.vibrate([100]);
        }
        
        this.saveUserPreferences();
        
        // 개인화 점수 재계산
        this.preprocessPOIData();
    }
    
    /**
     * 방문 완료 표시
     */
    markAsVisited(poiId) {
        if (!this.visited.includes(poiId)) {
            this.visited.push(poiId);
            this.saveUserPreferences();
            
            const poi = this.pois.find(p => p.id === poiId);
            this.showToast(`${poi?.name}을(를) 방문 완료로 표시했습니다.`, 'success');
            
            // UI 업데이트
            this.filterAndUpdatePOIs();
            
            // 백엔드에 전송
            this.syncVisitedToBackend(poiId);
        }
    }
    
    /**
     * POI 상세 정보 표시
     */
    showPOIDetail(poiId) {
        const poi = this.pois.find(p => p.id === poiId);
        if (!poi) return;
        
        // 상세 정보 모달 생성 (간단한 구현)
        const modal = DOMUtils.createElement('div', 'modal open', `
            <div class="modal-content poi-detail-modal">
                <div class="modal-header">
                    <h3>${poi.name}</h3>
                    <button class="modal-close">&times;</button>
                </div>
                
                <div class="poi-detail-content">
                    <div class="poi-detail-header">
                        <div class="poi-main-info">
                            <p class="poi-japanese-name">${poi.name_japanese}</p>
                            <p class="poi-full-description">${poi.description}</p>
                        </div>
                        
                        <div class="poi-rating-large">
                            <span class="rating-stars">★★★★★</span>
                            <span class="rating-value">${poi.rating}</span>
                        </div>
                    </div>
                    
                    <div class="poi-contact-info">
                        <h4>연락처 & 정보</h4>
                        <div class="contact-grid">
                            <div class="contact-item">
                                <strong>주소:</strong> ${poi.address}
                            </div>
                            <div class="contact-item">
                                <strong>운영시간:</strong> ${poi.contact.hours}
                            </div>
                            ${poi.contact.phone ? `
                                <div class="contact-item">
                                    <strong>전화:</strong> 
                                    <a href="tel:${poi.contact.phone}">${poi.contact.phone}</a>
                                </div>
                            ` : ''}
                            ${poi.average_price ? `
                                <div class="contact-item">
                                    <strong>평균 가격:</strong> ${NumberUtils.formatCurrency(poi.average_price)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    ${poi.amenities && poi.amenities.length > 0 ? `
                        <div class="poi-amenities-detail">
                            <h4>편의시설</h4>
                            <div class="amenities-list">
                                ${poi.amenities.map(amenity => `<span class="amenity-tag">${amenity}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <div class="poi-actions-large">
                        ${this.userLocation ? `
                            <button class="btn-primary" onclick="window.poiManager.startNavigation('${poiId}')">
                                길찾기 시작
                            </button>
                        ` : ''}
                        
                        <button class="btn-secondary" onclick="window.poiManager.addToItinerary('${poiId}')">
                            일정에 추가
                        </button>
                        
                        ${!this.visited.includes(poiId) ? `
                            <button class="btn-secondary" onclick="window.poiManager.markAsVisited('${poiId}')">
                                방문 완료
                            </button>
                        ` : '<span class="visited-badge">방문 완료</span>'}
                    </div>
                </div>
            </div>
        `);
        
        document.body.appendChild(modal);
        
        // 닫기 이벤트
        const closeBtn = modal.querySelector('.modal-close');
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('open');
            setTimeout(() => document.body.removeChild(modal), 300);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('open');
                setTimeout(() => document.body.removeChild(modal), 300);
            }
        });
    }
    
    /**
     * 길찾기 시작
     */
    startNavigation(poi) {
        if (typeof poi === 'string') {
            poi = this.pois.find(p => p.id === poi);
        }
        
        if (!poi) return;
        
        const destination = `${poi.coordinates.lat},${poi.coordinates.lng}`;
        let origin = '';
        
        if (this.userLocation) {
            origin = `${this.userLocation.lat},${this.userLocation.lng}`;
        }
        
        // Google Maps 길찾기 URL
        const mapsUrl = `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${origin}` : ''}&destination=${destination}&travelmode=driving`;
        
        window.open(mapsUrl, '_blank');
        
        this.showToast(`${poi.name}으로 길찾기를 시작합니다.`, 'success');
    }
    
    /**
     * 일정에 추가
     */
    addToItinerary(poiId) {
        // 일정 관리자가 있다면 호출
        if (window.itinerary) {
            window.itinerary.addPOIToItinerary(poiId);
        } else {
            this.showToast('일정 관리 기능을 준비 중입니다...', 'info');
        }
    }
    
    /**
     * 필터 초기화
     */
    clearFilters() {
        this.currentFilters = {
            category: '',
            search: '',
            distance: CONFIG.POI.DEFAULT_RADIUS,
            preferences: CONFIG.PERSONALIZATION.PREFERENCES,
            avoid: CONFIG.PERSONALIZATION.AVOID
        };
        
        // UI 초기화
        const searchInput = DOMUtils.$('#poi-search');
        const categoryFilter = DOMUtils.$('#category-filter');
        
        if (searchInput) searchInput.value = '';
        if (categoryFilter) categoryFilter.value = '';
        
        // 전체 POI 표시
        this.filteredPOIs = [...this.pois];
        this.updatePOIListUI();
        
        this.showToast('필터가 초기화되었습니다.', 'info');
    }
    
    /**
     * 가격 레벨 텍스트 반환
     */
    getPriceLevelText(priceLevel) {
        const levels = {
            'low': '저렴',
            'medium': '보통',
            'high': '비쌈',
            'varies': '다양'
        };
        return levels[priceLevel] || priceLevel;
    }
    
    /**
     * 위치 기반 추천 가져오기
     */
    async getLocationBasedRecommendations(lat, lng) {
        const nearbyPOIs = this.pois
            .map(poi => ({
                ...poi,
                distance: LocationUtils.calculateDistance(lat, lng, poi.coordinates.lat, poi.coordinates.lng)
            }))
            .filter(poi => poi.distance <= 2000) // 2km 반경
            .sort((a, b) => b.personalization_score - a.personalization_score)
            .slice(0, 10);
        
        return nearbyPOIs;
    }
    
    /**
     * 백엔드에 방문 기록 동기화
     */
    async syncVisitedToBackend(poiId) {
        try {
            if (NetworkUtils.isOnline() && window.backendAPI) {
                const visitData = {
                    poi_id: poiId,
                    visited_date: DateUtils.formatDate(new Date()),
                    trip_day: DateUtils.getTripDay()
                };
                
                await window.backendAPI.addPOIReview(poiId, visitData);
                Logger.info('방문 기록 백엔드 동기화 완료');
            }
        } catch (error) {
            Logger.warn('방문 기록 백엔드 동기화 실패:', error);
        }
    }
    
    /**
     * 오늘의 추천 가져오기 (다른 모듈에서 사용)
     */
    async getTodayRecommendations() {
        if (!this.userLocation) {
            return [];
        }
        
        try {
            await this.updateLocationBasedRecommendations();
            return this.recommendations.slice(0, 3);
        } catch (error) {
            Logger.error('오늘의 추천 가져오기 실패:', error);
            return [];
        }
    }
    
    /**
     * 사용자 데이터 동기화 (다른 모듈에서 사용)
     */
    async syncUserData() {
        try {
            if (NetworkUtils.isOnline() && window.backendAPI) {
                const userData = {
                    favorites: this.favorites,
                    visited: this.visited,
                    lastSync: Date.now()
                };
                
                await window.backendAPI.syncUserPreferences(userData);
                Logger.info('사용자 POI 데이터 백엔드 동기화 완료');
                return true;
            }
        } catch (error) {
            Logger.warn('사용자 POI 데이터 동기화 실패:', error);
            return false;
        }
    }
    
    /**
     * UI 업데이트
     */
    async updateUI() {
        await this.filterAndUpdatePOIs();
        this.updateRecommendationUI();
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

// 추가 CSS 스타일
const poiStyle = document.createElement('style');
poiStyle.textContent = `
    .poi-card {
        background: white;
        border-radius: 12px;
        margin-bottom: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        transition: all 0.3s ease;
        cursor: pointer;
    }
    
    .poi-card:hover {
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        transform: translateY(-2px);
    }
    
    .poi-header {
        display: flex;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid #eee;
    }
    
    .poi-icon {
        font-size: 24px;
        margin-right: 12px;
    }
    
    .poi-info {
        flex: 1;
    }
    
    .poi-name {
        margin: 0 0 4px 0;
        font-weight: 600;
    }
    
    .poi-category {
        margin: 0;
        color: #666;
        font-size: 14px;
    }
    
    .poi-content {
        padding: 16px;
    }
    
    .poi-description {
        color: #555;
        margin-bottom: 12px;
    }
    
    .poi-meta {
        display: flex;
        gap: 16px;
        margin-bottom: 12px;
        font-size: 14px;
    }
    
    .poi-details {
        background: #f8f9fa;
        padding: 12px;
        border-radius: 6px;
        margin-bottom: 12px;
        font-size: 14px;
    }
    
    .poi-footer {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
    }
    
    .favorite-btn.active {
        color: #e91e63;
    }
    
    .visited-badge {
        background: #4caf50;
        color: white;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 12px;
    }
    
    .free-badge {
        background: #2196f3;
        color: white;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 12px;
    }
    
    .no-results {
        text-align: center;
        padding: 32px;
        color: #666;
    }
    
    .results-count {
        padding: 8px 16px;
        background: #f0f0f0;
        border-radius: 6px;
        margin-bottom: 16px;
        font-size: 14px;
    }
    
    .poi-detail-modal .modal-content {
        max-width: 600px;
    }
    
    .amenity-tag {
        display: inline-block;
        background: #e3f2fd;
        color: #1976d2;
        padding: 4px 8px;
        margin: 2px;
        border-radius: 4px;
        font-size: 12px;
    }
`;
document.head.appendChild(poiStyle);

// 전역 접근을 위한 인스턴스 생성
window.poiManager = null;

// 모듈 상태 관리
window.POIStatus = {
    isReady: false,
    init: async () => {
        window.poiManager = new POIManager();
        window.POIStatus.isReady = true;
        
        // 모듈 초기화 완료 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'poi' }
        }));
        
        Logger.info('POI 관리자 초기화 완료');
    }
};

// 중앙 초기화 시스템에 의해 호출됨 (DOMContentLoaded 제거)
// document.addEventListener('DOMContentLoaded', () => {
//     window.poiManager = new POIManager();
// });

Logger.info('POI 관리 및 추천 모듈 로드 완료');