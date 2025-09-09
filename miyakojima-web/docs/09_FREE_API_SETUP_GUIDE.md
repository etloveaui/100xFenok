# 무료 API 연동 가이드
# Free API Integration Guide

**문서 목적**: 100% 무료 서비스만을 활용한 API 연동 완전 가이드  
**작성일**: 2025년 9월 7일  
**총 예상 비용**: $0/월 (완전 무료)  

---

## 🎯 필수 API 서비스 5종

### 1. Google Apps Script (백엔드)
**용도**: 서버리스 백엔드, Google Sheets 데이터베이스 연동  
**무료 할당량**: 6분/실행, 20회/분, 무제한 실행 횟수  

#### 1.1 Google Apps Script 프로젝트 생성
```bash
# 1. script.google.com 접속
# 2. "새 프로젝트" 클릭
# 3. 프로젝트명: "MiyakojimaBackend" 설정
```

#### 1.2 백엔드 코드 배포
```javascript
// Code.gs - 메인 백엔드 코드
function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);
        const action = data.action;
        
        switch(action) {
            case 'add_expense':
                return addExpense(data.payload);
            case 'get_budget_status':
                return getBudgetStatus();
            case 'update_itinerary':
                return updateItinerary(data.payload);
            case 'get_poi_recommendations':
                return getPOIRecommendations(data.payload);
            default:
                return createResponse(400, 'Invalid action');
        }
    } catch (error) {
        return createResponse(500, error.toString());
    }
}

function doGet(e) {
    // CORS 헤더 설정
    const output = ContentService.createTextOutput('GET requests not supported');
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
}

function createResponse(status, data) {
    const response = ContentService.createTextOutput(
        JSON.stringify({
            status: status,
            data: data,
            timestamp: new Date().getTime()
        })
    );
    response.setMimeType(ContentService.MimeType.JSON);
    
    // CORS 헤더 추가
    response.getHeaders()['Access-Control-Allow-Origin'] = '*';
    response.getHeaders()['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
    response.getHeaders()['Access-Control-Allow-Headers'] = 'Content-Type';
    
    return response;
}

// 예산 추가 함수
function addExpense(expenseData) {
    const sheet = SpreadsheetApp.openById('YOUR_SHEET_ID');
    const budgetSheet = sheet.getSheetByName('Budget');
    
    budgetSheet.appendRow([
        new Date(),
        expenseData.amount,
        expenseData.category,
        expenseData.description,
        expenseData.location
    ]);
    
    return createResponse(200, { success: true, message: 'Expense added' });
}
```

#### 1.3 웹 앱으로 배포
```
1. Apps Script 편집기 → "배포" → "새 배포"
2. 유형: "웹 앱" 선택
3. 실행 계정: "나" 선택
4. 액세스 권한: "모든 사용자" 선택
5. 배포 → URL 복사 (웹앱 URL)
```

---

### 2. Google Sheets (데이터베이스)
**용도**: 무료 클라우드 데이터베이스  
**무료 할당량**: 무제한 (Google Drive 15GB 한도 내)  

#### 2.1 데이터베이스 시트 생성
```
스프레드시트명: "MiyakojimaDB"

Sheet 1: Budget (예산 관리)
A: 날짜 | B: 금액(JPY) | C: 카테고리 | D: 설명 | E: 위치

Sheet 2: Itinerary (일정 관리)
A: 날짜 | B: 시간 | C: 장소 | D: 활동 | E: 상태 | F: 메모

Sheet 3: POI_Reviews (장소 리뷰)
A: POI_ID | B: 평점 | C: 리뷰 | D: 방문일 | E: 사진URL

Sheet 4: Live_Status (실시간 상태)
A: 현재위치 | B: 예산현황 | C: 다음목적지 | D: 업데이트시간
```

#### 2.2 Google Sheets API 연동
```javascript
// sheets-config.gs
const SHEET_CONFIG = {
    MAIN_SHEET_ID: 'YOUR_GOOGLE_SHEET_ID', // 스프레드시트 ID
    SHEETS: {
        BUDGET: 'Budget',
        ITINERARY: 'Itinerary', 
        POI_REVIEWS: 'POI_Reviews',
        LIVE_STATUS: 'Live_Status'
    }
};

function getSheet(sheetName) {
    const sheet = SpreadsheetApp.openById(SHEET_CONFIG.MAIN_SHEET_ID);
    return sheet.getSheetByName(SHEET_CONFIG.SHEETS[sheetName]);
}
```

---

### 3. ExchangeRate-API (환율 정보)
**용도**: 실시간 JPY ↔ KRW 환율 계산  
**무료 할당량**: 1,500 requests/월  
**API URL**: `https://api.exchangerate-api.com/v4/latest/JPY`

