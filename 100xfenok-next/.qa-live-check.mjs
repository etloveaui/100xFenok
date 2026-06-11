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

// 2b. insights tab
const insightsTab = page.getByRole("button", { name: "인사이트" });
if (await insightsTab.count()) {
  await insightsTab.first().click();
  await page.waitForTimeout(2000);
  await shot("02b-superinvestors-insights");
} else {
  console.log("!! 인사이트 tab NOT FOUND");
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
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(1500);
  await shot("03d-guru-performance-vs-spy");
}

// 4. explore — super-tool: signal strip + thermometer + week-ahead
await page.goto(`${BASE}/explore`, { waitUntil: "load" });
await page.waitForTimeout(4000);
await shot("04-explore");
await page.mouse.wheel(0, 800);
await page.waitForTimeout(1200);
await shot("04t-explore-thermometer-weekahead");
// thermometer period toggle
const p3m = page.getByRole("button", { name: "3개월" });
if (await p3m.count()) {
  await p3m.first().click();
  await page.waitForTimeout(800);
  await shot("04u-explore-thermometer-3m");
} else {
  console.log("!! thermometer 3개월 toggle NOT FOUND");
}
await page.mouse.wheel(0, -1200);
await page.waitForTimeout(600);

// 4b. typeahead — stock + guru suggestions
const heroInput = page.getByRole("combobox").first();
if (await heroInput.count()) {
  await heroInput.click();
  await heroInput.pressSequentially("buf", { delay: 80 });
  await page.waitForTimeout(1200);
  await shot("04b-explore-typeahead-guru");
  await heroInput.fill("");
  await heroInput.pressSequentially("NVD", { delay: 80 });
  await page.waitForTimeout(1200);
  await shot("04c-explore-typeahead-stock");
} else {
  console.log("!! explore typeahead combobox NOT FOUND");
}

// 5. stock/AAPL — overview + yf 5 tabs
await page.goto(`${BASE}/stock/AAPL`, { waitUntil: "load" });
await page.waitForTimeout(4500);
await shot("05-stock-aapl");

// 5a-score. summary score card expand
const scoreToggle = page.getByRole("button", { name: /통과/ });
if (await scoreToggle.count()) {
  await scoreToggle.first().click();
  await page.waitForTimeout(800);
  await shot("05a-stock-aapl-score-expanded");
} else {
  console.log("!! summary score card NOT FOUND");
}
for (const [idx, label] of [["05b", "재무"], ["05c", "통계"], ["05d", "보유기관"], ["05e", "추정치"]]) {
  const tab = page.getByRole("button", { name: label });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(1500);
    await shot(`${idx}-stock-aapl-${label}`);
  } else {
    console.log(`!! /stock tab ${label} NOT FOUND`);
  }
}

// 5-kr. stock/005930.KS — KRW formatting check (재무 tab)
await page.goto(`${BASE}/stock/005930.KS`, { waitUntil: "load" });
await page.waitForTimeout(4000);
const krFin = page.getByRole("button", { name: "재무" });
if (await krFin.count()) {
  await krFin.first().click();
  await page.waitForTimeout(1500);
  await shot("05f-stock-samsung-financials");
} else {
  console.log("!! KR stock 재무 tab NOT FOUND (yf data missing?)");
  await shot("05f-stock-samsung-NO-TABS");
}

// 5b. screener guru preset
await page.goto(`${BASE}/screener`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const guruPreset = page.getByRole("button", { name: "구루픽" });
if (await guruPreset.count()) {
  await guruPreset.first().click();
  await page.waitForTimeout(1200);
  await shot("07-screener-guru-preset");
} else {
  console.log("!! 구루픽 preset NOT FOUND");
}

// 5b2. market-valuation — yardeni model card (bottom)
await page.goto(`${BASE}/market-valuation`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.keyboard.press("End");
await page.waitForTimeout(1500);
await shot("07b-market-valuation-yardeni");

// 5c. sectors smart money (bottom)
await page.goto(`${BASE}/sectors`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.keyboard.press("End");
await page.waitForTimeout(1500);
await shot("08-sectors-smartmoney");

// 6. mobile viewport check of superinvestors trades
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/superinvestors`, { waitUntil: "load" });
await page.waitForTimeout(3500);
await shot("06-superinvestors-mobile");

// 6b. mobile explore — signal strip / thermometer / week-ahead stack
await page.goto(`${BASE}/explore`, { waitUntil: "load" });
await page.waitForTimeout(3500);
await shot("06b-explore-mobile-top");
await page.mouse.wheel(0, 1100);
await page.waitForTimeout(1000);
await shot("06c-explore-mobile-thermo");
await page.mouse.wheel(0, 1100);
await page.waitForTimeout(1000);
await shot("06d-explore-mobile-weekahead");

console.log("\n=== RUNTIME ERRORS (" + errors.length + ") ===");
for (const e of [...new Set(errors)].slice(0, 30)) console.log(e);

await browser.close();
