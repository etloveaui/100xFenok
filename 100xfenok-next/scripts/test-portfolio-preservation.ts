import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import * as portfolioModule from "../src/lib/portfolio";

// Type definitions matching PLAN_product_flow_preservation_20260906.md contract
type SavePortfoliosResult = { ok: true } | { ok: false; message: string };
type ParsePortfolioImport = (text: string, createId: () => string) => portfolioModule.Portfolio[];

// Typed namespace assertion: Next.js / TypeScript compiles cleanly without error even though
// parsePortfolioImport is not yet exported from src/lib/portfolio.ts, enabling intentional
// RED test assertion failures when executed against current unpatched code.
const portfolioLib = portfolioModule as unknown as Omit<typeof portfolioModule, "savePortfolios"> & {
  savePortfolios: (next: portfolioModule.Portfolio[]) => SavePortfoliosResult;
  parsePortfolioImport?: ParsePortfolioImport;
};

// Synthetic in-memory window & localStorage stub
class MemoryStorage {
  private store = new Map<string, string>();
  public throwOnSet = false;
  public throwMessage = "QuotaExceededError: DOMException: storage quota exceeded";

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) {
      throw new Error(this.throwMessage);
    }
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  getRaw(key: string): string | null {
    return this.getItem(key);
  }

  setRaw(key: string, value: string): void {
    this.store.set(key, value);
  }
}

let storage: MemoryStorage;

function setupSyntheticEnvironment(): MemoryStorage {
  storage = new MemoryStorage();
  const eventListeners: Record<string, Function[]> = {};

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: storage,
    addEventListener: (event: string, cb: Function) => {
      eventListeners[event] = eventListeners[event] || [];
      eventListeners[event].push(cb);
    },
    removeEventListener: (event: string, cb: Function) => {
      if (eventListeners[event]) {
        eventListeners[event] = eventListeners[event].filter((fn) => fn !== cb);
      }
    },
  };

  return storage;
}

beforeEach(() => {
  setupSyntheticEnvironment();
});

test("savePortfolios: returns { ok: true } and updates localStorage on successful write", () => {
  const samplePortfolio: portfolioModule.Portfolio = {
    id: "port-alpha",
    name: "Core Portfolio",
    currency: "USD",
    cash: 10000,
    holdings: [
      { ticker: "AAPL", shares: 20, avg_cost: 175.5 },
      { ticker: "MSFT", shares: 10, avg_cost: 350.0 },
    ],
  };

  const result = portfolioLib.savePortfolios([samplePortfolio]);
  assert.strictEqual(typeof result, "object", "savePortfolios must return a result object");
  assert.strictEqual(result.ok, true, "savePortfolios must return { ok: true } on success");

  const raw = storage.getRaw("fenok.portfolio.v1");
  assert.ok(raw !== null, "localStorage must contain saved doc");
  const doc = JSON.parse(raw!);
  assert.strictEqual(doc.version, 1, "Saved document must be version 1");
  assert.strictEqual(doc.portfolios.length, 1, "Saved document must contain one portfolio");
  assert.strictEqual(doc.portfolios[0].name, "Core Portfolio");
  assert.strictEqual(doc.portfolios[0].cash, 10000);
  assert.deepStrictEqual(doc.portfolios[0].holdings, samplePortfolio.holdings);
});

test("savePortfolios: thrown setItem returns { ok: false, message: string } and leaves prior bytes intact", () => {
  // 1. Establish prior state in localStorage
  const initialPortfolio: portfolioModule.Portfolio = {
    id: "port-initial",
    name: "Initial Stored Portfolio",
    currency: "USD",
    cash: 5000,
    holdings: [{ ticker: "SPY", shares: 15, avg_cost: 480 }],
  };
  storage.setRaw(
    "fenok.portfolio.v1",
    JSON.stringify({
      version: 1,
      updated_at: "2026-09-01T00:00:00.000Z",
      portfolios: [initialPortfolio],
    }),
  );
  const priorRaw = storage.getRaw("fenok.portfolio.v1");
  assert.ok(priorRaw !== null, "Initial data must be seeded");

  // 2. Enable write failure on setItem
  storage.throwOnSet = true;
  storage.throwMessage = "QuotaExceededError: storage full";

  // 3. Attempt write of new portfolio
  const newPortfolio: portfolioModule.Portfolio = {
    id: "port-new",
    name: "New Unsaved Portfolio",
    currency: "USD",
    cash: 99999,
    holdings: [{ ticker: "NVDA", shares: 100, avg_cost: 120 }],
  };
  const result = portfolioLib.savePortfolios([newPortfolio]);

  // 4. Assert contract: { ok: false, message: string }
  assert.strictEqual(typeof result, "object", "savePortfolios must return a result object on error");
  assert.strictEqual(result.ok, false, "savePortfolios must return { ok: false } when storage throws");
  assert.strictEqual(typeof result.message, "string", "savePortfolios must return a descriptive error message");
  assert.ok(result.message.length > 0, "Error message must not be empty");

  // 5. Assert prior bytes remain untouched
  assert.strictEqual(
    storage.getRaw("fenok.portfolio.v1"),
    priorRaw,
    "Prior localStorage bytes must remain completely intact after setItem failure",
  );
});

