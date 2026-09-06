import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { applyWindDownLearnAction, createWindDownLearnSession, type WindDownLearnAction, type WindDownLearnCard, type WindDownLearnState } from "../src/features/winddown/learn/engine";
import { buildWindDownVoiceReport } from "../src/features/winddown/voice/report";
import { createWindDownRoleplayDescriptor } from "../src/features/winddown/voice/product";
import {
  WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY,
  WIND_DOWN_VOICE_FROZEN_STORAGE_KEY,
  WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY,
} from "../src/features/winddown/voice/pendingStorage";
import { WINDDOWN_REVIEW_DRAFT_STORAGE_KEY, WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY } from "../src/features/winddown/review/draft";
import { assertWindDownQaTarget } from "./winddown-qa-target.mjs";

type Scenario = "resume" | "shortage" | "malformed-resume" | "records";
type ContinuityCase = "review" | "archive" | "voice" | "practice";
type Engine = { id: "chromium" | "webkit"; type: typeof chromium | typeof webkit };
type Viewport = {
  id: string;
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
};

type StudyResponse = {
  schemaVersion: 1;
  mode: "learn";
  seed: string;
  modelOpened: false;
  cards: WindDownLearnCard[];
  inventory: { selectedCount: number; insufficientFreshCount: number };
  material: {
    source: "published-lkg";
    publicationStatus: "active";
    contentDigest: string;
  };
  learnSession: {
    manifest: {
      schemaVersion: 1;
      sessionId: string;
      habitKstDay: string;
      seed: string;
      cardIds: string[];
      contentDigest: string;
      issuedAtIso: string;
      expiresAtIso: string;
    };
    proof: string;
    resumeState: unknown;
  };
  availability?: { status: string; code?: string };
};

const BASE_URL = (process.env.QA_BASE_URL ?? "http://127.0.0.1:3107").replace(/\/+$/, "");
const ADMIN_PASSWORD = process.env.WINDDOWN_QA_ADMIN_PASSWORD ?? process.env.QA_ADMIN_PASSWORD ?? "";
const SCREENSHOT_DIR = process.env.QA_SCREENSHOT_DIR?.trim() || "test-results/winddown-preservation";
const SYNTHETIC_SECRET_MARKER = "winddown-stage1-synthetic";
const CONTENT_DIGEST = "a".repeat(64);
const HABIT_DAY = "2026-09-06";
const ISSUED_AT = "2026-09-06T00:00:00.000Z";
const EXPIRES_AT = "2026-09-06T18:00:00.000Z";

const VIEWPORTS: Viewport[] = [
  { id: "mobile-360", width: 360, height: 800, isMobile: true, hasTouch: true },
  { id: "mobile-390", width: 390, height: 844, isMobile: true, hasTouch: true },
  { id: "tablet-768", width: 768, height: 1024, isMobile: true, hasTouch: true },
  { id: "tablet-820", width: 820, height: 1180, isMobile: true, hasTouch: true },
  { id: "desktop-1024", width: 1024, height: 900, isMobile: false, hasTouch: false },
  { id: "desktop-1440", width: 1440, height: 900, isMobile: false, hasTouch: false },
];

const ENGINES: Engine[] = [
  { id: "webkit", type: webkit },
  { id: "chromium", type: chromium },
];

const CARDS: WindDownLearnCard[] = [
  { id: "synthetic-winddown-01", ko: "오늘은 천천히 시작해요", en: "I can start slowly." },
  { id: "synthetic-winddown-02", ko: "나는 준비가 되었어요", en: "I am ready." },
  { id: "synthetic-winddown-03", ko: "잠시 쉬어도 괜찮아요", en: "It is okay to pause." },
  { id: "synthetic-winddown-04", ko: "나는 다시 시도할 수 있어요", en: "I can try again." },
  { id: "synthetic-winddown-05", ko: "오늘 밤을 잘 마무리해요", en: "I can end tonight well." },
];

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return {
    status,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store", ...extraHeaders },
    body: JSON.stringify(body),
  } as const;
}

function correctAction(state: WindDownLearnState): WindDownLearnAction {
  const current = state.queue[0];
  assert(current, "synthetic Learn state must have a current exercise");
  return current.kind === "meaning-choice"
    ? { type: "choose-meaning", cardId: current.card.id, choiceId: current.correctChoiceId }
    : { type: "submit-sentence", cardId: current.card.id, tokenIds: [...current.canonicalTokenIds] };
}

function makeFixture() {
  const seed = `${HABIT_DAY}:learn`;
  const initialState = createWindDownLearnSession({ cards: CARDS, seed });
  const firstCredit = applyWindDownLearnAction(initialState, correctAction(initialState));
  assert.equal(firstCredit.outcome, "correct");
  assert.equal(firstCredit.reward, 1);
  assert.equal(firstCredit.state.creditedCardIds.length, 1);
  assert.equal(firstCredit.state.queue.length, 4);
  const manifest = {
    schemaVersion: 1 as const,
    sessionId: "synthetic-winddown-session-20260906",
    habitKstDay: HABIT_DAY,
    seed,
    cardIds: CARDS.map((card) => card.id),
    contentDigest: CONTENT_DIGEST,
    issuedAtIso: ISSUED_AT,
    expiresAtIso: EXPIRES_AT,
  };
  const study = (resumeState: unknown): StudyResponse => ({
    schemaVersion: 1,
    mode: "learn",
    seed,
    modelOpened: false,
    cards: CARDS,
    inventory: { selectedCount: CARDS.length, insufficientFreshCount: 0 },
    material: {
      source: "published-lkg",
      publicationStatus: "active",
      contentDigest: CONTENT_DIGEST,
    },
    learnSession: {
      manifest,
      proof: "synthetic-winddown-session-proof",
      resumeState,
    },
  });
  return {
    manifest,
    initialState,
    resumedState: firstCredit.state,
    study,
  };
}

function syntheticBackup() {
  return {
    schemaVersion: 1,
    kind: "winddown-coordinator-recovery-snapshot",
    createdAtIso: ISSUED_AT,
    snapshotDigest: "b".repeat(64),
    recordCount: 1,
    records: [{
      key: "winddown-qa-synthetic-record",
      value: { schemaVersion: 1, source: SYNTHETIC_SECRET_MARKER, preserved: true },
    }],
    legacyKvRecords: [],
  };
}

async function login(base: URL): Promise<string> {
  if (!ADMIN_PASSWORD) throw new Error("WINDDOWN_QA_ADMIN_PASSWORD is required");
  const response = await fetch(new URL("/api/admin/session/", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`synthetic admin session returned HTTP ${response.status}`);
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie().join("; ")
    : response.headers.get("set-cookie") ?? "";
  const match = cookies.match(/(?:^|;\s*)fenok_admin_session=([^;]+)/);
  if (!match) throw new Error("synthetic admin session did not return fenok_admin_session");
  return match[1];
}

function attachDiagnostics(page: Page, engine: Engine["id"], base: URL) {
  const consoleErrors: string[] = [];
  const compatibilityNotices: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests = new Set<string>();
  const blockedRequests: string[] = [];
  let progressPostCount = 0;
  let recordsGetCount = 0;
  let recordsPostCount = 0;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const entry = JSON.stringify({ text: message.text(), location: message.location() });
    const location = message.location().url;
    // WebKit reports this unsupported viewport key as an error. Preserve the
    // Android keyboard behavior and retain this exact, source-bound notice.
    // https://bugs.webkit.org/show_bug.cgi?id=259770
    if (
      engine === "webkit"
      && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.'
      && ["/winddown/learn/", "/winddown/records/"].some((pathname) =>
        location === new URL(pathname, base).href,
      )
    ) {
      compatibilityNotices.push(entry);
      return;
    }
    consoleErrors.push(entry);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (failedRequests.has(request.url())) return;
    const failure = request.failure()?.errorText ?? "unknown";
    if (failure.includes("ERR_ABORTED") && new URL(request.url()).searchParams.has("_rsc")) return;
    pageErrors.push(`request:${request.method()}:${failure}`);
  });
  return {
    consoleErrors,
    compatibilityNotices,
    pageErrors,
    failedRequests,
    blockedRequests,
    progressPostCount,
    recordsGetCount,
    recordsPostCount,
  };
}

