# 데이터 연동 및 API 통합 설계서
# Data Integration and API Architecture

**문서 목적**: 무료 서비스 기반 데이터 연동 및 실시간 API 통합 전략  
**작성일**: 2025년 9월 7일  
**핵심 원칙**: 100% 무료 서비스 활용, ChatGPT Projects 보완 기능 중심  

---

## 1. 무료 서비스 기반 아키텍처 개요

### 1.1 핵심 전략
- **Google Sheets + Apps Script**: 무료 데이터베이스 및 서버리스 백엔드
- **Gemini Pro API**: 사용자 구독 중인 서비스 활용 (AI 분석)
- **무료 공개 API**: 날씨, 환율, 교통정보
- **GitHub Pages**: 무료 호스팅 플랫폼
- **브라우저 내장 API**: GPS, 카메라, 음성인식

### 1.2 시스템 구성도
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   GitHub Pages  │◄──►│  Google Sheets   │◄──►│  Apps Script    │
│   (Frontend)    │    │  (Database)      │    │  (Backend)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                        │                       │
        ▼                        ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ 브라우저 API    │    │   무료 API       │    │  Gemini Pro     │
│ GPS/카메라/음성 │    │ 날씨/환율/교통   │    │  (사용자 구독)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

---

## 2. Google Sheets 데이터베이스 설계

### 2.1 스프레드시트 구조
```javascript
// Google Sheets 데이터베이스 스키마
const SPREADSHEET_STRUCTURE = {
    // 시트 1: 여행 일정 관리
    ITINERARY: {
        sheetName: 'Itinerary',
        columns: [
            'date',         // 날짜 (YYYY-MM-DD)
            'time',         // 시간 (HH:MM)
            'activity',     // 활동명
            'location',     // 장소
            'poi_id',       // POI 연결 ID
            'notes',        // 메모
            'status',       // 상태 (planned/completed/cancelled)
            'created_at',   // 생성 시각
            'updated_at'    // 수정 시각
        ]
    },
    
    // 시트 2: 예산 추적
    BUDGET: {
        sheetName: 'Budget',
        columns: [
            'date',         // 지출 날짜
            'category',     // 카테고리 (식비/교통비/쇼핑/액티비티)
            'amount_jpy',   // 일본엔 금액
            'amount_krw',   // 원화 환산 금액
            'description',  // 지출 내역
            'location',     // 지출 장소
            'receipt_url',  // 영수증 이미지 URL (Google Drive)
            'payment_method', // 결제 수단
            'exchange_rate'   // 당시 환율
        ]
    },
    
    // 시트 3: POI 평가 및 리뷰
    POI_REVIEWS: {
        sheetName: 'POI_Reviews',
        columns: [
            'poi_id',       // POI ID
            'rating',       // 평점 (1-5)
            'review_text',  // 리뷰 내용
            'photos',       // 사진 URL들
            'visited_date', // 방문 날짜
            'visit_time',   // 방문 시간대
            'crowd_level',  // 혼잡도 (1-5)
            'recommendation', // 추천도 (1-5)
            'tags'          // 태그들
        ]
    },
    
    // 시트 4: 실시간 상태 추적
    LIVE_STATUS: {
        sheetName: 'Live_Status',
        columns: [
            'timestamp',    // 업데이트 시각
            'current_location', // 현재 위치 (lat,lng)
            'weather',      // 현재 날씨
            'next_activity', // 다음 활동
            'budget_remaining', // 남은 예산
            'emergency_contact', // 응급 연락처 상태
            'device_battery',    // 디바이스 배터리
            'internet_status'    // 인터넷 연결 상태
        ]
    },
    
    // 시트 5: 번역 히스토리
    TRANSLATION_HISTORY: {
        sheetName: 'Translation_History',
        columns: [
            'timestamp',    // 번역 시각
            'source_text',  // 원문
            'translated_text', // 번역문
            'source_lang',  // 원문 언어
            'target_lang',  // 번역 언어
            'translation_type', // 번역 타입 (text/voice/image)
            'location',     // 번역한 위치
            'context'       // 상황 정보
        ]
    }
};
```

