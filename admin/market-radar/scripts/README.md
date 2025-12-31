# Market Radar - Apps Script 백업

> Google Apps Script 코드 백업 및 참조용
> **실제 실행**: Google Apps Script 콘솔에서 수행

---

## Apps Script 프로젝트

| 프로젝트명 | 용도 | Apps Script URL |
|-----------|------|-----------------|
| `100xFenok-Indices` | SP500/NASDAQ | [편집](https://script.google.com/u/0/home/projects/179KItgaNNd1aL9EdVytRW8yqnPSHh_CodGcKeuW-Tzy0skDZWS1rQXr2/edit) |
| `Fenok-Sentiment` | VIX/MOVE/AAII/CFTC/CNN/Crypto | [편집](https://script.google.com/u/0/home/projects/11MDajfDDn91Sm7T_bCwFbBWiJWFzMlPdHCc5ozZXPnv1RtNyvA12Zhor/edit) |

---

## 스프레드시트

| 시트명 | 용도 | URL |
|--------|------|-----|
| `100xFenok_Market_Indices` | SP500, NASDAQ | [열기](https://docs.google.com/spreadsheets/d/1r1jx5vvpsHwsniOVwSUusoTt-ayNtaYulSqcvuK4f98/edit) |
| `100xFenok-Sentiment` | VIX/MOVE/AAII/CFTC/CNN/Crypto | [열기](https://docs.google.com/spreadsheets/d/15Vp0Z6nkNb_9uxFSIrwh_UYTpiS-MV7JHLSHKMr1UAw/edit) |

### 시트 내 탭

| 탭 | 수식 | 비고 |
|----|------|------|
| AAII | `=IMPORTHTML("https://www.aaii.com/sentimentsurvey/sent_results", "table", 1)` | ⚠️ 오래되면 #N/A → 수식 갱신 로직 |
| VIX | 수동 | FRED API 직접 호출 |
| MOVE | 수동 | Yahoo Finance Proxy |
| CNN | 수동 | CNN API 직접 호출 |
| Crypto | 수동 | Alternative.me API |
| CFTC | 없음 | CFTC API 직접 호출 (개별 시트 없음) |

---

## 트리거 설정

| 수집기 | 함수 | 트리거 |
|--------|------|--------|
| SP500/NASDAQ | `updateAllIndices()` | 매일 06:00, 09:00 |
| VIX | `updateVIX()` | 매일 07:48 |
| MOVE | `updateMOVE()` | 매일 07:29 |
| **AAII** | `updateAAII()` | **금요일 00:00, 06:00** |
| **CFTC** | `updateCFTC()` | **토요일 06:00, 12:00** |
| CNN F&G | `updateCNN()` | 매일 07:20 |
| **CNN Components** | `updateCNNComponents()` | **매일 07:25** |
| Crypto F&G | `updateCryptoFG()` | 매일 07:52 |

---

## 파일 목록

| 파일 | 데이터 소스 | 대상 JSON |
|------|------------|-----------|
| `indices.gs` | GOOGLEFINANCE | `data/indices/sp500.json`, `nasdaq.json` |
| `vix.gs` | FRED API | `data/sentiment/vix.json` |
| `move.gs` | Yahoo Proxy | `data/sentiment/move.json` |
| `aaii.gs` | IMPORTHTML (AAII 웹사이트) | `data/sentiment/aaii.json` |
| `cftc.gs` | CFTC API | `data/sentiment/cftc-sp500.json` |
| `cnn.gs` | Cloudflare Proxy → CNN API | `data/sentiment/cnn-fear-greed.json`, `cnn-components.json` |
| `cnn-components.gs` | Cloudflare Proxy → CNN API | `cnn-momentum/strength/breadth/put-call/junk-bond/safe-haven.json` |
| `crypto.gs` | Alternative.me API | `data/sentiment/crypto-fear-greed.json` |

---

## 공통 패턴

모든 수집기는 **merge 패턴** 사용:
```
getExistingData() → mergeData() → pushToGitHub()
```

**⚠️ 직접 덮어쓰기 금지** - 기존 히스토리 데이터 보호

---

## 필수 설정

```javascript
// Script Properties에 설정 필요
PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', 'your_token');
```

---

## 참조

- DEV.md: `admin/market-radar/DEV.md`
- 데이터: `data/sentiment/`, `data/indices/`
