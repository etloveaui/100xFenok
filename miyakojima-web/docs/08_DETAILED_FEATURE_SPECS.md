# 상세 기능 명세서 - 무료 구현 전략
# Detailed Feature Specifications - Free Implementation Strategy

**문서 목적**: 100% 무료 서비스만을 활용한 핵심 기능 구현 방안  
**작성일**: 2025년 9월 7일  
**대상**: 2025년 9월 27일 ~ 10월 1일 (4박 5일) 미야코지마 여행  

---

## 🎯 핵심 기능 3종

### 1. 실시간 예산 추적 시스템 💰

#### 1.1 기능 개요
- **문제**: ChatGPT는 실시간 데이터 저장 불가, 자동 환율 계산 불가
- **해결**: Google Sheets 데이터베이스 + 실시간 환율 API + OCR 영수증 인식
- **목표**: 일일 예산 2만엔 기준 실시간 알림 및 카테고리별 지출 추적

#### 1.2 구현 세부사항

**Backend (Google Apps Script)**
```javascript
// budget-tracker.gs
function addExpense(data) {
    const sheet = SpreadsheetApp.openById('BUDGET_SHEET_ID');
    const budgetSheet = sheet.getSheetByName('Daily_Budget');
    
    // 환율 자동 계산 (exchangerate-api.com)
    const exchangeRate = getExchangeRate('JPY', 'KRW');
    
    budgetSheet.appendRow([
        new Date(),
        data.amount_jpy,
        data.amount_jpy * exchangeRate, // KRW 환산
        data.category,
        data.description,
        data.location,
        data.photo_url || ''
    ]);
    
    // 일일 예산 초과 체크
    const dailySpent = getDailySpent();
    if (dailySpent > 20000) {
        return { alert: true, message: '일일 예산 초과! 현재: ' + dailySpent + '엔' };
    }
    
    return { success: true, dailySpent: dailySpent };
}

function getExchangeRate(from, to) {
    const response = UrlFetchApp.fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
    const data = JSON.parse(response.getContentText());
    return data.rates[to];
}
```

**Frontend (Vanilla JavaScript)**
```javascript
// budget.js
class BudgetTracker {
    constructor() {
        this.DAILY_BUDGET = 20000; // 2만엔
        this.categories = ['식비', '교통', '쇼핑', '액티비티', '기타'];
        this.gasUrl = 'GAS_DEPLOY_URL';
    }
    
    async addExpense(amount, category, description) {
        const data = {
            amount_jpy: amount,
            category: category,
            description: description,
            location: await this.getCurrentLocation()
        };
        
        const response = await fetch(this.gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add_expense', data: data })
        });
        
        const result = await response.json();
        this.updateUI(result);
        
        if (result.alert) {
            this.showBudgetAlert(result.message);
        }
    }
    
    // OCR 영수증 인식
    async scanReceipt(imageData) {
        const extractedText = await this.extractTextFromImage(imageData);
        const amount = this.parseAmountFromText(extractedText);
        return amount;
    }
    
    extractTextFromImage(imageData) {
        // Tesseract.js 사용 (브라우저 내장 OCR)
        return Tesseract.recognize(imageData, 'jpn+eng');
    }
}
```

#### 1.3 데이터 구조 (Google Sheets)
```
Sheet: Daily_Budget
Columns: [날짜, 금액(JPY), 금액(KRW), 카테고리, 설명, 위치, 영수증사진]
```

---

### 2. 스마트 일정 관리 시스템 📅

#### 2.1 기능 개요
- **문제**: ChatGPT는 실시간 GPS 추적 불가, 동적 일정 조정 불가
- **해결**: 브라우저 GPS API + Google Maps 무료 할당량 + 실시간 이동시간 계산
- **목표**: 현재 위치 → 다음 목적지 자동 계산 + 혼잡도 회피 + 서프라이즈 장소 추천

#### 2.2 구현 세부사항

