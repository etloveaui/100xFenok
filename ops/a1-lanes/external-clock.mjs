#!/usr/bin/env node
// B-434: the A1 clock dispatches these existing workflows at their declared UTC minutes.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXTERNAL_CLOCK_CRONS = Object.freeze({
  "fetch-defillama.yml": "12 * * * *",
  "fetch-yahoo-ticker.yml": "5 * * * *",
  "global-writer-queue-observer.yml": "11 * * * *",
  "pins-autosync.yml": "7,37 * * * *",
  "pipeline-failure-alarm.yml": "23 * * * *",
  "retention-restore.yml": "4,19,34,49 * * * *",
  "worker-request-budget-alarm.yml": "7 * * * *",
  "fetch-treasury-tga.yml": "0 */6 * * *",
  "data-plane-serving-probe.yml": "41 */6 * * *",
  "fetch-fenok-news-tone.yml": "43 6,14,22 * * *",
});
export const EXTERNAL_CLOCK_MARKER = "external-clock/a1/v1";
// Admission dates bound the never-ran case without inventing pre-install slots.
export const EXTERNAL_CLOCK_ADMITTED_AT = Object.freeze(Object.fromEntries(
  Object.keys(EXTERNAL_CLOCK_CRONS).map((file) => [file,
    file === "worker-request-budget-alarm.yml" ? "2026-10-11T04:07:00.000Z"
      : ["fetch-treasury-tga.yml", "data-plane-serving-probe.yml", "fetch-fenok-news-tone.yml"].includes(file)
        ? "2026-10-11T07:18:00.000Z" : "2026-10-11T03:34:00.000Z"]),
));

function clockFieldMatches(field, value) {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    if (/^\*\/[1-9]\d*$/.test(part)) return value % Number(part.slice(2)) === 0;
    if (/^\d+$/.test(part)) return value === Number(part);
    throw new Error(`Unsupported external clock field: ${field}`);
  });
}

export function dueDispatches(now = new Date()) {
  const slot = new Date(now);
  slot.setUTCSeconds(0, 0);
  return Object.entries(EXTERNAL_CLOCK_CRONS)
    .filter(([, cron]) => {
      const [minute, hour, ...calendar] = cron.split(" ");
      if (calendar.length !== 3 || calendar.some((field) => field !== "*")) {
        throw new Error(`Unsupported external clock calendar: ${cron}`);
      }
      return clockFieldMatches(minute, slot.getUTCMinutes()) && clockFieldMatches(hour, slot.getUTCHours());
    })
    .map(([file]) => ({ file, slot: slot.toISOString() }));
}

// Slot titles bind external dispatch evidence to one workflow and declared minute.
// Ordinary human dispatches retain the workflow title and never enter this path.
export function externalClockSlot(workflow, run) {
  if (run?.event !== "workflow_dispatch" || !EXTERNAL_CLOCK_CRONS[workflow.file]
      || !workflow.crons?.includes(EXTERNAL_CLOCK_CRONS[workflow.file])) return null;
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
  const outcomes = [];
  for (const row of dueDispatches(now)) {
    if (state[row.file] === row.slot) continue;
    try {
      const outcome = await dispatch(row);
      if (outcome === "dispatched") state[row.file] = row.slot;
      outcomes.push({ ...row, outcome });
    } catch (error) {
      outcomes.push({ ...row, outcome: "failed", error: error.message });
    }
  }
  return outcomes;
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
    const response = await fetch(base + file + "/dispatches", {
      method: "POST", headers, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ ref: "main", inputs: { external_clock: "a1-v1", external_clock_slot: slot } }),
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
