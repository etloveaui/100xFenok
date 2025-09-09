# PWA 및 서비스 워커 설계서
# Progressive Web App and Service Worker Architecture

**문서 목적**: 미야코지마 여행 웹 플랫폼의 PWA 기능과 오프라인 대응 전략 수립  
**작성일**: 2025년 9월 7일  
**대상 기간**: 2025년 9월 27일 ~ 10월 1일 (4박 5일)  

---

## 1. PWA 개요 및 목표

### 1.1 PWA 적용 목표
- **오프라인 우선 설계**: 네트워크 없이도 핵심 기능 사용 가능
- **네이티브 앱 수준의 UX**: 설치 가능하고 빠른 로딩
- **배터리 효율성**: 데이터 사용량 최소화 및 배터리 절약
- **실시간 동기화**: 연결 복구 시 자동 데이터 동기화

### 1.2 핵심 PWA 기능
1. **App Shell Architecture**: 즉시 로드되는 기본 UI 프레임워크
2. **Service Worker**: 캐싱, 오프라인 처리, 백그라운드 동기화
3. **Web App Manifest**: 홈 화면 추가 및 네이티브 앱 경험
4. **Push Notifications**: 여행 알림 및 응급 상황 알림
5. **Background Sync**: 오프라인에서 작업한 데이터의 자동 동기화

---

## 2. 서비스 워커 아키텍처

### 2.1 서비스 워커 등록 및 생명주기
```javascript
// sw-registration.js - 메인 등록 파일
class ServiceWorkerManager {
    constructor() {
        this.swPath = '/sw.js';
        this.registration = null;
        this.isOnline = navigator.onLine;
        this.setupEventListeners();
    }
    
    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                this.registration = await navigator.serviceWorker.register(this.swPath, {
                    scope: '/',
                    updateViaCache: 'none'
                });
                
                console.log('SW registered successfully:', this.registration.scope);
                
                // 서비스 워커 업데이트 감지
                this.registration.addEventListener('updatefound', () => {
                    this.handleServiceWorkerUpdate();
                });
                
                // 즉시 활성화된 서비스 워커 있는지 확인
                if (this.registration.active) {
                    this.setupMessageChannel();
                }
                
            } catch (error) {
                console.error('SW registration failed:', error);
            }
        }
    }
    
    handleServiceWorkerUpdate() {
        const newWorker = this.registration.installing;
        
        newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                    // 기존 SW가 있음 - 업데이트 알림
                    this.showUpdateAvailable();
                } else {
                    // 첫 설치 - 캐시 준비 알림
                    this.showCacheReady();
                }
            }
        });
    }
    
    // 서비스 워커와 메인 스레드 간 통신
    setupMessageChannel() {
        navigator.serviceWorker.addEventListener('message', (event) => {
            const { type, data } = event.data;
            
            switch (type) {
                case 'CACHE_UPDATED':
                    this.handleCacheUpdate(data);
                    break;
                case 'SYNC_COMPLETED':
                    this.handleSyncCompleted(data);
                    break;
                case 'OFFLINE_FALLBACK':
                    this.handleOfflineMode();
                    break;
            }
        });
    }
    
    setupEventListeners() {
        // 온라인/오프라인 상태 변화 감지
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.handleOnlineStatusChange(true);
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.handleOnlineStatusChange(false);
        });
        
        // 페이지 가시성 변화 감지 (백그라운드 동기화용)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isOnline) {
                this.requestBackgroundSync();
            }
        });
    }
}

// SW 관리자 초기화
const swManager = new ServiceWorkerManager();
swManager.registerServiceWorker();
```