type ContinuityDiagnostics = {
  consoleErrors: string[];
  compatibilityNotices: string[];
  pageErrors: string[];
  blockedRequests: string[];
  apiRequests: string[];
  reviewStudyGetCount: number;
  reviewGradePostCount: number;
  reviewCommitPostCount: number;
  conversationsListGetCount: number;
  conversationsDetailGetCount: number;
  voiceSessionPostCount: number;
  voiceReportPostCount: number;
  voiceReportBodies: string[];
  practiceGetCount: number;
  practiceQueries: string[];
};

function attachContinuityDiagnostics(page: Page, engine: Engine["id"], base: URL): ContinuityDiagnostics {
  const diagnostics: ContinuityDiagnostics = {
    consoleErrors: [],
    compatibilityNotices: [],
    pageErrors: [],
    blockedRequests: [],
    apiRequests: [],
    reviewStudyGetCount: 0,
    reviewGradePostCount: 0,
    reviewCommitPostCount: 0,
    conversationsListGetCount: 0,
    conversationsDetailGetCount: 0,
    voiceSessionPostCount: 0,
    voiceReportPostCount: 0,
    voiceReportBodies: [],
    practiceGetCount: 0,
    practiceQueries: [],
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    let locationUrl: URL | null = null;
    try { locationUrl = new URL(location); } catch { locationUrl = null; }
    const isSyntheticReportFailure = [
      "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
      "Failed to load resource: the server responded with a status of 503 ()",
      "Failed to load resource: the server responded with a status of 503",
    ].includes(message.text())
      && locationUrl?.origin === base.origin
      && locationUrl !== null
      && apiPath(locationUrl.href) === "/api/winddown/live/report";
    if (isSyntheticReportFailure) return;
    if (
      engine === "webkit"
      && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.'
      && locationUrl?.origin === base.origin
      && locationUrl !== null
      && ["/winddown/review", "/winddown/conversations", "/winddown/roleplay", "/winddown/drill"].includes(apiPath(locationUrl.href))
      && (apiPath(locationUrl.href) !== "/winddown/drill"
        ? locationUrl.search === ""
        : (locationUrl.searchParams.size === 1 && locationUrl.searchParams.get("practice") === "1")
          || (locationUrl.searchParams.size === 1 && locationUrl.searchParams.get("material") === "synthetic-material-002")
          || (locationUrl.searchParams.size === 3
            && locationUrl.searchParams.get("conversation") === "wd-continuity-session-001"
            && locationUrl.searchParams.get("turn") === "1"
            && locationUrl.searchParams.get("source") === "wd-continuity-conversation-001"))
    ) {
      diagnostics.compatibilityNotices.push(JSON.stringify({ text: message.text(), location }));
      return;
    }
    diagnostics.consoleErrors.push(JSON.stringify({ text: message.text(), location }));
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (diagnostics.blockedRequests.includes(request.url())) return;
    const failure = request.failure()?.errorText ?? "unknown";
    if (failure.includes("ERR_ABORTED") && new URL(request.url()).searchParams.has("_rsc")) return;
    diagnostics.pageErrors.push(`request:${request.method()}:${failure}`);
  });
  return diagnostics;
}

