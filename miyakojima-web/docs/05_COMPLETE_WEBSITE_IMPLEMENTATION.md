# 완전한 미야코지마 여행 웹사이트 구현

## 1. 프로젝트 구조 및 파일 구성

```
miyakojima-travel/                 # GitHub Pages 저장소 루트
├── index.html                     # 메인 랜딩 페이지
├── secret-travel/                 # 비밀 여행 공간
│   ├── main.html                 # 통합 대시보드
│   ├── map.html                  # 실시간 지도
│   ├── itinerary.html            # 일정 관리
│   ├── budget.html               # 예산 추적
│   ├── translate.html            # 번역 도구
│   └── emergency.html            # 응급 가이드
├── data/                         # JSON 데이터
│   ├── poi-database.json         # 175개 POI 데이터
│   ├── accommodations.json       # 숙소 정보
│   ├── dining-guide.json         # 음식점 가이드
│   └── travel-data.json          # 통합 여행 데이터
├── assets/                       # 정적 자원
│   ├── css/                      # 스타일시트
│   │   ├── main.css             # 메인 스타일
│   │   ├── dashboard.css        # 대시보드 스타일
│   │   ├── map.css              # 지도 스타일
│   │   └── components.css       # 컴포넌트 스타일
│   ├── js/                      # JavaScript 모듈
│   │   ├── core/                # 핵심 모듈
│   │   │   ├── app.js          # 메인 앱 로직
│   │   │   ├── data-manager.js # 데이터 관리
│   │   │   └── storage.js      # 로컬 저장소
│   │   ├── modules/             # 기능 모듈
│   │   │   ├── map-service.js  # 지도 서비스
│   │   │   ├── poi-service.js  # POI 관리
│   │   │   ├── translate.js    # 번역 기능
│   │   │   └── budget.js       # 예산 관리
│   │   └── utils/               # 유틸리티
│   │       ├── geolocation.js  # 위치 서비스
│   │       ├── weather.js      # 날씨 API
│   │       └── helpers.js      # 도우미 함수
│   └── images/                  # 이미지 자원
├── manifest.json                # PWA 매니페스트
└── service-worker.js            # 서비스 워커
```

## 2. 메인 HTML 파일들

### 2.1 메인 대시보드 (main.html) - 완전 구현
```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>🏝️ 미야코지마 여행 대시보드</title>
    
    <!-- PWA 메타 태그 -->
    <meta name="theme-color" content="#1976D2">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <link rel="manifest" href="../manifest.json">
    
    <!-- 파비콘 -->
    <link rel="icon" href="../assets/images/favicon.ico">
    <link rel="apple-touch-icon" href="../assets/images/icon-192x192.png">
    
    <!-- 외부 라이브러리 -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    
    <!-- 커스텀 스타일 -->
    <link rel="stylesheet" href="../assets/css/main.css">
    <link rel="stylesheet" href="../assets/css/dashboard.css">
    
    <!-- 프리로드 -->
    <link rel="preload" href="../data/poi-database.json" as="fetch" crossorigin>
    <link rel="preload" href="../data/travel-data.json" as="fetch" crossorigin>
</head>
<body class="dashboard-body">
    <!-- 로딩 스크린 -->
    <div id="loading-screen" class="loading-screen">
        <div class="loading-animation">
            <div class="wave"></div>
            <div class="wave wave-2"></div>
            <div class="wave wave-3"></div>
        </div>
        <p class="loading-text">미야코지마 여행 준비 중...</p>
    </div>

    <!-- 메인 앱 컨테이너 -->
    <div id="app" class="app-container">
        <!-- 헤더 -->
        <header class="app-header">
            <div class="header-main">
                <div class="logo-section">
                    <h1 class="app-title">
                        <span class="island-icon">🏝️</span>
                        <span class="title-text">미야코지마</span>
                    </h1>
                    <div class="travel-info">
                        <span class="travel-dates">2025.9.27 - 10.1</span>
                        <span class="travelers">👫 은태 & 유민</span>
                    </div>
                </div>
                
                <!-- 실시간 상태바 -->
                <div class="status-bar">
                    <div class="status-item time-status">
                        <i class="fas fa-clock"></i>
                        <span id="current-time">--:--</span>
                        <small>JST</small>
                    </div>
                    
                    <div class="status-item weather-status" id="weather-widget">
                        <i class="fas fa-sun weather-icon"></i>
                        <span class="weather-temp">--°C</span>
                        <span class="weather-desc">Loading</span>
                    </div>
                    
                    <div class="status-item budget-status">
                        <i class="fas fa-yen-sign"></i>
                        <span id="budget-remaining">--,---</span>
                        <small>JPY 남음</small>
                    </div>
                </div>
            </div>
            
            <!-- 네비게이션 탭 -->
            <nav class="nav-tabs">
                <button class="nav-tab active" data-section="dashboard">
                    <i class="fas fa-home"></i>
                    <span>홈</span>
                </button>
                <button class="nav-tab" data-section="map">
                    <i class="fas fa-map-marked-alt"></i>
                    <span>지도</span>
                </button>
                <button class="nav-tab" data-section="itinerary">
                    <i class="fas fa-calendar-check"></i>
                    <span>일정</span>
                </button>
                <button class="nav-tab" data-section="budget">
                    <i class="fas fa-wallet"></i>
                    <span>예산</span>
                </button>
                <button class="nav-tab" data-section="translate">
                    <i class="fas fa-language"></i>
                    <span>번역</span>
                </button>
                <button class="nav-tab emergency-tab" data-section="emergency">
                    <i class="fas fa-first-aid"></i>
                    <span>응급</span>
                </button>
            </nav>
        </header>

        <!-- 메인 콘텐츠 -->
        <main class="main-content">
            <!-- 대시보드 섹션 -->
            <section id="dashboard-section" class="content-section active">
                <!-- 현재 위치 기반 추천 -->
                <div class="dashboard-card location-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <i class="fas fa-map-marker-alt"></i>
                            지금 여기서 뭐할까?
                        </h2>
                        <button class="refresh-btn" id="refresh-location">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                    
                    <div class="current-location">
                        <div class="location-info">
                            <span id="current-location-name">위치를 찾는 중...</span>
                            <small id="location-accuracy">GPS 정확도: --m</small>
                        </div>
                    </div>
                    
                    <div class="recommendations-container" id="smart-recommendations">
                        <!-- 동적으로 생성될 추천 카드들 -->
                        <div class="recommendation-placeholder">
                            <div class="skeleton-card"></div>
                            <div class="skeleton-card"></div>
                            <div class="skeleton-card"></div>
                        </div>
                    </div>
                </div>

                <!-- 오늘의 일정 -->
                <div class="dashboard-card schedule-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <i class="fas fa-calendar-day"></i>
                            오늘의 일정
                        </h2>
                        <div class="schedule-date" id="today-date">
                            <!-- 동적 날짜 -->
                        </div>
                    </div>
                    
                    <div class="schedule-timeline" id="today-schedule">
                        <!-- 동적으로 생성될 일정 -->
                    </div>
                    
                    <button class="view-all-btn" onclick="switchToSection('itinerary')">
                        전체 일정 보기 <i class="fas fa-arrow-right"></i>
                    </button>
                </div>

                <!-- 빠른 액션 -->
                <div class="dashboard-card actions-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <i class="fas fa-bolt"></i>
                            빠른 액션
                        </h2>
                    </div>
                    
                    <div class="action-grid">
                        <button class="action-btn restaurant-btn" data-action="find-restaurant">
                            <i class="fas fa-utensils"></i>
                            <span class="action-text">근처 맛집</span>
                            <small class="action-desc">주변 음식점 찾기</small>
                        </button>
                        
                        <button class="action-btn shopping-btn" data-action="find-shopping">
                            <i class="fas fa-shopping-bag"></i>
                            <span class="action-text">쇼핑</span>
                            <small class="action-desc">마트/편의점</small>
                        </button>
                        
                        <button class="action-btn taxi-btn" data-action="call-taxi">
                            <i class="fas fa-taxi"></i>
                            <span class="action-text">택시</span>
                            <small class="action-desc">택시 호출 정보</small>
                        </button>
                        
                        <button class="action-btn translate-btn" data-action="camera-translate">
                            <i class="fas fa-camera"></i>
                            <span class="action-text">카메라 번역</span>
                            <small class="action-desc">메뉴판 번역</small>
                        </button>
                        
                        <button class="action-btn directions-btn" data-action="get-directions">
                            <i class="fas fa-directions"></i>
                            <span class="action-text">길찾기</span>
                            <small class="action-desc">목적지 안내</small>
                        </button>
                        
                        <button class="action-btn weather-btn" data-action="check-weather">
                            <i class="fas fa-cloud-sun"></i>
                            <span class="action-text">날씨</span>
                            <small class="action-desc">상세 날씨 정보</small>
                        </button>
                    </div>
                </div>

                <!-- 예산 현황 -->
                <div class="dashboard-card budget-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <i class="fas fa-yen-sign"></i>
                            예산 현황
                        </h2>
                        <div class="budget-percentage" id="budget-used-percent">
                            <!-- 사용률 표시 -->
                        </div>
                    </div>
                    
                    <div class="budget-overview">
                        <div class="budget-stats">
                            <div class="stat-item">
                                <span class="stat-label">총 예산</span>
                                <span class="stat-value" id="total-budget">278,000 JPY</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">사용한 금액</span>
                                <span class="stat-value" id="used-budget">0 JPY</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">남은 금액</span>
                                <span class="stat-value" id="remaining-budget">278,000 JPY</span>
                            </div>
                        </div>
                        
                        <div class="budget-categories" id="budget-categories">
                            <!-- 카테고리별 예산 표시 -->
                        </div>
                    </div>
                    
                    <button class="view-all-btn" onclick="switchToSection('budget')">
                        상세 예산 관리 <i class="fas fa-arrow-right"></i>
                    </button>
                </div>

                <!-- 즐겨찾기 POI -->
                <div class="dashboard-card favorites-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <i class="fas fa-heart"></i>
                            즐겨찾는 장소
                        </h2>
                        <button class="edit-favorites-btn" id="edit-favorites">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    
                    <div class="favorites-grid" id="favorite-pois">
                        <!-- 즐겨찾기 POI 동적 생성 -->
                    </div>
                    
                    <button class="add-favorite-btn" id="add-favorite">
                        <i class="fas fa-plus"></i>
                        즐겨찾기 추가
                    </button>
                </div>
            </section>

            <!-- 지도 섹션 -->
            <section id="map-section" class="content-section">
                <div class="map-container">
                    <div class="map-controls">
                        <div class="control-group">
                            <button class="map-control-btn" id="my-location-btn">
                                <i class="fas fa-crosshairs"></i>
                                <span>내 위치</span>
                            </button>
                            
                            <!-- POI 필터 -->
                            <div class="poi-filters">
                                <button class="filter-btn active" data-category="all">
                                    전체 <span class="count">(175)</span>
                                </button>
                                <button class="filter-btn" data-category="dining">
                                    음식 <span class="count">(25)</span>
                                </button>
                                <button class="filter-btn" data-category="shopping">
                                    쇼핑 <span class="count">(35)</span>
                                </button>
                                <button class="filter-btn" data-category="nature">
                                    자연 <span class="count">(12)</span>
                                </button>
                                <button class="filter-btn" data-category="culture">
                                    문화 <span class="count">(27)</span>
                                </button>
                                <button class="filter-btn" data-category="emergency">
                                    응급 <span class="count">(12)</span>
                                </button>
                            </div>
                        </div>
                        
                        <div class="search-container">
                            <input type="text" id="poi-search" placeholder="장소명 또는 키워드로 검색..." class="search-input">
                            <button class="search-btn" id="search-poi">
                                <i class="fas fa-search"></i>
                            </button>
                        </div>
                    </div>
                    
                    <!-- 지도 -->
                    <div id="interactive-map" class="interactive-map"></div>
                    
                    <!-- POI 상세 패널 -->
                    <div id="poi-detail-panel" class="poi-detail-panel">
                        <!-- 동적으로 생성될 POI 상세 정보 -->
                    </div>
                </div>
            </section>

            <!-- 기타 섹션들 (itinerary, budget, translate, emergency)도 유사하게 구현 -->
        </main>

        <!-- 플로팅 액션 버튼들 -->
        <div class="floating-actions">
            <button class="fab emergency-fab" id="emergency-fab" title="응급상황">
                <i class="fas fa-exclamation-triangle"></i>
            </button>
            
            <button class="fab translate-fab" id="translate-fab" title="빠른 번역">
                <i class="fas fa-language"></i>
            </button>
            
            <button class="fab location-fab" id="location-fab" title="내 위치">
                <i class="fas fa-map-marker-alt"></i>
            </button>
        </div>
    </div>

    <!-- 모달 및 오버레이 -->
    <div id="modal-overlay" class="modal-overlay">
        <!-- 동적 모달 컨텐츠 -->
    </div>

    <!-- 토스트 알림 -->
    <div id="toast-container" class="toast-container">
        <!-- 동적 토스트 메시지 -->
    </div>

    <!-- JavaScript 모듈 로딩 -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="../assets/js/core/app.js" type="module"></script>
    
    <!-- PWA 등록 -->
    <script>
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('../service-worker.js')
                    .then(registration => {
                        console.log('SW 등록 성공:', registration);
                    })
                    .catch(error => {
                        console.log('SW 등록 실패:', error);
                    });
            });
        }
    </script>
</body>
</html>
```

