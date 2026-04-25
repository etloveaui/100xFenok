#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THRESHOLDS,
  computeBankingHealthSnapshot,
  computeLiquidityFlowSnapshot,
  computeLiquidityStressSnapshot,
  computeSentimentSignalSnapshot,
  latestDate,
  normalizeSeries
} from '../tools/macro-monitor/shared/signals-core.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUT_REL = 'data/computed/signals.json';
const NEXT_OUT_REL = '100xfenok-next/public/data/computed/signals.json';

const SOURCE_FILES = {
  liquidity_flow: [
    'data/macro/fred-macro.json',
    'data/macro/tga.json',
    'data/macro/stablecoins.json'
  ],
  liquidity_stress: [
    'data/macro/fred-macro.json'
  ],
  banking_health: [
    'data/macro/fred-banking-daily.json',
    'data/macro/fred-banking-weekly.json',
    'data/macro/fred-banking-quarterly.json',
    'data/macro/fdic-tier1.json'
  ],
  sentiment_signal: [
    'data/sentiment/vix.json',
    'data/sentiment/move.json',
    'data/sentiment/cnn-fear-greed.json',
    'data/sentiment/aaii.json',
    'data/sentiment/cftc-sp500.json',
    'data/sentiment/crypto-fear-greed.json',
    'data/sentiment/cnn-put-call.json',
    'data/sentiment/cnn-components.json'
  ]
};

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
}

