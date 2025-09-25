# 미야코지마 여행 앱 Google Apps Script API 명세서

**버전**: 1.0  
**작성일**: 2025-01-25  
**작성자**: Backend Architecture Team  
**목적**: GitHub Pages와 Google Sheets 간 데이터 연동 API

---

## 📋 목차
1. [개요](#1-개요)
2. [아키텍처](#2-아키텍처)
3. [인증 및 보안](#3-인증-및-보안)
4. [공통 규격](#4-공통-규격)
5. [API 엔드포인트](#5-api-엔드포인트)
6. [에러 처리](#6-에러-처리)
7. [성능 최적화](#7-성능-최적화)
8. [구현 예시](#8-구현-예시)

---

## 1. 개요

### 1.1 시스템 구성
```
GitHub Pages (정적 웹) 
    ↓ HTTPS
Google Apps Script (API 레이어)
    ↓ Sheets API
Google Sheets (데이터베이스)
```

### 1.2 기술 스택
- **프론트엔드**: GitHub Pages (HTML/JS)
- **API 서버**: Google Apps Script Web App
- **데이터베이스**: Google Sheets
- **인증**: JWT (JSON Web Tokens)
- **프로토콜**: HTTPS + CORS

### 1.3 제약사항
- Google Apps Script 실행 시간: 6분
- API 호출 제한: 100회/분
- 응답 크기: 최대 50MB
- 동시 사용자: 최대 30명

---

## 2. 아키텍처

### 2.1 API 베이스 URL
```
https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
```

### 2.2 버전 관리
```
/v1/... - 현재 버전
/v2/... - 향후 버전 (예정)
```

### 2.3 CORS 설정
```javascript
// Google Apps Script에서 CORS 헤더 설정
function doPost(e) {
  return ContentService
    .createTextOutput(JSON.stringify(processRequest(e)))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': 'https://username.github.io',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
}
```

---

## 3. 인증 및 보안

### 3.1 인증 방식
- **Type**: Bearer Token (JWT)
- **Header**: `Authorization: Bearer {token}`
- **유효기간**: 24시간
- **갱신**: Refresh Token 사용

### 3.2 JWT 구조
```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "user_id": "T001",
    "email": "fenomeno@example.com",
    "permissions": ["READ_ALL", "WRITE_LIMITED"],
    "iat": 1706151600,
    "exp": 1706238000
  }
}
```

### 3.3 권한 레벨
| 레벨 | 권한 | 설명 |
|------|------|------|
| READ_BASIC | 읽기 기본 | POI, 가이드 정보 조회 |
| READ_ALL | 읽기 전체 | 모든 데이터 조회 |
| WRITE_LIMITED | 쓰기 제한 | 본인 데이터만 수정 |
| WRITE_ALL | 쓰기 전체 | 모든 데이터 수정 |
| ADMIN | 관리자 | 시스템 관리 권한 |

---

## 4. 공통 규격

### 4.1 요청 헤더
```http
Content-Type: application/json
Authorization: Bearer {jwt_token}
X-Request-ID: {unique_request_id}
X-Client-Version: 1.0
```

### 4.2 응답 형식
```json
{
  "success": true,
  "data": {...},
  "meta": {
    "timestamp": "2025-01-25T10:30:00Z",
    "request_id": "req_123456",
    "cache_hit": false,
    "execution_time_ms": 145
  }
}
```

### 4.3 에러 응답
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "필수 필드가 누락되었습니다",
    "details": {
      "field": "poi_id",
      "reason": "required"
    }
  },
  "meta": {...}
}
```

---

## 5. API 엔드포인트

### 5.1 인증 관련

#### 5.1.1 로그인
**POST** `/v1/auth/login`

**Request Body:**
```json
{
  "email": "fenomeno@example.com",
  "password": "encrypted_password"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 86400,
    "user": {
      "user_id": "T001",
      "name": "김은태",
      "email": "fenomeno@example.com",
      "permissions": ["READ_ALL", "WRITE_LIMITED"]
    }
  }
}
```

#### 5.1.2 토큰 갱신
**POST** `/v1/auth/refresh`

**Request Body:**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 86400
  }
}
```

#### 5.1.3 로그아웃
**POST** `/v1/auth/logout`

**Request Header:**
```http
Authorization: Bearer {access_token}
```

**Response:**
```json
{
  "success": true,
  "message": "로그아웃 되었습니다"
}
```

---

### 5.2 POI (관심지점) 관련

#### 5.2.1 POI 목록 조회
**GET** `/v1/pois`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---------|------|------|------|------|
| category | string | N | 카테고리 필터 | "자연·전망" |
| island | string | N | 섬 필터 | "시모지시마" |
| must_visit | boolean | N | 필수 방문지만 | true |
| page | integer | N | 페이지 번호 | 1 |
| limit | integer | N | 페이지당 항목 수 | 20 |
| sort | string | N | 정렬 기준 | "rating_desc" |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "poi_id": "POI001",
        "name_ko": "요나하 마에하마 해변",
        "name_local": "Yonaha Maehama Beach",
        "category_primary": "자연·전망",
        "island": "시모지시마",
        "lat": 24.7349726,
        "lng": 125.2629745,
        "rating": 4.5,
        "must_visit": true,
        "opening_hours": "24시간",
        "price_level": "무료"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 127,
      "total_pages": 7
    }
  }
}
```

#### 5.2.2 POI 상세 조회
**GET** `/v1/pois/{poi_id}`

**Response:**
```json
{
  "success": true,
  "data": {
    "poi_id": "POI001",
    "name_ko": "요나하 마에하마 해변",
    "name_local": "Yonaha Maehama Beach",
    "category_primary": "자연·전망",
    "categories_all": ["해변", "일몰 명소", "수영"],
    "island": "시모지시마",
    "lat": 24.7349726,
    "lng": 125.2629745,
    "address": "Yonaha, Shimoji, Miyakojima",
    "phone": "0980-76-2177",
    "website": "",
    "opening_hours": "24시간",
    "price_level": "무료",
    "parking_available": true,
    "amenities": ["샤워시설", "탈의실", "파라솔 렌탈"],
    "visit_duration": "2-3시간",
    "rating": 4.5,
    "reviews_count": 234,
    "must_visit": true,
    "notes": "동양 최고의 해변, 일몰 명소"
  }
}
```

---

### 5.3 일정 관련

#### 5.3.1 일정 조회
**GET** `/v1/itinerary`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---------|------|------|------|------|
| date | string | N | 특정 날짜 | "2025-09-27" |
| day_id | string | N | 일차 ID | "D01" |

**Response:**
```json
{
  "success": true,
  "data": {
    "days": [
      {
        "day_id": "D01",
        "date": "2025-09-27",
        "day_number": 1,
        "theme": "도착 & 휴식",
        "accommodation": {
          "name": "힐튼 미야코지마",
          "check_in": "15:00",
          "check_out": "11:00"
        },
        "details": [
          {
            "detail_id": "D01-001",
            "sequence": 1,
            "time_start": "09:00",
            "time_end": "10:30",
            "poi": {
              "poi_id": "POI001",
              "name_ko": "요나하 마에하마 해변"
            },
            "activity_type": "관광",
            "transportation": "렌트카",
            "distance_km": 15.5,
            "cost_jpy": 0,
            "status": "예정"
          }
        ]
      }
    ]
  }
}
```

#### 5.3.2 일정 추가
**POST** `/v1/itinerary/details`

**Request Body:**
```json
{
  "day_id": "D01",
  "time_start": "14:00",
  "time_end": "15:30",
  "poi_id": "POI002",
  "activity_type": "관광",
  "transportation": "렌트카",
  "notes": "사진 촬영"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "detail_id": "D01-005",
    "sequence": 5,
    "created": true
  }
}
```

#### 5.3.3 일정 수정
**PUT** `/v1/itinerary/details/{detail_id}`

**Request Body:**
```json
{
  "time_start": "14:30",
  "time_end": "16:00",
  "status": "완료",
  "actual_cost_jpy": 1500
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "detail_id": "D01-005",
    "updated": true
  }
}
```

#### 5.3.4 일정 삭제
**DELETE** `/v1/itinerary/details/{detail_id}`

**Response:**
```json
{
  "success": true,
  "data": {
    "detail_id": "D01-005",
    "deleted": true
  }
}
```

---

### 5.4 예산 관련

#### 5.4.1 예산 현황 조회
**GET** `/v1/budget/summary`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---------|------|------|------|------|
| date | string | N | 특정 날짜 | "2025-09-27" |
| category | string | N | 카테고리 | "식사" |

**Response:**
```json
{
  "success": true,
  "data": {
    "total_budget": 200000,
    "total_spent": 45000,
    "remaining": 155000,
    "by_category": [
      {
        "category_id": "CAT001",
        "category_name": "식사",
        "spent": 15000,
        "limit": 50000,
        "percentage": 30
      }
    ],
    "by_day": [
      {
        "day_id": "D01",
        "date": "2025-09-27",
        "spent": 12000
      }
    ],
    "recent_expenses": [
      {
        "expense_id": "EXP001",
        "timestamp": "2025-09-27T12:30:00Z",
        "category": "식사",
        "amount_jpy": 3500,
        "description": "점심 식사"
      }
    ]
  }
}
```

#### 5.4.2 지출 기록 추가
**POST** `/v1/budget/expenses`

**Request Body:**
```json
{
  "day_id": "D01",
  "category_id": "CAT001",
  "poi_id": "POI015",
  "amount_jpy": 3500,
  "payment_method": "현금",
  "description": "점심 식사",
  "tags": ["맛집", "추천"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "expense_id": "EXP042",
    "created": true,
    "current_total": 48500
  }
}
```

#### 5.4.3 지출 기록 수정
**PUT** `/v1/budget/expenses/{expense_id}`

**Request Body:**
```json
{
  "amount_jpy": 3800,
  "description": "점심 식사 (팁 포함)"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "expense_id": "EXP042",
    "updated": true
  }
}
```

#### 5.4.4 지출 기록 삭제
**DELETE** `/v1/budget/expenses/{expense_id}`

**Response:**
```json
{
  "success": true,
  "data": {
    "expense_id": "EXP042",
    "deleted": true,
    "current_total": 45000
  }
}
```

---

### 5.5 활동 가이드 관련

#### 5.5.1 활동 목록 조회
**GET** `/v1/activities`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---------|------|------|------|------|
| category | string | N | 카테고리 | "해양 액티비티" |
| max_price | integer | N | 최대 가격 | 20000 |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "activity_id": "ACT001",
        "name_ko": "야비지 보트 투어",
        "category": "해양 액티비티",
        "duration_hours": 4,
        "price_adult_jpy": 14000,
        "reservation_required": true,
        "provider_name": "미야코 마린",
        "provider_phone": "0980-76-3000"
      }
    ]
  }
}
```

