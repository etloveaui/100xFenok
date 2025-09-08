// 미야코지마 웹 플랫폼 - API 연동 모듈
// Miyakojima Web Platform - API Integration Module

/**
 * Google Apps Script 백엔드 API 클래스
 */
class BackendAPI {
    constructor() {
        this.baseUrl = CONFIG.BACKEND.GAS_URL;
        this.timeout = CONFIG.BACKEND.TIMEOUT;
        this.rateLimiter = new RateLimiter('backend', CONFIG.RATE_LIMITS.GAS_BACKEND);
    }
    
    // 기본 POST 요청
    async request(action, payload = {}) {
        // 백엔드 URL이 비어있으면 오프라인 모드
        if (!this.baseUrl || this.baseUrl.includes('YOUR_SCRIPT_ID') || CONFIG.BACKEND.OFFLINE_MODE) {
            throw new Error('백엔드가 구성되지 않았습니다. 오프라인 모드로 실행됩니다.');
        }
        
        if (!NetworkUtils.isOnline()) {
            throw new Error('오프라인 상태입니다. 나중에 다시 시도하세요.');
        }
        
        if (!this.rateLimiter.canMakeRequest()) {
            throw new Error('요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.');
        }
        
        try {
            Logger.info(`백엔드 API 호출: ${action}`, payload);
            
            const response = await NetworkUtils.fetchWithTimeout(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: action,
                    payload: payload,
                    timestamp: Date.now(),
                    user: CONFIG.TRIP_INFO.TRAVELERS.PRIMARY
                })
            }, this.timeout);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.rateLimiter.recordRequest();
            
            Logger.info(`백엔드 응답 받음: ${action}`, data);
            return data;
            
        } catch (error) {
            Logger.error(`백엔드 API 오류 (${action}):`, error);
            
            // 오프라인 큐에 추가
            if (NetworkUtils.isOnline()) {
                OfflineQueue.add(action, payload);
            }
            
            throw error;
        }
    }
    
    // 예산 관련 API
    async addExpense(expenseData) {
        return await this.request('add_expense', expenseData);
    }
    
    async getBudgetStatus(date = null) {
        return await this.request('get_budget_status', { date });
    }
    
    async updateBudgetCategory(category, amount) {
        return await this.request('update_budget_category', { category, amount });
    }
    
    // 일정 관련 API
    async updateItinerary(itineraryData) {
        return await this.request('update_itinerary', itineraryData);
    }
    
    async getItinerary(date) {
        return await this.request('get_itinerary', { date });
    }
    
    // POI 관련 API
    async getPOIRecommendations(locationData) {
        return await this.request('get_poi_recommendations', locationData);
    }
    
    async addPOIReview(poiId, reviewData) {
        return await this.request('add_poi_review', { poi_id: poiId, ...reviewData });
    }
    
    // 사용자 선호도 업데이트
    async updateUserPreferences(preferences) {
        return await this.request('update_preferences', preferences);
    }
}

/**
 * 환율 API 클래스
 */
class ExchangeRateAPI {
    constructor() {
        this.baseUrl = CONFIG.APIS.EXCHANGE_RATE.URL;
        this.cacheDuration = CONFIG.APIS.EXCHANGE_RATE.CACHE_DURATION;
        this.rateLimiter = new RateLimiter('exchange', CONFIG.RATE_LIMITS.EXCHANGE_RATE);
    }
    
    async getRate(fromCurrency = 'JPY', toCurrency = 'KRW') {
        const cacheKey = `exchange_${fromCurrency}_${toCurrency}`;
        
        // 캐시 확인
        const cached = StorageUtils.get(cacheKey);
        if (cached) {
            Logger.info('환율 정보 캐시에서 로드됨', cached);
            return cached;
        }
        
        if (!this.rateLimiter.canMakeRequest()) {
            Logger.warn('환율 API 한도 초과, 기본값 사용');
            return CONFIG.BUDGET.EXCHANGE_RATE_DEFAULT;
        }
        
        try {
            const response = await NetworkUtils.fetchWithTimeout(this.baseUrl, {}, 10000);
            const data = await response.json();
            
            const rate = data.rates[toCurrency];
            if (!rate) {
                throw new Error(`${toCurrency} 환율을 찾을 수 없습니다.`);
            }
            
            this.rateLimiter.recordRequest();
            
            // 캐시 저장
            const expiration = Date.now() + this.cacheDuration;
            StorageUtils.set(cacheKey, rate, expiration);
            
            Logger.info('환율 정보 업데이트됨:', { from: fromCurrency, to: toCurrency, rate });
            return rate;
            
        } catch (error) {
            Logger.error('환율 API 오류:', error);
            return CONFIG.BUDGET.EXCHANGE_RATE_DEFAULT;
        }
    }
    
