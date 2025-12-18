# Damodaran Data Files

Aswath Damodaran 교수의 공개 데이터를 JSON 형식으로 변환한 파일입니다.

## 파일 목록

| 파일 | 설명 | 갱신 주기 |
|------|------|----------|
| `erp.json` | Country Risk Premium (국가별 ERP) | 연 1회 |
| `ev_sales.json` | Sector EV/Sales Multiples (93개 섹터) | 연 1~2회 |

## 출처

- https://pages.stern.nyu.edu/~adamodar/
- robots.txt 정책 확인: 스크래핑 허용 (2025-12-18 검증)

## 사용처

- **100xFenok Market Radar**: 벤치마크 데이터 호스팅
- **FenokValue Chrome Extension**: EV/Sales 계산 시 섹터 벤치마크 비교

## 데이터 스키마

### ev_sales.json

```json
{
  "metadata": {
    "source": "Damodaran Online",
    "url": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/psdata.html",
    "schema_version": "1.0.0",
    "generated_at": "2025-12-18T...",
    "sector_count": 93
  },
  "sectors": {
    "Semiconductor": {
      "ev_sales": 14.65,
      "price_sales": 14.26,
      "net_margin": 0.1996,
      "operating_margin": 0.2973,
      "num_firms": 63
    }
  }
}
```

## 갱신 방법

1. Damodaran 사이트에서 최신 데이터 확인
2. 변환기로 JSON 생성 (익스텐션 `converters/damodaran-evsales/`)
3. 이 폴더에 JSON 교체
4. 커밋 + push

---

*Last updated: 2025-12-18*
