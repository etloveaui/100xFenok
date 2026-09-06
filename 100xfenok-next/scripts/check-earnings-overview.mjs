import { spawnSync } from "node:child_process";

const tests = ["scripts/test-earnings-model.ts", "scripts/test-earnings-ui.tsx"];
let failed = false;
for (const test of tests) {
  const result = spawnSync(process.execPath, ["--import", "tsx", test], { stdio: "inherit" });
  if (result.error) console.error(result.error);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
