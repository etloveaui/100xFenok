import assert from "node:assert/strict";
import {
  FENOK_EDGE_SOURCE_AS_OF_IDS,
  recomputeFenokEdgeSourceAsOf,
} from "./lib/fenok-edge-source-stamp.mjs";

function source(id, sourceDate) {
  return { id, source_date: sourceDate };
}

const privatePresent = {
  generated_at: "2026-07-10T14:00:00Z",
  source_as_of: null,
  source_as_of_inputs: [],
  source_availability: {
    sources: [
      source("krx_issuer_daily_latest_full_proof", "2026-07-09"),
      source("us_finra_flow_proxy", "2026-07-08"),
      source("us_occ_options_proxy", "2026-07-07"),
      source("us_class_yf_daily_source", "2026-07-09"),
      source("asia_ex_taiwan_yf_daily_source", "2026-07-09"),
    ],
  },
};

recomputeFenokEdgeSourceAsOf(privatePresent);
assert.equal(privatePresent.source_as_of, "2026-07-07");
assert.deepEqual(
  privatePresent.source_as_of_inputs.map((row) => row.id),
  FENOK_EDGE_SOURCE_AS_OF_IDS,
);
assert.equal(
  privatePresent.source_as_of_inputs.find((row) => row.id === "krx_issuer_daily_latest_full_proof")?.source_date,
  "2026-07-09",
);

// Hermetic no-private path: the current rebuild cannot read the KRX private
// manifest, then preservation restores the prior public-safe source row.
const privateAbsent = structuredClone(privatePresent);
const priorKrx = privateAbsent.source_availability.sources.find(
  (row) => row.id === "krx_issuer_daily_latest_full_proof",
);
privateAbsent.source_availability.sources = privateAbsent.source_availability.sources
  .filter((row) => row.id !== "krx_issuer_daily_latest_full_proof");
privateAbsent.source_as_of = null;
privateAbsent.source_as_of_inputs = [];
privateAbsent.source_availability.sources.push(priorKrx);
recomputeFenokEdgeSourceAsOf(privateAbsent);
assert.equal(privateAbsent.source_as_of, privatePresent.source_as_of);
assert.deepEqual(privateAbsent.source_as_of_inputs, privatePresent.source_as_of_inputs);

const missingRequiredSource = structuredClone(privatePresent);
missingRequiredSource.source_availability.sources = missingRequiredSource.source_availability.sources
  .filter((row) => row.id !== "krx_issuer_daily_latest_full_proof");
recomputeFenokEdgeSourceAsOf(missingRequiredSource);
assert.equal(missingRequiredSource.source_as_of, null);
assert.equal(
  missingRequiredSource.source_as_of_inputs.find((row) => row.id === "krx_issuer_daily_latest_full_proof")?.source_date,
  null,
);

console.log("test-fenok-edge-source-stamp: ok");