    async convertAmount(amount, fromCurrency = 'JPY', toCurrency = 'KRW') {
        const rate = await this.getRate(fromCurrency, toCurrency);
        return Math.round(amount * rate);
    }
}

/**
 * 날씨 API 클래스
 */
class WeatherAPI {
    constructor() {
        this.baseUrl = CONFIG.APIS.WEATHER.URL;
        this.apiKey = CONFIG.APIS.WEATHER.API_KEY;
        this.location = CONFIG.LOCATION.CENTER;
        this.rateLimiter = new RateLimiter('weather', CONFIG.RATE_LIMITS.WEATHER);
    }
    
    async getCurrentWeather() {
        const cacheKey = 'current_weather';
        
        // 캐시 확인 (30분)
        const cached = StorageUtils.get(cacheKey);
        if (cached) {
            return cached;
        }
        
        if (!this.rateLimiter.canMakeRequest()) {
            throw new Error('날씨 API 요청 한도 초과');
        }
        
        try {
            const url = `${this.baseUrl}/weather?lat=${this.location.lat}&lon=${this.location.lng}&appid=${this.apiKey}&units=metric&lang=kr`;
            
            const response = await NetworkUtils.fetchWithTimeout(url, {}, 10000);
            const data = await response.json();
            
            const weather = {
                temperature: Math.round(data.main.temp),
                description: data.weather[0].description,
                icon: data.weather[0].icon,
                humidity: data.main.humidity,
                windSpeed: data.wind.speed,
                pressure: data.main.pressure,
                feelsLike: Math.round(data.main.feels_like),
                timestamp: Date.now()
            };
            
            this.rateLimiter.recordRequest();
            
            // 캐시 저장 (30분)
            const expiration = Date.now() + CONFIG.STORAGE.CACHE_DURATION.WEATHER;
            StorageUtils.set(cacheKey, weather, expiration);
            
            Logger.info('현재 날씨 정보 업데이트됨:', weather);
            return weather;
            
        } catch (error) {
            Logger.error('날씨 API 오류:', error);
            throw error;
        }
    }
    
    async getForecast(days = 5) {
        const cacheKey = `forecast_${days}days`;
        
        // 캐시 확인
        const cached = StorageUtils.get(cacheKey);
        if (cached) {
            return cached;
        }
        
        if (!this.rateLimiter.canMakeRequest()) {
            throw new Error('날씨 예보 API 요청 한도 초과');
        }
        
        try {
            const url = `${this.baseUrl}/forecast?lat=${this.location.lat}&lon=${this.location.lng}&appid=${this.apiKey}&units=metric&lang=kr&cnt=${days * 8}`; // 3시간 간격
            
            const response = await NetworkUtils.fetchWithTimeout(url, {}, 10000);
            const data = await response.json();
            
            // 일별로 그룹화
            const forecast = [];
            const dailyData = {};
            
            data.list.forEach(item => {
                const date = item.dt_txt.split(' ')[0];
                if (!dailyData[date]) {
                    dailyData[date] = [];
                }
                dailyData[date].push(item);
            });
            
            Object.entries(dailyData).forEach(([date, items]) => {
                const dayData = items[Math.floor(items.length / 2)]; // 중간 시간대 선택
                forecast.push({
                    date: date,
                    temperature: {
                        min: Math.round(Math.min(...items.map(i => i.main.temp_min))),
                        max: Math.round(Math.max(...items.map(i => i.main.temp_max)))
                    },
                    description: dayData.weather[0].description,
                    icon: dayData.weather[0].icon,
                    humidity: dayData.main.humidity,
                    windSpeed: dayData.wind.speed
                });
            });
            
            this.rateLimiter.recordRequest();
            
            // 캐시 저장 (1시간)
            const expiration = Date.now() + 3600000;
            StorageUtils.set(cacheKey, forecast, expiration);
            
            Logger.info(`${days}일 날씨 예보 업데이트됨:`, forecast);
            return forecast;
            
        } catch (error) {
            Logger.error('날씨 예보 API 오류:', error);
            throw error;
        }
    }
}

/**
 * 지오코딩 API 클래스
 */
class GeocodingAPI {
    constructor() {
        this.baseUrl = CONFIG.APIS.GEOCODING.URL;
        this.apiKey = CONFIG.APIS.GEOCODING.API_KEY;
        this.rateLimiter = new RateLimiter('geocoding', CONFIG.RATE_LIMITS.GEOCODING);
    }
    
