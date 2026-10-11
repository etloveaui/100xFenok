import assert from 'node:assert/strict';
import fs from 'node:fs';
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
