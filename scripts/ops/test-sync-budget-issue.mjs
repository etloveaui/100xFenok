import { test } from "node:test";
import assert from "node:assert/strict";
import { syncBudgetIssue } from "./sync-budget-issue.mjs";
import { parseWorkerUsage } from "./check-worker-request-budget.mjs";
import { parseAnalyticsResult } from "./check-data-supply-etf-telemetry-budget.mjs";

const title = "100xFenok Worker request budget alarm";
const result = (status) => ({ status, issueTitle: title, issueBody: `${status}: measured result` });
const issue = (number = 92, extra = {}) => ({ number, title, body: "blocked: old result", author: { login: "github-actions[bot]", is_bot: true }, ...extra });
function runner(issues = []) {
  const calls = [];
  return {
    repo: "owner/project",
    calls,
    run(args) { calls.push(args); return args[1] === "list" ? JSON.stringify(issues) : ""; },
  };
}
const writes = (mock) => mock.calls.filter((args) => args[1] !== "list");

test("a measured recovery updates and closes only the exact bot-owned alarm", () => {
  const mock = runner([issue(1, { title: `${title} investigation`, author: { login: "owner", is_bot: false } }), issue()]);
  assert.equal(syncBudgetIssue(result("ok"), mock), "closed");
  assert.deepEqual(writes(mock).map((args) => [args[1], args[2]]), [["edit", "92"], ["close", "92"]]);
});

test("all-clear with no alarm does not create an issue", () => {
  const mock = runner();
  assert.equal(syncBudgetIssue(result("ok"), mock), "unchanged");
  assert.deepEqual(writes(mock), []);
});

test("a blocked measurement never closes an incident", () => {
  const mock = runner([issue()]);
  syncBudgetIssue(result("blocked"), mock);
  assert.equal(writes(mock).some((args) => args[1] === "close"), false);
});

test("repeated failures update the live body without an hourly comment storm", () => {
  const mock = runner([issue()]);
  syncBudgetIssue(result("alert"), mock);
  assert.equal(writes(mock).some((args) => args[1] === "edit"), true);
  assert.equal(writes(mock).some((args) => args[1] === "comment"), false);
});

test("ambiguous duplicate alarms and invalid results perform no writes", () => {
  for (const [input, issues] of [[result("ok"), [issue(), issue(93)]], [result("unknown"), []], [{ ...result("ok"), issueBody: "" }, []]]) {
    const mock = runner(issues);
    assert.throws(() => syncBudgetIssue(input, mock));
    assert.deepEqual(writes(mock), []);
  }
});

test("a human-owned same-title issue is never closed or edited", () => {
  const mock = runner([issue(1, { author: { login: "owner", is_bot: false } })]);
  syncBudgetIssue(result("ok"), mock);
  assert.deepEqual(writes(mock), []);
});

test("a failed body update cannot be followed by a misleading closure", () => {
  const mock = runner([issue()]);
  const original = mock.run;
  mock.run = (args) => {
    if (args[1] === "edit") throw new Error("API failure");
    return original.call(mock, args);
  };
  assert.throws(() => syncBudgetIssue(result("ok"), mock), /API failure/);
  assert.equal(mock.calls.some((args) => args[1] === "close"), false);
});

test("missing and nonnumeric Worker measurements cannot masquerade as zero usage", () => {
  for (const account of [{}, { day: [], hour: null }, { day: [null], hour: [] },
    { day: [{ sum: { requests: "unreadable" } }], hour: [] }, { day: [{ sum: { requests: -1 } }], hour: [] }]) {
    assert.throws(() => parseWorkerUsage(account));
  }
  assert.equal(parseWorkerUsage({ day: [], hour: [] }).todayRequests, 0);
  assert.equal(parseWorkerUsage({ day: [{ sum: { requests: 12 } }], hour: [] }).todayRequests, 12);
});

test("missing and nonnumeric telemetry measurements cannot close a budget incident", () => {
  for (const payload of [{}, { data: null }, { data: [{}] },
    { data: [{ request_count: "invalid", unique_ticker_count: "0", cache_hit_count: "0" }] },
    { data: [{ request_count: -1, unique_ticker_count: 0, cache_hit_count: 0 }] }]) {
    assert.throws(() => parseAnalyticsResult(payload));
  }
  assert.equal(parseAnalyticsResult({ data: [] }).todayRequests, 0);
  assert.equal(parseAnalyticsResult({ data: [{ request_count: "12", unique_ticker_count: "1", cache_hit_count: "0" }] }).todayRequests, 12);
});
