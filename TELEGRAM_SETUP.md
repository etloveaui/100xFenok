# 🚀 100xFenok 텔레그램 알림 시스템 - 완전 자동화 가이드

## 📋 개요
새 리포트가 GitHub에 push되면 자동으로 텔레그램 알림이 발송되는 완전 자동화 시스템입니다.

## ⚡ 빠른 설정 (3단계)

### 1단계: 의존성 설치
```bash
pip install -r requirements_telegram.txt
```

### 2단계: GitHub Secrets 설정
GitHub Repository → Settings → Secrets and variables → Actions에서 추가:
- `TELEGRAM_BOT_TOKEN`: 텔레그램 봇 토큰

### 3단계: GitHub Actions 활성화
- `.github/workflows/telegram-notify.yml` 파일이 이미 생성됨
- push 시 자동으로 활성화됨

## 🎯 사용법

### 완전 자동화 (권장)
1. 리포트 작성
2. Git add + commit + push
3. **끝!** - 자동으로 알림 발송

### 수동 발송 (필요 시)
```bash
# 최신 리포트 알림
python send_notification.py

# 특정 날짜 리포트
python send_notification.py 2025-08-17

# 연결 테스트
python send_notification.py --test
```

## 📂 주요 파일

### 핵심 시스템
- `telegram_notifier.py`: 메인 알림 시스템
- `send_notification.py`: 간편 알림 스크립트
- `.github/workflows/telegram-notify.yml`: GitHub Actions 자동화

### 확장 시스템
- `multi_report_notifier.py`: 다중 리포트 타입 지원
- `tools/notify_daily_wrap.py`: 고급 알림 도구

### 설정 및 문서
- `config/telegram_config.json`: 시스템 설정
- `README_TELEGRAM.md`: 상세 사용 가이드

## 🔧 지원 리포트 타입

### 자동 감지 지원
- **Daily Wrap**: `100x/daily-wrap/*.html`
- **Strategic Briefing**: `100x Briefing/Briefing/*.html`
- **Alpha Scout**: `alpha-scout/reports/*.html`

### 확장 방법
`multi_report_notifier.py`의 `report_configs`에 새 타입 추가

## 📱 알림 발송 대상
- 그룹 채팅: `-1001513671466` (RC Lounge)
- 개인 채팅: `1697642019` (El Fenómeno)

## 🛠 트러블슈팅

### 일반적인 문제
1. **GitHub Actions 실패**: Secrets 설정 확인
2. **봇 응답 없음**: 봇과 대화 시작 여부 확인
3. **권한 오류**: 봇이 그룹에 추가되었는지 확인

### 로그 확인
- GitHub Actions → 워크플로우 실행 결과에서 로그 확인
- 로컬 테스트: `python send_notification.py --test`

## ✅ 완료 체크리스트
- [ ] 의존성 설치 완료
- [ ] GitHub Secrets 설정 완료
- [ ] 텔레그램 봇과 대화 시작
- [ ] 테스트 알림 발송 성공
- [ ] GitHub Actions 워크플로우 활성화

---

💡 **완료 후**: 리포트 작성 → Git push → 자동 알림 발송!