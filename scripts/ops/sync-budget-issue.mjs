import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576 });

// Existing failure-only workflow behavior, extracted for regression tests.
export function syncBudgetIssue(result, { repo, run = gh } = {}) {
  if (result.status === "ok") return "unchanged";
  const issues = JSON.parse(run(["issue", "list", "--repo", repo, "--state", "open",
    "--search", `${result.issueTitle} in:title`, "--json", "number,title,body,author", "--limit", "100"]));
  const existing = issues[0];
  if (existing) {
    run(["issue", "edit", String(existing.number), "--repo", repo, "--body", result.issueBody]);
    run(["issue", "comment", String(existing.number), "--repo", repo, "--body", result.issueBody]);
    return "updated";
  }
  run(["issue", "create", "--repo", repo, "--title", result.issueTitle, "--body", result.issueBody]);
  return "created";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  console.log(syncBudgetIssue(result, { repo: process.env.GITHUB_REPOSITORY }));
}
