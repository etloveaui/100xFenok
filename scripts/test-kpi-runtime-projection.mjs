#!/usr/bin/env node
// Public recovery summaries retain real failures/dates without exposing private state.
import assert from 'node:assert/strict';
import { projectPublicKpi } from './lib/kpi-runtime-projection.mjs';

const date = '2026-09-29T20:00:00Z';
const observed = '2026-09-30T11:31:11Z';
const privateValue = 'PRIVATE_RECOVERY_SENTINEL';
const root = { lanes: [
  { id: 'yahoo_batch_quote_history', details: {
    last_attempt: { run_id: privateValue },
    last_result: { observed_at: observed, outcome: 'failed', attempts_used: 3,
      error: 'http_error', failure_class: { token: privateValue }, run_id: privateValue, internal: { token: privateValue } },
    recovery: {
      lane_id: 'yahoo_batch_quote_history', generated_at: observed,
      oldest_source_as_of: date, counts: { fresh: 7, failed: 1, retry: 1, unavailable: { token: privateValue }, private: privateValue },
      retry_symbols: ['AGG'], lkg_details: [{ symbol: 'AGG', source_as_of: date,
        failure_observed_at: observed, payload_sha256: privateValue }],
      current_results: { attempted: 8, successes: 7, failed: 1, skipped: 0, fetch_attempts: 10,
        run_id: privateValue, errors: [{ ticker: 'AGG', error: 'http_error', internal: privateValue }] },
      current_attempt: { run_id: privateValue, promotion_deferrals: 1 },
      promotion_deferral_details: [{ private: privateValue }],
    },
  } },
  { id: 'stockanalysis', details: { recovery: {
    generated_at: observed, counts: { tracked: 2, retry: 1 },
    retry_artifacts: [{ artifact_kind: 'etf', entity: 'AGG', path: privateValue }],
    degraded_details: [{ artifact_kind: 'etf', entity: 'AGG', source_as_of: date,
      failure_observed_at: observed, failure_count: 2, error: 'decode_error', data_loss: false,
      private_path: privateValue }],
    current_results: { failed: 1, errors: [{ artifact_kind: 'etf', entity: 'AGG',
      error: 'decode_error', data_loss: false, payload: { secret: privateValue } }] },
  } } },
  { id: 'producer', details: { recovery: {
    lane_id: 'producer', counts: { keys: 2, retry: 1 }, retry_keys: ['quote'],
    current_attempt: { observed_at: observed, attempted: 2, successes: 1, failed: 1,
      failed_keys: ['quote'], run_id: privateValue, event_name: privateValue },
  }, recovery_recovered: [{ key: 'quote', retry: false, source_as_of: date,
    recovered_at: observed, recovered_from_run_id: privateValue }] } },
  { id: 'slickcharts', details: { recovery: {
    lane_id: 'slickcharts', generated_at: observed, composite_state: 'degraded',
    members: { daily: { resolution_state: 'lkg_primary', retry: true, source_as_of: date,
      bundle: { file_count: 5, files: [privateValue] },
      last_failure: { observed_at: observed, reason: 'invalid_payload', retained_generation_id: privateValue },
      last_recovery: { recovery_run_attempt: privateValue } } },
    retry_members: ['daily'],
    current_attempt: { observed_at: observed, member_id: 'daily', decision: 'retained_lkg',
      base_member_state_sha256: privateValue },
  } } },
] };
const before = JSON.stringify(root);
const projected = projectPublicKpi(root, observed);
const [yahoo, stock, producer, slick] = projected.lanes.map((lane) => lane.details);
assert.equal(yahoo.last_result.outcome, 'failed');
assert.equal(yahoo.last_result.attempts_used, 3);
assert.equal(yahoo.recovery.current_results.failed, 1);
assert.equal(yahoo.recovery.current_results.fetch_attempts, 10);
assert.equal(yahoo.recovery.current_results.errors[0].error, 'http_error');
assert.equal(yahoo.recovery.oldest_source_as_of, date);
assert.equal(yahoo.recovery.lkg_details[0].failure_observed_at, observed);
assert.deepEqual(yahoo.recovery.retry_symbols, ['AGG']);
assert.equal(stock.recovery.degraded_details[0].source_as_of, date);
assert.equal(stock.recovery.degraded_details[0].failure_count, 2);
assert.equal(stock.recovery.current_results.errors[0].error, 'decode_error');
assert.equal(producer.recovery.current_attempt.failed, 1);
assert.deepEqual(producer.recovery.current_attempt.failed_keys, ['quote']);
assert.equal(producer.recovery_recovered[0].source_as_of, date);
assert.equal(slick.recovery.members.daily.file_count, 5);
assert.equal(slick.recovery.members.daily.source_as_of, date);
assert.equal(slick.recovery.members.daily.last_failure.reason, 'invalid_payload');
assert.equal(slick.recovery.current_attempt.decision, 'retained_lkg');
assert.equal(JSON.stringify(projected).includes(privateValue), false);
assert.equal(JSON.stringify(root), before, 'public redaction must not mutate retained private evidence');
console.log('PASS public recovery failures, dates, retries and private-state redaction');