function apiPath(value: string): string {
  const pathname = new URL(value).pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

async function wireSyntheticNetwork(
  page: Page,
  base: URL,
  scenario: Scenario,
  fixture: ReturnType<typeof makeFixture>,
  diagnostics: ReturnType<typeof attachDiagnostics>,
) {
  let state = fixture.resumedState;
  await page.route("**/*", async (handler) => {
    const request = handler.request();
    const requestUrl = new URL(request.url());
    const pathName = requestUrl.pathname;
    const normalizedApiPath = apiPath(request.url());
    const sameOrigin = requestUrl.origin === base.origin;
    const syntheticStudy = sameOrigin && request.method() === "GET" && normalizedApiPath === "/api/winddown/study";
    const syntheticProgress = sameOrigin && request.method() === "POST" && normalizedApiPath === "/api/winddown/progress";
    const syntheticRecordsGet = sameOrigin && request.method() === "GET" && normalizedApiPath === "/api/winddown/records";
    const syntheticRecordsPost = sameOrigin && request.method() === "POST" && normalizedApiPath === "/api/winddown/records";
    if (!sameOrigin || pathName === "/data" || pathName.startsWith("/data/")) {
      diagnostics.failedRequests.add(request.url());
      diagnostics.blockedRequests.push(request.url());
      await handler.abort("blockedbyclient");
      return;
    }
    if (syntheticStudy) {
      if (scenario === "shortage") {
        await handler.fulfill(jsonResponse({
          schemaVersion: 1, mode: "learn", modelOpened: false,
          error: "WINDDOWN_LEARN_NO_NEW_MATERIAL", availability: "no-new-material",
          links: { review: "/winddown/review", drill: "/winddown/drill", home: "/winddown" },
        }));
      } else if (scenario === "malformed-resume") {
        await handler.fulfill(jsonResponse({
          ...fixture.study({ schemaVersion: 1, queue: "malformed", creditedCardIds: "malformed" }),
          availability: { status: "recoverable", code: "MALFORMED_RESUME" },
        }));
      } else {
        assert.notEqual(fixture.resumedState, null, "resume fixture must remain present");
        await handler.fulfill(jsonResponse(fixture.study(fixture.resumedState)));
      }
      return;
    }
    if (syntheticProgress) {
      diagnostics.progressPostCount += 1;
      let body: { action?: WindDownLearnAction } | null = null;
      try { body = request.postDataJSON() as { action?: WindDownLearnAction }; } catch { body = null; }
      const action = body?.action;
      if (!action) {
        await handler.fulfill(jsonResponse({ error: "INVALID_SYNTHETIC_ACTION" }, 400));
        return;
      }
      const result = applyWindDownLearnAction(state, action);
      if (result.outcome === "invalid") {
        await handler.fulfill(jsonResponse({ error: "INVALID_SYNTHETIC_ACTION" }, 400));
        return;
      }
      state = result.state;
      await handler.fulfill(jsonResponse({ ok: true, schemaVersion: 2, activity: "learn", persisted: true, duplicate: false, outcome: result.outcome, reward: result.reward, state, completionReceipt: null, backend: "synthetic" }));
      return;
    }
    if (syntheticRecordsGet) {
      diagnostics.recordsGetCount += 1;
      await handler.fulfill(jsonResponse(
        syntheticBackup(),
        200,
        {
          "Content-Disposition": "attachment; filename=winddown-synthetic-records.json",
        },
      ));
      return;
    }
    if (syntheticRecordsPost) {
      diagnostics.recordsPostCount += 1;
      let payload: unknown = null;
      try { payload = request.postDataJSON(); } catch { payload = null; }
      const candidate = payload && typeof payload === "object" && !Array.isArray(payload)
        && "snapshot" in payload
        ? (payload as { snapshot?: unknown }).snapshot
        : payload;
      assert(candidate && typeof candidate === "object" && !Array.isArray(candidate), "synthetic records POST must contain a snapshot");
      const snapshot = candidate as { kind?: unknown; recordCount?: unknown; records?: unknown; legacyKvRecords?: unknown };
      assert.equal(snapshot.kind, "winddown-coordinator-recovery-snapshot");
      assert.equal(snapshot.recordCount, 1);
      assert(Array.isArray(snapshot.records) && snapshot.records.length === 1, "synthetic records POST must contain one record");
      assert(Array.isArray(snapshot.legacyKvRecords) && snapshot.legacyKvRecords.length === 0, "synthetic records POST must contain no legacy records");
      await handler.fulfill(jsonResponse({ ok: true, recordCount: 1, legacyRecordCount: 0, duplicate: false }));
      return;
    }
    if (pathName.startsWith("/api/")) {
      diagnostics.failedRequests.add(request.url());
      diagnostics.blockedRequests.push(request.url());
      await handler.abort("blockedbyclient");
      return;
    }
    await handler.continue();
  });
}

type ReviewCard = {
  id: string;
  ko: string;
  en: string;
  reviewCycleId: string;
  dueAtIso: string;
};

const REVIEW_CARDS: ReviewCard[] = [
  {
    id: "winddown-review-card-001",
    ko: "오늘은 천천히 시작해요",
    en: "I can start slowly.",
    reviewCycleId: `winddown-review:${"b".repeat(64)}`,
    dueAtIso: "2026-09-06T00:00:00.000Z",
  },
];

function reviewStudyFixture() {
  return {
    schemaVersion: 1 as const,
    mode: "review" as const,
    modelOpened: false as const,
    cards: REVIEW_CARDS,
    material: {
      source: "published-lkg" as const,
      publicationStatus: "active" as const,
      contentDigest: CONTENT_DIGEST,
    },
  };
}

function continuityVoiceFixture() {
  const report = buildWindDownVoiceReport({
    schemaVersion: 1,
    activity: "roleplay",
    productSessionId: "wd-continuity-session-001",
    descriptor: createWindDownRoleplayDescriptor("cafe-order"),
    conversationIds: ["wd-continuity-conversation-001"],
    sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
    startedAtIso: "2026-09-06T00:00:00.000Z",
    stoppedAtIso: "2026-09-06T00:01:00.000Z",
    completionReason: "learner-stop",
    turns: [{
      conversationId: "wd-continuity-conversation-001",
      turnSeq: 1,
      userText: "I want coffee.",
      modelText: "Sure! A more polite way is: I'd like a coffee, please.",
      finalized: true,
      sttDrift: false,
      interrupted: false,
      correctionText: "I'd like a coffee, please.",
    }],
    metrics: { turnCount: 1, interruptionCount: 0 },
  });
  const finalDigest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const outbox = {
    schemaVersion: 1,
    productSessionId: report.productSessionId,
    activity: report.activity,
    finalDigest,
    report,
    stagedAtIso: report.stoppedAtIso,
    attempts: 1,
    lastError: "synthetic continuity retry",
  };
  const checkpoint = {
    schemaVersion: 1,
    productSessionId: "wd-continuity-checkpoint-001",
    activity: "roleplay",
    conversationIds: ["wd-continuity-checkpoint-conv-001"],
    sessionProofs: [`${"B".repeat(80)}.${"b".repeat(64)}`],
    descriptor: createWindDownRoleplayDescriptor("cafe-order"),
    startedAtIso: "2026-09-06T00:00:00.000Z",
    turns: [{
      conversationId: "wd-continuity-checkpoint-conv-001",
      turnSeq: 1,
      userText: "Hi there.",
      modelText: "Hello!",
      finalized: true,
      sttDrift: false,
      interrupted: false,
    }],
    metrics: { turnCount: 1, interruptionCount: 0 },
    checkpointAtIso: "2026-09-06T00:00:30.000Z",
  };
  return { report, finalDigest, outbox, checkpoint };
}

function continuityArchiveFixture() {
  const voice = continuityVoiceFixture();
  const receipt = {
    schemaVersion: 1 as const,
    activity: "roleplay" as const,
    productSessionId: voice.report.productSessionId,
    finalDigest: voice.finalDigest,
    committedAtIso: voice.report.stoppedAtIso,
    report: voice.report,
  };
  return {
    first: {
      productSessionId: voice.report.productSessionId,
      activity: "roleplay" as const,
      committedAtIso: receipt.committedAtIso,
      scenarioTitle: "카페에서 주문하기",
      correctionCount: 1,
    },
    second: {
      productSessionId: "wd-continuity-session-002",
      activity: "live-talk" as const,
      committedAtIso: "2026-09-05T23:00:00.000Z",
      scenarioTitle: "오늘을 천천히 풀기",
      correctionCount: 0,
    },
    receipt,
  };
}

const PRACTICE_PATTERN = "I am [state].";
const PRACTICE_MATERIALS = [
  {
    id: "synthetic-material-002",
    ko: "나는 준비가 되었어요",
    en: "I am ready.",
    acceptedVariants: ["I'm ready."],
    practice: { pattern: PRACTICE_PATTERN, variationsEn: ["I'm [state].", "I am ready."], theme: "selftalk-emotion" },
  },
  {
    id: "synthetic-material-003",
    ko: "잠시 쉬어도 괜찮아요",
    en: "It is okay to pause.",
    acceptedVariants: [],
    practice: { pattern: null, variationsEn: [], theme: "free" },
  },
  {
    id: "synthetic-material-004",
    ko: "나는 다시 시도할 수 있어요",
    en: "I can try again.",
    acceptedVariants: [],
    practice: { pattern: null, variationsEn: [], theme: "selftalk-emotion" },
  },
];

function practiceResponse(target: Record<string, unknown>, voiceCorrection?: Record<string, unknown>) {
  return {
    ok: true,
    schemaVersion: 1,
    mode: "practice",
    modelOpened: false,
    material: { source: "published-lkg", publicationStatus: "active", contentDigest: CONTENT_DIGEST },
    materials: PRACTICE_MATERIALS,
    target,
    ...(voiceCorrection ? { voiceCorrection } : {}),
  };
}

async function wireContinuityNetwork(
  page: Page,
  base: URL,
  continuityCase: ContinuityCase,
  diagnostics: ContinuityDiagnostics,
) {
  const archive = continuityArchiveFixture();
  let gradeCount = 0;
  let firstReviewCommitBody: string | null = null;
  await page.route("**/*", async (handler) => {
    const request = handler.request();
    const requestUrl = new URL(request.url());
    const normalizedApiPath = apiPath(request.url());
    const sameOrigin = requestUrl.origin === base.origin;
    if (!sameOrigin || requestUrl.pathname === "/data" || requestUrl.pathname.startsWith("/data/")) {
      diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
      await handler.abort("blockedbyclient");
      return;
    }
    const routeIsExplicitlyTested = continuityCase === "review"
      ? normalizedApiPath === "/api/winddown/study" || normalizedApiPath === "/api/winddown/review"
      : continuityCase === "archive"
        ? normalizedApiPath === "/api/winddown/conversations"
        : continuityCase === "practice"
          ? normalizedApiPath === "/api/winddown/conversations" || normalizedApiPath === "/api/winddown/drill"
          : continuityCase === "voice"
            ? normalizedApiPath === "/api/winddown/live/report"
            : false;
    if (requestUrl.pathname.startsWith("/api/") && !routeIsExplicitlyTested) {
      if (normalizedApiPath === "/api/winddown/live/session") diagnostics.voiceSessionPostCount += 1;
      if (normalizedApiPath === "/api/winddown/live/report") diagnostics.voiceReportPostCount += 1;
      diagnostics.apiRequests.push(request.url());
      diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
      await handler.abort("blockedbyclient");
      return;
    }
    if (normalizedApiPath === "/api/winddown/study" && request.method() === "GET") {
      diagnostics.apiRequests.push(request.url());
      if (requestUrl.searchParams.get("mode") !== "review" || requestUrl.searchParams.size !== 1) {
        diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
        await handler.abort("blockedbyclient");
        return;
      }
      diagnostics.reviewStudyGetCount += 1;
      const study = reviewStudyFixture();
      await handler.fulfill(jsonResponse(firstReviewCommitBody ? { ...study, cards: [] } : study));
      return;
    }
    if (normalizedApiPath === "/api/winddown/review" && request.method() === "POST") {
      diagnostics.apiRequests.push(request.url());
      let body: Record<string, unknown> | null = null;
      try { body = request.postDataJSON() as Record<string, unknown>; } catch { body = null; }
      if (!body || body.activity !== "review") {
        diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
        await handler.abort("blockedbyclient");
        return;
      }
      if (body.operation === "grade-recall") {
        diagnostics.reviewGradePostCount += 1;
        gradeCount += 1;
        await handler.fulfill(jsonResponse({ ok: true, operation: "grade-recall", outcome: gradeCount === 1 ? "again" : "correct", needsRepair: gradeCount === 1 }));
        return;
      }
      if (body.operation === "commit-review-cycle") {
        diagnostics.reviewCommitPostCount += 1;
        const submitted = request.postData() ?? "";
        if (firstReviewCommitBody === null) {
          firstReviewCommitBody = submitted;
          // Simulate a committed operation whose acknowledgment was truncated.
          await handler.fulfill(jsonResponse({ ok: true, operation: "commit-review-cycle" }));
          return;
        }
        assert.equal(submitted, firstReviewCommitBody, "manual retry must preserve the exact lost-ack commit body");
        await handler.fulfill(jsonResponse({
          ok: true,
          operation: "commit-review-cycle",
          duplicate: true,
          receipt: {
            reviewCycleId: REVIEW_CARDS[0].reviewCycleId,
            materialId: REVIEW_CARDS[0].id,
            rating: "hard",
            reward: 1,
            inputMode: "typed",
          },
          remainingDueCount: 0,
          nextDueAtIso: null,
        }));
        return;
      }
      diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
      await handler.abort("blockedbyclient");
      return;
    }
    if (normalizedApiPath === "/api/winddown/conversations" && request.method() === "GET") {
      diagnostics.apiRequests.push(request.url());
      const params = requestUrl.searchParams;
      if (params.size > 1 || (params.has("cursor") && params.get("cursor") !== "continuity-page-1") || (params.has("session") && params.get("session") !== archive.first.productSessionId)) {
        diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
        await handler.abort("blockedbyclient");
        return;
      }
      if (params.has("session")) {
        diagnostics.conversationsDetailGetCount += 1;
        await handler.fulfill(jsonResponse({ ok: true, receipt: archive.receipt }));
        return;
      }
      diagnostics.conversationsListGetCount += 1;
      if (continuityCase === "archive" && diagnostics.conversationsListGetCount === 1) {
        await handler.fulfill(jsonResponse({ ok: true, items: [{}], nextCursor: null }));
        return;
      }
      await handler.fulfill(jsonResponse({
        ok: true,
        items: params.get("cursor") ? [archive.second] : [archive.first],
        nextCursor: params.get("cursor") ? null : "continuity-page-1",
      }));
      return;
    }
    if (normalizedApiPath === "/api/winddown/drill" && request.method() === "GET") {
      diagnostics.apiRequests.push(request.url());
      diagnostics.practiceGetCount += 1;
      diagnostics.practiceQueries.push(requestUrl.search);
      const params = requestUrl.searchParams;
      const isCorrection = params.get("conversation") === archive.first.productSessionId
        && params.get("turn") === "1"
        && params.get("source") === "wd-continuity-conversation-001"
        && params.size === 3;
      const isCanonical = params.get("material") === "synthetic-material-002" && params.size === 1;
      const isGeneric = params.get("practice") === "1" && params.size === 1;
      if (isCorrection) {
        const correction = archive.receipt.report.outcome.corrections[0];
        assert(correction, "synthetic archive fixture must contain one correction");
        await handler.fulfill(jsonResponse(practiceResponse(
          { kind: "voice-correction", citation: { productSessionId: archive.first.productSessionId, sourceConversationId: "wd-continuity-conversation-001", turnSeq: 1 } },
          { citation: { productSessionId: archive.first.productSessionId, sourceConversationId: "wd-continuity-conversation-001", turnSeq: 1 }, learnerText: correction.learnerText, modelCorrection: correction.correctionText },
        )));
        return;
      }
      if (isCanonical) {
        await handler.fulfill(jsonResponse(practiceResponse({ kind: "canonical-material", materialId: "synthetic-material-002" })));
        return;
      }
      if (isGeneric) {
        await handler.fulfill(jsonResponse(practiceResponse({ kind: "generic" })));
        return;
      }
      diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
      await handler.abort("blockedbyclient");
      return;
    }
    if (continuityCase === "voice" && normalizedApiPath === "/api/winddown/live/report" && request.method() === "POST") {
      diagnostics.apiRequests.push(request.url());
      diagnostics.voiceReportPostCount += 1;
      diagnostics.voiceReportBodies.push(request.postData() ?? "");
      if (diagnostics.voiceReportPostCount === 1) {
        await handler.fulfill(jsonResponse({ error: "SYNTHETIC_REPORT_SAVE_FAILED" }, 503));
        return;
      }
      const body = request.postData() ?? "";
      const frozenFixture = continuityVoiceFixture();
      assert.equal(body, JSON.stringify(frozenFixture.report), "successful retry must transmit the frozen report bytes");
      await handler.fulfill(jsonResponse({
        ok: true,
        duplicate: false,
        habitCredited: false,
        receipt: {
          schemaVersion: 1,
          activity: "roleplay",
          productSessionId: frozenFixture.report.productSessionId,
          finalDigest: frozenFixture.finalDigest,
          committedAtIso: frozenFixture.report.stoppedAtIso,
          report: frozenFixture.report,
        },
      }));
      return;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      diagnostics.apiRequests.push(request.url());
      diagnostics.blockedRequests.push(`${request.method()} ${request.url()}`);
      await handler.abort("blockedbyclient");
      return;
    }
    await handler.continue();
  });
}

async function waitForText(page: Page, text: RegExp | string) {
  const locator = typeof text === "string" ? page.getByText(text, { exact: true }).first() : page.getByText(text).first();
  await locator.waitFor({ state: "visible", timeout: 20_000 });
  return locator;
}

async function assertDestinations(page: Page, destinations: readonly string[]) {
  for (const destination of destinations) {
    const count = await page.locator("a").evaluateAll((anchors, target) => anchors.filter((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) return false;
      try {
        const pathname = new URL(href, window.location.href).pathname.replace(/\/+$/, "") || "/";
        return pathname === target;
      } catch {
        return false;
      }
    }).length, destination);
    assert.ok(count > 0, `fresh shortage missing destination ${destination}`);
  }
}

