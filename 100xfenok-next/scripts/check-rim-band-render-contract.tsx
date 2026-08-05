// Consumer-side contract for the RIM valuation band.
//
// The producer refuses to publish a single index target. This check proves the
// READER cannot manufacture one either: not for an index the contract does not
// cover, not from a payload whose gates did not pass, and not from a half-built
// band. Every case below is a payload the UI could actually receive, including
// malformed ones, and the expected answer is "draw nothing".

import fs from "node:fs";
import path from "node:path";

import {
  RIM_BAND_ELIGIBLE_INDEX_IDS,
  RIM_BAND_READY_STATUS,
  RIM_BAND_REQUIRED_GATES,
  RIM_CLOCK_ROUTE_CAPABILITIES,
  RIM_COLLECTION_SLA_HOURS,
  readRimBand,
  strictUtcDay,
  type RimValuationRange,
} from "../src/app/market-valuation/rimBand";
import {
  CLOCK_ROUTE_CAPABILITIES,
  INDEX_YIELD_COLLECTION_SLA_HOURS,
} from "../../scripts/build-rim-index.mjs";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// PARITY. The producer and the consumer each need this allowlist, and two
// hand-maintained copies drift. Until they share one module this regression is
// what keeps them identical.
//
// The previous version of this check was a lie. It compared with
// JSON.stringify(map, Object.keys(map).sort()) -- the second argument is a
// REPLACER ALLOWLIST OF KEY NAMES, so passing the top-level source names dropped
// every nested field. Two maps with completely different routes and kinds
// serialised to {"a":{},"b":{}} and compared equal. Only the source-name sets
// were ever being compared.
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalise(nested)]),
    );
  }
  return value;
}
const canonicalJson = (value: unknown) => JSON.stringify(canonicalise(value));

// Compare only the fields both sides are contracted to share. The producer
// carries extra provider metadata the consumer has no use for; the consumer
// carries evidence paths the producer resolves differently.
function comparableCapabilities(map: Record<string, { route: string; kinds: readonly string[] }>) {
  return Object.fromEntries(
    Object.entries(map).map(([source, capability]) => [source, { route: capability.route, kinds: [...capability.kinds] }]),
  );
}

{
  const producer = comparableCapabilities(CLOCK_ROUTE_CAPABILITIES as never);
  const consumer = comparableCapabilities(RIM_CLOCK_ROUTE_CAPABILITIES as never);
  assert(
    canonicalJson(producer) === canonicalJson(consumer),
    `producer and consumer capability allowlists have drifted:\n  producer ${canonicalJson(producer)}\n  consumer ${canonicalJson(consumer)}`,
  );
  assert(
    RIM_COLLECTION_SLA_HOURS === INDEX_YIELD_COLLECTION_SLA_HOURS,
    "producer and consumer collection SLA have drifted",
  );

  // DRIFT REGRESSIONS. Each mutates a TEMP COPY and asserts the comparison
  // NOTICES. Without these the comparison could silently weaken again, exactly
  // as it already did once.
  const drifts: Array<[string, (copy: Record<string, { route: string; kinds: string[] }>) => void]> = [
    ["a changed route", (copy) => { copy["observed.price"].route = "reconciliation"; }],
    ["a changed kind", (copy) => { copy["observed.price"].kinds = ["collected_at"]; }],
    ["an added kind", (copy) => { copy["reconciliation.index_yield"].kinds.push("source_as_of"); }],
    ["a removed kind", (copy) => { copy["observed.price"].kinds = []; }],
    ["an added source", (copy) => { copy["invented.source"] = { route: "main", kinds: ["source_as_of"] }; }],
    ["a removed source", (copy) => { delete copy.benchmark_row; }],
    ["a renamed source", (copy) => {
      copy["observed.price_renamed"] = copy["observed.price"];
      delete copy["observed.price"];
    }],
  ];
  for (const [label, drift] of drifts) {
    const copy = JSON.parse(JSON.stringify(consumer)) as Record<string, { route: string; kinds: string[] }>;
    drift(copy);
    assert(
      canonicalJson(producer) !== canonicalJson(copy),
      `the parity comparison must notice ${label}; it did not, so it is not comparing what it claims`,
    );
  }
  // Control: an untouched copy, and a reordered one, must still compare equal.
  assert(
    canonicalJson(producer) === canonicalJson(JSON.parse(JSON.stringify(consumer))),
    "an untouched copy must still compare equal",
  );
  assert(
    canonicalJson(producer) === canonicalJson(Object.fromEntries(Object.entries(consumer).reverse())),
    "key order must not affect the comparison",
  );

  // Deeply frozen on both sides, so neither copy can be widened at runtime.
  for (const [label, map] of [["consumer", RIM_CLOCK_ROUTE_CAPABILITIES], ["producer", CLOCK_ROUTE_CAPABILITIES]] as const) {
    assert(Object.isFrozen(map), `${label} capability map must be frozen`);
    for (const capability of Object.values(map as Record<string, { kinds: readonly string[] }>)) {
      assert(Object.isFrozen(capability), `${label} capability entry must be frozen`);
      assert(Object.isFrozen(capability.kinds), `${label} capability kinds array must be frozen`);
    }
  }
}

