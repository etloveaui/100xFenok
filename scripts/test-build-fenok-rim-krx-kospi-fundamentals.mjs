#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildKrxKospiFundamentals, parseKrxArgs, parseKrxKospiFundamentals } from "./build-fenok-rim-krx-kospi-fundamentals.mjs";

const fixture = new URL("./fixtures/fenok-rim-krx-kospi-screen-11007-test.json", import.meta.url);
const payload = JSON.parse(fs.readFileSync(fixture, "utf8"));
const parsed = parseKrxKospiFundamentals(payload, { requestedDate: "2026-03-31" });
assert.equal(parsed.identity, "KOSPI");
assert.equal(parsed.internal_index_code, "1001");
assert.equal(parsed.as_of, "2026-03-31");
assert.equal(parsed.fundamentals.close, 2750);
assert.equal(parsed.fundamentals.price_to_earnings_trailing, 20);
assert.equal(parsed.fundamentals.price_to_earnings_forward, 18);
assert.equal(parsed.fundamentals.price_to_book, 2);
assert.equal(parsed.fundamentals.dividend_yield, 0.015);
assert.equal(parsed.derived.current_roe_trailing_basis, 0.1);
assert.equal(parsed.derived.payout_trailing_basis, 0.3);
assert.throws(() => parseKrxKospiFundamentals("LOGOUT", { requestedDate: "2026-03-31" }), /authentication required/);
assert.throws(() => parseKrxKospiFundamentals(payload, { requestedDate: "2026-04-01" }), /exact returned trading-date row missing/);
assert.throws(() => parseKrxKospiFundamentals({ output: [{ ...payload.output[0], TRD_DD: null }] }, { requestedDate: "2026-03-31" }), /exact returned trading-date row missing/);
assert.throws(() => parseKrxKospiFundamentals(payload, { requestedDate: "2026-02-31" }), /invalid date/);
assert.doesNotThrow(() => parseKrxKospiFundamentals({ output: [{ ...payload.output[0], TRD_DD: "2024/02/29" }] }, { requestedDate: "2024-02-29" }));
assert.equal(parseKrxKospiFundamentals({ output: [{ ...payload.output[0], FWD_PER: "0" }] }, { requestedDate: "2026-03-31" }).fundamentals.price_to_earnings_forward, null);
assert.throws(() => parseKrxKospiFundamentals({ output: [{ ...payload.output[0], WT_PER: "0" }] }, { requestedDate: "2026-03-31" }), /invalid trailing PER/);
assert.throws(
  () => parseKrxArgs(["--date", "2026-03-31", "--response", "manual.json"]),
  /requires an explicit --output or --stdout/,
);
assert.equal(parseKrxArgs(["--date", "2026-03-31", "--response", "manual.json", "--stdout"]).output, null);
await assert.rejects(
  buildKrxKospiFundamentals({ date: "2026-03-31", cookie: "", archiveDir: null }),
  /KRX_DATA_COOKIE is required/,
);

const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-kospi-test-"));
try {
  const snapshot = await buildKrxKospiFundamentals({
    date: "2026-03-31",
    responsePath: fileURLToPath(fixture),
    archiveDir,
  });
  assert.equal(snapshot.source.publisher, "Korea Exchange");
  assert.equal(snapshot.source.bld, "dbms/MDC/STAT/standard/MDCSTAT00702");
  assert.equal(snapshot.runtime_yoo_value_injection, false);
  assert.ok(fs.existsSync(path.join(archiveDir, snapshot.archive.raw_response)));
  assert.ok(fs.existsSync(path.join(archiveDir, snapshot.archive.snapshot_json)));
  assert.ok(fs.existsSync(path.join(archiveDir, snapshot.archive.snapshot_manifest)));
  assert.equal(snapshot.archive.latest_pointer, null);
  assert.equal(fs.existsSync(path.join(archiveDir, "latest.json")), false);
} finally {
  fs.rmSync(archiveDir, { recursive: true, force: true });
}

let capturedRequest = null;
const liveLike = await buildKrxKospiFundamentals({
  date: "2026-03-31",
  cookie: "test-session-cookie",
  archiveDir: null,
  fetchImpl: async (url, options) => {
    capturedRequest = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  },
});
assert.equal(liveLike.source.retrieval, "authenticated_official_screen_request");
assert.equal(capturedRequest.url, "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd");
assert.equal(capturedRequest.options.headers.Cookie, "test-session-cookie");
assert.equal(capturedRequest.options.headers["X-Requested-With"], "XMLHttpRequest");
const requestBody = new URLSearchParams(capturedRequest.options.body);
assert.equal(requestBody.get("bld"), "dbms/MDC/STAT/standard/MDCSTAT00702");
assert.equal(requestBody.get("indTpCd"), "1");
assert.equal(requestBody.get("indTpCd2"), "001");
assert.equal(requestBody.get("strtDd"), "20260331");
assert.equal(requestBody.get("endDd"), "20260331");

const authorityArchive = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-kospi-authority-test-"));
try {
  const official = await buildKrxKospiFundamentals({
    date: "2026-03-31",
    cookie: "test-session-cookie",
    archiveDir: authorityArchive,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) }),
  });
  const latestPath = path.join(authorityArchive, official.archive.latest_pointer);
  const firstLatest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  assert.equal(firstLatest.as_of, "2026-03-31");

  const futurePayload = { output: [{ ...payload.output[0], TRD_DD: "2027/03/31" }] };
  const futurePath = path.join(authorityArchive, "manual-future.json");
  fs.writeFileSync(futurePath, JSON.stringify(futurePayload));
  const manualFuture = await buildKrxKospiFundamentals({
    date: "2027-03-31",
    responsePath: futurePath,
    archiveDir: authorityArchive,
  });
  assert.equal(manualFuture.archive.latest_pointer, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(latestPath, "utf8")), firstLatest);

  const revisedPayload = { output: [{ ...payload.output[0], CLSPRC_IDX: "2,751.00" }] };
  const revised = await buildKrxKospiFundamentals({
    date: "2026-03-31",
    cookie: "test-session-cookie",
    archiveDir: authorityArchive,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(revisedPayload) }),
  });
  const revisedLatest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  assert.notEqual(revisedLatest.sha256, firstLatest.sha256);
  assert.equal(revisedLatest.sha256, revised.source.raw_response_sha256);

  const parsedPath = path.join(authorityArchive, official.archive.snapshot_json);
  const originalParsed = fs.readFileSync(parsedPath, "utf8");
  const tamperedParsed = JSON.parse(originalParsed);
  tamperedParsed.derived.payout_trailing_basis = 0.99;
  fs.writeFileSync(parsedPath, `${JSON.stringify(tamperedParsed, null, 2)}\n`);
  await assert.rejects(
    buildKrxKospiFundamentals({
      date: "2026-03-31",
      cookie: "test-session-cookie",
      archiveDir: authorityArchive,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) }),
    }),
    /parsed archive hash collision or corruption/,
  );
  fs.writeFileSync(parsedPath, originalParsed);

  const rawPath = path.join(authorityArchive, official.archive.raw_response);
  fs.writeFileSync(rawPath, "corrupt");
  await assert.rejects(
    buildKrxKospiFundamentals({
      date: "2026-03-31",
      cookie: "test-session-cookie",
      archiveDir: authorityArchive,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) }),
    }),
    /hash collision or corruption/,
  );
} finally {
  fs.rmSync(authorityArchive, { recursive: true, force: true });
}

console.log("KRX KOSPI official fundamentals parser tests passed");
