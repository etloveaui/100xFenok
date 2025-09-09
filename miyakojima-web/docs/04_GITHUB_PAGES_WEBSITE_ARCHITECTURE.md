# GitHub Pages 기반 미야코지마 여행 웹사이트 아키텍처

## 1. 프로젝트 개요 및 목적

### 1.1 핵심 목적
- 김은태 & 정유민의 개인 홈페이지 내 **비밀 공간** 구현
- ChatGPT Projects의 GUI 한계 및 실시간성 부족 문제 해결
- 175개 POI 데이터를 시각적이고 인터랙티브하게 탐색
- 여행 중 **즉시 접근 가능한** 실시간 정보 제공

### 1.2 GitHub Pages 최적화 전략
```
GitHub Pages 제약사항 극복:
├── 정적 사이트 제한 → Client-side JavaScript 최대 활용
├── 서버 로직 불가 → API 연동 및 Browser Storage 활용
├── 데이터베이스 없음 → JSON 파일 + IndexedDB 조합
└── 실시간 업데이트 → Service Worker + 외부 API 연동
```

## 2. 사이트 구조 설계

### 2.1 전체 페이지 구조
```
miyakojima-travel/ (GitHub Pages 저장소)
├── index.html                    # 메인 랜딩 페이지
├── secret-travel/                 # 비밀 여행 공간 (URL 숨김)
│   ├── main.html                 # 여행 메인 대시보드
│   ├── real-time-map.html        # 실시간 지도 및 POI
│   ├── itinerary.html            # 인터랙티브 일정표
│   ├── budget-tracker.html       # 실시간 예산 추적
│   ├── translation-helper.html   # AI 번역 도우미
│   ├── emergency-guide.html      # 응급 상황 가이드
│   └── memory-book.html          # 여행 기록 및 사진첩
├── data/                         # JSON 데이터 파일들
│   ├── poi-database.json         # 175개 POI 완전 데이터
│   ├── dining-guide.json         # 음식점 가이드
│   ├── accommodations.json       # 숙소 정보
│   └── travel-checklist.json     # 체크리스트
├── assets/                       # 정적 자원
│   ├── css/                      # 스타일시트
│   ├── js/                       # JavaScript 모듈
│   ├── images/                   # 이미지 파일
│   └── icons/                    # 아이콘 및 파비콘
└── service-worker.js             # PWA 기능 구현
```

### 2.2 핵심 페이지 상세 설계

