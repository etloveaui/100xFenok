import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => existsSync(path.join(root, rel));

const TOUR = "src/features/winddown/game/model/tour.ts";
const ROSTER = "src/features/winddown/game/model/roster.ts";
const CONTRACT = "src/features/winddown/game/model/contract.ts";
const SCENES = "src/features/winddown/game/ui/scenes.ts";
const PROGRESS = "src/features/winddown/game/model/progress.ts";
const CEREMONY = "src/features/winddown/game/model/ceremony.ts";
const CLIENT = "src/features/winddown/game/ui/WindDownGameClient.tsx";
const ROUTE = "src/app/winddown/game/page.tsx";
const CEREMONY_API = "src/app/api/winddown/game/ceremony/route.ts";
const HOME = "src/features/winddown/habit/ui/WindDownHabitHomeClient.tsx";
const HABIT_API = "src/app/api/winddown/habit/route.ts";
const COORDINATOR =
  "src/features/mona-vnext/memory/learningProfileCoordinator.ts";
const ROUTE_CONTRACT = "scripts/check-route-key-contract.mjs";

for (const rel of [
  TOUR,
  ROSTER,
  CONTRACT,
  SCENES,
  PROGRESS,
  CEREMONY,
  CLIENT,
  ROUTE,
  CEREMONY_API,
  HOME,
  HABIT_API,
  COORDINATOR,
  ROUTE_CONTRACT,
]) {
  assert.equal(exists(rel), true, `WIND DOWN game file missing: ${rel}`);
}

const tour = read(TOUR);
const progress = read(PROGRESS);
const ceremony = read(CEREMONY);
const client = read(CLIENT);
const route = read(ROUTE);
const ceremonyApi = read(CEREMONY_API);
const roster = read(ROSTER);
const contract = read(CONTRACT);
const scenes = read(SCENES);
const home = read(HOME);
const habitApi = read(HABIT_API);
const coordinator = read(COORDINATOR);
const routeContract = read(ROUTE_CONTRACT);

/* 1. the route is authenticated and immersive, exactly like the other WIND DOWN routes */
assert.equal(
  route.includes("AdminAccessGate"),
  true,
  "game route must gate on admin session like every other WIND DOWN route",
);
assert.equal(
  route.includes('data-immersive-route="winddown"'),
  true,
  "game route must declare the immersive WIND DOWN route marker",
);

/* 2. model-free boundary: the game must never reach Live, mic, token, or socket code */
for (const forbidden of [
  "useGeminiLiveSession",
  "SpeechRecognition",
  "getUserMedia",
  "WebSocket",
  "/api/mona-vnext/session",
  "GEMINI_API_KEY",
]) {
  for (const [name, source] of [
    ["client", client],
    ["tour model", tour],
    ["roster model", roster],
    ["contract model", contract],
    ["scenes", scenes],
    ["progress model", progress],
    ["route", route],
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `WIND DOWN game ${name} must not reference ${forbidden}`,
    );
  }
}

/* 3. theme discipline: surfaces resolve from --wd-*, never from raw hex or the
      themeable --fnk-neutral ramp that inverts under [data-theme="dark"] */
assert.equal(
  /#[0-9a-fA-F]{6}/.test(client),
  false,
  "game client must not carry raw hex colours; use --wd-* tokens",
);
assert.equal(
  client.includes("--fnk-neutral-"),
  false,
  "game client must not resolve colour from the themeable --fnk-neutral ramp",
);
assert.equal(
  /#[0-9a-fA-F]{6}/.test(
    scenes.replace(/"--wd-[a-z-]+",\s*"#[0-9a-fA-F]{6}"/g, ""),
  ),
  false,
  "scenes may only carry hex inside an explicit --wd-* token fallback",
);
assert.equal(
  scenes.includes("--wd-"),
  true,
  "scenes must resolve colour from scoped --wd-* tokens",
);
assert.equal(
  client.includes("var(--wd-"),
  true,
  "game client must resolve colour from the scoped --wd-* tokens",
);

/* 4. reduced motion is honoured by the animation loop, not only by CSS */
assert.equal(
  client.includes("prefers-reduced-motion"),
  true,
  "game client must gate its animation loop on prefers-reduced-motion",
);
assert.equal(
  client.includes("cancelAnimationFrame"),
  true,
  "game client must stop its animation loop rather than leaking a frame callback",
);