### 2.2 메인 서비스 워커 구조
```javascript
// sw.js - 메인 서비스 워커 파일
const CACHE_VERSION = 'miyakojima-v1.2.0';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

// 캐시할 정적 리소스 목록
const STATIC_ASSETS = [
    // HTML 파일
    '/',
    '/main.html',
    '/itinerary.html',
    '/budget.html',
    '/translate.html',
    '/emergency.html',
    
    // CSS 파일
    '/css/main.css',
    '/css/itinerary.css',
    '/css/budget.css',
    '/css/translate.css',
    '/css/emergency.css',
    
    // JavaScript 파일
    '/js/core.js',
    '/js/app.js',
    '/js/itinerary.js',
    '/js/budget.js',
    '/js/translate.js',
    '/js/emergency.js',
    
    // 데이터 파일
    '/data/miyakojima_database.json',
    '/data/accommodations.json',
    '/data/travel_checklist.json',
    '/data/dining_guide.json',
    
    // 아이콘 및 이미지
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/images/offline-fallback.jpg',
    
    // 폰트 및 라이브러리
    '/fonts/NotoSansKR-Regular.woff2',
    '/libs/tesseract.js',
    '/libs/qrcode.min.js'
];

// 오프라인 폴백 페이지
const OFFLINE_FALLBACK = '/offline.html';

class ServiceWorkerCore {
    constructor() {
        this.setupEventListeners();
        this.cacheStrategies = new CacheStrategies();
        this.backgroundSync = new BackgroundSync();
        this.pushManager = new PushNotificationManager();
    }
    
    setupEventListeners() {
        self.addEventListener('install', this.handleInstall.bind(this));
        self.addEventListener('activate', this.handleActivate.bind(this));
        self.addEventListener('fetch', this.handleFetch.bind(this));
        self.addEventListener('sync', this.handleSync.bind(this));
        self.addEventListener('push', this.handlePush.bind(this));
        self.addEventListener('message', this.handleMessage.bind(this));
    }
    
    async handleInstall(event) {
        console.log('SW: Installing...');
        
        event.waitUntil(
            Promise.all([
                this.preloadStaticAssets(),
                this.preloadCriticalData(),
                self.skipWaiting() // 즉시 활성화
            ])
        );
    }
    
    async preloadStaticAssets() {
        const cache = await caches.open(STATIC_CACHE);
        
        // 중요한 리소스는 즉시 캐시
        const criticalAssets = STATIC_ASSETS.filter(asset => 
            asset.includes('.html') || 
            asset.includes('core.js') || 
            asset.includes('main.css')
        );
        
        await cache.addAll(criticalAssets);
        
        // 나머지 리소스는 백그라운드에서 캐시
        setTimeout(async () => {
            const remainingAssets = STATIC_ASSETS.filter(asset => 
                !criticalAssets.includes(asset)
            );
            
            for (const asset of remainingAssets) {
                try {
                    await cache.add(asset);
                } catch (error) {
                    console.warn(`Failed to cache ${asset}:`, error);
                }
            }
        }, 1000);
    }
    
    async preloadCriticalData() {
        // 여행 핵심 데이터 미리 캐시
        const criticalData = [
            '/data/miyakojima_database.json',
            '/data/emergency_contacts.json',
            '/data/offline_translate_dict.json'
        ];
        
        const cache = await caches.open(API_CACHE);
        
        for (const dataUrl of criticalData) {
            try {
                await cache.add(dataUrl);
            } catch (error) {
                console.warn(`Failed to preload ${dataUrl}:`, error);
            }
        }
    }
    
    async handleActivate(event) {
        console.log('SW: Activating...');
        
        event.waitUntil(
            Promise.all([
                this.cleanOldCaches(),
                self.clients.claim() // 모든 클라이언트 즉시 제어
            ])
        );
    }
    
    async cleanOldCaches() {
        const cacheNames = await caches.keys();
        const oldCaches = cacheNames.filter(name => 
            name !== STATIC_CACHE && 
            name !== DYNAMIC_CACHE && 
            name !== API_CACHE
        );
        
        return Promise.all(
            oldCaches.map(cacheName => caches.delete(cacheName))
        );
    }
    
    handleFetch(event) {
        const { request } = event;
        const url = new URL(request.url);
        
        // 캐시 전략 결정
        if (this.isStaticAsset(request)) {
            event.respondWith(this.cacheStrategies.cacheFirst(request));
        } else if (this.isAPIRequest(request)) {
            event.respondWith(this.cacheStrategies.networkFirst(request));
        } else if (this.isImageRequest(request)) {
            event.respondWith(this.cacheStrategies.cacheFirst(request));
        } else if (this.isNavigationRequest(request)) {
            event.respondWith(this.cacheStrategies.navigationHandler(request));
        } else {
            event.respondWith(this.cacheStrategies.staleWhileRevalidate(request));
        }
    }
    
    isStaticAsset(request) {
        const url = new URL(request.url);
        return url.pathname.match(/\.(js|css|woff2|png|jpg|svg)$/);
    }
    
    isAPIRequest(request) {
        const url = new URL(request.url);
        return url.pathname.startsWith('/api/') || 
               url.hostname !== location.hostname;
    }
    
    isImageRequest(request) {
        return request.destination === 'image';
    }
    
    isNavigationRequest(request) {
        return request.mode === 'navigate';
    }
}

// 캐시 전략 클래스
class CacheStrategies {
    // Cache First: 정적 리소스용
    async cacheFirst(request) {
        const cache = await caches.open(STATIC_CACHE);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        try {
            const networkResponse = await fetch(request);
            if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
            return networkResponse;
        } catch (error) {
            console.error('Cache First failed:', error);
            return new Response('Resource not available offline', { status: 503 });
        }
    }
    
    // Network First: API 요청용
    async networkFirst(request) {
        const cache = await caches.open(API_CACHE);
        
        try {
            const networkResponse = await fetch(request);
            if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
            return networkResponse;
        } catch (error) {
            console.warn('Network First fallback to cache:', request.url);
            const cachedResponse = await cache.match(request);
            
            if (cachedResponse) {
                // 캐시된 데이터가 오래된 경우 표시
                const response = cachedResponse.clone();
                const headers = new Headers(response.headers);
                headers.set('X-Cache-Status', 'stale');
                
                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: headers
                });
            }
            
            return new Response(
                JSON.stringify({ error: 'Data not available offline' }),
                { 
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
    }
    
    // Stale While Revalidate: 일반 리소스용
    async staleWhileRevalidate(request) {
        const cache = await caches.open(DYNAMIC_CACHE);
        const cachedResponse = await cache.match(request);
        
        // 백그라운드에서 업데이트
        const networkResponsePromise = fetch(request).then(response => {
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        }).catch(() => null);
        
        // 캐시된 버전이 있으면 즉시 반환
        if (cachedResponse) {
            networkResponsePromise; // 백그라운드에서 실행
            return cachedResponse;
        }
        
        // 캐시된 버전이 없으면 네트워크 기다림
        try {
            return await networkResponsePromise;
        } catch (error) {
            return new Response('Content not available', { status: 503 });
        }
    }
    
    // Navigation Handler: HTML 페이지용
    async navigationHandler(request) {
        const cache = await caches.open(STATIC_CACHE);
        
        try {
            // 먼저 네트워크에서 시도
            return await fetch(request);
        } catch (error) {
            // 네트워크 실패 시 캐시에서 찾기
            const cachedResponse = await cache.match(request);
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // 특정 페이지가 없으면 메인 페이지로 폴백
            const mainPage = await cache.match('/main.html');
            if (mainPage) {
                return mainPage;
            }
            
            // 모든 것이 실패하면 오프라인 페이지
            return cache.match(OFFLINE_FALLBACK);
        }
    }
}

// 백그라운드 동기화 클래스
class BackgroundSync {
    constructor() {
        this.syncTags = {
            BUDGET_SYNC: 'budget-sync',
            ITINERARY_SYNC: 'itinerary-sync',
            USER_ACTIVITY: 'user-activity-sync'
        };
    }
    
    async handleSync(event) {
        const { tag } = event;
        
        switch (tag) {
            case this.syncTags.BUDGET_SYNC:
                event.waitUntil(this.syncBudgetData());
                break;
            case this.syncTags.ITINERARY_SYNC:
                event.waitUntil(this.syncItineraryData());
                break;
            case this.syncTags.USER_ACTIVITY:
                event.waitUntil(this.syncUserActivity());
                break;
        }
    }
    
    async syncBudgetData() {
        try {
            const offlineExpenses = await this.getOfflineExpenses();
            
            if (offlineExpenses.length > 0) {
                for (const expense of offlineExpenses) {
                    await this.uploadExpense(expense);
                }
                
                await this.clearOfflineExpenses();
                this.notifyClient('BUDGET_SYNC_SUCCESS', { count: offlineExpenses.length });
            }
        } catch (error) {
            console.error('Budget sync failed:', error);
            this.notifyClient('BUDGET_SYNC_FAILED', { error: error.message });
        }
    }
    
    async syncItineraryData() {
        try {
            const offlineChanges = await this.getOfflineItineraryChanges();
            
            if (offlineChanges.length > 0) {
                for (const change of offlineChanges) {
                    await this.uploadItineraryChange(change);
                }
                
                await this.clearOfflineItineraryChanges();
                this.notifyClient('ITINERARY_SYNC_SUCCESS', { count: offlineChanges.length });
            }
        } catch (error) {
            console.error('Itinerary sync failed:', error);
            this.notifyClient('ITINERARY_SYNC_FAILED', { error: error.message });
        }
    }
    
    notifyClient(type, data) {
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({ type, data });
            });
        });
    }
}

// 푸시 알림 관리 클래스
class PushNotificationManager {
    async handlePush(event) {
        const data = event.data ? event.data.json() : {};
        
        const options = {
            body: data.body || '새로운 알림이 있습니다',
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            vibrate: [200, 100, 200],
            data: data.data || {},
            actions: data.actions || [],
            requireInteraction: data.urgent || false,
            tag: data.tag || 'general'
        };
        
        event.waitUntil(
            self.registration.showNotification(data.title || '미야코지마 여행', options)
        );
    }
    
    async handleNotificationClick(event) {
        event.notification.close();
        
        const { action, data } = event;
        let url = '/main.html';
        
        // 액션에 따른 URL 결정
        switch (action) {
            case 'view_itinerary':
                url = '/itinerary.html';
                break;
            case 'check_budget':
                url = '/budget.html';
                break;
            case 'emergency':
                url = '/emergency.html';
                break;
            default:
                if (data && data.url) {
                    url = data.url;
                }
        }
        
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(clients => {
                // 이미 열린 창이 있으면 포커스
                for (const client of clients) {
                    if (client.url === url && 'focus' in client) {
                        return client.focus();
                    }
                }
                
                // 새 창 열기
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
        );
    }
}

// 서비스 워커 초기화
const swCore = new ServiceWorkerCore();
```

---

## 3. App Shell 아키텍처

