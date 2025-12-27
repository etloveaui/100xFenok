# Data Lab DEV.md

> **목적**: 외부 JSON 데이터의 품질/최신성 관리
> **위치**: `admin/data-lab/`
> **마이그레이션**: DEC-063 (2025-12-27)

---

## 개요

| 항목 | 값 |
|------|-----|
| 역할 | 데이터 상태 대시보드 (관리 전용) |
| 대상 | Damodaran, Global Scouter, Benchmarks, **SEC 13F** |
| 성격 | 읽기/검증 중심 (UI 실험 없음) |

---

## 데이터 대상

| 데이터 | 파일 | 갱신 주기 | 비고 |
|------|------|-----------|------|
| Damodaran ERP | `/data/damodaran/erp.json` | 연 1회 | 1개 파일 |
| Damodaran EV/Sales | `/data/damodaran/ev_sales.json` | 연 1~2회 | 1개 파일 |
| Global Scouter | `/data/global-scouter/core/stocks_index.json` | 주간 | 모듈화 (DEC-063) |
| Benchmarks | `/data/benchmarks/*.json` | 주간 | 6개 파일 |
| **SEC 13F** | `/data/sec-13f/summary.json` | 분기 | 3개 파일 + 17 투자자 |

### SEC 13F 구조 (신규)
```
/data/sec-13f/
├── summary.json       # 17명 투자자 요약
├── by_sector.json     # 섹터별 집계
├── by_ticker.json     # 티커별 집계
└── investors/         # 개별 투자자 (17개)
    ├── warren-buffett.json
    ├── michael-burry.json
    └── ...
```

### Global Scouter 구조 (DEC-063 변경)
```
/data/global-scouter/
├── core/
│   ├── metadata.json
│   ├── dashboard.json
│   └── stocks_index.json   # 메인 인덱스
├── stocks/detail/*.json    # 개별 종목
└── stocks.json             # Legacy (참조용)
```

---

## 구성 파일

| 파일 | 역할 |
|------|------|
| `index.html` | 데이터 상태 대시보드 |
| `shared/data-lab-config.js` | 데이터 경로 설정 |
| `shared/validators.js` | 스키마/필드 검증 |

---

## 운영 원칙

- **읽기 전용**: 데이터 수정 없음
- **검증 우선**: 필드 누락/레코드 급변 경고
- **연동 분리**: 기능 실험은 Valuation Lab, 데이터 관리는 Data Lab

---

## 관련 문서

- 계획: `docs/planning/data-lab-plan.md`
- Damodaran: `data/damodaran/README.md`
- Global Scouter 협업: `docs/references/global-scouter-collaboration.md`
