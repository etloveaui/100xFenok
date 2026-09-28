#!/usr/bin/env node
// Bounded scheduled campaigns around the existing guarded executor. No R2 access.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const FIRST_NIGHT = '2026-09-27';
export const STATE_TITLE = '100xFenok R2 retention schedule state';
const MARKER = '[retention-schedule-state]\n';
export function freshState() { return {schema: 1, weekly_enabled: false, campaign: null}; }
export function campaignAt(iso) {
  const kst = new Date(new Date(iso).getTime() + 9 * 3600_000);
  if (!Number.isFinite(kst.getTime()) || kst.getUTCDay() !== 0 || kst.getUTCHours() < 1 || kst.getUTCHours() >= 6) return null;
  return kst.toISOString().slice(0,10);
}
export function claim(state, {now, runId}) {
  const next = structuredClone(state);
  const id = campaignAt(now);
  if (!id) return {run:false, reason:'outside_window', state:next};
  if (id !== FIRST_NIGHT && !next.weekly_enabled) return {run:false, reason:'initial_success_required', state:next};
  if (next.campaign?.attempts.some(a => a.outcome === 'pending')) return {run:false, reason:'unresolved_attempt', state:next};
  if (next.campaign?.id !== id) next.campaign = {id, attempts:[], succeeded:false};
  const c = next.campaign;
  if (c.succeeded) return {run:false, reason:'already_succeeded', state:next};
  if (c.attempts.length >= 10) return {run:false, reason:'attempt_budget', state:next};
  if (c.attempts.some(a => a.run_id === runId)) return {run:false, reason:'duplicate_run', state:next};
  c.attempts.push({run_id:runId, claimed_at:now, outcome:'pending'});
  return {run:true, reason:'claimed', state:next};
}
export function ready(state, {now, runId}) {
  const id=campaignAt(now), c=state.campaign;
  const close=id ? Date.parse(`${id}T06:00:00+09:00`) : NaN;
  const own=c?.attempts.find(a=>a.run_id===runId && a.outcome==='pending');
  const run=Boolean(id && c?.id===id && own && !c.succeeded && close-Date.parse(now)>240000);
  return {run, reason:run?'ready':'window_closed_or_claim_invalid', hard_deadline_epoch_seconds:run?Math.floor(close/1000):null};
}
export function acceptedReport(report) {
  const a = report?.apply;
  const datasets = Object.values(a?.verification_datasets ?? {});
  const restore = report?.restore;
  return report?.result === 'retention_window_applied'
    && a?.result === 'retention_batch_applied' && a.apply_exit_code === 0
    && a.verification === 'ok' && datasets.length === 26
    && datasets.every(d => Array.isArray(d.missing_referenced_payloads) && d.missing_referenced_payloads.length === 0)
    && (report.publishers?.length ?? 0) === 28
    && restore?.confirmed?.length === 28
    && ['unconfirmed','failed','missing','unsupported'].every(k => !restore[k]?.length)
    && Number.isFinite(report.duration?.first_disable_to_restore_seconds)
    && report.duration.first_disable_to_restore_seconds <= 1200;
}
export function finish(state, {runId, report, now}) {
  const next = structuredClone(state);
  const c = next.campaign;
  const a = c?.attempts.find(row => row.run_id === runId);
  if (!a) throw new Error('No durable claim for this run');
  if (a.outcome !== 'pending') return next;
  a.finished_at = now;
  a.outcome = report?.result ?? 'missing_report';
  a.reason = report?.reason ?? null;
  a.busy_lanes = [...new Set([...(report?.preflight?.offenders ?? []), ...(report?.drain?.offenders ?? [])].map(row => row.file))];
  if (acceptedReport(report)) {
    a.bytes_freed = (report.apply.payloads?.bytes ?? 0) + (report.apply.manifests?.bytes ?? 0);
    a.pause_seconds = report.duration.first_disable_to_restore_seconds;
    c.succeeded = true;
    next.weekly_enabled = true;
    next.first_success ??= {campaign:c.id,run_id:runId,at:now,bytes_freed:a.bytes_freed,pause_seconds:a.pause_seconds};
  }
  return next;
}
function gh(args, repo) {
  return execFileSync('gh', [...args, ...(!['api'].includes(args[0]) ? ['--repo',repo] : [])], {encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});
}
function load(repo) {
  // REST pagination avoids search-index lag and exact title matching avoids ambiguity.
  const pages = JSON.parse(gh(['api',`repos/${repo}/issues?state=open&per_page=100`,'--paginate','--slurp'],repo));
  const matches = pages.flat().filter(row => row.title === STATE_TITLE);
  if (matches.length > 1) throw new Error('Ambiguous schedule state issues');
  if (!matches.length) return {number:null,state:freshState()};
  const issue = matches[0];
  if (!issue.body?.startsWith(MARKER)) throw new Error('Invalid schedule state marker');
  const state = JSON.parse(issue.body.slice(MARKER.length));
  if (state.schema !== 1 || typeof state.weekly_enabled !== 'boolean'
    || (state.campaign && (!Array.isArray(state.campaign.attempts) || typeof state.campaign.succeeded !== 'boolean'))) throw new Error('Invalid schedule state');
  return {number:issue.number,state};
}
function save(repo, number, state) {
  const file = `${process.env.RUNNER_TEMP ?? '/tmp'}/retention-schedule-${process.pid}.json`;
  fs.writeFileSync(file,JSON.stringify({title:STATE_TITLE,body:MARKER+JSON.stringify(state,null,2)}));
  const result = JSON.parse(gh(['api','--method',number?'PATCH':'POST',`repos/${repo}/issues${number?'/'+number:''}`,'--input',file],repo));
  const readback = JSON.parse(gh(['api',`repos/${repo}/issues/${result.number}`],repo));
  if (readback.body !== MARKER+JSON.stringify(state,null,2)) throw new Error('Schedule state readback mismatch');
  return result.number;
}
export function main(argv=process.argv.slice(2), env=process.env) {
  const command=argv[0], repo=env.GITHUB_REPOSITORY, runId=env.GITHUB_RUN_ID;
  if (!repo || !runId) throw new Error('GitHub repository/run identity required');
  const now=new Date().toISOString();
  const {number,state}=load(repo);
  if (command === 'inspect') {console.log(JSON.stringify({state,eligible:claim(state,{now,runId}).run}));return;}
  if (command === 'ready') {
    const result=ready(state,{now,runId});
    if(env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT,`run=${result.run}\nhard_deadline=${result.hard_deadline_epoch_seconds ?? ''}\n`);
    if(!result.run) fs.writeFileSync('window-report.json',JSON.stringify({result:'retention_window_deferred',reason:result.reason})+'\n');
    console.log(JSON.stringify(result));return;
  }
  if (command === 'claim') {
    const result=claim(state,{now,runId});
    if (result.run) save(repo,number,result.state);
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT,`run=${result.run}\n`);
    console.log(JSON.stringify({run:result.run,reason:result.reason,campaign:result.state.campaign?.id}));return;
  }
  if (command === 'finish') {
    let report=null;
    if (fs.existsSync('window-report.json')) {
      const lines=fs.readFileSync('window-report.json','utf8').trim().split('\n');
      try {report=JSON.parse(lines.at(-1));} catch { /* Missing result never means success. */ }
    }
    const next=finish(state,{runId,report,now});
    const issue=save(repo,number,next);
    const c=next.campaign;
    const summary={campaign:c.id,attempts:c.attempts.length,succeeded:c.succeeded,weekly_enabled:next.weekly_enabled,
      busy_lanes:[...new Set(c.attempts.flatMap(a=>a.busy_lanes??[]))],latest:c.attempts.at(-1)};
    console.log(JSON.stringify(summary));
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY,`### R2 retention campaign\n\n\`\`\`json\n${JSON.stringify(summary,null,2)}\n\`\`\`\nState: https://github.com/${repo}/issues/${issue}\n`);
    return;
  }
  throw new Error('Expected claim, finish, or inspect');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {main();} catch(error) {console.error(`retention-schedule: ${error.message}`);process.exitCode=1;}
}
