import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.QA_BASE || "https://100xfenok.etloveaui.workers.dev";
const OUT = "/tmp/qa-shots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text().slice(0, 300)}`);
});

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`shot: ${name} (errors so far: ${errors.length})`);
}

// 1. superinvestors — consensus tab (with total treemap)
await page.goto(`${BASE}/superinvestors`, { waitUntil: "load" });
await page.waitForTimeout(4500);
await shot("01-superinvestors-consensus");

// 2. trades tab
const tradesTab = page.getByRole("button", { name: "매매랭킹" });
if (await tradesTab.count()) {
  await tradesTab.first().click();
  await page.waitForTimeout(3500);
  await shot("02-superinvestors-trades");
} else {
  console.log("!! 매매랭킹 tab NOT FOUND");
  await shot("02-superinvestors-trades-MISSING");
}

// 3. guru list tab + expand first guru
const guruTab = page.getByRole("button", { name: "구루 리스트" });
if (await guruTab.count()) {
  await guruTab.first().click();
  await page.waitForTimeout(1500);
  const expand = page.getByRole("button", { name: /포트폴리오 보기/ }).first();
  if (await expand.count()) {
    await expand.click();
    await page.waitForTimeout(3000);
  } else {
    console.log("!! 포트폴리오 보기 button NOT FOUND");
  }
  await shot("03-superinvestors-guru-expanded");
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1200);
  await shot("03b-guru-panel-charts");
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(1200);
  await shot("03c-guru-sector-mix");
}

// 4. explore
await page.goto(`${BASE}/explore`, { waitUntil: "load" });
await page.waitForTimeout(3500);
await shot("04-explore");

// 5. stock/AAPL
await page.goto(`${BASE}/stock/AAPL`, { waitUntil: "load" });
await page.waitForTimeout(4500);
await shot("05-stock-aapl");

// 6. mobile viewport check of superinvestors trades
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/superinvestors`, { waitUntil: "load" });
await page.waitForTimeout(3500);
await shot("06-superinvestors-mobile");

console.log("\n=== RUNTIME ERRORS (" + errors.length + ") ===");
for (const e of [...new Set(errors)].slice(0, 30)) console.log(e);

await browser.close();