---

### 5.6 음식점 가이드 관련

#### 5.6.1 음식점 목록 조회
**GET** `/v1/restaurants`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---------|------|------|------|------|
| cuisine | string | N | 음식 종류 | "오키나와 소바" |
| price_max | integer | N | 최대 가격 | 2000 |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "restaurant_id": "REST001",
        "name_ko": "코지 소바",
        "cuisine_type": "오키나와 소바",
        "price_range": "500-1500",
        "signature_menu": "소키 소바",
        "business_hours": "11:00-21:00",
        "google_rating": 4.2
      }
    ]
  }
}
```

---

### 5.7 분석 관련

#### 5.7.1 일별 예산 집계
**GET** `/v1/analytics/daily-budget`

**Response:**
```json
{
  "success": true,
  "data": {
    "daily_summary": [
      {
        "date": "2025-09-27",
        "day_id": "D01",
        "total_spent": 45000,
        "meal": 15000,
        "transport": 5000,
        "activity": 20000,
        "shopping": 5000
      }
    ],
    "total": 180000,
    "average_per_day": 45000
  }
}
```

#### 5.7.2 카테고리별 지출 분석
**GET** `/v1/analytics/category-spending`

**Response:**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "category": "식사",
        "total": 60000,
        "percentage": 33.3,
        "count": 15,
        "average": 4000
      }
    ],
    "top_expenses": [
      {
        "description": "야비지 보트 투어",
        "amount": 28000,
        "category": "활동"
      }
    ]
  }
}
```