const GENERATED_AT = "2026-08-01T06:41:24.884Z";
const ERP_DAY = "2026-04-01";
const MAIN_DAY = "2026-07-24";
const COLLECTED_AT = "2026-07-14T15:05:37.000Z";
const COLLECTED_DAY = "2026-07-14";

// The happy path now carries the EXACT required inventory. A fixture that omits
// it would only have proved the reader tolerates a missing clock story.
function clockDay(source: string): string {
  if (source === "observed.equity_risk_premium") return ERP_DAY;
  if (source === "reconciliation.index_yield") return COLLECTED_DAY;
  return MAIN_DAY;
}

function fullClockInventory(): NonNullable<RimValuationRange["source_clock"]>["contributing_sources"] {
  return Object.entries(RIM_CLOCK_ROUTE_CAPABILITIES).map(([source, capability]) => ({
    source,
    route: capability.route,
    kind: capability.kinds[0],
    as_of: clockDay(source),
  }));
}

// The EVIDENCE the clock inventory must agree with. Route and kind cannot tell
// observed.price from benchmark_row, so the reader binds each source to the
// field its date actually comes from; the fixture has to carry those fields.
function entryEvidence(overrides: { erpDay?: string | null; collectedAt?: string | null; mainDay?: string } = {}) {
  const erp = overrides.erpDay === undefined ? ERP_DAY : overrides.erpDay;
  const main = overrides.mainDay ?? MAIN_DAY;
  const collected = overrides.collectedAt === undefined ? COLLECTED_AT : overrides.collectedAt;
  return {
    observed: {
      price: { as_of: main },
      forward_eps: { as_of: main },
      price_to_book: { as_of: main },
      risk_free_rate: { as_of: main },
      equity_risk_premium: { as_of: erp },
    },
    derived: {
      forecast_grid_v1: { coverage: { stock_action_source_date: main } },
      payout_ratio: { coverage: { benchmark_as_of: main } },
      legacy_payout_ratio_qa: { coverage: { index_yield_collected_at: collected } },
    },
  };
}

function entryFor(range: RimValuationRange | null | undefined, overrides?: Parameters<typeof entryEvidence>[0]) {
  const evidence = entryEvidence(overrides);
  return { observed: evidence.observed, derived: { ...evidence.derived, valuation_range_v1: range } };
}

function passingGates(): NonNullable<RimValuationRange["gates"]> {
  return Object.fromEntries(RIM_BAND_REQUIRED_GATES.map((gate) => [gate, { passed: true, reason: "" }]));
}

