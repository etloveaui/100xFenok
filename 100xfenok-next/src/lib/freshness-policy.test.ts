import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FAMILY_POLICY, freshnessAgeOverride, freshnessMessage, freshnessRailState, freshnessVerdict } from "./freshness-policy.mjs";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

test("weekly owner file: fresh <= 13, delayed 14-20, stopped >= 21", () => {
  const asOf = "2026-09-18";
  const cases: Array<[number, string]> = [
    [9, "fresh"],
    [13, "fresh"],
    [14, "delayed"],
    [20, "delayed"],
    [21, "stopped"],
  ];
  for (const [age, expected] of cases) {
    const verdict = freshnessVerdict(asOf, "benchmarks", addDays(asOf, age));
    assert.equal(verdict.state, expected, `day ${age}`);
    assert.equal(verdict.ageDays, age);
    assert.equal(verdict.supplier, "owner");
    assert.equal(verdict.cadence, "weekly");
  }
});

test("daily family counts trading days across a weekend", () => {
  const daily = { cadence: "daily", releaseLagDays: 0, supplier: "automated", calendar: "us_trading" } as const;
  const friday = "2026-09-18";
  assert.equal(freshnessVerdict(friday, daily, "2026-09-19").ageDays, 0); // Saturday
  assert.equal(freshnessVerdict(friday, daily, "2026-09-20").ageDays, 0); // Sunday
  const monday = freshnessVerdict(friday, daily, "2026-09-21");
  assert.equal(monday.ageDays, 1);
  assert.equal(monday.state, "fresh");
  const nextFriday = freshnessVerdict(friday, daily, "2026-09-25");
  assert.equal(nextFriday.ageDays, 5);
  assert.equal(nextFriday.state, "stopped");
});

test("unknown dates and unknown families read unknown", () => {
  for (const value of [null, undefined, "", "not-a-date", "2026-13"]) {
    const verdict = freshnessVerdict(value, "global_scouter", "2026-09-27");
    assert.equal(verdict.state, "unknown", String(value));
    assert.equal(verdict.ageDays, null);
  }
  assert.equal(freshnessVerdict("2026-09-18", "no-such-family", "2026-09-27").state, "unknown");
});

test("wording follows supplier and state", () => {
  assert.equal(freshnessMessage({ state: "delayed", supplier: "owner", ageDays: 15 }), "이번 주 자료 대기");
  assert.equal(freshnessMessage({ state: "stopped", supplier: "owner", ageDays: 22 }), "2주 넘게 새 자료 없음");
  assert.equal(freshnessMessage({ state: "delayed", supplier: "automated", ageDays: 4 }), "수집 지연");
  assert.equal(freshnessMessage({ state: "stopped", supplier: "automated", ageDays: 9 }), "수집 멈춤");
  assert.equal(freshnessMessage({ state: "fresh", supplier: "owner", ageDays: 3 }), null);
  assert.equal(freshnessMessage(null), null);
});

test("rail mapping: delayed -> stale, stopped -> error, carrying the verdict's words", () => {
  assert.deepEqual(freshnessRailState({ state: "delayed", supplier: "owner", ageDays: 15 }), {
    freshness: "stale",
    label: "이번 주 자료 대기",
  });
  assert.deepEqual(freshnessRailState({ state: "stopped", supplier: "owner", ageDays: 22 }), {
    freshness: "error",
    label: "2주 넘게 새 자료 없음",
  });
  assert.deepEqual(freshnessRailState({ state: "fresh", supplier: "owner", ageDays: 3 }), {
    freshness: "fresh",
    label: null,
  });
  assert.equal(freshnessRailState({ state: "unknown", supplier: "owner", ageDays: null }), null);
});

test("age override only ever worsens: fresh/unknown -> null", () => {
  assert.equal(freshnessAgeOverride({ state: "fresh", supplier: "owner", ageDays: 3 }), null);
  assert.equal(freshnessAgeOverride({ state: "unknown", supplier: "owner", ageDays: null }), null);
  assert.deepEqual(freshnessAgeOverride({ state: "delayed", supplier: "owner", ageDays: 15 }), {
    freshness: "stale",
    label: "이번 주 자료 대기",
  });
  assert.deepEqual(freshnessAgeOverride({ state: "stopped", supplier: "owner", ageDays: 22 }), {
    freshness: "error",
    label: "2주 넘게 새 자료 없음",
  });
});

test("lane-registry drift guard: matching ids keep the same cadence kind", () => {
  // Parsed, not imported: the registry pulls node:crypto and sibling script
  // modules and runs its own validating load; the guard only needs the record
  // text. Records start with `record({`; providers are plain object literals,
  // so the anchor below skips the provider entry of a shared id.
  const registryPath = path.resolve(import.meta.dirname, "../../../scripts/lib/lane-registry.mjs");
  const text = fs.readFileSync(registryPath, "utf8");

  function laneCadenceKind(id: string): string | null {
    const anchor = `id: "${id}",`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(anchor, from);
      if (at < 0) return null;
      const recordAt = text.lastIndexOf("record({", at);
      if (recordAt >= 0 && at - recordAt < 240) {
        const cadenceAt = text.indexOf("cadence: {", at);
        if (cadenceAt >= 0 && cadenceAt - at < 1600) {
          const kindAt = text.indexOf('kind: "', cadenceAt);
          if (kindAt >= 0 && kindAt - cadenceAt < 160) {
            return text.slice(kindAt + 7, text.indexOf('"', kindAt + 7));
          }
        }
        return null;
      }
      from = at + anchor.length;
    }
  }

  for (const id of Object.keys(FAMILY_POLICY)) {
    const kind = laneCadenceKind(id);
    if (kind === null) continue; // no lane record for this id; nothing to drift against
    assert.equal(kind, FAMILY_POLICY[id].cadence, `${id}: lane=${kind} policy=${FAMILY_POLICY[id].cadence}`);
  }
});
