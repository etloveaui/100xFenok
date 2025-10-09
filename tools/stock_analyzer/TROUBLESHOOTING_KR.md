# 🚨 데이터 로딩 오류 해결 가이드

## 현재 상황
- ❌ SyntaxError: Unexpected token 'N' 오류 발생
- ❌ "데이터 로딩 실패" 모달 계속 표시
- ✅ 파일 존재: `enhanced_summary_data_clean.json` (1.6MB)
- ✅ 경로 업데이트 완료: stock_analyzer_enhanced.js:295
- ✅ 서버 실행 중: 포트 8002

## 🎯 즉시 해결 방법 (우선순위 순서)

### 방법 1: 디버그 도구 사용 (가장 빠름) ⭐

```bash
# 1. 브라우저에서 디버그 페이지 열기
http://localhost:8002/debug_data_loading.html

# 2. 다음 순서로 버튼 클릭:
#    ① Service Worker 제거 (캐시 클리어)
#    ② 모든 캐시 삭제
#    ③ 데이터 로딩 테스트
```

### 방법 2: 브라우저 수동 캐시 클리어

#### Chrome/Edge:
1. `F12` 개발자 도구 열기
2. `Application` 탭 선택
3. 왼쪽 메뉴에서:
   - `Service Workers` → `Unregister` 클릭
   - `Cache Storage` → 모든 캐시 우클릭 → `Delete`
   - `Storage` → `Clear site data` 클릭
4. `Ctrl + Shift + R` (하드 리프레시)

#### Firefox:
1. `F12` 개발자 도구 열기
2. `Storage` 탭 선택
3. `Cache Storage` → 모든 항목 삭제
4. `Service Workers` → `Unregister`
5. `Ctrl + Shift + R` (하드 리프레시)

### 방법 3: 서버 재시작

```bash
# 현재 실행 중인 서버 확인
netstat -ano | findstr "8002"

# PID 확인 후 종료 (예: PID가 19508인 경우)
taskkill /F /PID 19508

# 서버 재시작
cd projects/100xFenok/tools/stock_analyzer
python test_server.py

# 브라우저에서 접속
http://localhost:8001/stock_analyzer.html
```

**주의**: test_server.py는 8001 포트를 사용합니다. 현재 8002에서 실행 중인 것은 다른 서버일 수 있습니다.

### 방법 4: 완전 초기화 (최후의 수단)

```bash
# 1. 모든 Python 서버 종료
taskkill /F /IM python.exe

# 2. 브라우저 완전 종료 후 재시작

# 3. 브라우저 시크릿/프라이빗 모드로 열기
http://localhost:8001/stock_analyzer.html

# 4. F12 → Network 탭에서 확인
#    enhanced_summary_data_clean.json 요청이 304가 아닌 200이어야 함
```

## 🔍 문제 진단 체크리스트

### 1. 파일 존재 확인
```bash
cd projects/100xFenok/tools/stock_analyzer/data
dir enhanced_summary_data_clean.json
```
✅ 예상 결과: 파일 크기 약 1.6MB

### 2. JSON 유효성 확인
```bash
# PowerShell에서
Get-Content enhanced_summary_data_clean.json -TotalCount 5
```
✅ 예상 결과: `{` 로 시작, "metadata" 포함

### 3. 서버 포트 확인
```bash
netstat -ano | findstr "8001 8002"
```
✅ test_server.py는 8001을 사용해야 함

### 4. 브라우저 Network 탭 확인 (F12)
- enhanced_summary_data_clean.json 요청 상태 확인
- Status Code: 200 OK (304 Not Modified 아님)
- Response 탭에서 JSON 내용 확인
- Headers 탭에서 Content-Type: application/json 확인

### 5. 브라우저 Console 확인 (F12)
✅ 정상 로딩 시 메시지:
```
✅ Loading enhanced data with 31 indicators...
✅ 강화된 데이터 로딩 성공: 1249개 기업
✅ 필터 초기화 완료
```

❌ 오류 발생 시:
```
❌ 데이터 로딩 실패: SyntaxError: Unexpected token 'N'
```

## 🐛 고급 디버깅

### Service Worker 캐시 내용 확인
1. `F12` → `Application` 탭
2. `Cache Storage` 펼치기
3. `data-v1.0.0` 또는 `static-v1.0.0` 클릭
4. `enhanced_summary_data_clean.json` 찾기
5. 우클릭 → `Delete` (오래된 항목 삭제)

### 콘솔에서 직접 테스트
```javascript
// F12 Console에서 실행
fetch('data/enhanced_summary_data_clean.json')
  .then(response => response.text())
  .then(text => {
    console.log('파일 크기:', text.length);
    console.log('첫 100자:', text.substring(0, 100));
    const data = JSON.parse(text);
    console.log('총 기업 수:', data.metadata.total_companies);
  })
  .catch(error => console.error('오류:', error));
```

### 캐시 무시 테스트
```javascript
// 캐시를 완전히 무시하고 로딩
fetch('data/enhanced_summary_data_clean.json?t=' + Date.now(), {
  cache: 'no-cache'
})
  .then(response => response.json())
  .then(data => console.log('성공:', data.metadata))
  .catch(error => console.error('실패:', error));
```

## 📊 예상 결과

### 성공 시:
```
✅ Service Worker: 제거됨 또는 없음
✅ 캐시: 모두 삭제됨
✅ 데이터 로딩: 1,249개 기업
✅ 필터: 정상 작동
✅ 테이블: 데이터 표시
```

### 실패 시 추가 조치:
1. **파일 권한 확인**: 파일이 읽기 가능한지 확인
2. **포트 충돌 확인**: 다른 서버가 8002를 사용하는지 확인
3. **방화벽 확인**: localhost 접근이 차단되지 않았는지 확인
4. **브라우저 변경**: 다른 브라우저에서 테스트 (Chrome → Edge 등)

## 🎯 권장 작업 순서

1. **즉시**: 디버그 도구 사용 (`debug_data_loading.html`)
2. **5분 후에도 안되면**: 브라우저 수동 캐시 클리어
3. **10분 후에도 안되면**: 서버 재시작
4. **15분 후에도 안되면**: 완전 초기화 (시크릿 모드)

## 💡 예방 조치

앞으로 이런 문제를 방지하려면:

1. **Service Worker 비활성화 옵션 추가** (개발 중)
   ```javascript
   // stock_analyzer_enhanced.js에 추가
   const DISABLE_SERVICE_WORKER = true; // 개발 중에는 true
   ```

2. **캐시 버스터 강화**
   ```javascript
   // 항상 최신 파일 로딩
   fetch(`./data/enhanced_summary_data_clean.json?v=${Date.now()}`)
   ```

3. **데이터 파일 변경 시**
   - Service Worker 버전 업데이트: sw.js의 `CACHE_NAME` 변경
   - 브라우저 하드 리프레시: `Ctrl + Shift + R`
   - Application Storage 클리어

## 📞 추가 지원

위 방법으로 해결되지 않으면:
1. `debug_data_loading.html`의 로그 전체를 복사
2. 브라우저 Console의 모든 오류 메시지 복사
3. Network 탭의 요청/응답 상세 정보 캡처
