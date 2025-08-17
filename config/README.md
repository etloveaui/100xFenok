# 100xFenok Telegram Notification - Configuration Guide

## 설정 파일 구성

### 1. telegram_config.json
텔레그램 알림 시스템의 주요 설정을 관리합니다.

#### 필수 설정 항목:
- `google_sheets.spreadsheet_id`: Google Sheets 스프레드시트 ID
- 텔레그램 봇 토큰 (secrets/my_sensitive_data.md에 기록)
- Google Service Account JSON 파일 (secrets/google_service_account.json)

## 사전 준비사항

### 1. 텔레그램 봇 생성
1. @BotFather에게 `/newbot` 메시지 전송
2. 봇 이름과 사용자명 설정
3. 받은 토큰을 `secrets/my_sensitive_data.md`에 기록

### 2. Google Sheets 설정
1. Google Cloud Console에서 프로젝트 생성
2. Google Sheets API 활성화
3. Service Account 생성 및 JSON 키 다운로드
4. 스프레드시트 생성 후 Service Account에 편집 권한 부여

### 3. 스프레드시트 구조
#### ChatIDs 시트:
```
| Chat ID      |
|--------------|
| 123456789    |
| 987654321    |
```

#### 100xFenok_Logs 시트:
```
| Timestamp           | Status  | Details              |
|--------------------|---------|---------------------|
| 2025-08-17 10:30:00| Success | Sent to 5 users... |
```

## 설정 방법

### 1. Spreadsheet ID 설정
1. Google Sheets URL에서 ID 복사
   - `https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit`
2. `telegram_config.json`의 `spreadsheet_id`에 입력

### 2. 비밀 정보 파일 업데이트
`secrets/my_sensitive_data.md`에 다음 형식으로 추가:

```markdown
### Telegram Bot Token
- **용도:** 100xFenok 알림 봇
- **값:** `bot123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
- **생성일:** 2025-08-17

### Google Sheets Spreadsheet ID
- **용도:** 텔레그램 Chat ID 관리
- **값:** `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`
```

## 테스트 방법

```bash
# 연결 테스트
cd /path/to/100xFenok
python telegram_notifier.py

# 실제 알림 테스트
python -c "
from telegram_notifier import TelegramNotifier
notifier = TelegramNotifier()
notifier.send_daily_wrap_notification(
    title='테스트 리포트',
    url='https://example.com',
    summary='테스트 메시지입니다.'
)
"
```

## 문제해결

### 일반적인 오류:
1. **Bot token not found**: secrets 파일에서 토큰 형식 확인
2. **Google Sheets API error**: Service Account 권한 및 API 활성화 확인
3. **No chat IDs**: 스프레드시트의 ChatIDs 시트 구조 확인

### 로그 확인:
시스템 로그와 Google Sheets의 100xFenok_Logs 시트에서 자세한 오류 정보를 확인할 수 있습니다.