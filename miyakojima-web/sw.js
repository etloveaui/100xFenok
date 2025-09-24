const CACHE_NAME = 'miyakojima-travel-v6';
const STATIC_CACHE = 'static-v6';
const DYNAMIC_CACHE = 'dynamic-v6';
const DATA_CACHE = 'data-v6';

// Files to cache immediately - 상대 경로 사용
const STATIC_FILES = [
    './',
    './index.html',
    './css/main-optimized.css',
    './css/mobile.css',
    './js/main.js',
    './js/config.js',
    './js/utils.js',
    './js/api.js',
    './js/budget.js',
    './js/location.js',
    './js/poi.js',
    './js/itinerary.js',
    './data/miyakojima_pois.json'
];

// API endpoints that should be cached
const API_ENDPOINTS = [
    'https://api.exchangerate-api.com',
    'https://api.openweathermap.org',
    'https://api.opencagedata.com'
];

// Install event - cache static resources
self.addEventListener('install', event => {
    console.log('Service Worker installing');

    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE).then(async cache => {
                console.log('Caching static files');
                // 개별적으로 캐싱하여 실패한 파일 건너뛰기
                const promises = STATIC_FILES.map(async url => {
                    try {
                        const response = await fetch(url);
                        if (response.ok) {
                            await cache.put(url, response);
                            console.log('Cached:', url);
                        } else {
                            console.warn('Failed to cache:', url, response.status);
                        }
                    } catch (error) {
                        console.warn('Error caching:', url, error.message);
                    }
                });
                await Promise.all(promises);
                return Promise.resolve();
            }),
            caches.open(DATA_CACHE).then(cache => {
                console.log('Data cache ready');
                return Promise.resolve();
            })
        ]).then(() => {
            console.log('Service Worker installed successfully');
            // Skip waiting to activate immediately
            return self.skipWaiting();
        }).catch(error => {
            console.error('Service Worker install failed:', error);
        })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker activating');
    
    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && 
                            cacheName !== DYNAMIC_CACHE && 
                            cacheName !== DATA_CACHE) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // Take control of all pages
            self.clients.claim()
        ]).then(() => {
            console.log('Service Worker activated successfully');
        })
    );
});

// Fetch event - handle all network requests
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Handle different types of requests
    if (isStaticResource(request)) {
        event.respondWith(handleStaticResource(request));
    } else if (isAPIRequest(request)) {
        event.respondWith(handleAPIRequest(request));
    } else if (isDataRequest(request)) {
        event.respondWith(handleDataRequest(request));
    } else {
        event.respondWith(handleDynamicRequest(request));
    }
});

// Check if request is for static resources
function isStaticResource(request) {
    const url = new URL(request.url);
    return STATIC_FILES.includes(url.pathname) || 
           request.destination === 'style' ||
           request.destination === 'script' ||
           request.destination === 'font' ||
           url.pathname.endsWith('.css') ||
           url.pathname.endsWith('.js') ||
           url.pathname.endsWith('.json');
}

// Check if request is to external APIs
function isAPIRequest(request) {
    const url = new URL(request.url);
    return API_ENDPOINTS.some(endpoint => url.href.startsWith(endpoint));
}

// Check if request is for local data
function isDataRequest(request) {
    const url = new URL(request.url);
    return url.pathname.startsWith('/data/') || url.pathname.includes('miyakojima');
}

// Handle static resources with cache-first strategy
async function handleStaticResource(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // If not in cache, fetch and cache
        const response = await fetch(request);
        if (response.status === 200 && request.method === 'GET') {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.error('Static resource fetch failed:', error);
        
        // Return offline fallback for HTML pages
        if (request.destination === 'document') {
            return caches.match('/index.html');
        }
        
        // Return empty response for other resources
        return new Response('', { status: 408, statusText: 'Offline' });
    }
}

