import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import LaneBoard, { type LaneBoardKpiLane, type LaneProjection } from "../src/app/admin/data-lab/LaneBoard";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const projection: LaneProjection[] = [
  {
    id: "fred_macro",
    label: "FRED macro",
    store_kind: "payload",
    cadence: { kind: "daily", provider: "fred" },
    enforcement: "live",
    privacy_class: "public_mirror",
    owner_workflow: "fetch-fred-macro.yml",
    control_room_state: {
      schedule: {
        workflow: "fetch-fred-macro.yml",
        cron: "0 8 * * *",
        calendar_id: "utc",
        grace: { unit: "hours", value: 24 },
        latest_expected_slot: "2026-08-01T08:00:00Z",
        next_expected_slot: "2026-08-02T08:00:00Z",
        status: "overdue",
      },
      latest_attempt: {
        observed_at: "2026-07-31T08:00:00Z",
        outcome: "failed",
        failure_class: "transport",
      },
      source: {
        source_date: "2026-07-31",
        source_date_reason: "kpi_lane_as_of",
        sla: { unit: "hours", calendar: "wall_clock", max_staleness: 50, age: 1, status: "ready" },
      },
      recovery: { state: "retry_pending", retry_count: 2, recovered_at: null, lkg_source_date: null },
      incident: { status: "open", workflow: "fetch-fred-macro.yml", class: "engineering" },
      queue: { evidence_status: "measured", wait_ms: 1234, depth: 2 },
    },
  },
  {
    id: "sec_13f",
    label: "SEC 13F",
    store_kind: "artifact_only",
    cadence: { kind: "quarterly", provider: "sec" },
    enforcement: "shadow",
    privacy_class: "private",
    owner_workflow: null,
  },
];

const kpiLanes: LaneBoardKpiLane[] = [
  {
    id: "fred_macro",
    label: "FRED macro",
    status: "ready",
    status_label: "정상",
    as_of: "2026-07-18T00:00:00Z",
    details: {
      recovery_retry_set: [1, 2],
      recovery_recovered: [1],
      last_attempt: { event_name: "schedule", observed_at: "2026-07-18T06:30:00Z" },
    },
  },
  // KPI-only composite gate — must land in the Platform Gates strip, not a lane row.
  {
    id: "rim_inputs",
    label: "RIM inputs",
    status: "blocked",
    status_label: "차단",
    as_of: null,
  },
];

const html = renderToStaticMarkup(<LaneBoard projection={projection} kpiLanes={kpiLanes} />);
const legacyAttemptMarkup = '<span class="font-semibold text-slate-500">2026-07-18<span class="ml-1 text-[10px] text-slate-500">schedule</span></span>';

// Both registry lanes render as rows.
assert(html.includes('data-lane-row="fred_macro"'), "fred_macro lane row missing");
assert(html.includes('data-lane-row="sec_13f"'), "sec_13f lane row missing");
assert(html.includes("FRED macro"), "fred_macro label missing");
assert(html.includes("SEC 13F"), "sec_13f label missing");

// Joined lane surfaces its KPI status + recovery counts + metadata (Korean labels).
assert(html.includes("정상"), "joined lane status (정상) missing");
assert(html.includes("재시도 2 · 복구 1"), "recovery counts not joined from KPI details");
// #365 P2: last_attempt observed_at + event render in the lane row.
assert(html.includes("2026-07-18"), "last_attempt observed_at date should render");
assert(html.includes("schedule"), "last_attempt event_name should render");
assert(html.includes(legacyAttemptMarkup), "no-runId last_attempt markup must retain the exact legacy bytes");
assert(!html.includes("actions/runs/"), "default LaneBoard render must not fabricate a run deep link");

const explicitNoRunIdHtml = renderToStaticMarkup(
  <LaneBoard projection={projection} kpiLanes={kpiLanes} runIds={{}} />,
);
assert(explicitNoRunIdHtml === html, "an explicit empty run-id map must remain byte-identical to the legacy render");

