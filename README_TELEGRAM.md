# 100xFenok 텔레그램 알림 시스템

100xFenok Daily Wrap 리포트 발행 시 자동으로 텔레그램 알림을 발송하는 시스템입니다.

## 📁 파일 구조

```
100xFenok/
├── telegram_notifier.py          # 핵심 알림 시스템 모듈
├── config/
│   └── telegram_config.json      # 설정 파일
├── tools/
│   └── notify_daily_wrap.py      # 고급 알림 도구
├── send_notification.py          # 간편 알림 스크립트
├── quick_test_notify.py          # 테스트용 스크립트
└── requirements_telegram.txt      # Python 의존성
```

## 🚀 빠른 시작

### 1. 의존성 설치
```bash
pip install -r requirements_telegram.txt
```

### 2. 기본 사용법

#### 최신 리포트 알림 발송
```bash
python send_notification.py
```

#### 특정 날짜 리포트 알림
```bash
python send_notification.py 2025-08-17
```

#### 커스텀 알림
```bash
python send_notification.py --title "특별 리포트" --file-path "100x/daily-wrap/2025-08-17_100x-daily-wrap.html"
```

#### 연결 테스트
```bash
python send_notification.py --test
```

## ⚙️ 설정

### Chat ID 관리
현재 하드코딩된 Chat ID를 사용합니다:
- `-1001513671466` (그룹: RC Lounge)
- `1697642019` (개인: El Fenómeno)

Chat ID를 변경하려면 `telegram_notifier.py`의 `get_chat_ids()` 메서드를 수정하세요.

### URL 구조
GitHub Pages 배포용 URL 자동 생성:
```
https://etloveaui.github.io/100xFenok/?path=100x/daily-wrap/YYYY-MM-DD_100x-daily-wrap.html
```

## 🔧 고급 사용법

### 직접 모듈 사용
```python
from telegram_notifier import TelegramNotifier

notifier = TelegramNotifier()
success = notifier.send_daily_wrap_notification(
    title="2025-08-17 100x Daily Wrap",
    file_path="100x/daily-wrap/2025-08-17_100x-daily-wrap.html",
    summary="오늘의 주요 시장 동향과 투자 기회를 확인하세요."
)
```

### 고급 명령행 도구 사용
```bash
# 특정 날짜 알림
python tools/notify_daily_wrap.py --date 2025-08-17

# 커스텀 알림
python tools/notify_daily_wrap.py --title "제목" --file-path "경로" --summary "요약"

# 연결 테스트
python tools/notify_daily_wrap.py --test
```

## 📋 워크플로우

1. **Daily Wrap 리포트 생성 완료**
2. **알림 발송**:
   ```bash
   python send_notification.py
   ```
3. **결과 확인**: 콘솔에서 발송 결과 확인

## 🛠 트러블슈팅

### 일반적인 문제

1. **Bot Token 오류**
   - `../../secrets/my_sensitive_data.md` 파일에 올바른 Bot Token이 있는지 확인

2. **Chat ID 문제**
   - 하드코딩된 Chat ID가 올바른지 확인
   - 봇과 대화를 시작했는지 확인

3. **Unicode 오류**
   - Windows에서 콘솔 출력 시 이모지 문제는 해결됨
   - 실제 텔레그램 메시지 발송에는 영향 없음

### 로그 확인
알림 시스템은 자세한 로그를 제공합니다:
```
2025-12-22 21:55:18,704 - TelegramNotifier - INFO - Message sent successfully to 1697642019
```

## ✅ 테스트 완료 사항

- ✅ 텔레그램 봇 연결
- ✅ 메시지 발송 (실제 Chat ID로 테스트 완료)
- ✅ URL 구조 (GitHub Pages 호환)
- ✅ 하드코딩된 Chat ID 사용
- ✅ Windows 환경 호환성

## 📝 주요 기능

- **자동 URL 생성**: GitHub Pages 구조에 맞는 URL 자동 생성
- **유연한 Chat ID 관리**: 하드코딩 또는 Google Sheets 선택 가능
- **다양한 알림 방식**: 최신/특정날짜/커스텀 알림 지원
- **안정적인 오류 처리**: 네트워크 오류 및 재시도 처리
- **상세한 로깅**: 발송 결과 및 디버깅 정보 제공

## 🔗 관련 파일

- **Bot Token**: `../../secrets/my_sensitive_data.md`
- **설정**: `config/telegram_config.json`
- **의존성**: `requirements_telegram.txt`

---

💡 **팁**: 매일 Daily Wrap 생성 후 `python send_notification.py` 명령 하나로 모든 구독자에게 알림을 발송할 수 있습니다.