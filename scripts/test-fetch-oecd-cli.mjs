#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OECD_SERIES, parseOecdCsv, runOecdCliShadow } from "./fetch-oecd-cli.mjs";

const header = "REF_AREA,TIME_PERIOD,OBS_VALUE\n";
const rows = Object.entries(OECD_SERIES).map(([code, key], index) => `${code},2026-06,${code === "KOR" ? "102.8698" : 100 + index / 100}`).join("\n");
const payload = parseOecdCsv(`${header}${rows}\n`);
assert.equal(Object.keys(payload.series).length, 22);
assert.equal(payload.latest_values.korea, 102.8698, "live-verified KOR anchor is preserved");
assert.equal(payload.records.length, 1);
assert.throws(() => parseOecdCsv(`${header}${rows.replace(/^AUS.*\n/mu, "")}`), /missing OECD series/);
assert.throws(() => parseOecdCsv(`${header}${rows}\nXXX,2026-06,100\n`), /unknown OECD area/);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-shadow-"));
  const shadowPath = path.join(root, "admin", "shadow", "oecd-cli.json");
  const parityReportPath = path.join(root, "admin", "parity-report.json");
  const attemptShardPath = path.join(root, "attempts", "oecd_cli.json");
  const canonicalPath = path.join(root, "data", "macro", "activity-surveys.json");
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
  fs.writeFileSync(canonicalPath, "canonical-sentinel\n");
  const result = await runOecdCliShadow({
    shadowPath,
    parityReportPath,
    attemptShardPath,
    canonicalPath,
    request: async () => ({ statusCode: 200, body: `${header}${rows}\n` }),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-500-1-oecd-cli",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(fs.readFileSync(shadowPath, "utf8")).latest_values.korea, 102.8698);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), "canonical-sentinel\n");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-failure-"));
  const shadowPath = path.join(root, "shadow.json");
  const parityReportPath = path.join(root, "parity.json");
  const attemptShardPath = path.join(root, "attempt.json");
  fs.writeFileSync(shadowPath, "shadow-sentinel\n");
  const result = await runOecdCliShadow({
    shadowPath,
    parityReportPath,
    attemptShardPath,
    canonicalPath: path.join(root, "missing.json"),
    request: async () => { throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); },
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-501-1-oecd-cli",
  });
  assert.equal(result.exitCode, 2);
  assert.equal(fs.readFileSync(shadowPath, "utf8"), "shadow-sentinel\n");
  assert.equal(JSON.parse(fs.readFileSync(attemptShardPath, "utf8")).attempts[0].execution, "threw");
}

console.log("test-fetch-oecd-cli: ok");
