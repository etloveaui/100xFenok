import assert from "node:assert/strict";

import {
  applyYfForwardFallback,
  extractYfForwardEnrichment,
} from "./lib/yf-screener-enrichment.mjs";

const yfPayload = {
  schema_version: "yf-finance/v2",
  ticker: "NVDA",
  source_as_of: "2026-07-16",
  data: {
    info: {
      currency: "USD",
      forwardPE: 16.2,
      forwardEps: 12.8,
    },
  },
};

assert.deepEqual(extractYfForwardEnrichment("nvda", yfPayload), {
  peForward: 16.2,
  epsForward: 12.8,
  sourceAsOf: "2026-07-16",
});

assert.deepEqual(
  extractYfForwardEnrichment("NVDA", {
    ...yfPayload,
    source_as_of: "2026-06-25T06:30:30Z",
  }),
  { peForward: 16.2, epsForward: 12.8, sourceAsOf: "2026-06-25" },
  "valid provider timestamps normalize to their declared calendar date",
);

assert.deepEqual(
  applyYfForwardFallback({ peForward: 18, epsForward: 10 }, extractYfForwardEnrichment("NVDA", yfPayload)),
  {
    peForward: 18,
    epsForward: 10,
    peForwardSource: "slickcharts",
    epsForwardSource: "slickcharts",
    yfFallbackUsed: false,
  },
  "SlickCharts values stay authoritative when present",
);

assert.deepEqual(
  applyYfForwardFallback({ peForward: undefined, epsForward: null }, extractYfForwardEnrichment("NVDA", yfPayload)),
  {
    peForward: 16.2,
    epsForward: 12.8,
    peForwardSource: "yf",
    epsForwardSource: "yf",
    yfFallbackUsed: true,
  },
  "Yahoo values fill only missing forward metrics without unit conversion",
);

assert.equal(extractYfForwardEnrichment("AAPL", yfPayload), null, "ticker identity mismatches fail closed");
assert.equal(
  extractYfForwardEnrichment("NVDA", { ...yfPayload, schema_version: "yf-finance/v1" }),
  null,
  "unknown Yahoo schemas fail closed",
);
assert.deepEqual(
  extractYfForwardEnrichment("NVDA", {
    ...yfPayload,
    data: { info: { currency: "KRW", forwardPE: 11.5, forwardEps: 3200 } },
  }),
  { peForward: 11.5, epsForward: undefined, sourceAsOf: "2026-07-16" },
  "unitless forward PE may enrich globally, but non-USD forward EPS stays null",
);

const invalid = extractYfForwardEnrichment("NVDA", {
  ...yfPayload,
  source_as_of: "2026-02-31",
  data: { info: { currency: "USD", forwardPE: "16.2", forwardEps: Number.NaN } },
});
assert.deepEqual(invalid, { peForward: undefined, epsForward: undefined, sourceAsOf: null });
assert.deepEqual(applyYfForwardFallback({}, invalid), {
  peForward: undefined,
  epsForward: undefined,
  peForwardSource: null,
  epsForwardSource: null,
  yfFallbackUsed: false,
});

console.log("test-yf-screener-enrichment: ok");