#### 5.7.3 POI 방문 통계
**GET** `/v1/analytics/poi-visits`

**Response:**
```json
{
  "success": true,
  "data": {
    "visited_count": 12,
    "planned_count": 25,
    "completion_rate": 48,
    "by_category": [
      {
        "category": "해변",
        "visited": 3,
        "total": 5
      }
    ],
    "favorite_pois": [
      {
        "poi_id": "POI001",
        "name": "요나하 마에하마 해변",
        "visits": 2
      }
    ]
  }
}
```

---

## 6. 에러 처리

### 6.1 에러 코드

| 코드 | HTTP Status | 설명 | 대응 방법 |
|------|------------|------|-----------|
| AUTH_REQUIRED | 401 | 인증 필요 | 로그인 수행 |
| AUTH_EXPIRED | 401 | 토큰 만료 | 토큰 갱신 |
| AUTH_INVALID | 401 | 유효하지 않은 토큰 | 재로그인 |
| PERMISSION_DENIED | 403 | 권한 없음 | 권한 확인 |
| NOT_FOUND | 404 | 리소스 없음 | ID 확인 |
| VALIDATION_ERROR | 400 | 입력값 오류 | 요청 데이터 확인 |
| DUPLICATE_ENTRY | 409 | 중복 데이터 | 중복 확인 |
| RATE_LIMIT_EXCEEDED | 429 | 요청 제한 초과 | 재시도 대기 |
| SERVER_ERROR | 500 | 서버 오류 | 재시도 |
| SERVICE_UNAVAILABLE | 503 | 서비스 일시 중단 | 잠시 후 재시도 |

