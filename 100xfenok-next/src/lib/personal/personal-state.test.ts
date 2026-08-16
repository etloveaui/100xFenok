/**
 * Focused tests for the shared personal-state module.
 * Runs on the existing lightweight tsx harness:
 *   npx tsx src/lib/personal/personal-state.test.ts
 */

import assert from "node:assert/strict";
import {
  PERSONAL_DOC_KEYS,
  PERSONAL_STATE_VERSION,
  readPersonalFlags,
  readScreenerUniverses,
  readScreenerView,
  writePersonalFlags,
  writeScreenerUniverses,
  writeScreenerView,
  type SavedScreenerUniverse,
  type ScreenerViewPreferences,
} from "./personal-state";
import { defaultScreenerFilterState } from "../screener/filter-url";

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
}

let storage: Storage;

function installWindow(): void {
  storage = createStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
}

function removeWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

let passed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    throw error;
  }
}

function main(): void {
  installWindow();

  test("migrates legacy Screener prefs and presets on first successful read without touching legacy keys", () => {
    storage.setItem("screener-preset", "value");
    storage.setItem("screener-density", "compact");
    storage.setItem("screener-view-mode", "card");
    storage.setItem("screener-filter-presets", JSON.stringify([{ name: "밸류픽", state: { search: "AAPL" } }]));

    const view = readScreenerView();
    assert.deepEqual(
      view,
      { columnPreset: "value", density: "compact", viewMode: "card" } satisfies ScreenerViewPreferences,
    );

    const presets = readScreenerUniverses();
    assert.equal(presets.length, 1);
    assert.equal(presets[0].name, "밸류픽");

    const migrated = JSON.parse(storage.getItem(PERSONAL_DOC_KEYS.view) ?? "null") as {
      version: number;
      updatedAt: string;
      data: unknown;
    };
    assert.equal(migrated.version, PERSONAL_STATE_VERSION);
    assert.ok(typeof migrated.updatedAt === "string" && !Number.isNaN(Date.parse(migrated.updatedAt)));
    assert.notEqual(storage.getItem(PERSONAL_DOC_KEYS.universes), null);

    // Legacy keys stay present with identical raw values.
    assert.equal(storage.getItem("screener-preset"), "value");
    assert.equal(storage.getItem("screener-density"), "compact");
    assert.equal(storage.getItem("screener-view-mode"), "card");
    assert.equal(
      storage.getItem("screener-filter-presets"),
      JSON.stringify([{ name: "밸류픽", state: { search: "AAPL" } }]),
    );
  });

  test("fail-closes to defaults on malformed legacy storage without throwing or writing", () => {
    storage.clear();
    storage.setItem("screener-preset", "not-a-preset");
    storage.setItem("screener-density", "huge");
    storage.setItem("screener-view-mode", "");
    storage.setItem("screener-filter-presets", "{broken");

    assert.deepEqual(readScreenerView(), {});
    assert.deepEqual(readScreenerUniverses(), []);
    assert.equal(storage.getItem(PERSONAL_DOC_KEYS.view), null);
    assert.equal(storage.getItem(PERSONAL_DOC_KEYS.universes), null);
  });

  test("fail-closes to defaults on malformed or wrong-version current documents", () => {
    storage.clear();
    storage.setItem(PERSONAL_DOC_KEYS.view, "{broken");
    storage.setItem(PERSONAL_DOC_KEYS.universes, "null");
    storage.setItem(
      PERSONAL_DOC_KEYS.flags,
      JSON.stringify({ version: 99, updatedAt: "x", data: { flags: { AAPL: "WATCH" } } }),
    );

    assert.deepEqual(readScreenerView(), {});
    assert.deepEqual(readScreenerUniverses(), []);
    assert.deepEqual(readPersonalFlags(), {});
  });

  test("drops only invalid fields from a current document", () => {
    storage.clear();
    storage.setItem(
      PERSONAL_DOC_KEYS.view,
      JSON.stringify({
        version: 1,
        updatedAt: "2026-08-17T00:00:00.000Z",
        data: { screener: { columnPreset: "guru", density: "gigantic", viewMode: "table" } },
      }),
    );
    assert.deepEqual(readScreenerView(), { columnPreset: "guru", viewMode: "table" });
  });

  test("valid empty current universe document is authoritative and never resurrects retained legacy", () => {
    storage.clear();
    storage.setItem("screener-filter-presets", JSON.stringify([{ name: "유지", state: { search: "AAPL" } }]));
    storage.setItem(
      PERSONAL_DOC_KEYS.universes,
      JSON.stringify({ version: 1, updatedAt: "2026-08-17T00:00:00.000Z", data: { screener: [] } }),
    );

    assert.deepEqual(readScreenerUniverses(), []);
    // Legacy stays retained and untouched (no migration, no overwrite).
    assert.equal(storage.getItem("screener-filter-presets"), JSON.stringify([{ name: "유지", state: { search: "AAPL" } }]));
    assert.equal(
      storage.getItem(PERSONAL_DOC_KEYS.universes),
      JSON.stringify({ version: 1, updatedAt: "2026-08-17T00:00:00.000Z", data: { screener: [] } }),
    );
  });

  test("malformed present current document fails closed and does not migrate valid legacy", () => {
    storage.clear();
    storage.setItem("screener-preset", "value");
    storage.setItem("screener-density", "compact");
    storage.setItem("screener-filter-presets", JSON.stringify([{ name: "유지", state: { search: "AAPL" } }]));
    storage.setItem(PERSONAL_DOC_KEYS.view, "{broken");
    storage.setItem(
      PERSONAL_DOC_KEYS.universes,
      JSON.stringify({ version: 2, updatedAt: "2026-08-17T00:00:00.000Z", data: { screener: [] } }),
    );

    assert.deepEqual(readScreenerView(), {});
    assert.deepEqual(readScreenerUniverses(), []);
    // Malformed current keys stay untouched; no migrated documents are written; legacy retained.
    assert.equal(storage.getItem(PERSONAL_DOC_KEYS.view), "{broken");
    assert.equal(
      storage.getItem(PERSONAL_DOC_KEYS.universes),
      JSON.stringify({ version: 2, updatedAt: "2026-08-17T00:00:00.000Z", data: { screener: [] } }),
    );
    assert.equal(storage.getItem("screener-preset"), "value");
    assert.equal(storage.getItem("screener-density"), "compact");
    assert.equal(storage.getItem("screener-filter-presets"), JSON.stringify([{ name: "유지", state: { search: "AAPL" } }]));
  });

  test("rejects invalid updatedAt timestamps in current documents", () => {
    storage.clear();
    storage.setItem(
      PERSONAL_DOC_KEYS.view,
      JSON.stringify({ version: 1, updatedAt: "not-a-timestamp", data: { screener: { density: "compact" } } }),
    );
    storage.setItem(
      PERSONAL_DOC_KEYS.universes,
      JSON.stringify({ version: 1, updatedAt: "2026-08-17", data: { screener: [{ name: "A", state: {} }] } }),
    );

    assert.deepEqual(readScreenerView(), {});
    assert.deepEqual(readScreenerUniverses(), []);
  });

  test("partial legacy state merges onto defaults into a complete safe state", () => {
    storage.clear();
    storage.setItem(
      "screener-filter-presets",
      JSON.stringify([
        {
          name: "파셜",
          state: {
            search: "AAPL",
            selectedSectors: "TECH",
            actionFilter: 7,
            bandFilter: "huge",
            sortKey: "not-a-key",
            sortDir: "up",
            profitableOnly: "true",
            perMin: 12,
            preset: "guru",
          },
        },
      ]),
    );

    const presets = readScreenerUniverses();
    assert.equal(presets.length, 1);
    const state = presets[0].state;
    assert.equal(state.search, "AAPL"); // valid string kept
    assert.deepEqual(state.selectedSectors, []); // non-array -> safe default
    assert.deepEqual(state.selectedCountries, []); // absent -> safe default
    assert.equal(state.actionFilter, ""); // invalid type/enum -> closed
    assert.equal(state.bandFilter, ""); // invalid enum -> closed
    assert.equal(state.sortKey, "marketCap"); // invalid sort -> default
    assert.equal(state.sortDir, "desc"); // invalid dir -> default
    assert.equal(state.profitableOnly, false); // non-boolean -> default
    assert.equal(state.perMin, ""); // non-string -> default
    assert.equal(state.preset, "guru"); // valid preset kept
    assert.equal(state.marketCapMin, ""); // missing fields come from defaults
    assert.equal(state.ret3yMin, ""); // missing fields come from defaults
  });

  test("round-trips view preferences and preserves fields across partial writes", () => {
    storage.clear();
    writeScreenerView({ columnPreset: "fenokPicks", viewMode: "card" });
    assert.deepEqual(readScreenerView(), { columnPreset: "fenokPicks", viewMode: "card" });

    writeScreenerView({ density: "compact" });
    const merged = readScreenerView();
    assert.equal(merged.columnPreset, "fenokPicks");
    assert.equal(merged.density, "compact");
    assert.equal(merged.viewMode, "card");

    const doc = JSON.parse(storage.getItem(PERSONAL_DOC_KEYS.view) ?? "null") as {
      version: number;
      updatedAt: string;
    };
    assert.equal(doc.version, PERSONAL_STATE_VERSION);
    assert.ok(!Number.isNaN(Date.parse(doc.updatedAt)));

    // Writes never touch legacy keys.
    assert.equal(storage.getItem("screener-preset"), null);
  });

  test("round-trips saved universes", () => {
    storage.clear();
    const universe: SavedScreenerUniverse = {
      name: "모멘텀",
      state: { ...defaultScreenerFilterState(), search: "MSFT", sortKey: "momentum1m" },
    };
    writeScreenerUniverses([universe]);

    const back = readScreenerUniverses();
    assert.equal(back.length, 1);
    assert.equal(back[0].name, "모멘텀");
    assert.deepEqual(back[0].state, universe.state);
    assert.equal(storage.getItem("screener-filter-presets"), null);
  });

  test("personal flags document validates per-symbol flag values", () => {
    storage.clear();
    writePersonalFlags({ AAPL: "WATCH", TSLA: "THESIS" });
    assert.deepEqual(readPersonalFlags(), { AAPL: "WATCH", TSLA: "THESIS" });

    storage.setItem(
      PERSONAL_DOC_KEYS.flags,
      JSON.stringify({
        version: 1,
        updatedAt: "2026-08-17T00:00:00.000Z",
        data: { flags: { MSFT: "HOLD", NVDA: "RISK" } },
      }),
    );
    assert.deepEqual(readPersonalFlags(), { NVDA: "RISK" });
  });

  test("fails closed without storage access when window is unavailable (SSR)", () => {
    removeWindow();
    assert.deepEqual(readScreenerView(), {});
    assert.deepEqual(readScreenerUniverses(), []);
    assert.deepEqual(readPersonalFlags(), {});
  });

  console.log(`\n${passed} personal-state tests passed`);
}

main();