function readyRange(): RimValuationRange {
  return {
    public_status: RIM_BAND_READY_STATUS,
    emits_single_target: false,
    as_of: ERP_DAY,
    gates: passingGates(),
    range: { low: 2918.74, high: 5800.2 },
    assumptions: {
      terminal_growth: { low: 0, high: 0.025 },
      fade_years: { value: 10 },
      discount_rate: { value: 0.097 },
    },
    price_context: { observed_price: 7411.98, position: "above_range" },
    source_clock: { as_of: ERP_DAY, contributing_sources: fullClockInventory() },
  };
}

const read = (
  id: string,
  range: RimValuationRange | null | undefined,
  overrides?: Parameters<typeof entryEvidence>[0],
) => readRimBand(id, entryFor(range, overrides) as never, { generatedAt: GENERATED_AT });

// A ready range whose oldest clock IS the given day, so a calendar fixture tests
// the calendar rule rather than tripping the as_of/inventory agreement rule.
function readyRangeOldest(day: string | null): RimValuationRange {
  const range = readyRange();
  const sources = fullClockInventory()!.map((row) => (
    row!.source === "observed.equity_risk_premium" ? { ...row!, as_of: day } : row!
  ));
  range.source_clock = { as_of: day, contributing_sources: sources };
  range.as_of = day;
  return range;
}

// Calendar fixtures move the ERP evidence with the clock, so they test the
// calendar rule rather than tripping the evidence binding on the way past it.
const readOldest = (day: string | null) => read("SPX", readyRangeOldest(day), { erpDay: day });

// The happy path exists, or every negative case below would pass vacuously.
const drawn = read("SPX", readyRange());
assert(drawn !== null, "a fully gated primary band must render");
assert(drawn!.low === 2918.74 && drawn!.high === 5800.2, "both endpoints survive");
assert(drawn!.asOf === "2026-04-01", "the band carries its own source clock, not the panel's");
assert(drawn!.fadeYears === 10 && drawn!.terminalGrowthHigh === 0.025, "assumptions reach the renderer");
assert(drawn!.discountRate === 0.097, "the discount rate reaches the renderer");

// Indices the contract does not cover cannot render a band even if a payload
// hands them a perfectly formed one.
for (const id of ["CCMP", "KOSPI", "SOX", "DJIA", ""]) {
  assert(read(id, readyRange()) === null, `${id} must never render a valuation band`);
}
for (const id of RIM_BAND_ELIGIBLE_INDEX_IDS) {
  assert(read(id, readyRange()) !== null, `${id} is an eligible index`);
}

const negativeCases: Array<[string, RimValuationRange | null | undefined]> = [
  ["an extra failed gate the producer wrote down", {
    ...readyRange(),
    gates: { ...passingGates(), experimental_gate: { passed: false, reason: "planted" } },
  }],
  ["an extra passing gate outside the contract set", {
    ...readyRange(),
    gates: { ...passingGates(), experimental_gate: { passed: true, reason: "" } },
  }],
  ["a missing as_of", { ...readyRange(), as_of: null }],

  ["an as_of carrying a timestamp instead of a day", { ...readyRange(), as_of: "2026-04-01T00:00:00Z" }],
  ["a nested point target inside price context", {
    ...readyRange(),
    price_context: { observed_price: 7411.98, position: "above_range", point_target: 5000 },
  } as RimValuationRange],
  ["a point target buried under an innocent name", {
    ...readyRange(),
    assumptions: {
      terminal_growth: { low: 0, high: 0.025 },
      fade_years: { value: 10 },
      discount_rate: { value: 0.097 },
      summary: { consensus: { fair_value: 4200 } },
    },
  } as RimValuationRange],
  ["a missing range block", null],
  ["an undefined range block", undefined],
  ["a refused range", { ...readyRange(), public_status: "blocked_no_range", range: { low: null, high: null } }],
  ["an unknown status", { ...readyRange(), public_status: "ready" }],
  ["a payload that admits it emits a single target", { ...readyRange(), emits_single_target: true }],
  ["a payload that omits the single-target declaration", { ...readyRange(), emits_single_target: undefined }],
  ["a collapsed band", { ...readyRange(), range: { low: 5000, high: 5000 } }],
  ["an inverted band", { ...readyRange(), range: { low: 6000, high: 5000 } }],
  ["only a low endpoint", { ...readyRange(), range: { low: 5000, high: null } }],
  ["only a high endpoint", { ...readyRange(), range: { low: null, high: 5000 } }],
  ["no gates at all", { ...readyRange(), gates: {} }],
  ["missing assumptions", { ...readyRange(), assumptions: null }],
  ["a missing fade-year assumption", {
    ...readyRange(),
    assumptions: { terminal_growth: { low: 0, high: 0.025 }, fade_years: { value: null }, discount_rate: { value: 0.097 } },
  }],
  ["terminal growth at or above the discount rate", {
    ...readyRange(),
    assumptions: { terminal_growth: { low: 0, high: 0.12 }, fade_years: { value: 10 }, discount_rate: { value: 0.097 } },
  }],
];

