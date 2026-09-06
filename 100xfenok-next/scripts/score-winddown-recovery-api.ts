import assert from "node:assert/strict";
import { executeWindDownRecoveryRequest } from "../src/features/winddown/server/recoveryApi";

async function main() {
  let exports = 0;
  let restores = 0;
  const snapshot = { kind: "synthetic-backup", records: [{ key: "original", value: { keep: true } }] };
  const deps = {
    authenticated: async () => true,
    exportSnapshot: async () => { exports++; return snapshot; },
    restoreCopy: async (value: unknown) => {
      restores++;
      assert.deepEqual(value, snapshot);
      return { ok: true, recordCount: 1, legacyRecordCount: 0, duplicate: false };
    },
  };
  const url = "https://winddown.test/api/winddown/records";
  const denied = await executeWindDownRecoveryRequest(new Request(url), {
    ...deps, authenticated: async () => false,
  });
  assert.equal(denied.status, 401);
  assert.equal(exports, 0);
  const exported = await executeWindDownRecoveryRequest(new Request(url), deps);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("cache-control") ?? "", /no-store/);
  assert.match(exported.headers.get("content-disposition") ?? "", /attachment/);
  assert.deepEqual(await exported.json(), snapshot);
  const crossOrigin = await executeWindDownRecoveryRequest(new Request(url, {
    method: "POST", headers: { Origin: "https://other.test", "Content-Type": "application/json" }, body: JSON.stringify(snapshot),
  }), deps);
  assert.equal(crossOrigin.status, 403);
  assert.equal(restores, 0);
  const oversized = await executeWindDownRecoveryRequest(new Request(url, {
    method: "POST", headers: { Origin: "https://winddown.test", "Content-Type": "application/json" }, body: " ".repeat(6 * 1024 * 1024),
  }), deps);
  assert.equal(oversized.status, 413);
  assert.equal(restores, 0);
  const restored = await executeWindDownRecoveryRequest(new Request(url, {
    method: "POST", headers: { Origin: "https://winddown.test", "Content-Type": "application/json" }, body: JSON.stringify(snapshot),
  }), deps);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).ok, true);
  assert.equal(restores, 1);
  assert.equal(exports, 1);
  console.log("PASS WIND DOWN authenticated backup and separate-copy recovery transport");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