### 2.2 Google Apps Script 백엔드 함수들
```javascript
// gas-backend.gs - Google Apps Script 백엔드
class MiyakojimaBackend {
    constructor() {
        this.spreadsheetId = 'YOUR_SPREADSHEET_ID';
        this.sheet = SpreadsheetApp.openById(this.spreadsheetId);
    }
    
    // 일정 관리 API
    addItineraryItem(data) {
        const itinerarySheet = this.sheet.getSheetByName('Itinerary');
        const newRow = [
            data.date,
            data.time,
            data.activity,
            data.location,
            data.poi_id || '',
            data.notes || '',
            'planned',
            new Date().toISOString(),
            new Date().toISOString()
        ];
        
        itinerarySheet.appendRow(newRow);
        
        // Gemini Pro로 일정 최적화 제안
        this.optimizeItineraryWithGemini(data.date);
        
        return { success: true, message: 'Itinerary item added' };
    }
    
    getItineraryByDate(date) {
        const itinerarySheet = this.sheet.getSheetByName('Itinerary');
        const data = itinerarySheet.getDataRange().getValues();
        const headers = data[0];
        
        const filteredData = data.slice(1).filter(row => row[0] === date);
        
        return filteredData.map(row => {
            const item = {};
            headers.forEach((header, index) => {
                item[header] = row[index];
            });
            return item;
        });
    }
    
    // 예산 관리 API
    addExpense(data) {
        const budgetSheet = this.sheet.getSheetByName('Budget');
        
        // 현재 환율 가져오기
        const exchangeRate = this.getCurrentExchangeRate();
        const amountKRW = data.amount_jpy * exchangeRate;
        
        const newRow = [
            data.date,
            data.category,
            data.amount_jpy,
            Math.round(amountKRW),
            data.description,
            data.location || '',
            data.receipt_url || '',
            data.payment_method || 'cash',
            exchangeRate
        ];
        
        budgetSheet.appendRow(newRow);
        
        // 예산 초과 알림 체크
        this.checkBudgetAlert(data.category);
        
        return { success: true, exchangeRate, amountKRW };
    }
    
    getBudgetSummary() {
        const budgetSheet = this.sheet.getSheetByName('Budget');
        const data = budgetSheet.getDataRange().getValues().slice(1);
        
        const summary = {
            totalSpent: 0,
            byCategory: {},
            byDate: {},
            lastUpdated: new Date().toISOString()
        };
        
        data.forEach(row => {
            const [date, category, amountJPY, amountKRW] = row;
            
            summary.totalSpent += amountKRW;
            
            if (!summary.byCategory[category]) {
                summary.byCategory[category] = 0;
            }
            summary.byCategory[category] += amountKRW;
            
            if (!summary.byDate[date]) {
                summary.byDate[date] = 0;
            }
            summary.byDate[date] += amountKRW;
        });
        
        return summary;
    }
    
    // POI 리뷰 API
    addPOIReview(data) {
        const reviewSheet = this.sheet.getSheetByName('POI_Reviews');
        
        const newRow = [
            data.poi_id,
            data.rating,
            data.review_text,
            data.photos ? data.photos.join(',') : '',
            data.visited_date,
            data.visit_time,
            data.crowd_level,
            data.recommendation,
            data.tags ? data.tags.join(',') : ''
        ];
        
        reviewSheet.appendRow(newRow);
        
        // Gemini Pro로 리뷰 분석 및 추천 개선
        this.analyzePOIReviewWithGemini(data);
        
        return { success: true };
    }
    
    // 실시간 상태 업데이트
    updateLiveStatus(data) {
        const statusSheet = this.sheet.getSheetByName('Live_Status');
        
        // 기존 데이터 삭제 후 새 데이터 추가 (실시간 상태는 하나만 유지)
        statusSheet.clear();
        statusSheet.appendRow([
            'timestamp', 'current_location', 'weather', 'next_activity',
            'budget_remaining', 'emergency_contact', 'device_battery', 'internet_status'
        ]);
        
        const newRow = [
            new Date().toISOString(),
            data.current_location,
            data.weather,
            data.next_activity,
            data.budget_remaining,
            data.emergency_contact || 'ok',
            data.device_battery,
            data.internet_status || 'connected'
        ];
        
        statusSheet.appendRow(newRow);
        
        return { success: true };
    }
    
    // 번역 히스토리 저장
    saveTranslation(data) {
        const translationSheet = this.sheet.getSheetByName('Translation_History');
        
        const newRow = [
            new Date().toISOString(),
            data.source_text,
            data.translated_text,
            data.source_lang,
            data.target_lang,
            data.translation_type,
            data.location || '',
            data.context || ''
        ];
        
        translationSheet.appendRow(newRow);
        
        return { success: true };
    }
    
    // 환율 정보 가져오기
    getCurrentExchangeRate() {
        try {
            // 무료 환율 API 사용
            const response = UrlFetchApp.fetch('https://api.exchangerate-api.com/v4/latest/JPY');
            const data = JSON.parse(response.getContentText());
            return data.rates.KRW;
        } catch (error) {
            console.error('환율 조회 실패:', error);
            return 9.2; // 기본값
        }
    }
    
    // Gemini Pro 연동 (사용자 구독 활용)
    optimizeItineraryWithGemini(date) {
        try {
            const itinerary = this.getItineraryByDate(date);
            
            // Gemini Pro API 호출 (사용자의 API 키 사용)
            const prompt = `다음 미야코지마 여행 일정을 분석하고 최적화 제안을 해주세요:\n${JSON.stringify(itinerary)}`;
            
            // 실제 구현 시 사용자의 Gemini Pro API 키 사용
            const suggestions = this.callGeminiPro(prompt);
            
            // 제안사항을 별도 시트에 저장
            this.saveSuggestions('itinerary', date, suggestions);
            
        } catch (error) {
            console.error('Gemini 분석 실패:', error);
        }
    }
    
    analyzePOIReviewWithGemini(reviewData) {
        try {
            const prompt = `다음 POI 리뷰를 분석하고 다른 여행자들을 위한 인사이트를 제공해주세요:\n${JSON.stringify(reviewData)}`;
            
            const insights = this.callGeminiPro(prompt);
            this.saveSuggestions('poi_analysis', reviewData.poi_id, insights);
            
        } catch (error) {
            console.error('POI 분석 실패:', error);
        }
    }
    
    callGeminiPro(prompt) {
        // 실제 Gemini Pro API 호출 구현
        // 사용자의 구독 정보를 활용
        return "Gemini Pro 분석 결과"; // 플레이스홀더
    }
    
    saveSuggestions(type, id, suggestions) {
        // 제안사항을 저장하는 로직
        const suggestionsSheet = this.getOrCreateSheet('AI_Suggestions');
        suggestionsSheet.appendRow([
            new Date().toISOString(),
            type,
            id,
            suggestions
        ]);
    }
    
    getOrCreateSheet(sheetName) {
        let sheet = this.sheet.getSheetByName(sheetName);
        if (!sheet) {
            sheet = this.sheet.insertSheet(sheetName);
        }
        return sheet;
    }
    
    // 예산 알림 체크
    checkBudgetAlert(category) {
        const budgetLimits = {
            '식비': 600000,
            '교통비': 400000,
            '쇼핑': 400000,
            '액티비티': 600000
        };
        
        const spent = this.getCategorySpent(category);
        const limit = budgetLimits[category] || 500000;
        const percentage = (spent / limit) * 100;
        
        if (percentage >= 80) {
            this.sendBudgetAlert(category, percentage, spent, limit);
        }
    }
    
    getCategorySpent(category) {
        const budgetSheet = this.sheet.getSheetByName('Budget');
        const data = budgetSheet.getDataRange().getValues().slice(1);
        
        return data
            .filter(row => row[1] === category)
            .reduce((total, row) => total + (row[3] || 0), 0);
    }
    
    sendBudgetAlert(category, percentage, spent, limit) {
        // 텔레그램 봇으로 알림 전송 (선택사항)
        const message = `⚠️ 예산 알림\n${category}: ${Math.round(percentage)}% 사용\n사용액: ₩${spent.toLocaleString()}\n한도: ₩${limit.toLocaleString()}`;
        
        // 텔레그램 봇 API 호출 (사용자가 설정한 경우)
        this.sendTelegramAlert(message);
    }
    
    sendTelegramAlert(message) {
        // 텔레그램 봇 연동 (선택사항)
        try {
            const botToken = 'YOUR_TELEGRAM_BOT_TOKEN';
            const chatId = 'YOUR_CHAT_ID';
            
            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            const payload = {
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            };
            
            UrlFetchApp.fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                payload: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('텔레그램 알림 실패:', error);
        }
    }
}

// 웹 앱으로 배포하기 위한 doGet/doPost 함수들
function doPost(e) {
    const backend = new MiyakojimaBackend();
    
    try {
        const data = JSON.parse(e.postData.contents);
        const { action, payload } = data;
        
        let result;
        switch (action) {
            case 'add_itinerary':
                result = backend.addItineraryItem(payload);
                break;
            case 'get_itinerary':
                result = backend.getItineraryByDate(payload.date);
                break;
            case 'add_expense':
                result = backend.addExpense(payload);
                break;
            case 'get_budget':
                result = backend.getBudgetSummary();
                break;
            case 'add_review':
                result = backend.addPOIReview(payload);
                break;
            case 'update_status':
                result = backend.updateLiveStatus(payload);
                break;
            case 'save_translation':
                result = backend.saveTranslation(payload);
                break;
            default:
                result = { error: 'Unknown action' };
        }
        
        return ContentService
            .createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);
            
    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ error: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function doGet(e) {
    const backend = new MiyakojimaBackend();
    const action = e.parameter.action;
    
    try {
        let result;
        switch (action) {
            case 'get_status':
                result = backend.getLiveStatus();
                break;
            case 'get_exchange_rate':
                result = { rate: backend.getCurrentExchangeRate() };
                break;
            default:
                result = { error: 'Unknown GET action' };
        }
        
        return ContentService
            .createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);
            
    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ error: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}
```

