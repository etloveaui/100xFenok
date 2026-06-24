import { loadMacroSeries, parseStooqDailyCsv, toStooqSymbol } from "../src/lib/macro-chart/loader";
import { stooqSeriesDefinitionFromId, stooqSeriesIdFromInput } from "../src/lib/macro-chart/stooq";
import type { MacroSeriesDefinition } from "../src/lib/macro-chart/types";

type LocalStorageMock = Pick<Storage, "getItem" | "setItem">;

const sampleCsv = [
  "Date,Open,High,Low,Close,Volume",
  "2026-06-21,140.0,142.0,139.0,141.5,123456",
  "2026-06-20,137.0,139.0,136.5,138.25,223456",
].join("\n");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installBrowserStorageMock() {
  const values = new Map<string, string>();
  const localStorage: LocalStorageMock = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

async function main() {
  assert(toStooqSymbol("NVDA.US") === "nvda.us", "US suffix should be preserved");
  assert(toStooqSymbol("005930.KS") === "005930.kr", "KS suffix should map to Stooq KR");
  assert(toStooqSymbol("BRK-B") === "brk-b.us", "US default suffix should be added");
  assert(toStooqSymbol("NVDA:US") === null, "colon-delimited ids must stay invalid for Stooq symbols");
  assert(stooqSeriesIdFromInput("NVDA") === "stq~NVDA.US", "plain ticker should become delimiter-safe Stooq id");
  assert(stooqSeriesIdFromInput("NVDA:US") === null, "colon-delimited input must not become a series id");
  assert(stooqSeriesDefinitionFromId("stq~NVDA.US")?.stooqSymbol === "NVDA.US", "Stooq id should synthesize a loadable definition");

  const parsed = parseStooqDailyCsv(sampleCsv);
  assert(parsed.length === 2, "sample CSV should yield two points");
  assert(parsed[0]?.date === "2026-06-20" && parsed[0]?.value === 138.25, "points should sort by date and use Close");

  installBrowserStorageMock();

  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    assert(url.startsWith("https://stooq-proxy.etloveaui.workers.dev/"), "Stooq loader must use owner Worker proxy");
    assert(!url.startsWith("https://stooq.com/"), "Stooq loader must not fetch upstream directly");
    return new Response(sampleCsv, { status: 200 });
  };

  try {
    const definition: MacroSeriesDefinition = stooqSeriesDefinitionFromId("stq~NVDA.US") ?? {
      id: "stq~NVDA.US",
      label: "NVDA",
      shortLabel: "NVDA",
      group: "equity",
      unit: "usd",
      frequency: "daily",
      sourceKind: "stooq",
      sourcePath: "stooq:NVDA.US",
      stooqSymbol: "NVDA.US",
      accessor: { kind: "array", valueKey: "value" },
      description: "NVIDIA daily close from Stooq via owner Worker proxy",
      defaultTransform: "rebase100",
    };

    const first = await loadMacroSeries([definition], new Map([["stq~NVDA.US", "raw"]]));
    assert(first[0]?.rawPoints.length === 2, "first load should return Stooq points");
    assert(first[0]?.rawPoints[1]?.value === 141.5, "first load should preserve Close values");

    const second = await loadMacroSeries([definition], new Map([["stq~NVDA.US", "raw"]]));
    assert(second[0]?.rawPoints.length === 2, "second load should return cached Stooq points");
    assert(requests.length === 1, `Stooq cache should avoid duplicate fetches, saw ${requests.length}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main()
  .then(() => {
    console.log(JSON.stringify({ status: "pass", checks: ["symbol", "csv", "proxy", "cache"] }));
  })
  .catch((error: unknown) => {
    console.error(JSON.stringify({ status: "fail", error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
