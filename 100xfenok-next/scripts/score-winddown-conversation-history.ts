import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMonaVnextProfileCoordinatorRequest, type WindDownReviewCoordinatorState, type WindDownVoiceReportReceipt } from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import { buildWindDownVoiceReport } from "../src/features/winddown/voice/report";
import { createWindDownRoleplayDescriptor } from "../src/features/winddown/voice/product";

async function fixture() {
  const values = new Map<string, unknown>();
  let writes = 0, seeds = 0;
  const listed: unknown[] = [];
  const storage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { writes++; values.set(key, value); },
    async list(options: { prefix?: string; startAfter?: string; limit?: number } = {}) {
      listed.push(options);
      return new Map([...values].filter(([key]) => key.startsWith(options.prefix ?? "") && (!options.startAfter || key > options.startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, options.limit));
    },
    async transaction<T>(run: (tx: typeof storage) => Promise<T>) { return run(storage); },
  };
  const state: WindDownReviewCoordinatorState = { storage, blockConcurrencyWhile: async run => run() };
  const env = { MONA_VNEXT_KV: { async get() { seeds++; return null; }, async put() { writes++; } } };
  for (let i = 0; i < 12; i++) {
    const productSessionId = `wd-history-session-${String(i).padStart(3, "0")}`;
    const report = buildWindDownVoiceReport({
      schemaVersion: 1, activity: "roleplay", productSessionId,
      descriptor: createWindDownRoleplayDescriptor("cafe-order"),
      conversationIds: ["winddown-roleplay-cafe-order-conversation-001"],
      sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
      startedAtIso: "2026-07-31T00:00:00.000Z", stoppedAtIso: "2026-07-31T00:01:00.000Z",
      completionReason: "learner-stop", turns: [{ conversationId: "winddown-roleplay-cafe-order-conversation-001", turnSeq: 1, userText: "I'd like a decaf coffee, thank you.", modelText: "Sure.", finalized: true, sttDrift: false, interrupted: false }], metrics: { turnCount: 1, interruptionCount: 0 },
    });
    const finalDigest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(report)))).toString("hex");
    values.set(`winddown-voice-report:${productSessionId}`, { schemaVersion: 1, activity: "roleplay", productSessionId, finalDigest, committedAtIso: "2026-07-31T00:01:00.000Z", report } satisfies WindDownVoiceReportReceipt);
  }
  values.set("private-other-row", { forbidden: true });
  const request = (query: Record<string, unknown>) => handleMonaVnextProfileCoordinatorRequest(state, env, new Request("https://winddown.internal/profile-coordinator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "read-winddown-conversations", ...query }) }));
  return { values, listed, request, counts: () => ({ writes, seeds }) };
}

test("legacy conversation pages remain bounded, complete and read-only", async () => {
  const f = await fixture(); const before = structuredClone([...f.values]);
  const first = await f.request({}); assert.equal(first.status, 200);
  const a = await first.json(); assert.equal(a.items.length, 10); assert.equal(a.nextCursor, "wd-history-session-009");
  assert.ok(a.items.every((row: Record<string, unknown>) => !('report' in row) && !('sessionProofs' in row)));
  const b = await (await f.request({ cursor: a.nextCursor })).json();
  assert.equal(b.items.length, 2); assert.equal(b.nextCursor, null);
  assert.equal(new Set([...a.items, ...b.items].map(row => row.productSessionId)).size, 12);
  assert.deepEqual(f.counts(), { writes: 0, seeds: 0 }); assert.deepEqual([...f.values], before);
  assert.ok(f.listed.every((o: any) => o.prefix === "winddown-voice-report:" && o.limit === 11));
});
test("detail preserves report exactly and missing detail is honest", async () => {
  const f = await fixture(); const r = await f.request({ session: "wd-history-session-000" }); assert.equal(r.status, 200);
  const body = await r.json(); assert.deepEqual(body.receipt.report, (f.values.get("winddown-voice-report:wd-history-session-000") as WindDownVoiceReportReceipt).report);
  assert.equal((await f.request({ session: "wd-history-missing" })).status, 404); assert.deepEqual(f.counts(), { writes: 0, seeds: 0 });
});
test("invalid query cannot select another storage prefix or unbounded result", async () => {
  const f = await fixture();
  for (const query of [{ cursor: "../../private" }, { session: "private-other-row", cursor: "wd-history-session-001" }, { limit: 10000 }, { learner: "other" }]) assert.equal((await f.request(query)).status, 400);
  assert.equal(f.listed.length, 0); assert.deepEqual(f.counts(), { writes: 0, seeds: 0 });
});
test("corrupt stored receipt or digest is retained and fails closed", async () => {
  const f = await fixture(); const key = "winddown-voice-report:wd-history-session-000";
  const corrupt = { ...(f.values.get(key) as WindDownVoiceReportReceipt), finalDigest: "0".repeat(64) }; f.values.set(key, corrupt);
  assert.equal((await f.request({ session: "wd-history-session-000" })).status, 503);
  assert.equal((await f.request({})).status, 503); assert.deepEqual(f.values.get(key), corrupt); assert.deepEqual(f.counts(), { writes: 0, seeds: 0 });
});
test("history transport authenticates before any storage request and never caches private data", async () => {
  const { executeWindDownConversationHistoryRequest } = await import("../src/features/winddown/server/conversationHistory");
  let reads = 0;
  const read = async () => { reads++; return { ok: true, items: [], nextCursor: null }; };
  const denied = await executeWindDownConversationHistoryRequest(new Request("https://test/api/winddown/conversations"), { authenticated: async () => false, read });
  assert.equal(denied.status, 401); assert.equal(reads, 0); assert.match(denied.headers.get("Cache-Control") ?? "", /private.*no-store/);
  const valid = await executeWindDownConversationHistoryRequest(new Request("https://test/api/winddown/conversations"), { authenticated: async () => true, read });
  assert.equal(valid.status, 200); assert.equal(reads, 1);
  const invalid = await executeWindDownConversationHistoryRequest(new Request("https://test/api/winddown/conversations?limit=10000"), { authenticated: async () => true, read });
  assert.equal(invalid.status, 400); assert.equal(reads, 1);
});

test("history API rejects duplicate identity and redacts transport faults", async () => {
  const { executeWindDownConversationHistoryRequest } = await import("../src/features/winddown/server/conversationHistory");
  let reads = 0;
  const deps = { authenticated: async () => true, read: async () => { reads++; throw new Error("private transcript must never leave this exception"); } };
  const invalid = await executeWindDownConversationHistoryRequest(new Request("https://test/api/winddown/conversations?session=wd-session-001&session=wd-session-002"), deps);
  assert.equal(invalid.status, 400); assert.equal(reads, 0);
  const failed = await executeWindDownConversationHistoryRequest(new Request("https://test/api/winddown/conversations"), deps);
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private transcript/);
});
