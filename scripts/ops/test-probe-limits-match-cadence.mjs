import assert from "node:assert/strict";
import fs from "node:fs";
import { scheduleLimitDays } from "./probe-data-plane-serving.mjs";

const calendars = JSON.parse(fs.readFileSync(new URL('../lib/data-supply-detection-calendars.json', import.meta.url)));
const monthly = calendars.schedules.find(row => row.id === 'monthly_0800_utc');
assert.equal(scheduleLimitDays(monthly, calendars), 38);
assert.equal(scheduleLimitDays({...monthly, grace:{unit:'calendar_days',value:15}}, calendars), 46, 'declared grace changes the derived ceiling');
assert.equal(scheduleLimitDays(calendars.schedules.find(row => row.id === 'weekly_0700_sun_utc'), calendars), 9);
assert.equal(scheduleLimitDays(calendars.schedules.find(row => row.id === 'hourly_at_05'), calendars), 1);
assert.throws(() => scheduleLimitDays({...monthly, cron:'garbage'}, calendars), /invalid schedule/);

console.log("schedule limit arithmetic: ok");
