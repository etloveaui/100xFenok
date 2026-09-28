import { createWindDownCoachFeedback, verifyWindDownCoachFeedbacks } from "../src/features/winddown/server/coachFeedbackProof";
import { buildWindDownVoiceReport } from "../src/features/winddown/voice/report";
import { extractWindDownVoicePracticeSeeds, type WindDownVoicePracticeSeed } from "../src/features/winddown/voice/practiceSeed";
import type { WindDownVoiceReportReceipt } from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, webkit, type Page } from "playwright";
import { createWindDownVoiceSession } from "../src/features/winddown/server/voiceSession";
import { assertWindDownQaTarget } from "./winddown-qa-target.mjs";

const base = assertWindDownQaTarget(process.env.QA_BASE_URL, process.env.WINDDOWN_QA_ISOLATED);
const output = process.env.QA_SCREENSHOT_DIR ?? "test-results/winddown-preservation";

async function installMedia(page: Page) {
  await page.addInitScript({ content: String.raw`(() => {
    const state = { sockets: [], sent: [], starts: 0, stops: 0, micRequests: 0 };
    class FakeSocket {
      static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
      readyState = 0; binaryType = "";
      onopen = null;
      onmessage = null;
      onclose = null;
      constructor() {
        state.sockets.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
      }
      send(raw) {
        const value = JSON.parse(raw); state.sent.push(value);
        if (value.setup) setTimeout(() => this.emit({ setupComplete: {} }), 0);
      }
      emit(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
      close(code = 1000, reason = "") { this.readyState = 3; this.onclose?.({ code, reason }); }
    }
    const node = () => ({ connect() {}, disconnect() {}, gain: { value: 0 }, onaudioprocess: null });
    class FakeAudioContext {
      state = "running"; sampleRate = 24000; currentTime = 0; destination = node();
      async resume() {} async close() { this.state = "closed"; }
      createGain() { return node(); } createMediaStreamSource() { return node(); }
      createScriptProcessor() { return node(); }
      createBuffer(_channels, length, rate) {
        return { length, duration: length / rate, getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        return { ...node(), buffer: null, onended: null,
          start() { if ((this.buffer?.length ?? 0) > 1) state.starts++; },
          stop() { state.stops++; },
        };
      }
    }
    Object.defineProperty(window, "WebSocket", { value: FakeSocket });
    Object.defineProperty(window, "AudioContext", { value: FakeAudioContext });
    const track = { enabled: true, stop() {} };
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => {
      state.micRequests++; return { getTracks: () => [track], getAudioTracks: () => [track] };
    } } });
    Object.assign(window, { __coachQA: state });
  })();` });
}

async function emit(page: Page, value: unknown, socketIndex = -1) {
  await page.evaluate(({ value, socketIndex }) => {
    const state = (window as unknown as { __coachQA: { sockets: { emit: (value: unknown) => void }[] } }).__coachQA;
    state.sockets.at(socketIndex)?.emit(value);
  }, { value, socketIndex });
}
async function state(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __coachQA: { sent: Record<string, unknown>[]; starts: number; stops: number; sockets: unknown[]; micRequests: number } }).__coachQA;
    return { sent: s.sent, starts: s.starts, stops: s.stops, sockets: s.sockets.length, micRequests: s.micRequests };
  });
}
async function until(check: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
}