### 3.1 App Shell 구조
```html
<!-- app-shell.html - 기본 앱 껍데기 -->
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#4facfe">
    <title>미야코지마 여행 가이드</title>
    
    <!-- PWA 매니페스트 -->
    <link rel="manifest" href="/manifest.json">
    
    <!-- 즉시 로드되어야 할 중요한 CSS -->
    <style>
        /* Critical CSS - App Shell */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .app-shell {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: #f8f9fa;
        }
        
        .app-header {
            background: white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            position: sticky;
            top: 0;
            z-index: 1000;
        }
        
        .app-content {
            flex: 1;
            padding: 1rem;
            overflow-y: auto;
        }
        
        .loading-skeleton {
            animation: skeleton-loading 1.5s infinite ease-in-out;
        }
        
        @keyframes skeleton-loading {
            0% { opacity: 1; }
            50% { opacity: 0.4; }
            100% { opacity: 1; }
        }
        
        .offline-indicator {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #ff6b6b;
            color: white;
            text-align: center;
            padding: 0.5rem;
            transform: translateY(-100%);
            transition: transform 0.3s;
            z-index: 2000;
        }
        
        .offline-indicator.show {
            transform: translateY(0);
        }
    </style>
    
    <!-- 외부 CSS는 비동기 로드 -->
    <link rel="preload" href="/css/main.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
    <noscript><link rel="stylesheet" href="/css/main.css"></noscript>
</head>
<body>
    <!-- 오프라인 표시기 -->
    <div id="offlineIndicator" class="offline-indicator">
        <i class="fas fa-wifi-slash"></i>
        오프라인 모드 - 일부 기능이 제한됩니다
    </div>
    
    <div class="app-shell" id="appShell">
        <!-- 헤더 - 항상 표시 -->
        <header class="app-header" id="appHeader">
            <div class="header-skeleton loading-skeleton" style="height: 60px; background: #e0e0e0;">
                <!-- 헤더 로딩 스켈레톤 -->
            </div>
        </header>
        
        <!-- 메인 콘텐츠 영역 -->
        <main class="app-content" id="appContent">
            <div class="content-skeleton loading-skeleton">
                <!-- 콘텐츠 로딩 스켈레톤 -->
                <div style="height: 200px; background: #e0e0e0; margin-bottom: 1rem; border-radius: 8px;"></div>
                <div style="height: 100px; background: #e0e0e0; margin-bottom: 1rem; border-radius: 8px;"></div>
                <div style="height: 150px; background: #e0e0e0; border-radius: 8px;"></div>
            </div>
        </main>
    </div>
    
    <!-- 즉시 로드되어야 할 중요한 JavaScript -->
    <script>
        // App Shell 관리자
        class AppShell {
            constructor() {
                this.isLoaded = false;
                this.isOnline = navigator.onLine;
                this.setupOfflineIndicator();
                this.loadContent();
            }
            
            setupOfflineIndicator() {
                const indicator = document.getElementById('offlineIndicator');
                
                window.addEventListener('online', () => {
                    this.isOnline = true;
                    indicator.classList.remove('show');
                });
                
                window.addEventListener('offline', () => {
                    this.isOnline = false;
                    indicator.classList.add('show');
                });
                
                // 초기 상태 설정
                if (!this.isOnline) {
                    indicator.classList.add('show');
                }
            }
            
            async loadContent() {
                try {
                    // 페이지 콘텐츠 로드
                    const currentPage = this.getCurrentPage();
                    await this.loadPageContent(currentPage);
                    
                    // 스켈레톤 제거
                    this.hideSkeletons();
                    
                    this.isLoaded = true;
                } catch (error) {
                    console.error('Content loading failed:', error);
                    this.showOfflineFallback();
                }
            }
            
            getCurrentPage() {
                const path = window.location.pathname;
                if (path === '/' || path === '/main.html') return 'main';
                if (path === '/itinerary.html') return 'itinerary';
                if (path === '/budget.html') return 'budget';
                if (path === '/translate.html') return 'translate';
                if (path === '/emergency.html') return 'emergency';
                return 'main';
            }
            
            async loadPageContent(pageName) {
                const header = document.getElementById('appHeader');
                const content = document.getElementById('appContent');
                
                // 헤더 로드
                const headerHtml = await this.fetchTemplate(`/templates/header-${pageName}.html`);
                header.innerHTML = headerHtml;
                
                // 콘텐츠 로드
                const contentHtml = await this.fetchTemplate(`/templates/content-${pageName}.html`);
                content.innerHTML = contentHtml;
                
                // 페이지별 JavaScript 로드
                await this.loadPageScript(pageName);
            }
            
            async fetchTemplate(url) {
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        return await response.text();
                    }
                } catch (error) {
                    console.warn(`Failed to fetch template: ${url}`);
                }
                
                // 폴백 템플릿
                return this.getFallbackTemplate();
            }
            
            hideSkeletons() {
                const skeletons = document.querySelectorAll('.loading-skeleton');
                skeletons.forEach(skeleton => {
                    skeleton.style.display = 'none';
                });
            }
            
            showOfflineFallback() {
                const content = document.getElementById('appContent');
                content.innerHTML = `
                    <div class="offline-fallback">
                        <h2>오프라인 모드</h2>
                        <p>인터넷 연결을 확인한 후 다시 시도해주세요.</p>
                        <button onclick="location.reload()">다시 시도</button>
                    </div>
                `;
            }
        }
        
        // App Shell 초기화
        const appShell = new AppShell();
    </script>
    
    <!-- 나머지 JavaScript는 비동기 로드 -->
    <script>
        // 중요하지 않은 리소스들은 페이지 로드 후 로드
        window.addEventListener('load', () => {
            // 외부 라이브러리 로드
            const scripts = [
                '/js/core.js',
                '/js/app.js',
                '/libs/fontawesome.js'
            ];
            
            scripts.forEach(src => {
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                document.head.appendChild(script);
            });
        });
    </script>
</body>
</html>
```

### 3.2 App Shell CSS 최적화
```css
/* critical.css - 중요한 스타일만 포함 */
:root {
    --primary-color: #4facfe;
    --secondary-color: #00f2fe;
    --accent-color: #ff6b6b;
    --text-color: #2c3e50;
    --bg-color: #f8f9fa;
    --border-radius: 8px;
    --box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    --transition: all 0.3s ease;
}

/* App Shell 기본 스타일 */
.app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.app-header {
    background: white;
    box-shadow: var(--box-shadow);
    position: sticky;
    top: 0;
    z-index: 1000;
}

.app-content {
    flex: 1;
    padding: 1rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}

/* 로딩 스켈레톤 */
.loading-skeleton {
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: loading-shimmer 1.5s infinite;
}

@keyframes loading-shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

/* PWA 설치 프롬프트 */
.install-prompt {
    position: fixed;
    bottom: 20px;
    left: 20px;
    right: 20px;
    background: white;
    border-radius: var(--border-radius);
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    padding: 1rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    transform: translateY(100px);
    transition: var(--transition);
    z-index: 2000;
}

.install-prompt.show {
    transform: translateY(0);
}

.install-prompt button {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    transition: var(--transition);
}

.install-prompt button:hover {
    background: var(--secondary-color);
}

/* 오프라인 스타일 */
.offline-content {
    text-align: center;
    padding: 2rem;
    color: var(--text-color);
}

.offline-content h2 {
    margin-bottom: 1rem;
    color: var(--accent-color);
}

/* 반응형 디자인 */
@media (max-width: 768px) {
    .app-content {
        padding: 0.5rem;
    }
    
    .install-prompt {
        left: 10px;
        right: 10px;
        bottom: 10px;
    }
}
```

---

## 4. Web App Manifest

