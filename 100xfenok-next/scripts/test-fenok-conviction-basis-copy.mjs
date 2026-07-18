#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shortTermConvictionBasisCopy } from "../src/lib/fenok-signals/conviction-basis-copy.mjs";

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

for (const relativePath of [
  "src/app/screener/ScreenerClient.tsx",
  "src/app/screener/StockDetailPanel.tsx",
  "src/app/stock/[ticker]/StockDetailClient.tsx",
]) {
  const source = fs.readFileSync(path.join(appRoot, relativePath), "utf8");
  assert.match(source, /shortTermConvictionBasisCopy/, `${relativePath} must use the shared basis-copy builder`);
  assert.match(source, /shortTermBasis\.label/, `${relativePath} must render the market-specific basis label`);
}

const screenerHook = fs.readFileSync(path.join(appRoot, "src/hooks/useScreenerData.ts"), "utf8");
const screenerTypes = fs.readFileSync(path.join(appRoot, "src/lib/screener/types.ts"), "utf8");
assert.match(screenerHook, /fenokMarketScope:\s*fenokSignal\?\.marketScope\s*\?\?\s*null/, "screener rows must retain the source market scope");
assert.match(screenerTypes, /fenokMarketScope\?:\s*string\s*\|\s*null/, "screener market scope must be typed explicitly");

console.log("[test-fenok-conviction-basis-copy] OK");
