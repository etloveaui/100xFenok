#!/usr/bin/env node
// The R2 free-tier cost gate has never once done the job it was written for.
//
// Measured 2026-08-21 over the whole recorded history: six `gate_blocked`
// publish outcomes exist, every one of them an HTTP 429 from Cloudflare's
// object-listing API during the gate's own inventory walk, and not one a budget
// breach. Three further 429 events were recorded as `gate_after: "blocked"` on
// runs that published anyway, and nothing branches on that field - on 08-18 and
// 08-19 the discarded block and the enforced block were 61 and 50 seconds apart,
// three days before the incident that finally got the gate looked at.
//
// Two defects, and they compound. The gate's `cf()` has no retry, so a single
// 429 anywhere in a ~32-call sequential walk fails the whole gate closed - and
// that walk runs on every publish of every family, so the gate is a large part
// of why it is being rate limited. And exit 2 means both "an axis is at or above
// 90% of the free allowance" and "the measurement could not be trusted", so the
// ledger cannot tell a real overrun from an unreadable one; `gateVerdict` folded
// both into "blocked".
//
// The repository already contained the correct policy. cloud-data-plane-r2-rest
// - the WRITE path, same host, same account, same token, running immediately
// after this gate - honors Retry-After with exponential backoff, stable jitter
// and a bounded attempt count. It was the only Retry-After reader in the repo.
// That policy is now shared rather than duplicated, so the two cannot drift.
//
// What is deliberately NOT changed: whether an unverifiable measurement blocks
// publication. It still does, for strict and tolerant families alike. Fail-
// closed is the safe default and relaxing it is a policy call for the owner, not
// a side effect of making the signal honest.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_RATE_LIMIT_ATTEMPTS,
  MAX_RATE_LIMIT_BACKOFF_MS,
  rateLimitDelayMs,
  retryAfterMs,
  stableJitterMs,
} from "../lib/cloudflare-rate-limit.mjs";
import {
  GATE_MEASUREMENT_UNVERIFIED_EXIT,
  gateBlocksPublication,
  gateVerdict,
} from "../publish-cloud-data-generation.mjs";
import { GATE_VERDICTS } from "../lib/publish-outcome-shard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8");
const stripComments = (s) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// --- The shared policy behaves ----------------------------------------------
const header = (value) => ({ headers: { get: (k) => (k === "retry-after" ? value : null) } });

assert.equal(retryAfterMs(header(null)), null, "no header means no requested delay");
assert.equal(retryAfterMs(header("2")), 2000, "seconds form");
assert.equal(retryAfterMs(header("0")), 0, "zero seconds is a real answer, not absent");
assert.ok(retryAfterMs(header("not a date")) === null, "garbage must not become a delay");
const future = new Date(Date.now() + 5000).toUTCString();
const dated = retryAfterMs(header(future));
assert.ok(dated > 3000 && dated <= 6000, `HTTP-date form should be about 5s, got ${dated}`);

// Retry-After wins when it is larger, and everything stays bounded.
assert.ok(
  rateLimitDelayMs(header("9999"), 1, "u") <= MAX_RATE_LIMIT_BACKOFF_MS,
  "a hostile Retry-After must not park the runner",
);
assert.ok(
  rateLimitDelayMs(header("5"), 1, "u") >= 5000,
  "a server-requested delay must be honoured when it exceeds the backoff",
);
assert.ok(
  rateLimitDelayMs(header(null), 3, "u") > rateLimitDelayMs(header(null), 1, "u"),
  "backoff must grow with attempts",
);
// Jitter is stable per URL: two callers hitting different paths desynchronise,
// and the same caller does not jump around between attempts.
assert.equal(stableJitterMs("a"), stableJitterMs("a"));
assert.notEqual(stableJitterMs("a"), stableJitterMs("b"));
// Testing the jitter function alone was vacuous: deleting its use from
// rateLimitDelayMs left this passing. Assert the delay itself desynchronises.
{
  const a = rateLimitDelayMs(header(null), 1, "https://example.invalid/a");
  const b = rateLimitDelayMs(header(null), 1, "https://example.invalid/b");
  assert.notEqual(a, b, "identical conditions on different URLs must not retry in lockstep");
}
assert.ok(MAX_RATE_LIMIT_ATTEMPTS >= 3, "one or two attempts is not a rate-limit policy");

// --- One policy, not two ------------------------------------------------------
for (const file of ["scripts/lib/cloud-data-plane-r2-rest.mjs", "scripts/check-r2-free-tier-usage.mjs"]) {
  const code = stripComments(read(file));
  assert.match(
    code,
    /from "\.[^"]*cloudflare-rate-limit\.mjs"/,
    `${file} must use the shared rate-limit policy`,
  );
  assert.ok(
    !/^function (rateLimitDelayMs|retryAfterMs|stableJitterMs)\b/m.test(code),
    `${file} redefines a shared rate-limit helper; the two would drift`,
  );
}