### 4.1 manifest.json
```json
{
    "name": "미야코지마 여행 가이드",
    "short_name": "미야코지마",
    "description": "김은태♥정유민의 미야코지마 여행을 위한 스마트 컴패니언",
    "start_url": "/main.html?utm_source=pwa",
    "display": "standalone",
    "orientation": "portrait-primary",
    "theme_color": "#4facfe",
    "background_color": "#ffffff",
    "scope": "/",
    
    "icons": [
        {
            "src": "/icons/icon-72x72.png",
            "sizes": "72x72",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "/icons/icon-96x96.png",
            "sizes": "96x96",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "/icons/icon-128x128.png",
            "sizes": "128x128",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "/icons/icon-144x144.png",
            "sizes": "144x144",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "/icons/icon-152x152.png",
            "sizes": "152x152",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "/icons/icon-192x192.png",
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "/icons/icon-384x384.png",
            "sizes": "384x384",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "/icons/icon-512x512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "any maskable"
        }
    ],
    
    "shortcuts": [
        {
            "name": "오늘 일정",
            "short_name": "일정",
            "description": "오늘의 여행 일정 확인",
            "url": "/itinerary.html?day=today",
            "icons": [
                {
                    "src": "/icons/shortcut-calendar.png",
                    "sizes": "96x96",
                    "type": "image/png"
                }
            ]
        },
        {
            "name": "예산 현황",
            "short_name": "예산",
            "description": "여행 예산 및 지출 현황",
            "url": "/budget.html",
            "icons": [
                {
                    "src": "/icons/shortcut-wallet.png",
                    "sizes": "96x96", 
                    "type": "image/png"
                }
            ]
        },
        {
            "name": "번역기",
            "short_name": "번역",
            "description": "한일 번역 및 음성 인식",
            "url": "/translate.html",
            "icons": [
                {
                    "src": "/icons/shortcut-translate.png",
                    "sizes": "96x96",
                    "type": "image/png"
                }
            ]
        },
        {
            "name": "응급상황",
            "short_name": "SOS",
            "description": "응급 연락처 및 대응 가이드",
            "url": "/emergency.html",
            "icons": [
                {
                    "src": "/icons/shortcut-emergency.png",
                    "sizes": "96x96",
                    "type": "image/png"
                }
            ]
        }
    ],
    
    "categories": ["travel", "lifestyle", "navigation"],
    "lang": "ko",
    "dir": "ltr",
    
    "prefer_related_applications": false,
    "related_applications": [],
    
    "protocol_handlers": [
        {
            "protocol": "web+miyakojima",
            "url": "/handle?type=%s"
        }
    ]
}
```

---

## 5. 오프라인 데이터 관리

### 5.1 IndexedDB 스키마
```javascript
// offline-db.js - 오프라인 데이터베이스 관리
class OfflineDatabase {
    constructor() {
        this.dbName = 'MiyakojimaDB';
        this.version = 3;
        this.db = null;
        this.stores = {
            BUDGET: 'budget',
            ITINERARY: 'itinerary',
            POI_DATA: 'poi_data',
            USER_PREFERENCES: 'user_preferences',
            OFFLINE_QUEUE: 'offline_queue',
            CACHE_METADATA: 'cache_metadata'
        };
    }
    
    async initialize() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this.createStores(db);
            };
        });
    }
    
    createStores(db) {
        // 예산 데이터 스토어
        if (!db.objectStoreNames.contains(this.stores.BUDGET)) {
            const budgetStore = db.createObjectStore(this.stores.BUDGET, {
                keyPath: 'id',
                autoIncrement: true
            });
            budgetStore.createIndex('date', 'date', { unique: false });
            budgetStore.createIndex('category', 'category', { unique: false });
        }
        
        // 일정 데이터 스토어
        if (!db.objectStoreNames.contains(this.stores.ITINERARY)) {
            const itineraryStore = db.createObjectStore(this.stores.ITINERARY, {
                keyPath: 'id',
                autoIncrement: true
            });
            itineraryStore.createIndex('date', 'date', { unique: false });
            itineraryStore.createIndex('status', 'status', { unique: false });
        }
        
        // POI 데이터 스토어
        if (!db.objectStoreNames.contains(this.stores.POI_DATA)) {
            const poiStore = db.createObjectStore(this.stores.POI_DATA, {
                keyPath: 'poi_id'
            });
            poiStore.createIndex('category', 'category', { unique: false });
            poiStore.createIndex('rating', 'rating', { unique: false });
        }
        
        // 사용자 설정 스토어
        if (!db.objectStoreNames.contains(this.stores.USER_PREFERENCES)) {
            const prefsStore = db.createObjectStore(this.stores.USER_PREFERENCES, {
                keyPath: 'key'
            });
        }
        
        // 오프라인 큐 스토어
        if (!db.objectStoreNames.contains(this.stores.OFFLINE_QUEUE)) {
            const queueStore = db.createObjectStore(this.stores.OFFLINE_QUEUE, {
                keyPath: 'id',
                autoIncrement: true
            });
            queueStore.createIndex('timestamp', 'timestamp', { unique: false });
            queueStore.createIndex('priority', 'priority', { unique: false });
        }
        
        // 캐시 메타데이터 스토어
        if (!db.objectStoreNames.contains(this.stores.CACHE_METADATA)) {
            const cacheStore = db.createObjectStore(this.stores.CACHE_METADATA, {
                keyPath: 'key'
            });
            cacheStore.createIndex('expiry', 'expiry', { unique: false });
        }
    }
    
    // 예산 데이터 관리
    async addExpense(expense) {
        const transaction = this.db.transaction([this.stores.BUDGET], 'readwrite');
        const store = transaction.objectStore(this.stores.BUDGET);
        
        const expenseData = {
            ...expense,
            id: Date.now(),
            timestamp: new Date().toISOString(),
            synced: false,
            offline: !navigator.onLine
        };
        
        const result = await store.add(expenseData);
        
        // 오프라인이면 동기화 큐에 추가
        if (!navigator.onLine) {
            await this.addToOfflineQueue({
                type: 'ADD_EXPENSE',
                data: expenseData,
                priority: 1
            });
        }
        
        return result;
    }
    
    async getExpenses(options = {}) {
        const transaction = this.db.transaction([this.stores.BUDGET], 'readonly');
        const store = transaction.objectStore(this.stores.BUDGET);
        
        if (options.date) {
            const index = store.index('date');
            return index.getAll(options.date);
        }
        
        if (options.category) {
            const index = store.index('category');
            return index.getAll(options.category);
        }
        
        return store.getAll();
    }
    
    // 일정 데이터 관리
    async updateItinerary(itineraryData) {
        const transaction = this.db.transaction([this.stores.ITINERARY], 'readwrite');
        const store = transaction.objectStore(this.stores.ITINERARY);
        
        const data = {
            ...itineraryData,
            lastModified: new Date().toISOString(),
            synced: false
        };
        
        const result = await store.put(data);
        
        if (!navigator.onLine) {
            await this.addToOfflineQueue({
                type: 'UPDATE_ITINERARY',
                data: data,
                priority: 2
            });
        }
        
        return result;
    }
    
    async getItinerary(date) {
        const transaction = this.db.transaction([this.stores.ITINERARY], 'readonly');
        const store = transaction.objectStore(this.stores.ITINERARY);
        const index = store.index('date');
        
        return index.get(date);
    }
    
    // POI 데이터 관리
    async cachePOIData(pois) {
        const transaction = this.db.transaction([this.stores.POI_DATA], 'readwrite');
        const store = transaction.objectStore(this.stores.POI_DATA);
        
        for (const poi of pois) {
            await store.put({
                ...poi,
                cachedAt: new Date().toISOString()
            });
        }
        
        return pois.length;
    }
    
    async searchPOIs(query, category = null) {
        const transaction = this.db.transaction([this.stores.POI_DATA], 'readonly');
        const store = transaction.objectStore(this.stores.POI_DATA);
        
        let request;
        if (category) {
            const index = store.index('category');
            request = index.getAll(category);
        } else {
            request = store.getAll();
        }
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const results = request.result.filter(poi => 
                    poi.name_ko.toLowerCase().includes(query.toLowerCase()) ||
                    poi.name_jp.toLowerCase().includes(query.toLowerCase()) ||
                    poi.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
                );
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    // 오프라인 큐 관리
    async addToOfflineQueue(item) {
        const transaction = this.db.transaction([this.stores.OFFLINE_QUEUE], 'readwrite');
        const store = transaction.objectStore(this.stores.OFFLINE_QUEUE);
        
        const queueItem = {
            ...item,
            id: Date.now(),
            timestamp: new Date().toISOString(),
            retryCount: 0,
            maxRetries: 3
        };
        
        return store.add(queueItem);
    }
    
    async getOfflineQueue() {
        const transaction = this.db.transaction([this.stores.OFFLINE_QUEUE], 'readonly');
        const store = transaction.objectStore(this.stores.OFFLINE_QUEUE);
        
        return store.getAll();
    }
    
    async clearOfflineQueue(items) {
        const transaction = this.db.transaction([this.stores.OFFLINE_QUEUE], 'readwrite');
        const store = transaction.objectStore(this.stores.OFFLINE_QUEUE);
        
        for (const item of items) {
            await store.delete(item.id);
        }
    }
    
    // 사용자 설정 관리
    async setUserPreference(key, value) {
        const transaction = this.db.transaction([this.stores.USER_PREFERENCES], 'readwrite');
        const store = transaction.objectStore(this.stores.USER_PREFERENCES);
        
        return store.put({ key, value, updatedAt: new Date().toISOString() });
    }
    
    async getUserPreference(key) {
        const transaction = this.db.transaction([this.stores.USER_PREFERENCES], 'readonly');
        const store = transaction.objectStore(this.stores.USER_PREFERENCES);
        
        const result = await store.get(key);
        return result ? result.value : null;
    }
    
    // 캐시 메타데이터 관리
    async setCacheMetadata(key, metadata) {
        const transaction = this.db.transaction([this.stores.CACHE_METADATA], 'readwrite');
        const store = transaction.objectStore(this.stores.CACHE_METADATA);
        
        return store.put({
            key,
            ...metadata,
            updatedAt: new Date().toISOString()
        });
    }
    
    async getCacheMetadata(key) {
        const transaction = this.db.transaction([this.stores.CACHE_METADATA], 'readonly');
        const store = transaction.objectStore(this.stores.CACHE_METADATA);
        
        return store.get(key);
    }
    
    // 데이터 정리 (오래된 캐시 삭제)
    async cleanupOldData() {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        // 오래된 캐시 메타데이터 삭제
        const transaction = this.db.transaction([this.stores.CACHE_METADATA], 'readwrite');
        const store = transaction.objectStore(this.stores.CACHE_METADATA);
        const index = store.index('expiry');
        
        const oldEntries = await index.getAll(IDBKeyRange.upperBound(thirtyDaysAgo));
        for (const entry of oldEntries) {
            await store.delete(entry.key);
        }
        
        console.log(`Cleaned up ${oldEntries.length} old cache entries`);
    }
}

// 전역 데이터베이스 인스턴스
let offlineDB;

async function initializeOfflineDB() {
    if (!offlineDB) {
        offlineDB = new OfflineDatabase();
        await offlineDB.initialize();
    }
    return offlineDB;
}
```