async function assertLayout(page: Page) {
  const result = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const controls = [...document.querySelectorAll("button, input:not([type=hidden]), [role=button]")].filter((element) => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    }).map((element) => {
      const rect = (element as HTMLElement).getBoundingClientRect();
      return { tag: element.tagName, label: element.textContent?.trim().slice(0, 70), width: rect.width, height: rect.height };
    });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
      undersized: controls.filter((control) => control.width < 44 || control.height < 44),
    };
  });
  assert.ok(result.scrollWidth <= result.viewportWidth + 1, `horizontal overflow ${result.scrollWidth}/${result.viewportWidth}`);
  assert.equal(result.undersized.length, 0, `tap target under 44px: ${JSON.stringify(result.undersized)}`);
}

function assertDiagnostics(diagnostics: ReturnType<typeof attachDiagnostics>, scenario: string) {
  if (diagnostics.compatibilityNotices.length > 0) {
    console.log(`NOTICE ${scenario} WebKit viewport compatibility: ${JSON.stringify(diagnostics.compatibilityNotices)}`);
  }
  assert.equal(diagnostics.consoleErrors.length, 0, `${scenario} browser console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  assert.equal(diagnostics.pageErrors.length, 0, `${scenario} browser page errors: ${JSON.stringify(diagnostics.pageErrors)}`);
  assert.equal(diagnostics.blockedRequests.length, 0, `${scenario} unexpected external/data/API requests: ${JSON.stringify(diagnostics.blockedRequests)}`);
}

async function runScenario(
  browser: Browser,
  base: URL,
  sessionCookie: string,
  engine: Engine,
  viewport: Viewport,
  scenario: Scenario,
  fixture: ReturnType<typeof makeFixture>,
) {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.isMobile ? 2 : 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: "reduce",
  });
  await context.addCookies([{
    name: "fenok_admin_session",
    value: sessionCookie,
    domain: base.hostname,
    path: "/",
    secure: base.protocol === "https:",
    sameSite: "Lax",
  }]);
    const page = await context.newPage();
  const diagnostics = attachDiagnostics(page, engine.id, base);
  await wireSyntheticNetwork(page, base, scenario, fixture, diagnostics);
  try {
    const route = scenario === "records" ? "/winddown/records/" : "/winddown/learn/";
    const response = await page.goto(new URL(route, base).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert(response && response.status() < 400, `${route} returned HTTP ${response?.status() ?? "no response"}`);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    if (scenario === "resume") {
      await waitForText(page, /1\s*\/\s*5/);
      await assertLayout(page);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
      await waitForText(page, /1\s*\/\s*5/);
    } else if (scenario === "shortage") {
      await page.locator('[data-winddown-learn-availability="no-new-material"]').waitFor({ state: "visible", timeout: 20_000 });
      await waitForText(page, /오늘은 새 문장이 없어/);
      await assertDestinations(page, ["/winddown/review", "/winddown/drill", "/winddown"]);
      await assertLayout(page);
    } else if (scenario === "malformed-resume") {
      await page.locator('[data-winddown-learn-availability="resume-unavailable"]').waitFor({ state: "visible", timeout: 20_000 });
      await assertDestinations(page, ["/winddown/review", "/winddown/drill", "/winddown"]);
      assert.equal(diagnostics.progressPostCount, 0, "malformed resume must not submit a learner attempt");
      await assertLayout(page);
    } else {
      const recordsRoot = page.locator("[data-winddown-records]");
      await recordsRoot.waitFor({ state: "visible", timeout: 20_000 });
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "기록 내려받기" }).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /json/i);
      const stream = await download.createReadStream();
      assert(stream, "synthetic records download must expose a readable stream");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { kind?: string; records?: unknown[] };
      assert.equal(exported.kind, "winddown-coordinator-recovery-snapshot");
      assert(Array.isArray(exported.records), "download must contain a records array");
      assert.equal((exported.records ?? []).length, 1, "download must contain one synthetic record");
      const input = page.locator('input[type="file"]');
      await input.setInputFiles({ name: "synthetic-winddown-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(syntheticBackup())) });
      await page.getByRole("button", { name: "복구 확인" }).click();
      await page.waitForFunction(() => document.body.textContent?.includes("복구를 확인했어요") === true
        || document.querySelector('[data-winddown-recovery-status="verified"]') !== null);
      const recoveryConfirmed = await page.evaluate(() => document.body.textContent?.includes("복구를 확인했어요") === true
        || document.querySelector('[data-winddown-recovery-status="verified"]') !== null);
      assert.equal(recoveryConfirmed, true, "recovery must expose the exact verified success state");
      assert.equal(diagnostics.recordsGetCount, 1, "records GET must be intercepted exactly once");
      assert.equal(diagnostics.recordsPostCount, 1, "records POST must be intercepted exactly once");
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${engine.id}-${viewport.id}-records.png`), fullPage: true });
      await assertLayout(page);
    }
    assertDiagnostics(diagnostics, `${engine.id}/${viewport.id}/${scenario}`);
    return `${engine.id}/${viewport.id}/${scenario}`;
  } finally {
    await page.close();
    await context.close();
  }
}

