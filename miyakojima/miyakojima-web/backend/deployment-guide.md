# Google Apps Script 백엔드 배포 가이드

## 개요
미야코지마 여행 가이드 웹앱의 100% 무료 백엔드를 Google Apps Script와 Google Sheets를 사용하여 구축하는 방법입니다.

## 1. Google 스프레드시트 준비

### 1.1 메인 스프레드시트 생성
1. Google Drive에서 새 스프레드시트 생성
2. 스프레드시트 이름을 "미야코지마-여행-데이터"로 설정
3. 스프레드시트 ID를 복사 (URL에서 `/d/` 와 `/edit` 사이의 문자열)

### 1.2 필요한 시트 생성
다음 시트들을 생성하세요:
- `Budget` - 예산 관리 데이터
- `Itinerary` - 일정 관리 데이터  
- `POI_UserData` - POI 사용자 데이터
- `UserProfiles` - 사용자 프로필

## 2. Google Apps Script 프로젝트 설정

### 2.1 새 프로젝트 생성
1. [script.google.com](https://script.google.com) 접속
2. "새 프로젝트" 클릭
3. 프로젝트 이름을 "미야코지마-여행-API"로 설정

### 2.2 코드 배포
1. `Code.gs` 파일을 열고 기존 코드 삭제
2. `google-apps-script.js` 파일의 내용을 복사하여 붙여넣기
3. 코드 상단의 `SPREADSHEET_CONFIG.MASTER_SHEET_ID`를 실제 스프레드시트 ID로 수정

```javascript
const SPREADSHEET_CONFIG = {
  MASTER_SHEET_ID: '실제_스프레드시트_ID_입력', // 여기를 수정하세요
  // ... 나머지는 그대로 유지
};
```

### 2.3 API 키 설정 (선택사항)
외부 API 사용을 위한 키 설정:

1. 스크립트 편집기에서 ⚙️ 설정 클릭
2. "스크립트 속성" 섹션에서 다음 속성 추가:
   - `WEATHER_API_KEY`: OpenWeatherMap API 키
   - `GEOCODING_API_KEY`: OpenCage Geocoding API 키
   - `EXCHANGE_RATE_API_KEY`: Exchange Rate API 키

## 3. 웹앱 배포

### 3.1 배포 설정
1. 스크립트 편집기 우상단의 "배포" 버튼 클릭
2. "새 배포" 선택
3. 설정값:
   - **유형**: 웹앱
   - **설명**: "미야코지마 여행 가이드 API v1.0"
   - **실행자**: "나"
   - **액세스 권한**: "모든 사용자"

### 3.2 권한 승인
1. "배포" 버튼 클릭
2. Google 계정으로 로그인
3. "고급" → "미야코지마-여행-API로 이동(안전하지 않음)" 클릭
4. 필요한 권한 승인

### 3.3 웹앱 URL 확인
배포 완료 후 나타나는 웹앱 URL을 복사하세요.
형식: `https://script.google.com/macros/s/{SCRIPT_ID}/exec`

## 4. 프론트엔드 연결

### 4.1 API 엔드포인트 설정
`miyakojima-web/js/config.js` 파일에서 백엔드 URL 설정:

```javascript
const CONFIG = {
  API_ENDPOINTS: {
    BACKEND: 'https://script.google.com/macros/s/{SCRIPT_ID}/exec', // 실제 URL로 변경
    // ... 나머지 설정
  }
};
```

### 4.2 CORS 처리
Google Apps Script는 자동으로 CORS를 처리하므로 추가 설정이 불필요합니다.

## 5. 테스트 및 확인

### 5.1 API 동작 확인
1. 웹앱 URL을 브라우저에서 직접 접속
2. "미야코지마 여행 가이드 백엔드" 페이지가 표시되는지 확인

### 5.2 기능 테스트
다음 API 엔드포인트들을 테스트하세요:

```bash
# 예산 데이터 저장 테스트
curl -X POST "https://script.google.com/macros/s/{SCRIPT_ID}/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "save_budget",
    "data": {
      "expenses": [{
        "amount": 1000,
        "category": "meals",
        "description": "테스트 지출"
      }],
      "userId": "test_user"
    }
  }'

# 예산 데이터 조회 테스트  
curl -X POST "https://script.google.com/macros/s/{SCRIPT_ID}/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "get_budget",
    "data": {
      "userId": "test_user"
    }
  }'
```

## 6. 보안 설정

### 6.1 접근 제한 (선택사항)
특정 도메인에서만 API 사용을 허용하려면:

```javascript
function doPost(e) {
  // Referer 체크 (선택사항)
  const allowedOrigins = ['https://yourdomain.com'];
  const origin = e.parameter.origin || '';
  
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: 'Unauthorized access'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // 기존 코드 계속...
}
```

### 6.2 사용자 인증 (선택사항)
Google 계정 기반 인증을 추가하려면:

```javascript
function getCurrentUser() {
  const user = Session.getActiveUser();
  return user.getEmail();
}
```

## 7. 모니터링 및 유지보수

### 7.1 로그 확인
1. Apps Script 편집기에서 "실행" 탭 클릭
2. 실행 기록과 오류 로그 확인

### 7.2 사용량 모니터링
Google Apps Script 할당량:
- 일일 스크립트 실행 시간: 6시간
- 동시 실행: 30개
- 이메일 전송: 100개/일

### 7.3 백업 설정
1. Google 스프레드시트 자동 백업은 Google Drive에서 제공
2. 정기적으로 데이터를 CSV로 내보내기 권장
3. Apps Script 코드는 Git으로 버전 관리

## 8. 문제 해결

### 8.1 일반적인 오류들

**오류**: "Authorization required"
**해결**: 스크립트 권한을 다시 승인하세요.

**오류**: "Spreadsheet not found" 
**해결**: `MASTER_SHEET_ID`가 올바른지 확인하세요.

**오류**: "Service invoked too many times"
**해결**: API 호출 빈도를 줄이거나 캐싱을 구현하세요.

### 8.2 성능 최적화
1. 불필요한 스프레드시트 읽기/쓰기 최소화
2. 배치 작업으로 여러 데이터를 한번에 처리
3. 캐싱을 통한 중복 요청 방지

## 9. 배포 완료 체크리스트

- [ ] Google 스프레드시트 생성 및 ID 확인
- [ ] Apps Script 프로젝트 생성
- [ ] 백엔드 코드 배포 및 설정
- [ ] 웹앱 배포 및 URL 확인
- [ ] 프론트엔드에서 백엔드 URL 설정
- [ ] 기본 API 기능 테스트
- [ ] 예산, 일정, POI 기능 테스트
- [ ] 오류 로그 확인
- [ ] 사용자 테스트 수행

## 10. 추가 개선사항

### 10.1 고급 기능
- Google Analytics 연동으로 사용량 추적
- Firebase와 연동하여 실시간 동기화
- 푸시 알림 구현
- 다국어 지원

### 10.2 확장 계획
- ChatGPT API 연동으로 여행 추천
- Google Maps API 연동
- 소셜 미디어 공유 기능
- 오프라인 지도 데이터

이제 완전 무료 백엔드가 준비되었습니다! 🎉