#### 3.1 API 연동 코드
```javascript
// exchange-rate.gs
function getExchangeRate(fromCurrency = 'JPY', toCurrency = 'KRW') {
    try {
        const response = UrlFetchApp.fetch(
            `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`
        );
        const data = JSON.parse(response.getContentText());
        return data.rates[toCurrency];
    } catch (error) {
        console.error('환율 API 오류:', error);
        return 8.7; // 기본값 (1 JPY = 8.7 KRW 기준)
    }
}

// 사용 예시
function convertCurrency(amount, from = 'JPY', to = 'KRW') {
    const rate = getExchangeRate(from, to);
    return Math.round(amount * rate);
}
```

#### 3.2 프론트엔드 연동
```javascript
// exchange-rate.js
class ExchangeRateService {
    constructor() {
        this.apiUrl = 'https://api.exchangerate-api.com/v4/latest';
        this.cachedRate = null;
        this.lastUpdate = null;
    }
    
    async getRate(from = 'JPY', to = 'KRW') {
        // 캐시 유효성 확인 (1시간)
        if (this.cachedRate && this.lastUpdate && 
            (Date.now() - this.lastUpdate) < 3600000) {
            return this.cachedRate;
        }
        
        try {
            const response = await fetch(`${this.apiUrl}/${from}`);
            const data = await response.json();
            this.cachedRate = data.rates[to];
            this.lastUpdate = Date.now();
            
            // localStorage에 캐시 저장
            localStorage.setItem('exchange_rate', JSON.stringify({
                rate: this.cachedRate,
                timestamp: this.lastUpdate
            }));
            
            return this.cachedRate;
        } catch (error) {
            console.error('환율 API 오류:', error);
            // 캐시된 값 사용
            const cached = localStorage.getItem('exchange_rate');
            return cached ? JSON.parse(cached).rate : 8.7;
        }
    }
}
```

---

### 4. OpenWeatherMap (날씨 정보)
**용도**: 미야코지마 5일 날씨 예보  
**무료 할당량**: 1,000 requests/day  
**가입**: openweathermap.org → 무료 계정 생성 → API Key 발급

#### 4.1 API 키 발급
```bash
# 1. openweathermap.org 가입
# 2. API Keys 메뉴 → API Key 복사
# 3. 미야코지마 좌표: lat=24.7392, lon=125.2814
```

#### 4.2 날씨 API 연동
```javascript
// weather.gs
const WEATHER_API_KEY = 'YOUR_OPENWEATHER_API_KEY';
const MIYAKOJIMA_COORDS = { lat: 24.7392, lon: 125.2814 };

function getWeatherForecast() {
    const url = `https://api.openweathermap.org/data/2.5/forecast?` +
                `lat=${MIYAKOJIMA_COORDS.lat}&` +
                `lon=${MIYAKOJIMA_COORDS.lon}&` +
                `appid=${WEATHER_API_KEY}&` +
                `units=metric&lang=kr`;
    
    try {
        const response = UrlFetchApp.fetch(url);
        const data = JSON.parse(response.getContentText());
        
        return {
            success: true,
            forecast: data.list.slice(0, 40), // 5일간 예보
            location: data.city.name
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

function getCurrentWeather() {
    const url = `https://api.openweathermap.org/data/2.5/weather?` +
                `lat=${MIYAKOJIMA_COORDS.lat}&` +
                `lon=${MIYAKOJIMA_COORDS.lon}&` +
                `appid=${WEATHER_API_KEY}&` +
                `units=metric&lang=kr`;
    
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());
    
    return {
        temperature: Math.round(data.main.temp),
        description: data.weather[0].description,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        icon: data.weather[0].icon
    };
}
```

---

### 5. OpenCage Geocoding (주소 변환)
**용도**: GPS 좌표 ↔ 주소 변환  
**무료 할당량**: 2,500 requests/day  
**가입**: opencagedata.com → 무료 계정 → API Key

#### 5.1 지오코딩 API 연동
```javascript
// geocoding.gs
const OPENCAGE_API_KEY = 'YOUR_OPENCAGE_API_KEY';

function getAddressFromCoords(lat, lng) {
    const url = `https://api.opencagedata.com/geocode/v1/json?` +
                `q=${lat}+${lng}&` +
                `key=${OPENCAGE_API_KEY}&` +
                `language=ja&pretty=1`;
    
    try {
        const response = UrlFetchApp.fetch(url);
        const data = JSON.parse(response.getContentText());
        
        if (data.results.length > 0) {
            return {
                success: true,
                address: data.results[0].formatted,
                prefecture: data.results[0].components.prefecture,
                locality: data.results[0].components.locality
            };
        }
        return { success: false, error: 'No results found' };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

function getCoordsFromAddress(address) {
    const url = `https://api.opencagedata.com/geocode/v1/json?` +
                `q=${encodeURIComponent(address)}&` +
                `key=${OPENCAGE_API_KEY}&` +
                `language=ja&pretty=1`;
    
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());
    
    if (data.results.length > 0) {
        return {
            lat: data.results[0].geometry.lat,
            lng: data.results[0].geometry.lng
        };
    }
    return null;
}
```

---

## 🌐 브라우저 API (무료 내장 기능)

### 1. Geolocation API (GPS 위치)
```javascript
// location.js
class LocationService {
    async getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                }),
                error => reject(error),
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 30000
                }
            );
        });
    }
    
    watchPosition(callback) {
        return navigator.geolocation.watchPosition(
            position => callback({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp
            }),
            error => console.error('위치 추적 오류:', error),
            { enableHighAccuracy: true }
        );
    }
}
```

### 2. Camera API (영수증 OCR)
```javascript
// camera.js
class CameraService {
    async captureReceipt() {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' } // 후면 카메라
            });
            
            video.srcObject = stream;
            video.play();
            
            return new Promise(resolve => {
                video.addEventListener('loadedmetadata', () => {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    
                    const context = canvas.getContext('2d');
                    context.drawImage(video, 0, 0);
                    
                    // 스트림 중지
                    stream.getTracks().forEach(track => track.stop());
                    
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                });
            });
        } catch (error) {
            console.error('카메라 접근 오류:', error);
            throw error;
        }
    }
}
```

### 3. Web Speech API (음성 인식)
```javascript
// speech.js
class SpeechService {
    constructor() {
        this.recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        this.recognition.lang = 'ko-KR';
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
    }
    
