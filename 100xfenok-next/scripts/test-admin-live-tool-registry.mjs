#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";

const SEARCH_TOOL_IDS = ["feno-search", "naver-search", "kakao-search"];

const probeCode = String.raw`
const path = require("node:path");
const { createJiti } = require("jiti");
const jiti = createJiti(process.cwd() + "/_index.js", {
  alias: { "@": path.join(process.cwd(), "src") },
  fsCache: false,
});
const tools = jiti("./src/lib/server/admin-live-tools.ts");
const ids = ["feno-data", "feno-search", "naver-search", "kakao-search", "google-search"];
(async () => {
  const result = await tools.executeLiveToolFunction("searchNaverWeb", { query: "엔비디아" });
  const declarations = tools.buildLiveToolDeclarations(ids);
  console.log(JSON.stringify({
    defaults: tools.getDefaultLiveEnabledToolIds("fenok"),
    metadata: tools.getLiveToolMetadata().filter((tool) => ids.includes(tool.id)),
    normalized: tools.normalizeLiveToolIds(ids),
    declarations: declarations.map((tool) => tool.name),
    naverTypeEnum: declarations.find((tool) => tool.name === "searchNaverWeb")?.parameters?.properties?.type?.enum ?? [],
    kakaoTypeEnum: declarations.find((tool) => tool.name === "searchKakaoWeb")?.parameters?.properties?.type?.enum ?? [],
    instructionCount: tools.buildLiveToolInstructions(ids).length,
    searchNaverResult: result,
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

function runProbe(extraEnv) {
  const child = spawnSync(process.execPath, ["-e", probeCode], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (child.status !== 0) {
    process.stderr.write(child.stdout);
    process.stderr.write(child.stderr);
    throw new Error(`registry probe failed with status ${child.status}`);
  }

  return JSON.parse(child.stdout);
}

function statusById(probe) {
  return Object.fromEntries(probe.metadata.map((tool) => [tool.id, tool.status]));
}

const noBridge = runProbe({
  FENO_SKILL_BRIDGE_URL: "",
  FENO_SKILL_BRIDGE_TOKEN: "",
});
assert.deepEqual(noBridge.defaults, ["feno-data"]);
assert.deepEqual(statusById(noBridge), {
  "feno-data": "available",
  "feno-search": "soon",
  "google-search": "locked",
  "naver-search": "soon",
  "kakao-search": "soon",
});
assert.deepEqual(noBridge.normalized, ["feno-data"]);
assert.deepEqual(noBridge.declarations, ["getFenoTickerContext"]);
assert.equal(noBridge.instructionCount, 1);
assert.equal(noBridge.searchNaverResult.error, "UNKNOWN_TOOL");

const withBridge = runProbe({
  FENO_SKILL_BRIDGE_URL: "http://127.0.0.1:3577/live-search",
  FENO_SKILL_BRIDGE_TOKEN: "dummy-token",
});
assert.deepEqual(withBridge.defaults, ["feno-data"]);
assert.deepEqual(statusById(withBridge), {
  "feno-data": "available",
  "feno-search": "available",
  "google-search": "locked",
  "naver-search": "available",
  "kakao-search": "available",
});
assert.deepEqual(withBridge.normalized, ["feno-data", ...SEARCH_TOOL_IDS]);
assert.deepEqual(withBridge.declarations, [
  "getFenoTickerContext",
  "searchFenoWeb",
  "searchNaverWeb",
  "searchKakaoWeb",
]);
assert.deepEqual(withBridge.naverTypeEnum, [
  "web",
  "news",
  "blog",
  "shop",
  "image",
  "local",
  "book",
  "kin",
  "cafe",
  "doc",
  "encyc",
]);
assert.deepEqual(withBridge.kakaoTypeEnum, ["web", "blog", "place", "image", "vclip", "book", "cafe"]);
assert.equal(withBridge.instructionCount, 4);
assert(
  ["SKILL_BRIDGE_HTTP_FAILED", "SKILL_BRIDGE_REQUEST_FAILED"].includes(withBridge.searchNaverResult.error),
  `Unexpected bridge probe error: ${withBridge.searchNaverResult.error}`,
);

console.log("admin-live-tool-registry env-gate smoke PASS");