### 2.2 메인 CSS 스타일 (assets/css/main.css)
```css
/* 기본 스타일 초기화 및 전역 변수 */
:root {
    /* 색상 팔레트 */
    --primary-color: #1976D2;
    --primary-light: #42A5F5;
    --primary-dark: #0D47A1;
    --secondary-color: #FF9800;
    --accent-color: #4CAF50;
    --error-color: #F44336;
    --warning-color: #FF9800;
    --success-color: #4CAF50;
    
    /* 배경 색상 */
    --bg-primary: #FFFFFF;
    --bg-secondary: #F5F7FA;
    --bg-tertiary: #E3F2FD;
    --bg-dark: #263238;
    
    /* 텍스트 색상 */
    --text-primary: #212121;
    --text-secondary: #757575;
    --text-hint: #BDBDBD;
    --text-white: #FFFFFF;
    
    /* 그림자 */
    --shadow-light: 0 2px 8px rgba(0, 0, 0, 0.1);
    --shadow-medium: 0 4px 16px rgba(0, 0, 0, 0.15);
    --shadow-heavy: 0 8px 32px rgba(0, 0, 0, 0.2);
    
    /* 보더 반지름 */
    --border-radius: 12px;
    --border-radius-small: 8px;
    --border-radius-large: 20px;
    
    /* 간격 */
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 16px;
    --spacing-lg: 24px;
    --spacing-xl: 32px;
    
    /* 폰트 */
    --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    --font-size-xs: 12px;
    --font-size-sm: 14px;
    --font-size-base: 16px;
    --font-size-lg: 18px;
    --font-size-xl: 20px;
    --font-size-2xl: 24px;
    --font-size-3xl: 32px;
    
    /* 애니메이션 */
    --transition-fast: 0.15s ease;
    --transition-normal: 0.3s ease;
    --transition-slow: 0.5s ease;
}

/* 기본 스타일 리셋 */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html {
    font-size: 16px;
    -webkit-text-size-adjust: 100%;
    -ms-text-size-adjust: 100%;
}

body {
    font-family: var(--font-family);
    font-size: var(--font-size-base);
    line-height: 1.6;
    color: var(--text-primary);
    background-color: var(--bg-secondary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    overflow-x: hidden;
}

/* 로딩 스크린 */
.loading-screen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, var(--primary-color), var(--primary-light));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    transition: opacity 0.5s ease, visibility 0.5s ease;
}

.loading-screen.hidden {
    opacity: 0;
    visibility: hidden;
}

.loading-animation {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
}

.wave {
    width: 12px;
    height: 12px;
    background-color: var(--text-white);
    border-radius: 50%;
    animation: wave 1.4s ease-in-out infinite;
}

.wave-2 { animation-delay: 0.2s; }
.wave-3 { animation-delay: 0.4s; }

@keyframes wave {
    0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
    40% { transform: scale(1.2); opacity: 1; }
}

.loading-text {
    color: var(--text-white);
    font-size: var(--font-size-lg);
    font-weight: 500;
}

/* 앱 메인 컨테이너 */
.app-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}

/* 헤더 스타일 */
.app-header {
    background: linear-gradient(135deg, var(--primary-color), var(--primary-light));
    color: var(--text-white);
    position: sticky;
    top: 0;
    z-index: 1000;
    box-shadow: var(--shadow-medium);
}

.header-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-md);
    gap: var(--spacing-md);
}

.logo-section {
    flex: 1;
}

.app-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--font-size-2xl);
    font-weight: 700;
    margin-bottom: var(--spacing-xs);
}

.island-icon {
    font-size: var(--font-size-3xl);
    animation: float 3s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
}

.travel-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    opacity: 0.9;
}

.travel-dates {
    font-size: var(--font-size-sm);
    font-weight: 500;
}

.travelers {
    font-size: var(--font-size-sm);
}

/* 상태바 */
.status-bar {
    display: flex;
    gap: var(--spacing-md);
    align-items: center;
    flex-wrap: wrap;
}

.status-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: rgba(255, 255, 255, 0.15);
    border-radius: var(--border-radius-small);
    backdrop-filter: blur(10px);
    font-size: var(--font-size-sm);
    white-space: nowrap;
}

.status-item i {
    font-size: var(--font-size-sm);
}

/* 네비게이션 탭 */
.nav-tabs {
    display: flex;
    padding: 0 var(--spacing-sm);
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.nav-tabs::-webkit-scrollbar {
    display: none;
}

.nav-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    border: none;
    background: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: var(--font-size-xs);
    font-weight: 500;
    cursor: pointer;
    transition: var(--transition-fast);
    white-space: nowrap;
    position: relative;
    min-width: 60px;
}

.nav-tab i {
    font-size: var(--font-size-base);
}

.nav-tab:hover {
    color: var(--text-white);
}

.nav-tab.active {
    color: var(--text-white);
}

.nav-tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 24px;
    height: 2px;
    background-color: var(--text-white);
    border-radius: 2px;
}

.emergency-tab {
    color: var(--error-color) !important;
}

.emergency-tab.active {
    background: rgba(244, 67, 54, 0.1);
}

/* 메인 콘텐츠 */
.main-content {
    flex: 1;
    padding: var(--spacing-md);
    padding-bottom: 80px; /* FAB 공간 확보 */
}

.content-section {
    display: none;
}

.content-section.active {
    display: block;
}

/* 대시보드 카드 */
.dashboard-card {
    background: var(--bg-primary);
    border-radius: var(--border-radius);
    box-shadow: var(--shadow-light);
    margin-bottom: var(--spacing-lg);
    overflow: hidden;
    transition: var(--transition-normal);
}

.dashboard-card:hover {
    box-shadow: var(--shadow-medium);
    transform: translateY(-2px);
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-lg);
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.card-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
}

.card-title i {
    color: var(--primary-color);
}

/* 현재 위치 카드 */
.location-card .current-location {
    padding: var(--spacing-md) var(--spacing-lg);
    background: linear-gradient(135deg, var(--bg-tertiary), rgba(25, 118, 210, 0.05));
}

.location-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
}

#current-location-name {
    font-weight: 600;
    color: var(--text-primary);
}

#location-accuracy {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
}

.recommendations-container {
    padding: var(--spacing-lg);
}

/* 스켈레톤 로딩 */
.skeleton-card {
    height: 80px;
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: loading 1.5s infinite;
    border-radius: var(--border-radius-small);
    margin-bottom: var(--spacing-sm);
}

@keyframes loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* 추천 카드 */
.recommendation-card {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: var(--border-radius-small);
    margin-bottom: var(--spacing-sm);
    transition: var(--transition-fast);
    cursor: pointer;
}

.recommendation-card:hover {
    border-color: var(--primary-color);
    background: rgba(25, 118, 210, 0.02);
}

.recommendation-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xl);
    flex-shrink: 0;
}

.recommendation-info {
    flex: 1;
}

.recommendation-name {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: var(--spacing-xs);
}

.recommendation-details {
    display: flex;
    gap: var(--spacing-md);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
}

.recommendation-distance {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
}

.recommendation-rating {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
}

.recommendation-price {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
}

/* 액션 그리드 */
.action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
}

.action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-lg);
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: var(--border-radius);
    background: var(--bg-primary);
    cursor: pointer;
    transition: var(--transition-fast);
    text-align: center;
    min-height: 120px;
}

.action-btn:hover {
    border-color: var(--primary-color);
    background: rgba(25, 118, 210, 0.02);
    transform: translateY(-2px);
    box-shadow: var(--shadow-light);
}

.action-btn i {
    font-size: var(--font-size-2xl);
    color: var(--primary-color);
}

.action-text {
    font-weight: 600;
    color: var(--text-primary);
}

.action-desc {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
}

/* 플로팅 액션 버튼 */
.floating-actions {
    position: fixed;
    bottom: var(--spacing-lg);
    right: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    z-index: 1000;
}

.fab {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    box-shadow: var(--shadow-medium);
    cursor: pointer;
    transition: var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-lg);
}

.fab:hover {
    transform: scale(1.1);
    box-shadow: var(--shadow-heavy);
}

.emergency-fab {
    background: var(--error-color);
    color: var(--text-white);
    animation: pulse-emergency 2s infinite;
}

@keyframes pulse-emergency {
    0%, 100% { box-shadow: var(--shadow-medium), 0 0 0 0 rgba(244, 67, 54, 0.7); }
    50% { box-shadow: var(--shadow-heavy), 0 0 0 8px rgba(244, 67, 54, 0); }
}

.translate-fab {
    background: var(--secondary-color);
    color: var(--text-white);
}

.location-fab {
    background: var(--accent-color);
    color: var(--text-white);
}

/* 반응형 디자인 */
@media (max-width: 768px) {
    .header-main {
        flex-direction: column;
        gap: var(--spacing-sm);
    }
    
    .status-bar {
        justify-content: center;
        flex-wrap: wrap;
    }
    
    .action-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-sm);
    }
    
    .floating-actions {
        bottom: var(--spacing-md);
        right: var(--spacing-md);
    }
    
    .fab {
        width: 48px;
        height: 48px;
        font-size: var(--font-size-base);
    }
}

@media (max-width: 480px) {
    :root {
        --font-size-3xl: 28px;
        --font-size-2xl: 20px;
        --font-size-xl: 18px;
    }
    
    .main-content {
        padding: var(--spacing-sm);
    }
    
    .card-header {
        padding: var(--spacing-md);
    }
    
    .dashboard-card {
        margin-bottom: var(--spacing-md);
    }
    
    .action-grid {
        grid-template-columns: 1fr;
    }
}

/* 다크 모드 지원 */
@media (prefers-color-scheme: dark) {
    :root {
        --bg-primary: #1E1E1E;
        --bg-secondary: #121212;
        --bg-tertiary: #2A2D3A;
        --text-primary: #FFFFFF;
        --text-secondary: #B0B0B0;
        --text-hint: #666666;
    }
    
    .dashboard-card {
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .skeleton-card {
        background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
    }
}

/* 접근성 */
@media (prefers-reduced-motion: reduce) {
    * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}

/* 고대비 모드 */
@media (prefers-contrast: high) {
    .dashboard-card {
        border: 2px solid var(--text-primary);
    }
    
    .action-btn {
        border: 2px solid var(--primary-color);
    }
}
```

