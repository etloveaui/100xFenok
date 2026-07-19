#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  comparePayloads,
  firstDivergentPaths,
  normalizePayload,
} from "./fetch-damodaran-shadow.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  return {
    metadata: {
      schema_version: "2.0.0",
      generated_at: "2026-07-19T00:00:00Z",
      source_date: "January 2026",
    },
    industries: {
      Software: {
        beta: { levered: 1.25 },
        margins: { net: 0.18 },
      },
    },
  };
}

{
  const committed = fixture();
  const fresh = structuredClone(committed);
  fresh.metadata.generated_at = "2026-07-19T01:02:03Z";

  assert.deepStrictEqual(normalizePayload(fresh), normalizePayload(committed));
  assert.deepStrictEqual(comparePayloads(fresh, committed), {
    status: "match",
    first_divergent_paths: [],
  });
}

{
  const committed = fixture();
  const fresh = structuredClone(committed);
  fresh.industries.Software.beta.levered = 1.26;

  assert.notDeepStrictEqual(normalizePayload(fresh), normalizePayload(committed));
  assert.deepStrictEqual(comparePayloads(fresh, committed), {
    status: "mismatch",
    first_divergent_paths: ["/industries/Software/beta/levered"],
  });
  assert.deepStrictEqual(
    firstDivergentPaths(normalizePayload(fresh), normalizePayload(committed), 5),
    ["/industries/Software/beta/levered"],
  );
}

{
  const workflowPath = path.join(REPO_ROOT, ".github", "workflows", "fetch-damodaran-shadow.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /cron:\s*['"]17 11 \* \* 6['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/test-fetch-damodaran-shadow\.mjs/);
  assert.match(workflow, /node scripts\/fetch-damodaran-shadow\.mjs/);
  assert.match(
    workflow,
    /scripts\/stage-lane-manifest\.sh[\s\\]+--workflow \.github\/workflows\/fetch-damodaran-shadow\.yml[\s\\]+--stage always_if_exists/,
  );
  assert.doesNotMatch(workflow, /git add/);
  assert.match(workflow, /PUBLISHED=false/);
  assert.match(workflow, /PUBLISHED=true/);
  assert.match(workflow, /if \[\[ "\$PUBLISHED" != "true" \]\]; then\s+exit 1\s+fi/);
}

console.log("damodaran shadow comparator and workflow contract tests passed");
