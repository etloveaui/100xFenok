#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const client = fs.readFileSync(path.join(appRoot, "src/app/screener/ScreenerClient.tsx"), "utf8");
const screenerCss = fs.readFileSync(path.join(appRoot, "src/styles/cp-w4-screener.css"), "utf8");
const canvasPlusCss = fs.readFileSync(path.join(appRoot, "src/styles/canvas-plus.css"), "utf8");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(
  /function renderCell\([\s\S]*?surface:\s*"desktop"\s*\|\s*"mobile"\s*=\s*"desktop"/.test(client),
  "renderCell must expose an explicit desktop/mobile surface contract",
);
assert(
  /renderCell\(stock, key, preset, "mobile"\)/.test(client),
  "renderMobileCell must request the shrink-safe mobile rendering path",
);
assert(
  /data-testid="screener-mobile-metric-grid"[^>]*className="[^"]*items-start/.test(client),
  "the mobile metric grid must align items to start instead of stretching paired cards",
);
assert(
  /surface === "mobile"[\s\S]{0,400}min-w-0[\s\S]{0,200}max-w-full/.test(client),
  "the mobile conviction cell must remove the desktop minimum-width floor",
);
assert(
  /\[data-canvas-plus-screener-service="true"\][^{]*\.cpw4-primary-cta\s*\{[^}]*background:\s*var\(--cpw4-ink\);[^}]*color:\s*#fff;[^}]*-webkit-tap-highlight-color:\s*transparent;/s.test(screenerCss),
  "the mobile detail primary CTA must pair its dark background with white text at shell-link specificity and suppress tap highlight",
);
assert(
  /\[data-canvas-plus-screener-service="true"\]\s+\.cp-screener-card-grid\s*\{[^}]*align-items:\s*start;/s.test(canvasPlusCss),
  "the desktop screener card grid must keep collapsed peer cards from stretching with an expanded card",
);

if (failures.length > 0) {
  console.error("[screener-mobile-layout-contract] failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[screener-mobile-layout-contract] ok");