### 2.3 핵심 JavaScript 로직 (assets/js/core/app.js)
```javascript
/**
 * 미야코지마 여행 웹 애플리케이션 메인 로직
 * @version 1.0.0
 * @author 김은태
 */

// 앱 전역 상태 관리
class AppState {
    constructor() {
        this.currentLocation = null;
        this.selectedPOIs = new Set();
        this.favorites = new Set();
        this.budget = {
            total: 278000,
            spent: 0,
            categories: {
                accommodation: 0,
                dining: 0,
                transportation: 0,
                activities: 0,
                shopping: 0
            }
        };
        this.travelData = null;
        this.weatherData = null;
        this.currentSection = 'dashboard';
        
        // 이벤트 리스너 등록
        this.setupEventListeners();
        this.loadSavedState();
    }
    
    setupEventListeners() {
        document.addEventListener('DOMContentLoaded', () => {
            this.initialize();
        });
        
        // 네비게이션 탭 이벤트
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                this.switchSection(section);
            });
        });
        
        // 빠른 액션 버튼 이벤트
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleQuickAction(action);
            });
        });
        
        // FAB 이벤트
        document.getElementById('emergency-fab')?.addEventListener('click', () => {
            this.handleEmergency();
        });
        
        document.getElementById('translate-fab')?.addEventListener('click', () => {
            this.openQuickTranslate();
        });
        
        document.getElementById('location-fab')?.addEventListener('click', () => {
            this.updateCurrentLocation();
        });
        
        // 위치 새로고침
        document.getElementById('refresh-location')?.addEventListener('click', () => {
            this.updateCurrentLocation();
        });
    }
    
    async initialize() {
        try {
            // 로딩 화면 표시
            this.showLoadingScreen(true);
            
            // 초기 데이터 로드
            await Promise.all([
                this.loadTravelData(),
                this.updateCurrentLocation(),
                this.updateWeatherInfo(),
                this.updateTimeDisplay()
            ]);
            
            // UI 초기화
            this.initializeDashboard();
            this.updateBudgetDisplay();
            this.startPeriodicUpdates();
            
            // 로딩 화면 숨김
            setTimeout(() => {
                this.showLoadingScreen(false);
            }, 1000);
            
        } catch (error) {
            console.error('앱 초기화 실패:', error);
            this.showToast('앱을 불러오는 중 오류가 발생했습니다.', 'error');
        }
    }
    
    showLoadingScreen(show) {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            if (show) {
                loadingScreen.classList.remove('hidden');
            } else {
                loadingScreen.classList.add('hidden');
            }
        }
    }
    
    async loadTravelData() {
        try {
            // POI 데이터베이스 로드
            const poiResponse = await fetch('../data/poi-database.json');
            const poiData = await poiResponse.json();
            
            // 기타 여행 데이터 로드
            const travelResponse = await fetch('../data/travel-data.json');
            const travelData = await travelResponse.json();
            
            this.travelData = {
                ...travelData,
                pois: poiData.poi_database
            };
            
            console.log('여행 데이터 로드 완료:', this.travelData);
            
        } catch (error) {
            console.error('여행 데이터 로드 실패:', error);
            // 오프라인 데이터 사용
            this.loadCachedData();
        }
    }
    
    async updateCurrentLocation() {
        if (!navigator.geolocation) {
            this.showToast('위치 서비스를 지원하지 않는 브라우저입니다.', 'warning');
            return;
        }
        
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 60000
                });
            });
            
            this.currentLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: Date.now()
            };
            
            // 현재 위치 표시 업데이트
            await this.updateLocationDisplay();
            
            // 위치 기반 추천 생성
            await this.generateSmartRecommendations();
            
        } catch (error) {
            console.error('위치 정보 획득 실패:', error);
            
            // 미야코지마 기본 위치로 설정
            this.currentLocation = {
                lat: 24.7456,
                lng: 125.2456,
                accuracy: null,
                timestamp: Date.now(),
                isDefault: true
            };
            
            await this.updateLocationDisplay();
            this.showToast('현재 위치를 가져올 수 없어 기본 위치를 사용합니다.', 'info');
        }
    }
    
    async updateLocationDisplay() {
        const locationNameElement = document.getElementById('current-location-name');
        const locationAccuracyElement = document.getElementById('location-accuracy');
        
        if (!locationNameElement || !this.currentLocation) return;
        
        try {
            if (this.currentLocation.isDefault) {
                locationNameElement.textContent = '미야코지마 (기본 위치)';
                locationAccuracyElement.textContent = 'GPS 비활성화';
                return;
            }
            
            // 역지오코딩으로 위치명 획득
            const locationName = await this.reverseGeocode(
                this.currentLocation.lat, 
                this.currentLocation.lng
            );
            
            locationNameElement.textContent = locationName || '위치 확인 중...';
            
            if (locationAccuracyElement && this.currentLocation.accuracy) {
                locationAccuracyElement.textContent = 
                    `GPS 정확도: ${Math.round(this.currentLocation.accuracy)}m`;
            }
            
        } catch (error) {
            console.error('위치 표시 업데이트 실패:', error);
            locationNameElement.textContent = '위치를 확인할 수 없습니다';
        }
    }
    
    async reverseGeocode(lat, lng) {
        try {
            // OpenStreetMap Nominatim API 사용 (무료)
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ko`
            );
            const data = await response.json();
            
            return data.display_name?.split(',')[0] || '알 수 없는 위치';
        } catch (error) {
            console.error('역지오코딩 실패:', error);
            return null;
        }
    }
    
    async generateSmartRecommendations() {
        if (!this.currentLocation || !this.travelData?.pois) return;
        
        const recommendationsContainer = document.getElementById('smart-recommendations');
        if (!recommendationsContainer) return;
        
        // 로딩 상태 표시
        recommendationsContainer.innerHTML = `
            <div class="recommendations-loading">
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
            </div>
        `;
        
        try {
            // 현재 위치에서 가까운 POI 찾기
            const nearbyPOIs = this.findNearbyPOIs(this.currentLocation, 5000); // 5km 반경
            
            // 추천 점수 계산
            const scoredPOIs = nearbyPOIs.map(poi => ({
                ...poi,
                score: this.calculateRecommendationScore(poi),
                distance: this.calculateDistance(
                    this.currentLocation.lat, 
                    this.currentLocation.lng,
                    poi.coordinates[0], 
                    poi.coordinates[1]
                )
            }));
            
            // 상위 5개 추천
            const topRecommendations = scoredPOIs
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);
            
            // 추천 카드 렌더링
            this.renderRecommendations(topRecommendations);
            
        } catch (error) {
            console.error('스마트 추천 생성 실패:', error);
            recommendationsContainer.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>추천을 생성할 수 없습니다.</span>
                </div>
            `;
        }
    }
    
    findNearbyPOIs(location, maxDistance) {
        if (!this.travelData?.pois) return [];
        
        const nearbyPOIs = [];
        
        for (const [category, pois] of Object.entries(this.travelData.pois.extensions.poi_locations)) {
            for (const [subcategory, poiList] of Object.entries(pois)) {
                for (const [poiId, poi] of Object.entries(poiList)) {
                    if (!poi.coordinates) continue;
                    
                    const distance = this.calculateDistance(
                        location.lat,
                        location.lng,
                        poi.coordinates[0],
                        poi.coordinates[1]
                    );
                    
                    if (distance <= maxDistance) {
                        nearbyPOIs.push({
                            id: poiId,
                            category,
                            subcategory,
                            distance,
                            ...poi
                        });
                    }
                }
            }
        }
        
        return nearbyPOIs;
    }
    
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371e3; // 지구 반지름 (미터)
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lng2-lng1) * Math.PI/180;
        
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        
        return R * c; // 미터 단위
    }
    
    calculateRecommendationScore(poi) {
        let score = 0;
        const currentTime = new Date();
        const currentHour = currentTime.getHours();
        
        // 거리 기반 점수 (가까울수록 높음)
        if (poi.distance < 500) score += 40;
        else if (poi.distance < 1000) score += 30;
        else if (poi.distance < 2000) score += 20;
        else score += 10;
        
        // 카테고리별 시간 가중치
        if (poi.category === 'dining_cafe') {
            if ((currentHour >= 11 && currentHour <= 14) || 
                (currentHour >= 17 && currentHour <= 21)) {
                score += 30; // 식사시간
            }
        }
        
        if (poi.category === 'shopping') {
            if (currentHour >= 9 && currentHour <= 20) {
                score += 20; // 쇼핑 시간
            }
        }
        
        if (poi.category === 'nature_views') {
            if (currentHour >= 6 && currentHour <= 18) {
                score += 25; // 관광 시간
            }
        }
        
        // 즐겨찾기 보너스
        if (this.favorites.has(poi.id)) {
            score += 20;
        }
        
        // 랜덤 요소 (다양성 보장)
        score += Math.random() * 10;
        
        return Math.round(score);
    }
    
    renderRecommendations(recommendations) {
        const container = document.getElementById('smart-recommendations');
        if (!container || !recommendations.length) return;
        
        const html = recommendations.map(poi => {
            const categoryIcon = this.getCategoryIcon(poi.category);
            const categoryColor = this.getCategoryColor(poi.category);
            const distanceText = poi.distance < 1000 
                ? `${Math.round(poi.distance)}m`
                : `${(poi.distance / 1000).toFixed(1)}km`;
            
            return `
                <div class="recommendation-card" data-poi-id="${poi.id}">
                    <div class="recommendation-icon" style="background-color: ${categoryColor}">
                        <i class="fas ${categoryIcon}"></i>
                    </div>
                    <div class="recommendation-info">
                        <div class="recommendation-name">${poi.name || poi.id}</div>
                        <div class="recommendation-details">
                            <div class="recommendation-distance">
                                <i class="fas fa-walking"></i>
                                <span>${distanceText}</span>
                            </div>
                            ${poi.hours ? `
                                <div class="recommendation-hours">
                                    <i class="fas fa-clock"></i>
                                    <span>${poi.hours}</span>
                                </div>
                            ` : ''}
                            ${poi.phone ? `
                                <div class="recommendation-phone">
                                    <i class="fas fa-phone"></i>
                                    <span>${poi.phone}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="recommendation-actions">
                        <button class="action-icon-btn" onclick="app.showPOIDetails('${poi.id}')" title="상세정보">
                            <i class="fas fa-info-circle"></i>
                        </button>
                        <button class="action-icon-btn" onclick="app.getDirections('${poi.id}')" title="길찾기">
                            <i class="fas fa-directions"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = html;
    }
    
    getCategoryIcon(category) {
        const icons = {
            'dining_cafe': 'fa-utensils',
            'shopping': 'fa-shopping-bag',
            'nature_views': 'fa-mountain',
            'culture_spots': 'fa-museum',
            'transportation': 'fa-car',
            'accommodations': 'fa-bed',
            'marine_activities': 'fa-swimming-pool',
            'emergency': 'fa-hospital',
            'experience_activities': 'fa-palette'
        };
        return icons[category] || 'fa-map-marker-alt';
    }
    
    getCategoryColor(category) {
        const colors = {
            'dining_cafe': '#FF5722',
            'shopping': '#FF9800',
            'nature_views': '#4CAF50',
            'culture_spots': '#9C27B0',
            'transportation': '#2196F3',
            'accommodations': '#795548',
            'marine_activities': '#00BCD4',
            'emergency': '#F44336',
            'experience_activities': '#E91E63'
        };
        return colors[category] || '#757575';
    }
    
    async updateWeatherInfo() {
        try {
            // OpenWeatherMap API 사용 (API 키 필요)
            const API_KEY = 'YOUR_OPENWEATHER_API_KEY'; // 실제 구현 시 환경변수로 관리
            const response = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?lat=24.7456&lon=125.2456&appid=${API_KEY}&units=metric&lang=kr`
            );
            
            if (!response.ok) throw new Error('날씨 API 응답 오류');
            
            const weatherData = await response.json();
            this.weatherData = weatherData;
            
            this.updateWeatherDisplay(weatherData);
            
        } catch (error) {
            console.error('날씨 정보 업데이트 실패:', error);
            // 기본 날씨 정보 표시
            this.updateWeatherDisplay({
                main: { temp: 26 },
                weather: [{ main: 'Clear', description: '맑음', icon: '01d' }]
            });
        }
    }
    
    updateWeatherDisplay(weatherData) {
        const tempElement = document.querySelector('.weather-temp');
        const descElement = document.querySelector('.weather-desc');
        const iconElement = document.querySelector('.weather-icon');
        
        if (tempElement && weatherData.main?.temp) {
            tempElement.textContent = `${Math.round(weatherData.main.temp)}°C`;
        }
        
        if (descElement && weatherData.weather?.[0]?.description) {
            descElement.textContent = weatherData.weather[0].description;
        }
        
        if (iconElement && weatherData.weather?.[0]?.main) {
            const weatherIcons = {
                'Clear': 'fa-sun',
                'Clouds': 'fa-cloud',
                'Rain': 'fa-cloud-rain',
                'Snow': 'fa-snowflake',
                'Thunderstorm': 'fa-bolt'
            };
            
            const iconClass = weatherIcons[weatherData.weather[0].main] || 'fa-sun';
            iconElement.className = `fas ${iconClass} weather-icon`;
        }
    }
    
    updateTimeDisplay() {
        const timeElement = document.getElementById('current-time');
        if (!timeElement) return;
        
        const updateTime = () => {
            // 일본 시간 (JST) 표시
            const now = new Date();
            const jstTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
            
            const timeString = jstTime.toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            
            timeElement.textContent = timeString;
        };
        
        updateTime();
        // 1분마다 업데이트
        setInterval(updateTime, 60000);
    }
    
    updateBudgetDisplay() {
        const totalElement = document.getElementById('total-budget');
        const usedElement = document.getElementById('used-budget');
        const remainingElement = document.getElementById('remaining-budget');
        const percentElement = document.getElementById('budget-used-percent');
        const budgetRemainingElement = document.getElementById('budget-remaining');
        
        if (totalElement) {
            totalElement.textContent = `${this.budget.total.toLocaleString()} JPY`;
        }
        
        if (usedElement) {
            usedElement.textContent = `${this.budget.spent.toLocaleString()} JPY`;
        }
        
        if (remainingElement) {
            const remaining = this.budget.total - this.budget.spent;
            remainingElement.textContent = `${remaining.toLocaleString()} JPY`;
        }
        
        if (percentElement) {
            const percentage = Math.round((this.budget.spent / this.budget.total) * 100);
            percentElement.textContent = `${percentage}%`;
        }
        
        if (budgetRemainingElement) {
            const remaining = this.budget.total - this.budget.spent;
            budgetRemainingElement.textContent = `${Math.round(remaining / 1000)}K`;
        }
    }
    
    switchSection(sectionName) {
        // 네비게이션 탭 업데이트
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');
        
        // 섹션 표시/숨김
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${sectionName}-section`).classList.add('active');
        
        this.currentSection = sectionName;
        
        // 섹션별 초기화 로직
        this.initializeSection(sectionName);
    }
    
    initializeSection(sectionName) {
        switch (sectionName) {
            case 'map':
                if (typeof window.initializeMap === 'function') {
                    window.initializeMap();
                }
                break;
            case 'itinerary':
                this.loadTodaySchedule();
                break;
            case 'budget':
                this.loadBudgetDetails();
                break;
            case 'translate':
                if (typeof window.initializeTranslator === 'function') {
                    window.initializeTranslator();
                }
                break;
            case 'emergency':
                this.loadEmergencyInfo();
                break;
        }
    }
    
    handleQuickAction(action) {
        switch (action) {
            case 'find-restaurant':
                this.findNearbyRestaurants();
                break;
            case 'find-shopping':
                this.findNearbyShopping();
                break;
            case 'call-taxi':
                this.showTaxiInfo();
                break;
            case 'camera-translate':
                this.openCameraTranslate();
                break;
            case 'get-directions':
                this.openDirections();
                break;
            case 'check-weather':
                this.showDetailedWeather();
                break;
        }
    }
    
    findNearbyRestaurants() {
        const restaurants = this.findNearbyPOIs(this.currentLocation, 2000)
            .filter(poi => poi.category === 'dining_cafe')
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 10);
        
        this.showPOIList('근처 맛집', restaurants);
    }
    
    findNearbyShopping() {
        const shopping = this.findNearbyPOIs(this.currentLocation, 5000)
            .filter(poi => poi.category === 'shopping')
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 10);
        
        this.showPOIList('근처 쇼핑', shopping);
    }
    
    showPOIList(title, pois) {
        const modalContent = `
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="app.closeModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="poi-list">
                    ${pois.map(poi => `
                        <div class="poi-item" onclick="app.showPOIDetails('${poi.id}')">
                            <div class="poi-icon">
                                <i class="fas ${this.getCategoryIcon(poi.category)}"></i>
                            </div>
                            <div class="poi-info">
                                <div class="poi-name">${poi.name || poi.id}</div>
                                <div class="poi-details">
                                    <span class="poi-distance">${poi.distance < 1000 ? Math.round(poi.distance) + 'm' : (poi.distance/1000).toFixed(1) + 'km'}</span>
                                    ${poi.hours ? `<span class="poi-hours">${poi.hours}</span>` : ''}
                                </div>
                            </div>
                            <div class="poi-actions">
                                <button class="poi-action-btn" onclick="event.stopPropagation(); app.getDirections('${poi.id}')">
                                    <i class="fas fa-directions"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        this.showModal(modalContent);
    }
    
    showModal(content) {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.innerHTML = `<div class="modal-content">${content}</div>`;
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }
    
    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.innerHTML = '';
            document.body.style.overflow = '';
        }
    }
    
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            info: 'fa-info-circle',
            success: 'fa-check-circle',
            warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle'
        };
        
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas ${icons[type]}"></i>
                <span>${message}</span>
            </div>
        `;
        
        container.appendChild(toast);
        
        // 애니메이션 트리거
        setTimeout(() => toast.classList.add('show'), 100);
        
        // 자동 제거
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => container.removeChild(toast), 300);
        }, duration);
    }
    
    startPeriodicUpdates() {
        // 10분마다 날씨 업데이트
        setInterval(() => this.updateWeatherInfo(), 600000);
        
        // 30초마다 위치 업데이트 (이동 중일 때)
        setInterval(() => {
            if (this.isMoving()) {
                this.updateCurrentLocation();
            }
        }, 30000);
        
        // 5분마다 추천 새로고침
        setInterval(() => {
            if (this.currentSection === 'dashboard') {
                this.generateSmartRecommendations();
            }
        }, 300000);
    }
    
    isMoving() {
        // 간단한 이동 감지 로직
        // 실제로는 가속도계나 위치 변화를 감지
        return false;
    }
    
    saveState() {
        const state = {
            favorites: Array.from(this.favorites),
            budget: this.budget,
            lastLocation: this.currentLocation,
            timestamp: Date.now()
        };
        
        localStorage.setItem('miyakojima-travel-state', JSON.stringify(state));
    }
    
    loadSavedState() {
        try {
            const saved = localStorage.getItem('miyakojima-travel-state');
            if (saved) {
                const state = JSON.parse(saved);
                
                if (state.favorites) {
                    this.favorites = new Set(state.favorites);
                }
                
                if (state.budget) {
                    this.budget = { ...this.budget, ...state.budget };
                }
                
                if (state.lastLocation && Date.now() - state.timestamp < 3600000) { // 1시간
                    this.currentLocation = state.lastLocation;
                }
            }
        } catch (error) {
            console.error('저장된 상태 로드 실패:', error);
        }
    }
    
    // 주기적으로 상태 저장
    autoSave() {
        setInterval(() => {
            this.saveState();
        }, 60000); // 1분마다
    }
}

