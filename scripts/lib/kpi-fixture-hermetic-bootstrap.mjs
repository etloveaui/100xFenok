import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerKpiFixtureRoot } from "./kpi-fixture-hermetic-fs-guard.mjs";

if (!process.env.KPI_HERMETIC_FIXTURE_ROOT) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kpi-declared-fixture-root-"));
  registerKpiFixtureRoot(fixtureRoot);
  process.env.KPI_HERMETIC_FIXTURE_ROOT = fixtureRoot;
  process.env.KPI_HERMETIC_FIXTURE_ROOTS = fixtureRoot;
  process.env.KPI_HERMETIC_BOOTSTRAPPED = "1";

  const { SLICKCHARTS_MEMBER_PATHS } = await import("./slickcharts-composite-recovery.mjs");
  for (const specs of Object.values(SLICKCHARTS_MEMBER_PATHS)) {
    for (const spec of specs) {
      if (!spec.required) continue;
      const target = path.join(fixtureRoot, spec.path);
      if (spec.kind === "directory") {
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "AAPL.json"), '{"symbol":"AAPL","updated":"2026-07-14T11:00:00Z"}\n');
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '{"updated":"2026-07-14T11:00:00Z"}\n');
      }
    }
  }

  const yahooIndex = path.join(fixtureRoot, "data", "admin", "yahoo-hourly-ticker", "index.json");
  fs.mkdirSync(path.dirname(yahooIndex), { recursive: true });
  fs.writeFileSync(yahooIndex, '{"generated_at":"2026-07-18T22:00:00.000Z"}\n');

  if (!process.argv.includes("--data-root")) process.argv.push("--data-root", fixtureRoot);
  process.once("exit", () => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
}
