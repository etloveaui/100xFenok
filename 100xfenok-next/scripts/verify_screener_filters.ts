import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const mobileSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_filters_mobile.png";
const desktopSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_filters_desktop.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // ==============================================
  // [1] Desktop E2E Filter Operation Verify (PBR / MarketCap)
  // ==============================================
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  console.log("Visiting /screener on Desktop...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("body", { timeout: 15_000 });
  await page.waitForSelector("[data-testid='screener-desktop-row']", { state: "attached", timeout: 15_000 });

  // Get initial total count (e.g. "X개 종목")
  const initialTotalCount = await page.evaluate(() => {
    const el = document.querySelector("strong.orbitron");
    return el ? el.innerHTML.trim() : "none";
  });
  console.log(`Initial Total Stocks Count: ${initialTotalCount}`);

  // Test 1: PBR 최대 = 1.0 (Low PBR Filter check)
  const pbrMaxLocator = page.locator("label:has-text('PBR 최대') input");
  if (await pbrMaxLocator.count() > 0) {
    console.log("Typing PBR 최대 = 1.0...");
    await pbrMaxLocator.focus();
    await pbrMaxLocator.fill(""); // Clear first
    await pbrMaxLocator.pressSequentially("1.0", { delay: 100 });
    await pbrMaxLocator.blur();
    await page.waitForTimeout(3000); // Allow react state filtering to finish

    const pbrFilteredCount = await page.evaluate(() => {
      const el = document.querySelector("strong.orbitron");
      return el ? el.innerHTML.trim() : "none";
    });
    console.log(`Total Stocks Count after PBR 최대 = 1.0: ${pbrFilteredCount}`);
    
    // Clear filter
    await pbrMaxLocator.focus();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await pbrMaxLocator.blur();
    await page.waitForTimeout(1500);
  }

  // Test 2: 시총 최소 = 500 ($B) (Mega Cap Filter check)
  const mcapMinLocator = page.locator("label:has-text('시총 최소') input");
  if (await mcapMinLocator.count() > 0) {
    console.log("Typing 시총 최소 = 500 ($B)...");
    await mcapMinLocator.focus();
    await mcapMinLocator.fill("");
    await mcapMinLocator.pressSequentially("500", { delay: 100 });
    await mcapMinLocator.blur();
    await page.waitForTimeout(3000);

    const mcapFilteredCount = await page.evaluate(() => {
      const el = document.querySelector("strong.orbitron");
      return el ? el.innerHTML.trim() : "none";
    });
    console.log(`Total Stocks Count after 시총 최소 = 500: ${mcapFilteredCount}`);
  }

  await page.screenshot({ path: desktopSavePath });
  await page.close();

  // ==============================================
  // [2] Mobile Badge & Responsive Toggle Verify
  // ==============================================
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  console.log("Visiting /screener on Mobile...");
  await mobilePage.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await mobilePage.waitForSelector("[data-testid*='row'], tr", { state: "attached", timeout: 15_000 });

  // Read initial toggle button badge
  const initialBadge = await mobilePage.evaluate(() => {
    const badge = document.querySelector("[data-testid='screener-mobile-advanced-count']") as HTMLElement;
    return badge ? badge.innerText.trim() : null;
  });
  console.log(`Initial mobile filter badge: ${initialBadge}`);

  // Click Open Advanced filters
  const toggleBtn = mobilePage.locator("[data-testid='screener-mobile-advanced-count'], button:has-text('고급 필터')").first();
  if (await toggleBtn.count() > 0) {
    console.log("Opening mobile advanced filters...");
    await toggleBtn.click();
    await mobilePage.waitForTimeout(1000);
  }

  // Input PBR 최대 = 1.0 on mobile to verify badge increment
  const mobilePbrMax = mobilePage.locator("label:has-text('PBR 최대') input");
  if (await mobilePbrMax.count() > 0) {
    console.log("Setting PBR 최대 to 1.0 on mobile...");
    await mobilePbrMax.focus();
    await mobilePbrMax.fill("1.0");
    await mobilePbrMax.evaluate(el => el.dispatchEvent(new Event("change", { bubbles: true })));
    await mobilePbrMax.blur();
    await mobilePage.waitForTimeout(2000);

    const activeBadge = await mobilePage.evaluate(() => {
      const badge = document.querySelector("[data-testid='screener-mobile-advanced-count']") as HTMLElement;
      return badge ? badge.innerText.trim() : null;
    });
    console.log(`Mobile filter badge after PBR 최대 = 1.0: ${activeBadge}`);
  }

  await mobilePage.screenshot({ path: mobileSavePath });
  await mobilePage.close();

  await browser.close();
  console.log("=== COMPLETED VERIFY ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