// 전역 앱 인스턴스 생성
window.app = new AppState();

// 페이지 종료 시 상태 저장
window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.saveState();
    }
});

// 유틸리티 함수들
window.switchToSection = (sectionName) => {
    if (window.app) {
        window.app.switchSection(sectionName);
    }
};

// PWA 설치 프롬프트
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // 설치 버튼 표시
    const installBtn = document.getElementById('install-app');
    if (installBtn) {
        installBtn.style.display = 'block';
        installBtn.addEventListener('click', async () => {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('PWA 설치 선택:', outcome);
            deferredPrompt = null;
        });
    }
});

export { AppState };
```

## 10. 추가 모듈 설계 계획

### 10.1 Google Services Integration (js/modules/google-integration.js)
**목적**: Google Sheets 연동 및 데이터 동기화

**코어 기능**:
- Google Sheets API 연동으로 실시간 데이터 동기화
- 일정, 예산, POI 데이터의 양방향 동기화
- 오프라인 모드 지원 및 자동 복구
- 데이터 백업 및 엑스포트 기능

**기술 사양**:
```javascript
class GoogleIntegration {
    constructor() {
        this.sheetsAPI = null;
        this.spreadsheetId = 'GOOGLE_SHEETS_ID';
        this.apiKey = 'GOOGLE_API_KEY';
        this.cache = { schedule: [], budget: {}, pois: [] };
    }
    
