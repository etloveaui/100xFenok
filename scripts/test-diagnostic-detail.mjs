#!/usr/bin/env node

import assert from "node:assert/strict";

let boundedDiagnosticDetail;
try {
  ({ boundedDiagnosticDetail } = await import("./lib/diagnostic-detail.mjs"));
} catch {
  assert.fail("bounded diagnostic helper must exist");
}

const safe = boundedDiagnosticDetail(new TypeError("income statement endpoint moved"));
assert.match(safe, /^TypeError: income statement endpoint moved$/);

const secret = boundedDiagnosticDetail(new Error(
  "request failed https://provider.example/data?api_key=secret-value Authorization: Bearer abc.def",
));
assert.match(secret, /https:\/\/provider\.example\/data\?\[redacted\]/);
assert.doesNotMatch(secret, /secret-value|abc\.def/);

const payload = boundedDiagnosticDetail(new SyntaxError(
  'response body: {"token":"secret-value","rows":[1,2,3]}',
));
assert.match(payload, /response body: \[redacted\]/);
assert.doesNotMatch(payload, /secret-value|rows/);

const syntaxPayload = boundedDiagnosticDetail(new SyntaxError(
  'Unexpected token o in JSON at position 1; "secret-provider-body" is not valid JSON',
));
assert.doesNotMatch(syntaxPayload, /secret-provider-body/);
assert.match(syntaxPayload, /SyntaxError: Unexpected token o in JSON at position 1/);

const bounded = boundedDiagnosticDetail(new Error("x".repeat(1000)));
assert.equal(bounded.length, 320, "diagnostic detail must stay within 320 characters");

// Credential labels are not always bare words. This repo authenticates FINRA
// with an OAuth client-credentials pair whose env names are
// FINRA_API_CLIENT_ID / FINRA_API_CLIENT_SECRET, and `\bsecret\b` never
// matches inside `client_secret` because the underscore is a word character.
// A prefixed or suffixed label must redact exactly like a bare one - an
// over-redacted log line costs nothing, a leaked credential costs everything.
const SECRET_SHAPE = "sk_live_A1b2C3d4E5f6G7h8I9j0";
for (const label of [
  "key",
  "client_secret",
  "client-secret",
  "CLIENT_SECRET",
  "x_api_key",
  "refresh_token",
  "auth_token",
  "app_password",
]) {
  const detail = boundedDiagnosticDetail(new Error(`request rejected ${label}=${SECRET_SHAPE}`));
  assert.doesNotMatch(detail, new RegExp(SECRET_SHAPE),
    `credential label ${label} must never reach a log line`);
}

console.log("test-diagnostic-detail: ok");