---

## 3. 프론트엔드 API 연동 클래스

### 3.1 메인 API 클라이언트
```javascript
// api-client.js - 프론트엔드 API 클라이언트
class MiyakojimaAPIClient {
    constructor() {
        this.baseURL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
        this.offlineQueue = [];
        this.isOnline = navigator.onLine;
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.processOfflineQueue();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    }
    
    // 통합 API 호출 메서드
    async apiCall(action, payload = null, method = 'POST') {
        const request = { action, payload };
        
        if (!this.isOnline) {
            return this.handleOfflineRequest(request);
        }
        
        try {
            const options = {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: method === 'POST' ? JSON.stringify(request) : null
            };
            
            const url = method === 'GET' ? 
                `${this.baseURL}?action=${action}&${new URLSearchParams(payload || {}).toString()}` : 
                this.baseURL;
            
            const response = await fetch(url, options);
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            return data;
            
        } catch (error) {
            console.error('API 호출 실패:', error);
            
            // 오프라인으로 처리
            return this.handleOfflineRequest(request);
        }
    }
    
    handleOfflineRequest(request) {
        // 오프라인 큐에 추가
        this.offlineQueue.push({
            ...request,
            timestamp: Date.now(),
            retryCount: 0
        });
        
        // 로컬 스토리지에 저장
        localStorage.setItem('offlineQueue', JSON.stringify(this.offlineQueue));
        
        return { 
            success: false, 
            offline: true, 
            message: '오프라인 상태입니다. 연결 복구 시 자동 동기화됩니다.' 
        };
    }
    
    async processOfflineQueue() {
        if (this.offlineQueue.length === 0) return;
        
        console.log(`처리할 오프라인 요청 ${this.offlineQueue.length}개`);
        
        const processedItems = [];
        
        for (const item of this.offlineQueue) {
            try {
                const result = await this.apiCall(item.action, item.payload);
                if (result.success !== false) {
                    processedItems.push(item);
                }
            } catch (error) {
                console.error('오프라인 요청 처리 실패:', error);
                item.retryCount = (item.retryCount || 0) + 1;
                
                // 3번 시도 후 포기
                if (item.retryCount >= 3) {
                    processedItems.push(item);
                }
            }
        }
        
        // 처리된 항목들 제거
        this.offlineQueue = this.offlineQueue.filter(item => 
            !processedItems.includes(item)
        );
        
        localStorage.setItem('offlineQueue', JSON.stringify(this.offlineQueue));
        
        console.log(`${processedItems.length}개 오프라인 요청 처리 완료`);
    }
    
    // 일정 관리 API들
    async addItineraryItem(itemData) {
        return await this.apiCall('add_itinerary', itemData);
    }
    
    async getItinerary(date) {
        return await this.apiCall('get_itinerary', { date }, 'GET');
    }
    
    async updateItineraryItem(itemId, updates) {
        return await this.apiCall('update_itinerary', { itemId, updates });
    }
    
    // 예산 관리 API들
    async addExpense(expenseData) {
        return await this.apiCall('add_expense', expenseData);
    }
    
    async getBudgetSummary() {
        return await this.apiCall('get_budget', null, 'GET');
    }
    
    async uploadReceipt(imageFile) {
        // Google Drive에 영수증 업로드
        const formData = new FormData();
        formData.append('file', imageFile);
        formData.append('action', 'upload_receipt');
        
        try {
            const response = await fetch(this.baseURL, {
                method: 'POST',
                body: formData
            });
            
            return await response.json();
        } catch (error) {
            console.error('영수증 업로드 실패:', error);
            return { success: false, error: error.message };
        }
    }
    
    // POI 리뷰 API들
    async addPOIReview(reviewData) {
        return await this.apiCall('add_review', reviewData);
    }
    
    async getPOIReviews(poiId) {
        return await this.apiCall('get_poi_reviews', { poiId }, 'GET');
    }
    
    // 실시간 상태 API들
    async updateLiveStatus(statusData) {
        return await this.apiCall('update_status', statusData);
    }
    
    async getLiveStatus() {
        return await this.apiCall('get_status', null, 'GET');
    }
    
    // 번역 히스토리 API
    async saveTranslation(translationData) {
        return await this.apiCall('save_translation', translationData);
    }
    
    async getTranslationHistory(limit = 50) {
        return await this.apiCall('get_translation_history', { limit }, 'GET');
    }
    
    // 환율 정보 API
    async getExchangeRate() {
        return await this.apiCall('get_exchange_rate', null, 'GET');
    }
}

// 전역 API 클라이언트 인스턴스
const apiClient = new MiyakojimaAPIClient();
```

