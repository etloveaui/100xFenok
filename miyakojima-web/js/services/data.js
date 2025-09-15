// js/services/data.js
class DataServiceClass {
    constructor() {
        this.cache = new Map();
        this.loading = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            console.log('✅ 데이터 서비스 이미 초기화됨');
            return;
        }

        console.log('🔄 데이터 서비스 초기화...');

        // 핵심 데이터 병렬 로딩
        try {
            const results = await Promise.allSettled([
                this.loadPOIs(),
                this.loadBudgetData(),
                this.loadItineraryData(),
                this.loadRestaurantsData()
            ]);

            const failed = results.filter(result => result.status === 'rejected');
            if (failed.length > 0) {
                console.log(`⚠️ ${failed.length}개 데이터 로딩 실패, 기본값으로 대체`);
                failed.forEach((result, index) => {
                    console.error(`- 실패한 데이터 ${index + 1}:`, result.reason?.message);
                });
            }

            this.initialized = true;
            console.log('✅ 데이터 서비스 초기화 완료');
            console.log('📊 로딩된 데이터:', this.getCacheStatus());
        } catch (error) {
            console.error('❌ 데이터 서비스 초기화 실패:', error);
            this.loadMockData();
            this.initialized = true;
        }
    }

    async loadPOIs() {
        try {
            const data = await this.loadJSON('pois', './data/miyakojima_pois.json');

            // 실제 데이터 구조에 맞게 변환
            if (data && data.pois && Array.isArray(data.pois)) {
                const transformedPOIs = data.pois.map(poi => ({
                    id: poi.id,
                    name: poi.name,
                    nameEn: poi.nameEn || '',
                    category: poi.category,
                    description: poi.description || '',
                    openHours: poi.openHours || '',
                    coordinates: poi.coordinates || { lat: 0, lng: 0 },
                    features: poi.features || [],
                    address: poi.address || '',
                    tips: poi.tips || '',
                    accessibility: poi.accessibility || {}
                }));

                console.log(`✅ POI 데이터 변환 완료: ${transformedPOIs.length}개`);
                this.cache.set('pois', transformedPOIs);
                this.cache.set('pois_categories', data.categories || {});
                return transformedPOIs;
            }

            throw new Error('Invalid POI data structure');
        } catch (error) {
            console.log('POI 데이터 로딩 실패, 기본값 사용');
            const mockPOIs = [
                {
                    id: 'yonaha-maehama-beach',
                    name: '요나하 마에하마 해변',
                    nameEn: 'Yonaha Maehama Beach',
                    category: 'nature',
                    description: '동양 최고의 해변으로 불리는 7km 백사장',
                    coordinates: { lat: 24.6912, lng: 125.1543 },
                    features: ['해변', '일몰 명소', '수영'],
                    openHours: '24시간'
                }
            ];
            this.cache.set('pois', mockPOIs);
            return mockPOIs;
        }
    }

    async loadBudgetData() {
        try {
            const data = await this.loadJSON('budget', './data/budget_data.json');

            // 예산 데이터 전처리
            if (data && data.confirmed_expenses) {
                console.log(`✅ 예산 데이터 로딩 성공`);
                this.cache.set('budget', data);
                return data;
            }

            throw new Error('Invalid budget data structure');
        } catch (error) {
            console.log('예산 데이터 로딩 실패, 기본값 사용');
            const mockBudget = {
                confirmed_expenses: {
                    transportation: { rental_car: '25,000 JPY' },
                    accommodation: { total: '1,630,658 KRW' },
                    flights: '855,600 KRW'
                },
                expense_categories: {
                    dining: {},
                    activities: {},
                    shopping: {}
                }
            };
            this.cache.set('budget', mockBudget);
            return mockBudget;
        }
    }

    async loadItineraryData() {
        try {
            const data = await this.loadJSON('itinerary', './data/itinerary_data.json');

            // 일정 데이터 전처리
            if (data && data.daily_schedule) {
                console.log(`✅ 일정 데이터 로딩 성공: ${Object.keys(data.daily_schedule).length}일`);
                this.cache.set('itinerary', data);
                return data;
            }

            throw new Error('Invalid itinerary data structure');
        } catch (error) {
            console.log('일정 데이터 로딩 실패, 기본값 사용');
            const mockItinerary = {
                trip_overview: {
                    duration: '4박 5일',
                    dates: '2025-09-27 ~ 2025-10-01'
                },
                daily_schedule: {
                    day1: {
                        date: '2025-09-27',
                        theme: '도착 & 호텔 적응',
                        schedule: {
                            '08:10': { activity: '인천공항 출발', location: 'ICN' }
                        }
                    }
                }
            };
            this.cache.set('itinerary', mockItinerary);
            return mockItinerary;
        }
    }

    async loadJSON(key, url, maxRetries = 3) {
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        if (this.loading.has(key)) {
            return await this.loading.get(key);
        }

        const loadPromise = this._loadWithRetry(key, url, maxRetries);
        this.loading.set(key, loadPromise);

        try {
            const data = await loadPromise;
            this.cache.set(key, data);
            return data;
        } finally {
            this.loading.delete(key);
        }
    }

    async _loadWithRetry(key, url, maxRetries) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 ${key} 로딩 시도 ${attempt}/${maxRetries}: ${url}`);

                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                console.log(`✅ ${key} 로딩 성공 (${data.pois?.length || data.length || 'N/A'} items)`);
                return data;
            } catch (error) {
                lastError = error;
                console.warn(`⚠️ ${key} 로딩 실패 (시도 ${attempt}/${maxRetries}):`, error.message);

                if (attempt < maxRetries) {
                    const delay = attempt * 1000; // 점진적 지연
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        console.error(`❌ ${key} 로딩 최종 실패:`, lastError);
        throw lastError;
    }

    loadMockData() {
        // 기본 목업 데이터 설정
        this.cache.set('pois', []);
        this.cache.set('budget', { confirmed_expenses: {} });
        this.cache.set('itinerary', {});
        console.log('✅ 기본 데이터 로딩 완료');
    }

    get(key) {
        return this.cache.get(key);
    }

    // 추가 데이터 로딩 메서드들
    async loadRestaurantsData() {
        try {
            const data = await this.loadJSON('restaurants', './data/restaurants.json');
            if (data && data.restaurants) {
                console.log(`✅ 레스토랑 데이터 로딩 성공: ${data.restaurants.length}개`);
                this.cache.set('restaurants', data);
                return data;
            }
            throw new Error('Invalid restaurants data structure');
        } catch (error) {
            console.log('레스토랑 데이터 로딩 실패, 기본값 사용');
            const mockRestaurants = { restaurants: [] };
            this.cache.set('restaurants', mockRestaurants);
            return mockRestaurants;
        }
    }

    // 캐시 상태 확인
    getCacheStatus() {
        const status = {};
        for (const [key, value] of this.cache.entries()) {
            if (Array.isArray(value)) {
                status[key] = `${value.length} items`;
            } else if (value && typeof value === 'object') {
                status[key] = 'loaded';
            } else {
                status[key] = 'unknown';
            }
        }
        return status;
    }

    // 데이터 새로고침
    async refresh(keys = []) {
        if (keys.length === 0) {
            this.cache.clear();
            this.initialized = false;
            return await this.initialize();
        }

        for (const key of keys) {
            this.cache.delete(key);
        }

        // 삭제된 키들만 다시 로딩
        const reloadPromises = [];
        if (keys.includes('pois')) reloadPromises.push(this.loadPOIs());
        if (keys.includes('budget')) reloadPromises.push(this.loadBudgetData());
        if (keys.includes('itinerary')) reloadPromises.push(this.loadItineraryData());
        if (keys.includes('restaurants')) reloadPromises.push(this.loadRestaurantsData());

        return await Promise.allSettled(reloadPromises);
    }
}

// 싱글톤 인스턴스 생성
const DataService = new DataServiceClass();

// 명명된 export와 default export 모두 제공
export { DataService };
export default DataService;

// 전역 할당 제거 - 모듈 시스템만 사용