### 6.2 에러 응답 예시
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "요청 데이터가 유효하지 않습니다",
    "details": {
      "fields": [
        {
          "field": "amount_jpy",
          "reason": "must be positive number",
          "value": -100
        }
      ]
    }
  },
  "meta": {
    "timestamp": "2025-01-25T10:30:00Z",
    "request_id": "req_123456"
  }
}
```

### 6.3 재시도 전략
```javascript
// 클라이언트 재시도 로직
async function apiCallWithRetry(url, options, maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        // Rate limit - 지수 백오프
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      
      if (response.status === 503) {
        // Service unavailable - 선형 백오프
        await sleep((i + 1) * 2000);
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  
  throw lastError;
}
```

---

## 7. 성능 최적화

### 7.1 캐싱 전략

#### 7.1.1 캐시 레벨
```
Level 1: Memory Cache (5분)
  ↓
Level 2: PropertiesService (30분)
  ↓
Level 3: Google Sheets (원본)
```

#### 7.1.2 캐시 키 패턴
```
cache:pois:all           - 전체 POI 목록
cache:pois:{poi_id}      - 개별 POI
cache:budget:summary     - 예산 요약
cache:itinerary:{day_id} - 일별 일정
```

#### 7.1.3 캐시 무효화
```javascript
// 데이터 변경시 관련 캐시 삭제
function invalidateCache(pattern) {
  const properties = PropertiesService.getScriptProperties();
  const keys = properties.getKeys();
  
  keys.forEach(key => {
    if (key.startsWith(pattern)) {
      properties.deleteProperty(key);
    }
  });
}
```

### 7.2 배치 처리
```javascript
// 여러 시트 동시 읽기
function batchRead(sheetNames) {
  const sheets = sheetNames.map(name => 
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
  );
  
  return sheets.map(sheet => 
    sheet.getDataRange().getValues()
  );
}
```

### 7.3 인덱싱
```javascript
// 해시맵 기반 빠른 검색
function buildIndex(data, keyField) {
  const index = {};
  data.forEach(row => {
    index[row[keyField]] = row;
  });
  return index;
}
```

---

## 8. 구현 예시

### 8.1 Google Apps Script 메인 핸들러
```javascript
// Code.gs
function doPost(e) {
  const request = JSON.parse(e.postData.contents);
  const path = request.path;
  const method = request.method;
  const headers = request.headers || {};
  const body = request.body;
  
  // CORS 설정
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    // 인증 체크
    if (!isPublicEndpoint(path)) {
      const token = headers.Authorization?.replace('Bearer ', '');
      if (!verifyToken(token)) {
        throw new UnauthorizedError('Invalid token');
      }
    }
    
    // 라우팅
    const response = route(method, path, body, headers);
    
    return output.setContent(JSON.stringify({
      success: true,
      data: response,
      meta: {
        timestamp: new Date().toISOString(),
        request_id: Utilities.getUuid(),
        cache_hit: response._cacheHit || false,
        execution_time_ms: Date.now() - startTime
      }
    }));
    
  } catch (error) {
    return output.setContent(JSON.stringify({
      success: false,
      error: {
        code: error.code || 'SERVER_ERROR',
        message: error.message,
        details: error.details
      }
    }));
  }
}