    async getAddressFromCoords(lat, lng) {
        const cacheKey = `geocode_${lat.toFixed(4)}_${lng.toFixed(4)}`;
        
        // 캐시 확인
        const cached = StorageUtils.get(cacheKey);
        if (cached) {
            return cached;
        }
        
        if (!this.rateLimiter.canMakeRequest()) {
            throw new Error('지오코딩 API 요청 한도 초과');
        }
        
        try {
            const url = `${this.baseUrl}?q=${lat}+${lng}&key=${this.apiKey}&language=ko&pretty=1`;
            
            const response = await NetworkUtils.fetchWithTimeout(url, {}, 10000);
            const data = await response.json();
            
            if (!data.results || data.results.length === 0) {
                throw new Error('주소를 찾을 수 없습니다.');
            }
            
            const result = data.results[0];
            const address = {
                formatted: result.formatted,
                components: result.components,
                confidence: result.confidence
            };
            
            this.rateLimiter.recordRequest();
            
            // 캐시 저장 (24시간)
            const expiration = Date.now() + CONFIG.STORAGE.CACHE_DURATION.POI;
            StorageUtils.set(cacheKey, address, expiration);
            
            Logger.info('주소 변환 완료:', address);
            return address;
            
        } catch (error) {
            Logger.error('지오코딩 API 오류:', error);
            throw error;
        }
    }
    
    async getCoordsFromAddress(address) {
        const cacheKey = `reverse_geocode_${address}`;
        
        // 캐시 확인
        const cached = StorageUtils.get(cacheKey);
        if (cached) {
            return cached;
        }
        
        if (!this.rateLimiter.canMakeRequest()) {
            throw new Error('지오코딩 API 요청 한도 초과');
        }
        
        try {
            const url = `${this.baseUrl}?q=${encodeURIComponent(address)}&key=${this.apiKey}&language=ko&pretty=1&bounds=${CONFIG.LOCATION.BOUNDS.south},${CONFIG.LOCATION.BOUNDS.west},${CONFIG.LOCATION.BOUNDS.north},${CONFIG.LOCATION.BOUNDS.east}`;
            
            const response = await NetworkUtils.fetchWithTimeout(url, {}, 10000);
            const data = await response.json();
            
            if (!data.results || data.results.length === 0) {
                throw new Error('좌표를 찾을 수 없습니다.');
            }
            
            const result = data.results[0];
            const coords = {
                lat: result.geometry.lat,
                lng: result.geometry.lng,
                confidence: result.confidence,
                address: result.formatted
            };
            
            this.rateLimiter.recordRequest();
            
            // 캐시 저장 (24시간)
            const expiration = Date.now() + CONFIG.STORAGE.CACHE_DURATION.POI;
            StorageUtils.set(cacheKey, coords, expiration);
            
            Logger.info('좌표 변환 완료:', coords);
            return coords;
            
        } catch (error) {
            Logger.error('역 지오코딩 API 오류:', error);
            throw error;
        }
    }
}

/**
 * API 요청 한도 관리 클래스
 */
class RateLimiter {
    constructor(apiName, limits) {
        this.apiName = apiName;
        this.limits = limits;
        this.storageKey = `rate_limit_${apiName}`;
    }
    
    canMakeRequest() {
        const usage = this.getUsage();
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // 일일 한도 확인
        if (this.limits.daily && usage[today] >= this.limits.daily) {
            Logger.warn(`${this.apiName} API 일일 한도 초과: ${usage[today]}/${this.limits.daily}`);
            return false;
        }
        
        // 시간별 한도 확인
        if (this.limits.hourly && usage[`${today}_${currentHour}`] >= this.limits.hourly) {
            Logger.warn(`${this.apiName} API 시간별 한도 초과`);
            return false;
        }
        
        // 분별 한도 확인
        if (this.limits.per_minute && usage[`${today}_${currentHour}_${currentMinute}`] >= this.limits.per_minute) {
            Logger.warn(`${this.apiName} API 분별 한도 초과`);
            return false;
        }
        
        return true;
    }
    
    recordRequest() {
        const usage = this.getUsage();
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // 사용량 증가
        usage[today] = (usage[today] || 0) + 1;
        if (this.limits.hourly) {
            usage[`${today}_${currentHour}`] = (usage[`${today}_${currentHour}`] || 0) + 1;
        }
        if (this.limits.per_minute) {
            usage[`${today}_${currentHour}_${currentMinute}`] = (usage[`${today}_${currentHour}_${currentMinute}`] || 0) + 1;
        }
        
        // 저장
        StorageUtils.set(this.storageKey, usage);
        
        Logger.log(`${this.apiName} API 사용량 기록:`, usage[today]);
    }
    
