import assert from "node:assert/strict";
import {
  ETF_DETAIL_COMPAT_EXPIRES_AT,
  getEtfDataSupplyPresentation,
  isLegacyEtfDetailCompatibilityActive,
  parseEtfApiResponse,
  parseEtfDataSupply,
} from "../src/lib/data-supply-etf-ui";

const base = {
  enrollment_state: "enrolled",
  provider_role: "fallback",
  fallback_depth: 1,
  source_as_of: "2026-07-02T01:57:29Z",
  selected_at: "2026-07-11T00:00:00Z",
  source_age_days: 9,
  reason_code: "primary_unavailable",
  recovery_transition: null,
  projection_digest: "a".repeat(64),
} as const;

const expectations = [
  ["fresh_primary", null],
  ["fresh_fallback", "보조 공급원 최신값"],
  ["lkg_primary", "마지막 확인값"],
  ["lkg_fallback", "마지막 확인값"],
  ["unavailable", "세부 데이터 일시 이용 불가"],
] as const;

async function main() {

for (const [resolution_state, label] of expectations) {
  const value = parseEtfDataSupply({
    ...base,
    resolution_state,
    provider_role: resolution_state === "unavailable" ? null : resolution_state.endsWith("primary") ? "primary" : "fallback",
    fallback_depth: resolution_state === "unavailable" ? null : resolution_state.endsWith("primary") ? 0 : 1,
    source_as_of: resolution_state === "unavailable" ? null : base.source_as_of,
    selected_at: resolution_state === "unavailable" ? null : base.selected_at,
    source_age_days: resolution_state === "unavailable" ? null : 9,
    reason_code: resolution_state === "unavailable" ? null : base.reason_code,
    recovery_transition: resolution_state === "unavailable" ? "unavailable" : null,
  });
  assert.ok(value);
  assert.equal(getEtfDataSupplyPresentation(value).label, label);
}

const noTime = parseEtfDataSupply({
  ...base,
  resolution_state: "unavailable",
  provider_role: null,
  fallback_depth: null,
  source_as_of: null,
  selected_at: null,
  source_age_days: null,
  reason_code: null,
  recovery_transition: "unavailable",
});
assert.ok(noTime);
assert.equal(getEtfDataSupplyPresentation(noTime).sourceDate, null);

const typed = await parseEtfApiResponse<Record<string, unknown>>(Response.json(
  { error: "DATA_SUPPLY_UNAVAILABLE", data_supply: noTime },
  { status: 503 },
));
assert.equal(typed.kind, "unavailable");

const generic = await parseEtfApiResponse<Record<string, unknown>>(Response.json(
  { error: "DATA_SUPPLY_INDEX_UNAVAILABLE" },
  { status: 503 },
));
assert.equal(generic.kind, "failed");

assert.equal(isLegacyEtfDetailCompatibilityActive(
  new Date("2026-07-12T00:00:00Z"),
  "2026-07-18T00:00:00Z",
), true);
assert.equal(isLegacyEtfDetailCompatibilityActive(
  new Date("2026-07-18T00:00:00Z"),
  "2026-07-18T00:00:00Z",
), false);
assert.equal(isLegacyEtfDetailCompatibilityActive(new Date("2026-07-12T00:00:00Z"), null), false);
assert.equal(ETF_DETAIL_COMPAT_EXPIRES_AT, "2026-07-25T00:00:00Z");
assert.equal(isLegacyEtfDetailCompatibilityActive(new Date("2026-07-24T23:59:59Z")), true);
assert.equal(isLegacyEtfDetailCompatibilityActive(new Date("2026-07-25T00:00:00Z")), false);

console.log("data-supply ETF UI tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