for (const [label, range] of negativeCases) {
  assert(read("SPX", range) === null, `${label} must render nothing`);
}

// One gate at a time: each is individually load-bearing.
for (const gate of RIM_BAND_REQUIRED_GATES) {
  const failed = readyRange();
  failed.gates = { ...passingGates(), [gate]: { passed: false, reason: "planted" } };
  assert(read("SPX", failed) === null, `a failed ${gate} gate must render nothing`);

  const dropped = readyRange();
  const remaining = passingGates();
  delete remaining[gate];
  dropped.gates = remaining;
  assert(read("SPX", dropped) === null, `a missing ${gate} gate must render nothing`);
}

// The rendered panel must never contain single-target vocabulary in its copy.
const clientSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/market-valuation/MarketValuationClient.tsx"),
  "utf8",
);
for (const banned of ["적정가", "목표주가", "target_price", "fair_value"]) {
  assert(
    !clientSource.includes(banned),
    `the market valuation panel must not use single-target vocabulary (${banned})`,
  );
}
assert(clientSource.includes("목표가가 아니며"), "the panel must say in words that the band is not a target");

// A real leap day in a real leap year must still render: the calendar check
// must be a calendar check, not a blanket February refusal.
// Calendar rule, with the evidence moved to match so nothing else objects.
for (const badDay of ["2026-04", "2026-02-31", "2026-13-01", "2026-02-29", "2026-04-31", "2099-01-01", "20260401", "2026-4-1"]) {
  assert(readOldest(badDay) === null, `as_of ${badDay} must render nothing`);
}
assert(readOldest("2024-02-29") !== null, "2024-02-29 is a real day");

// IDENTITY BINDING: observed.price and benchmark_row share route and kind, so
// only the evidence path can tell them apart. Swapping their dates must refuse.
{
  const swapped = readyRange();
  swapped.source_clock = {
    as_of: ERP_DAY,
    contributing_sources: fullClockInventory()!.map((row) => {
      if (row!.source === "observed.price") return { ...row!, as_of: "2026-07-20" };
      if (row!.source === "benchmark_row") return { ...row!, as_of: MAIN_DAY };
      return row!;
    }),
  };
  assert(
    readRimBand("SPX", entryFor(swapped) as never, { generatedAt: GENERATED_AT }) === null,
    "a clock date that does not match its own source's evidence must refuse the band",
  );
}

// STRICT UTC: a valid-looking day must not be sliced out of malformed text.
for (const badGeneratedAt of [
  "2026-08-01 is when we think",
  "2026-08-01",
  "2026-08-01T06:41:24",
  "2026-08-01T99:99:99Z",
  "2026-02-31T00:00:00Z",
  "garbage",
  "",
]) {
  assert(
    readRimBand("SPX", entryFor(readyRange()) as never, { generatedAt: badGeneratedAt }) === null,
    `a malformed generated_at (${JSON.stringify(badGeneratedAt)}) must refuse the band, not be sliced into a day`,
  );
}
assert(
  readRimBand("SPX", entryFor(readyRange()) as never, { generatedAt: GENERATED_AT }) !== null,
  "a complete strict UTC generated_at still renders",
);

