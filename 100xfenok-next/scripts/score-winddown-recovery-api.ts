import assert from "node:assert/strict";
import { executeWindDownRecoveryRequest } from "../src/features/winddown/server/recoveryApi";
import { handleMonaVnextProfileCoordinatorRequest } from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import { WINDDOWN_RECOVERY_SEAL_KEY } from "../src/features/mona-vnext/memory/windDownRecovery";

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
  const values = new Map<string, unknown>();
  let writes = 0;
  let legacyReads = 0;
  type Transaction = { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void>; list(options?: { limit?: number; startAfter?: string }): Promise<Map<string, unknown>> };
  const storage = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { writes++; values.set(key, structuredClone(value)); },
    async list(options: { limit?: number; startAfter?: string } = {}) {
      return new Map([...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .filter(([key]) => !options.startAfter || key > options.startAfter)
        .slice(0, options.limit));
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>) { return fn(storage); },
  };
  const state = { storage, blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn() };
  const env = { MONA_VNEXT_KV: {
    async get() { legacyReads++; return '{"original":"legacy seed"}\n'; },
    async put() { throw new Error("export must not mirror"); },
  } };
  const command = (operation: string) => handleMonaVnextProfileCoordinatorRequest(state, env,
    new Request("https://winddown.internal/profile-coordinator", { method: "POST", body: JSON.stringify({ operation }) }));
  const rawExport = await command("export-recovery-snapshot");
  assert.equal(rawExport.status, 200);
  const rawBody = await rawExport.json();
  assert.equal(rawBody.snapshot.recordCount, 0);
  assert.equal(rawBody.snapshot.legacyKvRecords[0].rawValue, '{"original":"legacy seed"}\n');
  assert.equal(writes, 0, "export must branch before normal profile initialization");
  assert.equal(legacyReads, 1);
  assert.equal((await command("restore-recovery-copy")).status, 403, "default learner target must refuse restore");
  values.set(WINDDOWN_RECOVERY_SEAL_KEY, { recoveryOnly: true });
  assert.equal((await command("read-learning-profile")).status, 403, "sealed recovery copy cannot become a learner session");
  assert.equal(writes, 0);
  assert.equal(legacyReads, 1);
  console.log("PASS WIND DOWN authenticated backup and separate-copy recovery transport");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