const CONTINUITY_VIEWPORTS: Record<Engine["id"], Viewport[]> = {
  chromium: [
    { id: "phone-390", width: 390, height: 844, isMobile: true, hasTouch: true },
    { id: "tablet-820", width: 820, height: 1180, isMobile: true, hasTouch: true },
    { id: "desktop-1024", width: 1024, height: 900, isMobile: false, hasTouch: false },
  ],
  webkit: [
    { id: "phone-390", width: 390, height: 844, isMobile: true, hasTouch: true },
    { id: "tablet-768", width: 768, height: 1024, isMobile: true, hasTouch: true },
  ],
};

function assertContinuityDiagnostics(
  diagnostics: ContinuityDiagnostics,
  label: string,
) {
  if (diagnostics.compatibilityNotices.length > 0) {
    console.log(`NOTICE ${label} WebKit viewport compatibility: ${JSON.stringify(diagnostics.compatibilityNotices)}`);
  }
  assert.equal(diagnostics.consoleErrors.length, 0, `${label} browser console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  assert.equal(diagnostics.pageErrors.length, 0, `${label} browser page errors: ${JSON.stringify(diagnostics.pageErrors)}`);
  assert.equal(diagnostics.blockedRequests.length, 0, `${label} unexpected external/data/API requests: ${JSON.stringify(diagnostics.blockedRequests)}`);
}

async function captureContinuityFailure(page: Page, label: string, diagnostics: unknown, error: unknown) {
  const body = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "unavailable");
  console.error(JSON.stringify({ case: label, error: error instanceof Error ? error.stack : String(error), body: body.slice(0, 6_000), diagnostics }));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${label}-failure.png`), fullPage: true, timeout: 5_000 }).catch(() => undefined);
}

async function runReviewContinuity(
  context: BrowserContext,
  base: URL,
  engine: Engine,
  viewport: Viewport,
): Promise<string> {
  const page = await context.newPage();
  const diagnostics = attachContinuityDiagnostics(page, engine.id, base);
  await wireContinuityNetwork(page, base, "review", diagnostics);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("winddown:qa:review-reset")) {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("winddown:qa:malformed-review-seeded", "1");
    }
  });
  try {
    const response = await page.goto(new URL("/winddown/review/", base).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert(response && response.status() < 400, `review returned HTTP ${response?.status() ?? "no response"}`);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.getByRole("button", { name: "직접 입력", exact: true }).click();
    const typed = page.getByLabel("영어로 직접 입력", { exact: true });
    await typed.waitFor({ state: "visible", timeout: 20_000 });
    await typed.fill("I can");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await typed.waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await typed.inputValue(), "I can", "typed partial answer must survive reload");
    await assertLayout(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${engine.id}-${viewport.id}-review-input.png`), fullPage: true });
    const malformedDraft = "{unreadable review draft";
    await page.addInitScript(({ key, raw }) => {
      if (!sessionStorage.getItem("winddown:qa:malformed-review-seeded")) {
        sessionStorage.setItem(key, raw);
        sessionStorage.setItem("winddown:qa:malformed-review-seeded", "1");
      }
    }, { key: WINDDOWN_REVIEW_DRAFT_STORAGE_KEY, raw: malformedDraft });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-draft-recovery-action="archive"]').click();
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY), malformedDraft);
    await page.getByRole("button", { name: "직접 입력", exact: true }).click();
    await typed.fill("Fresh answer after recovery");
    await page.reload({ waitUntil: "domcontentloaded" });
    await typed.waitFor({ state: "visible" });
    assert.equal(await typed.inputValue(), "Fresh answer after recovery", "archiving malformed bytes must restore new same-tab continuity");

    const conflictingDraft = "{second unreadable review draft";
    await page.addInitScript(key => {
      const raw = sessionStorage.getItem("winddown:qa:next-rejected-draft");
      if (raw !== null) {
        sessionStorage.setItem(key, raw);
        sessionStorage.removeItem("winddown:qa:next-rejected-draft");
      }
    }, WINDDOWN_REVIEW_DRAFT_STORAGE_KEY);
    await page.evaluate(raw => sessionStorage.setItem("winddown:qa:next-rejected-draft", raw), conflictingDraft);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-draft-recovery-action="archive"]').click();
    const acknowledgeExport = page.locator('[data-draft-recovery-action="acknowledge-export"]');
    assert.equal(await acknowledgeExport.count(), 0, "clearing requires an explicit export first");
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-draft-recovery-action="download"]').click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    assert(downloadedPath, "rejected draft download must be available");
    assert.equal(readFileSync(downloadedPath, "utf8"), conflictingDraft, "download preserves exact rejected active bytes");
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), WINDDOWN_REVIEW_DRAFT_STORAGE_KEY), conflictingDraft, "export alone must not clear active bytes");
    await assertLayout(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${engine.id}-${viewport.id}-review-recovery.png`), fullPage: true });
    await acknowledgeExport.click();
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY), malformedDraft, "export acknowledgment must retain the older archive");
    await page.getByRole("button", { name: "직접 입력", exact: true }).click();
    await typed.fill("Fresh answer after exported recovery");
    await page.reload({ waitUntil: "domcontentloaded" });
    await typed.waitFor({ state: "visible" });
    assert.equal(await typed.inputValue(), "Fresh answer after exported recovery", "explicit export acknowledgment restores same-tab continuity");

    await page.evaluate(() => sessionStorage.setItem("winddown:qa:review-reset", "1"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    const availableChips = page.locator('[aria-label="고를 단어"] button');
    await availableChips.first().waitFor({ state: "visible", timeout: 20_000 });
    await availableChips.first().click();
    const selected = page.locator('[aria-label="선택한 단어"] button');
    await selected.first().waitFor({ state: "visible", timeout: 20_000 });
    const selectedLabel = await selected.first().textContent();
    assert(selectedLabel?.trim(), "chip partial selection must contain a label");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('[aria-label="선택한 단어"] button').first().waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(
      (await page.locator('[aria-label="선택한 단어"] button').first().textContent())?.trim(),
      selectedLabel?.trim(),
      "chip partial selection must survive reload",
    );

    await page.evaluate(() => sessionStorage.setItem("winddown:qa:review-reset", "1"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("button", { name: "직접 입력", exact: true }).click();
    await page.getByLabel("영어로 직접 입력", { exact: true }).fill("wrong answer");
    await page.getByRole("button", { name: "답 확인하기", exact: true }).click();
    await page.locator('[data-repair-kind="single-card"]').waitFor({ state: "visible", timeout: 20_000 });
    await assertLayout(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${engine.id}-${viewport.id}-review-repair.png`), fullPage: true });
    const repairCard = page.getByRole("button", { name: `${REVIEW_CARDS[0].en} 영어`, exact: true });
    const repairCue = page.getByRole("button", { name: `${REVIEW_CARDS[0].ko} 한국어`, exact: true });
    await repairCard.click();
    await repairCue.click();
    await waitForText(page, "ONE RETRY");
    await page.getByLabel("영어로 다시 입력", { exact: true }).fill(REVIEW_CARDS[0].en);
    await page.getByRole("button", { name: "한 번만 다시 확인하기", exact: true }).click();
    await page.getByRole("button", { name: "같은 기록 다시 저장하기", exact: true }).waitFor({ state: "visible" });
    await page.reload({ waitUntil: "domcontentloaded" });
    const retryCommit = page.getByRole("button", { name: "같은 기록 다시 저장하기", exact: true });
    await retryCommit.waitFor({ state: "visible" });
    assert.equal(diagnostics.reviewCommitPostCount, 1, "reload must not automatically replay a lost acknowledgment");
    await retryCommit.click();
    await waitForText(page, "오늘의 복습을 마쳤어.");
    assert.equal(diagnostics.reviewGradePostCount, 2, "one-card repair must grade first answer and retry once");
    assert.equal(diagnostics.reviewCommitPostCount, 2, "one-card repair must retry only the exact lost-ack operation once");
    await assertLayout(page);
    if (viewport.width === 390 || viewport.width === 820 || viewport.width === 768) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${engine.id}-${viewport.id}-review-continuity.png`), fullPage: true });
    }
    assertContinuityDiagnostics(diagnostics, `${engine.id}/${viewport.id}/review-continuity`);
    return `${engine.id}/${viewport.id}/review-continuity`;
  } catch (error) {
    await captureContinuityFailure(page, `${engine.id}-${viewport.id}-review`, diagnostics, error);
    throw error;
  } finally {
    await page.close();
  }
}