test("parsePortfolioImport: function availability contract", () => {
  assert.strictEqual(
    typeof portfolioLib.parsePortfolioImport,
    "function",
    "parsePortfolioImport must be exported from src/lib/portfolio.ts as a function",
  );
});

test("parsePortfolioImport: exact export roundtrip parses single portfolio export format cleanly", () => {
  assert.strictEqual(typeof portfolioLib.parsePortfolioImport, "function", "parsePortfolioImport must be exported");
  const parse = portfolioLib.parsePortfolioImport!;

  // Single portfolio JSON as exported by PortfolioClient handleExport()
  const exportedJson = JSON.stringify(
    {
      id: "source-id-777",
      name: "내 핵심 포트폴리오",
      currency: "USD",
      cash: 12500,
      holdings: [
        { ticker: "AAPL", shares: 10, avg_cost: 180.25 },
        { ticker: "MSFT", shares: 8, avg_cost: 410.5 },
      ],
    },
    null,
    2,
  );

  const createId = () => "imported-id-001";
  const parsed = parse(exportedJson, createId);

  assert.ok(Array.isArray(parsed), "Must return an array of portfolios");
  assert.strictEqual(parsed.length, 1, "Must return exactly one portfolio");
  const doc = parsed[0];
  assert.strictEqual(doc.id, "imported-id-001", "Must use regenerated ID for additive import");
  assert.strictEqual(doc.name, "내 핵심 포트폴리오");
  assert.strictEqual(doc.currency, "USD");
  assert.strictEqual(doc.cash, 12500);
  assert.strictEqual(doc.holdings.length, 2);
  assert.deepStrictEqual(doc.holdings, [
    { ticker: "AAPL", shares: 10, avg_cost: 180.25 },
    { ticker: "MSFT", shares: 8, avg_cost: 410.5 },
  ]);
});

test("parsePortfolioImport: multi-portfolio preservation for version 1 bundle and legacy named map", () => {
  assert.strictEqual(typeof portfolioLib.parsePortfolioImport, "function", "parsePortfolioImport must be exported");
  const parse = portfolioLib.parsePortfolioImport!;

  // 1. Version 1 multi-portfolio document
  const v1Json = JSON.stringify({
    version: 1,
    updated_at: "2026-09-06T12:00:00.000Z",
    portfolios: [
      {
        id: "p-grow",
        name: "성장주",
        currency: "USD",
        cash: 3000,
        holdings: [{ ticker: "NVDA", shares: 25, avg_cost: 105 }],
      },
      {
        id: "p-div",
        name: "배당주",
        currency: "USD",
        cash: 7000,
        holdings: [{ ticker: "SCHD", shares: 100, avg_cost: 27.5 }],
      },
    ],
  });

  let idCounter = 1;
  const parsedV1 = parse(v1Json, () => `id-${idCounter++}`);
  assert.strictEqual(parsedV1.length, 2, "Must preserve all portfolios from version 1 array");
  assert.strictEqual(parsedV1[0].name, "성장주");
  assert.strictEqual(parsedV1[0].holdings[0].ticker, "NVDA");
  assert.strictEqual(parsedV1[1].name, "배당주");
  assert.strictEqual(parsedV1[1].holdings[0].ticker, "SCHD");

  // 2. Legacy named map format (must not truncate to first item)
  const legacyJson = JSON.stringify({
    portfolios: {
      "포트 Alpha": {
        cash: 1500,
        holdings: [{ ticker: "GOOGL", shares: 10, avg_cost: 155 }],
      },
      "포트 Beta": {
        cash: 2500,
        holdings: [{ ticker: "AMZN", shares: 20, avg_cost: 170 }],
      },
    },
  });

  const parsedLegacy = parse(legacyJson, () => `legacy-${idCounter++}`);
  assert.strictEqual(
    parsedLegacy.length,
    2,
    "Must preserve all portfolios from legacy map; do not truncate to first item",
  );
  assert.strictEqual(parsedLegacy[0].name, "포트 Alpha");
  assert.strictEqual(parsedLegacy[0].cash, 1500);
  assert.strictEqual(parsedLegacy[1].name, "포트 Beta");
  assert.strictEqual(parsedLegacy[1].cash, 2500);
});