#### 2.2.1 main.html - 통합 대시보드
```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>미야코지마 여행 대시보드 - 은태♥유민</title>
    
    <!-- PWA 메타 태그 -->
    <meta name="theme-color" content="#2196F3">
    <link rel="manifest" href="../manifest.json">
    
    <!-- 외부 라이브러리 -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    
    <!-- 커스텀 스타일 -->
    <link rel="stylesheet" href="../assets/css/dashboard.css">
</head>
<body>
    <!-- 헤더 -->
    <header class="dashboard-header">
        <div class="header-content">
            <h1>🏝️ 미야코지마 여행</h1>
            <div class="travel-info">
                <span class="dates">2025.9.27 - 10.1</span>
                <span class="travelers">👫 은태 & 유민</span>
            </div>
        </div>
        
        <!-- 실시간 상태 -->
        <div class="status-bar">
            <div class="current-time">
                <i class="fas fa-clock"></i>
                <span id="current-time">--:--</span>
                <small>(JST)</small>
            </div>
            <div class="weather-widget">
                <i class="fas fa-sun"></i>
                <span id="weather-temp">--°C</span>
                <span id="weather-desc">Loading...</span>
            </div>
            <div class="budget-status">
                <i class="fas fa-yen-sign"></i>
                <span id="budget-remaining">--,--- JPY</span>
                <small>잔여</small>
            </div>
        </div>
    </header>

    <!-- 메인 네비게이션 -->
    <nav class="main-nav">
        <div class="nav-container">
            <button class="nav-btn active" data-page="dashboard">
                <i class="fas fa-tachometer-alt"></i>
                <span>대시보드</span>
            </button>
            <button class="nav-btn" data-page="map">
                <i class="fas fa-map-marked-alt"></i>
                <span>지도</span>
            </button>
            <button class="nav-btn" data-page="itinerary">
                <i class="fas fa-calendar-alt"></i>
                <span>일정</span>
            </button>
            <button class="nav-btn" data-page="budget">
                <i class="fas fa-calculator"></i>
                <span>예산</span>
            </button>
            <button class="nav-btn" data-page="translate">
                <i class="fas fa-language"></i>
                <span>번역</span>
            </button>
            <button class="nav-btn emergency" data-page="emergency">
                <i class="fas fa-exclamation-triangle"></i>
                <span>응급</span>
            </button>
        </div>
    </nav>

    <!-- 메인 컨텐츠 영역 -->
    <main class="main-content">
        <!-- 대시보드 섹션 -->
        <section id="dashboard-section" class="content-section active">
            <!-- 현재 위치 기반 추천 -->
            <div class="dashboard-card location-recommendations">
                <h2>📍 지금 여기서 뭐할까?</h2>
                <div class="current-location">
                    <span id="current-location-name">위치를 찾는 중...</span>
                    <button id="refresh-location" class="btn-icon">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
                
                <div class="recommendations-grid" id="location-recommendations">
                    <!-- 동적으로 생성될 추천 카드들 -->
                </div>
            </div>

            <!-- 오늘의 일정 -->
            <div class="dashboard-card today-schedule">
                <h2>📅 오늘의 일정</h2>
                <div class="schedule-timeline" id="today-timeline">
                    <!-- 동적으로 생성될 일정 타임라인 -->
                </div>
            </div>

            <!-- 즐겨찾기 POI -->
            <div class="dashboard-card favorite-pois">
                <h2>⭐ 즐겨찾는 장소</h2>
                <div class="poi-grid" id="favorite-poi-grid">
                    <!-- 즐겨찾기 POI 카드들 -->
                </div>
            </div>

            <!-- 빠른 액션 -->
            <div class="dashboard-card quick-actions">
                <h2>⚡ 빠른 액션</h2>
                <div class="action-buttons">
                    <button class="action-btn" id="find-restaurant">
                        <i class="fas fa-utensils"></i>
                        <span>근처 맛집</span>
                    </button>
                    <button class="action-btn" id="find-convenience">
                        <i class="fas fa-store"></i>
                        <span>편의점/마트</span>
                    </button>
                    <button class="action-btn" id="call-taxi">
                        <i class="fas fa-taxi"></i>
                        <span>택시 호출</span>
                    </button>
                    <button class="action-btn" id="translate-camera">
                        <i class="fas fa-camera"></i>
                        <span>카메라 번역</span>
                    </button>
                </div>
            </div>
        </section>

        <!-- 다른 섹션들은 JavaScript로 동적 로딩 -->
        <section id="map-section" class="content-section">
            <div id="interactive-map" class="full-height-map"></div>
        </section>

        <!-- 추가 섹션들... -->
    </main>

    <!-- 플로팅 액션 버튼 -->
    <div class="floating-actions">
        <button class="fab emergency-fab" id="emergency-button">
            <i class="fas fa-phone"></i>
        </button>
        <button class="fab translation-fab" id="quick-translate">
            <i class="fas fa-language"></i>
        </button>
    </div>

    <!-- JavaScript 모듈 로드 -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="../assets/js/core/app.js" type="module"></script>
    <script src="../assets/js/modules/dashboard.js" type="module"></script>
    <script src="../assets/js/modules/location-service.js" type="module"></script>
</body>
</html>
```