**GPS 위치 추적 (Browser API)**
```javascript
// itinerary.js
class SmartItinerary {
    constructor() {
        this.currentLocation = null;
        this.destinations = [];
        this.avoidCrowded = true;
    }
    
    async initializeGPS() {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                position => {
                    this.currentLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    this.updateNearbyRecommendations();
                },
                error => console.error('GPS 오류:', error),
                { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
            );
        }
    }
    
    // 실시간 이동시간 계산
    async calculateTravelTime(destination) {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?` +
            `origins=${this.currentLocation.lat},${this.currentLocation.lng}&` +
            `destinations=${destination.lat},${destination.lng}&` +
            `key=FREE_GOOGLE_MAPS_KEY&mode=driving`;
            
        const response = await fetch(url);
        const data = await response.json();
        return data.rows[0].elements[0].duration.value; // 초 단위
    }
    
    // girlfriend_surprises 태그 기반 추천
    async findSurpriseSpots() {
        const pois = await this.loadPOIData();
        const surpriseSpots = pois.filter(poi => 
            poi.tags.includes('girlfriend_surprises') &&
            this.calculateDistance(this.currentLocation, poi.coordinates) < 5000 // 5km 이내
        );
        
        return surpriseSpots.sort((a, b) => a.distance - b.distance).slice(0, 3);
    }
}
```

**Google Sheets 일정 동기화**
```javascript
// itinerary-sync.gs
function updateItinerary(scheduleData) {
    const sheet = SpreadsheetApp.openById('ITINERARY_SHEET_ID');
    const scheduleSheet = sheet.getSheetByName('Daily_Schedule');
    
    scheduleData.forEach(item => {
        scheduleSheet.appendRow([
            item.date,
            item.time,
            item.location,
            item.activity,
            item.estimated_duration,
            item.travel_time,
            item.status // planned/in_progress/completed
        ]);
    });
    
    return { success: true };
}
```

#### 2.3 혼잡도 회피 알고리즘
```javascript
async checkCrowdLevel(locationId) {
    // 시간대별 혼잡도 데이터 (175개 POI 기준)
    const crowdData = await this.loadCrowdData();
    const currentHour = new Date().getHours();
    
    const location = crowdData.find(loc => loc.id === locationId);
    const crowdLevel = location.hourly_crowd[currentHour];
    
    return crowdLevel > 7 ? 'crowded' : 'available';
}
```

---

### 3. POI 개인화 추천 시스템 🎯

#### 3.1 기능 개요
- **문제**: ChatGPT는 실시간 위치 필터링 불가, 개인 취향 학습 불가
- **해결**: 175개 POI 데이터 + 브라우저 localStorage + 실시간 거리 계산
- **목표**: 현재 위치 기준 맞춤 추천 + "luxury_relaxed" 스타일 + 방문 기록 관리

#### 3.2 구현 세부사항

**POI 필터링 시스템**
```javascript
// poi-recommender.js
class POIRecommender {
    constructor() {
        this.userProfile = {
            travel_style: 'luxury_relaxed',
            preferences: ['girlfriend_surprises', 'photo_spots'],
            avoid: ['crowded_places', 'long_queue'],
            visited: []
        };
        this.pois = []; // 175개 POI 데이터
    }
    
    async loadPOIData() {
        const response = await fetch('./data/miyakojima_pois.json');
        this.pois = await response.json();
    }
    
    // 실시간 위치 기반 추천
    async getRecommendations(currentLocation, maxDistance = 2000) {
        const nearbyPOIs = this.pois.filter(poi => {
            const distance = this.calculateDistance(currentLocation, poi.coordinates);
            return distance <= maxDistance && !this.userProfile.visited.includes(poi.id);
        });
        
        // 개인화 점수 계산
        const scoredPOIs = nearbyPOIs.map(poi => ({
            ...poi,
            score: this.calculatePersonalizationScore(poi),
            distance: this.calculateDistance(currentLocation, poi.coordinates)
        }));
        
        return scoredPOIs
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }
    