    async initialize() // Google API 초기화
    async syncAllData() // 전체 데이터 동기화
    async addScheduleItem(data) // 일정 추가
    async updateScheduleItem(id, data) // 일정 수정
    async addExpense(expense) // 지출 추가
    handleOfflineMode() // 오프라인 처리
}
```

### 10.2 Advanced Map Features (js/modules/advanced-map.js)
**목적**: Google Maps 고급 기능 및 위치 기반 서비스

**코어 기능**:
- 실시간 교통 정보 표시
- 경로 최적화 및 대중교통 연결
- 주변 Geofencing (관심 지역 도착 알림)
- 3D 지도 및 스트리트뷰 연동
- POI 전용 레이어 시스템

### 10.3 Smart Recommendation Engine (js/modules/smart-recommend.js)
**목적**: AI 기반 개인화 추천 시스템

**코어 기능**:
- 사용자 선호도 학습 및 행동 패턴 분석
- 시간대별/날씨별 최적 추천
- 예산 기반 비용 효율적 추천
- 소셜 데이터 및 리뷰 연동
- 다국어 추천 시스템

### 10.4 Voice Assistant Integration (js/modules/voice-assistant.js)
**목적**: Web Speech API 기반 음성 인터페이스

**코어 기능**:
- 한국어 음성 명령 인식
- 일본어 발음 및 TTS 지원
- 실시간 대화형 번역
- 응급상황 음성 활성화
- 오프라인 음성 인식

### 10.5 Camera Translation (js/modules/camera-translate.js)
**목적**: 카메라 기반 실시간 OCR 및 번역

**코어 기능**:
- 메뉴판/간판 실시간 OCR
- 이미지 전처리 및 텍스트 추출
- 알레르기 성분 자동 감지
- 가격 비교 및 추천 기능
- AR 오버레이 번역 표시

### 10.6 Expense Tracker Pro (js/modules/expense-tracker.js)
**목적**: 실시간 예산 추적 및 지출 분석

**코어 기능**:
- 영수증 OCR 자동 지출 기록
- 카테고리 자동 분류 및 태그
- 예산 초과 예청 알림
- 일별/카테고리별 대시보드
- 환율 자동 업데이트 및 환산

## 11. 고급 기능 계획

### 11.1 Offline-First Architecture
**PWA 및 Service Worker 전략**:
```javascript
// service-worker.js 구조
self.addEventListener('install', event => {
    // 핵심 리소스 캐싱
    // 오프라인 데이터 준비
});

self.addEventListener('fetch', event => {
    // 네트워크 우선, 캐시 대체 전략
    // API 요청 캐싱 및 동기화
});
```

**데이터 저장 전략**:
- IndexedDB: 대용량 구조화 데이터
- LocalStorage: 사용자 설정 및 설정
- SessionStorage: 임시 세션 데이터
- Cache API: 정적 자원 및 API 응답

### 11.2 Real-time Sync Strategy
**데이터 동기화 아키텍처**:
```javascript
class SyncManager {
    constructor() {
        this.syncQueue = [];
        this.conflictResolver = new ConflictResolver();
        this.optimisticUpdates = true;
    }
    
