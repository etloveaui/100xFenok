import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const desktopSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_slice2_desktop.png";
const deeplinkSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_slice2_deeplink.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // ==============================================
  // [1] Deep-Link Compatibility Test (CRITICAL REGRESSION GUARD)
  // ==============================================
  const deeplinkPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  console.log("Testing Deeplink: /screener?sector=반도체...");
  await deeplinkPage.goto(`${baseUrl}/screener?sector=반도체`, { waitUntil: "networkidle" });
  await deeplinkPage.waitForSelector("body", { timeout: 15_000 });
  await deeplinkPage.waitForSelector("strong.orbitron", { timeout: 15_000 });

  const deeplinkFacts = await deeplinkPage.evaluate(() => {
    const text = document.body.innerText;
    
    // Find all chips / pills
    const chips = Array.from(document.querySelectorAll("[class*='chip'], [class*='badge'], .filter-pill, [class*='pill']"))
      .map(el => (el as HTMLElement).innerText.trim());

    // Check if "반도체" is present as a filter pill
    const hasSemiconductorChip = chips.some(c => c.includes("반도체")) || text.includes("반도체 ✕") || text.includes("반도체\n✕");
    const totalCount = document.querySelector("strong.orbitron")?.innerHTML.trim() ?? "none";

    return {
      title: document.title,
      totalCount,
      hasSemiconductorChip,
      chips
    };
  });
  console.log("Deeplink Verification Facts:", JSON.stringify(deeplinkFacts, null, 2));
  await deeplinkPage.screenshot({ path: deeplinkSavePath });
  await deeplinkPage.close();

  // ==============================================
  // [2] Desktop E2E Multi-Select Action (반도체 + 소프트웨어 UNION)
  // ==============================================
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  console.log("Visiting /screener on Desktop...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("body");
  await page.waitForSelector("strong.orbitron", { timeout: 15_000 });

  // Get initial total count (e.g. 1,066)
  const initialTotal = await page.evaluate(() => document.querySelector("strong.orbitron")?.innerHTML.trim());
  console.log(`Initial Total Stocks: ${initialTotal}`);

  // Select "반도체" sector from dropdown
  console.log("Selecting '반도체' sector...");
  const sectorDropdown = page.locator("label:has-text('섹터') select, select[name*='sector'], select[id*='sector']").first();
  if (await sectorDropdown.count() > 0) {
    await sectorDropdown.selectOption("반도체");
    await page.waitForTimeout(2000);

    const semiOnlyTotal = await page.evaluate(() => document.querySelector("strong.orbitron")?.innerHTML.trim());
    console.log(`Stocks count with 반도체 only: ${semiOnlyTotal}`);

    // Select "소프트웨어" sector (append UNION)
    console.log("Selecting '소프트웨어' sector to append...");
    await sectorDropdown.selectOption("소프트웨어");
    await page.waitForTimeout(2000);

    const unionTotal = await page.evaluate(() => document.querySelector("strong.orbitron")?.innerHTML.trim());
    console.log(`Stocks count after adding 소프트웨어 (UNION): ${unionTotal}`);

    // Audit active sector chips
    const activeSectorChips = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll("[class*='chip'], .filter-pill, [class*='pill']"))
        .map(el => (el as HTMLElement).innerText.trim());
      return pills;
    });
    console.log("Active Sector Chips:", activeSectorChips);

    // Try to remove a chip by clicking its cross/close sign
    const closeBtn = page.locator("span:has-text('✕'), button:has-text('✕')").first();
    if (await closeBtn.count() > 0) {
      console.log("Clicking close button on first sector chip...");
      await closeBtn.click();
      await page.waitForTimeout(2000);

      const afterRemoveTotal = await page.evaluate(() => document.querySelector("strong.orbitron")?.innerHTML.trim());
      console.log(`Stocks count after removing first chip: ${afterRemoveTotal}`);
    }

    // Click Reset (초기화)
    const resetBtn = page.locator("button:has-text('초기화')").first();
    if (await resetBtn.count() > 0) {
      console.log("Clicking Reset button...");
      await resetBtn.click();
      await page.waitForTimeout(2000);
      const afterResetTotal = await page.evaluate(() => document.querySelector("strong.orbitron")?.innerHTML.trim());
      console.log(`Stocks count after Reset: ${afterResetTotal}`);
    }
  }

  await page.screenshot({ path: desktopSavePath });
  await page.close();
  await browser.close();
  console.log("=== COMPLETED VERIFY ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
