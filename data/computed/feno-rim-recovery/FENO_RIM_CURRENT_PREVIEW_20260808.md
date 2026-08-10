# FENO RIM Research Preview — 2026-08-08

| | 현재 | 보수적 가치 (low) | 중앙 가치 (median) | 상단 가치 (high) | 현재 대비 | Coverage (weight) |
|---|---:|---:|---:|---:|---:|---:|
| S&P 500 | $68.07T (lvl 7,757.64) | 0.185 FV/P | 0.215 FV/P | 0.346 FV/P | -81.5% ~ -65.4% | 83.5% |
| Nasdaq-100 | $39.84T (summed MC) | 0.100 FV/P | 0.122 FV/P | 0.225 FV/P | -90.0% ~ -77.5% | 74.1% |
| QQQ equivalent | $721.70 | $72.18 | $87.87 | $162.14 | -90.0% ~ -77.5% | — |

Ke range (median of firms, low/high): 9.6% ~ 13.8% (SPX) /
10.2% ~ 15.1% (NDX). Rf (DGS10) 4.63% (2026-08-05), MRP 1928-2025 = 7.03% (SE 2.10pp).

Status: **RESEARCH PREVIEW / NOT VALIDATED**
Main uncertainty: forward-book / OEA (UNRESOLVED); widest valuation axis: forecast (SPX) / forecast (NDX)

## 16-leg min / median / max (FV/P)

| | SPX | NDX |
|---|---|---:|
| min (low) | 0.1854 | 0.1000 |
| p25 | 0.2011 | 0.1105 |
| median | 0.2149 | 0.1218 |
| p75 | 0.2586 | 0.1613 |
| max (high) | 0.3460 | 0.2247 |
| admissible legs | 16/16 | 16/16 |

## Coverage & as-of

- SPX: 436/503 usable names (83.5% of slickcharts marketCap); excluded: {'NO_SHARE_BASIS': 31, 'BOOK_NONPOSITIVE': 32, 'NO_BOOK': 4}
- NDX: 73/103 usable names (74.1% of slickcharts marketCap); excluded: {'NO_SHARE_BASIS': 16, 'NO_BOOK': 9, 'BOOK_NONPOSITIVE': 5}
- As-of: roster 2026-08-01 (slickcharts), prices 2026-08-07 (yf/finance), 10Y 2026-08-05 (DGS10), MRP 1928-2025, payout 5y window filed <= 2026-08-08. Oldest input: roster 2026-08-01.
- NDX point level: none available in repo (data/indices/nasdaq.json is the Nasdaq Composite, not NDX — not used). NDX current market value = summed constituent marketCap.
- Forecast origin: 2026-08-08 (P2-A emission: emitted when computable, actual = null by construction; no realized outcomes exist at a current origin). P2-A panel used; P2-B NOT used.
- Public surface: 0 rows (PUBLIC_ROWS = [], PUBLIC_STATE = MODEL_REVALIDATION).

*Numbers are computed, not validated. Confidence is separate from the number.*