function readJsonIfExists(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function writeJson(relPath, payload) {
  const target = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
}

function stablePayloadForCompare(payload) {
  return JSON.stringify({
    ...payload,
    generated_at: null
  });
}

function seriesFromFred(payload, seriesId) {
  return normalizeSeries(payload?.series?.[seriesId] ?? []);
}

function latestRaw(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[rows.length - 1] ?? null;
}

function latestNumber(rows, key) {
  const latest = latestRaw(rows);
  const value = latest?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function maxDate(...dates) {
  const valid = dates.filter(Boolean).sort();
  return valid[valid.length - 1] ?? null;
}

function buildSentimentValues() {
  const vix = readJson('data/sentiment/vix.json');
  const move = readJson('data/sentiment/move.json');
  const cnn = readJson('data/sentiment/cnn-fear-greed.json');
  const aaii = readJson('data/sentiment/aaii.json');
  const cftc = readJson('data/sentiment/cftc-sp500.json');
  const crypto = readJson('data/sentiment/crypto-fear-greed.json');
  const putcall = readJson('data/sentiment/cnn-put-call.json');

  const latestAaii = latestRaw(aaii);
  const aaiiSpread = typeof latestAaii?.spread === 'number'
    ? latestAaii.spread
    : ((latestAaii?.bullish ?? 0) - (latestAaii?.bearish ?? 0));

  return {
    values: {
      vix: latestNumber(vix, 'value'),
      move: latestNumber(move, 'value'),
      cnn_fg: latestNumber(cnn, 'score'),
      aaii_bearish: latestNumber(aaii, 'bearish'),
      aaii_spread: aaiiSpread,
      cftc_net: latestNumber(cftc, 'net'),
      crypto_fg: latestNumber(crypto, 'value'),
      putcall_ratio: latestNumber(putcall, 'value')
    },
    as_of: maxDate(
      latestRaw(vix)?.date,
      latestRaw(move)?.date,
      latestRaw(cnn)?.date,
      latestRaw(aaii)?.date,
      latestRaw(cftc)?.date,
      latestRaw(crypto)?.date,
      latestRaw(putcall)?.date
    )
  };
}

function buildSignals() {
  const fredMacro = readJson('data/macro/fred-macro.json');
  const fredBankingDaily = readJson('data/macro/fred-banking-daily.json');
  const fredBankingWeekly = readJson('data/macro/fred-banking-weekly.json');
  const fredBankingQuarterly = readJson('data/macro/fred-banking-quarterly.json');
  const fdicTier1 = readJson('data/macro/fdic-tier1.json');
  const tga = readJson('data/macro/tga.json');
  const stablecoins = readJson('data/macro/stablecoins.json');

  const m2 = seriesFromFred(fredMacro, 'M2SL');
  const fedBs = seriesFromFred(fredMacro, 'WALCL');
  const rrp = seriesFromFred(fredMacro, 'RRPONTSYD');
  const sofr = seriesFromFred(fredMacro, 'SOFR');
  const iorb = seriesFromFred(fredMacro, 'IORB');
  const reserves = seriesFromFred(fredMacro, 'WRESBAL');
  const gdp = seriesFromFred(fredMacro, 'GDP');
  const dailyTga = normalizeSeries(tga?.series ?? [], 'val');

  const stablecoinSeries = normalizeSeries(stablecoins?.series ?? [], 'val');
  const stablecoin = {
    current: stablecoins?.current ?? latestRaw(stablecoinSeries)?.val ?? 0,
    series: stablecoinSeries
  };

  const delinquency = seriesFromFred(fredBankingQuarterly, 'DRALACBN');
  const loans = seriesFromFred(fredBankingWeekly, 'TOTLL');
  const deposits = seriesFromFred(fredBankingWeekly, 'DPSACBW027SBOG');
  const fedTier1 = seriesFromFred(fredBankingQuarterly, 'BOGZ1FL010000016Q');
  const fdicTier1Series = normalizeSeries(fdicTier1?.data ?? []);

  const liquidityFlow = computeLiquidityFlowSnapshot({ m2, fedBs, tga: dailyTga, rrp, stablecoin });
  const liquidityStress = computeLiquidityStressSnapshot({ sofr, iorb, reserves, gdp });
  const bankingHealth = computeBankingHealthSnapshot({
    delinquency,
    loans,
    deposits,
    fedTier1,
    fdicTier1: fdicTier1Series
  });

  const sentimentInputs = buildSentimentValues();
  const sentimentSignal = computeSentimentSignalSnapshot(sentimentInputs.values);
  sentimentSignal.as_of = sentimentInputs.as_of;

  return {
    liquidity_flow: {
      ...liquidityFlow,
      source_files: SOURCE_FILES.liquidity_flow,
      threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#THRESHOLDS'
    },
    liquidity_stress: {
      ...liquidityStress,
      source_files: SOURCE_FILES.liquidity_stress,
      threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#THRESHOLDS'
    },
    banking_health: {
      ...bankingHealth,
      source_files: SOURCE_FILES.banking_health,
      threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#THRESHOLDS'
    },
    sentiment_signal: {
      ...sentimentSignal,
      source_files: SOURCE_FILES.sentiment_signal,
      threshold_ref: 'tools/macro-monitor/shared/signals-core.mjs#COMBO_SIGNALS'
    }
  };
}

const signals = buildSignals();
const payload = {
  schema_version: '1.0.0',
  generated_at: new Date().toISOString(),
  as_of: latestDate(
    [{ date: signals.liquidity_flow.as_of, val: 1 }],
    [{ date: signals.liquidity_stress.as_of, val: 1 }],
    [{ date: signals.banking_health.as_of, val: 1 }],
    [{ date: signals.sentiment_signal.as_of, val: 1 }]
  ),
  engine: {
    name: 'macro-monitor-computed-signals',
    version: '1.0.0',
    rules: 'tools/macro-monitor/shared/signals-core.mjs'
  },
  source_files: Array.from(new Set(Object.values(SOURCE_FILES).flat())).sort(),
  thresholds: {
    liquidity_flow: {
      m2_yoy: THRESHOLDS.M2_YOY,
      net_liquidity: THRESHOLDS.NET_LIQUIDITY,
      stablecoin: THRESHOLDS.STABLECOIN,
      overall: THRESHOLDS.OVERALL
    },
    liquidity_stress: {
      spread: THRESHOLDS.SPREAD,
      reserves_gdp: THRESHOLDS.RESERVES_GDP
    },
    banking_health: {
      delinquency: THRESHOLDS.DELINQUENCY,
      tier1_ratio: THRESHOLDS.TIER1_RATIO,
      loan_deposit: THRESHOLDS.LOAN_DEPOSIT,
      loan_growth: THRESHOLDS.LOAN_GROWTH
    }
  },
  signals
};

const existingPayload = readJsonIfExists(OUT_REL);
if (
  existingPayload
  && stablePayloadForCompare(existingPayload) === stablePayloadForCompare(payload)
  && typeof existingPayload.generated_at === 'string'
) {
  payload.generated_at = existingPayload.generated_at;
}

writeJson(OUT_REL, payload);
writeJson(NEXT_OUT_REL, payload);
console.log(`Wrote ${OUT_REL}`);
console.log(`Mirrored ${NEXT_OUT_REL}`);
