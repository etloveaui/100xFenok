import { spawnSync } from "node:child_process";

const suites = [
  "score-winddown-preservation.ts",
  "score-winddown-review-legacy.ts",
  "score-winddown-learn-resume.ts",
  "score-winddown-recovery.ts",
  "score-winddown-recovery-api.ts",
  "score-winddown-storage-scope.ts",
];
let failures = 0;
for (const suite of suites) {
  console.log(`\nWIND DOWN preservation: ${suite}`);
  const result = spawnSync("tsx", [`scripts/${suite}`], { stdio: "inherit" });
  if (result.status !== 0 || result.error) failures += 1;
}
console.log(`\nWIND DOWN preservation: ${suites.length} suites, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