#### 2.2.2 real-time-map.html - 인터랙티브 지도
```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>실시간 지도 - 미야코지마</title>
    
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css">
    <link rel="stylesheet" href="../assets/css/map.css">
</head>
<body>
    <!-- 지도 컨트롤 헤더 -->
    <header class="map-header">
        <div class="map-controls">
            <button class="control-btn" id="my-location">
                <i class="fas fa-crosshairs"></i>
                <span>내 위치</span>
            </button>
            
            <!-- POI 카테고리 필터 -->
            <div class="category-filters">
                <button class="filter-btn active" data-category="all">
                    <i class="fas fa-globe"></i>
                    <span>전체</span>
                </button>
                <button class="filter-btn" data-category="dining">
                    <i class="fas fa-utensils"></i>
                    <span>음식 (25)</span>
                </button>
                <button class="filter-btn" data-category="shopping">
                    <i class="fas fa-shopping-bag"></i>
                    <span>쇼핑 (35)</span>
                </button>
                <button class="filter-btn" data-category="nature">
                    <i class="fas fa-mountain"></i>
                    <span>자연 (12)</span>
                </button>
                <button class="filter-btn" data-category="culture">
                    <i class="fas fa-museum"></i>
                    <span>문화 (27)</span>
                </button>
                <button class="filter-btn" data-category="emergency">
                    <i class="fas fa-hospital"></i>
                    <span>응급 (12)</span>
                </button>
            </div>
            
            <!-- 검색 및 필터 -->
            <div class="search-container">
                <input type="text" id="poi-search" placeholder="장소 검색..." class="search-input">
                <button id="search-btn" class="search-btn">
                    <i class="fas fa-search"></i>
                </button>
            </div>
        </div>
    </header>

    <!-- 메인 지도 -->
    <div id="main-map" class="main-map"></div>

    <!-- POI 상세 정보 패널 -->
    <div id="poi-detail-panel" class="poi-panel">
        <div class="panel-header">
            <h3 id="poi-name">POI 이름</h3>
            <button id="close-panel" class="close-btn">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="panel-content">
            <div class="poi-image">
                <img id="poi-image" src="" alt="POI 이미지">
            </div>
            
            <div class="poi-info">
                <div class="info-row">
                    <i class="fas fa-map-marker-alt"></i>
                    <span id="poi-address">주소</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-phone"></i>
                    <span id="poi-phone">전화번호</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-clock"></i>
                    <span id="poi-hours">운영시간</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-yen-sign"></i>
                    <span id="poi-price">가격대</span>
                </div>
            </div>
            
            <div class="poi-actions">
                <button class="action-btn primary" id="get-directions">
                    <i class="fas fa-directions"></i>
                    <span>길찾기</span>
                </button>
                <button class="action-btn" id="add-to-favorite">
                    <i class="fas fa-heart"></i>
                    <span>즐겨찾기</span>
                </button>
                <button class="action-btn" id="add-to-itinerary">
                    <i class="fas fa-plus"></i>
                    <span>일정 추가</span>
                </button>
            </div>
        </div>
    </div>

    <!-- 경로 안내 패널 -->
    <div id="directions-panel" class="directions-panel">
        <div class="directions-header">
            <h3>길찾기</h3>
            <div class="transport-options">
                <button class="transport-btn active" data-mode="driving">
                    <i class="fas fa-car"></i>
                </button>
                <button class="transport-btn" data-mode="walking">
                    <i class="fas fa-walking"></i>
                </button>
                <button class="transport-btn" data-mode="transit">
                    <i class="fas fa-bus"></i>
                </button>
            </div>
        </div>
        
        <div class="directions-content">
            <div class="route-summary">
                <div class="distance">거리: <span id="route-distance">--</span></div>
                <div class="duration">시간: <span id="route-duration">--</span></div>
                <div class="cost">비용: <span id="route-cost">--</span></div>
            </div>
            
            <div class="route-steps" id="route-steps">
                <!-- 경로 안내 단계별 표시 -->
            </div>
        </div>
    </div>

    <!-- JavaScript 모듈 -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js"></script>
    <script src="../assets/js/modules/map-manager.js" type="module"></script>
    <script src="../assets/js/modules/poi-service.js" type="module"></script>
    <script src="../assets/js/modules/directions-service.js" type="module"></script>
</body>
</html>
```

## 3. ChatGPT Projects 보완 기능