    calculatePersonalizationScore(poi) {
        let score = 0;
        
        // 선호도 가산점
        this.userProfile.preferences.forEach(pref => {
            if (poi.tags.includes(pref)) score += 3;
        });
        
        // 여행 스타일 매칭
        if (poi.category === 'luxury' && this.userProfile.travel_style === 'luxury_relaxed') {
            score += 2;
        }
        
        // 회피 요소 감점
        this.userProfile.avoid.forEach(avoid => {
            if (poi.tags.includes(avoid)) score -= 5;
        });
        
        // 평점 반영
        score += poi.rating * 0.5;
        
        return score;
    }
    
    // 방문 완료 처리
    async markAsVisited(poiId, rating, review) {
        this.userProfile.visited.push(poiId);
        localStorage.setItem('userProfile', JSON.stringify(this.userProfile));
        
        // Google Sheets에 리뷰 저장
        await this.saveReview(poiId, rating, review);
    }
}
```

**POI 데이터 구조 (miyakojima_pois.json)**
```json
[
  {
    "id": "beach_001",
    "name": "요나하 마에하마 비치",
    "category": "nature_views",
    "coordinates": { "lat": 24.73472, "lng": 125.26278 },
    "tags": ["photo_spots", "romantic", "girlfriend_surprises"],
    "rating": 4.8,
    "price_level": "free",
    "crowd_level": {
      "morning": 3,
      "afternoon": 8,
      "evening": 5
    },
    "best_visit_time": "sunset",
    "amenities": ["parking", "restroom", "shower"]
  }
]
```

---

## 🛠️ 무료 서비스 연동 가이드

### Google Sheets API 설정
1. Google Cloud Console → 새 프로젝트 생성
2. Google Sheets API 활성화
3. 서비스 계정 생성 → JSON 키 다운로드
4. Google Sheets 공유 설정 (서비스 계정 이메일 추가)

### 외부 API 무료 할당량
- **exchangerate-api.com**: 1,500 requests/month
- **OpenWeatherMap**: 1,000 requests/day  
- **OpenCage Geocoding**: 2,500 requests/day
- **Google Maps**: $200 월 크레딧 (약 28,500회 요청)

---

## 📱 PWA 오프라인 기능

### Service Worker 캐싱 전략
```javascript
// sw.js
const CACHE_NAME = 'miyakojima-v1';
const CACHE_URLS = [
    '/',
    '/css/main.css',
    '/js/app.js',
    '/data/miyakojima_pois.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CACHE_URLS))
    );
});

// 오프라인 시 캐시된 데이터 제공
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});
```

### IndexedDB 오프라인 저장
```javascript
// offline-storage.js
class OfflineStorage {
    async init() {
        this.db = await this.openDB('MiyakojimaData', 1);
    }
    
    async saveExpenseOffline(expenseData) {
        const transaction = this.db.transaction(['expenses'], 'readwrite');
        await transaction.objectStore('expenses').add({
            ...expenseData,
            synced: false,
            timestamp: Date.now()
        });
    }
    
    // 온라인 복구 시 동기화
    async syncOfflineData() {
        const unsynced = await this.getUnsyncedData();
        for (const data of unsynced) {
            await this.uploadToGoogleSheets(data);
            await this.markAsSynced(data.id);
        }
    }
}
```

---

## 🔄 실시간 동기화 전략

### 데이터 흐름
```
사용자 입력 → 로컬 저장 (즉시) → Google Sheets 업로드 (비동기)
              ↓
        오프라인 큐 → 온라인 복구 시 자동 동기화
```

### 충돌 해결
```javascript
async resolveDataConflicts(localData, remoteData) {
    // 타임스탬프 기준 최신 데이터 우선
    return localData.timestamp > remoteData.timestamp ? localData : remoteData;
}
```

---

**🎯 총 개발 시간: 3주 (여행 전 완성 목표)**  
**💰 총 운영 비용: $0/월 (100% 무료 서비스)**  
**📱 지원 기능: 오프라인 우선, PWA 앱 설치, 실시간 동기화**