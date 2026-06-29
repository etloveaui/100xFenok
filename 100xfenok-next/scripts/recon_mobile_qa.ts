import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const mobileBaseSave = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/mobile_qa_baseline.png";
const mobileExpandedSave = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/mobile_qa_expanded.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // Standard iPhone view (375x812)
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  console.log("Visiting /screener on Mobile...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("body", { timeout: 15_000 });
  await page.waitForSelector("strong.orbitron", { timeout: 15_000 });

  // Take screenshot of default (unexpanded filters) state
  await page.screenshot({ path: mobileBaseSave });

  // Input some values to generate chips and expand filters
  // Open advanced filters first
  const toggleBtn = page.locator("[data-testid='screener-mobile-advanced-count'], button:has-text('고급 필터')").first();
  if (await toggleBtn.count() > 0) {
    await toggleBtn.click();
    await page.waitForTimeout(1000);
  }

  // Set sector & some numbers to trigger multiple pills
  const sectorDropdown = page.locator("select").first();
  await sectorDropdown.selectOption("반도체");
  await page.waitForTimeout(500);
  await sectorDropdown.selectOption("소프트웨어");

  const perMaxInput = page.locator("label").filter({ hasText: /^PER 최대/ }).locator("input");
  await perMaxInput.focus();
  await perMaxInput.fill("20");
  await perMaxInput.blur();

  const roeMinInput = page.locator("label").filter({ hasText: /^ROE 최소/ }).locator("input");
  await roeMinInput.focus();
  await roeMinInput.fill("15");
  await roeMinInput.blur();

  await page.waitForTimeout(3000); // Allow react to re-render

  const qaFacts = await page.evaluate(() => {
    // Check for overflow / layout overlap
    const bodyWidth = document.body.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const hasHorizontalScroll = scrollWidth > bodyWidth;

    const text = document.body.innerText;
    
    // Check how many chips are rendered
    const chips = Array.from(document.querySelectorAll("[class*='chip'], .filter-pill, [class*='pill']"))
      .map(el => (el as HTMLElement).innerText.trim().replace(/\n/g, " "));

    // Measure advanced filters container height to confirm push-down
    const advFilters = document.querySelector("#advanced-filters");
    const advHeight = advFilters ? advFilters.getBoundingClientRect().height : 0;

    return {
      bodyWidth,
      scrollWidth,
      hasHorizontalScroll,
      chipsCount: chips.length,
      chips,
      advHeight,
      viewportHeight: window.innerHeight,
      pushPercentage: advHeight / window.innerHeight
    };
  });
  console.log("Mobile Holistic QA Facts:", JSON.stringify(qaFacts, null, 2));

  // Take screenshot of expanded & filtered state on Mobile
  await page.screenshot({ path: mobileExpandedSave });

  await page.close();
  await browser.close();
  console.log("=== COMPLETED MOBILE QA ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