### 3.1 실시간성 보완
```javascript
// assets/js/modules/real-time-service.js
class RealTimeService {
    constructor() {
        this.updateInterval = 30000; // 30초마다 업데이트
        this.isOnline = navigator.onLine;
        this.setupEventListeners();
    }
    
    // 실시간 날씨 정보
    async updateWeatherInfo() {
        try {
            const response = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?lat=24.7456&lon=125.2456&appid=YOUR_API_KEY&units=metric&lang=kr`
            );
            const weatherData = await response.json();
            
            this.updateWeatherDisplay(weatherData);
            this.cacheWeatherData(weatherData); // 오프라인용 캐시
        } catch (error) {
            console.warn('날씨 정보 업데이트 실패:', error);
            this.loadCachedWeatherData();
        }
    }
    
    // POI 운영 상태 실시간 확인
    async checkPOIStatus(poiId) {
        const poi = await this.getPOIFromDatabase(poiId);
        const currentTime = new Date();
        const currentDay = currentTime.getDay();
        
        // 운영시간 파싱 및 확인
        const isOpen = this.checkOperatingHours(poi.hours, currentTime, currentDay);
        
        return {
            poiId: poiId,
            isOpen: isOpen,
            nextStatusChange: this.getNextStatusChange(poi.hours, currentTime),
            crowdLevel: await this.estimateCrowdLevel(poi, currentTime)
        };
    }
    
    // 교통 상황 실시간 업데이트
    async updateTrafficInfo(origin, destination) {
        try {
            // Google Maps Traffic API 또는 대안 서비스 활용
            const trafficData = await this.getTrafficData(origin, destination);
            return {
                duration: trafficData.duration,
                distance: trafficData.distance,
                trafficCondition: trafficData.condition, // 'light', 'moderate', 'heavy'
                alternativeRoutes: trafficData.alternatives
            };
        } catch (error) {
            // 오프라인 시 예상 시간 반환
            return this.getEstimatedTravelTime(origin, destination);
        }
    }
    
    // 예산 실시간 추적
    updateBudgetStatus(expense) {
        const currentBudget = this.loadBudgetFromStorage();
        
        currentBudget.spent += expense.amount;
        currentBudget.categories[expense.category] += expense.amount;
        currentBudget.remaining = currentBudget.total - currentBudget.spent;
        
        this.saveBudgetToStorage(currentBudget);
        this.updateBudgetDisplay(currentBudget);
        
        // 예산 초과 경고
        if (currentBudget.remaining < 0) {
            this.showBudgetWarning(currentBudget);
        }
        
        return currentBudget;
    }
}
```

### 3.2 GUI 인터랙션 강화
```javascript
// assets/js/modules/interactive-ui.js
class InteractiveUI {
    constructor() {
        this.setupTouchGestures();
        this.setupVoiceCommands();
        this.setupAdvancedAnimations();
    }
    