async function verifyPracticeAndLearn(page: Page, name: string, seed: WindDownVoicePracticeSeed) {
  const material = { id: "practice-synthetic", en: "I used to read books.", ko: "책을 읽곤 했어", acceptedVariants: [], practice: { pattern: "I used to + verb", theme: "daily", variationsEn: ["I used to walk to school."] } };
  await page.unroute("**/api/winddown/**");
  await page.route("**/api/winddown/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.replace(/\/$/, "") === "/api/winddown/drill") {
      if (url.searchParams.has("conversation")) {
        assert.equal(url.searchParams.get("conversation"), seed.citation.conversation);
        assert.equal(url.searchParams.get("source"), seed.citation.source);
        assert.equal(url.searchParams.get("turn"), String(seed.citation.turn));
        const citation = { productSessionId: seed.citation.conversation, sourceConversationId: seed.citation.source, turnSeq: seed.citation.turn };
        return route.fulfill({ json: { ok: true, schemaVersion: 1, mode: "practice", modelOpened: false, material: { source: "published-lkg", publicationStatus: "active", contentDigest: "a".repeat(64) }, materials: [material], target: { kind: "voice-correction", citation }, voiceCorrection: { citation, learnerText: seed.learnerText, modelCorrection: seed.modelCorrection } } });
      }
      return route.fulfill({ json: { ok: true, schemaVersion: 1, mode: "practice", modelOpened: false, material: { source: "published-lkg", publicationStatus: "active", contentDigest: "a".repeat(64) }, materials: [material], target: { kind: "generic" } } });
    }
    if (url.pathname.replace(/\/$/, "") === "/api/winddown/study") {
      const cards = Array.from({ length: 5 }, (_, i) => ({ id: `synthetic-learn-${i}`, en: ["I want to eat.", "I want to rest.", "I want to walk.", "I want to read.", "I want to sing."][i], ko: ["먹고 싶어", "쉬고 싶어", "걷고 싶어", "읽고 싶어", "노래하고 싶어"][i] }));
      const manifest = { schemaVersion: 1, sessionId: "synthetic-learn-session", habitKstDay: new Date().toISOString().slice(0, 10), seed: "synthetic-learn", cardIds: cards.map(card => card.id), contentDigest: "a".repeat(64), issuedAtIso: new Date().toISOString(), expiresAtIso: new Date(Date.now() + 600_000).toISOString() };
      return route.fulfill({ json: { schemaVersion: 1, mode: "learn", modelOpened: false, cards, inventory: { selectedCount: 5, insufficientFreshCount: 0 }, selectionBasis: "review-patterns", material: { source: "published-lkg", publicationStatus: "active", contentDigest: "a".repeat(64) }, learnSession: { manifest, proof: "synthetic-proof", resumeState: null } } });
    }
    throw new Error(`unexpected learner request ${url.pathname}`);
  });
  await page.getByRole("link", { name: /이어서 연습하기/ }).click();
  await page.getByRole("textbox", { name: "연습 답변" }).fill("I went home");
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await page.locator("[data-practice-reveal]").click();
  await page.locator("[data-practice-reveal-text]").getByText("I went home", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/${name}-correction-practice.png`, fullPage: true });
  await page.goto(`${base.origin}/winddown/drill?practice=1`);
  await page.locator('[data-practice-method]').selectOption("pattern-transform");
  await page.getByRole("textbox", { name: "연습 답변" }).fill("asdf qwer");
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await page.locator("[data-pattern-feedback]").filter({ hasText: "뜻이 있는 영어 문장" }).waitFor();
  await page.locator("[data-pattern-retry]").click();
  await page.getByRole("textbox", { name: "연습 답변" }).fill("I used to walk to school.");
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await page.locator("[data-pattern-feedback]").filter({ hasText: "작성된 예시와 같은 표현" }).waitFor();
  await page.screenshot({ path: `${output}/${name}-pattern-feedback.png`, fullPage: true });
  await page.goto(`${base.origin}/winddown/learn/`);
  await page.locator("[data-learning-selection]").filter({ hasText: "복습에서 어려웠던 문형" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: `${output}/${name}-learning-selection.png`, fullPage: true });
  console.log(`PASS ${name}: grounded correction -> report retry -> practice link, pattern feedback/retry, learning selection explanation`);
}

async function main() {
  const login = await fetch(new URL("/api/admin/session/", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.WINDDOWN_QA_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().join(";").match(/fenok_admin_session=([^;]+)/)?.[1];
  assert.ok(cookie);
  mkdirSync(output, { recursive: true });
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await context.addCookies([{ name: "fenok_admin_session", value: cookie, domain: base.hostname, path: "/", sameSite: "Lax" }]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await installMedia(page);
      const requests: Record<string, unknown>[] = [];
      const reports: Record<string, unknown>[] = [];
      const release: { current?: () => void } = {};
      let held = false;
      let rateLimited = false;
      let correctionMode = false;
      let savedReceipt: WindDownVoiceReportReceipt | null = null;
      await page.route("**/api/winddown/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (pathname === "/api/winddown/live/session/") {
          const session = await createWindDownVoiceSession(route.request().postDataJSON(), {
            coachEnabled: true, getApiKey: () => "synthetic-gemini-key",
            fetch: async () => new Response(JSON.stringify({ name: "auth_tokens/synthetic" })),
          });
          return reply(session);
        }
        if (pathname === "/api/winddown/live/coach/") {
          requests.push(route.request().postDataJSON());
          if (held) await new Promise<void>(resolve => { release.current = resolve; });
          const decision = correctionMode
            ? { action: "answer" as const, spokenResponse: "You can say I went home.", correction: { was: "I goed home", now: "I went home", why: "go의 과거형은 went야." } }
            : { action: "answer" as const, spokenResponse: "Let's talk about travel.", correction: null };
          const input = route.request().postDataJSON();
          const feedback = await createWindDownCoachFeedback({ ...input, decision });
          return reply(rateLimited ? { error: "COACH_RATE_LIMITED" } : { decision, ...(feedback ? { feedback } : {}) }, rateLimited ? 429 : 200).catch(() => undefined);
        }
        if (pathname === "/api/winddown/live/report/") {
          reports.push(route.request().postDataJSON());
          // First save fails, then the exact same frozen payload succeeds, without learner IO.
          if (reports.length === 1) return reply({ error: "SYNTHETIC_STORAGE_UNAVAILABLE" }, 503);
          const report = buildWindDownVoiceReport(route.request().postDataJSON());
          assert.ok(await verifyWindDownCoachFeedbacks(report));
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(report)));
          savedReceipt = { schemaVersion: 1, productSessionId: report.productSessionId, activity: report.activity, report, journeyTargets: [], committedAtIso: new Date().toISOString(), finalDigest: Buffer.from(digest).toString("hex") };
          return reply({ ok: true, duplicate: false, habitCredited: false, receipt: savedReceipt });
        }
        return reply({ error: "SYNTHETIC_UNSUPPORTED" }, 503);
      });
      await page.goto(new URL("/winddown/live-talk/", base).href);
      await page.getByRole("button", { name: "대화 시작하기", exact: true }).click();
      await until(async () => (await state(page)).sent.some(item => !!item.realtimeInput), "initial greeting missing");
      const initial = await state(page);
      assert.equal(initial.micRequests, 1);
      assert.equal(((initial.sent.find(item => item.setup)?.setup as Record<string, unknown>).realtimeInputConfig as Record<string, unknown>).activityHandling, "START_OF_ACTIVITY_INTERRUPTS");
      const audio = { modelTurn: { parts: [{ inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }] } };
      await emit(page, { serverContent: { ...audio, outputTranscription: { text: "How was your day?" } } });
      await until(async () => (await state(page)).starts === 1, "actual output hook did not queue audio");
      await emit(page, { serverContent: { interrupted: true } });
      await emit(page, { serverContent: audio });
      await until(async () => (await state(page)).stops === 1, "interruption did not stop queued audio");
      assert.equal((await state(page)).starts, 1, "cancelled-turn audio may not be queued");
      await emit(page, { serverContent: { turnComplete: true } });

      held = true;
      const tool = (id: string, learnerText = "I want to travel.") => ({ toolCall: { functionCalls: [{ id, name: "consult_teacher", args: { learnerText } }] } });
      await emit(page, { serverContent: { inputTranscription: { text: "I want to travel." } } });
      await emit(page, tool("cancel-me"));
      await until(async () => requests.length === 1, "teacher was not called by actual UI");
      await emit(page, tool("cancel-me"));
      await emit(page, { toolCallCancellation: { ids: ["cancel-me"] }, serverContent: { interrupted: true, turnComplete: true } });
      const before = (await state(page)).sent.filter(item => item.toolResponse).length;
      release.current?.(); held = false;
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(requests.length, 1, "duplicate spent a second request");
      assert.equal((await state(page)).sent.filter(item => item.toolResponse).length, before, "late cancelled response escaped");

      await emit(page, { serverContent: { inputTranscription: { text: "I want to travel." } }, ...tool("speak-now") });
      await until(async () => (await state(page)).sent.filter(item => item.toolResponse).length === before + 1, "valid teacher response missing");
      assert.equal(requests.at(-1)?.learnerText, "I want to travel.");
      assert.ok(Array.isArray(requests.at(-1)?.history));
      await emit(page, { serverContent: { ...audio, outputTranscription: { text: "Let's talk about travel." }, turnComplete: true } });
      await until(async () => (await state(page)).starts === 2, "new turn audio was still muted");

      // Pending work must be cancelled on replacement, and old socket events ignored.
      held = true;
      await emit(page, tool("old-socket"));
      await until(async () => requests.length === 3, "pending resume case not reached");
      await emit(page, { sessionResumptionUpdate: { resumable: true, newHandle: "synthetic-resume-handle" } });
      await emit(page, { goAway: { timeLeft: "0s" } });
      await until(async () => (await state(page)).sockets === 2, "resume socket missing");
      release.current?.(); held = false;
      await emit(page, tool("late-old-event"), 0);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(requests.length, 3);
      assert.equal((await state(page)).sent.filter(item => item.toolResponse).length, before + 1);
      assert.equal((await state(page)).sent.filter(item => !!(item.realtimeInput as { text?: unknown } | undefined)?.text).length, 1, "resume restarted the greeting");

      correctionMode = true;
      await emit(page, { serverContent: { inputTranscription: { text: "I goed home." } }, ...tool("grounded-correction", "I goed home.") });
      await until(async () => (await state(page)).sent.filter(item => item.toolResponse).length === before + 2, "grounded correction response missing");
      await emit(page, { serverContent: { ...audio, outputTranscription: { text: "You can say I went home." }, turnComplete: true } });

      rateLimited = true;
      await emit(page, tool("quota"));
      await page.getByRole("status").filter({ hasText: "사용 한도" }).waitFor();
      assert.equal(requests.length, 5, "quota failure retried");
      await page.screenshot({ path: `${output}/${name}-coach-interruption.png`, fullPage: true });
      held = true; rateLimited = false;
      await emit(page, { serverContent: { inputTranscription: { text: "I goed home." } }, ...tool("stop-pending", "I goed home.") });
      await until(async () => requests.length === 6, "pending stop case not reached");
      const beforeStop = (await state(page)).sent.filter(item => item.toolResponse).length;
      await page.getByRole("button", { name: "대화 마치고 정리하기", exact: true }).click();
      release.current?.(); held = false;
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal((await state(page)).sent.filter(item => item.toolResponse).length, beforeStop, "a response spoke after the learner ended the session");
      await until(async () => reports.length === 1, "finalized report was lost");
      assert.ok(JSON.stringify(reports[0]).includes("Let's talk about travel."), "actual confirmed speech must remain in the report");
      await page.getByRole("button", { name: "같은 보고서 다시 저장", exact: true }).click();
      await until(async () => reports.length === 2, "frozen correction report could not retry");
      assert.deepEqual(reports[0], reports[1], "retry changed correction evidence");
      await page.getByText("다시 연습할 표현", { exact: true }).waitFor();
      assert.ok(savedReceipt);
      const seeds = extractWindDownVoicePracticeSeeds(savedReceipt);
      assert.equal(seeds.length, 1, "cancelled pending correction must not create another practice target");
      assert.equal(seeds[0].modelCorrection, "I went home");
      await page.getByRole("link", { name: /이어서 연습하기/ }).waitFor();
      await page.screenshot({ path: `${output}/${name}-grounded-correction.png`, fullPage: true });
      await verifyPracticeAndLearn(page, name, seeds[0]);
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}: actual transport audio flush, tool cancellation, duplicate, combined event, resume, quota, report preservation`);
    } finally { await browser.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
