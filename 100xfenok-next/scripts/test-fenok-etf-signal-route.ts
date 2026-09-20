import assert from "node:assert/strict";

import { buildEtfSignalRouteResponse } from "../src/lib/server/fenok-etf-signal-route";

const unavailable = buildEtfSignalRouteResponse(
  { kind: "unavailable", reason: "DATA_ASSET_UNAVAILABLE" },
  "SPY",
);
assert.equal(unavailable.status, 503);
assert.equal((await unavailable.json()).error, "FENOK_ETF_SIGNAL_UNAVAILABLE");

const malformed = buildEtfSignalRouteResponse(
  { kind: "ok", payload: { rows: [["SPY", {}]] } }, "SPY",
);
assert.equal(malformed.status, 503, "missing positional ticker schema is unreadable data, not an absent symbol");

const missing = buildEtfSignalRouteResponse(
  {
    kind: "ok",
    payload: { generated_at: "2026-09-20T00:00:00Z", fields: ["ticker", "scores"], rows: [["QQQ", {}]] },
  },
  "SPY",
);
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error, "FENOK_ETF_SIGNAL_NOT_FOUND");

const found = buildEtfSignalRouteResponse(
  {
    kind: "ok",
    payload: { generated_at: "2026-09-20T00:00:00Z", fields: ["ticker", "scores"], rows: [["SPY", { tracking_quality: 80 }]] },
  },
  "SPY",
);
assert.equal(found.status, 200);
assert.equal((await found.json()).ticker, "SPY");

console.log("fenok ETF signal route: ok");
