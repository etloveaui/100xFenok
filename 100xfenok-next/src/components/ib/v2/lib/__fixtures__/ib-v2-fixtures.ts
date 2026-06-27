// IB Helper V2 E2E Fixtures
// V1 localStorage shapes per public/ib-helper/js/profile-manager.js
// Key: ib_profiles (object), ib_daily_data_<profileId>_<symbol> (object)

const TQQQ_40DIV_PROFILE_ID = "tqqq_solo_1710000000000";
const SOXL_12PCT_PROFILE_ID = "soxl_custom_1720000000000";
const MULTI_PROFILE_ID = "multi_hitter_1730000000000";

export const PROFILE_TQQQ_40DIV = {
  version: "1.0",
  activeProfileId: TQQQ_40DIV_PROFILE_ID,
  profiles: {
    [TQQQ_40DIV_PROFILE_ID]: {
      id: TQQQ_40DIV_PROFILE_ID,
      name: "TQQQ 40분할",
      accountNumber: "U1111111",
      created: "2026-01-15T00:00:00.000Z",
      updated: "2026-06-27T12:00:00.000Z",
      settings: {
        method: "V2.2",
        splits: 40,
        sellRatio: 12,
        partialSellRatio: 6,
        additionalBuy: {
          enabled: true,
          mode: "budget_ratio",
          budgetRatio: 20,
          allowOneOver: true,
          deadZoneGuardEnabled: true,
          maxDecline: 15,
          quantity: 1,
          orderCount: 8,
        },
      },
      stocks: [
        {
          symbol: "TQQQ",
          principal: 100000000,
          divisions: 40,
          sellPercent: 12,
          enabled: true,
        },
      ],
    },
  },
};

export const PROFILE_SOXL_CUSTOM = {
  version: "1.0",
  activeProfileId: SOXL_12PCT_PROFILE_ID,
  profiles: {
    [SOXL_12PCT_PROFILE_ID]: {
      id: SOXL_12PCT_PROFILE_ID,
      name: "SOXL 12% 매도",
      accountNumber: "U2222222",
      created: "2026-02-01T00:00:00.000Z",
      updated: "2026-06-27T12:00:00.000Z",
      settings: {
        method: "V2.2",
        splits: 40,
        sellRatio: 10,
        partialSellRatio: 5,
        additionalBuy: {
          enabled: false,
          mode: "budget_ratio",
          budgetRatio: 20,
          allowOneOver: true,
          deadZoneGuardEnabled: true,
          maxDecline: 15,
          quantity: 1,
          orderCount: 8,
        },
      },
      stocks: [
        {
          symbol: "SOXL",
          principal: 50000000,
          divisions: 40,
          sellPercent: 10,
          enabled: true,
        },
      ],
    },
  },
};

export const PROFILE_MULTI = {
  version: "1.0",
  activeProfileId: MULTI_PROFILE_ID,
  profiles: {
    [MULTI_PROFILE_ID]: {
      id: MULTI_PROFILE_ID,
      name: "멀티 티커",
      accountNumber: "U3333333",
      created: "2026-03-10T00:00:00.000Z",
      updated: "2026-06-27T12:00:00.000Z",
      settings: {
        method: "V2.2",
        splits: 40,
        sellRatio: 12,
        partialSellRatio: 6,
        additionalBuy: {
          enabled: true,
          mode: "budget_ratio",
          budgetRatio: 20,
          allowOneOver: true,
          deadZoneGuardEnabled: true,
          maxDecline: 15,
          quantity: 1,
          orderCount: 8,
        },
      },
      stocks: [
        {
          symbol: "TQQQ",
          principal: 80000000,
          divisions: 40,
          sellPercent: 12,
          enabled: true,
        },
        {
          symbol: "SOXL",
          principal: 40000000,
          divisions: 30,
          sellPercent: 10,
          enabled: true,
        },
        {
          symbol: "UPRO",
          principal: 30000000,
          divisions: 40,
          sellPercent: 8,
          enabled: false,
        },
      ],
    },
  },
};

// Daily data key format: ib_daily_data_<profileId>_<symbol>
// T value (derived by V2 calculator): T = totalInvested / (holdings * currentPrice)
// T comes from the IB Helper formula: (총매입금 - 평가금) / 분할횟수 = 실행금액, inverted
// PHASES: T=0 fresh start, 0<T<20 accumulating, T>=20 active, T>40 over-invested

export const DAILY_TQQQ_T0 = {
  storageKey: `ib_daily_data_${TQQQ_40DIV_PROFILE_ID}_TQQQ`,
  payload: {
    totalInvested: 0,
    holdings: 0,
    currentPrice: 40000,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  expectedT: 0,
  expectedPhase: "fresh_start",
};

export const DAILY_TQQQ_ACCUMULATING = {
  storageKey: `ib_daily_data_${TQQQ_40DIV_PROFILE_ID}_TQQQ`,
  payload: {
    totalInvested: 5000000,
    holdings: 20,
    currentPrice: 41000,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  // T = 5000000 / (20 * 41000) = 5000000/820000 ≈ 6.1
  expectedT: 6.1,
  expectedPhase: "accumulating",
};

export const DAILY_TQQQ_ACTIVE = {
  storageKey: `ib_daily_data_${TQQQ_40DIV_PROFILE_ID}_TQQQ`,
  payload: {
    totalInvested: 45000000,
    holdings: 55,
    currentPrice: 40500,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  // T = 45000000 / (55 * 40500) = 45000000/2227500 ≈ 20.2
  expectedT: 20.2,
  expectedPhase: "active",
};

export const DAILY_TQQQ_OVER = {
  storageKey: `ib_daily_data_${TQQQ_40DIV_PROFILE_ID}_TQQQ`,
  payload: {
    totalInvested: 100000000,
    holdings: 60,
    currentPrice: 39000,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  // T = 100000000 / (60 * 39000) = 100000000/2340000 ≈ 42.7
  expectedT: 42.7,
  expectedPhase: "over_invested",
};

export const DAILY_SOXL_ACTIVE = {
  storageKey: `ib_daily_data_${SOXL_12PCT_PROFILE_ID}_SOXL`,
  payload: {
    totalInvested: 25000000,
    holdings: 30,
    currentPrice: 40000,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  // T = 25000000 / (30 * 40000) = 25000000/1200000 ≈ 20.8
  expectedT: 20.8,
  expectedPhase: "active",
};

export const DAILY_SOXL_ACCUMULATING = {
  storageKey: `ib_daily_data_${SOXL_12PCT_PROFILE_ID}_SOXL`,
  payload: {
    totalInvested: 3000000,
    holdings: 15,
    currentPrice: 42000,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  // T = 3000000 / (15 * 42000) = 3000000/630000 ≈ 4.8
  expectedT: 4.8,
  expectedPhase: "accumulating",
};

export const DAILY_MULTI_TQQQ = {
  storageKey: `ib_daily_data_${MULTI_PROFILE_ID}_TQQQ`,
  payload: {
    totalInvested: 30000000,
    holdings: 40,
    currentPrice: 41000,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  expectedT: 18.3,
  expectedPhase: "accumulating",
};

export const DAILY_MULTI_SOXL = {
  storageKey: `ib_daily_data_${MULTI_PROFILE_ID}_SOXL`,
  payload: {
    totalInvested: 20000000,
    holdings: 25,
    currentPrice: 40000,
    date: "2026-06-27",
    timestamp: "2026-06-27T12:00:00.000Z",
  },
  expectedT: 20.0,
  expectedPhase: "active",
};