// --- The gate must actually retry, exercised rather than inferred -------------
// A structural version of this check passed with the 429 branch replaced by
// `if (false)`, so it is driven for real.
{
  // The module must not run main() on import. It did: `await main()` was
  // unguarded, so importing it walked the live Cloudflare account and then
  // called process.exit(0) - which made THIS test appear to pass while it had
  // actually terminated mid-run. Checked structurally because a test cannot
  // observe its own process being exited out from under it.
  const gateSource = read("scripts/check-r2-free-tier-usage.mjs");
  assert.match(
    gateSource,
    /if \(process\.argv\[1\][^\n]*import\.meta\.url\)\) \{\s*\n\s*await main\(\);/,
    "check-r2-free-tier-usage must guard main(); an unguarded one runs a live account walk on import",
  );

  const { cf } = await import("../check-r2-free-tier-usage.mjs");
  const ok = { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ success: true, result: "measured" }) };
  const tooMany = { status: 429, ok: false, headers: { get: (k) => (k === "retry-after" ? "0" : null) } };

  {
    const seen = [];
    const slept = [];
    let calls = 0;
    const body = await cf("/probe", {
      transport: async () => { calls += 1; seen.push(calls); return calls < 3 ? tooMany : ok; },
      sleepImpl: async (ms) => { slept.push(ms); },
    });
    assert.equal(body.result, "measured", "a 429 must be retried through to the real answer");
    assert.equal(calls, 3, `expected two retries then success, got ${calls} calls`);
    assert.equal(slept.length, 2, "each retry must wait");
    assert.ok(slept.every((ms) => ms >= 0 && ms <= MAX_RATE_LIMIT_BACKOFF_MS), `delays out of bounds: ${slept}`);
  }

  {
    let calls = 0;
    await assert.rejects(
      cf("/probe", { transport: async () => { calls += 1; return tooMany; }, sleepImpl: async () => {} }),
      /429/,
      "an unending 429 must still fail closed, not loop forever",
    );
    assert.equal(calls, MAX_RATE_LIMIT_ATTEMPTS + 1, `retries must be bounded, saw ${calls} calls`);
  }

  {
    const failing = { status: 503, ok: false, headers: { get: () => null } };
    let calls = 0;
    await assert.rejects(
      cf("/probe", { transport: async () => { calls += 1; return failing; }, sleepImpl: async () => {} }),
      /503/,
      "a persistent 5xx must fail closed",
    );
    assert.ok(calls > 1 && calls <= 5, `a transient 5xx should be retried a bounded number of times, saw ${calls}`);
  }
}

// --- Breach and unmeasurable must be different signals ------------------------
assert.equal(typeof GATE_MEASUREMENT_UNVERIFIED_EXIT, "number");
assert.notEqual(GATE_MEASUREMENT_UNVERIFIED_EXIT, 2, "an unreadable gate must not look like a breach");
assert.notEqual(GATE_MEASUREMENT_UNVERIFIED_EXIT, 1, "it is not a warning either");
assert.notEqual(GATE_MEASUREMENT_UNVERIFIED_EXIT, 0, "and it is certainly not ok");

assert.equal(gateVerdict({ code: 0 }), "ok");
assert.equal(gateVerdict({ code: 1 }), "warn");
assert.equal(gateVerdict({ code: 2 }), "blocked");
assert.equal(
  gateVerdict({ code: GATE_MEASUREMENT_UNVERIFIED_EXIT }),
  "unverified",
  "the ledger must record that the gate could not measure, not that it refused",
);
assert.ok(
  GATE_VERDICTS.includes("unverified"),
  "the shard schema must accept the verdict the publisher now writes, or every record fails validation",
);

// The gate script must use the distinct code on its measurement-failure path.
{
  const src = read("scripts/check-r2-free-tier-usage.mjs");
  const at = src.indexOf("measurement failed");
  assert.ok(at > 0, "the measurement-failure path is gone; this contract is stale");
  const window = src.slice(at, at + 400);
  const exitCall = /process\.exit\(([A-Za-z_0-9]+)\)/.exec(window);
  assert.ok(exitCall, `the measurement-failure path must exit explicitly: ${window.slice(0, 120)}`);
  const exited = exitCall[1];
  // A named constant is accepted and preferred; resolve it to its value so the
  // assertion is about the code that ships, not about how it is spelled.
  const resolved = /^\d+$/.test(exited)
    ? Number(exited)
    : Number(new RegExp(`const ${exited} = (\\d+);`).exec(src)?.[1]);
  assert.equal(
    resolved,
    GATE_MEASUREMENT_UNVERIFIED_EXIT,
    `the measurement-failure path exits ${exited} (${resolved}); it must not reuse the breach code`,
  );
}

// --- Fail-closed is unchanged, and that is asserted so it stays a decision ----
for (const strictGate of [true, false]) {
  assert.equal(
    gateBlocksPublication({ gateCode: GATE_MEASUREMENT_UNVERIFIED_EXIT, strictGate }),
    true,
    `an unverifiable measurement must still block (strict=${strictGate}); relaxing it is an owner call`,
  );
  assert.equal(gateBlocksPublication({ gateCode: 2, strictGate }), true);
  assert.equal(gateBlocksPublication({ gateCode: 0, strictGate }), false);
}
assert.equal(gateBlocksPublication({ gateCode: 1, strictGate: false }), false, "tolerant families still pass a warn");
assert.equal(gateBlocksPublication({ gateCode: 1, strictGate: true }), true, "strict families still block on a warn");

console.log("test-cost-gate-rate-limit: ok");