async function runArchiveContinuity(
  context: BrowserContext,
  base: URL,
  engine: Engine,
  viewport: Viewport,
): Promise<string> {
  const page = await context.newPage();
  const diagnostics = attachContinuityDiagnostics(page, engine.id, base);
  await wireContinuityNetwork(page, base, "archive", diagnostics);
  const archive = continuityArchiveFixture();
  try {
    const response = await page.goto(new URL("/winddown/conversations/", base).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert(response && response.status() < 400, `conversations returned HTTP ${response?.status() ?? "no response"}`);
    await waitForText(page, "대화 목록 응답 형식이 올바르지 않습니다.");
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await page.locator("[data-winddown-conversations]").waitFor({ state: "visible", timeout: 20_000 });
    const firstItem = page.locator(`[data-conversation-id="${archive.first.productSessionId}"]`);
    await firstItem.waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-conversation-id]").count(), 1, "archive first page must contain one item");
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await page.locator(`[data-conversation-id="${archive.second.productSessionId}"]`).waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-conversation-id]").count(), 2, "archive pagination must append one item");
    assert.equal(await page.locator("[data-conversation-id]").evaluateAll((nodes) => new Set(nodes.map((node) => node.getAttribute("data-conversation-id"))).size), 2, "archive pagination must preserve unique IDs");
    await firstItem.click();
    const detail = page.locator("[data-conversation-detail]");
    await detail.waitFor({ state: "visible", timeout: 20_000 });
    const practiceLink = page.locator("[data-winddown-practice-link]").first();
    await practiceLink.waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-winddown-correction-item]").count(), 1, "archive detail must show cited correction");
    const href = await practiceLink.getAttribute("href");
    assert(href, "archive correction must expose a practice link");
    const practiceUrl = new URL(href, base);
    assert.equal(practiceUrl.pathname, "/winddown/drill");
    assert.equal(practiceUrl.searchParams.get("conversation"), archive.first.productSessionId);
    assert.equal(practiceUrl.searchParams.get("turn"), "1");
    assert.equal(practiceUrl.searchParams.get("source"), "wd-continuity-conversation-001");
    assert.equal(practiceUrl.searchParams.has("learner"), false, "practice link must carry citation IDs only");
    assert.equal(diagnostics.conversationsListGetCount, 3, "archive malformed-response retry and pagination must use bounded GETs");
    assert.equal(diagnostics.conversationsDetailGetCount, 1, "archive detail must use one exact session query");
    await assertLayout(page);
    if (viewport.width === 390 || viewport.width === 820 || viewport.width === 768) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${engine.id}-${viewport.id}-archive-continuity.png`), fullPage: true });
    }
    assertContinuityDiagnostics(diagnostics, `${engine.id}/${viewport.id}/archive-continuity`);
    return `${engine.id}/${viewport.id}/archive-continuity`;
  } catch (error) {
    await captureContinuityFailure(page, `${engine.id}-${viewport.id}-archive`, diagnostics, error);
    throw error;
  } finally {
    await page.close();
  }
}

async function runPracticeContinuity(
  context: BrowserContext,
  base: URL,
  engine: Engine,
  viewport: Viewport,
): Promise<string> {
  const page = await context.newPage();
  const diagnostics = attachContinuityDiagnostics(page, engine.id, base);
  await wireContinuityNetwork(page, base, "practice", diagnostics);
  const archive = continuityArchiveFixture();
  const expectedCorrection = archive.receipt.report.outcome.corrections[0]?.correctionText;
  assert(expectedCorrection, "synthetic archive fixture must contain one correction");
  await page.addInitScript(() => {
    (window as Window & { __windDownGetUserMediaCalls?: number }).__windDownGetUserMediaCalls = 0;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (...args: Parameters<MediaDevices["getUserMedia"]>) => {
      const target = window as Window & { __windDownGetUserMediaCalls?: number };
      target.__windDownGetUserMediaCalls = (target.__windDownGetUserMediaCalls ?? 0) + 1;
      return original(...args);
    };
  });
  try {
    const response = await page.goto(new URL("/winddown/conversations/", base).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert(response && response.status() < 400, `practice archive returned HTTP ${response?.status() ?? "no response"}`);
    const firstItem = page.locator(`[data-conversation-id="${archive.first.productSessionId}"]`);
    await firstItem.waitFor({ state: "visible", timeout: 20_000 });
    await firstItem.click();
    const correctionLink = page.locator("[data-winddown-practice-link]").first();
    await correctionLink.waitFor({ state: "visible", timeout: 20_000 });
    const expectedCorrectionUrl = new URL(await correctionLink.getAttribute("href") ?? "", base);
    assert.equal(expectedCorrectionUrl.searchParams.get("conversation"), "wd-continuity-session-001");
    assert.equal(expectedCorrectionUrl.searchParams.get("turn"), "1");
    assert.equal(expectedCorrectionUrl.searchParams.get("source"), "wd-continuity-conversation-001");
    await Promise.all([
      page.waitForURL((url) => (url.pathname.replace(/\/+$/, "") || "/") === "/winddown/drill" && url.searchParams.get("conversation") === "wd-continuity-session-001", { timeout: 20_000 }),
      correctionLink.click(),
    ]);
    await page.locator("[data-winddown-practice]").waitFor({ state: "visible", timeout: 20_000 });
    const answer = page.getByLabel("연습 답변", { exact: true });
    await answer.fill("my recalled sentence");
    await page.getByRole("button", { name: "확인", exact: true }).click();
    await page.locator("[data-practice-reveal]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-practice-reveal-text]").count(), 0, "practice must keep the reference hidden until explicit reveal");
    await page.locator("[data-practice-reveal]").click();
    await page.locator("[data-practice-reveal-text]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-practice-reveal-text]").getByText(expectedCorrection, { exact: true }).count(), 1, "voice correction practice must reveal the saved correction exactly");
    await page.getByRole("button", { name: "연습 마치기", exact: true }).click();
    await waitForText(page, "연습을 마쳤어. 자유 연습은 복습 점수에 반영되지 않아.");

    await page.goto(new URL("/winddown/drill/?practice=1", base).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator("[data-winddown-practice]").waitFor({ state: "visible", timeout: 20_000 });
    const themeSelect = page.locator("[data-practice-theme]");
    const materialSelect = page.locator("[data-practice-material]");
    await themeSelect.waitFor({ state: "visible", timeout: 20_000 });
    await themeSelect.selectOption("selftalk-emotion");
    const materialOptions = await materialSelect.locator("option").allTextContents();
    assert.deepEqual(materialOptions, ["나는 준비가 되었어요", "나는 다시 시도할 수 있어요"], "topic filtering must retain only the matching Korean materials");
    for (const englishAnswer of PRACTICE_MATERIALS.map((material) => material.en)) {
      assert(materialOptions.every((option) => !option.includes(englishAnswer)), `generic practice selector must not leak English answer: ${englishAnswer}`);
    }
    await materialSelect.selectOption("synthetic-material-002");
    await page.locator("[data-practice-method]").selectOption("linked-recall-listen-response");
    await page.locator("ol li").first().waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("ol li").count(), 3, "linked practice must expose recall, listening variants, and audio response stages");
    await page.locator('[aria-label="연결 연습 1/3"]').waitFor({ state: "visible", timeout: 20_000 });
    await page.getByLabel("연습 답변", { exact: true }).fill("I am ready.");
    await page.getByRole("button", { name: "확인", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "연습 마치기", exact: true }).count(), 0, "linked practice must not finish before the first reveal");
    await page.locator("[data-practice-reveal]").click();
    await page.locator("[data-practice-reveal-text]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-practice-reveal-text]").getByText("I am ready.", { exact: true }).count(), 1, "canonical practice must reveal the selected material");
    assert.equal(await page.getByRole("button", { name: "연습 마치기", exact: true }).count(), 0, "linked practice must require the remaining stages after the first reveal");
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await page.locator('[aria-label="연결 연습 2/3"]').waitFor({ state: "visible", timeout: 20_000 });
    const listeningHeading = page.locator("p").filter({ hasText: /^다른 표현 듣기$/ });
    await listeningHeading.waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("button", { name: "표현 2", exact: true }).click();
    assert.equal(await page.locator('[aria-label="기기 음성 연습"]').count(), 1, "linked listening stage must expose the audio fallback controls");
    assert.equal(await page.getByRole("button", { name: "연습 마치기", exact: true }).count(), 0, "linked practice must not finish during listening");
    await page.locator("[data-practice-advance]").click();
    await page.locator('[aria-label="연결 연습 3/3"]').waitFor({ state: "visible", timeout: 20_000 });
    await page.locator('[aria-label="기기 음성 연습"]').waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.getByRole("button", { name: "문장 듣기", exact: true }).count(), 1, "linked audio-response stage must expose explicit listening");
    await page.getByLabel("연습 답변", { exact: true }).fill("I am ready.");
    await page.getByRole("button", { name: "확인", exact: true }).click();
    await page.locator("[data-practice-reveal]").click();
    await page.locator("[data-practice-reveal-text]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-practice-reveal-text]").getByText("I am ready.", { exact: true }).count(), 1, "linked audio-response stage must reveal the selected material");
    assert.equal(await page.getByRole("button", { name: "연습 마치기", exact: true }).count(), 1, "linked practice must expose completion only after the final reveal");
    await page.getByRole("button", { name: "연습 마치기", exact: true }).click();
    await waitForText(page, "연습을 마쳤어. 자유 연습은 복습 점수에 반영되지 않아.");

    await page.locator("[data-practice-method]").selectOption("pattern-transform");
    await page.locator("[data-practice-pattern]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-practice-pattern]").getByText(PRACTICE_PATTERN, { exact: true }).count(), 1, "pattern practice must show the authored pattern exactly");
    await page.getByLabel("연습 답변", { exact: true }).fill("I can begin calmly.");
    await page.getByRole("button", { name: "확인", exact: true }).click();
    assert.equal(await page.locator("[data-practice-reveal-text]").count(), 0, "pattern practice must keep the authored pattern hidden until explicit reveal");
    await page.locator("[data-practice-reveal]").click();
    await page.locator("[data-practice-reveal-text]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator("[data-practice-reveal-text]").getByText(PRACTICE_PATTERN, { exact: true }).count(), 1, "pattern practice must reveal the authored pattern exactly");
    await page.getByRole("button", { name: "연습 마치기", exact: true }).click();
    await waitForText(page, "연습을 마쳤어. 자유 연습은 복습 점수에 반영되지 않아.");
    assert.equal(diagnostics.practiceGetCount, 2, "practice continuity must fetch correction and generic targets exactly once");
    assert.equal(diagnostics.conversationsListGetCount, 1, "practice continuity must load the archive list exactly once");
    assert.equal(diagnostics.conversationsDetailGetCount, 1, "practice continuity must load the cited archive detail exactly once");
    assert.equal(diagnostics.blockedRequests.filter((request) => /\/api\/winddown\/(?:progress|xp)(?:[/?]|$)/.test(request)).length, 0, "practice must not POST learner progress or XP");
    assert.equal(diagnostics.voiceSessionPostCount, 0, "practice must not open a voice session automatically");
    assert.equal(diagnostics.voiceReportPostCount, 0, "practice must not upload a voice report");
    assert.equal(await page.evaluate(() => (window as Window & { __windDownGetUserMediaCalls?: number }).__windDownGetUserMediaCalls ?? 0), 0, "practice must not request microphone access automatically");
    await assertLayout(page);
    if (viewport.width === 390 || viewport.width === 820 || viewport.width === 768) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${engine.id}-${viewport.id}-practice-continuity.png`), fullPage: true });
    }
    assertContinuityDiagnostics(diagnostics, `${engine.id}/${viewport.id}/practice-continuity`);
    return `${engine.id}/${viewport.id}/practice-continuity`;
  } catch (error) {
    await captureContinuityFailure(page, `${engine.id}-${viewport.id}-practice`, diagnostics, error);
    throw error;
  } finally {
    await page.close();
  }
}

