import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENROLLED_PATHS, ENROLLED_PREFIXES } from '../lib/cloud-data-plane-worker-read.mjs';
import { FAMILY_SCHEDULE_LIMITS, resolveSourceAgeDays, resolvePublishedAgeDays, scheduleLimitDays } from './probe-data-plane-serving.mjs';

const beforeSource = { 'fred-yardeni':14, 'slickcharts-monthly':40, 'slickcharts-history':40, 'slickcharts-weekly':10, 'slickcharts-symbols':10, damodaran:10, sentiment:10, 'nasdaq-giw-sox':10, 'us-indices-daily':10 };
const beforePublished = { 'fred-yardeni':10, 'slickcharts-weekly':10, 'slickcharts-monthly':40, 'slickcharts-history':40, 'fdic-tier1':110 };
const families = [...new Set([...ENROLLED_PATHS.values(), ...ENROLLED_PREFIXES.map(row => row.family)])].sort();
console.log('| Family | Declared days | Source before → after | Published before → after |');
console.log('|---|---:|---:|---:|');
for (const family of families) {
  const row = FAMILY_SCHEDULE_LIMITS[family];
  assert.ok(row, `${family}: enrolled family has a cadence decision`);
  const source = resolveSourceAgeDays({family});
  const published = resolvePublishedAgeDays({family});
  const oldSource = family === 'computed-signals' ? null : beforeSource[family] ?? 5;
  const oldPublished = beforePublished[family] ?? 7;
  if (source !== null) {
    assert.ok(source >= oldSource, `${family}: source never tightens`);
    if (row.days !== null) assert.ok(source >= row.days, `${family}: source covers cadence plus grace`);
  }
  assert.ok(published >= oldPublished, `${family}: heartbeat never tightens`);
  if (row.days !== null && family !== 'fdic-tier1') assert.ok(published >= row.days, `${family}: heartbeat covers cadence plus grace`);
  if (!row.schedule_ids.length) assert.equal(row.days, null, `${family}: unscheduled source never fabricates a cron`);
  console.log(`| ${family} | ${row.days ?? 'no registered cron'} | ${oldSource} → ${source} | ${oldPublished} → ${published} |`);
}
assert.equal(resolvePublishedAgeDays({family:'fdic-tier1'}), 110);
assert.equal(resolveSourceAgeDays({family:'fdic-tier1',path:'/data/macro/fdic-tier1.json'}), 180);
const calendars = JSON.parse(fs.readFileSync(new URL('../lib/data-supply-detection-calendars.json', import.meta.url)));
const monthly = calendars.schedules.find(row => row.id === 'monthly_0800_utc');
assert.equal(scheduleLimitDays(monthly, calendars), 38);
assert.equal(scheduleLimitDays({...monthly, grace:{unit:'calendar_days',value:15}}, calendars), 46, 'declared grace changes the derived ceiling');
assert.equal(scheduleLimitDays(calendars.schedules.find(row => row.id === 'weekly_0700_sun_utc'), calendars), 9);
assert.equal(scheduleLimitDays(calendars.schedules.find(row => row.id === 'hourly_at_05'), calendars), 1);
assert.throws(() => scheduleLimitDays({...monthly, cron:'garbage'}, calendars), /invalid schedule/);
console.log(`test-probe-limits-match-cadence: ${families.length} enrolled families passed`);

// Retain the independent workflow-YAML publication-cadence guard.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

// Coarse on purpose: the question is only "at least this many days between
// runs", so a cadence class is enough and a minute-level model would add
// precision the assertion never uses.
export function cadenceDays(cron) {
  const [, , dayOfMonth, , dayOfWeek] = cron.trim().split(/\s+/);
  if (dayOfMonth !== "*") return 31;
  if (dayOfWeek !== "*") return dayOfWeek.includes(",") ? 3 : 7;
  return 1;
}

export function slowestCadence(workflowSource) {
  const crons = [...workflowSource.matchAll(/cron:\s*'([^']+)'/g)].map((match) => match[1]);
  if (crons.length === 0) return null;
  // A family is only as fresh as its most frequent schedule allows, so the
  // shortest interval is the honest bound when a workflow carries several.
  return Math.min(...crons.map(cadenceDays));
}

// Only enrolled paths matter, and each is resolved as the probe resolves it so
// a per-path override counts. Checking a bare family name instead would both
// invent violations for families the probe never sees and miss the path
// overrides that already relax fdic-tier1 and the fred-banking cadences.
const cadenceByFamily = new Map();
for (const file of fs.readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith(".yml")).sort()) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
  const cadence = slowestCadence(source);
  if (cadence === null) continue;
  for (const match of source.matchAll(/--family=([\w-]+)/g)) {
    const family = match[1];
    const known = cadenceByFamily.get(family);
    cadenceByFamily.set(family, known === undefined ? cadence : Math.min(known, cadence));
  }
}

const violations = [];
for (const [enrolledPath, family] of ENROLLED_PATHS) {
  const cadence = cadenceByFamily.get(family);
  if (cadence === undefined) continue;
  const heartbeat = resolvePublishedAgeDays({ path: enrolledPath, family });
  if (heartbeat !== null && heartbeat < cadence) {
    violations.push(`${family}: heartbeat limit ${heartbeat}d is narrower than its ${cadence}d cadence`);
  }
  const sourceAge = resolveSourceAgeDays({ path: enrolledPath, family });
  if (sourceAge !== null && sourceAge < cadence) {
    violations.push(`${family}: source limit ${sourceAge}d is narrower than its ${cadence}d cadence`);
  }
}

assert.deepEqual(
  [...new Set(violations)].sort(),
  [],
  `probe limits must not be narrower than the declared cadence:\n  ${[...new Set(violations)].sort().join("\n  ")}`,
);

// The cadence reader must be able to distinguish the classes it depends on.
assert.equal(cadenceDays("0 9 1 * *"), 31);
assert.equal(cadenceDays("17 11 * * 6"), 7);
assert.equal(cadenceDays("17 11,23 * * 6"), 7);
assert.equal(cadenceDays("0 8 * * *"), 1);
assert.equal(cadenceDays("0 6 1-7 * 1"), 31);

console.log("probe limits match declared cadence: ok");