    // 터치 제스처 지원
    setupTouchGestures() {
        let startX, startY, endX, endY;
        
        document.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchend', (e) => {
            endX = e.changedTouches[0].clientX;
            endY = e.changedTouches[0].clientY;
            
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            
            // 스와이프 제스처 감지
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                if (deltaX > 0) {
                    this.handleSwipeRight();
                } else {
                    this.handleSwipeLeft();
                }
            }
        });
    }
    
    // 음성 명령 지원
    setupVoiceCommands() {
        if ('speechRecognition' in window || 'webkitSpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            
            this.recognition.lang = 'ko-KR';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            
            this.recognition.onresult = (event) => {
                const command = event.results[0][0].transcript.toLowerCase();
                this.processVoiceCommand(command);
            };
        }
    }
    
    processVoiceCommand(command) {
        if (command.includes('지도')) {
            this.navigateToMap();
        } else if (command.includes('맛집') || command.includes('음식')) {
            this.showNearbyRestaurants();
        } else if (command.includes('길찾기')) {
            this.startDirections();
        } else if (command.includes('번역')) {
            this.openTranslator();
        } else if (command.includes('응급') || command.includes('도움')) {
            this.showEmergencyInfo();
        }
    }
    
    // 고급 애니메이션 및 트랜지션
    setupAdvancedAnimations() {
        // 페이지 전환 애니메이션
        this.pageTransition = {
            duration: 300,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            effects: ['slide', 'fade', 'scale']
        };
        
        // POI 카드 애니메이션
        this.observePOICards();
        
        // 로딩 애니메이션
        this.setupLoadingAnimations();
    }
    
    observePOICards() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '50px'
        });
        
        document.querySelectorAll('.poi-card').forEach(card => {
            observer.observe(card);
        });
    }
}
```

### 3.3 오프라인 기능 구현
```javascript
// service-worker.js
const CACHE_NAME = 'miyakojima-travel-v1.0';
const urlsToCache = [
    '/secret-travel/',
    '/secret-travel/main.html',
    '/secret-travel/real-time-map.html',
    '/data/poi-database.json',
    '/data/dining-guide.json',
    '/assets/css/dashboard.css',
    '/assets/js/core/app.js',
    // 필수 외부 라이브러리
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // 캐시에서 찾으면 반환
                if (response) {
                    return response;
                }
                
                // 네트워크에서 가져오기 시도
                return fetch(event.request).then(response => {
                    // 유효한 응답인지 확인
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    
                    // 응답을 복사하여 캐시에 저장
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    
                    return response;
                });
            })
    );
});
```

## 4. 혁신적 기능 설계

### 4.1 AI 기반 실시간 추천 시스템
```javascript
// assets/js/modules/smart-recommendations.js
class SmartRecommendationEngine {
    constructor() {
        this.userPreferences = this.loadUserPreferences();
        this.visitHistory = this.loadVisitHistory();
        this.contextFactors = {};
    }
    
    async generateSmartRecommendations(currentLocation, timeConstraints) {
        // 현재 상황 분석
        const contextAnalysis = await this.analyzeCurrentContext(currentLocation);
        
        // 사용자 행동 패턴 분석
        const behaviorPattern = this.analyzeBehaviorPattern();
        
        // POI 후보 필터링
        const candidatePOIs = await this.filterPOICandidates(
            currentLocation,
            timeConstraints,
            contextAnalysis
        );
        
        // 개인화된 점수 계산
        const scoredRecommendations = candidatePOIs.map(poi => ({
            ...poi,
            score: this.calculatePersonalizationScore(poi, behaviorPattern, contextAnalysis),
            reason: this.generateRecommendationReason(poi, behaviorPattern)
        }));
        
        // 다양성 보장 알고리즘 적용
        const diverseRecommendations = this.ensureDiversity(scoredRecommendations);
        
        return diverseRecommendations.slice(0, 5);
    }
    
    calculatePersonalizationScore(poi, behaviorPattern, context) {
        let score = 0;
        
        // 기본 점수 (거리, 평점 등)
        score += this.calculateBaseScore(poi, context.currentLocation);
        
        // 개인 취향 반영
        score += this.calculatePreferenceScore(poi, this.userPreferences);
        
        // 시간대별 선호도
        score += this.calculateTimePreferenceScore(poi, context.currentTime);
        
        // 날씨 조건 반영
        score += this.calculateWeatherScore(poi, context.weather);
        
        // 동반자 고려 (커플 여행 최적화)
        score += this.calculateCoupleScore(poi);
        
        // 예산 적합성
        score += this.calculateBudgetScore(poi, context.remainingBudget);
        
        return Math.max(0, Math.min(100, score));
    }
    
    generateRecommendationReason(poi, behaviorPattern) {
        const reasons = [];
        
        if (poi.distance < 500) reasons.push('가까운 거리');
        if (poi.rating > 4.5) reasons.push('높은 평점');
        if (poi.categories.includes(behaviorPattern.preferredCategory)) {
            reasons.push('선호 카테고리');
        }
        if (poi.coupleRecommended) reasons.push('커플 추천');
        if (poi.priceLevel <= behaviorPattern.budgetLevel) reasons.push('예산 적합');
        
        return reasons.join(', ');
    }
}
```

### 4.2 증강현실(AR) 기반 정보 오버레이
```html
<!-- ar-overlay.html -->
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AR 정보 오버레이</title>
    <script src="https://aframe.io/releases/1.4.0/aframe.min.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.5/aframe/build/aframe-ar.min.js"></script>
