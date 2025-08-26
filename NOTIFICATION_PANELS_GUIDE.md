# 100xFenok 알림 패널 가이드

## 📋 현재 사용 가능한 알림 패널들

### 🔴 **권장: 직접 테스트 패널**
- **파일**: `test_telegram_direct.html`
- **특징**: 가장 단순하고 확실하게 작동
- **사용법**: GitHub Pages에서 바로 열어서 테스트 가능
- **링크**: https://etloveaui.github.io/100xFenok/test_telegram_direct.html

### 🟡 **웹 기반 완전 패널**
- **파일**: `notification-control-panel-web.html`
- **특징**: 텔레그램 API 직접 호출 (토큰 하드코딩)
- **문제**: CORS 정책으로 인해 일부 브라우저에서 제한될 수 있음
- **링크**: https://etloveaui.github.io/100xFenok/notification-control-panel-web.html

### 🟢 **보안 패널 (Apps Script 프록시)**
- **파일**: `notification-control-panel-secure.html`
- **특징**: Google Apps Script를 프록시로 사용 (토큰 안전 관리)
- **설정 필요**: Google Apps Script 배포 필요
- **링크**: https://etloveaui.github.io/100xFenok/notification-control-panel-secure.html

### 🔵 **명령어 생성기**
- **파일**: `notification-control-panel-standalone.html`
- **특징**: 명령어만 생성, 로컬에서 실행 필요
- **링크**: https://etloveaui.github.io/100xFenok/notification-control-panel-standalone.html

---

## 🚀 **즉시 사용 가능한 방법**

### 1️⃣ **직접 테스트 (가장 확실)**
```
https://etloveaui.github.io/100xFenok/test_telegram_direct.html
```
- 제목/메시지 입력 후 "테스트 발송" 클릭
- 실시간 결과 확인 가능

### 2️⃣ **로컬 빠른 명령어**
```bash
cd C:\Users\eunta\multi-agent-workspace\projects\100xFenok

# Daily Wrap 알림
python quick_notify.py --type daily

# 커스텀 알림
python quick_notify.py --type custom --title "테스트" --message "내용"
```

---

## 🔧 **각 패널의 장단점**

| 패널 | 장점 | 단점 | 추천도 |
|------|------|------|--------|
| **test_telegram_direct.html** | ✅ 확실히 작동<br>✅ 단순함<br>✅ 디버깅 정보 제공 | ❌ 기능 제한적 | ⭐⭐⭐⭐⭐ |
| **notification-control-panel-web.html** | ✅ 모든 기능<br>✅ 예쁜 UI<br>✅ 템플릿 지원 | ❌ CORS 이슈 가능<br>❌ 토큰 노출 | ⭐⭐⭐ |
| **notification-control-panel-secure.html** | ✅ 보안<br>✅ 모든 기능 | ❌ 설정 복잡<br>❌ Apps Script 필요 | ⭐⭐⭐⭐ |
| **notification-control-panel-standalone.html** | ✅ 안전<br>✅ 명령어 생성 | ❌ 로컬 실행 필요 | ⭐⭐⭐ |

---

## 🎯 **추천 사용 순서**

1. **test_telegram_direct.html**로 텔레그램 연결 확인
2. 작동하면 **notification-control-panel-web.html** 시도
3. CORS 문제 있으면 **Apps Script 프록시** 설정
4. 모두 안되면 **로컬 명령어** 사용

---

## 🔍 **문제 해결**

### CORS 오류가 뜨는 경우
- 브라우저에서 텔레그램 API 직접 호출이 차단됨
- **해결책**: Apps Script 프록시 사용 또는 로컬 실행

### 토큰/Chat ID 오류
- `telegram_notifier.py`에서 설정 확인
- 텔레그램 봇이 채널에 추가되어 있는지 확인

### 네트워크 오류
- 인터넷 연결 확인
- 텔레그램 API 상태 확인 (https://status.telegram.org)

---

**🎉 결론: `test_telegram_direct.html`을 먼저 사용해보세요!**