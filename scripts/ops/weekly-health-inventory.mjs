#!/usr/bin/env node
// Weekly observation, not a release gate. The existing GitHub issue and M4
// ops-alert reader carry changes; no additional report artifact is produced.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_REGISTRY } from "../lib/lane-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const now = new Date().toISOString();
const title = "100x weekly inventory";
const findings = {};
const note = (key, group, detail) => { findings[key] = { group, detail }; };
function read(relative) {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")); }
  catch { note(`unread:${relative}`, "inventory", `${relative}: 읽을 수 없음`); return null; }
}
const kpi = read("data/admin/fenok-data-health-kpi.json");
const projection = read("data/admin/lane-registry-projection.json");
const coverage = read("data/admin/product-surface-coverage.json");
const usage = read("data/admin/data-usage-manifest.json");
const alarm = read("data/admin/alarm-state.json");
const sets = new Map((kpi?.sets ?? []).map(row => [row.set, row]));
const board = new Map((projection?.lanes ?? []).map(row => [row.id, row]));
const ownerSources = new Set(LANE_REGISTRY.providers.filter(row => row.class === "owner_managed_data"
  && row.id !== "fenok_briefing").map(row => row.id)); // Briefing is scheduled on M4.

for (const lane of LANE_REGISTRY.lanes) {
  if (lane.id === "admin_live_voice_logs" || lane.id.startsWith("mona_")) continue;
  const ownerSupplied = lane.provider_refs.some(row => row.role === "source" && ownerSources.has(row.provider_id));
  if (lane.owner_workflow && !fs.existsSync(path.join(root, lane.owner_workflow))) {
    note(`owner:${lane.id}`, "lanes", `${lane.label}: 선언된 수집 워크플로 없음`);
  }
  const missing = board.get(lane.id)?.control_room_state?.coverage?.missing;
  if (!ownerSupplied && (!board.has(lane.id) || !Array.isArray(missing))) {
    note(`coverage:${lane.id}`, "lanes", `${lane.label}: 상태판 연결 확인 불가`);
  } else if (!ownerSupplied && missing?.length) {
    note(`coverage:${lane.id}`, "lanes", `${lane.label}: ${missing.join(", ")} 미연결`);
  }
  // Owner-supplied exports remain an agreed input boundary, not new work.
  const served = sets.get(lane.id);
  if (served && !ownerSupplied) {
    // The alarm consumes these same promoted source-health observations.
    // Weekly inventory must not reconstruct them from retired raw snapshots.
    const actual = served.source_health;
    if (!actual) {
      note(`unread:source-health:${lane.id}`, "inventory", `${lane.label}: 게시된 원천 상태 없음`);
    } else {
      if (served.status === "fresh" && actual.status !== "fresh") {
        note(`label:${lane.id}`, "families", `${lane.label}: 원장은 fresh, 게시된 원천 상태는 ${actual.status}`);
      }
      const oldRatio = served.total_members ? served.fresh_members / served.total_members : null;
      const currentRatio = actual.total_members ? actual.fresh_members / actual.total_members : null;
      if (oldRatio !== null && currentRatio !== null && oldRatio >= .95 && currentRatio < .95) {
        note(`members:${lane.id}`, "families", `${lane.label}: 게시된 원천 상태는 ${actual.fresh_members}/${actual.total_members}개 기준 이내`);
      }
    }
  }
  if (lane.external_status) {
    const status = read(lane.external_status);
    if (status?.enabled) {
      const age = (Date.parse(now) - Date.parse(status.updated_at)) / 3600000;
      const bound = status.cadence_hours + status.grace_hours;
      if (!Number.isFinite(age) || !Number.isFinite(bound) || age > bound || status.consecutive_failures >= 2) {
        note(`runtime:${lane.id}`, "infrastructure", `${lane.label}: 외부 수집기 상태가 오래됐거나 연속 실패`);
      }
    }
  }
}

