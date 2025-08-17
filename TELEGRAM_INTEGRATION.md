# 100xFenok Telegram Notification System

## 📋 개요

100xFenok 프로젝트에 새로운 Daily Wrap 리포트가 발행되면 텔레그램을 통해 구독자들에게 자동으로 알림을 보내는 시스템입니다.

### 주요 기능
- ✅ Google Sheets 기반 구독자 관리
- ✅ 텔레그램 봇을 통한 자동 알림 발송
- ✅ 발송 결과 로깅 및 모니터링
- ✅ 수동/자동 실행 지원
- ✅ OneSignal과 병행 운영

## 🏗️ 시스템 구조

```
100xFenok/
├── telegram_notifier.py          # 핵심 알림 모듈
├── tools/
│   └── notify_daily_wrap.py      # 알림 트리거 스크립트
├── config/
│   ├── telegram_config.json      # 설정 파일
│   └── README.md                 # 설정 가이드
├── requirements.txt              # Python 라이브러리
└── secrets/
    ├── my_sensitive_data.md       # 텔레그램 봇 토큰
    └── google_service_account.json # Google API 인증
```

## 🚀 설치 및 설정

### 1. 라이브러리 설치
```bash
cd 100xFenok
pip install -r requirements.txt
```

### 2. 텔레그램 봇 생성
1. [@BotFather](https://t.me/BotFather)에게 `/newbot` 메시지 전송
2. 봇 이름과 사용자명 설정
3. 받은 토큰을 `secrets/my_sensitive_data.md`에 추가:

```markdown
### Telegram Bot Token
- **용도:** 100xFenok 알림 봇
- **값:** `bot123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
- **생성일:** 2025-08-17
```

### 3. Google Sheets 설정
1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. Google Sheets API 활성화
3. Service Account 생성 및 JSON 키 다운로드
4. JSON 파일을 `secrets/google_service_account.json`에 저장

### 4. 스프레드시트 생성
새 Google Sheets 문서를 생성하고 다음 시트들을 만드세요:

#### ChatIDs 시트
```
| Chat ID      |
|--------------|
| 123456789    |
| 987654321    |
```

#### 100xFenok_Logs 시트
```
| Timestamp           | Status  | Details              |
|--------------------|---------|---------------------|
| 2025-08-17 10:30:00| Success | Sent to 5 users... |
```

### 5. 설정 파일 업데이트
`config/telegram_config.json`에서 스프레드시트 ID 설정:

```json
{
  "google_sheets": {
    "spreadsheet_id": "YOUR_SPREADSHEET_ID_HERE"
  }
}
```

## 📱 사용법

### 기본 사용법

#### 1. 연결 테스트
```bash
python tools/notify_daily_wrap.py --test
```

#### 2. 최신 리포트 알림
```bash
python tools/notify_daily_wrap.py
```

#### 3. 특정 날짜 리포트 알림
```bash
python tools/notify_daily_wrap.py --date 2025-08-17
```

#### 4. 커스텀 알림
```bash
python tools/notify_daily_wrap.py \
  --title "특별 리포트" \
  --url "https://your-site.com/special-report" \
  --summary "중요한 시장 업데이트입니다."
```

### 프로그래밍 방식 사용

```python
from telegram_notifier import TelegramNotifier

# 알림 발송
notifier = TelegramNotifier()
success = notifier.send_daily_wrap_notification(
    title="2025-08-17 100x Daily Wrap",
    url="https://your-site.com/100x/daily-wrap/2025-08-17_100x-daily-wrap.html",
    summary="오늘의 주요 시장 동향과 투자 기회를 확인하세요."
)

if success:
    print("알림 발송 완료!")
else:
    print("알림 발송 실패")
```

## 🔗 기존 워크플로우 통합

### Agent 기반 리포트 생성과 연동
Daily Wrap 리포트가 생성되는 기존 프로세스 끝에 알림 발송을 추가할 수 있습니다:

```python
# 기존 리포트 생성 코드 마지막에 추가
import subprocess

# Daily Wrap 생성 완료 후
subprocess.run([
    "python", "tools/notify_daily_wrap.py", 
    "--base-url", "https://your-actual-site.com"
])
```

### 수동 실행
언제든지 수동으로 알림을 발송할 수 있습니다:

```bash
# 가장 최근 리포트 알림
python tools/notify_daily_wrap.py

# 특정 날짜 리포트 알림
python tools/notify_daily_wrap.py --date 2025-08-17
```

## 📊 모니터링

### 발송 결과 확인
1. **콘솔 로그**: 실행 시 실시간 상태 확인
2. **Google Sheets 로그**: 100xFenok_Logs 시트에서 발송 이력 확인

### 일반적인 로그 메시지
```
✅ Message sent successfully to 123456789
❌ Failed to send message to 987654321: HTTP 403: Forbidden
📊 Notification completed: 4 success, 1 failed
```

## 🔧 문제해결

### 자주 발생하는 문제

#### 1. "Bot token not found"
- `secrets/my_sensitive_data.md` 파일에서 토큰 형식 확인
- 토큰이 `bot`으로 시작하는지 확인

#### 2. "Google Sheets API error"
- Service Account에 스프레드시트 편집 권한 부여 확인
- Google Sheets API가 활성화되어 있는지 확인
- `google_service_account.json` 파일 경로 확인

#### 3. "No chat IDs available"
- 스프레드시트의 ChatIDs 시트 구조 확인
- 첫 번째 열에 Chat ID가 올바르게 입력되어 있는지 확인

#### 4. "HTTP 403: Forbidden"
- 봇이 해당 사용자와 대화를 시작했는지 확인
- 사용자가 봇을 차단하지 않았는지 확인

### 디버깅 방법

#### 연결 상태 확인
```bash
python telegram_notifier.py
```

#### 상세 로그 확인
```python
import logging
logging.basicConfig(level=logging.DEBUG)

from telegram_notifier import TelegramNotifier
notifier = TelegramNotifier()
```

## 🔐 보안 고려사항

### 1. 비밀 정보 관리
- 모든 토큰과 키는 `secrets/` 폴더에 저장
- 해당 폴더는 `.gitignore`에 추가되어 Git 추적 제외

### 2. 권한 관리
- Google Service Account는 최소 필요 권한만 부여
- 텔레그램 봇 토큰은 안전하게 보관

### 3. 접근 제어
- 스프레드시트 접근 권한을 신뢰할 수 있는 사용자로 제한
- 정기적으로 접근 로그 확인

## 📈 확장 가능성

### 향후 추가 가능한 기능
- 다른 메신저 플랫폼 지원 (Discord, Slack 등)
- 개인화된 알림 설정
- A/B 테스트를 위한 메시지 변형
- 알림 성과 분석 대시보드

## 📞 지원

문제가 발생하거나 기능 개선 제안이 있으면 프로젝트 이슈 트래커를 활용해주세요.

---

🚀 **100x FenoK | 투자의 시작**