// 라우터
function route(method, path, body, headers) {
  const routes = {
    'POST /v1/auth/login': () => authController.login(body),
    'POST /v1/auth/refresh': () => authController.refresh(body),
    'GET /v1/pois': () => poiController.list(body),
    'GET /v1/pois/:id': (params) => poiController.get(params.id),
    'GET /v1/itinerary': () => itineraryController.list(body),
    'POST /v1/itinerary/details': () => itineraryController.create(body),
    'PUT /v1/itinerary/details/:id': (params) => itineraryController.update(params.id, body),
    'DELETE /v1/itinerary/details/:id': (params) => itineraryController.delete(params.id),
    'GET /v1/budget/summary': () => budgetController.summary(body),
    'POST /v1/budget/expenses': () => budgetController.create(body),
    'GET /v1/analytics/daily-budget': () => analyticsController.dailyBudget(),
    'GET /v1/analytics/category-spending': () => analyticsController.categorySpending(),
    'GET /v1/analytics/poi-visits': () => analyticsController.poiVisits()
  };
  
  const routeKey = `${method} ${path}`;
  const handler = routes[routeKey];
  
  if (!handler) {
    throw new NotFoundError('Endpoint not found');
  }
  
  return handler();
}
```

### 8.2 JWT 인증 서비스
```javascript
// AuthService.gs
class AuthService {
  constructor() {
    this.SECRET = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
    this.EXPIRY = 24 * 60 * 60 * 1000; // 24시간
  }
  
  generateToken(userId, email, permissions) {
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    const payload = {
      user_id: userId,
      email: email,
      permissions: permissions,
      iat: Date.now(),
      exp: Date.now() + this.EXPIRY
    };
    
    const base64Header = Utilities.base64Encode(JSON.stringify(header));
    const base64Payload = Utilities.base64Encode(JSON.stringify(payload));
    const signature = this.sign(`${base64Header}.${base64Payload}`);
    
    return `${base64Header}.${base64Payload}.${signature}`;
  }
  
  verifyToken(token) {
    if (!token) return false;
    
    try {
      const [header, payload, signature] = token.split('.');
      const expectedSignature = this.sign(`${header}.${payload}`);
      
      if (signature !== expectedSignature) {
        return false;
      }
      
      const data = JSON.parse(Utilities.base64Decode(payload));
      
      if (data.exp < Date.now()) {
        return false;
      }
      
      return data;
    } catch (error) {
      return false;
    }
  }
  
