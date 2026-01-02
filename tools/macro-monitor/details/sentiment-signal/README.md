# Sentiment Signal Detail

> **Phase**: 4-D | **상태**: 서비스 등록 완료
> **결정**: DEC-088 (네이밍), DEC-089 (폴더 구조)

## 구조

```
sentiment-signal/
├── index.html          # 메인 대시보드 (1,568줄)
├── charts/             # 독립 차트 12개
│   ├── chart-vix-move.html
│   ├── chart-aaii.html
│   ├── chart-cftc.html
│   ├── chart-cnn-fg.html
│   ├── chart-cnn-breadth.html
│   ├── chart-cnn-momentum.html
│   ├── chart-cnn-strength.html
│   ├── chart-cnn-put-call.html
│   ├── chart-cnn-junk-bond.html
│   ├── chart-cnn-safe-haven.html
│   ├── chart-crypto-fg.html
│   └── table-cnn-components.html
└── README.md           # 이 파일
```

## 지표 (11개)

| 카테고리 | 지표 | 데이터 소스 |
|----------|------|-------------|
| 변동성 | VIX, VIX Term, MOVE | `/data/sentiment/` |
| 옵션 | SKEW, Put/Call | `/data/sentiment/` |
| 심리 | CNN Fear&Greed | `/data/sentiment/` |
| 설문 | AAII, NAAIM | `/data/sentiment/` |
| 포지션 | CFTC S&P 500 | `/data/sentiment/` |
| 크립토 | Crypto F&G, Stablecoin | `/data/sentiment/` |

## 콤보 시그널

**매수 신호 (7개)**:
- VIX ≥ 40, MOVE ≥ 180
- AAII Bearish ≥ 60%, Spread ≤ -30
- CNN F&G ≤ 20, Crypto F&G ≤ 20
- CFTC Net ≤ -100K

**경고 신호 (3개)**:
- VIX ≤ 12
- CNN F&G ≥ 80
- AAII Bullish ≥ 55%

## 경로 참조

- 데이터: `../../../../data/sentiment/`
- 위젯: `../../widgets/sentiment-signal.html`

## 관련 문서

- `docs/DECISION_LOG.md` - DEC-088, DEC-089
- `docs/research/sentiment-backtest/` - 백테스트 결과
- `tools/macro-monitor/DEV.md` - 개발 가이드