---

## 6. 푸시 알림 시스템

### 6.1 알림 관리 클래스
```javascript
// push-notifications.js - 푸시 알림 관리
class PushNotificationManager {
    constructor() {
        this.registration = null;
        this.subscription = null;
        this.vapidPublicKey = 'YOUR_VAPID_PUBLIC_KEY'; // 실제 VAPID 키로 교체
        this.notificationTypes = {
            ITINERARY_REMINDER: 'itinerary_reminder',
            BUDGET_ALERT: 'budget_alert',
            WEATHER_UPDATE: 'weather_update',
            EMERGENCY_ALERT: 'emergency_alert',
            TRANSPORT_DELAY: 'transport_delay'
        };
    }
    
    async initialize(swRegistration) {
        this.registration = swRegistration;
        
        if (!('Notification' in window)) {
            console.warn('This browser does not support notifications');
            return false;
        }
        
        // 알림 권한 요청
        const permission = await this.requestPermission();
        if (permission === 'granted') {
            await this.setupPushSubscription();
            this.scheduleLocalNotifications();
            return true;
        }
        
        return false;
    }
    
    async requestPermission() {
        let permission = Notification.permission;
        
        if (permission === 'default') {
            permission = await Notification.requestPermission();
        }
        
        return permission;
    }
    
    async setupPushSubscription() {
        try {
            const existingSubscription = await this.registration.pushManager.getSubscription();
            
            if (existingSubscription) {
                this.subscription = existingSubscription;
                console.log('Using existing push subscription');
                return;
            }
            
            // 새 구독 생성
            this.subscription = await this.registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
            });
            
            // 서버에 구독 정보 전송 (실제 환경에서는 서버 API 호출)
            console.log('New push subscription created:', this.subscription);
            
            // 로컬 스토리지에 저장
            localStorage.setItem('pushSubscription', JSON.stringify(this.subscription));
            
        } catch (error) {
            console.error('Failed to setup push subscription:', error);
        }
    }
    
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\\-/g, '+')
            .replace(/_/g, '/');
        
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        
        return outputArray;
    }
    
    // 로컬 알림 스케줄링
    scheduleLocalNotifications() {
        // 여행 시작 전 준비 알림 (9월 26일 오후 8시)
        this.scheduleNotification({
            title: '미야코지마 여행 준비',
            body: '내일 출발입니다! 체크리스트를 확인해보세요.',
            tag: 'travel_prep',
            scheduledTime: new Date('2025-09-26T20:00:00'),
            actions: [
                {
                    action: 'view_checklist',
                    title: '체크리스트 확인'
                }
            ]
        });
        
        // 일정 알림들 (매일 아침 8시)
        const travelDates = [
            '2025-09-27', '2025-09-28', '2025-09-29', '2025-09-30', '2025-10-01'
        ];
        
        travelDates.forEach((date, index) => {
            this.scheduleNotification({
                title: `미야코지마 여행 ${index + 1}일차`,
                body: '오늘의 일정을 확인해보세요!',
                tag: `day_${index + 1}_reminder`,
                scheduledTime: new Date(`${date}T08:00:00`),
                actions: [
                    {
                        action: 'view_itinerary',
                        title: '일정 보기'
                    },
                    {
                        action: 'check_weather',
                        title: '날씨 확인'
                    }
                ]
            });
        });
        
        // 예산 체크 알림 (매일 저녁 9시)
        travelDates.forEach((date, index) => {
            this.scheduleNotification({
                title: '오늘 지출 체크',
                body: '하루 지출을 정리해보세요.',
                tag: `budget_check_${index + 1}`,
                scheduledTime: new Date(`${date}T21:00:00`),
                actions: [
                    {
                        action: 'check_budget',
                        title: '예산 확인'
                    },
                    {
                        action: 'add_expense',
                        title: '지출 추가'
                    }
                ]
            });
        });
    }
    
    scheduleNotification(notificationData) {
        const now = new Date();
        const scheduledTime = new Date(notificationData.scheduledTime);
        const delay = scheduledTime.getTime() - now.getTime();
        
        if (delay > 0) {
            setTimeout(() => {
                this.showLocalNotification(notificationData);
            }, delay);
            
            console.log(`Notification "${notificationData.title}" scheduled for ${scheduledTime}`);
        }
    }
    
    showLocalNotification(data) {
        if (Notification.permission === 'granted') {
            const notification = new Notification(data.title, {
                body: data.body,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/badge-72x72.png',
                tag: data.tag,
                requireInteraction: data.urgent || false,
                actions: data.actions || [],
                data: data.data || {}
            });
            
            notification.onclick = (event) => {
                event.preventDefault();
                window.focus();
                
                // 알림에 따른 페이지 이동
                if (data.tag.includes('itinerary')) {
                    window.location.href = '/itinerary.html';
                } else if (data.tag.includes('budget')) {
                    window.location.href = '/budget.html';
                }
                
                notification.close();
            };
            
            // 자동 닫기 (응급상황 알림 제외)
            if (!data.urgent) {
                setTimeout(() => {
                    notification.close();
                }, 5000);
            }
        }
    }
    
    // 즉시 알림 표시
    showImmediateNotification(type, data) {
        const notificationTemplates = {
            [this.notificationTypes.BUDGET_ALERT]: {
                title: '예산 알림',
                body: `${data.category} 예산의 ${data.percentage}%를 사용했습니다`,
                icon: '/icons/budget-alert.png',
                urgent: data.percentage >= 100
            },
            [this.notificationTypes.WEATHER_UPDATE]: {
                title: '날씨 업데이트',
                body: `${data.condition} - ${data.temperature}°C`,
                icon: '/icons/weather.png'
            },
            [this.notificationTypes.EMERGENCY_ALERT]: {
                title: '⚠️ 응급 알림',
                body: data.message,
                icon: '/icons/emergency.png',
                urgent: true,
                actions: [
                    {
                        action: 'emergency',
                        title: '응급상황 페이지'
                    }
                ]
            },
            [this.notificationTypes.TRANSPORT_DELAY]: {
                title: '교통 정보',
                body: `${data.route}에 지연이 발생했습니다`,
                icon: '/icons/transport.png'
            }
        };
        
        const template = notificationTemplates[type];
        if (template) {
            this.showLocalNotification({
                ...template,
                tag: `${type}_${Date.now()}`,
                data: data
            });
        }
    }
    
    // 알림 설정 관리
    async updateNotificationSettings(settings) {
        await offlineDB.setUserPreference('notification_settings', settings);
        
        // 설정에 따라 알림 스케줄 조정
        if (!settings.dailyReminders) {
            // 일정 알림 비활성화
            this.clearScheduledNotifications('reminder');
        }
        
        if (!settings.budgetAlerts) {
            // 예산 알림 비활성화  
            this.clearScheduledNotifications('budget');
        }
    }
    
    clearScheduledNotifications(type) {
        // 예약된 알림 취소 (실제로는 태그 기반으로 관리)
        console.log(`Cleared ${type} notifications`);
    }
    
    // 구독 해제
    async unsubscribe() {
        if (this.subscription) {
            try {
                await this.subscription.unsubscribe();
                this.subscription = null;
                localStorage.removeItem('pushSubscription');
                console.log('Push subscription unsubscribed');
                return true;
            } catch (error) {
                console.error('Failed to unsubscribe:', error);
                return false;
            }
        }
        return true;
    }
}

// 전역 푸시 알림 관리자
let pushManager;

async function initializePushNotifications(swRegistration) {
    pushManager = new PushNotificationManager();
    return await pushManager.initialize(swRegistration);
}
```