</head>
<body style="margin: 0; font-family: Arial, Helvetica, sans-serif;">
    <!-- AR 씬 -->
    <a-scene embedded arjs="sourceType: webcam; debugUIEnabled: false;">
        <!-- 카메라 설정 -->
        <a-camera gps-camera rotation-reader position="0 1.6 0">
            <!-- AR UI 오버레이 -->
            <a-plane 
                id="info-panel" 
                position="0 0 -2" 
                width="2" 
                height="1" 
                color="#ffffff" 
                opacity="0.8" 
                visible="false">
                
                <a-text 
                    id="poi-name"
                    value="POI 이름" 
                    position="-0.8 0.3 0.01" 
                    color="#000000" 
                    width="6">
                </a-text>
                
                <a-text 
                    id="poi-info"
                    value="POI 정보" 
                    position="-0.8 0 0.01" 
                    color="#333333" 
                    width="4">
                </a-text>
                
                <a-text 
                    id="distance-info"
                    value="거리: --m" 
                    position="-0.8 -0.3 0.01" 
                    color="#666666" 
                    width="4">
                </a-text>
            </a-plane>
        </a-camera>
        
        <!-- POI 마커들 (동적으로 생성) -->
        <a-entity id="poi-markers"></a-entity>
    </a-scene>
    
    <!-- AR 컨트롤 UI -->
    <div id="ar-controls" style="position: fixed; top: 20px; left: 20px; z-index: 1000;">
        <button id="toggle-ar" style="padding: 10px; background: #2196F3; color: white; border: none; border-radius: 5px;">
            AR 모드 ON/OFF
        </button>
        <button id="scan-menu" style="padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 5px; margin-left: 10px;">
            메뉴 스캔
        </button>
    </div>

    <script>
        class AROverlayManager {
            constructor() {
                this.scene = document.querySelector('a-scene');
                this.camera = document.querySelector('[gps-camera]');
                this.poiMarkers = document.querySelector('#poi-markers');
                this.isARActive = false;
                
                this.setupAREventListeners();
                this.loadNearbyPOIs();
            }
            
            async loadNearbyPOIs() {
                try {
                    // 현재 위치 기반 POI 로드
                    const position = await this.getCurrentPosition();
                    const nearbyPOIs = await this.getPOIsNearLocation(position);
                    
                    this.createARMarkers(nearbyPOIs);
                } catch (error) {
                    console.error('AR POI 로딩 실패:', error);
                }
            }
            
            createARMarkers(pois) {
                pois.forEach(poi => {
                    const marker = document.createElement('a-box');
                    marker.setAttribute('gps-entity-place', 
                        `latitude: ${poi.coordinates[0]}; longitude: ${poi.coordinates[1]};`);
                    marker.setAttribute('color', this.getCategoryColor(poi.category));
                    marker.setAttribute('scale', '5 5 5');
                    marker.setAttribute('animation', 
                        'property: rotation; to: 0 360 0; loop: true; dur: 10000');
                    
                    // 클릭 이벤트 추가
                    marker.addEventListener('click', () => {
                        this.showPOIInfo(poi);
                    });
                    
                    this.poiMarkers.appendChild(marker);
                });
            }
            
            showPOIInfo(poi) {
                const infoPanel = document.querySelector('#info-panel');
                const poiName = document.querySelector('#poi-name');
                const poiInfo = document.querySelector('#poi-info');
                const distanceInfo = document.querySelector('#distance-info');
                
                poiName.setAttribute('value', poi.name);
                poiInfo.setAttribute('value', poi.description);
                distanceInfo.setAttribute('value', `거리: ${poi.distance}m`);
                
                infoPanel.setAttribute('visible', 'true');
                
                // 3초 후 자동 숨김
                setTimeout(() => {
                    infoPanel.setAttribute('visible', 'false');
                }, 3000);
            }
        }
        
        // AR 매니저 초기화
        document.addEventListener('DOMContentLoaded', () => {
            new AROverlayManager();
        });
    </script>
