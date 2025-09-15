// 미야코지마 웹 플랫폼 - 설정 파일
// Miyakojima Web Platform - Configuration

const CONFIG = {
    // 프로젝트 정보
    APP_NAME: '미야코지마 여행 컴패니언',
    APP_VERSION: '1.0.0',
    
    // 여행 기본 정보
    TRIP_INFO: {
        START_DATE: '2025-09-27',
        END_DATE: '2025-10-01',
        TOTAL_DAYS: 5,
        TRAVELERS: {
            PRIMARY: '김은태',
            COMPANION: '정유민'
        },
        BLOOD_TYPE: 'AB',
        COMMUNICATION: '현지 유심'
    },
    
    // Google Apps Script 백엔드 (배포 후 업데이트 필요)
    BACKEND: {
        GAS_URL: '', // 빈 문자열로 설정하여 오프라인 모드 강제
        SHEET_ID: 'YOUR_GOOGLE_SHEET_ID',
        TIMEOUT: 10000, // 10초 타임아웃
        OFFLINE_MODE: true // 오프라인 모드 강제 활성화
    },
    
    // 무료 외부 API 설정
    APIS: {
        // Google Maps APIs (무료 한도 내)
        GOOGLE_MAPS: {
            API_KEY: 'AIzaSyB4vV_c6bHMk0CZUSZe58paVa41MGzP4sY',
            PROJECT_ID: 'miyakojima-poi-sync',
            JAVASCRIPT_API_URL: 'https://maps.googleapis.com/maps/api/js',
            DIRECTIONS_API_URL: 'https://maps.googleapis.com/maps/api/directions/json',
            PLACES_API_URL: 'https://maps.googleapis.com/maps/api/place',
            GEOCODING_API_URL: 'https://maps.googleapis.com/maps/api/geocode/json',
            CACHE_DURATION: 3600000 // 1시간 캐시
        },

        // Gemini AI API (무료 250 requests/day)
        GEMINI: {
            API_KEY: 'AIzaSyB4vV_c6bHMk0CZUSZe58paVa41MGzP4sY',
            BASE_URL: 'https://generativelanguage.googleapis.com/v1/models',
            MODEL: 'gemini-2.5-flash',
            CACHE_DURATION: 1800000 // 30분 캐시
        },

        // 환율 API (무료 1,500 requests/month)
        EXCHANGE_RATE: {
            URL: 'https://api.exchangerate-api.com/v4/latest/JPY',
            CACHE_DURATION: 3600000 // 1시간 캐시
        },

        // 날씨 API (무료 1,000 requests/day) - API 키 필요
        WEATHER: {
            URL: 'https://api.openweathermap.org/data/2.5',
            API_KEY: '62c85ff5eff6e712643db50c03ec5beb',
            CACHE_DURATION: 1800000 // 30분 캐시
        },

        // 지오코딩 API (무료 2,500 requests/day) - API 키 필요
        GEOCODING: {
            URL: 'https://api.opencagedata.com/geocode/v1/json',
            API_KEY: 'YOUR_OPENCAGE_API_KEY',
            CACHE_DURATION: 86400000 // 24시간 캐시
        },

        // Google Translation API (무료 500,000자/월) - 여행 필수 기능
        TRANSLATION: {
            API_KEY: 'AIzaSyB4vV_c6bHMk0CZUSZe58paVa41MGzP4sY',
            BASE_URL: 'https://translation.googleapis.com/language/translate/v2',
            SOURCE_LANG: 'ko',
            TARGET_LANGS: ['ja', 'en'], // 일본어, 영어
            CACHE_DURATION: 86400000 // 24시간 캐시 (번역 결과)
        },

        // Google Speech-to-Text API (무료 60분/월) - 음성 명령
        SPEECH_TO_TEXT: {
            API_KEY: 'AIzaSyB4vV_c6bHMk0CZUSZe58paVa41MGzP4sY',
            BASE_URL: 'https://speech.googleapis.com/v1/speech:recognize',
            LANGUAGE_CODES: ['ko-KR', 'ja-JP'], // 한국어, 일본어
            SAMPLE_RATE: 16000
        },

        // Google Text-to-Speech API (무료 400만자/월) - 음성 안내
        TEXT_TO_SPEECH: {
            API_KEY: 'AIzaSyB4vV_c6bHMk0CZUSZe58paVa41MGzP4sY',
            BASE_URL: 'https://texttospeech.googleapis.com/v1/text:synthesize',
            VOICES: {
                ko: { languageCode: 'ko-KR', name: 'ko-KR-Standard-A' },
                ja: { languageCode: 'ja-JP', name: 'ja-JP-Standard-A' }
            }
        },

        // Google Vision AI (무료 1,000개 이미지/월) - 사진 분석
        VISION_AI: {
            API_KEY: 'AIzaSyB4vV_c6bHMk0CZUSZe58paVa41MGzP4sY',
            BASE_URL: 'https://vision.googleapis.com/v1/images:annotate',
            FEATURES: ['LABEL_DETECTION', 'LANDMARK_DETECTION', 'TEXT_DETECTION'],
            MAX_RESULTS: 10
        }
    },
    
    // 미야코지마 지리 정보
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
        },
        TIMEZONE: 'Asia/Tokyo'
    },
    
    // 예산 설정
    BUDGET: {
        DAILY_TOTAL: 20000, // 일일 총 예산 (JPY)
        CATEGORIES: {
            meals: { limit: 8000, name: '식비', icon: '🍽️' },
            transportation: { limit: 5000, name: '교통', icon: '🚗' },
            activities: { limit: 4000, name: '액티비티', icon: '🏖️' },
            shopping: { limit: 3000, name: '쇼핑', icon: '🛍️' },
            other: { limit: 0, name: '기타', icon: '💳' }
        },
        ALERTS: {
            WARNING_THRESHOLD: 0.8, // 80% 사용 시 경고
            DANGER_THRESHOLD: 0.95   // 95% 사용 시 위험
        },
        EXCHANGE_RATE_DEFAULT: 8.7 // JPY to KRW 기본값
    },
    
    // POI 필터링 설정
    POI: {
        MAX_DISTANCE: 50000,        // 최대 검색 거리 (미터)
        DEFAULT_RADIUS: 2000,       // 기본 검색 반경 (미터)
        RESULTS_LIMIT: 20,          // 최대 결과 수
        CATEGORIES: {
            nature_views: { name: '자연 경관', icon: '🌅', color: '#4CAF50' },
            dining_cafe: { name: '식당/카페', icon: '🍽️', color: '#FF9800' },
            shopping: { name: '쇼핑', icon: '🛍️', color: '#9C27B0' },
            culture_spots: { name: '문화 명소', icon: '🏛️', color: '#3F51B5' },
            transportation: { name: '교통', icon: '🚗', color: '#607D8B' },
            marine_activities: { name: '해양 활동', icon: '🏄‍♀️', color: '#00BCD4' },
            accommodations: { name: '숙박', icon: '🏨', color: '#795548' },
            emergency: { name: '응급', icon: '🏥', color: '#F44336' },
            experience_activities: { name: '체험 활동', icon: '🎯', color: '#FF5722' }
        }
    },
    
    // 개인화 설정 (traveler_profile.json 기반)
    PERSONALIZATION: {
        TRAVEL_STYLE: 'luxury_relaxed',
        PREFERENCES: ['girlfriend_surprises', 'photo_spots', 'premium_hotel_services', 'private_experiences'],
        AVOID: ['long_queue', 'crowded_places'],
        LANGUAGE_LEVEL: 'beginner_japanese',
        
        // 추천 가중치
        WEIGHTS: {
            distance: 0.3,      // 거리 가중치
            rating: 0.25,       // 평점 가중치  
            preferences: 0.2,   // 선호도 가중치
            avoid: -0.15,       // 회피 가중치
            crowd: -0.1         // 혼잡도 가중치
        }
    },
    
    // 브라우저 API 설정
    BROWSER_APIS: {
        GEOLOCATION: {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 30000
        },
        CAMERA: {
            video: {
                facingMode: 'environment', // 후면 카메라
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        },
        SPEECH: {
            lang: 'ko-KR',
            continuous: false,
            interimResults: false
        }
    },
    
    // 캐싱 및 저장소 설정
    STORAGE: {
        PREFIX: 'miyakojima_',
        CACHE_KEYS: {
            POI_DATA: 'poi_cache',
            USER_PROFILE: 'user_profile',
            BUDGET_DATA: 'budget_cache',
            ITINERARY: 'itinerary_cache',
            LOCATION_HISTORY: 'location_history',
            OFFLINE_QUEUE: 'offline_queue'
        },
        CACHE_DURATION: {
            POI: 86400000,      // 24시간
            WEATHER: 1800000,   // 30분
            EXCHANGE: 3600000,  // 1시간
            LOCATION: 300000    // 5분
        }
    },
    
    // 오프라인 및 PWA 설정
    PWA: {
        CACHE_NAME: 'miyakojima-v1',
        STATIC_CACHE: [
            '/',
            '/index.html',
            '/css/main.css',
            '/css/mobile.css',
            '/js/config.js',
            '/js/utils.js',
            '/js/app.js',
            '/manifest.json'
        ],
        DYNAMIC_CACHE: [
            '/data/',
            '/api/'
        ],
        OFFLINE_FALLBACK: '/offline.html'
    },
    
    // 무료 할당량 모니터링
    RATE_LIMITS: {
        // Google Maps APIs (일일 기준, 여유분 10% 남김)
        MAPS_JAVASCRIPT: {
            daily: 933,     // 28,000/월 ÷ 30일
            monthly: 28000
        },
        DIRECTIONS: {
            daily: 83,      // 2,500/월 ÷ 30일
            monthly: 2500
        },
        PLACES: {
            daily: 83,      // 2,500/월 ÷ 30일
            monthly: 2500
        },
        MAPS_GEOCODING: {
            daily: 1333,    // 40,000/월 ÷ 30일
            monthly: 40000
        },

        // Gemini AI API
        GEMINI: {
            daily: 250,     // 무료 250 requests/day
            per_minute: 10, // RPM 한도
            tokens_per_minute: 250000 // TPM 한도
        },

        EXCHANGE_RATE: {
            daily: 50,      // 1500/월 ÷ 30일
            monthly: 1500
        },
        WEATHER: {
            daily: 900,     // 여유분 100 남김
            hourly: 40
        },
        GEOCODING: {
            daily: 2250,    // 여유분 250 남김
            hourly: 100
        },
        GAS_BACKEND: {
            per_minute: 20,
            per_hour: 1200
        },

        // Google Cloud AI APIs (추가)
        TRANSLATION: {
            monthly: 500000, // 문자 단위
            daily: 16666    // 월간 한도를 30일로 나눈 값
        },
        SPEECH_TO_TEXT: {
            monthly: 60,    // 분 단위
            daily: 2        // 월간 한도를 30일로 나눈 값
        },
        TEXT_TO_SPEECH: {
            monthly: 4000000, // 문자 단위 (표준)
            daily: 133333     // 월간 한도를 30일로 나눈 값
        },
        VISION_AI: {
            monthly: 1000,    // 이미지 단위
            daily: 33         // 월간 한도를 30일로 나눈 값
        }
    },
    
    // 디버그 및 개발 설정
    DEBUG: {
        ENABLED: true,      // 배포 시 false로 변경
        LOG_LEVEL: 'info',  // error, warn, info, debug
        MOCK_GPS: false,    // GPS 모킹 여부
        MOCK_DATA: false    // 데이터 모킹 여부
    },
    
    // UI 설정
    UI: {
        ANIMATION_DURATION: 300,
        TOAST_DURATION: 3000,
        FAB_MENU_ITEMS: ['expense', 'camera', 'location', 'note'],
        DATE_FORMAT: 'YYYY-MM-DD',
        TIME_FORMAT: 'HH:mm',
        CURRENCY_FORMAT: '¥{amount}',
        
        // 테마 색상 (CSS 변수와 동기화)
        COLORS: {
            PRIMARY: '#00bcd4',
            SECONDARY: '#ff9800', 
            SUCCESS: '#4caf50',
            WARNING: '#ff9800',
            ERROR: '#f44336',
            INFO: '#2196f3'
        }
    }
};

