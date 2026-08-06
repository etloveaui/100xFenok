// FENO RIM v2 — restored ERP band consumption (Phase: band wiring).
//
// Reads the ERP archive restoration artifact (built by restore-erp-archive.py
// from the committed raw archive bytes) and serves the point-in-time band for
// an origin: the min/max over THAT origin's own trailing 52 weekly states,
// never the latest window.
//
//   ERP(week w) = the most recent OFFICIAL release at or before week w
//   band(t)     = [min, max] over the 52 weekly states with week <= t
//
// Fail-closed: an origin with zero admissible states refuses with a stated
// reason — never a silent fallback to a later vintage. The latest admissible
// release's first-knowable is returned so the adapter can carry it as a
// first-knowable component (ERP is now consumed by the engine).

import { readJson } from "./adapters/panel-common.mjs";

const ARTIFACT = "data/computed/feno-rim-v2/erp-archive-restoration.json";
const WINDOW_WEEKS = 52;

let cached = null;
function doc() {
  if (cached === null) cached = readJson(ARTIFACT);
  return cached;
}

export function erpMarket(market) {
  if (market !== "us" && market !== "kr") throw new Error(`erp band: unknown market ${market}`);
  return market;
}

/**
 * Point-in-time ERP window at `asOf` for `market` ("us" | "kr").
 * @returns {{ band: {low, high}, states_used, distinct_releases, first_knowable, point }}
 * @throws when zero admissible states exist at or before asOf.
 */
export function erpWindowAt(asOf, market) {
  erpMarket(market);
  const states = market === "kr" ? doc().weekly_states_kr : doc().weekly_states_us;
  const admissible = states.filter((s) => s.week <= asOf && Number.isFinite(s.erp));
  if (admissible.length === 0) {
    throw new Error(`erp band: zero admissible restored ERP states at or before ${asOf} (market ${market}); refusing, no later-vintage fallback`);
  }
  const window = admissible.slice(-WINDOW_WEEKS);
  const erps = window.map((s) => s.erp);
  const releases = [...new Set(window.map((s) => s.release_file).filter(Boolean))];
  const latestRelease = window[window.length - 1].release_file;
  const latestObservation = doc().observations.find((o) => o.file === latestRelease);
  const firstK = latestObservation?.first_knowable ?? null;
  if (firstK === null || firstK > asOf) {
    // Defensive: the states are built from releases at or before each week, so
    // this cannot happen for a well-formed artifact; refuse rather than leak.
    throw new Error(`erp band: latest admissible release ${latestRelease} first-knowable ${firstK} after ${asOf}`);
  }
  const low = Math.min(...erps);
  const high = Math.max(...erps);
  return {
    band: { low, high },
    states_used: window.length,
    distinct_releases: releases.length,
    releases,
    first_knowable: firstK,
    point: low === high,
  };
}