  sign(data) {
    const signature = Utilities.computeHmacSignature(
      Utilities.MacAlgorithm.HMAC_SHA_256,
      data,
      this.SECRET
    );
    return Utilities.base64Encode(signature);
  }
  
  refreshToken(oldToken) {
    const data = this.verifyToken(oldToken);
    if (!data) throw new UnauthorizedError('Invalid token');
    
    return this.generateToken(
      data.user_id,
      data.email,
      data.permissions
    );
  }
}
```

### 8.3 캐싱 시스템
```javascript
// CacheService.gs
class CacheManager {
  constructor() {
    this.memCache = {};
    this.properties = PropertiesService.getScriptProperties();
  }
  
  get(key, ttl = 300000) { // 기본 5분
    // Level 1: Memory Cache
    if (this.memCache[key]) {
      const cached = this.memCache[key];
      if (Date.now() - cached.timestamp < ttl) {
        return { data: cached.data, _cacheHit: true };
      }
    }
    
    // Level 2: Properties Service
    const propValue = this.properties.getProperty(`cache:${key}`);
    if (propValue) {
      const cached = JSON.parse(propValue);
      if (Date.now() - cached.timestamp < ttl * 6) { // Properties는 6배 더 오래
        this.memCache[key] = cached; // 메모리 캐시 갱신
        return { data: cached.data, _cacheHit: true };
      }
    }
    
    return null;
  }
  
  set(key, data) {
    const cacheData = {
      data: data,
      timestamp: Date.now()
    };
    
    // Memory Cache
    this.memCache[key] = cacheData;
    
    // Properties Service (크기 제한 체크)
    try {
      const serialized = JSON.stringify(cacheData);
      if (serialized.length < 9000) { // Properties 제한
        this.properties.setProperty(`cache:${key}`, serialized);
      }
    } catch (e) {
      // 크기 초과시 Properties 캐시 스킵
    }
  }
  
  invalidate(pattern) {
    // Memory Cache
    Object.keys(this.memCache).forEach(key => {
      if (key.includes(pattern)) {
        delete this.memCache[key];
      }
    });
    
    // Properties Service
    const keys = this.properties.getKeys();
    keys.forEach(key => {
      if (key.includes(pattern)) {
        this.properties.deleteProperty(key);
      }
    });
  }
}
```

### 8.4 컨트롤러 예시
```javascript
// POIController.gs
class POIController {
  constructor() {
    this.sheet = SpreadsheetApp.getActiveSpreadsheet()
                               .getSheetByName('관심지점');
    this.cache = new CacheManager();
  }
  
  list(params) {
    const cacheKey = `pois:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    // 데이터 읽기
    const data = this.sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);
    
    // 필터링
    let filtered = rows;
    if (params.category) {
      const categoryIndex = headers.indexOf('category_primary');
      filtered = filtered.filter(row => 
        row[categoryIndex] === params.category
      );
    }
    
    if (params.island) {
      const islandIndex = headers.indexOf('island');
      filtered = filtered.filter(row => 
        row[islandIndex] === params.island
      );
    }
    
    if (params.must_visit !== undefined) {
      const mustVisitIndex = headers.indexOf('must_visit');
      filtered = filtered.filter(row => 
        row[mustVisitIndex] === params.must_visit
      );
    }
    
    // 페이징
    const page = params.page || 1;
    const limit = params.limit || 20;
    const start = (page - 1) * limit;
    const end = start + limit;
    const paged = filtered.slice(start, end);
    
    // 응답 생성
    const result = {
      items: paged.map(row => this.rowToObject(row, headers)),
      pagination: {
        page: page,
        limit: limit,
        total: filtered.length,
        total_pages: Math.ceil(filtered.length / limit)
      }
    };
    
    this.cache.set(cacheKey, result);
    return result;
  }
  
  get(poiId) {
    const cacheKey = `poi:${poiId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    const data = this.sheet.getDataRange().getValues();
    const headers = data[0];
    const poiIdIndex = headers.indexOf('poi_id');
    
    const row = data.find(r => r[poiIdIndex] === poiId);
    if (!row) {
      throw new NotFoundError('POI not found');
    }
    
    const result = this.rowToObject(row, headers);
    this.cache.set(cacheKey, result);
    return result;
  }
  
  rowToObject(row, headers) {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  }
}
```

### 8.5 클라이언트 라이브러리
```javascript
// miyako-api-client.js
class MiyakoAPIClient {
  constructor(baseUrl, version = 'v1') {
    this.baseUrl = baseUrl;
    this.version = version;
    this.token = localStorage.getItem('miyako_token');
    this.refreshToken = localStorage.getItem('miyako_refresh_token');
  }
  