const runIdHtml = renderToStaticMarkup(
  <LaneBoard projection={projection} kpiLanes={kpiLanes} runIds={{ fred_macro: "29681166769" }} />,
);
assert(
  runIdHtml.includes('href="https://github.com/etloveaui/100xFenok/actions/runs/29681166769"'),
  "a present runId must render the exact private-repo Actions deep link",
);
assert(runIdHtml.includes('data-lane-run-id="29681166769"'), "run-id anchor marker missing");
assert(runIdHtml.includes(legacyAttemptMarkup), "run-id anchor must not rewrite the existing event+date span");
assert((runIdHtml.match(/actions\/runs\//g) || []).length === 1, "only the mapped lane may render a run deep link");
assert(html.includes("공개 미러") && html.includes("실시행") && html.includes("payload"), "metadata chips missing/untranslated");
assert(html.includes("fetch-fred-macro.yml"), "owner_workflow basename not shown");

// Control-room evidence is rendered in its own block and does not reuse the
// product freshness enum/status cell above.
assert(html.includes('data-admin-control-room-state="true"'), "control-room state block missing");
assert(html.includes('data-control-room-lane="fred_macro"'), "control-room lane card missing");
assert(html.includes('data-control-room-schedule="overdue"'), "control-room schedule marker missing");
assert(html.includes('data-control-room-attempt="failed"'), "control-room attempt marker missing");
assert(html.includes('data-control-room-recovery="retry_pending"'), "control-room recovery marker missing");
assert(html.includes('data-control-room-incident="open"'), "control-room incident marker missing");
assert(html.includes('data-control-room-queue="measured"'), "control-room queue marker missing");
assert(html.includes("스케줄 지연"), "control-room schedule label missing");
assert(html.includes("최근 시도:") && html.includes('data-control-room-attempt="failed">실패'), "control-room attempt label missing");
assert(html.includes("복구:") && html.includes('data-control-room-recovery="retry_pending">재시도 대기'), "control-room recovery label missing");
assert(html.includes("Queue:") && html.includes('data-control-room-queue="measured">측정됨') && html.includes("1234ms"), "control-room queue evidence missing");

// Registry lane with no KPI match shows an honest 'KPI 없음', not a fake status.
assert(html.includes("KPI 없음"), "unmatched registry lane should show KPI 없음");
assert(html.includes("워크플로 없음"), "null owner_workflow should show 워크플로 없음");

// KPI-only gate is in the Platform Gates strip, NOT force-joined as a lane row.
assert(html.includes('data-platform-gate="rim_inputs"'), "rim_inputs should render as a platform gate");
assert(!html.includes('data-lane-row="rim_inputs"'), "rim_inputs must NOT be a lane row (never force-joined)");
assert(html.includes("차단"), "platform gate status missing");

// Empty projection degrades honestly.
const emptyHtml = renderToStaticMarkup(<LaneBoard projection={null} kpiLanes={kpiLanes} />);
assert(emptyHtml.includes("읽지 못했습니다"), "null projection should show the read-failure message");
// Platform gates still render even when projection is null.
assert(emptyHtml.includes('data-platform-gate="rim_inputs"'), "platform gates should render even with null projection");

// Alarm badge (#365 P3): open / clear / unknown / missing states.
const openHtml = renderToStaticMarkup(
  <LaneBoard projection={projection} kpiLanes={kpiLanes} alarm={{ status: "open", open_incident_count: 2 }} />,
);
assert(openHtml.includes('data-admin-alarm-badge="open"'), "open alarm should mark the badge open");
assert(openHtml.includes("알람 열림 2"), "open alarm should show the incident count");

const clearHtml = renderToStaticMarkup(
  <LaneBoard projection={projection} kpiLanes={kpiLanes} alarm={{ status: "clear", open_incident_count: 0 }} />,
);
assert(clearHtml.includes("알람 없음"), "clear alarm should show 알람 없음");
assert(!clearHtml.includes('data-admin-alarm-badge="open"'), "clear alarm must not mark the badge open");

const noAlarmHtml = renderToStaticMarkup(<LaneBoard projection={projection} kpiLanes={kpiLanes} alarm={null} />);
assert(noAlarmHtml.includes("알람 상태 미확인"), "missing alarm state should degrade honestly");

console.log(JSON.stringify({ ok: true, suite: "lane-board render contract", lanes: projection.length }, null, 2));
