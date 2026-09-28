#!/usr/bin/env node
/**
 * scripts/lib/live-request-headers.mjs
 *
 * Verification header generator for requests targeting the live 100xFenok host
 * (Spec §5, Task S3-wiring).
 *
 * Exact Verification Header Specification:
 * - Header Name: x-fenok-verify
 * - Signature Algorithm: HMAC-SHA256
 * - Key: process.env.FENOK_VERIFY_TOKEN
 * - Payload / Message: UTC date formatted as "YYYY-MM-DD" (10 characters, ISO UTC date, e.g. "2026-09-17")
 * - Output Encoding: hex (64 lowercase hexadecimal characters)
 *
 * Example:
 *   date = "2026-09-17"
 *   token = "my-secret-token"
 *   value = crypto.createHmac("sha256", token).update(date).digest("hex")
 *   header = { "x-fenok-verify": value }
 *
 * Behavior:
 * - If FENOK_VERIFY_TOKEN is not set or empty: returns {} (no-op, zero impact on unconfigured environments).
 * - If FENOK_VERIFY_TOKEN is set: returns { "x-fenok-verify": "<hmac_sha256_hex>" }.
 */

import crypto from "node:crypto";
import process from "node:process";

export const HEADER_NAME = "x-fenok-verify";

/**
 * Returns current UTC date formatted as YYYY-MM-DD.
 * @param {Date} [now]
 * @returns {string}
 */
export function getUtcDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Generates the HMAC-SHA256 hex signature over the given date string using the provided token.
 * @param {string} token
 * @param {string} [dateStr] - Defaults to current UTC date YYYY-MM-DD
 * @returns {string}
 */
export function generateVerifySignature(token, dateStr = getUtcDateString()) {
  if (!token || typeof token !== "string") return "";
  return crypto.createHmac("sha256", token).update(dateStr).digest("hex");
}

/**
 * Returns the verification header value if FENOK_VERIFY_TOKEN is present in env, else null.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Date} [now]
 * @returns {string | null}
 */
export function getVerifyHeaderValue(env = process.env, now = new Date()) {
  const token = env.FENOK_VERIFY_TOKEN?.trim();
  if (!token) return null;
  const dateStr = getUtcDateString(now);
  return generateVerifySignature(token, dateStr);
}

/**
 * Returns verification headers object to be merged into fetch/HTTP options.
 * When FENOK_VERIFY_TOKEN is set: { "x-fenok-verify": "<hex>" }
 * When FENOK_VERIFY_TOKEN is unset: {}
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Date} [now]
 * @returns {Record<string, string>}
 */
export function liveRequestHeaders(env = process.env, now = new Date()) {
  const value = getVerifyHeaderValue(env, now);
  if (!value) return {};
  return { [HEADER_NAME]: value };
}

// CLI printable mode: node scripts/lib/live-request-headers.mjs [--print]
if (import.meta.url === `file://${process.argv[1]}` || process.argv.includes("--print")) {
  const value = getVerifyHeaderValue();
  if (value) {
    process.stdout.write(value);
  }
}
