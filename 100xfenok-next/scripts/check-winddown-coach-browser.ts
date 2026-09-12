import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, webkit, type Page } from "playwright";
import { createWindDownVoiceSession } from "../src/features/winddown/server/voiceSession";
import { assertWindDownQaTarget } from "./winddown-qa-target.mjs";

const base = assertWindDownQaTarget(process.env.QA_BASE_URL, process.env.WINDDOWN_QA_ISOLATED);
const output = process.env.QA_SCREENSHOT_DIR ?? "test-results/winddown-preservation";

async function installMedia(page: Page) {
  await page.addInitScript(() => {
    const state = { sockets: [] as FakeSocket[], sent: [] as Record<string, unknown>[], starts: 0, stops: 0, micRequests: 0 };
    class FakeSocket {
      static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
      readyState = 0; binaryType = "";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      constructor() {
        state.sockets.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
      }
      send(raw: string) {
        const value = JSON.parse(raw); state.sent.push(value);
        if (value.setup) setTimeout(() => this.emit({ setupComplete: {} }), 0);
      }
      emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
      close(code = 1000, reason = "") { this.readyState = 3; this.onclose?.({ code, reason }); }
    }
    const node = () => ({ connect() {}, disconnect() {}, gain: { value: 0 }, onaudioprocess: null });
    class FakeAudioContext {
      state = "running"; sampleRate = 24000; currentTime = 0; destination = node();
      async resume() {} async close() { this.state = "closed"; }
      createGain() { return node(); } createMediaStreamSource() { return node(); }
      createScriptProcessor() { return node(); }
      createBuffer(_channels: number, length: number, rate: number) {
        return { length, duration: length / rate, getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        return { ...node(), buffer: null as { length: number } | null, onended: null,
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
  });
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
          return reply(rateLimited ? { error: "COACH_RATE_LIMITED" } : { decision: { action: "answer", spokenResponse: "Let's talk about travel.", correction: null } }, rateLimited ? 429 : 200).catch(() => undefined);
        }
        if (pathname === "/api/winddown/live/report/") {
          reports.push(route.request().postDataJSON());
          // Keep the real client recovery path exercised; never write learner storage.
          return reply({ error: "SYNTHETIC_STORAGE_UNAVAILABLE" }, 503);
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
      const tool = (id: string) => ({ toolCall: { functionCalls: [{ id, name: "consult_teacher", args: { learnerText: "I want to travel." } }] } });
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

      rateLimited = true;
      await emit(page, tool("quota"));
      await page.getByRole("status").filter({ hasText: "사용량" }).waitFor();
      assert.equal(requests.length, 4, "quota failure retried");
      await page.screenshot({ path: `${output}/${name}-coach-interruption.png`, fullPage: true });
      await page.getByRole("button", { name: "대화 마치고 정리하기", exact: true }).click();
      await until(async () => reports.length === 1, "finalized report was lost");
      assert.ok(JSON.stringify(reports[0]).includes("Let's talk about travel."), "actual confirmed speech must remain in the report");
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}: actual transport audio flush, tool cancellation, duplicate, combined event, resume, quota, report preservation`);
    } finally { await browser.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
