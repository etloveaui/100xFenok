#!/usr/bin/env node
// edgar-korean-summaries has never published to the cloud data plane, and the
// dispatch that proved its acquisition repair on 2026-08-21 finally showed why.
// Steps 1-9 passed and step 10 failed with "Unexpected non-whitespace character
// after JSON at position 229 (line 2)". The family declares no `files` list, so
// the publisher walks its whole root and validate_public_payload JSON.parses
// every asset - and data/edgar-korean-summaries/ops/batch-skip-log.jsonl is
// JSONL whose first line is exactly 229 bytes. Causal, not circumstantial. That
// file has existed since 2026-06-21, so the family has been unable to publish
// for as long as it has been enrolled.
//
// The chosen repair is to exclude internal telemetry from the published asset
// set rather than to weaken validate_public_payload. ops/ and README.md are not
// data payloads; they were swept in because the family enumerates by directory.
// Loosening the validator would weaken a guard that exists to stop malformed
// payloads reaching the plane, for every family, to accommodate two files that
// should not be there.
//
// The exclusion applies ONLY to the directory walk. A family that declares an
// explicit `files` list has already chosen its assets deliberately, and
// silently subtracting from that choice would be a different kind of surprise.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FAMILIES, applyFamilyExclusions } from "../publish-cloud-data-generation.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- The mechanism ----------------------------------------------------------
{
  const walked = [
    "index.json",
    "README.md",
    "ops/batch-skip-log.jsonl",
    "by-ticker/AAPL.json",
    "translations/AAPL-8k.json",
    "opsimistic/keep.json",     // must NOT be caught by a naive "ops" prefix
    "nested/ops/inner.json",    // a nested ops/ is not the declared root ops/
  ];
  const kept = applyFamilyExclusions(walked, ["ops/", "README.md"]);
  assert.ok(!kept.includes("ops/batch-skip-log.jsonl"), "the declared ops/ directory must be excluded");
  assert.ok(!kept.includes("README.md"), "an exact-path exclusion must be honoured");
  assert.ok(kept.includes("index.json"), "data payloads must survive");
  assert.ok(kept.includes("by-ticker/AAPL.json"));
  assert.ok(
    kept.includes("opsimistic/keep.json"),
    "a directory exclusion must match a path segment, not a bare string prefix",
  );
  assert.ok(
    kept.includes("nested/ops/inner.json"),
    "an exclusion is rooted at the family root, not applied at any depth",
  );
}

// No exclusions declared means nothing changes.
{
  const walked = ["a.json", "b/c.json"];
  assert.deepEqual(applyFamilyExclusions(walked, undefined), walked);
  assert.deepEqual(applyFamilyExclusions(walked, []), walked);
}

// Excluding everything is a configuration error, not an empty publication.
assert.throws(
  () => applyFamilyExclusions(["ops/x.json"], ["ops/"]),
  /FAMILY_EXCLUDE_EMPTY/,
  "an exclusion that removes every asset must fail closed, not publish nothing",
);

// An exclusion that matches nothing is stale and must say so, or the list rots.
assert.throws(
  () => applyFamilyExclusions(["a.json"], ["ops/"]),
  /FAMILY_EXCLUDE_UNUSED/,
  "an exclusion matching no file is a stale rule and must fail rather than sit there",
);

// --- The declaration for the family that needed it --------------------------
{
  const family = FAMILIES["edgar-korean-summaries"];
  assert.ok(family, "the family is gone; this contract is stale");
  assert.ok(Array.isArray(family.exclude), "edgar-korean-summaries must declare its exclusions");
  assert.ok(family.exclude.includes("ops/"), "internal telemetry must not be published");
  assert.ok(family.exclude.includes("README.md"));
  assert.equal(family.files, undefined, "this family enumerates by directory; that is why it needs exclusions");
}

// --- The offending files are real, and nothing else in the tree is unparseable
{
  const root = path.join(REPO_ROOT, "data", "edgar-korean-summaries");
  const offender = path.join(root, "ops", "batch-skip-log.jsonl");
  assert.ok(fs.existsSync(offender), "the JSONL that broke publication is gone; re-measure before trusting this");
  const firstLine = fs.readFileSync(offender, "utf8").split("\n")[0];
  assert.equal(
    Buffer.byteLength(`${firstLine}\n`),
    229,
    "the first line is no longer 229 bytes; the causal link to the reported error position is stale",
  );
}

// --- The mechanism must be WIRED, not merely present ------------------------
// Removing the call left the function and the declaration both intact and this
// file still passing, which is the vacuous-contract shape this programme keeps
// finding. Assert the seam itself.
{
  const source = fs.readFileSync(
    path.join(REPO_ROOT, "scripts", "publish-cloud-data-generation.mjs"), "utf8",
  );
  const code = source.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.match(
    code,
    /applyFamilyExclusions\(await walkFiles\(absRoot\), family\.exclude\)/,
    "the directory walk must be filtered through the exclusions; declaring them changes nothing on its own",
  );
  assert.ok(
    !/\?\?\s*await walkFiles\(absRoot\)\s*\)/.test(code),
    "an unfiltered walk remains in the resolution path",
  );
}

// --- Exclusions only ever apply to a walked family --------------------------
for (const [name, family] of Object.entries(FAMILIES)) {
  if (!family.exclude) continue;
  assert.equal(
    family.files,
    undefined,
    `${name} declares both files and exclude; an explicit list has already chosen its assets`,
  );
  assert.ok(family.exclude.length > 0, `${name} declares an empty exclude list, which is noise`);
  for (const rule of family.exclude) {
    assert.equal(typeof rule, "string", `${name} exclusion must be a string`);
    assert.ok(!rule.startsWith("/") && !rule.includes(".."), `${name} exclusion must be root-relative: ${rule}`);
  }
}

console.log("test-family-publish-exclusions: ok");