test("parsePortfolioImport: preserves original ticker identity including punctuation symbols", () => {
  assert.strictEqual(typeof portfolioLib.parsePortfolioImport, "function", "parsePortfolioImport must be exported");
  const parse = portfolioLib.parsePortfolioImport!;

  const specialTickerJson = JSON.stringify({
    id: "p-spec",
    name: "Special Symbols Portfolio",
    currency: "USD",
    cash: 5000,
    holdings: [
      { ticker: "BRK/B", shares: 5, avg_cost: 440 },
      { ticker: "BF/B", shares: 12, avg_cost: 45 },
      { ticker: "BRK.A", shares: 1, avg_cost: 650000 },
    ],
  });

  const parsed = parse(specialTickerJson, () => "p-spec-id");
  assert.strictEqual(parsed.length, 1);
  const tickers = parsed[0].holdings.map((h) => h.ticker);
  assert.strictEqual(tickers[0], "BRK/B", "Punctuation slash in BRK/B must be preserved");
  assert.strictEqual(tickers[1], "BF/B", "Punctuation slash in BF/B must be preserved");
  assert.strictEqual(tickers[2], "BRK.A", "Dot in BRK.A must be preserved");
});

test("parsePortfolioImport: malformed one-of-many rejects complete document without partial loss", () => {
  assert.strictEqual(typeof portfolioLib.parsePortfolioImport, "function", "parsePortfolioImport must be exported");
  const parse = portfolioLib.parsePortfolioImport!;

  // One valid holding and one malformed holding (negative shares)
  const corruptHoldingJson = JSON.stringify({
    id: "p-mix",
    name: "Corrupt Holding Mix",
    currency: "USD",
    cash: 1000,
    holdings: [
      { ticker: "AAPL", shares: 10, avg_cost: 150 },
      { ticker: "MSFT", shares: -5, avg_cost: 300 }, // invalid: negative shares
    ],
  });

  assert.throws(
    () => parse(corruptHoldingJson, () => "id-x"),
    /invalid|unsupported|shares|number|negative/i,
    "Must reject entire document on invalid holding; no silent drop of bad rows",
  );

  // One valid portfolio and one malformed portfolio in multi-portfolio array
  const corruptPortfolioJson = JSON.stringify({
    version: 1,
    portfolios: [
      {
        id: "p-valid",
        name: "Valid Portfolio",
        currency: "USD",
        cash: 2000,
        holdings: [{ ticker: "GOOGL", shares: 10, avg_cost: 160 }],
      },
      {
        id: "p-corrupt",
        name: "Corrupt Portfolio",
        currency: "EUR", // invalid currency: only USD supported
        cash: 3000,
        holdings: [{ ticker: "SAP", shares: 15, avg_cost: 180 }],
      },
    ],
  });

  assert.throws(
    () => parse(corruptPortfolioJson, () => "id-y"),
    /invalid|unsupported|currency/i,
    "Must reject entire multi-portfolio document if one portfolio is invalid",
  );
});

test("parsePortfolioImport: currency and numeric validation rejects non-finite or negative values", () => {
  assert.strictEqual(typeof portfolioLib.parsePortfolioImport, "function", "parsePortfolioImport must be exported");
  const parse = (text: string) => portfolioLib.parsePortfolioImport!(text, () => "validation-id");

  // Negative cash
  assert.throws(
    () => parse(JSON.stringify({ name: "P", currency: "USD", cash: -500, holdings: [] })),
    /cash|nonnegative|invalid/i,
    "Negative cash must be rejected",
  );

  // Non-finite cash (string with NaN or Infinity)
  assert.throws(
    () => parse('{"name":"P","currency":"USD","cash":"NaN","holdings":[]}'),
    /cash|number|invalid/i,
    "NaN cash must be rejected",
  );

  // Existing backups may retain a closed, zero-share position; preserve it.
  const zeroShares = parse(
      JSON.stringify({
        name: "P",
        currency: "USD",
        cash: 100,
        holdings: [{ ticker: "AAPL", shares: 0, avg_cost: 150 }],
      }),
  );
  assert.equal(zeroShares[0].holdings[0].shares, 0, "Zero-share backup rows must be preserved");

  // Negative avg_cost
  assert.throws(
    () => parse(
      JSON.stringify({
        name: "P",
        currency: "USD",
        cash: 100,
        holdings: [{ ticker: "AAPL", shares: 1, avg_cost: -10 }],
      }),
    ),
    /cost|nonnegative|invalid/i,
    "Negative avg_cost must be rejected",
  );

  // Invalid JSON syntax
  assert.throws(
    () => parse("not-valid-json"),
    /json|syntax|parse/i,
    "Malformed JSON syntax must be rejected",
  );

  // Unsupported root shape
  assert.throws(
    () => parse(JSON.stringify(["not", "an", "object"])),
    /unsupported|shape|invalid/i,
    "Unsupported root array must be rejected",
  );
});
