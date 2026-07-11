#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MS_PER_DAY = 86_400_000;
const MONDAY_EPOCH_UTC = Date.UTC(1970, 0, 5);

export function businessDayOrdinalUtc(value) {
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new TypeError("date must be valid");
  const utcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMondayEpoch = Math.floor((utcDay - MONDAY_EPOCH_UTC) / MS_PER_DAY);
  const fullWeeks = Math.floor(daysSinceMondayEpoch / 7);
  const weekday = ((daysSinceMondayEpoch % 7) + 7) % 7;
  return fullWeeks * 5 + Math.min(weekday, 4);
}

export function selectStockAnalysisDaily1yOffset({ tickerCount, limit, now = new Date() }) {
  const normalizedCount = Number(tickerCount);
  const normalizedLimit = Number(limit);
  if (!Number.isInteger(normalizedCount) || normalizedCount < 0) {
    throw new TypeError("tickerCount must be a non-negative integer");
  }
  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
    throw new TypeError("limit must be a positive integer");
  }
  const shardCount = Math.max(1, Math.ceil(normalizedCount / normalizedLimit));
  const shardIndex = ((businessDayOrdinalUtc(now) % shardCount) + shardCount) % shardCount;
  return { shardCount, shardIndex, offset: shardIndex * normalizedLimit };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const planPath = process.argv[2] ?? "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json";
  const limit = Math.max(1, Number(process.env.STOCKANALYSIS_DAILY1Y_INCREMENTAL_LIMIT || 120) || 120);
  let tickerCount = 0;
  try {
    const payload = JSON.parse(fs.readFileSync(planPath, "utf8"));
    tickerCount = Array.isArray(payload.tickers) ? payload.tickers.length : 0;
  } catch {
    tickerCount = 0;
  }
  process.stdout.write(String(selectStockAnalysisDaily1yOffset({ tickerCount, limit }).offset));
}