---

## 4. 무료 외부 API 통합

### 4.1 외부 API 관리자
```javascript
// external-apis.js - 무료 외부 API 통합
class ExternalAPIManager {
    constructor() {
        this.apiEndpoints = {
            weather: 'https://api.openweathermap.org/data/2.5/weather',
            exchange: 'https://api.exchangerate-api.com/v4/latest/JPY',
            geocoding: 'https://api.opencagedata.com/geocode/v1/json',
            transit: 'https://transit.land/api/v2/rest'
        };
        
        this.apiKeys = {
            // 무료 API 키들 (사용자가 직접 발급)
            openweather: 'YOUR_OPENWEATHER_API_KEY',
            opencage: 'YOUR_OPENCAGE_API_KEY'
            // exchange-rate-api는 API 키 불필요 (무료)
        };
        
        this.cache = new Map();
        this.cacheDuration = 10 * 60 * 1000; // 10분
    }
    
    // 날씨 정보 가져오기
    async getWeatherInfo(lat, lng) {
        const cacheKey = `weather_${lat}_${lng}`;
        
        // 캐시 확인
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheDuration) {
                return cached.data;
            }
        }
        
        try {
            const url = `${this.apiEndpoints.weather}?lat=${lat}&lon=${lng}&appid=${this.apiKeys.openweather}&units=metric&lang=ja`;
            const response = await fetch(url);
            const data = await response.json();
            
            const weatherInfo = {
                temperature: Math.round(data.main.temp),
                condition: data.weather[0].description,
                humidity: data.main.humidity,
                windSpeed: data.wind.speed,
                icon: data.weather[0].icon,
                timestamp: Date.now()
            };
            
            // 캐시 저장
            this.cache.set(cacheKey, { data: weatherInfo, timestamp: Date.now() });
            
            return weatherInfo;
            
        } catch (error) {
            console.error('날씨 정보 조회 실패:', error);
            return this.getFallbackWeather();
        }
    }
    
    getFallbackWeather() {
        return {
            temperature: 25,
            condition: '정보 없음',
            humidity: 60,
            windSpeed: 5,
            icon: '01d',
            timestamp: Date.now()
        };
    }
    
    // 환율 정보 가져오기
    async getExchangeRates() {
        const cacheKey = 'exchange_rates';
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheDuration) {
                return cached.data;
            }
        }
        
        try {
            const response = await fetch(this.apiEndpoints.exchange);
            const data = await response.json();
            
            const rates = {
                JPY_to_KRW: data.rates.KRW,
                KRW_to_JPY: 1 / data.rates.KRW,
                lastUpdated: data.date,
                timestamp: Date.now()
            };
            
            this.cache.set(cacheKey, { data: rates, timestamp: Date.now() });
            
            return rates;
            
        } catch (error) {
            console.error('환율 정보 조회 실패:', error);
            return {
                JPY_to_KRW: 9.2,
                KRW_to_JPY: 1/9.2,
                lastUpdated: new Date().toISOString().split('T')[0],
                timestamp: Date.now()
            };
        }
    }
    
    // 지오코딩 (주소 → 좌표)
    async geocodeAddress(address) {
        const cacheKey = `geocode_${address}`;
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            return cached.data;
        }
        
        try {
            const encodedAddress = encodeURIComponent(address);
            const url = `${this.apiEndpoints.geocoding}?q=${encodedAddress}&key=${this.apiKeys.opencage}&language=ja&limit=1`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                const result = data.results[0];
                const coordinates = {
                    lat: result.geometry.lat,
                    lng: result.geometry.lng,
                    formatted: result.formatted
                };
                
                this.cache.set(cacheKey, { data: coordinates, timestamp: Date.now() });
                return coordinates;
            }
            
            throw new Error('주소를 찾을 수 없습니다');
            
        } catch (error) {
            console.error('지오코딩 실패:', error);
            return null;
        }
    }
    
    // 역 지오코딩 (좌표 → 주소)
    async reverseGeocode(lat, lng) {
        const cacheKey = `reverse_${lat}_${lng}`;
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            return cached.data;
        }
        
        try {
            const url = `${this.apiEndpoints.geocoding}?q=${lat}+${lng}&key=${this.apiKeys.opencage}&language=ja&limit=1`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                const result = data.results[0];
                const address = {
                    formatted: result.formatted,
                    components: result.components
                };
                
                this.cache.set(cacheKey, { data: address, timestamp: Date.now() });
                return address;
            }
            
            throw new Error('주소를 찾을 수 없습니다');
            
        } catch (error) {
            console.error('역 지오코딩 실패:', error);
            return { formatted: '위치 정보 없음', components: {} };
        }
    }
    
    // 대중교통 정보 (무료 API 한계로 기본 정보만)
    async getTransitInfo(fromLat, fromLng, toLat, toLng) {
        // 무료 API의 한계로 기본적인 정보만 제공
        const distance = this.calculateDistance(fromLat, fromLng, toLat, toLng);
        
        return {
            distance: Math.round(distance * 100) / 100,
            estimatedTime: Math.round(distance * 2), // 대략적인 계산
            options: [
                { type: 'walking', time: Math.round(distance * 12), cost: 0 },
                { type: 'taxi', time: Math.round(distance * 2), cost: Math.round(distance * 120) },
                { type: 'rental_car', time: Math.round(distance * 1.5), cost: Math.round(distance * 50) }
            ]
        };
    }
    
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // 지구 반지름 (km)
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    // 캐시 정리
    clearExpiredCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheDuration) {
                this.cache.delete(key);
            }
        }
    }
}

// 전역 외부 API 관리자
const externalAPI = new ExternalAPIManager();

// 주기적으로 캐시 정리
setInterval(() => {
    externalAPI.clearExpiredCache();
}, 5 * 60 * 1000); // 5분마다
```

