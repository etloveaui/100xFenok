import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  WINDDOWN_ACTIVITY_CONTRACTS,
  WINDDOWN_REVIEW_DAILY_TARGET,
  getWindDownReviewJourneyTarget,
  getWindDownActivityContract,
} from "../src/features/winddown/model/productContract";
import { buildWindDownStudyBootstrap } from "../src/features/winddown/server/studyBootstrap";
import {
  getWindDownKstDay,
  normalizeWindDownStudyCount,
  normalizeWindDownStudyMode,
  normalizeWindDownStudySeed,
} from "../src/features/winddown/server/studyRequest";
import type { MonaVnextExpression } from "../src/features/mona-vnext/coach/coachPolicy";

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const absolute = path.join(root, name);
    return statSync(absolute).isDirectory()
      ? listSourceFiles(absolute)
      : [absolute];
  });
}

function resolveProjectImport(fromFile: string, specifier: string) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const unresolved = specifier.startsWith("@/")
    ? path.join(process.cwd(), "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const withoutJavaScriptExtension = unresolved.replace(
    /\.(?:mjs|cjs|js|jsx)$/,
    "",
  );
  const candidates = [
    unresolved,
    withoutJavaScriptExtension,
    `${withoutJavaScriptExtension}.ts`,
    `${withoutJavaScriptExtension}.tsx`,
    path.join(withoutJavaScriptExtension, "index.ts"),
    path.join(withoutJavaScriptExtension, "index.tsx"),
  ];
  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

function importSpecifiers(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function collectTransitiveProjectSources(entryFiles: string[]) {
  const queue = [...entryFiles];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    for (const specifier of importSpecifiers(file)) {
      const dependency = resolveProjectImport(file, specifier);
      if (dependency && !visited.has(dependency)) queue.push(dependency);
    }
  }
  return [...visited];
}

const contracts = Object.values(WINDDOWN_ACTIVITY_CONTRACTS);
assert.deepEqual(
  contracts.map((contract) => contract.mode),
  ["learn", "review", "roleplay", "live-talk"],
  "WIND DOWN must expose four stable product activities",
);
assert.equal(getWindDownActivityContract("learn").modelPolicy, "forbidden");
assert.equal(getWindDownActivityContract("review").modelPolicy, "forbidden");
assert.equal(getWindDownActivityContract("roleplay").modelPolicy, "required");
assert.equal(getWindDownActivityContract("live-talk").modelPolicy, "required");
assert.notEqual(
  getWindDownActivityContract("roleplay").engine,
  getWindDownActivityContract("live-talk").engine,
  "Roleplay and Live Talk must not be aliases for one engine",
);
assert.equal(WINDDOWN_REVIEW_DAILY_TARGET, 3);
assert.deepEqual(
  getWindDownReviewJourneyTarget({ completedCount: 0, dueCount: 20 }),
  { target: 3, remaining: 3 },
);
assert.deepEqual(
  getWindDownReviewJourneyTarget({ completedCount: 1, dueCount: 20 }),
  { target: 3, remaining: 2 },
);
assert.deepEqual(
  getWindDownReviewJourneyTarget({ completedCount: 3, dueCount: 20 }),
  { target: 3, remaining: 0 },
);

const entries: MonaVnextExpression[] = [
  { id: "fresh-a", ko: "새 문장 A", en: "A fresh sentence.", state: "prompt" },
  { id: "due-a", ko: "복습 A", en: "Review sentence A.", state: "prompt" },
  {
    id: "fresh-b",
    ko: "새 문장 B",
    en: "A second fresh sentence.",
    state: "prompt",
  },
  { id: "future-a", ko: "나중 A", en: "A future sentence.", state: "prompt" },
];

const learn = buildWindDownStudyBootstrap({
  mode: "learn",
  seed: "winddown-contract",
  entries,
  dueExpressionIds: ["due-a"],
  deferredExpressionIds: ["future-a", "missing-deferred"],
  count: 5,
});
assert.deepEqual(
  new Set(learn.cards.map((card) => card.id)),
  new Set(["fresh-a", "fresh-b"]),
);
assert.equal(learn.modelOpened, false);
assert.equal(learn.inventory.insufficientFreshCount, 3);
assert.deepEqual(learn.inventory.missingDeferredExpressionIds, [
  "missing-deferred",
]);
assert.equal(learn.inventory.profileKnownCount, 3);
assert.equal(learn.inventory.knownInMaterialCount, 2);

