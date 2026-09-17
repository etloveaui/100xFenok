import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  HEADER_NAME,
  getUtcDateString,
  generateVerifySignature,
  getVerifyHeaderValue,
  liveRequestHeaders,
} from "./live-request-headers.mjs";

test("getUtcDateString returns YYYY-MM-DD format", () => {
  const date = new Date("2026-09-17T15:30:00.000Z");
  assert.equal(getUtcDateString(date), "2026-09-17");

  const now = new Date();
  assert.match(getUtcDateString(now), /^\d{4}-\d{2}-\d{2}$/);
});

test("generateVerifySignature creates expected HMAC-SHA256 hex", () => {
  const token = "secret-key-123";
  const date = "2026-09-17";
  const expected = crypto.createHmac("sha256", token).update(date).digest("hex");

  assert.equal(generateVerifySignature(token, date), expected);
  assert.equal(generateVerifySignature(""), "");
  assert.equal(generateVerifySignature(null), "");
});

test("liveRequestHeaders returns empty object when FENOK_VERIFY_TOKEN is unset", () => {
  assert.deepEqual(liveRequestHeaders({}), {});
  assert.deepEqual(liveRequestHeaders({ FENOK_VERIFY_TOKEN: "" }), {});
  assert.deepEqual(liveRequestHeaders({ FENOK_VERIFY_TOKEN: "   " }), {});
  assert.equal(getVerifyHeaderValue({}), null);
});

test("liveRequestHeaders returns header with valid signature when token is present", () => {
  const token = "my-verify-token";
  const env = { FENOK_VERIFY_TOKEN: token };
  const date = new Date("2026-09-17T12:00:00.000Z");

  const expectedSignature = crypto.createHmac("sha256", token).update("2026-09-17").digest("hex");
  const headers = liveRequestHeaders(env, date);

  assert.deepEqual(headers, {
    [HEADER_NAME]: expectedSignature,
  });
  assert.equal(getVerifyHeaderValue(env, date), expectedSignature);
});