/* 5. content is data: acts, chapters and regions are declared, not branched on */
const chapterRows = tour.match(/\{ id: "[^"]+".*unlockLevel:\s*\d+.*\}/g) ?? [];
const chapterCount = chapterRows.length;
assert.equal(chapterCount, 24, `expected exactly 24 chapters, found ${chapterCount}`);
const actCount = (tour.match(/tag:\s*"ACT /g) ?? []).length;
assert.equal(actCount, 9, `expected exactly 9 acts, found ${actCount}`);
const regionCount = (tour.match(/\{ id: "[^"]+".*topic:/g) ?? []).length;
assert.equal(regionCount, 12, `expected exactly 12 regions, found ${regionCount}`);
assert.equal(
  /switch\s*\(\s*chapter\.(id|scene)\s*\)/.test(client),
  false,
  "scenes must resolve through a registry, never a switch over chapter ids",
);
assert.equal(
  /isBuilt\(\s*x\s*,/.test(scenes),
  false,
  "scenes must not hash animated x for build state",
);
assert.equal(
  scenes.includes("identity: number"),
  true,
  "scenes must gate build state on a stable identity",
);
assert.equal(
  client.includes('role="img"') && client.includes("orientationchange"),
  true,
  "the reduced-motion canvas must repaint on rotate and expose image semantics",
);
assert.equal(
  (client.match(/\}, \[paint, reduced, status\]\);/g) ?? []).length,
  2,
  "both animation effects must depend on ready status so a zero-XP canvas paints after mount",
);

const memberCount = (roster.match(/\n    roleLabel:/g) ?? []).length;
assert.equal(memberCount, 4, `expected exactly four members, found ${memberCount}`);
assert.equal(
  contract.includes("members: WIND_DOWN_MEMBERS")
    && client.includes("memberForChapter")
    && scenes.includes("WindDownMember"),
  true,
  "the content pack roster must change both copy and the tour scene",
);
for (const token of ["WIND_DOWN_CONTENT_PACK", "version", "seed"]) {
  assert.equal(contract.includes(token), true, `content/learner contract missing: ${token}`);
}
assert.equal(
  /seed:\s*number/.test(contract),
  true,
  "learner profile must carry a deterministic numeric seed",
);
assert.equal(
  contract.includes("learner.seed")
    && client.includes("memberForChapter")
    && client.includes("모나의 고정 시드")
    && !client.includes("setMemberId"),
  true,
  "the learner seed must deterministically drive the scene without a fake local preference",
);
assert.equal(
  client.includes("매일 19 XP면 예상 약")
    && !client.includes("이 속도면")
    && !client.includes("밤마다 조금씩"),
  true,
  "forecast copy must state its ideal-night assumption instead of presenting measured pace",
);
assert.equal(
  progress.includes("projectWindDownGameProgress")
    && progress.includes("WindDownHabitCompletionEvent"),
  true,
  "game XP must project from authoritative habit receipts",
);
assert.equal(
  client.includes('fetch("/api/winddown/habit"')
    && !/function WindDownGameClient\(\{\s*xp/.test(client),
  true,
  "the client must read receipt-backed progress rather than accept invented XP",
);
assert.equal(
  coordinator.includes("projectWindDownGameProgress(events)")
    && habitApi.includes("game:")
    && home.includes('href="/winddown/game"')
    && client.includes('href="/winddown"'),
  true,
  "receipt progress and home/back navigation must be wired end to end",
);
assert.equal(
  home.includes("const game = habit?.game ?? null")
    && home.includes("projection && tonight && game && nextAction"),
  true,
  "the home card must narrow game progress before rendering receipt totals",
);
assert.equal(
  routeContract.includes("page_route_count: 58")
    && routeContract.includes("out_of_scope_count: 15"),
  true,
  "the authenticated game route must be acknowledged by the route-scope count",
);

/* 6. naming is a receipt-gated, one-time ceremony inside the tour, never local
      preference state or a new destination */
for (const [slotId, unlockLevel] of [
  ["group", 7],
  ["debut-song", 10],
  ["fandom", 13],
]) {
  assert.equal(
    ceremony.includes(`id: "${slotId}"`)
      && ceremony.includes(`unlockLevel: ${unlockLevel}`),
    true,
    `ceremony slot ${slotId} must unlock at receipt-derived level ${unlockLevel}`,
  );
}
assert.equal(
  ceremony.includes("WIND_DOWN_CEREMONY_SCHEMA_VERSION")
    && ceremony.includes("optionId")
    && ceremony.includes("windDownCeremonyOption")
    && ceremony.includes("normalizeWindDownCeremonySelection"),
  true,
  "ceremony choices must use a versioned server-owned option contract",
);
assert.equal(
  coordinator.includes('"commit-winddown-ceremony-choice"')
    && coordinator.includes("projectWindDownGameProgress")
    && coordinator.includes("levelFromXp")
    && coordinator.includes("transaction"),
  true,
  "the coordinator must derive ceremony unlocks from immutable receipt XP inside its write transaction",
);
assert.equal(
  ceremonyApi.includes("verifyAdminSessionToken")
    && ceremonyApi.includes("commitWindDownCeremonyChoiceThroughCoordinator")
    && ceremonyApi.includes("MonaVnextProfileCoordinatorError"),
  true,
  "the ceremony write route must require admin auth and preserve coordinator conflict status",
);
assert.equal(
  client.includes('fetch("/api/winddown/game/ceremony"')
    && client.includes("ceremony")
    && !client.includes("localStorage")
    && !client.includes("sessionStorage"),
  true,
  "the tour must persist naming through the server ceremony endpoint without browser-only state",
);
assert.equal(
  habitApi.includes("normalizeWindDownCeremonyProjection(habit.ceremony)")
    && habitApi.includes("ceremony,")
    && client.includes("normalizeWindDownCeremonyProjection(value.ceremony)"),
  true,
  "the committed ceremony must hydrate through the validated habit response after reload",
);
assert.equal(
  client.includes("ceremonyRequestPending")
    && client.includes("min-h-[44px]")
    && !client.includes("min-h-12")
    && (client.match(/aria-live="polite"/g) ?? []).length === 1
    && client.indexOf('<p aria-live="polite"') > client.lastIndexOf("nextCeremony ?")
    && client.includes("response.status === 409")
    && client.includes("ceremonyStatusSlotLabel")
    && client.includes("은 다른 화면에서 먼저 정해져 저장된 이름을 불러왔어.")
    && client.includes("후보가 갱신되어 최신 목록을 불러왔어.")
    && client.includes("max-w-full break-words")
    && client.includes('ceremony.status === "unavailable"')
    && client.includes('optionSource === "mastery-derived"'),
  true,
  "the naming moment must resist double taps and expose honest mobile feedback",
);
assert.equal(
  (coordinator.match(/status: "mastery-invalid"/g) ?? []).length === 1
    && (coordinator.match(/WINDDOWN_CEREMONY_MASTERY_STATE_INVALID/g) ?? []).length === 1
    && coordinator.includes(": projectUnavailableWindDownCeremony("),
  true,
  "a malformed mastery receipt must darken only the read-only ceremony while commits stay fail-closed",
);
assert.equal(
  routeContract.includes("/winddown/game/ceremony"),
  false,
  "ceremony must remain inside the tour rather than becoming a seventh page destination",
);

/* 7. unlock levels are strictly increasing so no chapter is unreachable */
const levels = chapterRows.map((row) =>
  Number(row.match(/unlockLevel:\s*(\d+)/)?.[1] ?? Number.NaN),
);
for (let i = 1; i < levels.length; i += 1) {
  assert.ok(
    levels[i] > levels[i - 1],
    `chapter unlock levels must strictly increase (index ${i}: ${levels[i - 1]} -> ${levels[i]})`,
  );
}

/* 8. the progression curve keeps its promise: one full arc lands near ninety nights */
const levelCost = (n) => 12 + Math.floor(n * 0.55);
const xpToReach = (lv) => {
  let total = 0;
  for (let i = 1; i < lv; i += 1) total += levelCost(i);
  return total;
};
const assumedNightly = Number(
  /XP_PER_CREDITED_ANSWER \* 5 \+ XP_PER_COLLECTED_STAR \* 2/.test(progress) ? 19 : 0,
);
assert.equal(assumedNightly, 19, "nightly forecast assumption changed; update this gate deliberately");
const finalLevel = levels[levels.length - 1];
const arcNights = Math.ceil(xpToReach(finalLevel) / assumedNightly);
assert.ok(
  arcNights >= 80 && arcNights <= 100,
  `full arc should land near ninety nights, computed ${arcNights}`,
);

/* 9. forecasting must never grant progress */
assert.equal(
  /ASSUMED_XP_PER_NIGHT[^\n]*=[^\n]*award/i.test(progress),
  false,
  "the nightly assumption must not be wired into any award path",
);

console.log(
  `score-winddown-game: PASS (acts ${actCount}, chapters ${chapterCount}, regions ${regionCount}, members ${memberCount}, arc ${arcNights} nights)`,
);