</body>
</html>
```

### 4.3 실시간 협업 기능
```javascript
// assets/js/modules/collaborative-features.js
class CollaborativeFeatures {
    constructor(userId = 'euntae', partnerId = 'yumin') {
        this.userId = userId;
        this.partnerId = partnerId;
        this.sharedState = new SharedState();
        this.realTimeSync = new RealTimeSync();
    }
    
    // 실시간 위치 공유
    async shareLocation() {
        if (!navigator.geolocation) return;
        
        navigator.geolocation.watchPosition(
            position => {
                const locationData = {
                    userId: this.userId,
                    coordinates: {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    },
                    timestamp: Date.now(),
                    accuracy: position.coords.accuracy
                };
                
                // 파트너와 위치 공유
                this.realTimeSync.shareLocation(locationData);
                this.updateLocationOnMap(locationData);
            },
            error => console.error('위치 공유 오류:', error),
            { enableHighAccuracy: true, maximumAge: 30000 }
        );
    }
    
    // 일정 실시간 동기화
    async syncItinerary(itineraryChange) {
        const changeData = {
            userId: this.userId,
            type: itineraryChange.type, // 'add', 'modify', 'remove'
            item: itineraryChange.item,
            timestamp: Date.now()
        };
        
        // 로컬 상태 업데이트
        await this.updateLocalItinerary(changeData);
        
        // 파트너에게 변경사항 전송
        await this.realTimeSync.syncData('itinerary', changeData);
        
        // UI 업데이트
        this.updateItineraryUI(changeData);
    }
    
    // 예산 공유 및 분할
    async manageBudget(expenseData) {
        const budgetUpdate = {
            userId: this.userId,
            expense: expenseData,
            splitType: expenseData.splitType || 'equal', // 'equal', 'custom', 'individual'
            timestamp: Date.now()
        };
        
        // 예산 분할 계산
        const splitAmount = this.calculateSplit(expenseData, budgetUpdate.splitType);
        
        // 공유 예산 업데이트
        await this.updateSharedBudget(budgetUpdate, splitAmount);
        
        // 파트너에게 알림
        await this.sendBudgetNotification(budgetUpdate);
    }
    
    // 사진 및 메모 실시간 공유
    async shareMemory(memoryData) {
        const memory = {
            userId: this.userId,
            type: memoryData.type, // 'photo', 'note', 'rating'
            content: memoryData.content,
            location: memoryData.location,
            poi: memoryData.poi,
            timestamp: Date.now()
        };
        
        // 로컬 저장
        await this.saveMemoryLocally(memory);
        
        // 실시간 공유
        await this.realTimeSync.shareMemory(memory);
        
        // 메모리 북 업데이트
        this.updateMemoryBook(memory);
    }
    
    // 긴급 상황 알림
    async sendEmergencyAlert(emergencyData) {
        const alert = {
            userId: this.userId,
            type: 'emergency',
            severity: emergencyData.severity, // 'low', 'medium', 'high', 'critical'
            message: emergencyData.message,
            location: await this.getCurrentLocation(),
            timestamp: Date.now()
        };
        
        // 즉시 파트너에게 알림
        await this.realTimeSync.sendEmergencyAlert(alert);
        
        // 응급 서비스 정보 표시
        this.showEmergencyServices(alert.location);
    }
}
```

이렇게 GitHub Pages 기반의 정적 웹사이트로 ChatGPT Projects의 한계를 완벽하게 보완하면서, 실시간성과 인터랙티브한 GUI를 제공하는 개인 여행 웹사이트를 설계했습니다. 다음 단계로 실제 HTML/CSS/JavaScript 코드를 완성하겠습니다.