  async request(method, path, body = null) {
    const url = `${this.baseUrl}`;
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        path: `/${this.version}${path}`,
        method: method,
        headers: {
          Authorization: this.token ? `Bearer ${this.token}` : undefined,
          'X-Request-ID': this.generateRequestId()
        },
        body: body
      })
    };
    
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (!data.success) {
        // 토큰 만료시 자동 갱신
        if (data.error.code === 'AUTH_EXPIRED' && this.refreshToken) {
          await this.refreshAccessToken();
          return this.request(method, path, body);
        }
        
        throw new APIError(data.error);
      }
      
      return data.data;
      
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
  
  async login(email, password) {
    const result = await this.request('POST', '/auth/login', {
      email: email,
      password: password
    });
    
    this.token = result.access_token;
    this.refreshToken = result.refresh_token;
    
    localStorage.setItem('miyako_token', this.token);
    localStorage.setItem('miyako_refresh_token', this.refreshToken);
    
    return result;
  }
  
  async refreshAccessToken() {
    const result = await this.request('POST', '/auth/refresh', {
      refresh_token: this.refreshToken
    });
    
    this.token = result.access_token;
    localStorage.setItem('miyako_token', this.token);
    
    return result;
  }
  
  async getPOIs(params = {}) {
    return this.request('GET', '/pois', params);
  }
  
  async getPOI(poiId) {
    return this.request('GET', `/pois/${poiId}`);
  }
  
  async getItinerary(params = {}) {
    return this.request('GET', '/itinerary', params);
  }
  
  async addItineraryDetail(detail) {
    return this.request('POST', '/itinerary/details', detail);
  }
  
  async updateItineraryDetail(detailId, updates) {
    return this.request('PUT', `/itinerary/details/${detailId}`, updates);
  }
  
  async deleteItineraryDetail(detailId) {
    return this.request('DELETE', `/itinerary/details/${detailId}`);
  }
  
  async getBudgetSummary(params = {}) {
    return this.request('GET', '/budget/summary', params);
  }
  
  async addExpense(expense) {
    return this.request('POST', '/budget/expenses', expense);
  }
  
  async updateExpense(expenseId, updates) {
    return this.request('PUT', `/budget/expenses/${expenseId}`, updates);
  }
  
  async deleteExpense(expenseId) {
    return this.request('DELETE', `/budget/expenses/${expenseId}`);
  }
  
  async getDailyBudget() {
    return this.request('GET', '/analytics/daily-budget');
  }
  
  async getCategorySpending() {
    return this.request('GET', '/analytics/category-spending');
  }
  
  async getPOIVisits() {
    return this.request('GET', '/analytics/poi-visits');
  }
  
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 사용 예시
const api = new MiyakoAPIClient('https://script.google.com/macros/s/DEPLOYMENT_ID/exec');

// 로그인
await api.login('fenomeno@example.com', 'password');

// POI 목록 조회
const pois = await api.getPOIs({ 
  category: '해변', 
  must_visit: true 
});

// 일정 추가
const detail = await api.addItineraryDetail({
  day_id: 'D01',
  time_start: '14:00',
  time_end: '15:30',
  poi_id: 'POI002',
  activity_type: '관광'
});

