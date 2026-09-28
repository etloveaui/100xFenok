import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPercentPoints, rotationPoints, spreadReadLine } from "./rotation";
import type { SectorRow } from "./types";

function row(key: string, name: string, oneMonth: number): SectorRow {
  return {
    key,
    etf: key.toUpperCase(),
    name,
    momentum: { "1m": oneMonth },
    dayChange: null,
    price: null,
    marketState: null,
    etfInfo: null,
    valuation: null,
    smartMoney: null,
  };
}

// S&P 500 1m = +2.0%. Tech beats it by 4.1%p, materials trail it by 6.08%p.
const BENCHMARK_1M = 0.02;
const ROWS = [
  row("xlk", "정보기술", 0.061),
  row("xlv", "헬스케어", 0.025),
  row("xlb", "소재", -0.0408),
];

test("rotationPoints returns relative momentum in percentage points", () => {
  const points = rotationPoints(ROWS, "1m", BENCHMARK_1M);
  assert.equal(points.length, 3);
  assert.equal(points[0].row.name, "정보기술");
  assert.ok(Math.abs(points[0].relative - 4.1) < 1e-9);
  assert.ok(Math.abs(points[2].relative - -6.08) < 1e-9);
});

test("formatPercentPoints does not rescale values that are already %p", () => {
  assert.equal(formatPercentPoints(4.1), "+4.1%p");
  assert.equal(formatPercentPoints(-6.08), "-6.1%p");
  assert.equal(formatPercentPoints(0), "+0.0%p");
  assert.equal(formatPercentPoints(Number.NaN), "—");
});

// Regression: the /sectors spread strip printed "+410.0%p" / "-608.0%p" because
// %p values went through the fraction formatter (a second ×100).
test("spread read line keeps strongest/weakest/gap on the same %p scale", () => {
  const line = spreadReadLine(rotationPoints(ROWS, "1m", BENCHMARK_1M), "1개월");
  assert.equal(line, "1개월 기준 최강 정보기술 +4.1%p · 최약 소재 -6.1%p · 격차 10.2%p입니다.");
  assert.doesNotMatch(line ?? "", /\d{3}\.\d%p/);
});

test("spread read line handles one or zero measured sectors", () => {
  assert.equal(spreadReadLine([], "1개월"), null);
  const single = rotationPoints([ROWS[0]], "1m", BENCHMARK_1M);
  assert.equal(spreadReadLine(single, "1개월"), "1개월 기준 정보기술 +4.1%p 한 곳만 값이 확보됐습니다.");
});
