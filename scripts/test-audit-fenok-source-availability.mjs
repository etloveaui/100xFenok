#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  aggregateAvailabilityStatus,
  buildPlan,
  deriveCheckAvailabilityStatus,
  normalizeDate,
  parseArgs,
  parseAvailabilityPayload,
  run,
} from "./audit-fenok-source-availability.mjs";

const finraSample = [
  "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market",
  "20260626|NVDA|123|4|1000|B,Q,N",
  "20260626|BRK.B|50|0|200|Q",
].join("\n");

const finraParsed = parseAvailabilityPayload("finra-regsho-daily-text", finraSample, {
  expectedDate: "20260626",
});
assert.equal(finraParsed.file_date_marker, "20260626");
assert.equal(finraParsed.row_count, 2);
assert.equal(finraParsed.date_matches, true);

const occSample = [
  "quantity,underlying,symbol,actype,porc,exchange,actdate",
  "4000000,NVDA,NVDA,C,C,CBOE,06/26/2026,",
  "45792,NVDA,NVDA,C,C,AMEX,06/26/2026,",
].join("\n");

const occParsed = parseAvailabilityPayload("occ-volume-query-csv", occSample, {
  expectedDate: "20260626",
});
assert.equal(occParsed.file_date_marker, "20260626");
assert.equal(occParsed.row_count, 2);
assert.equal(occParsed.date_matches, true);

const apeWisdomSample = {
  count: 797,
  pages: 8,
  current_page: 1,
  results: [
    {
      rank: 1,
      ticker: "NVDA",
      name: "NVIDIA",
      mentions: "166",
      upvotes: "785",
      rank_24h_ago: "2",
      mentions_24h_ago: "120",
    },
    {
      rank: "25",
      ticker: "msft",
      name: "Microsoft",
      mentions: "42",
      upvotes: "105",
      rank_24h_ago: "20",
      mentions_24h_ago: "60",
    },
  ],
};

const apeWisdomParsed = parseAvailabilityPayload("apewisdom-all-stocks-json", JSON.stringify(apeWisdomSample), {
  expectedDate: "20260626",
});
assert.equal(apeWisdomParsed.file_date_marker, null);
assert.equal(apeWisdomParsed.row_count, 2);
assert.equal(apeWisdomParsed.results_count, 797);
assert.equal(apeWisdomParsed.pages, 8);
assert.equal(apeWisdomParsed.current_page, 1);
assert.equal(apeWisdomParsed.top_rows[0].ticker, "NVDA");
assert.equal(apeWisdomParsed.top_rows[0].mentions_24h_ago, 120);
assert.match(apeWisdomParsed.top20_signature_sha256, /^[a-f0-9]{64}$/);
assert.match(apeWisdomParsed.top20_delta_marker, /1:NVDA:166:785:120/);

const nasdaqSample = [
  "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
  "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
  "NVDA|NVIDIA Corporation - Common Stock|Q|N|N|100|N|N",
  "File Creation Time: 0626202604:30||||",
].join("\n");

const nasdaqParsed = parseAvailabilityPayload("nasdaq-symbol-file", nasdaqSample, {
  expectedDate: "20260626",
});
assert.equal(nasdaqParsed.file_date_marker, "20260626");
assert.equal(nasdaqParsed.row_count, 2);

const fredSample = [
  "<html><body>",
  '<a href="/release/">Release A</a>',
  '<a href="/release/">Release B</a>',
  "<time>2026-06-26</time>",
  "</body></html>",
].join("");

const fredParsed = parseAvailabilityPayload("fred-release-calendar-html", fredSample, {
  expectedDate: "20260626",
});
assert.equal(fredParsed.file_date_marker, "20260626");
assert.equal(fredParsed.row_count, 2);

assert.equal(normalizeDate("2026-06-26"), "20260626");
assert.equal(parseArgs(["--fetch", "--write", "--ticker", "nvda", "--occ-side", "p"]).ticker, "NVDA");
assert.equal(parseArgs(["--fetch", "--write", "--ticker", "nvda", "--occ-side", "p"]).occSide, "P");
assert.equal(parseArgs(["--apewisdom-page", "2"]).apewisdomPage, 2);

assert.equal(
  deriveCheckAvailabilityStatus({
    fetchEnabled: true,
    cacheHit: false,
    httpStatus: 200,
    parseResult: finraParsed,
    rowCountRequired: true,
    expectsSourceDateMatch: true,
    error: null,
  }),
  "available",
);

assert.equal(
  deriveCheckAvailabilityStatus({
    fetchEnabled: true,
    cacheHit: false,
    httpStatus: 404,
    parseResult: null,
    rowCountRequired: true,
    expectsSourceDateMatch: true,
    error: null,
  }),
  "not_available_yet",
);

assert.equal(
  aggregateAvailabilityStatus([
    { availability_status: "available" },
    { availability_status: "available_from_private_cache" },
  ]),
  "available",
);
assert.equal(
  aggregateAvailabilityStatus([
    { availability_status: "cache_missing_no_fetch" },
    { availability_status: "cache_missing_no_fetch" },
  ]),
  "not_checked_no_fetch",
);

const plan = buildPlan(parseArgs([
  "--date",
  "2026-06-26",
  "--sources",
  "finra-regsho-daily,occ-volume-query,nasdaq-symbol-files,fred-release-calendar",
  "--ticker",
  "NVDA",
]));

assert.equal(plan.plan_only, true);
assert.equal(plan.fetch_enabled, false);
assert.equal(plan.write_enabled, false);
assert.equal(plan.source_date, "20260626");
assert.match(plan.output_file, /_private\/admin\/fenok-flow\/availability\/source_availability_audit_latest\.json$/);
assert.deepEqual(plan.sources.map((source) => source.source_id), [
  "finra-regsho-daily",
  "occ-volume-query",
  "nasdaq-symbol-files",
  "fred-release-calendar",
]);
assert.equal(plan.sources.find((source) => source.source_id === "occ-volume-query").checks.length, 2);

const defaultPlan = buildPlan(parseArgs(["--date", "2026-06-26"]));
assert.deepEqual(defaultPlan.sources.map((source) => source.source_id), [
  "finra-regsho-daily",
  "occ-volume-query",
  "apewisdom-all-stocks",
  "nasdaq-symbol-files",
  "fred-release-calendar",
]);
const apeWisdomPlanSource = defaultPlan.sources.find((source) => source.source_id === "apewisdom-all-stocks");
assert.equal(
  apeWisdomPlanSource.checks[0].source_url,
  "https://apewisdom.io/api/v1.0/filter/all-stocks",
);
assert.match(
  apeWisdomPlanSource.checks[0].cache_candidates[0].path,
  /_private\/admin\/fenok-flow\/apewisdom\/all-stocks\/20260626\/page-1\.json$/,
);

const runPlan = await run([
  "--date",
  "2026-06-26",
  "--plan-only",
  "--sources",
  "finra-regsho-daily,occ-volume-query",
  "--ticker",
  "NVDA",
]);
assert.equal(runPlan.plan_only, true);
assert.equal(runPlan.sources.length, 2);
assert.equal(runPlan.sources[0].checks[0].source_url, "https://cdn.finra.org/equity/regsho/daily/CNMSshvol20260626.txt");

console.log("test-audit-fenok-source-availability: ok");
