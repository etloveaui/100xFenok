# 100xFenok 알림 시스템 사용법

## 🎯 알림 발송 방법

### 1. GitHub Pages에서 사용 (권장)

GitHub Pages는 정적 호스팅이므로 서버 기능이 제한됩니다. 아래 방법 중 하나를 선택하세요:

#### A. 독립실행 웹 패널 사용
- **URL**: https://etloveaui.github.io/100xFenok/notification-control-panel-standalone.html
- **기능**: 명령어 생성 및 클립보드 복사
- **사용법**: 웹에서 명령어 복사 → 로컬에서 실행

#### B. 빠른 명령어 실행
```bash
cd C:\Users\eunta\multi-agent-workspace\projects\100xFenok

# Daily Wrap 알림
python quick_notify.py --type daily

# Alpha Scout 알림  
python quick_notify.py --type alpha

# Strategic Briefing 알림
python quick_notify.py --type briefing

# 커스텀 알림
python quick_notify.py --type custom --title "제목" --message "내용"
```

### 2. 로컬 서버 실행 (모든 기능)

```bash
cd C:\Users\eunta\multi-agent-workspace\projects\100xFenok
start_notification_panel.bat
```

브라우저에서 http://localhost:5000 접속

## 📋 상세 명령어 가이드

### Daily Wrap 알림
```bash
# 기본 (최신 파일 자동 감지)
python send_notification.py

# 특정 날짜
python send_notification.py 2025-08-26
```

### Alpha Scout 알림
```bash
# 특정 파일
python smart_notification_system.py --file "alpha-scout/reports/2025-08-24_100x-alpha-scout.html"

# 빠른 실행
python quick_notify.py --type alpha --date 2025-08-24
```

### Strategic Briefing 알림
```bash
# 특정 파일
python smart_notification_system.py --file "100x Briefing/Briefing/2025-08-03_100x-Strategic-Briefing.html"

# 빠른 실행
python quick_notify.py --type briefing --date 2025-08-03
```

### 커스텀 알림
```bash
# Python 명령어로 직접 실행
python -c "from tools.notify_daily_wrap import DailyWrapNotificationTrigger; trigger = DailyWrapNotificationTrigger(); trigger.notify_custom('제목', '', '메시지 내용')"

# 빠른 실행
python quick_notify.py --type custom --title "긴급 알림" --message "중요한 내용입니다"
```

## 🔧 시스템 테스트

```bash
# 알림 시스템 테스트
python smart_notification_system.py --test

# 텔레그램 연결 테스트  
python -c "from tools.notify_daily_wrap import DailyWrapNotificationTrigger; trigger = DailyWrapNotificationTrigger(); print(trigger.notifier.test_connection())"
```

## 🚨 문제 해결

### "모듈을 찾을 수 없습니다" 오류
```bash
# 경로 확인
cd C:\Users\eunta\multi-agent-workspace\projects\100xFenok
pwd

# Python 경로 확인
python -c "import sys; print('\n'.join(sys.path))"
```

### "텔레그램 연결 실패" 오류
1. `telegram_notifier.py` 파일에서 토큰 확인
2. 네트워크 연결 확인
3. 봇 토큰이 유효한지 확인

### GitHub Actions에서 알림 안됨
- 최근 수정으로 해결됨 (커밋 1bac4bc)
- 변경된 파일 감지 로직 3단계 강화
- 새로운 커밋 시 자동으로 적절한 알림 발송

## 📊 발송 이력 확인

```bash
# 로컬 서버의 API로 확인
curl http://localhost:5000/api/history

# 또는 브라우저에서 서버 패널의 이력 섹션 확인
```

## 🔗 유용한 링크

- **GitHub Pages 독립실행 패널**: https://etloveaui.github.io/100xFenok/notification-control-panel-standalone.html
- **로컬 서버 패널**: http://localhost:5000 (서버 실행 후)
- **GitHub Repository**: https://github.com/etloveaui/100xFenok

---

**마지막 업데이트**: 2025-08-26  
**버전**: v2.0 (GitHub Actions 수정 완료)