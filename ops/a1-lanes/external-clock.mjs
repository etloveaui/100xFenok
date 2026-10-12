#!/usr/bin/env node
// B-434: the A1 clock dispatches these existing workflows at their declared UTC minutes.
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Workflow schedule declarations are the clock source. The installed A1
// service reads the matching published workflow snapshot through this path.
const WORKFLOW_DIRECTORY = process.env.FENOK_CLOCK_WORKFLOWS
  || fileURLToPath(new URL("../../.github/workflows/", import.meta.url));
const CLOCK_FILES = [
  "deploy-worker.yml",
  "fetch-fred-macro.yml",
  "fetch-fred-banking.yml",
  "fetch-sentiment.yml",
  "fetch-us-indices-daily.yml",
  "fetch-nasdaq-giw-sox.yml",
  "slickcharts-daily.yml",
  "fetch-fenok-apewisdom.yml",
  "fetch-fenok-private-options.yml",
  "fenok-edge-daily.yml",
  "fenok-edge-krx-daily.yml",
  "check-sec13f-live-parity.yml",
  "build-stocks-analyzer.yml",
  "update-manifest.yml",
  "fetch-defillama.yml",
  "fetch-yahoo-ticker.yml",
  "global-writer-queue-observer.yml",
  "pins-autosync.yml",
  "pipeline-failure-alarm.yml",
  "retention-restore.yml",
  "worker-request-budget-alarm.yml",
  "fetch-treasury-tga.yml",
  "data-plane-serving-probe.yml",
  "fetch-fenok-news-tone.yml",
  "fetch-damodaran-shadow.yml",
  "fetch-edgar-filings.yml",
  "fetch-finra-ats-weekly.yml",
  "fetch-fred-yardeni.yml",
  "fetch-oecd-cli.yml",
  "fetch-stockanalysis.yml",
  "fetch-yf-finance.yml",
  "slickcharts-history.yml",
  "slickcharts-monthly.yml",
  "slickcharts-weekly.yml",
];
function declaredCrons(file) {
  const source = readFileSync(path.join(WORKFLOW_DIRECTORY, file), "utf8");
  const crons = [...source.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']\s*(?:#.*)?$/gm)].map(match => match[1]);
  if (!crons.length) throw new Error(`Missing workflow schedules: ${file}`);
  return crons;
}
export const EXTERNAL_CLOCK_CRONS = Object.freeze(Object.fromEntries(CLOCK_FILES.map(file => [file,
  Object.freeze([...new Set([...declaredCrons(file), ...(file === "deploy-worker.yml" ? ["49 * * * *"] : [])])]),
])));
const budgetCrons = EXTERNAL_CLOCK_CRONS["worker-request-budget-alarm.yml"];
const WORKER_BUDGET_CRONS = Object.freeze({ requests: budgetCrons[0], telemetry: budgetCrons[1] });

// These collectors already use all 25 human dispatch inputs. A typed repository
// event preserves that interface and carries only the external-clock binding.
export const CLOCK_REPOSITORY_EVENTS = Object.freeze({
  "fetch-stockanalysis.yml": "external-clock-stockanalysis",
  "fetch-yf-finance.yml": "external-clock-yf-finance",
});
export const externalClockEvent = file => CLOCK_REPOSITORY_EVENTS[file] ? "repository_dispatch" : "workflow_dispatch";
export function clockInputs(eventName, event) {
  return eventName === "repository_dispatch" ? event?.client_payload || {} : event?.inputs || {};
}
export function collectorClockMode(file, cron) {
  const crons = externalClockCrons(file);
  const index = crons.indexOf(cron);
  if (index < 0) return "manual";
  if (file === "fetch-stockanalysis.yml") return ["stock_daily", "etf_weekday", "etf_general"][index];
  if (file === "fetch-yf-finance.yml") return ["stocks", "etfs"][index];
  return "scheduled";
}
export const EXTERNAL_CLOCK_MARKER = "external-clock/a1/v1";
// Admission dates bound the never-ran case without inventing pre-install slots.
export const EXTERNAL_CLOCK_ADMITTED_AT = Object.freeze(Object.fromEntries(
  Object.keys(EXTERNAL_CLOCK_CRONS).map((file) => [file,
    !(["deploy-worker.yml", "fetch-defillama.yml", "fetch-yahoo-ticker.yml",
      "global-writer-queue-observer.yml", "pins-autosync.yml", "pipeline-failure-alarm.yml",
      "retention-restore.yml", "worker-request-budget-alarm.yml", "fetch-treasury-tga.yml",
      "data-plane-serving-probe.yml", "fetch-fenok-news-tone.yml"].includes(file))
      ? ["fetch-damodaran-shadow.yml", "fetch-edgar-filings.yml", "fetch-finra-ats-weekly.yml", "fetch-fred-yardeni.yml", "fetch-oecd-cli.yml", "fetch-stockanalysis.yml", "fetch-yf-finance.yml", "slickcharts-history.yml", "slickcharts-monthly.yml", "slickcharts-weekly.yml"].includes(file) ? "2026-10-12T02:22:14.223Z" : "2026-10-11T09:20:00.000Z"
      : file === "deploy-worker.yml" ? "2026-10-11T08:40:00.000Z"
      : file === "worker-request-budget-alarm.yml" ? "2026-10-11T04:07:00.000Z"
      : ["fetch-treasury-tga.yml", "data-plane-serving-probe.yml", "fetch-fenok-news-tone.yml"].includes(file)
        ? "2026-10-11T07:18:00.000Z" : "2026-10-11T03:34:00.000Z"]),
));

function clockFieldMatches(field, value) {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    if (/^\*\/[1-9]\d*$/.test(part)) return value % Number(part.slice(2)) === 0;
    if (/^\d+$/.test(part)) return value === Number(part);
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    throw new Error(`Unsupported external clock field: ${field}`);
  });
}