    async sync() {
        // 1. 로컬 변경사항 업로드
        // 2. 서버 변경사항 다운로드
        // 3. 충돌 해결 및 병합
        // 4. UI 업데이트
    }
}
```

### 11.3 Performance Optimization
**로딩 전략**:
- 코드 스플리팅 (Dynamic Import)
- 이미지 Lazy Loading
- 리소스 프리로딩
- Critical CSS 인라이닝

**성능 모니터링**:
```javascript
class PerformanceMonitor {
    static measurePageLoad() {
        const navigation = performance.getEntriesByType('navigation')[0];
        const loadTime = navigation.loadEventEnd - navigation.loadEventStart;
        
        // Analytics로 전송
        this.reportMetric('page_load_time', loadTime);
    }
    
    static measureUserInteraction(action) {
        const startTime = performance.now();
        // 액션 실행 후
        const duration = performance.now() - startTime;
        
        this.reportMetric(`${action}_duration`, duration);
    }
}
```

### 11.4 Security & Privacy
**보안 계층**:
- API 키 암호화 및 환경변수 사용
- CSP (Content Security Policy) 설정
- XSS/CSRF 방어
- 민감 데이터 로컬 암호화

**프라이버시 보호**:
- 사용자 동의 관리
- 데이터 최소화 수집
- 위치 데이터 익명화
- 로컬 데이터 자동 삭제

## 12. 대안 및 폴백 전략

### 12.1 API 장애 대응
**Google Maps API 대체**:
- OpenStreetMap + Leaflet.js
- Mapbox (Free Tier)
- 오프라인 지도 타일 캐싱

**번역 API 대체**:
- 로컬 사전 기반 기본 번역
- 오프라인 OCR (Tesseract.js)
- 미리 정의된 필수 문구 목록

### 12.2 로우엔드 디바이스 대응
**성능 최적화**:
```javascript
class DeviceAdapter {
    static getOptimalSettings() {
        const connection = navigator.connection;
        const memoryInfo = navigator.deviceMemory;
        
        return {
            imageQuality: connection?.effectiveType === '4g' ? 'high' : 'medium',
            mapTileSize: memoryInfo > 4 ? 512 : 256,
            syncInterval: connection?.downlink > 10 ? 30000 : 120000
        };
    }
}
```

### 12.3 브라우저 호환성
**Progressive Enhancement**:
- 기본 HTML 기능 우선
- JavaScript 없이도 기본 기능 동작
- 최신 기능은 Feature Detection 후 적용

**레거시 브라우저 지원**:
- Polyfill 자동 로드
- CSS Grid/Flexbox Fallback
- ES5 트랜스파일 버전 제공

## 13. 개발 로드맵

### Phase 1: Core Foundation (1-2주)
1. 기본 HTML/CSS 레이아웃 완성
2. 핵심 JavaScript 모듈 구현
3. Google Maps 기본 연동
4. PWA 기본 설정

### Phase 2: Data Integration (2-3주)
1. Google Sheets API 연동
2. 데이터 동기화 시스템
3. 오프라인 모드 구현
4. 기본 예산 추적 기능

### Phase 3: Advanced Features (3-4주)
1. 까메라 비전 OCR 및 번역
2. 음성 인터페이스
3. 스마트 추천 시스템
4. 고급 지도 기능

### Phase 4: Optimization & Testing (1-2주)
1. 성능 최적화
2. 크로스 브라우저 테스트
3. 보안 강화
4. 사용자 테스트 및 피드백 반영

---

---

# 14. 추가 HTML 페이지 상세 설계 (Additional HTML Pages Design)

## 14.1 페이지 구조 개요

### 메인 허브 페이지 (main.html)
- **역할**: 전체 시스템의 중앙 허브, 모든 기능으로의 진입점
- **특징**: SPA(Single Page Application) 구조로 모든 기능을 포함
- **주요 섹션**: 대시보드, 지도, 일정, 예산, 번역, 응급상황

### 보조 페이지들
각 보조 페이지는 독립적으로도 접근 가능하며, 특정 기능에 특화된 전용 인터페이스 제공

---

## 14.2 itinerary.html - 상세 일정 관리 페이지

### 페이지 목적
- 5일간의 여행 일정을 시간대별로 상세 관리
- 실시간 일정 수정 및 최적화 기능
- GPS 기반 이동 시간 자동 계산

### 핵심 기능 설계
```javascript
class ItineraryManager {
    constructor() {
        this.schedules = new Map(); // 날짜별 일정 저장
        this.currentDate = new Date('2025-09-27');
        this.dragState = { active: false, element: null };
    }
    
    // 드래그 앤 드롭으로 일정 순서 변경
    enableDragReorder() {
        const timelineItems = document.querySelectorAll('.timeline-item');
        timelineItems.forEach(item => {
            item.draggable = true;
            item.addEventListener('dragstart', this.handleDragStart.bind(this));
            item.addEventListener('dragover', this.handleDragOver.bind(this));
            item.addEventListener('drop', this.handleDrop.bind(this));
        });
    }
    
    // GPS 기반 자동 이동시간 계산
    async calculateTravelTime(fromPOI, toPOI) {
        const directionsService = new google.maps.DirectionsService();
        
        return new Promise((resolve, reject) => {
            directionsService.route({
                origin: fromPOI.coordinates,
                destination: toPOI.coordinates,
                travelMode: google.maps.TravelMode.DRIVING,
                drivingOptions: {
                    departureTime: new Date(),
                    trafficModel: google.maps.TrafficModel.BEST_GUESS
                }
            }, (result, status) => {
                if (status === 'OK') {
                    resolve({
                        duration: result.routes[0].legs[0].duration.text,
                        distance: result.routes[0].legs[0].distance.text,
                        durationValue: result.routes[0].legs[0].duration.value
                    });
                }
            });
        });
    }
    
    // POI 자동완성 검색
    searchPOIs(query) {
        return app.miyakojimaPOIs.filter(poi => 
            poi.name_ko.toLowerCase().includes(query.toLowerCase()) ||
            poi.name_jp.toLowerCase().includes(query.toLowerCase()) ||
            poi.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
        ).slice(0, 10);
    }
    
    // ChatGPT 동기화
    async syncWithChatGPT() {
        const scheduleData = this.exportScheduleData();
        // 여기서 실제로는 사용자가 ChatGPT Projects에 복사할 수 있도록 
        // JSON 형태로 포맷팅된 데이터를 제공
        const formattedData = this.formatForChatGPT(scheduleData);
        this.showSyncModal(formattedData);
    }
}
```

### HTML 구조 핵심 요소
```html
<!-- 날짜 네비게이션 - 스와이프 지원 -->
<nav class="date-nav" id="dateNav">
    <div class="date-slider">
        <!-- 5일간의 날짜 버튼들 -->
    </div>
</nav>

<!-- 타임라인 - 드래그 앤 드롭 지원 -->
<div class="timeline-content" id="timelineContent">
    <div class="timeline-item" data-event-id="event1" draggable="true">
        <div class="timeline-time">09:00</div>
        <div class="timeline-content">
            <h4>나하공항 도착</h4>
            <p>비행기 착륙 후 입국 수속</p>
            <div class="timeline-meta">
                <span class="duration">30분</span>
                <span class="location">나하공항</span>
            </div>
        </div>
        <div class="timeline-actions">
            <button onclick="editEvent('event1')">✏️</button>
            <button onclick="deleteEvent('event1')">🗑️</button>
        </div>
    </div>
    <!-- 더 많은 타임라인 아이템들... -->
</div>

<!-- 지도 미리보기 - 일정 경로 표시 -->
<div id="miniMap" class="mini-map-container"></div>
```

---

## 14.3 budget.html - 실시간 예산 관리 페이지

### 페이지 목적
- 실시간 지출 내역 추적 및 분석
- 카테고리별 예산 대비 지출 현황
- 환율 변동 실시간 반영

### 핵심 기능 설계
```javascript
class BudgetTracker {
    constructor() {
        this.totalBudget = 2000000; // KRW
        this.expenses = [];
        this.categories = {
            food: { budget: 600000, spent: 0, name: '식비', icon: '🍽️' },
            transport: { budget: 400000, spent: 0, name: '교통비', icon: '🚗' },
            activity: { budget: 600000, spent: 0, name: '액티비티', icon: '🎯' },
            shopping: { budget: 400000, spent: 0, name: '쇼핑', icon: '🛍️' }
        };
        this.exchangeRate = 0.1; // KRW to JPY
        this.lastRateUpdate = null;
    }
    
    // 실시간 환율 업데이트
    async updateExchangeRate() {
        try {
            const response = await fetch('https://api.exchangerate-api.com/v4/latest/KRW');
            const data = await response.json();
            this.exchangeRate = data.rates.JPY;
            this.lastRateUpdate = new Date();
            this.updateCurrencyDisplay();
        } catch (error) {
            console.warn('환율 업데이트 실패, 캐시된 환율 사용');
        }
    }
    
    // 지출 추가 (OCR 지원)
    addExpense(amount, currency, category, memo, location = null) {
        const expense = {
            id: Date.now(),
            amount: currency === 'JPY' ? amount / this.exchangeRate : amount,
            originalAmount: amount,
            currency,
            category,
            memo,
            location,
            timestamp: new Date(),
            receiptImage: null
        };
        
        this.expenses.push(expense);
        this.categories[category].spent += expense.amount;
        this.updateBudgetDisplay();
        this.saveToLocalStorage();
        
        // 예산 초과 알림
        this.checkBudgetAlert(category);
    }
    