// 지출 기록
const expense = await api.addExpense({
  day_id: 'D01',
  category_id: 'CAT001',
  amount_jpy: 3500,
  description: '점심 식사'
});
```

---

## 부록 A: Google Apps Script 제약사항 대응

### A.1 실행 시간 제한 (6분)
```javascript
// 배치 처리시 시간 체크
function batchProcess(items) {
  const startTime = Date.now();
  const MAX_RUNTIME = 5.5 * 60 * 1000; // 5.5분
  
  const processed = [];
  for (const item of items) {
    if (Date.now() - startTime > MAX_RUNTIME) {
      // 남은 항목은 다음 실행에
      PropertiesService.getScriptProperties()
                       .setProperty('pending', JSON.stringify(items.slice(processed.length)));
      break;
    }
    
    processItem(item);
    processed.push(item);
  }
  
  return processed;
}
```

### A.2 URL Fetch 제한 (100회/분)
```javascript
// 요청 제한 관리
class RateLimiter {
  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }
  
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => 
      now - time < this.windowMs
    );
    
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  }
  
  async waitForSlot() {
    while (!this.canMakeRequest()) {
      Utilities.sleep(1000);
    }
  }
}
```

### A.3 Properties Service 제한 (9KB/값)
```javascript
// 큰 데이터 분할 저장
function setLargeProperty(key, value) {
  const serialized = JSON.stringify(value);
  const chunks = [];
  const chunkSize = 8000; // 안전 마진
  
  for (let i = 0; i < serialized.length; i += chunkSize) {
    chunks.push(serialized.slice(i, i + chunkSize));
  }
  
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(`${key}:count`, chunks.length);
  
  chunks.forEach((chunk, index) => {
    properties.setProperty(`${key}:${index}`, chunk);
  });
}

function getLargeProperty(key) {
  const properties = PropertiesService.getScriptProperties();
  const count = parseInt(properties.getProperty(`${key}:count`) || '0');
  
  if (count === 0) return null;
  
  let serialized = '';
  for (let i = 0; i < count; i++) {
    serialized += properties.getProperty(`${key}:${i}`);
  }
  
  return JSON.parse(serialized);
}
```

---

## 부록 B: 보안 Best Practices

### B.1 API 키 관리
```javascript
// Script Properties에 안전하게 저장
PropertiesService.getScriptProperties().setProperty('API_KEY', 'your-secret-key');

// 사용시
const apiKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
```

### B.2 입력 검증
```javascript
function validateInput(data, schema) {
  const errors = [];
  
  // 필수 필드 체크
  schema.required?.forEach(field => {
    if (!data[field]) {
      errors.push({
        field: field,
        reason: 'required'
      });
    }
  });
  
  // 타입 체크
  Object.entries(schema.properties || {}).forEach(([field, rules]) => {
    if (data[field] !== undefined) {
      if (rules.type === 'number' && typeof data[field] !== 'number') {
        errors.push({
          field: field,
          reason: 'must be number',
          value: data[field]
        });
      }
      
      if (rules.min !== undefined && data[field] < rules.min) {
        errors.push({
          field: field,
          reason: `must be >= ${rules.min}`,
          value: data[field]
        });
      }
    }
  });
  
  if (errors.length > 0) {
    throw new ValidationError('Input validation failed', errors);
  }
}
```

### B.3 SQL Injection 방지
```javascript
// 파라미터화된 쿼리 사용
function safeQuery(sheet, column, value) {
  // 직접 문자열 연결 금지
  // ❌ BAD: "SELECT * WHERE " + column + " = '" + value + "'"
  
  // ✅ GOOD: 값 이스케이프
  const escapedValue = value.replace(/'/g, "''");
  const data = sheet.getDataRange().getValues();
  const columnIndex = data[0].indexOf(column);
  
  return data.filter(row => row[columnIndex] === value);
}
```

---

**문서 끝**

이 API 명세서는 미야코지마 여행 앱이 GitHub Pages에서 Google Sheets의 데이터를 안전하고 효율적으로 읽고 쓸 수 있도록 설계된 완전한 RESTful API입니다.