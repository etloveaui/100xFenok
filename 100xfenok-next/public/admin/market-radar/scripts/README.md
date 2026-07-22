# Market Radar - Apps Script 백업

> Google Apps Script 코드 백업 및 참조용
> **실제 실행**: Google Apps Script 콘솔에서 수행
> **Sentiment 주의**: `vix.gs`, `cnn.gs`, `cnn-components.gs`, `move.gs`,
> `cftc.gs`는 deprecated backup입니다. 운영 갱신은
> `scripts/fetch-sentiment.mjs` + `.github/workflows/fetch-sentiment.yml`이 담당합니다.

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
| VIX | deprecated | `fetch-sentiment.mjs` scheduled collector |
| MOVE | deprecated | `fetch-sentiment.mjs` scheduled collector |
| CNN | deprecated | `fetch-sentiment.mjs` scheduled collector |
| Crypto | 수동 | Alternative.me API |
| CFTC | deprecated | `fetch-sentiment.mjs` scheduled collector |

---

## 트리거 설정

| 수집기 | 함수 | 트리거 |
|--------|------|--------|
| SP500/NASDAQ | `updateAllIndices()` | 매일 06:00, 09:00 |
| VIX | `updateVIX()` | deprecated; 트리거 생성 금지 |
| MOVE | `updateMOVE()` | deprecated; 트리거 생성 금지 |
| **AAII** | `updateAAII()` | **금요일 00:00, 06:00** |
| **CFTC** | `updateCFTC()` | deprecated; 트리거 생성 금지 |
| CNN F&G | `updateCNN()` | deprecated; 트리거 생성 금지 |
| **CNN Components** | `updateCNNComponents()` | deprecated; 트리거 생성 금지 |
| Crypto F&G | `updateCryptoFG()` | 매일 07:52 |

---

## 파일 목록

| 파일 | 데이터 소스 | 대상 JSON |
|------|------------|-----------|
| **`yahoo-quotes.gs`** | **100x quote.v1→Yahoo OHLC→Stooq→GOOGLEFINANCE** | **범용 실시간 주가 조회 (IB Helper 등)** |
| `indices.gs` | retired canonical writer; owner removes GAS triggers atomically with the bot cutover | historical source only |
| `fetch-us-indices-daily.yml` | Yahoo chart v8 canonical producer; source + public mirror are one atomic write set | `data/indices/sp500.json`, `nasdaq.json` + public mirrors |
| `vix.gs` | deprecated Yahoo backup | `data/sentiment/vix.json` (runtime owner: `fetch-sentiment.mjs`) |
| `move.gs` | deprecated Yahoo backup | `data/sentiment/move.json` (runtime owner: `fetch-sentiment.mjs`) |
| `aaii.gs` | IMPORTHTML (AAII 웹사이트) | `data/sentiment/aaii.json` |
| `cftc.gs` | deprecated CFTC backup | `data/sentiment/cftc-sp500.json` (runtime owner: `fetch-sentiment.mjs`) |
| `cnn.gs` | deprecated CNN backup | `data/sentiment/cnn-fear-greed.json`, `cnn-components.json` (runtime owner: `fetch-sentiment.mjs`) |
| `cnn-components.gs` | deprecated CNN component backup | `cnn-momentum/strength/breadth/put-call/junk-bond/safe-haven.json` (runtime owner: `fetch-sentiment.mjs`) |
| `crypto.gs` | Alternative.me API | `data/sentiment/crypto-fear-greed.json` |

---

## 공통 패턴

모든 수집기는 **merge 패턴** 사용:
```
getExistingData() → mergeData() → pushToGitHub()
```

**⚠️ 직접 덮어쓰기 금지** - 기존 히스토리 데이터 보호

Deprecated sentiment GAS backups now fail closed unless the Apps Script property
`ALLOW_DEPRECATED_GAS_SENTIMENT=true` is set for a one-off historical recovery.

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