async function runVoiceContinuity(
  context: BrowserContext,
  base: URL,
  engine: Engine,
  viewport: Viewport,
): Promise<string> {
  const fixture = continuityVoiceFixture();
  const diagnostics: ContinuityDiagnostics[] = [];
  const outboxPage = await context.newPage();
  const outboxDiagnostics = attachContinuityDiagnostics(outboxPage, engine.id, base);
  diagnostics.push(outboxDiagnostics);
  await wireContinuityNetwork(outboxPage, base, "voice", outboxDiagnostics);
  await outboxPage.addInitScript(({ key, outbox, marker }) => {
    if (sessionStorage.getItem(marker) !== "seeded") {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(key, JSON.stringify(outbox));
      sessionStorage.setItem(marker, "seeded");
    }
    (window as Window & { __windDownGetUserMediaCalls?: number }).__windDownGetUserMediaCalls = 0;
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices) {
      const original = mediaDevices.getUserMedia.bind(mediaDevices);
      mediaDevices.getUserMedia = async (...args: Parameters<MediaDevices["getUserMedia"]>) => {
        const target = window as Window & { __windDownGetUserMediaCalls?: number };
        target.__windDownGetUserMediaCalls = (target.__windDownGetUserMediaCalls ?? 0) + 1;
        return original(...args);
      };
    }
  }, { key: WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY, outbox: fixture.outbox, marker: "winddown:qa:outbox-seeded" });
  try {
    const response = await outboxPage.goto(new URL("/winddown/roleplay/", base).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert(response && response.status() < 400, `roleplay outbox returned HTTP ${response?.status() ?? "no response"}`);
    await outboxPage.locator("[data-winddown-voice-recovery]").waitFor({ state: "visible", timeout: 20_000 });
    await outboxPage.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await outboxPage.locator("[data-winddown-voice-recovery]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await outboxPage.getByRole("button", { name: "같은 보고서 다시 저장", exact: true }).count(), 1);
    assert.equal(await outboxPage.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.report?.stoppedAtIso, WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY), fixture.report.stoppedAtIso, "outbox reload must preserve stoppedAt");
    assert.equal(await outboxPage.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.finalDigest, WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY), fixture.finalDigest, "outbox reload must preserve final digest");
    assert.equal(outboxDiagnostics.voiceReportPostCount, 0, "report upload must wait for the explicit retry action");
    assert.equal(await outboxPage.evaluate(() => (window as Window & { __windDownGetUserMediaCalls?: number }).__windDownGetUserMediaCalls ?? 0), 0, "outbox restore must require manual interaction before microphone access");
    const retry = outboxPage.locator("[data-winddown-voice-recovery]").getByRole("button", { name: "같은 보고서 다시 저장", exact: true });
    const failedReportResponse = outboxPage.waitForResponse((candidate) => apiPath(candidate.url()) === "/api/winddown/live/report" && candidate.status() === 503, { timeout: 20_000 });
    await retry.click();
    await failedReportResponse;
    await outboxPage.locator("[data-winddown-voice-recovery]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(outboxDiagnostics.voiceReportPostCount, 1, "first report POST must occur only after retry");
    assert.equal(outboxDiagnostics.voiceReportBodies[0], JSON.stringify(fixture.report), "first report POST must transmit the frozen report body");
    assert.equal(await outboxPage.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.report?.stoppedAtIso, WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY), fixture.report.stoppedAtIso, "failed upload must preserve outbox stoppedAt");
    assert.equal(await outboxPage.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.finalDigest, WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY), fixture.finalDigest, "failed upload must preserve outbox digest");
    assert.equal(await outboxPage.evaluate((key) => localStorage.getItem(key), WIND_DOWN_VOICE_FROZEN_STORAGE_KEY), JSON.stringify(fixture.report), "failed upload must preserve the frozen report");
    const successfulReportResponse = outboxPage.waitForResponse((candidate) => apiPath(candidate.url()) === "/api/winddown/live/report" && candidate.status() === 200, { timeout: 20_000 });
    await retry.click();
    const successfulReport = await successfulReportResponse;
    const successfulPayload = await successfulReport.json() as {
      duplicate?: unknown;
      habitCredited?: unknown;
      receipt?: { productSessionId?: unknown; finalDigest?: unknown; report?: unknown };
    };
    assert.equal(successfulPayload.duplicate, false, "successful retry must report a non-duplicate acknowledgment");
    assert.equal(successfulPayload.habitCredited, false, "synthetic retry must not credit a habit");
    assert.equal(successfulPayload.receipt?.productSessionId, fixture.report.productSessionId, "successful receipt must identify the frozen session");
    assert.equal(successfulPayload.receipt?.finalDigest, fixture.finalDigest, "successful receipt must acknowledge the frozen digest");
    assert.deepEqual(successfulPayload.receipt?.report, fixture.report, "successful receipt must return the frozen report");
    await waitForText(outboxPage, /대화는 저장됐지만 오늘 말하기는 아직 0\/1이야\./);
    assert.equal(outboxDiagnostics.voiceReportPostCount, 2, "second report POST must require a second explicit retry");
    assert.equal(outboxDiagnostics.voiceReportBodies[1], outboxDiagnostics.voiceReportBodies[0], "retry must transmit the exact same report body");
    assert.equal(await outboxPage.evaluate((key) => localStorage.getItem(key), WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY), null, "matching acknowledgment must clear the active outbox");
    assert.equal(await outboxPage.evaluate((key) => localStorage.getItem(key), WIND_DOWN_VOICE_FROZEN_STORAGE_KEY), null, "matching acknowledgment must clear the active frozen report");
    assert.equal(await outboxPage.evaluate(() => (window as Window & { __windDownGetUserMediaCalls?: number }).__windDownGetUserMediaCalls ?? 0), 0, "report retry must not request microphone access");
    await assertLayout(outboxPage);
  } catch (error) {
    await captureContinuityFailure(outboxPage, `${engine.id}-${viewport.id}-voice-outbox`, outboxDiagnostics, error);
    throw error;
  } finally {
    await outboxPage.close();
  }

  const checkpointPage = await context.newPage();
  const checkpointDiagnostics = attachContinuityDiagnostics(checkpointPage, engine.id, base);
  diagnostics.push(checkpointDiagnostics);
  await wireContinuityNetwork(checkpointPage, base, "voice", checkpointDiagnostics);
  await checkpointPage.addInitScript(({ key, checkpoint, marker }) => {
    if (sessionStorage.getItem(marker) !== "seeded") {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(key, JSON.stringify(checkpoint));
      sessionStorage.setItem(marker, "seeded");
    }
    (window as Window & { __windDownGetUserMediaCalls?: number }).__windDownGetUserMediaCalls = 0;
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices) {
      const original = mediaDevices.getUserMedia.bind(mediaDevices);
      mediaDevices.getUserMedia = async (...args: Parameters<MediaDevices["getUserMedia"]>) => {
        const target = window as Window & { __windDownGetUserMediaCalls?: number };
        target.__windDownGetUserMediaCalls = (target.__windDownGetUserMediaCalls ?? 0) + 1;
        return original(...args);
      };
    }
  }, { key: WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY, checkpoint: fixture.checkpoint, marker: "winddown:qa:checkpoint-seeded" });
  try {
    const response = await checkpointPage.goto(new URL("/winddown/roleplay/", base).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert(response && response.status() < 400, `roleplay checkpoint returned HTTP ${response?.status() ?? "no response"}`);
    await checkpointPage.locator("[data-winddown-voice-recovery]").waitFor({ state: "visible", timeout: 20_000 });
    await checkpointPage.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await checkpointPage.locator("[data-winddown-voice-recovery]").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await checkpointPage.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.checkpointAtIso, WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY), fixture.checkpoint.checkpointAtIso, "checkpoint reload must preserve checkpoint bytes");
    assert.equal(await checkpointPage.locator("[data-winddown-voice-recovery]").getByRole("button", { name: "같은 보고서 다시 저장", exact: true }).count(), 1, "checkpoint-only restore must expose the manual retry recovery action");
    assert.equal(await checkpointPage.evaluate(() => (window as Window & { __windDownGetUserMediaCalls?: number }).__windDownGetUserMediaCalls ?? 0), 0, "checkpoint reload must require manual interaction before microphone access");
    assert.equal(checkpointDiagnostics.voiceSessionPostCount, 0, "checkpoint restore must not open a voice session automatically");
    assert.equal(checkpointDiagnostics.voiceReportPostCount, 0, "checkpoint restore must not upload a report automatically");
    await assertLayout(checkpointPage);
  } catch (error) {
    await captureContinuityFailure(checkpointPage, `${engine.id}-${viewport.id}-voice-checkpoint`, checkpointDiagnostics, error);
    throw error;
  } finally {
    await checkpointPage.close();
  }
  for (const item of diagnostics) assertContinuityDiagnostics(item, `${engine.id}/${viewport.id}/voice-continuity`);
  assert.equal(diagnostics.reduce((sum, item) => sum + item.voiceSessionPostCount, 0), 0, "voice reload must not auto-open a session");
  assert.equal(outboxDiagnostics.voiceReportPostCount, 2, "voice report uploads must be limited to the two explicit retry actions");
  return `${engine.id}/${viewport.id}/voice-continuity`;
}

