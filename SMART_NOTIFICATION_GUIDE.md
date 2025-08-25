# 🤖 100xFenok 똑똑한 알림 시스템 가이드

**확장가능하고 지속가능한 알림 시스템으로 업그레이드 완료!**

## 🎯 **개선 사항**

### ✅ **해결된 문제**
- ❌ **기존**: 알파스카우트 추가 → 데일리 랩 알림이 와버림
- ✅ **개선**: 파일 종류 자동 감지 → 적절한 알림 발송

### 🚀 **새로운 기능**
1. **파일 경로 기반 자동 감지** - 어떤 리포트인지 알아서 판별
2. **설정 파일 기반 관리** - 새로운 리포트 타입 쉽게 추가
3. **맞춤형 알림 메시지** - 각 리포트별 전용 알림
4. **구조 변경 대응** - 홈페이지 구조가 바뀌어도 설정만 수정

---

## 📋 **현재 지원 리포트 타입**

| 리포트 타입 | 파일 경로 | 알림 제목 |
|-------------|-----------|-----------|
| **Daily Wrap** | `100x/daily-wrap/*.html` | 🔥 100x Daily Wrap 업데이트 |
| **Alpha Scout** | `alpha-scout/reports/*.html` | 🎯 Alpha Scout 리포트 공개 |
| **Strategic Briefing** | `100x Briefing/Briefing/*.html` | 📋 전략 브리핑 업데이트 |

---

## 🛠 **사용법**

### 1️⃣ **자동 모드 (GitHub Actions)**
```bash
# GitHub에 푸시하면 자동으로 감지하여 적절한 알림 발송
git add alpha-scout/reports/2025-08-25_100x-alpha-scout.html
git commit -m "알파스카우트 8/25"
git push
# → 🎯 Alpha Scout 알림 자동 발송!
```

### 2️⃣ **수동 테스트**
```bash
# 특정 파일 테스트
python smart_notification_system.py --file "alpha-scout/reports/2025-08-24_100x-alpha-scout.html"

# 시스템 상태 확인
python smart_notification_system.py --test
```

### 3️⃣ **기존 방식 (호환 유지)**
```bash
# 기존 사용자도 문제없이 사용 가능
python send_notification.py 2025-08-25
```

---

## ⚙️ **새로운 리포트 타입 추가하기**

`config/notification_config.json` 파일에 추가하면 됩니다:

```json
{
  "report_types": {
    "new_report": {
      "name": "새로운 리포트",
      "path_patterns": [
        "new-reports/*.html"
      ],
      "url_template": "https://100xfenok.com/new-reports/{filename}",
      "notification_template": {
        "title": "🆕 새로운 리포트 발행",
        "message": "새로운 리포트가 발행되었습니다!\n\n📅 날짜: {date}\n🔗 링크: {url}",
        "hashtags": ["#NewReport", "#100xFenok"]
      }
    }
  }
}
```

---

## 🧠 **똑똑한 기능들**

### 📊 **자동 날짜 추출**
- 파일명에서 `YYYY-MM-DD` 형식 자동 인식
- 예: `2025-08-24_100x-alpha-scout.html` → 날짜: 2025-08-24

### 🔗 **자동 URL 생성**
- 설정된 템플릿으로 자동 URL 생성
- 예: `https://100xfenok.com/alpha-scout/reports/2025-08-24_100x-alpha-scout.html`

### 💬 **맞춤형 알림 메시지**
- 리포트 타입별 전용 메시지 템플릿
- 해시태그 자동 추가

---

## 🔧 **고급 기능**

### 🌐 **홈페이지 구조 변경 대응**
`config/notification_config.json`에서 수정:
```json
{
  "settings": {
    "base_url": "https://new-domain.com",  // 도메인 변경
    "timezone": "Asia/Seoul"
  }
}
```

### 📱 **알림 메시지 커스터마이징**
각 리포트별 메시지 템플릿 수정 가능:
- `{date}` - 추출된 날짜
- `{url}` - 자동 생성된 URL  
- `{filename}` - 파일명

---

## 🎉 **결과**

### ✅ **이제 이렇게 동작합니다:**
1. **알파스카우트 추가** → 🎯 **알파스카우트 전용 알림**
2. **데일리 랩 추가** → 🔥 **데일리 랩 전용 알림**
3. **브리핑 추가** → 📋 **브리핑 전용 알림**

### 🚀 **확장성:**
- 새 리포트 타입: 설정 파일만 수정
- 홈페이지 구조 변경: URL 템플릿만 수정  
- 알림 메시지 변경: 템플릿만 수정

**완벽하게 지속가능하고 확장가능한 시스템 완성!** 🎯

---

*Created: 2025-08-25 by Claude (총감독관)*  
*Version: 1.0.0*