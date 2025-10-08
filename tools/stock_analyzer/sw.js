/**
 * Service Worker for 100xFenok Stock Analyzer PWA
 */

const CACHE_NAME = 'stock-analyzer-v1.0.0';
const STATIC_CACHE = 'static-v1.0.0';
const DATA_CACHE = 'data-v1.0.0';

// 캐시할 정적 파일들
const STATIC_FILES = [
  '/stock_analyzer.html',
  '/stock_analyzer_enhanced.js',
  '/modules/DataExpansionManager.js',
  '/modules/ColumnManager.js',
  '/modules/CardViewManager.js',
  '/modules/AdvancedFilterManager.js',
  '/modules/ScrollManager.js',
  '/modules/ChartManager.js',
  '/modules/AdvancedChartManager.js',
  '/modules/ResponsiveManager.js',
  '/modules/FilterManager.js',
  '/modules/PerformanceManager.js',
  '/modules/LoadingManager.js',
  '/modules/TestManager.js',
  '/modules/AdvancedSearchManager.js',
  '/modules/PortfolioManager.js',
  '/modules/DashboardManager.js',
  '/data/enhanced_summary_data.json',
  '/data/enhanced_column_config.json',
  '/manifest.json'
];

// CDN 리소스
const CDN_RESOURCES = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js'
];

/**
 * Service Worker 설치
 */
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker 설치 중...');
  
  event.waitUntil(
    Promise.all([
      // 정적 파일 캐시
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('📁 정적 파일 캐시 중...');
        return cache.addAll(STATIC_FILES.map(url => new Request(url, { cache: 'reload' })));
      }),
      
      // CDN 리소스 캐시
      caches.open(CACHE_NAME).then((cache) => {
        console.log('🌐 CDN 리소스 캐시 중...');
        return cache.addAll(CDN_RESOURCES);
      })
    ]).then(() => {
      console.log('✅ Service Worker 설치 완료');
      self.skipWaiting();
    }).catch((error) => {
      console.error('❌ Service Worker 설치 실패:', error);
    })
  );
});

/**
 * Service Worker 활성화
 */
self.addEventListener('activate', (event) => {
  console.log('🔄 Service Worker 활성화 중...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE && cacheName !== DATA_CACHE) {
            console.log('🗑️ 오래된 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker 활성화 완료');
      return self.clients.claim();
    })
  );
});

/**
 * 네트워크 요청 가로채기
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // 데이터 API 요청 처리
  if (isDataRequest(request)) {
    event.respondWith(handleDataRequest(request));
    return;
  }
  
  // 정적 파일 요청 처리
  if (isStaticRequest(request)) {
    event.respondWith(handleStaticRequest(request));
    return;
  }
  
  // CDN 리소스 요청 처리
  if (isCDNRequest(request)) {
    event.respondWith(handleCDNRequest(request));
    return;
  }
  
  // 기본 네트워크 요청
  event.respondWith(
    fetch(request).catch(() => {
      // 오프라인 시 기본 페이지 반환
      if (request.destination === 'document') {
        return caches.match('/stock_analyzer.html');
      }
    })
  );
});

/**
 * 데이터 요청 확인
 */
function isDataRequest(request) {
  return request.url.includes('/data/') || 
         request.url.includes('.json') ||
         request.url.includes('api');
}

/**
 * 정적 파일 요청 확인
 */
function isStaticRequest(request) {
  return STATIC_FILES.some(file => request.url.includes(file)) ||
         request.url.includes('.js') ||
         request.url.includes('.html') ||
         request.url.includes('.css');
}

/**
 * CDN 요청 확인
 */
function isCDNRequest(request) {
  return CDN_RESOURCES.some(cdn => request.url.includes(cdn)) ||
         request.url.includes('cdn.') ||
         request.url.includes('cdnjs.');
}

/**
 * 데이터 요청 처리 (Cache First with Network Fallback)
 */
async function handleDataRequest(request) {
  try {
    const cache = await caches.open(DATA_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('📊 캐시에서 데이터 반환:', request.url);
      
      // 백그라운드에서 데이터 업데이트
      fetch(request).then(response => {
        if (response.ok) {
          cache.put(request, response.clone());
          console.log('🔄 백그라운드 데이터 업데이트:', request.url);
        }
      }).catch(() => {
        // 네트워크 오류 무시
      });
      
      return cachedResponse;
    }
    
    // 캐시에 없으면 네트워크에서 가져오기
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      console.log('🌐 네트워크에서 데이터 가져옴:', request.url);
    }
    
    return networkResponse;
    
  } catch (error) {
    console.error('❌ 데이터 요청 처리 실패:', error);
    
    // 오프라인 시 기본 응답
    return new Response(JSON.stringify({
      error: 'Offline',
      message: '오프라인 상태입니다. 네트워크 연결을 확인해주세요.'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 정적 파일 요청 처리 (Cache First)
 */
async function handleStaticRequest(request) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('📁 캐시에서 정적 파일 반환:', request.url);
      return cachedResponse;
    }
    
    // 캐시에 없으면 네트워크에서 가져오기
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      console.log('🌐 네트워크에서 정적 파일 가져옴:', request.url);
    }
    
    return networkResponse;
    
  } catch (error) {
    console.error('❌ 정적 파일 요청 처리 실패:', error);
    throw error;
  }
}

/**
 * CDN 요청 처리 (Network First with Cache Fallback)
 */
async function handleCDNRequest(request) {
  try {
    // 네트워크 우선 시도
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      console.log('🌐 CDN 리소스 네트워크에서 가져옴:', request.url);
      return networkResponse;
    }
    
    throw new Error('Network response not ok');
    
  } catch (error) {
    // 네트워크 실패 시 캐시에서 가져오기
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('📦 캐시에서 CDN 리소스 반환:', request.url);
      return cachedResponse;
    }
    
    console.error('❌ CDN 요청 처리 실패:', error);
    throw error;
  }
}

/**
 * 백그라운드 동기화
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('🔄 백그라운드 동기화 시작');
    event.waitUntil(doBackgroundSync());
  }
});

/**
 * 백그라운드 동기화 실행
 */
async function doBackgroundSync() {
  try {
    // 데이터 업데이트 확인
    const dataResponse = await fetch('/data/enhanced_summary_data.json');
    if (dataResponse.ok) {
      const cache = await caches.open(DATA_CACHE);
      await cache.put('/data/enhanced_summary_data.json', dataResponse);
      console.log('✅ 백그라운드 데이터 동기화 완료');
    }
  } catch (error) {
    console.error('❌ 백그라운드 동기화 실패:', error);
  }
}

/**
 * 푸시 알림 처리
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || '새로운 알림이 있습니다.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: data.data || {},
    actions: [
      {
        action: 'open',
        title: '열기',
        icon: '/icons/icon-72x72.png'
      },
      {
        action: 'close',
        title: '닫기'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || '100xFenok Stock Analyzer', options)
  );
});

/**
 * 알림 클릭 처리
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow('/stock_analyzer.html')
    );
  }
});

/**
 * 메시지 처리 (앱과의 통신)
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});

console.log('🚀 Service Worker 로드 완료 - PWA 지원');