#!/usr/bin/env node
// Standalone registry-to-KPI shape check; freshness never gates deployment.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildKpiDocuments } from "./build-fenok-data-health-kpi.mjs";
import { validateKpiDocuments } from "./check-fenok-data-health-kpi.mjs";

export function checkKpiSetsAgainstRegistry({ documents = buildKpiDocuments() } = {}) {
  return validateKpiDocuments(documents.rootDoc, documents.publicDoc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkKpiSetsAgainstRegistry();
  for (const warning of result.warnings) console.warn(`::warning:: ${warning}`);
  if (result.errors.length > 0) {
    console.error("lane-registry KPI check failed");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`lane-registry KPI check passed (${result.set_count} data sets)`);
}
