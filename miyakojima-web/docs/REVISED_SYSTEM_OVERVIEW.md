# 미야코지마 여행 웹 플랫폼 - 수정된 시스템 개요
# Miyakojima Travel Web Platform - Revised System Overview

**프로젝트 목적**: ChatGPT Projects 시스템을 보완하는 **무료 웹 플랫폼** 구축  
**핵심 원칙**: 100% 무료 서비스, ChatGPT가 못하는 기능만 구현  
**여행 정보**: 김은태(AB형) & 정유민, 2025.9.27~10.1 (4박5일), 현지 유심  

---

## 1. 핵심 구현 기능 (필수)

### 1.1 실시간 예산 추적 💰
**ChatGPT가 못하는 것**: 실시간 데이터 저장, 자동 환율 계산, 지출 알림
```
구현 방안:
- Google Sheets: 무료 데이터베이스
- Apps Script: 무료 서버리스 백엔드  
- 환율 API: exchangerate-api.com (무료)
- 카메라 OCR: Tesseract.js (브라우저 내장)
```

**주요 기능**:
- 지출 즉시 입력 → Google Sheets 자동 저장
- 일일 예산 2만엔 기준 실시간 알림
- 카테고리별 지출 현황 (식비/교통/쇼핑/액티비티)
- 영수증 카메라 촬영 → OCR → 자동 금액 추출

### 1.2 스마트 일정 관리 📅
**ChatGPT가 못하는 것**: GPS 위치 추적, 실시간 이동시간 계산
```
구현 방안:
- 브라우저 GPS API: 무료 내장 기능
- Google Maps API: 무료 할당량 활용
- 위치 기반 자동 추천
```

**주요 기능**:
- 현재 위치 → 다음 목적지 자동 이동시간 계산
- "girlfriend_surprises" 태그 기반 서프라이즈 장소 추천
- 혼잡도 피해 일정 자동 조정 ("avoid: crowded_places")
- 포토스팟 우선 필터링

### 1.3 POI 개인화 추천 🎯
**ChatGPT가 못하는 것**: 실시간 위치 기반 필터링, 개인 취향 학습
```
구현 방안:
- 175개 POI 데이터 활용
- 브라우저 localStorage: 개인 선호도 학습
- 실시간 거리/시간 계산
```

**주요 기능**:
- 현재 위치 기준 2km 내 POI 자동 표시
- "luxury_relaxed" 스타일 기반 필터링
- 방문한 장소 자동 체크, 리뷰 저장
- 동선 최적화 제안

---

## 2. 무료 기술 스택

### 2.1 프론트엔드 (GitHub Pages)
```
HTML5 + Vanilla CSS + Vanilla JavaScript
- 라이브러리 의존성 최소화
- PWA 지원 (Service Worker)
- 오프라인 기능 지원
- 모바일 최적화
```

### 2.2 백엔드 (Google Apps Script)
```javascript
// gas-backend.gs
function doPost(e) {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById('SHEET_ID');
    
    if (data.action === 'add_expense') {
        const budgetSheet = sheet.getSheetByName('Budget');
        budgetSheet.appendRow([
            new Date(),
            data.amount,
            data.category,
            data.description
        ]);
    }
    
    return ContentService
        .createTextOutput(JSON.stringify({success: true}))
        .setMimeType(ContentService.MimeType.JSON);
}
```

### 2.3 데이터베이스 (Google Sheets)
```
시트 구조:
- Budget: 지출 내역 (날짜, 금액, 카테고리, 메모)  
- Itinerary: 일정 관리 (날짜, 시간, 장소, 상태)
- POI_Reviews: 장소 리뷰 (평점, 사진, 메모)
- Live_Status: 실시간 상태 (위치, 예산 현황)
```

### 2.4 무료 외부 API
```
✅ 환율: exchangerate-api.com (무료)
✅ 날씨: OpenWeatherMap (무료 5일 예보)
✅ 지오코딩: OpenCage (무료 2500회/일)  
✅ 지도: Leaflet.js (오픈소스)
```

---

## 3. 파일 구조

```
miyakojima-web/
├── index.html (메인 페이지)
├── css/
│   ├── main.css
│   └── mobile.css
├── js/
│   ├── app.js (메인 앱)
│   ├── budget.js (예산 추적)
│   ├── itinerary.js (일정 관리)  
│   └── poi.js (장소 관리)
├── data/
│   ├── miyakojima_pois.json (175개 POI)
│   └── traveler_profile.json
├── sw.js (Service Worker)
└── manifest.json (PWA 설정)
```

---

## 4. 기존 ChatGPT Projects와의 연동

### 4.1 역할 분담
**ChatGPT Projects**: 대화형 AI 어시스턴트
- 음성 통역 (Voice Mode)
- 여행 상담 및 계획
- 복잡한 추천 로직

**웹 플랫폼**: 실시간 데이터 & GUI
- 예산 실시간 추적
- GPS 기반 위치 서비스
- 데이터 저장 및 동기화

### 4.2 데이터 동기화 전략
```javascript
// ChatGPT → 웹 (수동 복사)
사용자가 ChatGPT에서 계획 변경 → 웹에서 일정 수정

// 웹 → ChatGPT (컨텍스트 제공)
"현재 예산 현황: 식비 65% 사용, 교통비 40% 사용"
"현재 위치: 이라부대교, 다음 목적지까지 15분"
```

---

## 5. 개발 우선순위

### Phase 1: 기본 프레임워크 (1주)
1. main.html 대시보드 구조
2. Google Sheets 연동 테스트
3. 기본 예산 추적 기능

### Phase 2: 핵심 기능 (1주)  
1. 실시간 예산 알림
2. GPS 위치 추적
3. POI 거리 계산

### Phase 3: 고급 기능 (1주)
1. OCR 영수증 인식
2. PWA 오프라인 기능
3. 개인화 추천 알고리즘

**총 개발 기간**: 3주 (여행 전 완성 목표)

---

**🎯 핵심 원칙 재확인**
- ✅ 100% 무료 서비스만 사용
- ✅ ChatGPT Projects 보완 기능에 집중  
- ✅ 번역/응급상황 기능 제외 (ChatGPT로 충분)
- ✅ 실용적이고 즉시 사용 가능한 기능 우선

이제 이 방향으로 상세 설계를 진행하겠습니다.