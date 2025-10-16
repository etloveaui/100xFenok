# Tests

## 테스트 구조

```
tests/
├── momentum/           # Momentum 모듈 테스트
│   ├── test_momentum_modules.html
│   └── M_Company.test.js
├── integration/        # 통합 테스트
│   └── test_integration.html
└── servers/            # 테스트 서버
    └── test_momentum_server.py
```

## 테스트 실행 방법

### Momentum 모듈 테스트

```bash
# 테스트 서버 실행
cd tests/servers
python test_momentum_server.py

# 브라우저에서 열기
http://localhost:8002/tests/momentum/test_momentum_modules.html
```

### 통합 테스트

```bash
http://localhost:8002/tests/integration/test_integration.html
```

## 테스트 서버 포트

- 기본 포트: 8002
- 메인 앱과 충돌 방지를 위해 다른 포트 사용
