#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  shortTermCommonBasisCopy,
} from "../src/lib/fenok-signals/conviction-basis-copy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
assert.deepEqual(shortTermCommonBasisCopy("us", {
  sourceInputCount: 5,
  basisCode: "us_enriched_v1",
}), {
  marketScope: "us",
  marketLabel: "미국",
  inputCount: 3,
  sourceInputCount: 5,
  basisCode: "us_enriched_v1",
  label: "미국 · 공통 3개 입력 기준",
  detail: "미국 종목의 단기 점수는 시장 공통 3개 입력으로 계산합니다. 원천 5개 입력 · 산출 기준 us_enriched_v1.",
  comparisonNote: "동일한 공통 3개 입력 기준이므로 시장 간 직접 비교할 수 있습니다.",
});
assert.deepEqual(shortTermCommonBasisCopy("KOREA", {
  sourceInputCount: 3,
  basisCode: "common_3input_v1",
}), {
  marketScope: "korea",
  marketLabel: "한국",
  inputCount: 3,
  sourceInputCount: 3,
  basisCode: "common_3input_v1",
  label: "한국 · 공통 3개 입력 기준",
  detail: "한국 종목의 단기 점수는 시장 공통 3개 입력으로 계산합니다. 원천 3개 입력 · 산출 기준 common_3input_v1.",
  comparisonNote: "동일한 공통 3개 입력 기준이므로 시장 간 직접 비교할 수 있습니다.",
});
assert.deepEqual(shortTermCommonBasisCopy(null), {
  marketScope: "unknown",
  marketLabel: "시장 미확인",
  inputCount: 3,
  sourceInputCount: null,
  basisCode: null,
  label: "시장 미확인 · 공통 3개 입력 기준",
  detail: "시장 미확인 종목의 단기 점수는 시장 공통 3개 입력으로 계산합니다.",
  comparisonNote: "동일한 공통 3개 입력 기준이므로 시장 간 직접 비교할 수 있습니다.",
});

for (const relativePath of [
  "src/app/screener/ScreenerClient.tsx",
  "src/app/screener/StockDetailPanel.tsx",
  "src/app/stock/[ticker]/StockDetailClient.tsx",
]) {
  const source = fs.readFileSync(path.join(appRoot, relativePath), "utf8");
  assert.match(source, /shortTermCommonBasisCopy/, `${relativePath} must use the common-basis copy builder`);
  assert.match(source, /shortTermBasis\.label/, `${relativePath} must render the market-specific basis label`);
  assert.match(source, /sourceInputCount/, `${relativePath} must expose source input-count context`);
  assert.match(source, /basisCode/, `${relativePath} must expose source basis-code context`);
}

const basisCopySource = fs.readFileSync(path.join(appRoot, "src/lib/fenok-signals/conviction-basis-copy.mjs"), "utf8");
assert.doesNotMatch(basisCopySource, /shortTermConvictionBasisCopy|직접 비교할 수 없습니다/, "legacy non-comparable disclosure must be retired after all consumers flip");

const screenerHook = fs.readFileSync(path.join(appRoot, "src/hooks/useScreenerData.ts"), "utf8");
const screenerTypes = fs.readFileSync(path.join(appRoot, "src/lib/screener/types.ts"), "utf8");
assert.match(screenerHook, /fenokMarketScope:\s*fenokSignal\?\.marketScope\s*\?\?\s*null/, "screener rows must retain the source market scope");
assert.match(screenerTypes, /fenokMarketScope\?:\s*string\s*\|\s*null/, "screener market scope must be typed explicitly");

console.log("[test-fenok-conviction-basis-copy] OK");
