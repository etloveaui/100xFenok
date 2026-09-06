import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { applyWindDownLearnAction, createWindDownLearnSession, type WindDownLearnAction, type WindDownLearnCard, type WindDownLearnState } from "../src/features/winddown/learn/engine";
import { assertWindDownQaTarget } from "./winddown-qa-target.mjs";

type Scenario = "resume" | "shortage" | "malformed-resume" | "records";
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

async function main() {
  const base = new URL(BASE_URL);
  assertWindDownQaTarget(BASE_URL, process.env.WINDDOWN_QA_ISOLATED);
  assert.equal(base.protocol, "http:", "hosted QA must use loopback HTTP");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "hosted QA must target loopback");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const fixture = makeFixture();
  const sessionCookie = await login(base);
  const results: string[] = [];
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
  console.error(`FAIL winddown-preservation-browser - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
