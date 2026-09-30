import { spawnSync } from "node:child_process";

const tests = ["scripts/test-earnings-model.ts", "scripts/test-earnings-ui.tsx", "scripts/test-stock-detail-panel-dedupe.tsx", "scripts/test-screener-common-basis-plumbing.ts"];
let failed = false;
for (const test of tests) {
  const result = spawnSync(process.execPath, ["--import", "tsx", test], { stdio: "inherit" });
  if (result.error) console.error(result.error);
  if (result.status !== 0) failed = true;
}
for (const [command, args] of [
  ["python3", ["../scripts/test_build_earnings_overview.py"]],
  ["python3", ["../scripts/test_earnings_segments.py"]],
  [process.execPath, ["../scripts/test-earnings-overview-cloud-contract.mjs"]],
  [process.execPath, ["../scripts/test-cloud-data-plane-routing-authority.mjs"]],
  [process.execPath, ["scripts/test-load-guard-remote-dispatch.mjs"]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) console.error(result.error);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
