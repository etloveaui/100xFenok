#!/usr/bin/env node
// The sentiment producer writes one set of files in one run, but only five of
// them carried an artifact contract, so the other CNN outputs had no
// source-family freshness gate at all. computed signals says so itself: its
// source_freshness_warnings carried cnn-put-call.json as "unresolved" with
// reason "no registered source-family freshness/SLA gate" while five of its
// siblings from the same producer were gated.
//
// The requirement is derived from what the producer actually declares it writes
// rather than from a hand-kept list, so a new sentiment output cannot ship
// ungated. aaii.json is deliberately outside this: it has no automated
// producer - the producer's own comment says it is still spreadsheet/import
// based with no robust free JSON source, and the owner ruled its status quo in
// BACKLOG #362 - so declaring a cadence for it would assert an SLA that nothing
// can meet.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { SENTIMENT_LKG_SOURCE_FILES } from "./fetch-sentiment.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Not a data series: it describes the others.
const NON_SERIES_OUTPUTS = new Set(["schema.json"]);

// aaii.json needs no exemption entry: the producer does not declare it as an
// output at all, which is the same fact stated at the source. Its data is
// spreadsheet/import based with no robust free JSON source and the owner ruled
// its status quo in BACKLOG #362, so it has no automated cadence to gate. This
// assertion pins that, so if aaii ever gains a producer it stops being silently
// out of scope and has to be gated like everything else.
const UNAUTOMATED_UNDECLARED = Object.freeze({
  "aaii.json":
    "spreadsheet/import based with no robust free JSON source; owner ruled the status quo in BACKLOG #362",
});

function gatedPaths() {
  const gated = new Set();
  for (const lane of DATA_SUPPLY_DETECTION_CONFIG.lanes) {
    for (const member of lane.producer_members ?? []) {
      for (const artifact of member.artifact_contracts ?? []) {
        if (typeof artifact.path === "string") gated.add(artifact.path);
      }
    }
  }
  return gated;
}

const declaredOutputs = [...new Set(Object.values(SENTIMENT_LKG_SOURCE_FILES).flat())].sort();
assert.ok(declaredOutputs.length > 0, "the producer declares no outputs, so this contract protects nothing");

const gated = gatedPaths();
const ungated = declaredOutputs
  .filter((name) => !NON_SERIES_OUTPUTS.has(name))
  .filter((name) => !gated.has(`data/sentiment/${name}`));

assert.deepEqual(
  ungated,
  [],
  `every automated sentiment output needs a source-family freshness gate:\n  ${ungated.join("\n  ")}`,
);

// A file recorded as having no automated producer must stay that way; gaining
// one silently would leave it ungated.
for (const name of Object.keys(UNAUTOMATED_UNDECLARED)) {
  assert.ok(
    !declaredOutputs.includes(name),
    `${name} is now a declared producer output and must be gated rather than recorded as unautomated`,
  );
  assert.ok(
    !gated.has(`data/sentiment/${name}`),
    `${name} is gated despite being recorded as having no automated producer; reconcile the two`,
  );
}

// Every gated sentiment path must still be a file the producer writes.
for (const gatedPath of [...gated].filter((entry) => entry.startsWith("data/sentiment/"))) {
  const name = path.basename(gatedPath);
  assert.ok(
    declaredOutputs.includes(name),
    `${gatedPath} is gated but the sentiment producer does not declare writing it`,
  );
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, gatedPath)),
    `${gatedPath} is gated but is not on disk`,
  );
}

console.log(
  `sentiment artifact contract coverage: ok (${declaredOutputs.length} declared outputs, `
    + `${declaredOutputs.filter((n) => gated.has(`data/sentiment/${n}`)).length} gated, `
    + `${Object.keys(UNAUTOMATED_UNDECLARED).length} unautomated, ${NON_SERIES_OUTPUTS.size} non-series)`,
);
