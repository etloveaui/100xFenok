import assert from "node:assert/strict";
import test from "node:test";
import { StaticStockAnalyzerDataProvider } from "../src/features/stock-analyzer/data/static-data-provider";

test("identity readiness shares base requests while preserving enrichment, expiry and caller cancellation", { timeout: 5_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let baseRequests = 0;
  let actionRequests = 0;
  let failBase = false;
  let releaseAction!: () => void;
  const actionGate = new Promise<void>((resolve) => { releaseAction = resolve; });
  const rows = [
    { symbol: " aapl ", companyName: " Apple ", sector: " Technology ", marketCap: "2,000", price: 190 },
    { symbol: "MSFT", Corp: "Microsoft", WI26: "Technology", "(USD mn)": "3,000", price: 420 },
    { symbol: "", companyName: "Ignored" },
  ];
  globalThis.fetch = (async (input, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const path = String(input);
    if (path.endsWith("stocks_analyzer.json")) {
      baseRequests += 1;
      if (failBase) throw new Error("synthetic identity outage");
      return Response.json({ source_date: "2026-09-08", data: rows });
    }
    if (path.endsWith("stock_action_summary.json")) {
      actionRequests += 1;
      await actionGate;
      return Response.json({ fields: ["symbol", "actionScore", "return12m", "roeFy3"], rows: [["AAPL", 73, 0.12, 0.26]] });
    }
    throw new Error(`Unexpected fetch: ${path}`);
  }) as typeof fetch;
  try {
    const identityProvider = new StaticStockAnalyzerDataProvider();
    const financialProvider = new StaticStockAnalyzerDataProvider();
    let financialReady = false;
    const full = financialProvider.load().then((records) => { financialReady = true; return records; });
    const identities = await identityProvider.loadIdentity();
    assert.equal(financialReady, false, "full financial readiness must still await enrichment");
    assert.equal(baseRequests, 1, "identity and financial consumers must share an in-flight base fetch");
    assert.equal(actionRequests, 1);
    assert.deepEqual(identities, [
      { symbol: "MSFT", companyName: "Microsoft", sector: "Technology" },
      { symbol: "AAPL", companyName: "Apple", sector: "Technology" },
    ]);
    assert.equal(identityProvider.getSourceDate(), "2026-09-08");
    releaseAction();
    const records = await full;
    const apple = records.find((row) => row.symbol === "AAPL");
    assert.equal(apple?.price, 190);
    assert.equal(apple?.actionScore, 73);
    assert.equal(apple?.return12m, 0.12);
    assert.equal(apple?.roeFy3, 0.26);
    assert.deepEqual(records.map(({ symbol, companyName, sector }) => ({ symbol, companyName, sector })), identities);
    assert.equal(financialProvider.getSourceDate(), "2026-09-08");
    await new StaticStockAnalyzerDataProvider().loadIdentity();
    assert.equal(baseRequests, 1, "warm identity requests must reuse base cache");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(identityProvider.loadIdentity({ signal: controller.signal }), { name: "AbortError" });
    await identityProvider.loadIdentity();
    assert.equal(baseRequests, 1, "a caller's cancellation must not poison shared cache");

    now += 5 * 60 * 1000 + 1;
    failBase = true;
    const failed = await Promise.allSettled([identityProvider.loadIdentity(), financialProvider.loadIdentity()]);
    assert(failed.every((result) => result.status === "rejected"));
    assert.equal(baseRequests, 2, "expired concurrent requests must still deduplicate");
    failBase = false;
    assert.deepEqual(await identityProvider.loadIdentity(), identities);
    assert.equal(baseRequests, 3, "failed identity requests must remain retryable");
    assert.equal(actionRequests, 1, "identity-only retries must never fetch optional enrichment");
  } finally {
    releaseAction();
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});