    async recognizeSpeech() {
        return new Promise((resolve, reject) => {
            this.recognition.onresult = event => {
                const text = event.results[0][0].transcript;
                resolve(text);
            };
            
            this.recognition.onerror = error => reject(error);
            this.recognition.start();
        });
    }
}
```

---

## 🔧 환경변수 설정

### config.js 파일 생성
```javascript
// config.js - API 키 중앙 관리
const CONFIG = {
    // Google Apps Script
    GAS_BACKEND_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
    
    // Google Sheets
    GOOGLE_SHEET_ID: 'YOUR_GOOGLE_SHEET_ID',
    
    // Weather API
    OPENWEATHER_API_KEY: 'YOUR_OPENWEATHER_KEY',
    
    // Geocoding API
    OPENCAGE_API_KEY: 'YOUR_OPENCAGE_KEY',
    
    // 미야코지마 기본 좌표
    MIYAKOJIMA_CENTER: {
        lat: 24.7392,
        lng: 125.2814
    },
    
    // 예산 설정
    DAILY_BUDGET: 20000, // 2만엔
    
    // 무료 할당량 제한
    RATE_LIMITS: {
        EXCHANGE_RATE: 1500, // per month
        WEATHER: 1000,       // per day
        GEOCODING: 2500      // per day
    }
};

// 전역 접근 가능
window.CONFIG = CONFIG;
```

---

## 📝 API 키 발급 단계별 가이드

### Step 1: Google Apps Script 설정
```
1. script.google.com → "새 프로젝트"
2. 코드 작성 → "배포" → "새 배포"
3. "웹 앱" → "액세스: 모든 사용자"
4. 배포 URL 복사
```

### Step 2: Google Sheets 생성
```
1. sheets.google.com → "빈 스프레드시트"
2. 시트명: "MiyakojimaDB"
3. URL에서 SHEET_ID 확인
   https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit
```

### Step 3: OpenWeatherMap API
```
1. openweathermap.org → "Sign Up"
2. 이메일 인증 완료
3. "API keys" → Default API key 복사
```

### Step 4: OpenCage API
```
1. opencagedata.com → "Sign up for free"
2. 이메일 인증 → Dashboard
3. "Your API Keys" → API key 복사
```

---

## ⚠️ 무료 할당량 모니터링

### 사용량 추적 코드
```javascript
// usage-tracker.js
class UsageTracker {
    constructor() {
        this.usage = JSON.parse(localStorage.getItem('api_usage') || '{}');
    }
    
    trackAPICall(apiName) {
        const today = new Date().toISOString().split('T')[0];
        
        if (!this.usage[today]) {
            this.usage[today] = {};
        }
        
        this.usage[today][apiName] = (this.usage[today][apiName] || 0) + 1;
        localStorage.setItem('api_usage', JSON.stringify(this.usage));
        
        // 할당량 체크
        this.checkLimits(apiName);
    }
    
    checkLimits(apiName) {
        const today = new Date().toISOString().split('T')[0];
        const todayUsage = this.usage[today][apiName] || 0;
        
        const limits = {
            'weather': 900,      // 1000 - 10% 여유
            'geocoding': 2250,   // 2500 - 10% 여유
            'exchange': 45       // 1500/월 ÷ 30일 = 50 - 10% 여유
        };
        
        if (todayUsage > limits[apiName]) {
            console.warn(`${apiName} API 할당량 임박: ${todayUsage}/${limits[apiName]}`);
        }
    }
}
```

---

**✅ 설정 완료 체크리스트**
- [ ] Google Apps Script 프로젝트 생성 및 배포
- [ ] Google Sheets 데이터베이스 생성  
- [ ] OpenWeatherMap API 키 발급
- [ ] OpenCage Geocoding API 키 발급
- [ ] config.js 파일에 모든 키 설정
- [ ] 브라우저 API 권한 확인 (위치, 카메라)
- [ ] 할당량 모니터링 시스템 구축

**🎯 총 소요 시간: 2-3시간**  
**💰 총 비용: $0 (완전 무료)**