const workflowDir = path.join(root, ".github/workflows");
const workflows = fs.readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name));
const watched = new Set((alarm?.watched_workflows ?? []).map(row => row.file));
const exclusions = new Set((alarm?.excluded_workflows ?? []).filter(row => row.reason).map(row => row.file));
let scheduled = 0;
for (const file of workflows) {
  const source = fs.readFileSync(path.join(workflowDir, file), "utf8");
  if (!/^\s*-\s*cron:/m.test(source)) continue;
  scheduled += 1;
  if (!watched.has(file) && !exclusions.has(file)) {
    note(`workflow:${file}`, "workflows", `${file}: 예약은 있으나 경보 감시 기록에 없음`);
  }
}
for (const surface of coverage?.surfaces ?? []) {
  if (surface.status === "not_covered") note(`route:${surface.id}`, "routes", `${surface.route ?? surface.id}: 상태 측정 미연결`);
}
for (const category of usage?.categories ?? []) {
  if (category.rootJsonCount > 0 && category.directFetchCount === 0 && category.dynamicPatternCount === 0
    && category.generatedSourceCount === 0 && !["archive", "private", "admin"].includes(category.category)) {
    note(`consumer:${category.category}`, "families", `${category.category}: 기록된 소비 경로 없음 (${category.rootJsonCount}개 JSON, 삭제 판단 아님)`);
  }
}
const totals = { workflows: workflows.length, scheduled, lanes: LANE_REGISTRY.lanes.length,
  families: usage?.categories?.length ?? null, routes: coverage?.surfaces?.length ?? null,
  external_collectors: LANE_REGISTRY.lanes.filter(row => row.external_status).length };

async function github(resource, options = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY || "etloveaui/100xFenok"}/${resource}`, {
    ...options, signal: AbortSignal.timeout(30000), headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub inventory ${response.status}`);
  return response.json();
}

async function main() {
  const write = process.argv.includes("--publish");
  if (!write) {
    console.log(JSON.stringify({ observed_at: now, totals, findings }, null, 2));
    return;
  }
  let issue = null;
  for (let page = 1; ; page++) {
    // Closed inventory issues retain the baseline; clearing the alarm must not
    // reset the next week's comparison or create another rolling record.
    const rows = await github(`issues?state=all&per_page=100&sort=created&direction=asc&page=${page}`);
    if (!Array.isArray(rows)) throw new Error("Invalid weekly inventory issue list");
    issue = rows.filter(row => !row.pull_request && [title, `${title} alarm`].includes(row.title))
      .sort((a, b) => a.number - b.number)[0];
    if (issue || rows.length < 100) break;
  }
  const embedded = issue?.body?.match(/<!-- weekly-inventory-state\n([\s\S]*?)\n-->/);
  if (issue && !embedded) throw new Error("Existing weekly inventory state is unreadable; retain its body");
  const previous = embedded ? JSON.parse(embedded[1]) : null;
  const oldFindings = previous?.findings ?? {};
  const added = previous ? Object.keys(findings).filter(key => !Object.hasOwn(oldFindings, key)) : [];
  const resolved = Object.keys(oldFindings).filter(key => !Object.hasOwn(findings, key));
  const active = [...new Set([...(previous?.active ?? []), ...added])].filter(key => Object.hasOwn(findings, key));
  const summary = previous ? `주간 점검: 새 항목 ${added.length}개, 해소 ${resolved.length}개, 추적 중 ${active.length}개.`
    : `주간 점검 기준선: 기존 항목 ${Object.keys(findings).length}개를 기록했습니다. 새 경보는 보내지 않습니다.`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  const state = active.length ? "open" : "closed";
  if (previous && !added.length && !resolved.length && issue.state === state) return;
  const body = [summary, "", `읽은 목록: 워크플로 ${totals.workflows}, 수집 경로 ${totals.lanes}, 데이터 분류 ${totals.families}, 화면 ${totals.routes}, 외부 수집기 ${totals.external_collectors}.`,
    ...active.flatMap(key => ["", `## ${findings[key].detail}`, `- Alarm reasons: ${key}`]),
    "", "<details><summary>현재 관찰 항목</summary>", "", ...Object.values(findings).map(row => `- ${row.detail}`), "", "</details>",
    "", `<!-- weekly-inventory-state\n${JSON.stringify({ observed_at: now, totals, findings, active })}\n-->`].join("\n");
  const saved = await github(issue ? `issues/${issue.number}` : "issues", {
    method: issue ? "PATCH" : "POST", body: JSON.stringify({ title: active.length ? `${title} alarm` : title, body,
      ...(issue ? { state, ...(state === "closed" ? { state_reason: "completed" } : {}) } : {}) }),
  });
  // GitHub creates issues open; keep the first zero-alarm baseline closed too.
  if (!issue && state === "closed") await github(`issues/${saved.number}`, {
    method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
