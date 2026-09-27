import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FAMILY_POLICY, freshnessAgeOverride, freshnessMessage, freshnessRailState, freshnessVerdict, policyToday, resolveSourcePolicy, sourceAgeAnchor } from "./freshness-policy.mjs";

const calendars = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../scripts/lib/data-supply-detection-calendars.json"), "utf8"));

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

test("implicit UI and explicit detector clocks agree across civil midnight", (t) => {
  const now = new Date("2026-10-01T16:30:00Z"); // October 2 in Seoul, October 1 UTC.
  t.mock.timers.enable({ apis: ["Date"], now });
  const ownerToday = policyToday(now, FAMILY_POLICY.benchmarks);
  assert.equal(ownerToday, "2026-10-01");
  const implicit = freshnessVerdict("2026-09-18", "benchmarks");
  assert.deepEqual(implicit, freshnessVerdict("2026-09-18", "benchmarks", ownerToday));
  assert.equal(implicit.ageDays, 13);
  assert.equal(implicit.state, "fresh");

  t.mock.timers.setTime(new Date("2026-10-02T02:30:00Z").getTime());
  const federalToday = policyToday(new Date(), FAMILY_POLICY.treasury_tga);
  assert.equal(federalToday, "2026-10-01");
  assert.deepEqual(
    freshnessVerdict("2026-10-01", "treasury_tga", undefined, { calendars }),
    freshnessVerdict("2026-10-01", "treasury_tga", federalToday, { calendars }),
  );
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

test("US and KRX holidays do not accrue source age", () => {
  const us = { cadence: "daily", releaseLagDays: 0, supplier: "automated", calendar: "us_trading" } as const;
  const kr = { ...us, calendar: "kr_trading" } as const;
  assert.equal(freshnessVerdict("2026-09-04", us, "2026-09-07").ageDays, 0); // US Labor Day
  assert.equal(freshnessVerdict("2026-09-23", kr, "2026-09-25").ageDays, 0); // Chuseok
  assert.equal(freshnessVerdict("2026-06-02", kr, "2026-06-03").ageDays, 0); // Local election
  assert.equal(freshnessVerdict("2026-06-02", kr, "2026-06-04").ageDays, 1);
});

test("KRX daily source age uses Seoul trading days with no release lag", () => {
  const policy = resolveSourcePolicy({ laneId: "krx", cadence: "daily" })!;
  assert.equal(policy, FAMILY_POLICY.krx);
  assert.equal(policy.calendar, "kr_trading");
  assert.equal(policy.releaseLagDays, 0);
  for (const [source, age, state] of [
    ["2026-09-23", 0, "fresh"], // Chuseok and weekend add no age.
    ["2026-09-22", 1, "fresh"],
    ["2026-09-21", 2, "fresh"],
    ["2026-09-18", 3, "delayed"],
    ["2026-09-17", 4, "stopped"],
  ] as const) {
    assert.deepEqual(freshnessVerdict(source, policy, "2026-09-27"), {
      state, ageDays: age, supplier: "automated", cadence: "daily",
    });
  }
  const beforeSeoulMidnight = "2026-09-27T14:30:00Z";
  const afterSeoulMidnight = "2026-09-27T15:30:00Z";
  assert.equal(policyToday(beforeSeoulMidnight, policy), "2026-09-27");
  assert.equal(policyToday(afterSeoulMidnight, policy), "2026-09-28");
  assert.equal(freshnessVerdict("2026-09-21", policy, policyToday(beforeSeoulMidnight, policy)).state, "fresh");
  assert.equal(freshnessVerdict("2026-09-21", policy, policyToday(afterSeoulMidnight, policy)).state, "delayed");
  assert.equal(freshnessVerdict("2026-09-28", policy, policyToday(beforeSeoulMidnight, policy)).state, "unknown");
  assert.equal(freshnessVerdict("2026-02-30", policy, "2026-09-27").state, "unknown");
});

test("TGA uses federal holidays, not NYSE closures", () => {
  assert.equal(freshnessVerdict("2026-10-09", "treasury_tga", "2026-10-13", { calendars }).ageDays, 1);
  assert.equal(freshnessVerdict("2026-10-09", "treasury_tga", "2026-10-13").state, "unknown");
});

test("week-start FINRA and quarter-start FSI retain raw date but age from period end", () => {
  const finra = resolveSourcePolicy({ laneId: "finra_ats_weekly", cadence: "weekly" })!;
  assert.equal(sourceAgeAnchor("2026-08-17", finra), "2026-08-23");
  assert.equal(freshnessVerdict("2026-08-17", finra, "2026-09-27").state, "fresh");
  assert.equal(freshnessVerdict("2026-08-17", finra, "2026-10-02").state, "delayed");
  const fsi = resolveSourcePolicy({ artifactId: "fred_banking_quarterly" })!;
  assert.equal(sourceAgeAnchor("2026-01-01", fsi), "2026-03-31");
  assert.equal(freshnessVerdict("2026-01-01", fsi, "2026-09-27").state, "fresh");
  assert.equal(freshnessVerdict("2025-01-01", fsi, "2026-09-27").state, "stopped");
});

test("FRED files use independent daily, weekly and monthly clocks", () => {
  const daily = resolveSourcePolicy({ artifactId: "fred_banking_daily" })!;
  const weekly = resolveSourcePolicy({ artifactId: "fred_banking_weekly" })!;
  const monthly = resolveSourcePolicy({ artifactId: "fred_banking_monthly" })!;
  assert.equal(freshnessVerdict("2026-09-23", daily, "2026-09-27").state, "fresh");
  assert.equal(freshnessVerdict("2026-09-09", weekly, "2026-09-27").state, "fresh");
  assert.equal(freshnessVerdict("2026-08-01", monthly, "2026-09-27").state, "fresh");
  assert.equal(freshnessVerdict("2026-09-01", daily, "2026-09-27").state, "stopped");
});

test("unknown dates and unknown families read unknown", () => {
  for (const value of [null, undefined, "", "not-a-date", "2026-13", "2026-02-30", "2026-09-28"]) {
    const verdict = freshnessVerdict(value, "global_scouter", "2026-09-27");
    assert.equal(verdict.state, "unknown", String(value));
    assert.equal(verdict.ageDays, null);
  }
  assert.equal(freshnessVerdict("2026-09-18", "no-such-family", "2026-09-27").state, "unknown");
  assert.equal(freshnessVerdict("2026-09-18", { cadence: "fortnightly", releaseLagDays: 0, supplier: "automated", calendar: "calendar" }, "2026-09-27").state, "unknown");
  assert.equal(freshnessVerdict("2026-09-01", resolveSourcePolicy({ artifactId: "fred_banking_monthly" }), "2026-09-27").state, "unknown",
    "a future month-end anchor cannot look fresh mid-month");
  assert.equal(freshnessVerdict("2026-01-01", resolveSourcePolicy({ artifactId: "fred_banking_quarterly" }), "2026-02-15").state, "unknown",
    "a future quarter-end anchor cannot look fresh mid-quarter");
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

  for (const id of Object.keys(FAMILY_POLICY).filter((id) => id !== "earnings_overview")) {
    const kind = laneCadenceKind(id);
    if (kind === null) continue; // no lane record for this id; nothing to drift against
    assert.equal(kind, FAMILY_POLICY[id].cadence, `${id}: lane=${kind} policy=${FAMILY_POLICY[id].cadence}`);
  }
});