// 환경별 설정 오버라이드
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // 개발 환경 설정
    CONFIG.DEBUG.ENABLED = true;
    CONFIG.DEBUG.LOG_LEVEL = 'debug';
    CONFIG.BACKEND.TIMEOUT = 30000; // 개발 시 더 긴 타임아웃
    
    // 개발용 모킹 설정
    CONFIG.DEBUG.MOCK_GPS = true;
    CONFIG.LOCATION.CENTER = { lat: 24.7392, lng: 125.2814, name: '개발 테스트 위치' };
}

// 설정 유효성 검사
function validateConfig() {
    const errors = [];
    
    // API 키 체크 (배포 시)
    if (!CONFIG.DEBUG.ENABLED) {
        if (CONFIG.APIS.WEATHER.API_KEY === 'YOUR_OPENWEATHER_API_KEY') {
            errors.push('OpenWeather API 키가 설정되지 않았습니다.');
        }
        if (CONFIG.APIS.GEOCODING.API_KEY === 'YOUR_OPENCAGE_API_KEY') {
            errors.push('OpenCage API 키가 설정되지 않았습니다.');
        }
        if (CONFIG.BACKEND.GAS_URL.includes('YOUR_SCRIPT_ID')) {
            errors.push('Google Apps Script URL이 설정되지 않았습니다.');
        }
    }
    
    // 예산 카테고리 총합 체크
    const totalBudget = Object.values(CONFIG.BUDGET.CATEGORIES)
        .reduce((sum, cat) => sum + cat.limit, 0);
    if (totalBudget > CONFIG.BUDGET.DAILY_TOTAL) {
        errors.push(`카테고리별 예산 합계(${totalBudget})가 일일 총 예산(${CONFIG.BUDGET.DAILY_TOTAL})을 초과합니다.`);
    }
    
    if (errors.length > 0) {
        console.error('설정 오류:', errors);
        return false;
    }
    
    return true;
}