    // 영수증 OCR 처리
    async processReceiptImage(imageFile) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        return new Promise((resolve, reject) => {
            img.onload = async () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                try {
                    // Tesseract.js로 OCR 수행
                    const { data: { text } } = await Tesseract.recognize(canvas, 'jpn');
                    const extractedData = this.parseJapaneseReceipt(text);
                    resolve(extractedData);
                } catch (error) {
                    reject(error);
                }
            };
            img.src = URL.createObjectURL(imageFile);
        });
    }
    
    // 일본 영수증 텍스트 파싱
    parseJapaneseReceipt(ocrText) {
        const patterns = {
            amount: /¥?[\d,]+円?|[\d,]+¥/g,
            date: /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/g,
            time: /\d{1,2}:\d{2}/g
        };
        
        const amounts = ocrText.match(patterns.amount);
        const totalAmount = amounts ? parseInt(amounts[amounts.length - 1].replace(/[¥,円]/g, '')) : 0;
        
        return {
            amount: totalAmount,
            currency: 'JPY',
            text: ocrText,
            confidence: 0.8
        };
    }
    
    // 예산 초과 알림
    checkBudgetAlert(category) {
        const cat = this.categories[category];
        const percentage = (cat.spent / cat.budget) * 100;
        
        if (percentage >= 90) {
            this.showBudgetAlert(`${cat.name} 예산의 ${Math.round(percentage)}%를 사용했습니다!`, 'warning');
        } else if (percentage >= 100) {
            this.showBudgetAlert(`${cat.name} 예산을 초과했습니다!`, 'danger');
        }
    }
}
```

### 카테고리별 시각화
```css
.category-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    transition: transform 0.2s;
}

.category-card:hover {
    transform: translateY(-2px);
}

.progress-bar {
    width: 100%;
    height: 8px;
    background: #f0f0f0;
    border-radius: 4px;
    overflow: hidden;
    margin: 1rem 0;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4facfe 0%, #00f2fe 100%);
    transition: width 0.3s ease;
}

.progress-fill.warning { background: linear-gradient(90deg, #ff9a56 0%, #ffad56 100%); }
.progress-fill.danger { background: linear-gradient(90deg, #ff6b6b 0%, #ff5252 100%); }
```

---

## 14.4 translate.html - 고급 번역 도구 페이지

### 페이지 목적
- 실시간 텍스트, 음성, 이미지 번역
- 오프라인 번역 기능
- 여행 상황별 맞춤 번역 템플릿

### 핵심 기능 설계
```javascript
class AdvancedTranslator {
    constructor() {
        this.currentMode = 'text';
        this.sourceLang = 'ko';
        this.targetLang = 'ja';
        this.voiceRecognition = null;
        this.speechSynthesis = window.speechSynthesis;
        this.camera = null;
        this.offlineDict = new Map(); // 오프라인 사전
        this.conversationHistory = [];
    }
    
    // 오프라인 번역 사전 초기화
    async initializeOfflineDict() {
        const essentialPhrases = {
            'ko': {
                '도와주세요': 'たすけてください',
                '얼마예요?': 'いくらですか？',
                '화장실 어디예요?': 'トイレはどこですか？',
                '맛있어요': 'おいしいです',
                '감사합니다': 'ありがとうございます'
                // ... 더 많은 필수 문구들
            }
        };
        
        this.offlineDict = new Map(Object.entries(essentialPhrases.ko));
        this.loadSavedTranslations();
    }
    
    // 실시간 음성 번역
    startVoiceTranslation() {
        if (!('webkitSpeechRecognition' in window)) {
            alert('음성 인식을 지원하지 않는 브라우저입니다.');
            return;
        }
        
        this.voiceRecognition = new webkitSpeechRecognition();
        this.voiceRecognition.continuous = false;
        this.voiceRecognition.interimResults = false;
        this.voiceRecognition.lang = this.sourceLang === 'ko' ? 'ko-KR' : 'ja-JP';
        
        this.voiceRecognition.onstart = () => {
            document.getElementById('voiceStatus').textContent = '음성 인식 중...';
        };
        
        this.voiceRecognition.onresult = async (event) => {
            const transcript = event.results[0][0].transcript;
            document.getElementById('detectedText').textContent = transcript;
            
            // 번역 수행
            const translation = await this.translateText(transcript);
            document.getElementById('voiceTranslatedText').textContent = translation;
            
            // TTS로 번역 결과 재생
            this.speakText(translation, this.targetLang);
        };
        
        this.voiceRecognition.start();
    }
    
    // 카메라 OCR 번역
    async startCameraTranslation() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
            
            const video = document.getElementById('cameraVideo');
            video.srcObject = stream;
            this.camera = stream;
            
            // 자동 촬영 모드 (1초마다 OCR 수행)
            this.ocrInterval = setInterval(() => {
                this.captureAndTranslate();
            }, 1000);
            
        } catch (error) {
            console.error('카메라 접근 실패:', error);
            alert('카메라에 접근할 수 없습니다.');
        }
    }
    
    // 이미지 캡처 및 OCR
    async captureAndTranslate() {
        const video = document.getElementById('cameraVideo');
        const canvas = document.getElementById('cameraCanvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        
        try {
            const { data: { text } } = await Tesseract.recognize(canvas, 'jpn', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const progress = Math.round(m.progress * 100);
                        document.getElementById('ocrProgress').textContent = `인식 중... ${progress}%`;
                    }
                }
            });
            
            if (text.trim()) {
                document.getElementById('ocrText').textContent = text;
                const translation = await this.translateText(text);
                document.getElementById('imageTranslatedText').textContent = translation;
            }
            
        } catch (error) {
            console.error('OCR 실패:', error);
        }
    }
    
    // 대화형 번역 (양방향)
    startConversationMode() {
        this.conversationHistory = [];
        const historyDiv = document.getElementById('conversationHistory');
        historyDiv.innerHTML = '<p class="conversation-intro">대화를 시작하세요. 마이크 버튼을 누르고 말씀해주세요.</p>';
        
        // 화자 전환 자동 감지
        this.setupSpeakerDetection();
    }
    
    // 번역 결과를 대화 히스토리에 추가
    addToConversation(originalText, translatedText, speaker) {
        const conversationItem = {
            id: Date.now(),
            original: originalText,
            translated: translatedText,
            speaker: speaker, // 'user' or 'other'
            timestamp: new Date()
        };
        
        this.conversationHistory.push(conversationItem);
        this.updateConversationDisplay();
        this.saveConversation();
    }
    
    // 상황별 템플릿 로드
    loadTemplatesByCategory(category) {
        const templates = {
            basic: [
                { ko: '안녕하세요', ja: 'こんにちは', romaji: 'konnichiwa' },
                { ko: '감사합니다', ja: 'ありがとうございます', romaji: 'arigatou gozaimasu' },
                { ko: '죄송합니다', ja: 'すみません', romaji: 'sumimasen' }
            ],
            restaurant: [
                { ko: '메뉴 좀 보여주세요', ja: 'メニューを見せてください', romaji: 'menyuu wo misete kudasai' },
                { ko: '주문하고 싶습니다', ja: '注文したいです', romaji: 'chuumon shitai desu' },
                { ko: '맛있었습니다', ja: 'おいしかったです', romaji: 'oishikatta desu' }
            ],
            shopping: [
                { ko: '이것 얼마예요?', ja: 'これはいくらですか？', romaji: 'kore wa ikura desu ka?' },
                { ko: '더 큰 사이즈 있나요?', ja: 'もっと大きいサイズはありますか？', romaji: 'motto ookii saizu wa arimasu ka?' },
                { ko: '카드로 결제할 수 있나요?', ja: 'カードで支払えますか？', romaji: 'kaado de shiharaemasu ka?' }
            ]
            // ... 더 많은 카테고리
        };
        
        return templates[category] || [];
    }
}
```

### 음성 시각화
```css
.voice-visualizer {
    width: 100%;
    height: 120px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 2rem 0;
    position: relative;
    overflow: hidden;
}

.wave-container {
    display: flex;
    align-items: center;
    gap: 4px;
}

.wave-bar {
    width: 4px;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 2px;
    animation: wave 1.5s ease-in-out infinite;
}

@keyframes wave {
    0%, 100% { height: 10px; }
    50% { height: 40px; }
}
```

---

## 14.5 emergency.html - 응급상황 대응 페이지

### 페이지 목적
- 응급상황 시 빠른 대응 가이드
- 현지 응급 연락처 및 병원 정보
- 위치 기반 최적 대응 방안 제시

### 핵심 기능 설계
```javascript
class EmergencyHandler {
    constructor() {
        this.sosActivated = false;
        this.emergencyContacts = [
            { name: '구급차', number: '119', type: 'medical' },
            { name: '경찰', number: '110', type: 'police' },
            { name: '한국영사관', number: '+81-3-3580-3311', type: 'consulate' }
        ];
        this.currentLocation = null;
        this.nearbyHospitals = [];
        this.personalInfo = {
            name: '김은태',
            passportNumber: 'M********',
            bloodType: 'A',
            allergies: '없음',
            emergencyContact: '+82-10-****-****'
        };
    }
    
    // SOS 모드 활성화
    activateSOSMode() {
        this.sosActivated = true;
        document.body.classList.add('sos-mode');
        
        // 1. 현재 위치 획득
        this.getCurrentLocation();
        
        // 2. 긴급 연락처에 위치 전송 (시뮬레이션)
        this.sendLocationToEmergencyContact();
        
        // 3. 근처 응급 시설 검색
        this.findNearbyEmergencyFacilities();
        
        // 4. 화면을 밝게 하고 깜빡이는 효과
        this.activateVisualAlert();
        
        // 5. 응급 메시지 TTS
        this.speakEmergencyMessage();
    }
    