const sameSeedLearn = buildWindDownStudyBootstrap({
  mode: "learn",
  seed: "winddown-contract",
  entries,
  dueExpressionIds: ["due-a"],
  deferredExpressionIds: ["future-a", "missing-deferred"],
  count: 5,
});
assert.deepEqual(
  sameSeedLearn.cards.map((card) => card.id),
  learn.cards.map((card) => card.id),
  "The same seed and material must produce the same Learn order",
);
assert.ok(
  ["night-1", "night-2", "night-3", "night-4"].some((seed) => {
    const candidate = buildWindDownStudyBootstrap({
      mode: "learn",
      seed,
      entries,
      dueExpressionIds: ["due-a"],
      deferredExpressionIds: ["future-a", "missing-deferred"],
      count: 5,
    });
    return (
      candidate.cards.map((card) => card.id).join(",") !==
      learn.cards.map((card) => card.id).join(",")
    );
  }),
  "Different seeds must be able to change Learn order",
);

const review = buildWindDownStudyBootstrap({
  mode: "review",
  seed: "winddown-contract",
  entries,
  dueExpressionIds: ["due-a", "missing-due"],
  deferredExpressionIds: ["future-a", "missing-deferred"],
  count: 5,
});
assert.deepEqual(
  review.cards.map((card) => card.id),
  ["due-a"],
);
assert.deepEqual(review.inventory.missingDueExpressionIds, ["missing-due"]);
assert.equal(review.inventory.unresolvedDueCount, 1);
assert.deepEqual(review.inventory.missingDeferredExpressionIds, [
  "missing-deferred",
]);
assert.equal(
  review.inventory.freshAvailableCount,
  2,
  "Missing persisted IDs must not reduce the count of fresh material that actually exists",
);
assert.equal(review.modelOpened, false);

const emptyLearn = buildWindDownStudyBootstrap({
  mode: "learn",
  seed: "empty-profile",
  entries,
  dueExpressionIds: [],
  deferredExpressionIds: [],
  count: 20,
});
assert.equal(emptyLearn.cards.length, entries.length);
assert.equal(emptyLearn.inventory.profileKnownCount, 0);

const emptyReview = buildWindDownStudyBootstrap({
  mode: "review",
  seed: "empty-profile",
  entries,
  dueExpressionIds: [],
  deferredExpressionIds: [],
  count: 20,
});
assert.deepEqual(emptyReview.cards, []);
assert.equal(emptyReview.inventory.dueCount, 0);
const completedReview = buildWindDownStudyBootstrap({
  mode: "review",
  seed: "daily-target-complete",
  entries,
  dueExpressionIds: ["due-a"],
  deferredExpressionIds: [],
  count: 0,
});
assert.deepEqual(completedReview.cards, []);
assert.equal(
  completedReview.inventory.requestedCount,
  0,
  "a completed daily review target must not reopen one extra card",
);
assert.equal(
  buildWindDownStudyBootstrap({
    mode: "learn",
    seed: "invalid-count",
    entries,
    dueExpressionIds: [],
    deferredExpressionIds: [],
    count: Number.NaN,
  }).inventory.requestedCount,
  20,
);

assert.equal(normalizeWindDownStudyMode("learn"), "learn");
assert.equal(normalizeWindDownStudyMode("roleplay"), null);
assert.equal(
  getWindDownKstDay(new Date("2026-07-30T14:59:59.999Z")),
  "2026-07-30",
  "the KST study day must not roll over before local midnight",
);
assert.equal(
  getWindDownKstDay(new Date("2026-07-30T15:00:00.000Z")),
  "2026-07-31",
  "the KST study day must roll over exactly at local midnight",
);
assert.equal(normalizeWindDownStudyCount(null), 20);
assert.equal(normalizeWindDownStudyCount(""), 20);
assert.equal(normalizeWindDownStudyCount("not-a-number"), 20);
assert.equal(normalizeWindDownStudyCount("0"), 1);
assert.equal(normalizeWindDownStudyCount("999"), 20);
assert.equal(
  normalizeWindDownStudySeed(null, "review", "2026-07-31"),
  "2026-07-31:review",
);