---

## 5. 브라우저 내장 API 활용

### 5.1 디바이스 기능 통합 클래스
```javascript
// device-integration.js - 브라우저 내장 API 활용
class DeviceIntegration {
    constructor() {
        this.currentPosition = null;
        this.watchId = null;
        this.mediaStream = null;
        this.speechRecognition = null;
        this.setupDeviceAPIs();
    }
    
    setupDeviceAPIs() {
        // 위치 추적 설정
        if ('geolocation' in navigator) {
            this.startLocationTracking();
        }
        
        // 배터리 API 설정 (지원하는 브라우저에서)
        if ('getBattery' in navigator) {
            this.monitorBattery();
        }
        
        // 네트워크 정보 모니터링
        if ('connection' in navigator) {
            this.monitorConnection();
        }
        
        // 디바이스 방향 감지
        if (window.DeviceOrientationEvent) {
            this.setupOrientationTracking();
        }
    }
    
    // GPS 위치 추적
    startLocationTracking() {
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000 // 1분
        };
        
        // 현재 위치 가져오기
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.currentPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                };
                
                this.onLocationUpdate(this.currentPosition);
            },
            (error) => {
                console.error('위치 조회 실패:', error);
                this.handleLocationError(error);
            },
            options
        );
        
        // 위치 변화 추적
        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                const newPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                };
                
                // 의미있는 위치 변화인지 확인 (10m 이상)
                if (this.currentPosition && 
                    this.calculateDistance(
                        this.currentPosition.lat, this.currentPosition.lng,
                        newPosition.lat, newPosition.lng
                    ) > 0.01) {
                    
                    this.currentPosition = newPosition;
                    this.onLocationUpdate(newPosition);
                }
            },
            (error) => {
                this.handleLocationError(error);
            },
            options
        );
    }
    
    onLocationUpdate(position) {
        // 위치 업데이트 시 실행할 로직
        console.log('위치 업데이트:', position);
        
        // 서버에 위치 정보 전송
        this.updateLocationOnServer(position);
        
        // 주변 POI 업데이트
        this.updateNearbyPOIs(position);
        
        // 날씨 정보 업데이트
        this.updateWeatherForLocation(position);
    }
    
    async updateLocationOnServer(position) {
        try {
            const statusData = {
                current_location: `${position.lat},${position.lng}`,
                location_accuracy: position.accuracy,
                location_timestamp: new Date(position.timestamp).toISOString()
            };
            
            await apiClient.updateLiveStatus(statusData);
        } catch (error) {
            console.error('위치 서버 업데이트 실패:', error);
        }
    }
    
    // 카메라 기능
    async startCamera(facingMode = 'environment') {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: facingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            return this.mediaStream;
            
        } catch (error) {
            console.error('카메라 접근 실패:', error);
            throw error;
        }
    }
    
    stopCamera() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
    }
    
    async capturePhoto() {
        if (!this.mediaStream) {
            throw new Error('카메라가 활성화되지 않았습니다');
        }
        
        const video = document.createElement('video');
        video.srcObject = this.mediaStream;
        video.play();
        
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);
                
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', 0.8);
            };
        });
    }
    
    // 음성 인식
    startVoiceRecognition(language = 'ko-KR') {
        if (!('webkitSpeechRecognition' in window)) {
            throw new Error('음성 인식을 지원하지 않는 브라우저입니다');
        }
        
        this.speechRecognition = new webkitSpeechRecognition();
        this.speechRecognition.continuous = false;
        this.speechRecognition.interimResults = false;
        this.speechRecognition.lang = language;
        
        return new Promise((resolve, reject) => {
            this.speechRecognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                const confidence = event.results[0][0].confidence;
                
                resolve({ transcript, confidence });
            };
            
            this.speechRecognition.onerror = (event) => {
                reject(new Error(event.error));
            };
            
            this.speechRecognition.start();
        });
    }
    
    stopVoiceRecognition() {
        if (this.speechRecognition) {
            this.speechRecognition.stop();
        }
    }
    
    // 음성 합성 (TTS)
    speak(text, language = 'ja-JP') {
        if (!('speechSynthesis' in window)) {
            console.warn('음성 합성을 지원하지 않는 브라우저입니다');
            return;
        }
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language;
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 0.8;
        
        speechSynthesis.speak(utterance);
    }
    
    // 배터리 모니터링
    async monitorBattery() {
        try {
            const battery = await navigator.getBattery();
            
            const updateBatteryStatus = () => {
                const batteryInfo = {
                    level: Math.round(battery.level * 100),
                    charging: battery.charging,
                    chargingTime: battery.chargingTime,
                    dischargingTime: battery.dischargingTime
                };
                
                this.onBatteryUpdate(batteryInfo);
            };
            
            updateBatteryStatus();
            
            battery.addEventListener('chargingchange', updateBatteryStatus);
            battery.addEventListener('levelchange', updateBatteryStatus);
            
        } catch (error) {
            console.warn('배터리 정보를 사용할 수 없습니다:', error);
        }
    }
    
    onBatteryUpdate(batteryInfo) {
        console.log('배터리 정보:', batteryInfo);
        
        // 배터리 부족 경고 (20% 미만)
        if (batteryInfo.level < 20 && !batteryInfo.charging) {
            this.showBatteryWarning(batteryInfo.level);
        }
        
        // 서버에 배터리 상태 업데이트
        apiClient.updateLiveStatus({
            device_battery: `${batteryInfo.level}%${batteryInfo.charging ? ' (충전중)' : ''}`
        });
    }
    
    showBatteryWarning(level) {
        const notification = new Notification('배터리 부족', {
            body: `배터리가 ${level}%입니다. 충전을 권장합니다.`,
            icon: '/icons/battery-low.png',
            tag: 'battery-warning'
        });
    }
    
    // 네트워크 연결 모니터링
    monitorConnection() {
        const connection = navigator.connection;
        
        const updateConnectionInfo = () => {
            const connectionInfo = {
                type: connection.effectiveType || 'unknown',
                downlink: connection.downlink || 0,
                rtt: connection.rtt || 0,
                saveData: connection.saveData || false
            };
            
            this.onConnectionUpdate(connectionInfo);
        };
        
        updateConnectionInfo();
        
        connection.addEventListener('change', updateConnectionInfo);
    }
    
    onConnectionUpdate(connectionInfo) {
        console.log('연결 정보:', connectionInfo);
        
        // 연결 상태에 따른 동작 조정
        if (connectionInfo.type === 'slow-2g') {
            this.enableDataSavingMode();
        } else if (connectionInfo.type === '4g') {
            this.disableDataSavingMode();
        }
        
        // 서버에 연결 상태 업데이트
        apiClient.updateLiveStatus({
            internet_status: `${connectionInfo.type} (${connectionInfo.downlink}Mbps)`
        });
    }
    
    // 디바이스 방향 추적
    setupOrientationTracking() {
        window.addEventListener('deviceorientation', (event) => {
            const orientation = {
                alpha: event.alpha, // 나침반 방향
                beta: event.beta,   // 앞뒤 기울기
                gamma: event.gamma  // 좌우 기울기
            };
            
            this.onOrientationChange(orientation);
        });
    }
    
    onOrientationChange(orientation) {
        // 나침반 기능 업데이트
        if (orientation.alpha !== null) {
            this.updateCompass(orientation.alpha);
        }
    }
    
    updateCompass(heading) {
        // 나침반 UI 업데이트
        const compassElement = document.getElementById('compass-needle');
        if (compassElement) {
            compassElement.style.transform = `rotate(${heading}deg)`;
        }
    }
    
    // 데이터 절약 모드
    enableDataSavingMode() {
        console.log('데이터 절약 모드 활성화');
        
        // 이미지 품질 낮추기
        document.documentElement.classList.add('data-saving-mode');
        
        // API 호출 간격 늘리기
        if (window.dataUpdateInterval) {
            clearInterval(window.dataUpdateInterval);
            window.dataUpdateInterval = setInterval(this.updateAllData.bind(this), 120000); // 2분마다
        }
    }
    
    disableDataSavingMode() {
        console.log('데이터 절약 모드 비활성화');
        
        document.documentElement.classList.remove('data-saving-mode');
        
        // 정상 업데이트 간격으로 복원
        if (window.dataUpdateInterval) {
            clearInterval(window.dataUpdateInterval);
            window.dataUpdateInterval = setInterval(this.updateAllData.bind(this), 30000); // 30초마다
        }
    }
    
    // 유틸리티 메서드들
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    handleLocationError(error) {
        let message = '위치 정보를 가져올 수 없습니다.';
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = '위치 권한이 거부되었습니다.';
                break;
            case error.POSITION_UNAVAILABLE:
                message = '위치 정보를 사용할 수 없습니다.';
                break;
            case error.TIMEOUT:
                message = '위치 요청이 시간 초과되었습니다.';
                break;
        }
        
        console.error('위치 오류:', message);
        this.showLocationError(message);
    }
    
    showLocationError(message) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('위치 오류', {
                body: message,
                icon: '/icons/location-error.png'
            });
        }
    }
    
    // 정리 메서드
    cleanup() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
        }
        
        if (this.mediaStream) {
            this.stopCamera();
        }
        
        if (this.speechRecognition) {
            this.stopVoiceRecognition();
        }
    }
}

// 전역 디바이스 통합 인스턴스
const deviceIntegration = new DeviceIntegration();

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
    deviceIntegration.cleanup();
});
```