// The collection-time caveat must reach the reader, and only when it applies.
const collected = read("SPX", readyRange());
assert(collected?.reconciliationUsesCollectionTime === true, "a collection-time reconciliation clock is surfaced");

// SUPPRESSION BY OMISSION. Deleting the reconciliation row used to leave every
// remaining row valid and quietly drop the caveat. The inventory is mandatory
// now, so removing any row refuses the band instead.
for (const source of Object.keys(RIM_CLOCK_ROUTE_CAPABILITIES)) {
  const stripped = readyRange();
  stripped.source_clock = {
    as_of: ERP_DAY,
    contributing_sources: fullClockInventory()!.filter((row) => row!.source !== source),
  };
  assert(read("SPX", stripped) === null, `removing the ${source} clock must refuse the band, not drop a caveat`);
}

// Duplicate, extra, and swapped rows each fail closed.
{
  const duplicated = readyRange();
  const rows = fullClockInventory()!;
  duplicated.source_clock = { as_of: "2026-04-01", contributing_sources: [...rows, { ...rows[0]! }] };
  assert(read("SPX", duplicated) === null, "a duplicated clock row must refuse the band");

  const extra = readyRange();
  extra.source_clock = {
    as_of: ERP_DAY,
    contributing_sources: [...rows.slice(1), { source: "invented.route", route: "main", kind: "source_as_of", as_of: "2026-07-14" }],
  };
  assert(read("SPX", extra) === null, "an undeclared extra clock row must refuse the band");

  const swapped = readyRange();
  swapped.source_clock = {
    as_of: ERP_DAY,
    contributing_sources: rows.map((row) => (
      row!.source === "benchmark_row" ? { ...row!, route: "reconciliation" } : row!
    )),
  };
  assert(read("SPX", swapped) === null, "a clock swapped onto the wrong route must refuse the band");

  const undated = readyRange();
  undated.source_clock = {
    as_of: ERP_DAY,
    contributing_sources: rows.map((row) => (row!.source === "benchmark_row" ? { ...row!, as_of: null } : row!)),
  };
  assert(read("SPX", undated) === null, "a partial inventory with an undated row must refuse the band");
}

// Collection freshness is recomputed against the document clock, not read from
// the payload's own age fields.
{
  const stale = readyRange();
  stale.source_clock = {
    as_of: ERP_DAY,
    contributing_sources: fullClockInventory()!.map((row) => (
      row!.source === "reconciliation.index_yield" ? { ...row!, as_of: "2026-01-05" } : row!
    )),
  };
  assert(read("SPX", stale) === null, "a collection clock beyond the SLA must refuse the band");

  const noDocClock = readRimBand("SPX", readyRange(), { generatedAt: null });
  assert(noDocClock === null, "a document with no generation clock cannot be freshness-checked, so it refuses");
}
// A relabel no longer merely drops the caveat -- it refuses the band. The
// reconciliation provider cannot publish an observation date, so a payload
// claiming one is describing a source that does not exist, and the numbers
// resting on that clock are not renderable.
assert(
  read("SPX", {
    ...readyRange(),
    source_clock: { as_of: "2026-04-01", contributing_sources: [{ source: "reconciliation.index_yield", route: "reconciliation", kind: "source_as_of" }] },
  }) === null,
  "a reconciliation clock relabelled as an observation date must refuse the band",
);
assert(
  read("SPX", {
    ...readyRange(),
    source_clock: { as_of: "2026-04-01", contributing_sources: [{ source: "observed.price", route: "main", kind: "collected_at" }] },
  }) === null,
  "a main-route clock claiming a collection time must refuse the band",
);
assert(
  read("SPX", {
    ...readyRange(),
    source_clock: { as_of: "2026-04-01", contributing_sources: [{ source: "invented.route", route: "main", kind: "source_as_of" }] },
  }) === null,
  "a clock source outside the capability allowlist must refuse the band",
);
assert(
  read("SPX", {
    ...readyRange(),
    source_clock: { as_of: "2026-04-01", contributing_sources: [{ source: "benchmark_row", route: "reconciliation", kind: "source_as_of" }] },
  }) === null,
  "a clock on the wrong route must refuse the band",
);
// The panel that RENDERS the reconciliation band must carry the caveat copy.
// Since the 2026-08-05 rebuild no market-valuation component imports the
// legacy band reader, so the requirement binds whichever file actually does:
// a consumer must carry both strings, and the check names the offender.
const bandConsumers = fs.readdirSync(path.join(process.cwd(), "src/app/market-valuation"))
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({
    name,
    body: fs.readFileSync(path.join(process.cwd(), "src/app/market-valuation", name), "utf8"),
  }))
  .filter(({ body }) => body.includes("readRimBand("));
