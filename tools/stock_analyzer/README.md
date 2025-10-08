# Stock Analyzer - 주식 분석 도구

Global_Scouter의 데이터를 활용한 웹 기반 주식 분석 및 스크리닝 도구입니다.

## 기능

- **QVM 필터링**: Quality, Value, Momentum 기준으로 주식 필터링
- **실시간 데이터**: Global_Scouter에서 생성된 최신 주식 데이터 활용
- **직관적 UI**: 깔끔하고 사용하기 쉬운 웹 인터페이스
- **반응형 디자인**: 데스크톱과 모바일에서 모두 사용 가능

## 실행 방법

### 1. Python 사용 (권장)

```bash
# stock_analyzer 디렉토리로 이동
cd projects/100xFenok/tools/stock_analyzer

# Python HTTP 서버 실행
python -m http.server 8000

# 또는 Python 3 사용
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`으로 접속

### 2. Node.js 사용

```bash
# stock_analyzer 디렉토리로 이동
cd projects/100xFenok/tools/stock_analyzer

# http-server 설치 (전역)
npm install -g http-server

# 서버 실행
http-server -p 8000
```

### 3. VS Code Live Server 사용

1. VS Code에서 `stock_analyzer.html` 파일 열기
2. 우클릭 → "Open with Live Server" 선택
3. 자동으로 브라우저에서 열림

## 데이터 구조

```
stock_analyzer/
├── stock_analyzer.html          # 메인 HTML 파일
├── stock_analyzer.js            # JavaScript 로직
├── stock_analyzer_config.json   # 설정 파일
├── data/                        # 데이터 디렉토리
│   ├── summary_data.json         # 전체 주식 데이터
│   └── screener_indices/         # 필터링 인덱스
│       ├── quality_index.json    # 품질 기준 주식 목록
│       ├── value_index.json      # 가치 기준 주식 목록
│       └── momentum_index.json   # 모멘텀 기준 주식 목록
└── README.md                    # 이 파일
```

## 문제 해결

### CORS 오류가 발생하는 경우

- **원인**: 브라우저에서 `file://` 프로토콜로 직접 HTML 파일을 열었을 때 발생
- **해결**: 위의 실행 방법 중 하나를 사용하여 HTTP 서버를 통해 접속

### 데이터가 로드되지 않는 경우

1. **데이터 파일 확인**: `data/` 폴더에 JSON 파일들이 있는지 확인
2. **서버 실행 확인**: HTTP 서버가 올바르게 실행되고 있는지 확인
3. **브라우저 콘솔 확인**: F12를 눌러 개발자 도구에서 오류 메시지 확인

### 필터가 작동하지 않는 경우

1. **인덱스 파일 확인**: `data/screener_indices/` 폴더의 JSON 파일들 확인
2. **브라우저 새로고침**: Ctrl+F5로 강제 새로고침
3. **콘솔 로그 확인**: 개발자 도구에서 JavaScript 오류 확인

## 개발 정보

- **프레임워크**: Vanilla JavaScript (프레임워크 없음)
- **스타일링**: Tailwind CSS (CDN)
- **아이콘**: Font Awesome
- **폰트**: Noto Sans KR, Orbitron

## 데이터 업데이트

데이터는 Global_Scouter 프로젝트에서 자동으로 생성됩니다. 최신 데이터를 사용하려면:

1. Global_Scouter 실행하여 새 데이터 생성
2. 생성된 JSON 파일들을 `data/` 폴더로 복사
3. 브라우저에서 새로고침

## 라이선스

이 프로젝트는 개인 사용 목적으로 제작되었습니다.