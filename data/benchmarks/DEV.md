# data/benchmarks/ - 100xFenok Benchmarks 밸류에이션 데이터

> **소스**: 100xFenok Benchmarks (원본: Bloomberg Terminal, 주간 업데이트)
> **기간**: 2010-02-26 ~ 현재 (15년+, 829+ 포인트)
> **최신 데이터**: 2026-01-09
> **협의 문서**: `docs/research/bloomberg-json-collaboration.md`

---

## 파일 구조

| 파일 | 내용 | 섹션 |
|------|------|------|
| us.json | 미국 주요 지수 | `sp500`, `nasdaq100`, `nasdaq_composite`, `russell2000` |
| us_sectors.json | GICS 11섹터 + 주택 | `energy`, `materials`, `industrials`, `consumer_discretionary`, `consumer_staples`, `health_care`, `financials`, `information_technology`, `communication_services`, `utilities`, `real_estate`, `homebuilders` |
| micro_sectors.json | 관심업종 | `philadelphia_semi`, `us_regional_banks`, `hang_seng_tech`, `us_biotech` |
| developed.json | 선진국 | `euro_stoxx_50`, `topix`, `hong_kong`, `nikkei` |
| emerging.json | 신흥국 | `shanghai`, `india_sensex`, `kospi`, `brazil`, `vietnam`, `hang_seng_h` |
| msci.json | MSCI 지수 | `world`, `developed`, `emerging`, `china`, `india`, `korea` |

---

## 필드 설명

| 필드 | 설명 | 예시 |
|------|------|------|
| `date` | 날짜 (ISO 8601) | `"2025-12-05"` |
| `px_last` | 종가 | `6090.27` |
| `best_eps` | 컨센서스 EPS | `243.15` |
| `best_pe_ratio` | Forward P/E | `19.32` |
| `px_to_book_ratio` | P/B | `4.52` |
| `roe` | ROE (0~1 범위) | `0.2344` |

---

## JSON 구조

```json
{
  "metadata": {
    "version": "2026-01-09",
    "generated": "2026-01-12T17:16:09.365126",
    "source": "Bloomberg Terminal",
    "sheet": "미국",
    "update_frequency": "weekly"
  },
  "sections": {
    "sp500": {
      "name": "S&P 500 (SPX Index)",
      "name_en": "Sp500",
      "data": [
        {"date": "2010-01-22", "px_last": 1091.76, "best_eps": 80.462, ...},
        ...
      ]
    }
  }
}
```

---

## 사용 예시

```javascript
// 데이터 로드
const res = await fetch('data/benchmarks/us.json');
const data = await res.json();

// S&P 500 최신 데이터
const sp500 = data.sections.sp500.data;
const latest = sp500[sp500.length - 1];
console.log(latest.px_last, latest.best_pe_ratio);

// 전체 섹션 순회
Object.entries(data.sections).forEach(([key, section]) => {
  console.log(key, section.name, section.data.length);
});
```

---

## 업데이트

| 항목 | 내용 |
|------|------|
| **주기** | 매주 일요일 |
| **방식** | Bloomberg 엑셀 → 변환기 Claude → JSON → Git push |
| **담당** | 변환기: `20251207_ClaudeCode_익스텐션` / 웹: `20251124_100xFenok_CleanUp_CookBook` |

---

## 관련 문서

- `docs/research/bloomberg-json-collaboration.md` - 협의 전체 내용
- `docs/research/stock-valuation-skill-spec.md` - 스킬 명세