---

## 7. 성능 최적화

### 7.1 리소스 최적화 전략
```javascript
// performance-optimizer.js - 성능 최적화 관리
class PerformanceOptimizer {
    constructor() {
        this.metrics = {
            loadTime: 0,
            fcp: 0, // First Contentful Paint
            lcp: 0, // Largest Contentful Paint
            fid: 0, // First Input Delay
            cls: 0  // Cumulative Layout Shift
        };
        
        this.observers = [];
        this.setupPerformanceMonitoring();
    }
    
    setupPerformanceMonitoring() {
        // Core Web Vitals 측정
        this.measureWebVitals();
        
        // 리소스 로딩 최적화
        this.optimizeResourceLoading();
        
        // 이미지 지연 로딩
        this.setupLazyLoading();
        
        // 메모리 사용량 모니터링
        this.monitorMemoryUsage();
    }
    
    measureWebVitals() {
        // FCP (First Contentful Paint) 측정
        if ('PerformanceObserver' in window) {
            const fcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach((entry) => {
                    if (entry.name === 'first-contentful-paint') {
                        this.metrics.fcp = entry.startTime;
                        console.log('FCP:', this.metrics.fcp);
                    }
                });
            });
            
            fcpObserver.observe({ entryTypes: ['paint'] });
            this.observers.push(fcpObserver);
            
            // LCP (Largest Contentful Paint) 측정
            const lcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const lastEntry = entries[entries.length - 1];
                this.metrics.lcp = lastEntry.startTime;
                console.log('LCP:', this.metrics.lcp);
            });
            
            lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
            this.observers.push(lcpObserver);
            
            // FID (First Input Delay) 측정
            const fidObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach((entry) => {
                    this.metrics.fid = entry.processingStart - entry.startTime;
                    console.log('FID:', this.metrics.fid);
                });
            });
            
            fidObserver.observe({ entryTypes: ['first-input'] });
            this.observers.push(fidObserver);
            
            // CLS (Cumulative Layout Shift) 측정
            let clsValue = 0;
            const clsObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach((entry) => {
                    if (!entry.hadRecentInput) {
                        clsValue += entry.value;
                    }
                });
                this.metrics.cls = clsValue;
                console.log('CLS:', this.metrics.cls);
            });
            
            clsObserver.observe({ entryTypes: ['layout-shift'] });
            this.observers.push(clsObserver);
        }
    }
    
    optimizeResourceLoading() {
        // 중요한 리소스 미리 로드
        const criticalResources = [
            { href: '/css/main.css', as: 'style' },
            { href: '/js/core.js', as: 'script' },
            { href: '/data/miyakojima_database.json', as: 'fetch' },
            { href: '/fonts/NotoSansKR-Regular.woff2', as: 'font', crossorigin: 'anonymous' }
        ];
        
        criticalResources.forEach(resource => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = resource.href;
            link.as = resource.as;
            if (resource.crossorigin) {
                link.crossOrigin = resource.crossorigin;
            }
            document.head.appendChild(link);
        });
        
        // 다음 페이지 미리 로드
        this.preloadNextPages();
    }
    
    preloadNextPages() {
        // 현재 페이지에 따라 다음에 방문할 가능성이 높은 페이지 미리 로드
        const currentPage = window.location.pathname;
        const preloadPages = {
            '/main.html': ['/itinerary.html', '/budget.html'],
            '/itinerary.html': ['/budget.html', '/translate.html'],
            '/budget.html': ['/itinerary.html', '/translate.html'],
            '/translate.html': ['/emergency.html'],
            '/emergency.html': ['/main.html']
        };
        
        const pagesToPreload = preloadPages[currentPage] || [];
        
        // Intersection Observer로 사용자가 스크롤할 때 미리 로드
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    pagesToPreload.forEach(page => {
                        const link = document.createElement('link');
                        link.rel = 'prefetch';
                        link.href = page;
                        document.head.appendChild(link);
                    });
                    observer.disconnect();
                }
            });
        });
        
        // 페이지 하단을 관찰
        const footer = document.querySelector('footer') || document.body.lastElementChild;
        if (footer) {
            observer.observe(footer);
        }
    }
    
    setupLazyLoading() {
        // 이미지 지연 로딩
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.remove('lazy');
                    observer.unobserve(img);
                }
            });
        });
        
        // 모든 lazy 이미지 관찰
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
        
        // 동적으로 추가되는 이미지를 위한 MutationObserver
        const mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        const lazyImages = node.querySelectorAll ? 
                            node.querySelectorAll('img[data-src]') : [];
                        lazyImages.forEach(img => imageObserver.observe(img));
                    }
                });
            });
        });
        
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    monitorMemoryUsage() {
        if ('memory' in performance) {
            setInterval(() => {
                const memory = performance.memory;
                const memoryUsage = {
                    used: Math.round(memory.usedJSHeapSize / 1048576), // MB
                    total: Math.round(memory.totalJSHeapSize / 1048576), // MB
                    limit: Math.round(memory.jsHeapSizeLimit / 1048576) // MB
                };
                
                console.log('Memory usage:', memoryUsage);
                
                // 메모리 사용량이 80% 이상이면 정리
                if (memoryUsage.used / memoryUsage.limit > 0.8) {
                    this.cleanupMemory();
                }
            }, 30000); // 30초마다 체크
        }
    }
    
    cleanupMemory() {
        // 사용하지 않는 캐시 정리
        this.cleanupUnusedCaches();
        
        // DOM 요소 정리
        this.cleanupDOMElements();
        
        // 이벤트 리스너 정리
        this.cleanupEventListeners();
        
        console.log('Memory cleanup completed');
    }
    
    async cleanupUnusedCaches() {
        const cacheNames = await caches.keys();
        const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];
        
        const unusedCaches = cacheNames.filter(name => 
            !currentCaches.includes(name)
        );
        
        return Promise.all(
            unusedCaches.map(cacheName => caches.delete(cacheName))
        );
    }
    
    cleanupDOMElements() {
        // 숨겨진 요소들 정리
        const hiddenElements = document.querySelectorAll('[style*="display: none"]');
        hiddenElements.forEach(element => {
            if (!element.dataset.persistent) {
                element.remove();
            }
        });
        
        // 빈 요소들 정리
        const emptyElements = document.querySelectorAll('div:empty, span:empty, p:empty');
        emptyElements.forEach(element => {
            if (!element.dataset.placeholder) {
                element.remove();
            }
        });
    }
    
    cleanupEventListeners() {
        // 중복 이벤트 리스너 제거 (실제로는 이벤트 위임 패턴 사용 권장)
        this.observers.forEach(observer => {
            if (observer.disconnect) {
                observer.disconnect();
            }
        });
        this.observers = [];
    }
    
    // 성능 보고서 생성
    generatePerformanceReport() {
        const navigation = performance.getEntriesByType('navigation')[0];
        const loadTime = navigation.loadEventEnd - navigation.loadEventStart;
        
        const report = {
            timestamp: new Date().toISOString(),
            metrics: {
                ...this.metrics,
                loadTime: loadTime
            },
            navigation: {
                dns: navigation.domainLookupEnd - navigation.domainLookupStart,
                connection: navigation.connectEnd - navigation.connectStart,
                request: navigation.responseStart - navigation.requestStart,
                response: navigation.responseEnd - navigation.responseStart,
                dom: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart
            },
            resources: performance.getEntriesByType('resource').length,
            memory: 'memory' in performance ? {
                used: Math.round(performance.memory.usedJSHeapSize / 1048576),
                total: Math.round(performance.memory.totalJSHeapSize / 1048576)
            } : null
        };
        
        return report;
    }
    
    // 성능 개선 제안
    getOptimizationSuggestions() {
        const suggestions = [];
        
        if (this.metrics.fcp > 2500) {
            suggestions.push('First Contentful Paint가 느립니다. 중요한 CSS를 인라인으로 포함하세요.');
        }
        
        if (this.metrics.lcp > 4000) {
            suggestions.push('Largest Contentful Paint가 느립니다. 이미지 최적화를 확인하세요.');
        }
        
        if (this.metrics.fid > 100) {
            suggestions.push('First Input Delay가 높습니다. JavaScript 실행을 최적화하세요.');
        }
        
        if (this.metrics.cls > 0.25) {
            suggestions.push('Cumulative Layout Shift가 높습니다. 레이아웃 안정성을 개선하세요.');
        }
        
        return suggestions;
    }
}

// 전역 성능 최적화 인스턴스
const performanceOptimizer = new PerformanceOptimizer();

// 페이지 언로드 시 성능 보고서 저장
window.addEventListener('beforeunload', () => {
    const report = performanceOptimizer.generatePerformanceReport();
    localStorage.setItem('lastPerformanceReport', JSON.stringify(report));
});
```