// 설정 정보 로깅
function logConfigInfo() {
    if (CONFIG.DEBUG.ENABLED) {
        console.log('🏝️ 미야코지마 웹 플랫폼 설정 로드됨');
        console.log('📅 여행 기간:', CONFIG.TRIP_INFO.START_DATE, '~', CONFIG.TRIP_INFO.END_DATE);
        console.log('💰 일일 예산:', CONFIG.BUDGET.DAILY_TOTAL, 'JPY');
        console.log('🗺️ POI 카테고리:', Object.keys(CONFIG.POI.CATEGORIES).length, '개');
        console.log('⚡ 디버그 모드:', CONFIG.DEBUG.ENABLED ? '활성' : '비활성');
    }
}

// 전역 접근 가능하도록 설정
window.CONFIG = CONFIG;
window.validateConfig = validateConfig;

// 모듈 상태 관리
window.ConfigStatus = {
    isReady: false,
    init: () => {
        console.log('🔧 CONFIG 초기화 시작!');
        
        try {
            validateConfig();
            logConfigInfo();
            window.ConfigStatus.isReady = true;
            
            console.log('✅ CONFIG 초기화 성공!');
            
            // 모듈 초기화 완료 이벤트 발생
            window.dispatchEvent(new CustomEvent('moduleReady', { 
                detail: { moduleName: 'config' }
            }));
        } catch (error) {
            console.error('❌ CONFIG 초기화 실패:', error);
            throw error;
        }
    }
};

// ConfigStatus 즉시 초기화 실행
if (typeof window !== 'undefined') {
    window.ConfigStatus.init();
}

// 설정 내보내기 (ES6 모듈 지원 시)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}