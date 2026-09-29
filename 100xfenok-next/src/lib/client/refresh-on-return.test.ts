import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshOnReturn } from "./refresh-on-return";

test("return events coalesce and hidden tabs perform no refresh", async () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  let calls = 0;
  const dispose = refreshOnReturn(() => { calls += 1; }, win, doc);
  win.dispatchEvent(new Event("online"));
  await Promise.resolve();
  assert.equal(calls, 0);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  win.dispatchEvent(new Event("focus"));
  win.dispatchEvent(new Event("pageshow"));
  await Promise.resolve();
  assert.equal(calls, 1);
  win.dispatchEvent(new Event("online"));
  await Promise.resolve();
  assert.equal(calls, 2);
  dispose();
});

test("cleanup cancels a queued refresh and removes all event listeners", async () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let calls = 0;
  const dispose = refreshOnReturn(() => { calls += 1; }, win, doc);
  win.dispatchEvent(new Event("focus"));
  dispose();
  await Promise.resolve();
  for (const event of ["focus", "pageshow", "online"]) win.dispatchEvent(new Event(event));
  doc.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  assert.equal(calls, 0);
});
