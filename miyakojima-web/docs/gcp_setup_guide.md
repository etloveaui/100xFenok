# 🏝️ 미야코지마 여행 앱 - Google Cloud Platform 설정 가이드

**버전**: 1.0  
**작성일**: 2025-01-25  
**대상**: Task 0.1 - Google 계정 및 프로젝트 설정  
**예상 소요 시간**: 2시간  
**작성자**: DevOps Architecture Team

---

## 📋 목차
1. [개요](#1-개요)
2. [사전 준비](#2-사전-준비)
3. [Step 1: Google 계정 2단계 인증 설정](#step-1-google-계정-2단계-인증-설정)
4. [Step 2: Google Cloud Console 프로젝트 생성](#step-2-google-cloud-console-프로젝트-생성)
5. [Step 3: Google Sheets API 활성화](#step-3-google-sheets-api-활성화)
6. [Step 4: Google Apps Script 프로젝트 생성](#step-4-google-apps-script-프로젝트-생성)
7. [Step 5: API 키 및 OAuth 2.0 인증 정보 생성](#step-5-api-키-및-oauth-20-인증-정보-생성)
8. [보안 설정 및 제한 사항](#보안-설정-및-제한-사항)
9. [인증 정보 안전 보관 방법](#인증-정보-안전-보관-방법)
10. [문제 해결 가이드](#문제-해결-가이드)

---

## 1. 개요

이 가이드는 미야코지마 여행 앱 개발을 위한 Google Cloud Platform 환경을 설정하는 단계별 절차를 제공합니다.

### 설정 완료 후 얻게 되는 것
- ✅ Google Cloud 프로젝트 ID
- ✅ Google Sheets API 접근 권한
- ✅ Google Apps Script 프로젝트 URL
- ✅ API 키 (제한 설정 포함)
- ✅ OAuth 2.0 클라이언트 인증 정보

### 보안 원칙
- 🔒 **최소 권한 원칙**: 필요한 API만 활성화
- 🔐 **계층별 보안**: 계정 → 프로젝트 → API → 인증
- 🛡️ **제한 설정**: IP, 도메인, HTTP 리퍼러 기반 제한
- 🔄 **정기적 관리**: 3-6개월마다 키 순환

---

## 2. 사전 준비

### 필요한 것들
- [ ] Google 계정 (Gmail 또는 Google Workspace)
- [ ] Chrome 또는 Firefox 브라우저
- [ ] 안전한 비밀번호 관리 도구 (예: 1Password, Bitwarden)
- [ ] 휴대폰 (2단계 인증용)

### ⚠️ 중요한 주의사항
1. **절대 API 키를 공개 저장소에 커밋하지 마세요**
2. **작업 중 브라우저를 닫지 마세요** (설정이 손실될 수 있음)
3. **각 단계마다 생성되는 ID와 URL을 반드시 기록하세요**

---

## Step 1: Google 계정 2단계 인증 설정

### 1-1. Google 계정 보안 설정 페이지 접속

1. 웹 브라우저에서 https://myaccount.google.com 접속
2. 좌측 메뉴에서 **"보안"** 클릭
3. **"Google에 로그인"** 섹션 찾기

### 1-2. 2단계 인증 활성화

1. **"2단계 인증"** 항목 클릭
2. **"시작하기"** 버튼 클릭
3. 비밀번호 재입력 (보안 확인)
4. 휴대폰 번호 입력 및 인증
   - **추천**: SMS 대신 **Google Authenticator 앱** 사용
5. 백업 코드 다운로드 및 안전한 곳에 보관

### ✅ 1단계 완료 확인
- [ ] "2단계 인증 사용" 상태가 **"켜짐"**으로 표시됨
- [ ] 백업 코드를 안전한 곳에 저장함

---

## Step 2: Google Cloud Console 프로젝트 생성

### 2-1. Google Cloud Console 접속

1. 새 탭에서 https://console.cloud.google.com 접속
2. Google 계정으로 로그인
3. **서비스 약관 동의** (처음 접속 시)

### 2-2. 새 프로젝트 생성

1. 상단 네비게이션 바에서 프로젝트 선택 드롭다운 클릭
   - 📍 **위치**: 화면 상단 중앙, "My Project" 또는 "프로젝트 선택" 영역
2. **"새 프로젝트"** 버튼 클릭
3. 프로젝트 정보 입력:
   ```
   프로젝트 이름: Miyakojima Travel App
   프로젝트 ID: miyakojima-travel-app-[랜덤숫자]
   ```
   - ⚠️ **프로젝트 ID는 전 세계적으로 고유해야 하므로 숫자가 자동 추가됩니다**
4. **"만들기"** 버튼 클릭
5. 프로젝트 생성 완료까지 대기 (약 30초-1분)

### 2-3. 프로젝트 선택 확인

1. 상단 네비게이션에서 방금 생성한 프로젝트가 선택되었는지 확인
2. 대시보드에 **"Miyakojima Travel App"** 표시 확인

### ✅ 2단계 완료 확인
- [ ] 프로젝트 ID 기록함: `miyakojima-travel-app-######`
- [ ] 프로젝트가 활성 상태로 선택됨

---

## Step 3: Google Sheets API 활성화

### 3-1. API 및 서비스 라이브러리 접속

1. 좌측 메뉴에서 **"API 및 서비스"** 클릭
   - 📍 **위치**: 왼쪽 사이드바 중간 부분, 햄버거 메뉴(≡) 아래
2. **"라이브러리"** 클릭
3. API 라이브러리 페이지 로딩 대기

### 3-2. Google Sheets API 검색 및 활성화

1. 상단 검색 바에 **"Google Sheets API"** 입력
2. 검색 결과에서 **"Google Sheets API"** 클릭
   - 📍 **확인 방법**: Google 공식 마크(체크 표시) 있는 것 선택
3. **"사용 설정"** 버튼 클릭
4. API 활성화 완료까지 대기 (약 10-30초)

### 3-3. Google Drive API 활성화 (추가)

1. 다시 **"라이브러리"** 페이지로 이동
2. 검색 바에 **"Google Drive API"** 입력
3. **"Google Drive API"** 선택 후 **"사용 설정"** 클릭
   - 🔍 **이유**: 파일 업로드 및 백업 기능용

### ✅ 3단계 완료 확인
- [ ] Google Sheets API 상태: **"활성화됨"**
- [ ] Google Drive API 상태: **"활성화됨"**
- [ ] API 대시보드에서 두 API 모두 표시됨

---

## Step 4: Google Apps Script 프로젝트 생성

### 4-1. Google Apps Script 콘솔 접속

1. 새 탭에서 https://script.google.com 접속
2. 동일한 Google 계정으로 로그인 확인
3. **"새 프로젝트"** 버튼 클릭
   - 📍 **위치**: 화면 좌측 상단, + 아이콘 옆

### 4-2. Apps Script 프로젝트 설정

1. 기본 코드 에디터 화면 확인
2. 상단의 **"제목 없는 프로젝트"** 클릭
3. 프로젝트 이름 변경: **"Miyakojima Travel API"**
4. **"저장"** 또는 Enter 키로 저장

### 4-3. 클라우드 플랫폼 프로젝트 연결

1. 좌측 사이드바에서 **"프로젝트 설정"** (⚙️ 아이콘) 클릭
2. **"Google Cloud Platform(GCP) 프로젝트"** 섹션 찾기
3. **"프로젝트 변경"** 클릭
4. 앞서 생성한 GCP 프로젝트 ID 입력: `miyakojima-travel-app-######`
5. **"프로젝트 설정"** 버튼 클릭
6. 연결 확인 대기 (약 30초)

### ✅ 4단계 완료 확인
- [ ] Apps Script 프로젝트명: **"Miyakojima Travel API"**
- [ ] GCP 프로젝트 연결 확인
- [ ] Apps Script 프로젝트 URL 기록함

---

## Step 5: API 키 및 OAuth 2.0 인증 정보 생성

### 5-1. Google Cloud Console 인증 정보 페이지

1. Google Cloud Console (console.cloud.google.com)로 돌아가기
2. 좌측 메뉴에서 **"API 및 서비스"** → **"사용자 인증 정보"** 클릭
3. 인증 정보 페이지 로딩 확인

### 5-2. API 키 생성

1. 상단의 **"+ 사용자 인증 정보 만들기"** 클릭
2. **"API 키"** 선택
3. API 키 생성 팝업에서 **생성된 키를 임시로 복사** 해둠
4. **"키 제한"** 버튼 클릭 (보안 강화)

### 5-3. API 키 제한 설정 (보안 필수)

1. **키 제한** 탭에서 다음 설정:
   ```
   이름: Miyakojima Travel API Key
   애플리케이션 제한사항: HTTP 리퍼러(웹사이트)
   웹사이트 제한사항:
   - https://your-username.github.io/miyakojima-web/*
   - http://localhost:*/*  (개발용)
   ```

2. **API 제한사항** 설정:
   - **"키 제한"** 라디오 버튼 선택
   - **"Google Sheets API"** 체크
   - **"Google Drive API"** 체크

3. **"저장"** 버튼 클릭

### 5-4. OAuth 2.0 클라이언트 ID 생성

1. 다시 **"+ 사용자 인증 정보 만들기"** → **"OAuth 클라이언트 ID"** 클릭
2. 동의 화면 구성이 필요한 경우:
   - **"동의 화면 구성"** 클릭
   - **"외부"** 선택 → **"만들기"** 클릭
   - 필수 정보 입력:
     ```
     앱 이름: Miyakojima Travel App
     사용자 지원 이메일: [본인 Gmail]
     개발자 연락처 정보: [본인 Gmail]
     ```
   - **"저장 후 계속"** 클릭
   - 범위 및 테스트 사용자는 건너뛰기

3. OAuth 클라이언트 ID 생성:
   - **애플리케이션 유형**: "웹 애플리케이션"
   - **이름**: "Miyakojima Travel Web Client"
   - **승인된 JavaScript 원본**:
     ```
     https://your-username.github.io
     http://localhost:5000
     ```
   - **승인된 리디렉션 URI**:
     ```
     https://your-username.github.io/miyakojima-web/auth/callback
     http://localhost:5000/auth/callback
     ```

4. **"만들기"** 클릭
5. 생성된 **클라이언트 ID**와 **클라이언트 보안 비밀** 복사

### ✅ 5단계 완료 확인
- [ ] API 키 생성 및 제한 설정 완료
- [ ] OAuth 2.0 클라이언트 ID 생성 완료
- [ ] 모든 인증 정보 안전하게 복사함

---

## 보안 설정 및 제한 사항

### API 키 보안 체크리스트
- [x] HTTP 리퍼러 제한 설정
- [x] API 범위 제한 (Sheets, Drive만)
- [x] 정기적 순환 계획 (3개월마다)
- [x] 사용량 모니터링 알림 설정

### OAuth 2.0 보안 체크리스트
- [x] 승인된 도메인만 등록
- [x] HTTPS 강제 사용
- [x] 개발/프로덕션 환경 분리
- [x] 토큰 만료 시간 설정

### 모니터링 설정
1. **API 및 서비스** → **대시보드** 이동
2. **할당량** 탭에서 일일 요청 한도 확인:
   - Google Sheets API: 100 requests/100초
   - 일일 읽기: 20,000 requests
   - 일일 쓰기: 2,500 requests
3. **알림 설정**: 80% 도달 시 이메일 알림

---

## 인증 정보 안전 보관 방법

### 🔐 절대 하지 말아야 할 것
- ❌ GitHub 공개 저장소에 API 키 커밋
- ❌ 코드에 하드코딩
- ❌ 이메일이나 메신저로 전송
- ❌ 스크린샷을 SNS에 공유

### ✅ 안전한 보관 방법

#### 1. 로컬 환경 변수 파일 생성
```bash
# .env 파일 생성 (프로젝트 루트)
GOOGLE_API_KEY=AIzaSyB...
GOOGLE_CLIENT_ID=123456789...
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_PROJECT_ID=miyakojima-travel-app-######
```

#### 2. .gitignore 파일에 추가
```gitignore
# Google Cloud 인증 정보
.env
*.key
google-credentials.json
config/secrets.json
```

#### 3. 비밀번호 관리 도구 사용
- **1Password**, **Bitwarden**, **LastPass** 등 활용
- "Miyakojima Travel App - Google APIs" 항목으로 저장
- API 키, 클라이언트 ID, 프로젝트 ID 모두 포함

#### 4. 백업 저장소 (선택사항)
- 암호화된 USB 또는 외장하드
- 클라우드 저장소 (암호화 필수)

### 📝 인증 정보 템플릿
```json
{
  "google": {
    "project_id": "miyakojima-travel-app-######",
    "api_key": "AIzaSyB...",
    "oauth": {
      "client_id": "123456789...",
      "client_secret": "GOCSPX-...",
      "redirect_uris": [
        "https://your-username.github.io/miyakojima-web/auth/callback"
      ]
    },
    "apps_script": {
      "project_url": "https://script.google.com/d/...",
      "deployment_id": "AKfycbz..."
    }
  }
}
```

---

## 문제 해결 가이드

### Q1: "프로젝트 ID가 이미 사용 중입니다" 오류
**해결법**: 
1. 프로젝트 ID 끝에 다른 숫자 추가
2. 예: `miyakojima-travel-app-2025` 또는 `miyakojima-travel-app-v2`

### Q2: API 활성화 후에도 "API가 비활성화됨" 메시지
**해결법**:
1. 5-10분 정도 대기 (전파 시간 필요)
2. 브라우저 새로고침
3. 다른 브라우저로 재시도

### Q3: Apps Script에서 "권한이 없습니다" 오류
**해결법**:
1. GCP 프로젝트 연결 확인
2. API 활성화 상태 재확인
3. OAuth 동의 화면 설정 완료 확인

### Q4: API 키 제한 설정 후 로컬 개발 안됨
**해결법**:
1. HTTP 리퍼러에 `http://localhost:*/*` 추가
2. 개발용 별도 API 키 생성 고려

### Q5: 할당량 초과 오류
**해결법**:
1. API 대시보드에서 사용량 확인
2. 캐싱 로직 구현
3. 배치 요청으로 최적화

---

## 완료 체크리스트

### ✅ Task 0.1 완료 확인
- [ ] Google 계정 2단계 인증 활성화
- [ ] Google Cloud Console 프로젝트 생성
- [ ] Google Sheets API 활성화
- [ ] Google Apps Script 프로젝트 생성
- [ ] API 키 및 OAuth 2.0 인증 정보 생성

### 📋 확보해야 할 정보
- [ ] Google Cloud 프로젝트 ID: `miyakojima-travel-app-######`
- [ ] Google Apps Script URL: `https://script.google.com/d/...`
- [ ] API 키 (제한 설정 포함)
- [ ] OAuth 2.0 클라이언트 ID
- [ ] OAuth 2.0 클라이언트 보안 비밀

### 🔒 보안 체크리스트
- [ ] API 키 제한 설정 완료
- [ ] OAuth 리디렉션 URI 제한 설정
- [ ] 인증 정보 안전한 곳에 보관
- [ ] .gitignore에 보안 파일 추가
- [ ] 사용량 모니터링 설정

---

## 다음 단계

이 설정이 완료되면 다음 Task들을 진행할 수 있습니다:

1. **Task 0.2**: GitHub 저장소 설정
2. **Task 1.1**: 데이터 마이그레이션 스크립트 작성
3. **Task 2.1**: Apps Script 기본 구조 설정

### 🎯 예상 결과
- 완전히 구성된 Google Cloud 환경
- 보안이 적용된 API 접근 권한
- Apps Script 개발 준비 완료
- GitHub Pages 배포 준비

---

**⚠️ 보안 알림**: 이 설정으로 생성된 모든 API 키와 인증 정보는 반드시 안전하게 보관하고, 정기적으로 순환해 주세요. 의심스러운 활동이 발견되면 즉시 키를 비활성화하고 새로 생성하세요.

**📞 지원**: 문제가 발생하면 Google Cloud Support 또는 프로젝트 팀에 문의하세요.