export function externalClockCrons(file) {
  const value = EXTERNAL_CLOCK_CRONS[file];
  return value ? (Array.isArray(value) ? value : [value]) : [];
}

export function clockCronMatches(cron, slot) {
  const [minute, hour, dom, month, dow, extra] = cron.split(" ");
  if (extra !== undefined || !dow || !Number.isFinite(slot.getTime())) {
    throw new Error(`Unsupported external clock calendar: ${cron}`);
  }
  const day = clockFieldMatches(dom, slot.getUTCDate());
  const weekday = clockFieldMatches(dow, slot.getUTCDay()) || (slot.getUTCDay() === 0 && clockFieldMatches(dow, 7));
  const dayMatches = dom === "*" ? weekday : dow === "*" ? day : day || weekday;
  return clockFieldMatches(minute, slot.getUTCMinutes())
    && clockFieldMatches(hour, slot.getUTCHours())
    && clockFieldMatches(month, slot.getUTCMonth() + 1) && dayMatches;
}

// Both clocks select the same declared job. Ordinary manual dispatch retains
// the existing behavior of checking both budgets; delayed marked runs retain
// their original slot rather than borrowing the runner's current hour.
export function workerBudgetJobs(eventName, event = {}) {
  const marked = eventName === "workflow_dispatch" && event.inputs?.external_clock === "a1-v1";
  if (eventName === "workflow_dispatch" && !marked) return { requests: true, telemetry: true };
  const slot = marked ? new Date(event.inputs.external_clock_slot) : null;
  return Object.fromEntries(Object.entries(WORKER_BUDGET_CRONS).map(([job, cron]) => [job,
    marked ? Number.isFinite(slot.getTime()) && clockCronMatches(cron, slot)
      : eventName === "schedule" && event.schedule === cron]));
}

export function dueDispatches(now = new Date()) {
  const slot = new Date(now);
  slot.setUTCSeconds(0, 0);
  return Object.keys(EXTERNAL_CLOCK_CRONS)
    .filter((file) => externalClockCrons(file).some((cron) => clockCronMatches(cron, slot)))
    .map((file) => ({ file, slot: slot.toISOString() }));
}

// Slot titles bind external dispatch evidence to one workflow and declared minute.
// Ordinary human dispatches retain the workflow title and never enter this path.
export function externalClockSlot(workflow, run) {
  if (run?.event !== externalClockEvent(workflow.file) || !EXTERNAL_CLOCK_CRONS[workflow.file]
      || !externalClockCrons(workflow.file).every((cron) => workflow.crons?.includes(cron))) return null;
  const prefix = `${EXTERNAL_CLOCK_MARKER} ${workflow.file} `;
  if (!run.display_title?.startsWith(prefix)) return null;
  const raw = run.display_title.slice(prefix.length);
  const stamp = Date.parse(raw);
  const created = Date.parse(run.created_at || run.run_started_at);
  if (!Number.isFinite(stamp) || !Number.isFinite(created) || stamp > created
      || new Date(stamp).toISOString() !== raw) return null;
  return dueDispatches(new Date(stamp)).some((row) => row.file === workflow.file && row.slot === raw)
    ? stamp : null;
}

export async function dispatchDue({ now = new Date(), state = {}, dispatch }) {
  // Independent slots share one timer turn. A slow API route cannot block the
  // following minute; each route has its own bounded request timeout.
  return Promise.all(dueDispatches(now).filter(row => state[row.file] !== row.slot).map(async row => {
    try {
      const outcome = await dispatch(row);
      if (outcome === "dispatched") state[row.file] = row.slot;
      return { ...row, outcome };
    } catch (error) {
      return { ...row, outcome: "failed", error: error.message };
    }
  }));
}

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is missing from the service EnvironmentFile");
  const base = "https://api.github.com/repos/etloveaui/100xFenok/actions/workflows/";
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  async function metadata(file) {
    const response = await fetch(base + file, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${file} metadata HTTP ${response.status}`);
    const value = await response.json();
    return { id: value.id, path: value.path, state: value.state };
  }
  if (process.argv.includes("--probe")) {
    console.log(JSON.stringify(await metadata("fetch-yahoo-ticker.yml")));
    return;
  }
  const statePath = path.join(os.homedir(), ".local/state/fenok-external-clock/dispatches.json");
  let state;
  try { state = JSON.parse(await fs.readFile(statePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; state = {}; }
  const outcomes = await dispatchDue({ state, dispatch: async ({ file, slot }) => {
    // Honor the retention pause set; this clock never enables a disabled workflow.
    if ((await metadata(file)).state !== "active") return "disabled";
    const inputs = { external_clock: "a1-v1", external_clock_slot: slot };
    const eventType = CLOCK_REPOSITORY_EVENTS[file];
    const url = eventType ? "https://api.github.com/repos/etloveaui/100xFenok/dispatches" : base + file + "/dispatches";
    const body = eventType ? { event_type: eventType, client_payload: inputs } : { ref: "main", inputs };
    const response = await fetch(url, {
      method: "POST", headers, signal: AbortSignal.timeout(20_000), body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${file} dispatch HTTP ${response.status}`);
    return "dispatched";
  } });
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(statePath + ".tmp", JSON.stringify(state) + "\n", { mode: 0o600 });
  await fs.rename(statePath + ".tmp", statePath);
  console.log(JSON.stringify({ outcomes }));
  if (outcomes.some((row) => row.outcome === "failed")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