    getUsage() {
        return StorageUtils.get(this.storageKey) || {};
    }
    
    resetUsage() {
        StorageUtils.remove(this.storageKey);
    }
}

/**
 * 오프라인 큐 관리 클래스
 */
class OfflineQueue {
    static add(action, payload) {
        const queue = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.OFFLINE_QUEUE) || [];
        queue.push({
            id: Date.now(),
            action: action,
            payload: payload,
            timestamp: Date.now()
        });
        
        StorageUtils.set(CONFIG.STORAGE.CACHE_KEYS.OFFLINE_QUEUE, queue);
        Logger.info('오프라인 큐에 추가됨:', { action, payload });
    }
    
    static async processQueue() {
        if (!NetworkUtils.isOnline()) {
            Logger.warn('오프라인 상태로 큐 처리 불가');
            return;
        }
        
        const queue = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.OFFLINE_QUEUE) || [];
        if (queue.length === 0) return;
        
        Logger.info(`오프라인 큐 처리 시작: ${queue.length}개 항목`);
        
        const processed = [];
        const failed = [];
        
        for (const item of queue) {
            try {
                await window.backendAPI.request(item.action, item.payload);
                processed.push(item.id);
            } catch (error) {
                Logger.error('큐 항목 처리 실패:', error);
                failed.push(item);
            }
        }
        
        // 성공한 항목 제거
        const remainingQueue = queue.filter(item => !processed.includes(item.id));
        StorageUtils.set(CONFIG.STORAGE.CACHE_KEYS.OFFLINE_QUEUE, remainingQueue);
        
        Logger.info(`큐 처리 완료: 성공 ${processed.length}개, 실패 ${failed.length}개`);
    }
    
    static getQueueLength() {
        const queue = StorageUtils.get(CONFIG.STORAGE.CACHE_KEYS.OFFLINE_QUEUE) || [];
        return queue.length;
    }
    
    static clearQueue() {
        StorageUtils.remove(CONFIG.STORAGE.CACHE_KEYS.OFFLINE_QUEUE);
    }
}

// API 인스턴스 생성 (초기화 시 생성)
window.backendAPI = null;
window.exchangeAPI = null;
window.weatherAPI = null;
window.geocodingAPI = null;
window.OfflineQueue = OfflineQueue;

// 모듈 상태 관리
window.APIStatus = {
    isReady: false,
    init: async () => {
        // API 인스턴스 생성
        window.backendAPI = new BackendAPI();
        window.exchangeAPI = new ExchangeRateAPI();
        window.weatherAPI = new WeatherAPI();
        window.geocodingAPI = new GeocodingAPI();
        
        // 네트워크 이벤트 리스너 설정
        window.addEventListener('online', () => {
            Logger.info('온라인 상태로 변경됨');
            OfflineQueue.processQueue();
            
            const indicator = DOMUtils.$('#offline-indicator');
            if (indicator) {
                indicator.classList.remove('show');
            }
        });

        window.addEventListener('offline', () => {
            Logger.warn('오프라인 상태로 변경됨');
            
            const indicator = DOMUtils.$('#offline-indicator');
            if (indicator) {
                indicator.classList.add('show');
            }
        });
        
        // 온라인 상태에서 오프라인 큐 처리
        if (NetworkUtils.isOnline()) {
            await OfflineQueue.processQueue();
        }
        
        window.APIStatus.isReady = true;
        
        // 모듈 초기화 완룄 이벤트 발생
        window.dispatchEvent(new CustomEvent('moduleReady', { 
            detail: { moduleName: 'api' }
        }));
        
        Logger.info('API 모듈 초기화 완룄');
    }
};

// 전역 접근을 위한 내보내기
window.BackendAPI = BackendAPI;
window.ExchangeRateAPI = ExchangeRateAPI;
window.WeatherAPI = WeatherAPI;
window.GeocodingAPI = GeocodingAPI;
window.RateLimiter = RateLimiter;
window.OfflineQueue = OfflineQueue;

// 중앙 초기화 시스템에 의해 호출됨 (DOMContentLoaded 제거)
// document.addEventListener('DOMContentLoaded', () => {
//     if (NetworkUtils.isOnline()) {
//         OfflineQueue.processQueue();
//     }
//     Logger.info('API 모듈 초기화 완룄');
// });

Logger.info('API 연동 모듈 로드 완료');