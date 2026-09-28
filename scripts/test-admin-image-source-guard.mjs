#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isProtectedAdminImageRequest } from "../100xfenok-next/scripts/admin-image-source-guard.mjs";

const origin = "https://100xfenok.example";
function imageRequest(source, pathname = "/_next/image") {
  const url = new URL(pathname, origin);
  url.searchParams.set("url", source);
  url.searchParams.set("w", "640");
  url.searchParams.set("q", "75");
  return url;
}

for (const source of [
  "/admin/design-lab/screenshots/figma-profile-avatar.jpg",
  "/%61dmin/design-lab/screenshots/figma-profile-avatar.jpg",
  "/admin%2Fdesign-lab%2Fscreenshots%2Ffigma-profile-avatar.jpg",
  "/admin//design-lab/screenshots/figma-profile-avatar.jpg",
  "/\\foreign.invalid/admin/design-lab/screenshots/figma-profile-avatar.jpg",
  "/public/../admin/design-lab/screenshots/figma-profile-avatar.jpg",
  "/public%2F..%2Fadmin/design-lab/screenshots/figma-profile-avatar.jpg",
  "https://100xfenok.example/admin/design-lab/screenshots/figma-profile-avatar.jpg",
]) {
  assert.equal(isProtectedAdminImageRequest(imageRequest(source)), true, `admin optimizer source denied: ${source}`);
}
assert.equal(isProtectedAdminImageRequest(imageRequest("/admin%2Fscreenshot.jpg", "/_next/image/")), true);
for (const source of [
  "/pwa-icon-192-v6.png",
  "/ib/ib-helper/index.html",
  "https://example.org/admin/screenshot.jpg",
]) {
  assert.equal(isProtectedAdminImageRequest(imageRequest(source)), false, `public or remote optimizer source preserved: ${source}`);
}
assert.equal(isProtectedAdminImageRequest(imageRequest("/admin/screenshot.jpg", "/other")), false);

const duplicate = imageRequest("/pwa-icon-192-v6.png");
duplicate.searchParams.append("url", "/admin/screenshot.jpg");
assert.equal(isProtectedAdminImageRequest(duplicate), true, "ambiguous sources fail closed when any local source is admin");

const workerSource = readFileSync(new URL("../100xfenok-next/worker.ts", import.meta.url), "utf8");
const guardAt = workerSource.indexOf("if (isProtectedAdminImageRequest(url))");
const handlerAt = workerSource.indexOf("return handler.fetch(request, env, ctx)");
assert.ok(guardAt > 0 && handlerAt > guardAt, "the admin image guard runs before OpenNext's image handler");
assert.match(workerSource.slice(guardAt, handlerAt), /status: 403,[\s\S]*?"cache-control": "no-store"/u);

console.log("admin image source guard: ok");
