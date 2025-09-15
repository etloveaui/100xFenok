// js/config.js
class ConfigManager {
    constructor() {
        this.config = {
            DEBUG: { ENABLED: true },
            APIS: {
                WEATHER: {
                    URL: 'https://api.openweathermap.org/data/2.5',
                    API_KEY: '62c85ff5eff6e712643db50c03ec5beb'
                }
            },
            BUDGET: {
                EXCHANGE_RATE_DEFAULT: 8.7
            },
            TRIP_INFO: {
                START_DATE: '2025-09-27',
                END_DATE: '2025-10-01',
                TOTAL_DAYS: 5,
                TRAVELERS: {
                    PRIMARY: '김은태',
                    COMPANION: '정유민'
                }
            },
            LOCATION: {
                CENTER: {
                    lat: 24.7392,
                    lng: 125.2814,
                    name: '미야코지마 중심부'
                },
                BOUNDS: {
                    north: 24.8,
                    south: 24.65,
                    east: 125.35,
                    west: 125.2
                }
            },
            POI: {
                MAX_DISTANCE: 50000,
                DEFAULT_RADIUS: 2000,
                RESULTS_LIMIT: 20,
                CATEGORIES: {
                    nature_views: { name: '자연 경관', icon: '🌅', color: '#4CAF50' },
                    dining_cafe: { name: '식당/카페', icon: '🍽️', color: '#FF9800' },
                    shopping: { name: '쇼핑', icon: '🛍️', color: '#9C27B0' },
                    culture_spots: { name: '문화 명소', icon: '🏛️', color: '#3F51B5' },
                    marine_activities: { name: '해양 활동', icon: '🏄‍♀️', color: '#00BCD4' }
                }
            },
            STORAGE: {
                PREFIX: 'miyakojima_',
                CACHE_KEYS: {
                    POI_DATA: 'poi_cache',
                    USER_PROFILE: 'user_profile',
                    BUDGET_DATA: 'budget_cache',
                    ITINERARY: 'itinerary_cache'
                }
            },
            UI: {
                ANIMATION_DURATION: 300,
                TOAST_DURATION: 3000,
                DATE_FORMAT: 'YYYY-MM-DD',
                TIME_FORMAT: 'HH:mm'
            }
        };
    }

    async initialize() {
        // 환경별 설정 로딩 (필요시)
        window.CONFIG = this.config;
        console.log('✅ CONFIG 초기화 완료');
        return this.config;
    }

    get(key, defaultValue = null) {
        return this.config[key] ?? defaultValue;
    }
}

export const CONFIG = new ConfigManager();