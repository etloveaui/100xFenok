import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const desktopSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_slice3b_desktop.png";
const mobileSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_slice3b_mobile.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // ==============================================
  // [1] Desktop E2E Accordion & Filtering Test
  // ==============================================
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  console.log("Visiting /screener on Desktop...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("body", { timeout: 15_000 });
  await page.waitForSelector("strong.orbitron", { timeout: 15_000 });

  const desktopFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    
    // Find accordion headers / collapsible blocks standard way
    const buttons = Array.from(document.querySelectorAll("button"))
      .map(el => (el as HTMLElement).innerText.trim().replace(/\n/g, " "));
    const headers = buttons.filter(t => t.includes("Scale") || t.includes("Value") || t.includes("Growth") || t.includes("Quality"));

    const hasSectorField = text.includes("섹터") || text.includes("Sector");
    const hasMcapField = text.includes("시총") || text.includes("Market Cap");

    return {
      headers,
      hasSectorField,
      hasMcapField,
      initialTotal: document.querySelector("strong.orbitron")?.innerHTML.trim() ?? "none"
    };
  });
  console.log("Desktop Slice-3b Facts:", JSON.stringify(desktopFacts, null, 2));

  // Expand "Value & Valuation" accordion
  console.log("Expanding Value & Valuation group...");
  const valueHeader = page.locator("button:has-text('Value & Valuation'), div:has-text('Value & Valuation')").first();
  if (await valueHeader.count() > 0) {
    await valueHeader.click();
    await page.waitForTimeout(1000);
  }

  // Set PER 최대 = 20 inside Value group
  const perInput = page.locator("label").filter({ hasText: /^PER 최대/ }).locator("input");
  if (await perInput.count() > 0) {
    await perInput.focus();
    await perInput.fill("20");
    await perInput.blur();
    await page.waitForTimeout(2000);
    const filterTotal = await page.evaluate(() => document.querySelector("strong.orbitron")?.innerHTML.trim());
    console.log(`Stocks count with PER 최대 = 20: ${filterTotal}`);
  }

  await page.screenshot({ path: desktopSavePath });
  await page.close();

  // ==============================================
  // [2] Mobile (375x812) Compactness Test (Key win measurement)
  // ==============================================
  const mobilePage = await browser.newPage({ viewport: { width: 375, height: 812 } });
  console.log("Visiting /screener on Mobile...");
  await mobilePage.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await mobilePage.waitForSelector("body", { timeout: 15_000 });
  await mobilePage.waitForSelector("strong.orbitron", { timeout: 15_000 });

  const mobileHeightFacts = await mobilePage.evaluate(() => {
    const totalCountNode = document.querySelector("strong.orbitron")?.closest("div") || document.querySelector("strong.orbitron");
    
    // Fallback: calculate filter box height via DOM bounding rects in standard JS
    const sections = Array.from(document.querySelectorAll("section"));
    const filterPanel = sections.find(s => s.innerText.includes("Scale") || s.innerText.includes("Value"));
    const panelHeight = filterPanel ? filterPanel.getBoundingClientRect().height : 0;
    
    const text = document.body.innerText;
    
    return {
      panelHeight,
      totalCountTop: totalCountNode ? totalCountNode.getBoundingClientRect().top : 0,
      hasPerInputVisible: text.includes("PER 최대")
    };
  });
  console.log("Mobile Height Facts (Slice-3b Collapsed):", JSON.stringify(mobileHeightFacts, null, 2));

  await mobilePage.screenshot({ path: mobileSavePath });
  await mobilePage.close();
  await browser.close();
  console.log("=== COMPLETED VERIFY ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
