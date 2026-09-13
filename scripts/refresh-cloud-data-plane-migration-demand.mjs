#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MIGRATION_DEMAND_FIXTURE_PATHS,
  emitMigrationDemandFixture,
} from "./lib/cloud-data-plane-candidate-scope.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = process.argv.slice(2).find((value) => value.startsWith("--candidate="));
const candidateId = argument?.slice("--candidate=".length) ?? "";

if (process.argv.length !== 3 || !candidateId || !MIGRATION_DEMAND_FIXTURE_PATHS[candidateId]) {
  throw new Error(
    `usage: node scripts/refresh-cloud-data-plane-migration-demand.mjs --candidate=${Object.keys(MIGRATION_DEMAND_FIXTURE_PATHS).join("|")}`,
  );
}

const fixture = emitMigrationDemandFixture({ repoRoot, candidateId });
console.log(JSON.stringify({
  candidate_id: candidateId,
  asset_count: fixture._manifest_measurement.asset_count,
  payload_bytes: fixture._manifest_measurement.payload_bytes,
}));
