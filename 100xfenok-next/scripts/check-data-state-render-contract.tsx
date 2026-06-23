import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import DataStateNotice, { DataStateBadge } from "../src/components/DataStateNotice";
import { makeDataState, type DataReadinessStatus } from "../src/lib/data-state";

const statuses: DataReadinessStatus[] = [
  "ready",
  "partial",
  "stale",
  "pending",
  "unavailable",
  "error",
];

const expectedText: Record<DataReadinessStatus, string[]> = {
  ready: ["준비됨"],
  partial: ["부분 준비"],
  stale: ["오래됨"],
  pending: ["확인 중"],
  unavailable: ["확인 불가"],
  error: ["오류"],
};

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function renderState(status: DataReadinessStatus): string {
  const state = makeDataState({
    status,
    detail: `${status} render contract`,
    asOf: status === "stale" || status === "ready" ? "2026-06-23T09:30:00Z" : null,
  });
  return renderToStaticMarkup(
    <div>
      <DataStateNotice state={state} />
      <DataStateBadge state={state} />
    </div>,
  );
}

for (const status of statuses) {
  const html = renderState(status);
  assert(
    html.includes(`data-data-state="${status}"`),
    `${status}: missing data-data-state marker`,
  );
  assert(
    html.includes('data-testid="data-state-notice"'),
    `${status}: missing notice test id`,
  );
  assert(
    html.includes('data-testid="data-state-badge"'),
    `${status}: missing badge test id`,
  );
  for (const text of expectedText[status]) {
    assert(html.includes(text), `${status}: missing Korean label ${text}`);
  }
}

console.log(JSON.stringify({ ok: true, statuses }, null, 2));