    // 현재 위치 기반 병원 검색
    async findNearbyEmergencyFacilities() {
        if (!this.currentLocation) return;
        
        const hospitals = [
            {
                name: '미야코지마시 병원',
                nameEn: 'Miyakojima City Hospital',
                phone: '+81-980-72-3151',
                address: '906-8585 오키나와현 미야코지마시',
                coordinates: { lat: 24.8055, lng: 125.2767 },
                services: ['응급실', '내과', '외과'],
                openHours: '24시간'
            },
            {
                name: '쿠니가미 병원', 
                nameEn: 'Kunigami Hospital',
                phone: '+81-980-72-2045',
                address: '906-0015 오키나와현 미야코지마시',
                coordinates: { lat: 24.8123, lng: 125.2654 },
                services: ['응급실', '정형외과'],
                openHours: '9:00-17:00'
            }
        ];
        
        // 거리별 정렬
        this.nearbyHospitals = hospitals.map(hospital => ({
            ...hospital,
            distance: this.calculateDistance(
                this.currentLocation.coords.latitude,
                this.currentLocation.coords.longitude,
                hospital.coordinates.lat,
                hospital.coordinates.lng
            )
        })).sort((a, b) => a.distance - b.distance);
        
        this.updateHospitalList();
    }
    
    // 응급 상황별 가이드 제공
    showEmergencyGuide(type) {
        const guides = {
            medical: {
                title: '의료 응급상황',
                steps: [
                    '1. 환자를 안전한 곳으로 이동',
                    '2. 119 또는 가까운 병원에 연락',
                    '3. 의식 확인 및 호흡 확인',
                    '4. 응급처치 시행 (가능한 경우)',
                    '5. 구급차 도착까지 환자 상태 모니터링'
                ],
                phrases: [
                    { ko: '응급상황입니다!', ja: '緊急事態です！' },
                    { ko: '구급차를 불러주세요', ja: '救急車を呼んでください' },
                    { ko: '병원에 가야 합니다', ja: '病院に行かなければなりません' }
                ]
            },
            lost: {
                title: '길을 잃었을 때',
                steps: [
                    '1. 당황하지 말고 주변 확인',
                    '2. 마지막으로 기억하는 장소 떠올리기',
                    '3. 주변 사람들에게 도움 요청',
                    '4. 스마트폰 GPS 활용',
                    '5. 택시나 대중교통 이용해서 숙소로 복귀'
                ],
                phrases: [
                    { ko: '길을 잃었습니다', ja: '道に迷いました' },
                    { ko: '도와주세요', ja: '助けてください' },
                    { ko: '이 곳이 어디인가요?', ja: 'ここはどこですか？' }
                ]
            }
        };
        
        const guide = guides[type];
        if (guide) {
            this.displayGuideModal(guide);
        }
    }
    
    // 개인정보 QR코드 생성
    generatePersonalInfoQR() {
        const qrData = {
            name: this.personalInfo.name,
            passport: this.personalInfo.passportNumber,
            nationality: '대한민국 (South Korea)',
            bloodType: this.personalInfo.bloodType,
            allergies: this.personalInfo.allergies,
            emergencyContact: this.personalInfo.emergencyContact,
            location: this.currentLocation ? {
                lat: this.currentLocation.coords.latitude,
                lng: this.currentLocation.coords.longitude
            } : null,
            timestamp: new Date().toISOString()
        };
        
        // QR 코드 라이브러리로 생성
        const qrCodeDiv = document.getElementById('qr-code');
        qrCodeDiv.innerHTML = '';
        
        new QRCode(qrCodeDiv, {
            text: JSON.stringify(qrData),
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff'
        });
    }
    
    // 응급 메시지 TTS
    speakEmergencyMessage() {
        const messages = [
            'たすけてください。わたしは韓国人です。', // 도와주세요. 저는 한국인입니다.
            'びょういんに行きたいです。', // 병원에 가고 싶습니다.
            'きんきゅうじたいです。' // 응급상황입니다.
        ];
        
        messages.forEach((message, index) => {
            setTimeout(() => {
                const utterance = new SpeechSynthesisUtterance(message);
                utterance.lang = 'ja-JP';
                utterance.rate = 0.8;
                utterance.volume = 1.0;
                speechSynthesis.speak(utterance);
            }, index * 3000);
        });
    }
}
```

### 응급상황 전용 CSS
```css
/* SOS 모드 활성화 시 전체 화면 스타일 */
.sos-mode {
    background: #ff4757 !important;
    animation: sos-flash 1s infinite;
}

@keyframes sos-flash {
    0%, 50% { background: #ff4757; }
    51%, 100% { background: #ff3838; }
}

.emergency-alert {
    background: linear-gradient(135deg, #ff4757, #ff3838);
    color: white;
    text-align: center;
    padding: 1rem;
    font-size: 1.2rem;
    font-weight: bold;
    border-radius: 8px;
    margin-bottom: 2rem;
    box-shadow: 0 4px 15px rgba(255, 71, 87, 0.3);
}

.quick-call-btn {
    background: #ff4757;
    color: white;
    border: none;
    border-radius: 10px;
    padding: 1.5rem 1rem;
    font-size: 1.1rem;
    font-weight: bold;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    transition: all 0.2s;
    box-shadow: 0 4px 15px rgba(255, 71, 87, 0.2);
}

.quick-call-btn:hover {
    background: #ff3838;
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(255, 71, 87, 0.3);
}

.hospital-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1rem;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    border-left: 4px solid #4facfe;
}

.emergency-phrase-item {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 0.5rem;
    display: flex;
    justify-content: between;
    align-items: center;
    border: 2px solid transparent;
    transition: all 0.2s;
}

.emergency-phrase-item:hover {
    border-color: #4facfe;
    background: #e3f2fd;
}
```

---

## 14.6 페이지 간 연동 설계

### 네비게이션 구조
```javascript
class PageNavigation {
    constructor() {
        this.currentPage = 'main';
        this.navigationHistory = [];
        this.sharedData = new Map();
    }
    
    // 페이지 간 데이터 공유
    shareData(key, data) {
        this.sharedData.set(key, {
            data: data,
            timestamp: Date.now(),
            source: this.currentPage
        });
        
        // LocalStorage에도 저장
        localStorage.setItem(`shared_${key}`, JSON.stringify({
            data: data,
            timestamp: Date.now()
        }));
    }
    
    // 공유된 데이터 가져오기
    getSharedData(key) {
        if (this.sharedData.has(key)) {
            return this.sharedData.get(key).data;
        }
        
        // LocalStorage에서 복원
        const stored = localStorage.getItem(`shared_${key}`);
        if (stored) {
            const parsed = JSON.parse(stored);
            return parsed.data;
        }
        
        return null;
    }
    
    // 페이지 전환 시 상태 저장
    savePageState() {
        const currentState = {
            page: this.currentPage,
            scrollPosition: window.scrollY,
            formData: this.extractFormData(),
            timestamp: Date.now()
        };
        
        localStorage.setItem('lastPageState', JSON.stringify(currentState));
    }
    
    // 페이지 전환 후 상태 복원
    restorePageState() {
        const saved = localStorage.getItem('lastPageState');
        if (saved) {
            const state = JSON.parse(saved);
            
            // 1분 이내의 상태만 복원
            if (Date.now() - state.timestamp < 60000) {
                setTimeout(() => {
                    window.scrollTo(0, state.scrollPosition);
                    this.restoreFormData(state.formData);
                }, 100);
            }
        }
    }
}
```

### 공통 헤더 컴포넌트
```html
<!-- 모든 페이지에 공통으로 포함될 헤더 -->
<header class="page-header">
    <div class="header-content">
        <div class="header-left">
            <button class="back-btn" onclick="window.history.back()">
                <i class="fas fa-arrow-left"></i>
            </button>
            <h1 id="page-title">페이지 제목</h1>
        </div>
        <div class="header-right">
            <button class="home-btn" onclick="window.location.href='main.html'">
                <i class="fas fa-home"></i>
            </button>
            <button class="menu-btn" onclick="toggleMenu()">
                <i class="fas fa-bars"></i>
            </button>
        </div>
    </div>
    
    <!-- 공통 네비게이션 메뉴 -->
    <nav class="quick-nav" id="quickNav" style="display: none;">
        <a href="main.html" class="nav-item">
            <i class="fas fa-tachometer-alt"></i>
            <span>대시보드</span>
        </a>
        <a href="itinerary.html" class="nav-item">
            <i class="fas fa-calendar-alt"></i>
            <span>일정</span>
        </a>
        <a href="budget.html" class="nav-item">
            <i class="fas fa-wallet"></i>
            <span>예산</span>
        </a>
        <a href="translate.html" class="nav-item">
            <i class="fas fa-language"></i>
            <span>번역</span>
        </a>
        <a href="emergency.html" class="nav-item emergency">
            <i class="fas fa-exclamation-triangle"></i>
            <span>응급상황</span>
        </a>
    </nav>
</header>
```

---

**✨ 최종 완성 목표**

이 전체 설계서를 기반으로 GitHub Pages에서 동작하는 완전한 여행 컴패니언 웹사이트를 구축하여, ChatGPT Projects의 모든 기능을 실시간 GUI로 사용할 수 있도록 하고, 여자친구에게 최고의 여행 경험을 제공합니다.

**📋 추가 HTML 페이지 설계 완료**
- ✅ itinerary.html: 드래그앤드롭 일정 관리 + GPS 기반 이동시간 계산
- ✅ budget.html: 실시간 환율 연동 + OCR 영수증 인식
- ✅ translate.html: 4가지 모드 번역 + 오프라인 지원 + 상황별 템플릿
- ✅ emergency.html: SOS 모드 + 개인정보 QR코드 + 위치 기반 병원 검색
- ✅ 페이지 간 연동 시스템 + 공통 네비게이션 구조