// Handle API requests with network-first, cache fallback
async function handleAPIRequest(request) {
    try {
        // Try network first
        const response = await fetch(request);
        
        if (response.status === 200 && request.method === 'GET') {
            // Cache successful responses
            const cache = await caches.open(DATA_CACHE);
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        console.log('API request failed, trying cache:', request.url);
        
        // Fall back to cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return offline response
        return new Response(JSON.stringify({
            error: 'offline',
            message: '인터넷 연결을 확인해주세요',
            timestamp: Date.now()
        }), {
            status: 408,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle data requests with cache-first strategy
async function handleDataRequest(request) {
    try {
        // Check cache first
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            // Return cached version and update in background
            updateDataInBackground(request);
            return cachedResponse;
        }
        
        // If not in cache, fetch and cache
        const response = await fetch(request);
        if (response.status === 200 && request.method === 'GET') {
            const cache = await caches.open(DATA_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.error('Data request failed:', error);
        
        // Try to return cached version
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return empty data response
        return new Response(JSON.stringify({ data: [], offline: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle dynamic requests
async function handleDynamicRequest(request) {
    try {
        const response = await fetch(request);

        // Only cache GET requests (POST requests can't be cached)
        if (response.status === 200 && request.method === 'GET') {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        // Try cache first
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return offline page
        return caches.match('/index.html');
    }
}

// Update data in background
async function updateDataInBackground(request) {
    try {
        const response = await fetch(request);
        if (response.status === 200 && request.method === 'GET') {
            const cache = await caches.open(DATA_CACHE);
            await cache.put(request, response);
        }
    } catch (error) {
        console.log('Background update failed:', error);
    }
}

// Handle background sync
self.addEventListener('sync', event => {
    console.log('Background sync triggered:', event.tag);
    
    if (event.tag === 'budget-sync') {
        event.waitUntil(syncBudgetData());
    } else if (event.tag === 'itinerary-sync') {
        event.waitUntil(syncItineraryData());
    } else if (event.tag === 'poi-sync') {
        event.waitUntil(syncPOIData());
    }
});

// Sync budget data when online
async function syncBudgetData() {
    try {
        const budgetData = await getStoredData('miyakojima_budget');
        if (budgetData && budgetData.pendingExpenses) {
            // Send pending expenses to backend
            const response = await fetch('/api/sync-budget', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(budgetData)
            });
            
            if (response.ok) {
                // Clear pending expenses
                budgetData.pendingExpenses = [];
                await storeData('miyakojima_budget', budgetData);
                console.log('Budget data synced successfully');
            }
        }
    } catch (error) {
        console.error('Budget sync failed:', error);
    }
}

// Sync itinerary data when online
async function syncItineraryData() {
    try {
        const itineraryData = await getStoredData('miyakojima_itinerary');
        if (itineraryData) {
            const response = await fetch('/api/sync-itinerary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(itineraryData)
            });
            
            if (response.ok) {
                console.log('Itinerary data synced successfully');
            }
        }
    } catch (error) {
        console.error('Itinerary sync failed:', error);
    }
}

// Sync POI data when online
async function syncPOIData() {
    try {
        const poiData = await getStoredData('miyakojima_poi_user_data');
        if (poiData) {
            const response = await fetch('/api/sync-poi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(poiData)
            });
            
            if (response.ok) {
                console.log('POI data synced successfully');
            }
        }
    } catch (error) {
        console.error('POI sync failed:', error);
    }
}

// Helper functions for IndexedDB storage
async function getStoredData(key) {
    return new Promise((resolve, reject) => {
        const data = localStorage.getItem(key);
        if (data) {
            try {
                resolve(JSON.parse(data));
            } catch (error) {
                reject(error);
            }
        } else {
            resolve(null);
        }
    });
}

async function storeData(key, data) {
    return new Promise((resolve) => {
        localStorage.setItem(key, JSON.stringify(data));
        resolve();
    });
}

// Handle push notifications (for future use)
self.addEventListener('push', event => {
    if (!event.data) return;
    
    const data = event.data.json();
    const options = {
        body: data.body,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        vibrate: [200, 100, 200],
        data: data.data || {},
        actions: data.actions || []
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    const urlToOpen = event.notification.data.url || '/';
    
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            // Check if there's already a window/tab open with the target URL
            for (let client of clients) {
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            
            // If no window/tab is open, open a new one
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        })
    );
});

// Handle message from main app
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
});

// Cleanup old data periodically
setInterval(() => {
    cleanupOldData();
}, 24 * 60 * 60 * 1000); // Daily cleanup

async function cleanupOldData() {
    try {
        const cache = await caches.open(DATA_CACHE);
        const requests = await cache.keys();
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        
        for (let request of requests) {
            const response = await cache.match(request);
            if (response) {
                const dateHeader = response.headers.get('date');
                if (dateHeader) {
                    const responseDate = new Date(dateHeader).getTime();
                    if (now - responseDate > oneWeek) {
                        await cache.delete(request);
                        console.log('Cleaned up old cached data:', request.url);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Data cleanup failed:', error);
    }
}