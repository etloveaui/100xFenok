import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

import DataStateNotice, { DataStateBadge } from "../src/components/DataStateNotice";
import AppShellFreshnessPill from "../src/components/shell/AppShellFreshnessPill";
import { DATA_STATE_LABELS, makeDataState, type DataReadinessStatus } from "../src/lib/data-state";

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

const freshnessTones: Partial<Record<DataReadinessStatus, string>> = {
  ready: "ok",
  stale: "warn",
  unavailable: "muted",
};

for (const status of ["ready", "stale", "unavailable"] as const) {
  const state = makeDataState({
    status,
    detail: `private ${status} detail must not render`,
  });
  const html = renderToStaticMarkup(<AppShellFreshnessPill state={state} />);
  assert(html.includes('data-app-shell-freshness="true"'), `${status}: missing AppShell freshness marker`);
  assert(html.includes(`data-shell-pill ${freshnessTones[status]}`), `${status}: missing canonical shell tone`);
  assert(html.includes(DATA_STATE_LABELS[status]), `${status}: missing canonical freshness label`);
  assert(!html.includes(state.detail), `${status}: AppShell freshness must render state.label only`);
}

assert(renderToStaticMarkup(<AppShellFreshnessPill state={null} />) === "", "null freshness must render nothing");
assert(renderToStaticMarkup(<AppShellFreshnessPill />) === "", "undefined freshness must render nothing");

const appRoot = path.resolve(import.meta.dirname, "..");
const appShellSource = fs.readFileSync(path.join(appRoot, "src/components/shell/AppShell.tsx"), "utf8");
assert(/freshness\?: DataState \| null/.test(appShellSource), "AppShell must expose the optional DataState freshness prop");
assert(
  (appShellSource.match(/<AppShellFreshnessPill state=\{freshness\}/g) ?? []).length === 2,
  "AppShell must render the freshness slot in desktop topbar and mobile appbar",
);

const adopterSource = fs.readFileSync(path.join(appRoot, "src/app/market-valuation/MarketValuationShell.tsx"), "utf8");
assert(/freshness=\{freshness\}/.test(adopterSource), "the first adopter must pass route-owned freshness to AppShell");
assert(/onFreshnessChange=\{setFreshness\}/.test(adopterSource), "the adopter must reuse the existing market-valuation data owner");

console.log(JSON.stringify({ ok: true, statuses }, null, 2));