for (const consumer of bandConsumers) {
  assert(
    consumer.body.includes("수집 시각을 사용합니다") && consumer.body.includes("관측일이 아닙니다"),
    `${consumer.name} renders the reconciliation band and must state that it uses collection time, not an observation date`,
  );
}

// ---------------------------------------------------------------------------
// REAL-ARTIFACT INTEGRATION. Every check above is a fixture, and fixtures only
// prove the reader refuses what it should. They cannot prove it ACCEPTS what it
// must, because a fixture is written to match whatever the reader currently
// expects.
//
// This is not hypothetical. The published artifact carries the SlickCharts
// collection clock as `+00:00`, the reader's strict parser accepted only `Z`,
// and the live SPX band silently rendered NOTHING while every fixture passed
// and every refusal probe reported zero bypasses. A refusal-only suite cannot
// see a false refusal. This check is what sees it.
// ---------------------------------------------------------------------------
{
  const artifact = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "public/data/computed/rim-index/inputs.json"),
    "utf8",
  ));
  const generatedAt = artifact.generated_at;
  assert(
    strictUtcDay(generatedAt) !== null,
    `the published generated_at must be a complete strict UTC instant, got ${JSON.stringify(generatedAt)}`,
  );

  const spx = readRimBand("SPX", artifact.indices?.SPX, { generatedAt });
  assert(spx !== null, "the PUBLISHED SPX band must actually render; a refusal here ships a blank panel");
  assert(spx!.low > 0 && spx!.high > spx!.low, `published SPX endpoints must be ordered, got ${spx!.low}~${spx!.high}`);
  assert(spx!.reconciliationUsesCollectionTime === true, "the published band must surface the collection-time caveat");
  assert(
    spx!.asOf === artifact.indices.SPX.derived.valuation_range_v1.as_of,
    "the rendered clock must be the published one",
  );

  // NDX is refused by the producer, so the reader must render nothing for it.
  assert(
    readRimBand("NDX", artifact.indices?.NDX, { generatedAt }) === null,
    "the published NDX payload is blocked_no_range and must render nothing",
  );

  // THE PROVIDER'S OWN SHAPE, not just the normalised one. The producer now
  // publishes a canonical `Z` instant, which means the parser could quietly
  // regress to Z-only and this file would still pass -- the two fixes mask each
  // other. So put the provider's raw `+00:00` string back and require the band
  // to render from THAT too. Measured 2x2: only (Z-only parser + provider raw)
  // is blank, so this case is the one that pins the parser.
  {
    const raw = JSON.parse(JSON.stringify(artifact));
    const coverage = raw.indices.SPX.derived.legacy_payout_ratio_qa.coverage;
    assert(
      typeof coverage.index_yield_collected_at_provider === "string",
      "the provider's raw collection timestamp must be preserved for this check",
    );
    coverage.index_yield_collected_at = coverage.index_yield_collected_at_provider;
    assert(
      readRimBand("SPX", raw.indices.SPX, { generatedAt }) !== null,
      "the band must render from the provider's own timestamp shape, not only from the normalised one",
    );
  }

  // Secondary indices carry no range block at all.
  for (const id of ["CCMP", "KOSPI", "SOX"]) {
    assert(readRimBand(id, artifact.indices?.[id], { generatedAt }) === null, `${id} must render nothing`);
  }
}

console.log("[check-rim-band-render-contract] OK");
