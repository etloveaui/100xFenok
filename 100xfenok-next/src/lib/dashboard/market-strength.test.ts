import assert from "node:assert/strict";
import { marketStrength } from "./market-strength";

function test(name: string, run: () => void): void {
  run();
  console.log(`ok - ${name}`);
}

const rows = (n: number) => Array.from({ length: n }, () => ({})) as never[];

test("blends sentiment, breadth and stress relief with the home weights", () => {
  // 0.45*0.40 + 0.35*(5/11) + 0.20*(1-0.30) = 0.479 -> 중립 48
  const read = marketStrength({ sectorRows: rows(11), sectorUp: 5, fearGreedScore: 40, stressScore: 0.3 });
  assert.deepEqual(read, { label: "중립", confidence: 48, breadth: 45 });
});

test("labels follow the 0.62 / 0.45 cuts and the score is clamped", () => {
  assert.equal(marketStrength({ sectorRows: rows(11), sectorUp: 11, fearGreedScore: 100, stressScore: 0 }).label, "위험 선호");
  assert.equal(marketStrength({ sectorRows: rows(11), sectorUp: 0, fearGreedScore: 10, stressScore: 1 }).label, "방어");
  assert.equal(marketStrength({ sectorRows: rows(11), sectorUp: 30, fearGreedScore: 200, stressScore: -1 }).confidence, 100);
});

test("an empty sector list never divides by zero", () => {
  assert.equal(marketStrength({ sectorRows: [], sectorUp: 0, fearGreedScore: 50, stressScore: 0.5 }).breadth, 0);
});
