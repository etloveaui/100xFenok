import { chromium } from "playwright";

const URL = "http://localhost:3100/screener/radar-sample";
const OUT_DIR = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok/100xfenok-next/_verification_screenshots";

async function capture(viewport, name) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas[role='img']", { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/hexagon_pair_${name}.png`, fullPage: false });
  await browser.close();
  console.log(`captured ${name}`);
}

await capture({ width: 1280, height: 700 }, "desktop");
await capture({ width: 390, height: 844 }, "mobile");
