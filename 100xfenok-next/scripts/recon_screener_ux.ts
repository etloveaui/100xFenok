import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const desktopFiltersPath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/ux_recon_desktop_filters.png";
const mobileFiltersPath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/ux_recon_mobile_filters.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // ==============================================
  // [1] Desktop UX Audit (Grid Clutter & Heights)
  // ==============================================
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } }); // Higher height to see full list
  console.log("Auditing /screener Desktop layout...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("body");
  await page.waitForSelector("input", { timeout: 15_000 });

  const desktopStats = await page.evaluate(() => {
    // Audit grid properties of filter container
    const filterPanel = document.querySelector("#advanced-filters")?.parentElement;
    const filterInputs = Array.from(document.querySelectorAll("#advanced-filters input, #advanced-filters select"));
    
    // Check height and grid column layout
    const rect = filterPanel ? filterPanel.getBoundingClientRect() : null;
    const computedStyle = filterPanel ? window.getComputedStyle(filterPanel) : null;

    // Map all filter labels in order to check logical grouping
    const labels = Array.from(document.querySelectorAll("#advanced-filters label"))
      .map(lbl => {
        const span = lbl.querySelector("span");
        const input = lbl.querySelector("input, select");
        return {
          labelText: span ? span.innerText.trim() : "unknown",
          inputType: input ? input.tagName.toLowerCase() : "none"
        };
      });

    return {
      panelHeight: rect ? rect.height : 0,
      gridTemplateColumns: computedStyle ? computedStyle.gridTemplateColumns : "none",
      filtersCount: filterInputs.length,
      labels
    };
  });
  console.log("Desktop UX Metrics:", JSON.stringify(desktopStats, null, 2));
  
  // Take screenshot focusing on the filter section
  const filterSection = page.locator("section:has(#advanced-filters)").first();
  if (await filterSection.count() > 0) {
    await filterSection.screenshot({ path: desktopFiltersPath });
  } else {
    await page.screenshot({ path: desktopFiltersPath });
  }
  await page.close();

  // ==============================================
  // [2] Mobile UX Audit (Scroll-Hell & Overlap)
  // ==============================================
  const mobilePage = await browser.newPage({ viewport: { width: 375, height: 812 } }); // Standard iPhone
  console.log("Auditing /screener Mobile layout...");
  await mobilePage.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await mobilePage.waitForSelector("body");

  // Expand mobile advanced filter panel
  const toggleBtn = mobilePage.locator("[data-testid='screener-mobile-advanced-count'], button:has-text('고급 필터')").first();
  if (await toggleBtn.count() > 0) {
    await toggleBtn.click();
    await mobilePage.waitForTimeout(1000);
  }

  const mobileStats = await mobilePage.evaluate(() => {
    const advFilters = document.querySelector("#advanced-filters");
    const rect = advFilters ? advFilters.getBoundingClientRect() : null;
    
    return {
      advancedFiltersHeight: rect ? rect.height : 0,
      viewportHeight: window.innerHeight,
      ratio: rect ? rect.height / window.innerHeight : 0
    };
  });
  console.log("Mobile UX Metrics:", JSON.stringify(mobileStats, null, 2));

  // Screenshot full expanded view on Mobile
  await mobilePage.screenshot({ path: mobileFiltersPath });
  await mobilePage.close();

  await browser.close();
  console.log("=== RECON UX COMPLETED ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
