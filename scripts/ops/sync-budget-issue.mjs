import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576 });

const TITLES = new Set([
  "100xFenok Worker request budget alarm",
  "100xFenok ETF typed-unavailable telemetry budget alarm",
]);

// Synchronize only this automation's exact issue. A measurement failure is not
// recovery, and an API failure must not be converted into a successful close.
export function syncBudgetIssue(result, { repo, run = gh } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !TITLES.has(result?.issueTitle)
    || !["ok", "alert", "blocked"].includes(result?.status)
    || typeof result?.issueBody !== "string" || !result.issueBody.trim()) {
    throw new Error("Invalid budget result or repository; no issue may be changed");
  }
  const issues = JSON.parse(run(["issue", "list", "--repo", repo, "--state", "open",
    "--search", `${result.issueTitle} in:title`, "--json", "number,title,body,author", "--limit", "100"]));
  if (!Array.isArray(issues) || issues.length >= 100) throw new Error("Issue lookup may be incomplete");
  const matches = issues.filter((issue) => issue.title === result.issueTitle
    && (issue.author?.login === "github-actions[bot]"
      || (issue.author?.login === "github-actions" && issue.author?.is_bot === true)));
  if (matches.length > 1) throw new Error("Ambiguous duplicate budget alarms; no issue may be changed");
  const existing = matches[0];
  if (existing && (!Number.isSafeInteger(existing.number) || existing.number <= 0)) throw new Error("Invalid issue identity");
  if (existing) {
    run(["issue", "edit", String(existing.number), "--repo", repo, "--body", result.issueBody]);
    if (result.status === "ok") {
      run(["issue", "close", String(existing.number), "--repo", repo, "--reason", "completed",
        "--comment", "Budget measurement recovered. The latest measured result is in the issue body."]);
      return "closed";
    }
    // The body is live state; do not create another comment on every hourly run.
    return "updated";
  }
  if (result.status === "ok") return "unchanged";
  run(["issue", "create", "--repo", repo, "--title", result.issueTitle, "--body", result.issueBody]);
  return "created";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  console.log(syncBudgetIssue(result, { repo: process.env.GITHUB_REPOSITORY }));
}
