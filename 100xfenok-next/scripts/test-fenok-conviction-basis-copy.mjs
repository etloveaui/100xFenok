#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  shortTermCommonBasisCopy,
  shortTermConvictionBasisCopy,
} from "../src/lib/fenok-signals/conviction-basis-copy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const comparisonNote = "시장별 입력 수가 달라 점수를 직접 비교할 수 없습니다.";

assert.deepEqual(shortTermConvictionBasisCopy("us"), {
  marketScope: "us",
  marketLabel: "미국",
  inputCount: 5,
  label: "미국 · 최대 5개 입력 기준",
  detail: "미국 종목의 단기 점수는 최대 5개 입력까지 반영할 수 있습니다.",
  comparisonNote,
});
assert.deepEqual(shortTermConvictionBasisCopy("KOREA"), {
  marketScope: "korea",
  marketLabel: "한국",
  inputCount: 3,
  label: "한국 · 최대 3개 공통 입력 기준",
  detail: "한국 종목의 단기 점수는 최대 3개 공통 입력까지 반영할 수 있습니다.",
  comparisonNote,
});
assert.deepEqual(shortTermConvictionBasisCopy(" asia "), {
  marketScope: "asia",
  marketLabel: "아시아",
  inputCount: 3,
  label: "아시아 · 최대 3개 공통 입력 기준",
  detail: "아시아 종목의 단기 점수는 최대 3개 공통 입력까지 반영할 수 있습니다.",
  comparisonNote,
});
assert.deepEqual(shortTermConvictionBasisCopy("raw_unknown_market"), {
  marketScope: "unknown",
  marketLabel: "시장 미확인",
  inputCount: null,
  label: "시장 미확인 · 입력 기준 미확인",
  detail: "시장 기준을 확인할 수 없어 반영 입력 수를 확인할 수 없습니다.",
  comparisonNote,
});
assert.deepEqual(shortTermConvictionBasisCopy(null), shortTermConvictionBasisCopy("unknown"));

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
]) {
  const source = fs.readFileSync(path.join(appRoot, relativePath), "utf8");
  assert.match(source, /shortTermCommonBasisCopy/, `${relativePath} must use the common-basis copy builder`);
  assert.match(source, /shortTermBasis\.label/, `${relativePath} must render the market-specific basis label`);
  assert.match(source, /sourceInputCount/, `${relativePath} must expose source input-count context`);
  assert.match(source, /basisCode/, `${relativePath} must expose source basis-code context`);
}

const stockDetailClient = fs.readFileSync(path.join(appRoot, "src/app/stock/[ticker]/StockDetailClient.tsx"), "utf8");
assert.match(stockDetailClient, /shortTermConvictionBasisCopy/, "the direct stock-detail path must retain legacy disclosure until slice 3");
assert.doesNotMatch(stockDetailClient, /shortTermCommonBasisCopy/, "slice 2 must not flip the direct stock-detail path");

const screenerHook = fs.readFileSync(path.join(appRoot, "src/hooks/useScreenerData.ts"), "utf8");
const screenerTypes = fs.readFileSync(path.join(appRoot, "src/lib/screener/types.ts"), "utf8");
assert.match(screenerHook, /fenokMarketScope:\s*fenokSignal\?\.marketScope\s*\?\?\s*null/, "screener rows must retain the source market scope");
assert.match(screenerTypes, /fenokMarketScope\?:\s*string\s*\|\s*null/, "screener market scope must be typed explicitly");

console.log("[test-fenok-conviction-basis-copy] OK");