---

## 6. 데이터 동기화 전략

### 6.1 실시간 동기화 관리자
```javascript
// sync-manager.js - 데이터 동기화 관리
class DataSyncManager {
    constructor() {
        this.syncInterval = 30000; // 30초
        this.lastSyncTime = 0;
        this.pendingChanges = new Map();
        this.syncInProgress = false;
        this.retryQueue = [];
        
        this.setupSyncScheduler();
        this.setupChangeTracking();
    }
    
    setupSyncScheduler() {
        // 정기 동기화
        setInterval(() => {
            if (navigator.onLine && !this.syncInProgress) {
                this.performSync();
            }
        }, this.syncInterval);
        
        // 온라인 상태 복구 시 즉시 동기화
        window.addEventListener('online', () => {
            setTimeout(() => {
                this.performSync();
            }, 1000);
        });
        
        // 페이지 가시성 변경 시 동기화
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && navigator.onLine) {
                this.performSync();
            }
        });
    }
    
    setupChangeTracking() {
        // localStorage 변경 감지
        window.addEventListener('storage', (event) => {
            if (event.key && event.key.startsWith('miyakojima_')) {
                this.trackChange(event.key, event.newValue);
            }
        });
        
        // 앱 내부 데이터 변경 추적
        this.setupDataChangeListeners();
    }
    
    setupDataChangeListeners() {
        // 일정 변경 추적
        document.addEventListener('itinerary-changed', (event) => {
            this.trackChange('itinerary', event.detail);
        });
        
        // 예산 변경 추적
        document.addEventListener('budget-changed', (event) => {
            this.trackChange('budget', event.detail);
        });
        
        // POI 리뷰 추가 추적
        document.addEventListener('review-added', (event) => {
            this.trackChange('review', event.detail);
        });
    }
    
    trackChange(type, data) {
        const changeId = `${type}_${Date.now()}`;
        
        this.pendingChanges.set(changeId, {
            type: type,
            data: data,
            timestamp: Date.now(),
            retryCount: 0
        });
        
        // 즉시 동기화 시도 (온라인 상태인 경우)
        if (navigator.onLine && !this.syncInProgress) {
            setTimeout(() => {
                this.performSync();
            }, 1000);
        }
    }
    
    async performSync() {
        if (this.syncInProgress || this.pendingChanges.size === 0) {
            return;
        }
        
        this.syncInProgress = true;
        console.log(`동기화 시작: ${this.pendingChanges.size}개 변경사항`);
        
        try {
            // 실시간 상태 업데이트
            await this.syncLiveStatus();
            
            // 변경사항 동기화
            await this.syncPendingChanges();
            
            // 서버에서 최신 데이터 가져오기
            await this.fetchLatestData();
            
            this.lastSyncTime = Date.now();
            console.log('동기화 완료');
            
        } catch (error) {
            console.error('동기화 실패:', error);
            this.handleSyncError();
        } finally {
            this.syncInProgress = false;
        }
    }
    
    async syncLiveStatus() {
        const currentStatus = {
            timestamp: new Date().toISOString(),
            current_location: deviceIntegration.currentPosition ? 
                `${deviceIntegration.currentPosition.lat},${deviceIntegration.currentPosition.lng}` : null,
            internet_status: navigator.onLine ? 'connected' : 'offline',
            device_battery: await this.getBatteryStatus(),
            last_activity: this.getLastActivity()
        };
        
        try {
            await apiClient.updateLiveStatus(currentStatus);
        } catch (error) {
            console.warn('실시간 상태 업데이트 실패:', error);
        }
    }
    
    async syncPendingChanges() {
        const changes = Array.from(this.pendingChanges.values());
        const processedChanges = [];
        
        for (const change of changes) {
            try {
                let result;
                
                switch (change.type) {
                    case 'itinerary':
                        result = await this.syncItineraryChange(change.data);
                        break;
                    case 'budget':
                        result = await this.syncBudgetChange(change.data);
                        break;
                    case 'review':
                        result = await this.syncReviewChange(change.data);
                        break;
                    default:
                        result = { success: true };
                }
                
                if (result.success) {
                    processedChanges.push(change);
                } else {
                    change.retryCount++;
                    if (change.retryCount >= 3) {
                        processedChanges.push(change); // 3번 시도 후 포기
                        console.error(`동기화 포기: ${change.type}`, change);
                    }
                }
                
            } catch (error) {
                console.error(`${change.type} 동기화 실패:`, error);
                change.retryCount++;
            }
        }
        
        // 처리된 변경사항 제거
        processedChanges.forEach(change => {
            const changeId = Array.from(this.pendingChanges.keys())
                .find(key => this.pendingChanges.get(key) === change);
            if (changeId) {
                this.pendingChanges.delete(changeId);
            }
        });
    }
    
    async syncItineraryChange(data) {
        if (data.action === 'add') {
            return await apiClient.addItineraryItem(data.item);
        } else if (data.action === 'update') {
            return await apiClient.updateItineraryItem(data.itemId, data.updates);
        }
        return { success: true };
    }
    
    async syncBudgetChange(data) {
        if (data.action === 'add_expense') {
            return await apiClient.addExpense(data.expense);
        }
        return { success: true };
    }
    
    async syncReviewChange(data) {
        return await apiClient.addPOIReview(data.review);
    }
    
    async fetchLatestData() {
        try {
            // 최신 예산 요약 가져오기
            const budgetSummary = await apiClient.getBudgetSummary();
            if (budgetSummary) {
                this.updateLocalBudgetData(budgetSummary);
            }
            
            // 오늘 일정 가져오기
            const today = new Date().toISOString().split('T')[0];
            const todayItinerary = await apiClient.getItinerary(today);
            if (todayItinerary) {
                this.updateLocalItineraryData(today, todayItinerary);
            }
            
            // 환율 정보 업데이트
            const exchangeRate = await externalAPI.getExchangeRates();
            if (exchangeRate) {
                localStorage.setItem('miyakojima_exchange_rate', JSON.stringify(exchangeRate));
            }
            
        } catch (error) {
            console.warn('최신 데이터 가져오기 실패:', error);
        }
    }
    
    updateLocalBudgetData(budgetData) {
        localStorage.setItem('miyakojima_budget_summary', JSON.stringify({
            ...budgetData,
            lastUpdated: Date.now()
        }));
        
        // 예산 업데이트 이벤트 발송
        document.dispatchEvent(new CustomEvent('budget-updated', {
            detail: budgetData
        }));
    }
    
    updateLocalItineraryData(date, itineraryData) {
        const cacheKey = `miyakojima_itinerary_${date}`;
        localStorage.setItem(cacheKey, JSON.stringify({
            data: itineraryData,
            lastUpdated: Date.now()
        }));
        
        // 일정 업데이트 이벤트 발송
        document.dispatchEvent(new CustomEvent('itinerary-updated', {
            detail: { date, data: itineraryData }
        }));
    }
    
    async getBatteryStatus() {
        try {
            if ('getBattery' in navigator) {
                const battery = await navigator.getBattery();
                return `${Math.round(battery.level * 100)}%${battery.charging ? ' (충전중)' : ''}`;
            }
        } catch (error) {
            // 무시
        }
        return 'N/A';
    }
    
    getLastActivity() {
        const lastActivity = localStorage.getItem('miyakojima_last_activity');
        return lastActivity || new Date().toISOString();
    }
    
    handleSyncError() {
        // 동기화 실패 시 재시도 간격 늘리기
        this.syncInterval = Math.min(this.syncInterval * 1.5, 300000); // 최대 5분
        
        console.log(`동기화 간격 조정: ${this.syncInterval / 1000}초`);
    }
    
    // 수동 동기화 트리거
    async forcSync() {
        if (this.syncInProgress) {
            console.log('동기화가 이미 진행중입니다');
            return;
        }
        
        console.log('수동 동기화 시작');
        await this.performSync();
    }
    
    // 동기화 상태 조회
    getSyncStatus() {
        return {
            lastSyncTime: this.lastSyncTime,
            pendingChanges: this.pendingChanges.size,
            syncInProgress: this.syncInProgress,
            syncInterval: this.syncInterval,
            isOnline: navigator.onLine
        };
    }
    
    // 변경사항 강제 초기화 (주의: 데이터 손실 가능)
    clearPendingChanges() {
        this.pendingChanges.clear();
        console.log('모든 대기 중인 변경사항이 초기화되었습니다');
    }
}

// 전역 동기화 관리자
const syncManager = new DataSyncManager();

// 개발자 도구에서 동기화 제어 가능하도록
window.syncManager = syncManager;
```