async function runContinuityContext(
  browser: Browser,
  base: URL,
  sessionCookie: string,
  engine: Engine,
  viewport: Viewport,
) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.isMobile ? 2 : 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.addCookies([{
    name: "fenok_admin_session",
    value: sessionCookie,
    domain: base.hostname,
    path: "/",
    secure: base.protocol === "https:",
    sameSite: "Lax",
  }]);
  try {
    const results: string[] = [];
    const failures: string[] = [];
    for (const run of [runReviewContinuity, runArchiveContinuity, runPracticeContinuity, runVoiceContinuity]) {
      try {
        const result = await run(context, base, engine, viewport);
        results.push(result);
        console.log(`PASS ${result}`);
      } catch (error) {
        failures.push(`${engine.id}/${viewport.id}/${run.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { results, failures };
  } finally {
    await context.close();
  }
}

async function main() {
  const base = new URL(BASE_URL);
  assertWindDownQaTarget(BASE_URL, process.env.WINDDOWN_QA_ISOLATED);
  assert.equal(base.protocol, "http:", "hosted QA must use loopback HTTP");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "hosted QA must target loopback");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const fixture = makeFixture();
  const sessionCookie = await login(base);
  const results: string[] = [];
  if (process.env.WINDDOWN_QA_SCOPE === "continuity") {
    const failures: string[] = [];
    for (const engine of ENGINES) {
      const browser = await engine.type.launch({ headless: true });
      try {
        for (const viewport of CONTINUITY_VIEWPORTS[engine.id]) {
          const cases = await runContinuityContext(browser, base, sessionCookie, engine, viewport);
          results.push(...cases.results);
          failures.push(...cases.failures);
        }
      } finally {
        await browser.close();
      }
    }
    assert.equal(failures.length, 0, `continuity failures: ${JSON.stringify(failures)}`);
    assert.equal(results.length, 20);
    console.log(`PASS winddown-continuity-browser - ${results.length} focused synthetic Chromium/WebKit cases`);
    return;
  }
  for (const engine of ENGINES) {
    const browser = await engine.type.launch({ headless: true });
    try {
      for (const viewport of VIEWPORTS) {
        for (const scenario of ["resume", "shortage", "malformed-resume", "records"] as const) {
          results.push(await runScenario(browser, base, sessionCookie, engine, viewport, scenario, fixture));
          console.log(`PASS ${results.at(-1)}`);
        }
      }
    } finally {
      await browser.close();
    }
  }
  assert.equal(results.length, ENGINES.length * VIEWPORTS.length * 4);
  console.log(`PASS winddown-preservation-browser - ${results.length} synthetic Chromium/WebKit viewport cases`);
}

void main().catch((error) => {
  console.error(`FAIL winddown-preservation-browser - ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
