# IB Helper V2 E2E Fixtures

Source shapes verified against `public/ib-helper/js/profile-manager.js` (V1, production).

## Files

- `ib-v2-fixtures.ts` — 3 profile payloads + 8 daily-data payloads + phase mappings.

## Profile Fixtures

| Export | Description | Tickers | Settings |
|---|---|---|---|
| `PROFILE_TQQQ_40DIV` | Single TQQQ, 40-div standard | TQQQ | splits=40, sellRatio=12, additionalBuy on |
| `PROFILE_SOXL_CUSTOM` | SOXL with sellPercent=10 (differs from TQQQ's 12) | SOXL | splits=40, sellRatio=10, additionalBuy off |
| `PROFILE_MULTI` | Multi-ticker: TQQQ+SOXL+UPRO(disabled) | TQQQ, SOXL, UPRO | splits 40/30/40, sell 12/10/8, UPRO disabled |

## Daily Data → Expected Phase Map

T = totalInvested / (holdings × currentPrice)

| Fixture | TQQQ T | SOXL T | Multi T | Expected Phase |
|---|---|---|---|---|
| `DAILY_TQQQ_T0` | 0 | — | — | `fresh_start` (no investment yet) |
| `DAILY_TQQQ_ACCUMULATING` | 6.1 | — | — | `accumulating` (0 < T < 20) |
| `DAILY_TQQQ_ACTIVE` | 20.2 | — | — | `active` (T ≥ 20) |
| `DAILY_TQQQ_OVER` | 42.7 | — | — | `over_invested` (T > 40) |
| `DAILY_SOXL_ACTIVE` | — | 20.8 | — | `active` (soxl crosses threshold) |
| `DAILY_SOXL_ACCUMULATING` | — | 4.8 | — | `accumulating` (0 < SOXL T < 20) |
| `DAILY_MULTI_TQQQ` | 18.3 | — | — | `accumulating` (TQQQ in multi-profile) |
| `DAILY_MULTI_SOXL` | — | — | 20.0 | `active` (SOXL at exact boundary) |

## localStorage Keys

- Profiles: `ib_profiles` → JSON object (version, activeProfileId, profiles)
- Daily data: `ib_daily_data_<profileId>_<symbol>` → JSON object (totalInvested, holdings, currentPrice, date, timestamp)

## Phase Thresholds (per V2 calculator contract)

- T = 0 → `fresh_start`
- 0 < T < 20 → `accumulating`
- T ≥ 20 → `active`
- T > 40 → `over_invested`
