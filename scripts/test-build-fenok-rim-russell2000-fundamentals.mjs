#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { archiveRussell2000Snapshot, parseRussell2000FactsheetText } from "./build-fenok-rim-russell2000-fundamentals.mjs";

const text = fs.readFileSync(new URL("./fixtures/fenok-rim-russell2000-factsheet-20260331.txt", import.meta.url), "utf8");
const parsed = parseRussell2000FactsheetText(text);

assert.equal(parsed.identity, "Russell 2000");
assert.equal(parsed.ticker, "RTY");
assert.equal(parsed.as_of, "2026-03-31");
assert.equal(parsed.fundamentals.price_to_book, 2.29);
assert.equal(parsed.fundamentals.dividend_yield, 0.0127);
assert.equal(parsed.fundamentals.price_to_earnings_ex_negative, 18.96);
assert.equal(parsed.fundamentals.eps_growth_5y, 0.1036);
assert.equal(parsed.fundamentals.holdings, 1933);
assert.ok(Math.abs(parsed.derived.current_roe_ex_negative_basis - 2.29 / 18.96) < 1e-12);
assert.ok(Math.abs(parsed.derived.payout_ex_negative_basis - 0.240792) < 1e-12);

assert.throws(() => parseRussell2000FactsheetText(text.replace("Russell 2000 Index", "Other Index")), /identity missing/);
assert.throws(() => parseRussell2000FactsheetText(text.replace("Dividend Yield", "Distribution")), /Dividend Yield/);
assert.throws(() => parseRussell2000FactsheetText(text.replace("(As of 3/31/2026)", "")), /as-of date/);

const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-rut-archive-test-"));
try {
  const bytes = Buffer.from("%PDF-test-snapshot");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const snapshot = {
    schema_version: "test",
    generated_at: "2026-08-04T00:00:00.000Z",
    as_of: "2026-03-31",
    source: { sha256 },
  };
  const archived = archiveRussell2000Snapshot({ archiveDir: archiveRoot, pdfBytes: bytes, snapshot, automaticDownload: true });
  assert.ok(fs.existsSync(archived.raw_pdf));
  assert.ok(fs.existsSync(archived.snapshot_json));
  assert.equal(JSON.parse(fs.readFileSync(archived.latest_pointer, "utf8")).as_of, "2026-03-31");
  const repeated = archiveRussell2000Snapshot({ archiveDir: archiveRoot, pdfBytes: bytes, snapshot, automaticDownload: true });
  assert.equal(repeated.raw_pdf, archived.raw_pdf);
  assert.throws(() => archiveRussell2000Snapshot({
    archiveDir: archiveRoot,
    pdfBytes: Buffer.from("%PDF-older"),
    snapshot: { ...snapshot, as_of: "2025-12-31", source: { sha256: crypto.createHash("sha256").update(Buffer.from("%PDF-older")).digest("hex") } },
    automaticDownload: true,
  }), /date regression/);
} finally {
  fs.rmSync(archiveRoot, { recursive: true, force: true });
}

console.log("Russell 2000 official fundamentals parser tests passed");