const studyApi = path.join(
  process.cwd(),
  "src/app/api/winddown/study/route.ts",
);
const progressApi = path.join(
  process.cwd(),
  "src/app/api/winddown/progress/route.ts",
);
const reviewApi = path.join(
  process.cwd(),
  "src/app/api/winddown/review/route.ts",
);
const habitApi = path.join(
  process.cwd(),
  "src/app/api/winddown/habit/route.ts",
);
const studyBootstrap = path.join(
  process.cwd(),
  "src/features/winddown/server/studyBootstrap.ts",
);
const modelFreeEntryPaths = [
  studyBootstrap,
  path.join(process.cwd(), "src/features/winddown/content"),
  path.join(process.cwd(), "src/features/winddown/learn"),
  path.join(process.cwd(), "src/features/winddown/review"),
  path.join(process.cwd(), "src/features/winddown/ui"),
  studyApi,
  progressApi,
  reviewApi,
  path.join(process.cwd(), "src/app/winddown/learn/page.tsx"),
  path.join(process.cwd(), "src/app/winddown/review/page.tsx"),
].filter(existsSync);
const modelFreeEntryFiles = modelFreeEntryPaths.flatMap((entry) =>
  statSync(entry).isDirectory() ? listSourceFiles(entry) : [entry],
);
const modelFreeFiles = collectTransitiveProjectSources(modelFreeEntryFiles);
for (const file of modelFreeFiles) {
  const normalized = file.split(path.sep).join("/");
  assert.equal(
    /\/src\/features\/mona-vnext\/live(?:\/|\.[^/]+$)/.test(normalized) ||
      normalized.endsWith("/src/features/mona-vnext/server/liveSetup.ts") ||
      normalized.endsWith("/src/features/mona-vnext/MonaVoiceCoachApp.tsx") ||
      /\/src\/app\/api\/mona-vnext\/session(?:\/|\.[^/]+$)/.test(normalized),
    false,
    `model-free import graph reaches a Live module: ${path.relative(process.cwd(), file)}`,
  );
}
assert.ok(
  modelFreeFiles.includes(studyBootstrap),
  "Study bootstrap must be inside the checked graph",
);
const boundarySource = modelFreeFiles
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const forbidden of [
  "useGeminiLiveSession",
  "/api/mona-vnext/session",
  "MONA_VNEXT_AUTH_TOKEN_ENDPOINT",
  "new WebSocket",
  "getUserMedia",
]) {
  assert.equal(
    boundarySource.includes(forbidden),
    false,
    `model-free product boundary contains forbidden Live dependency: ${forbidden}`,
  );
}
assert.equal(
  readFileSync(studyApi, "utf8").includes("detail:"),
  false,
  "The study API must not return raw internal error details",
);
assert.ok(
  readFileSync(studyApi, "utf8").includes("reviewJourney.remaining")
    && readFileSync(habitApi, "utf8").includes("getWindDownReviewJourneyTarget"),
  "Study and habit routes must share one daily review target calculation",
);

const roleplayPage = path.join(
  process.cwd(),
  "src/app/winddown/roleplay/page.tsx",
);
const liveTalkPage = path.join(
  process.cwd(),
  "src/app/winddown/live-talk/page.tsx",
);
const voiceClient = path.join(
  process.cwd(),
  "src/features/winddown/voice/ui/WindDownVoiceClient.tsx",
);
for (const file of [roleplayPage, liveTalkPage, voiceClient]) {
  assert.equal(existsSync(file), true, `Phase 5 voice product file missing: ${file}`);
}
const voiceFiles = collectTransitiveProjectSources([
  roleplayPage,
  liveTalkPage,
  voiceClient,
]);
for (const file of voiceFiles) {
  const normalized = file.split(path.sep).join("/");
  assert.equal(
    normalized.endsWith("/src/features/mona-vnext/MonaVoiceCoachApp.tsx") ||
      normalized.endsWith("/src/components/admin-live/MonaWindDown.tsx") ||
      normalized.endsWith("/src/features/mona-vnext/teacher/teacherMachine.ts") ||
      normalized.endsWith("/src/features/mona-vnext/coach/coachPrompt.ts") ||
      normalized.endsWith("/src/features/mona-vnext/game/gameSession.ts"),
    false,
    `Phase 5 voice product reaches the legacy card/XP teacher runtime: ${path.relative(process.cwd(), file)}`,
  );
}
const voiceBoundarySource = voiceFiles
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const required of [
  "useGeminiLiveTransport",
  "/api/winddown/live/session/",
  "/api/winddown/live/report/",
  "scenario-goals-complete",
  "learner-stop",
]) {
  assert.equal(
    voiceBoundarySource.includes(required),
    true,
    `Phase 5 voice product boundary is missing: ${required}`,
  );
}
assert.equal(
  readFileSync(roleplayPage, "utf8").includes('activity="roleplay"'),
  true,
  "Roleplay route must bind the Roleplay product",
);
assert.equal(
  readFileSync(liveTalkPage, "utf8").includes('activity="live-talk"'),
  true,
  "Live Talk route must bind the Live Talk product",
);

console.log(
  "PASS winddown-v2-contract - model-free activities and isolated voice products are explicit",
);
