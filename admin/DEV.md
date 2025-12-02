# Admin Panel - DEV.md

> 관리자 패널 기능별 개발 메모
> 생성일: 2025-12-01

---

## Purpose

사이트 관리 기능을 위한 숨겨진 관리자 패널.
일반 사용자에게 노출되지 않으며, 인증된 사용자만 접근 가능.

---

## Folder Structure

```
admin/
├── DEV.md           ← 이 파일
├── index.html       ← 관리자 대시보드
└── api-test.html    ← Apps Script API 테스트
```

---

## 진입 방식

| 단계 | 설명 |
|------|------|
| 1 | 메인 페이지 푸터의 `alive` 텍스트 클릭 |
| 2 | 비밀번호 모달 표시 (커스텀 UI, 마스킹) |
| 3 | SHA-256 해시 비교 → 인증 성공 시 `admin/index.html` 이동 |
| 4 | sessionStorage에 세션 저장 (탭 닫으면 만료) |

---

## 인증 로직

```javascript
// 비밀번호 해시 비교
const inputHash = await sha256(inputPassword);
const storedHash = '...'; // SHA-256 해시값
if (inputHash === storedHash) {
  sessionStorage.setItem('admin_auth', 'true');
  window.location.href = 'admin/index.html';
}
```

**보안**:
- URL 직접 접근 시에도 인증 체크
- sessionStorage 사용 (브라우저 탭 닫으면 만료)
- 비밀번호는 해시로만 저장 (평문 없음)

---

## Apps Script 연동

### 스프레드시트
- **이름**: `100xFenok_Data`
- **시트**: `Config` (설정값 저장용)

### Apps Script 웹앱
- **이름**: `100xFenok_API`
- **배포**: 웹앱 (누구나 접근 가능, 익명 실행)

### API 엔드포인트

| Action | Method | 설명 |
|--------|--------|------|
| `ping` | GET | 연결 확인 |
| `read` | GET | 시트 데이터 읽기 |
| `write` | POST | 행 추가 |

### 확장 가능 기능
- 특정 셀/범위 읽기/쓰기
- 트리거 (자동화, 스케줄링)
- 외부 API 호출 (크롤링)
- 이메일/알림 발송

---

## Quick Actions

| 기능 | 상태 | 설명 |
|------|------|------|
| Telegram 알림 | ✅ 완료 | 기존 페이지 연결 |
| API Test | ✅ 완료 | Apps Script 연동 테스트 |
| 설정 | ⏳ 예정 | Coming soon |

---

## UI/UX

- **테마**: 밝은 테마 (사이트 전체 톤 통일)
- **반응형**: 모바일 대응
- **카드 레이아웃**: Quick Actions 카드형 배치

---

## Phase Checklist

### Phase 1: 기본 구현 ✅ 완료 (2025-12-01)
- [x] 진입점 구현 (alive 클릭)
- [x] 비밀번호 인증 (SHA-256)
- [x] 대시보드 UI
- [x] Telegram 연결
- [x] API Test 페이지

### Phase 2: 확장 (대기)
- [ ] 설정 페이지
- [ ] 데이터 관리 UI
- [ ] 로그 뷰어

---

## Known Issues

- (현재 없음)

---

## Change Log

> 상세 이력: `CookBook/docs/CHANGELOG.md` 참조