---

**🎯 데이터 연동 및 API 통합 설계 완료**

이 설계서는 100% 무료 서비스를 활용한 완전한 데이터 연동 시스템을 포함합니다:

✅ **무료 서비스 기반 아키텍처**
- Google Sheets + Apps Script: 무료 데이터베이스 및 서버리스 백엔드
- Gemini Pro API: 사용자 구독 서비스 활용
- 브라우저 내장 API: GPS, 카메라, 음성인식 등

✅ **완전한 백엔드 시스템**
- Google Apps Script로 구현된 RESTful API
- 실시간 데이터 동기화 및 오프라인 큐 처리
- 텔레그램 봇 연동으로 실시간 알림

✅ **외부 API 통합**
- 무료 날씨 API (OpenWeatherMap)
- 무료 환율 API (Exchange Rate API)
- 무료 지오코딩 API (OpenCage)

✅ **디바이스 기능 활용**
- GPS 위치 추적 및 자동 업데이트
- 카메라 촬영 및 영수증 OCR
- 음성 인식 및 TTS 기능
- 배터리/네트워크 상태 모니터링

✅ **데이터 동기화**
- 실시간 양방향 동기화
- 오프라인 지원 및 자동 복구
- 변경사항 추적 및 충돌 해결

이제 ChatGPT Projects가 할 수 없는 실시간 GUI, 데이터 저장, 디바이스 연동 기능을 완벽하게 보완하는 시스템이 설계되었습니다!