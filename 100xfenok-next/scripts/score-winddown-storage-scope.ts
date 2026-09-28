import assert from "node:assert/strict";
import { handleMonaVnextProfileCoordinatorRequest } from "../src/features/mona-vnext/memory/learningProfileCoordinator";

let failed = 0;
async function check(name: string, action: () => Promise<void>) {
  try { await action(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}

async function main() {
await check("fixed deployment-owned workspace identity", async () => {
const { resolveWindDownStorageScope } = await import("../src/features/mona-vnext/memory/windDownStorageScope");
const learner = resolveWindDownStorageScope(undefined);
assert.equal(learner.objectName, "mona-vnext-learning-profile-v1");
assert.equal(learner.profileMirrorKey, "data/mona-vnext/owner-test/learning-profile.json");
assert.equal(learner.allowLegacySeed, true);
assert.deepEqual(resolveWindDownStorageScope("learner"), learner);
const qa = resolveWindDownStorageScope("qa");
assert.notEqual(qa.objectName, learner.objectName);
assert.notEqual(qa.profileMirrorKey, learner.profileMirrorKey);
assert.equal(qa.allowLegacySeed, false);
for (const value of ["", "QA", "production", "random-user", null, 1]) {
  assert.throws(() => resolveWindDownStorageScope(value), /WINDDOWN_STORAGE_SCOPE_INVALID/);
}
});

await check("QA profile bootstrap never reads learner mirror", async () => {
  const values = new Map<string, unknown>();
  type Transaction = { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> };
  const storage = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> { return fn(storage); },
  };
  const reads: string[] = [];
  const response = await handleMonaVnextProfileCoordinatorRequest(
    { storage, blockConcurrencyWhile: async (fn) => fn() },
    {
      WINDDOWN_DATA_WORKSPACE: "qa",
      MONA_VNEXT_KV: {
        async get(key: string) { reads.push(key); return null; },
        async put() { throw new Error("read must not mirror"); },
      },
    } as Parameters<typeof handleMonaVnextProfileCoordinatorRequest>[1],
    new Request("https://winddown.internal/profile-coordinator", {
      method: "POST", body: JSON.stringify({ operation: "read-learning-profile" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(reads, [], "QA must start empty without reading any learner seed");
});

await check("browser QA cannot target a real learner host", async () => {
  const { assertWindDownQaTarget } = await import("./winddown-qa-target.mjs");
  assert.doesNotThrow(() => assertWindDownQaTarget("http://127.0.0.1:3107", "1"));
  for (const target of ["https://100xfenok.etloveaui.workers.dev", "https://example.org", "http://127.0.0.1.evil.example", "file:///tmp/page"]) {
    assert.throws(() => assertWindDownQaTarget(target, "1"), /WINDDOWN_QA_TARGET_UNSAFE/);
  }
  assert.throws(() => assertWindDownQaTarget("http://127.0.0.1:3107", undefined), /WINDDOWN_QA_TARGET_UNSAFE/);
});
process.exitCode = failed ? 1 : 0;

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
