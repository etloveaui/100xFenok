# Data Lab DEV.md

> **목적**: Damodaran/Global Scouter 등 외부 JSON 데이터의 품질/최신성 관리
> **위치**: `admin/data-lab/`

---

## 개요

| 항목 | 값 |
|------|-----|
| 역할 | 데이터 상태 대시보드 (관리 전용) |
| 대상 | Damodaran, Global Scouter |
| 성격 | 읽기/검증 중심 (UI 실험 없음) |

---

## 데이터 대상

| 데이터 | 파일 | 갱신 주기 |
|------|------|-----------|
| Damodaran ERP | `/data/damodaran/erp.json` | 연 1회 |
| Damodaran EV/Sales | `/data/damodaran/ev_sales.json` | 연 1~2회 |
| Global Scouter | `/data/global-scouter/stocks.json` | 주간 |
| Benchmarks | `/data/benchmarks/*.json` | 주간 |

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