---

## 8. PWA 설치 프롬프트

### 8.1 설치 유도 시스템
```javascript
// pwa-installer.js - PWA 설치 관리
class PWAInstaller {
    constructor() {
        this.deferredPrompt = null;
        this.isInstalled = false;
        this.installButton = null;
        this.setupInstallPrompt();
        this.checkInstallStatus();
    }
    
    setupInstallPrompt() {
        // beforeinstallprompt 이벤트 처리
        window.addEventListener('beforeinstallprompt', (event) => {
            console.log('PWA install prompt triggered');
            
            // 브라우저의 기본 설치 프롬프트 방지
            event.preventDefault();
            
            // 이벤트 저장
            this.deferredPrompt = event;
            
            // 커스텀 설치 프롬프트 표시
            this.showInstallPrompt();
        });
        
        // 설치 완료 이벤트 처리
        window.addEventListener('appinstalled', (event) => {
            console.log('PWA was installed successfully');
            this.handleInstallSuccess();
        });
    }
    
    checkInstallStatus() {
        // 이미 설치되었는지 확인
        if (window.matchMedia('(display-mode: standalone)').matches) {
            this.isInstalled = true;
            console.log('PWA is running in standalone mode');
            return;
        }
        
        // iOS Safari 확인
        if (window.navigator.standalone === true) {
            this.isInstalled = true;
            console.log('PWA is running in iOS standalone mode');
            return;
        }
        
        // 설치 가능성 체크
        this.checkInstallability();
    }
    
    async checkInstallability() {
        if ('getInstalledRelatedApps' in navigator) {
            try {
                const relatedApps = await navigator.getInstalledRelatedApps();
                this.isInstalled = relatedApps.length > 0;
            } catch (error) {
                console.warn('Failed to check installed apps:', error);
            }
        }
        
        // 설치되지 않은 경우 프롬프트 준비
        if (!this.isInstalled) {
            this.prepareInstallUI();
        }
    }
    
    prepareInstallUI() {
        // 설치 프롬프트 HTML 생성
        const promptHTML = `
            <div id="installPrompt" class="install-prompt">
                <div class="install-content">
                    <div class="install-icon">
                        <img src="/icons/icon-72x72.png" alt="App Icon">
                    </div>
                    <div class="install-text">
                        <h3>미야코지마 여행 가이드</h3>
                        <p>홈 화면에 추가하여 더 빠르게 이용하세요!</p>
                    </div>
                    <div class="install-actions">
                        <button id="installBtn" class="install-btn">설치</button>
                        <button id="dismissBtn" class="dismiss-btn">나중에</button>
                    </div>
                </div>
            </div>
        `;
        
        // DOM에 추가
        document.body.insertAdjacentHTML('beforeend', promptHTML);
        
        // 이벤트 리스너 등록
        this.installButton = document.getElementById('installBtn');
        const dismissButton = document.getElementById('dismissBtn');
        
        this.installButton.addEventListener('click', () => {
            this.triggerInstall();
        });
        
        dismissButton.addEventListener('click', () => {
            this.dismissInstallPrompt();
        });
        
        // 설치 프롬프트 표시 조건 확인
        this.evaluateInstallPromptTiming();
    }
    
    evaluateInstallPromptTiming() {
        // 사용자 활동 기반으로 설치 프롬프트 타이밍 결정
        let pageViews = parseInt(localStorage.getItem('pageViews') || '0');
        let timeSpent = parseInt(localStorage.getItem('timeSpent') || '0');
        
        pageViews++;
        localStorage.setItem('pageViews', pageViews.toString());
        
        // 시간 추적 시작
        const startTime = Date.now();
        window.addEventListener('beforeunload', () => {
            const sessionTime = Date.now() - startTime;
            timeSpent += sessionTime;
            localStorage.setItem('timeSpent', timeSpent.toString());
        });
        
        // 프롬프트 표시 조건:
        // 1. 3번 이상 방문 OR 5분 이상 사용
        // 2. 하루에 한 번만 표시
        const lastPromptDate = localStorage.getItem('lastInstallPrompt');
        const today = new Date().toDateString();
        
        if (lastPromptDate !== today && (pageViews >= 3 || timeSpent > 300000)) {
            setTimeout(() => {
                this.showInstallPrompt();
            }, 5000); // 5초 후 표시
        }
    }
    
    showInstallPrompt() {
        const prompt = document.getElementById('installPrompt');
        if (prompt) {
            prompt.classList.add('show');
            
            // 프롬프트 표시 기록
            localStorage.setItem('lastInstallPrompt', new Date().toDateString());
            
            // 자동 숨김 (30초 후)
            setTimeout(() => {
                if (!this.isInstalled) {
                    this.dismissInstallPrompt();
                }
            }, 30000);
        }
    }
    
    async triggerInstall() {
        if (!this.deferredPrompt) {
            console.log('Install prompt not available');
            this.showManualInstallGuide();
            return;
        }
        
        // 설치 프롬프트 표시
        this.deferredPrompt.prompt();
        
        // 사용자 선택 결과 처리
        const choiceResult = await this.deferredPrompt.userChoice;
        
        console.log(`User ${choiceResult.outcome} the install prompt`);
        
        if (choiceResult.outcome === 'accepted') {
            console.log('User accepted the install prompt');
        } else {
            console.log('User dismissed the install prompt');
            this.dismissInstallPrompt();
        }
        
        // 프롬프트 초기화
        this.deferredPrompt = null;
    }
    
    showManualInstallGuide() {
        const userAgent = navigator.userAgent.toLowerCase();
        let instructions = '';
        
        if (userAgent.includes('iphone') || userAgent.includes('ipad')) {
            instructions = `
                <div class="install-guide ios">
                    <h3>iOS에서 설치하기</h3>
                    <ol>
                        <li>Safari 하단의 공유 버튼 <i class="fas fa-share"></i>을 탭하세요</li>
                        <li>"홈 화면에 추가" 옵션을 선택하세요</li>
                        <li>"추가" 버튼을 탭하여 완료하세요</li>
                    </ol>
                </div>
            `;
        } else if (userAgent.includes('android')) {
            instructions = `
                <div class="install-guide android">
                    <h3>Android에서 설치하기</h3>
                    <ol>
                        <li>브라우저 메뉴 <i class="fas fa-ellipsis-v"></i>를 탭하세요</li>
                        <li>"홈 화면에 추가" 또는 "앱 설치"를 선택하세요</li>
                        <li>"설치" 버튼을 탭하여 완료하세요</li>
                    </ol>
                </div>
            `;
        } else {
            instructions = `
                <div class="install-guide desktop">
                    <h3>데스크톱에서 설치하기</h3>
                    <ol>
                        <li>주소창 오른쪽의 설치 아이콘 <i class="fas fa-download"></i>을 클릭하세요</li>
                        <li>"설치" 버튼을 클릭하여 완료하세요</li>
                    </ol>
                </div>
            `;
        }
        
        const guideModal = `
            <div id="installGuide" class="install-guide-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>앱 설치 방법</h2>
                        <button onclick="document.getElementById('installGuide').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        ${instructions}
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', guideModal);
    }
    
    dismissInstallPrompt() {
        const prompt = document.getElementById('installPrompt');
        if (prompt) {
            prompt.classList.remove('show');
            setTimeout(() => {
                prompt.remove();
            }, 300);
        }
    }
    
    handleInstallSuccess() {
        this.isInstalled = true;
        
        // 설치 프롬프트 제거
        this.dismissInstallPrompt();
        
        // 설치 감사 메시지 표시
        const thankYouMessage = `
            <div id="installThankYou" class="install-thank-you">
                <div class="thank-you-content">
                    <i class="fas fa-check-circle"></i>
                    <h3>설치 완료!</h3>
                    <p>이제 홈 화면에서 바로 접속할 수 있습니다.</p>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', thankYouMessage);
        
        // 3초 후 메시지 제거
        setTimeout(() => {
            const thankYou = document.getElementById('installThankYou');
            if (thankYou) {
                thankYou.remove();
            }
        }, 3000);
        
        // 설치 이벤트 추적
        localStorage.setItem('pwaInstalled', 'true');
        localStorage.setItem('installDate', new Date().toISOString());
    }
    
    // 설치 통계 수집
    getInstallStats() {
        return {
            isInstalled: this.isInstalled,
            installDate: localStorage.getItem('installDate'),
            pageViews: parseInt(localStorage.getItem('pageViews') || '0'),
            timeSpent: parseInt(localStorage.getItem('timeSpent') || '0'),
            lastPromptDate: localStorage.getItem('lastInstallPrompt')
        };
    }
}

// PWA 설치 관리자 초기화
const pwaInstaller = new PWAInstaller();

// iOS 사용자를 위한 추가 안내
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    window.addEventListener('load', () => {
        if (!window.navigator.standalone) {
            setTimeout(() => {
                pwaInstaller.showManualInstallGuide();
            }, 10000); // 10초 후 안내 표시
        }
    });
}
```

---

**🎯 PWA 및 서비스 워커 설계 완료**

이 설계서는 미야코지마 여행 웹 플랫폼의 완전한 PWA 기능과 오프라인 대응 전략을 포함합니다:

✅ **핵심 PWA 기능**
- App Shell Architecture로 즉시 로딩
- Service Worker 기반 캐싱 및 오프라인 지원
- Web App Manifest로 네이티브 앱 경험
- Push Notifications로 여행 알림
- Background Sync로 자동 데이터 동기화

✅ **오프라인 우선 설계**
- IndexedDB 기반 로컬 데이터 저장
- 캐시 전략별 최적화 (Cache First, Network First, Stale While Revalidate)
- 오프라인 큐 시스템으로 연결 복구 시 자동 동기화

✅ **성능 최적화**
- Core Web Vitals 측정 및 최적화
- 리소스 지연 로딩 및 미리 로드
- 메모리 관리 및 자동 정리

✅ **사용자 경험**
- 스마트 설치 프롬프트
- 오프라인 상태 표시
- 로딩 스켈레톤 및 부드러운 전환

이제 GitHub Pages에서 완전한 오프라인 기능을 갖춘 PWA로 동작할 수 있습니다.