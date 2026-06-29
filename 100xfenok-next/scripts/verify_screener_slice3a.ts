import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const desktopSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_slice3a_desktop.png";
const chipRemoveSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_slice3a_removed.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });

  console.log("Visiting /screener on Desktop...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("body", { timeout: 15_000 });
  await page.waitForSelector("strong.orbitron", { timeout: 15_000 });

  // ==============================================
  // [1] Verify Whitespace Label Fix
  // ==============================================
  const labelFacts = await page.evaluate(() => {
    // Collect specific raw text of labels to verify whitespaces
    const labels = Array.from(document.querySelectorAll("label span")).map(l => l.innerHTML.trim());
    const roeLabel = labels.find(l => l.includes("ROE 최소"));
    const opmLabel = labels.find(l => l.includes("OPM 최소"));
    const ret12mLabel = labels.find(l => l.includes("12M 수익률 최소"));
    const roeFy1Label = labels.find(l => l.includes("FY+1 ROE"));

    return {
      roeLabel,
      opmLabel,
      ret12mLabel,
      roeFy1Label,
      hasOpmSpace: opmLabel === "OPM 최소 (%)",
      hasRet12mSpace: ret12mLabel === "12M 수익률 최소 (%)",
      hasRoeFy1Space: roeFy1Label === "FY+1 ROE 최소 (%)"
    };
  });
  console.log("Sanitized Labels Check:", JSON.stringify(labelFacts, null, 2));

  // ==============================================
  // [2] Input filters to trigger active-filter chips (Using only implemented chips: PER, ROE, Sector)
  // ==============================================
  const perMaxInput = page.locator("label").filter({ hasText: /^PER 최대/ }).locator("input");
  const roeMinInput = page.locator("label").filter({ hasText: /^ROE 최소/ }).locator("input");
  const sectorDropdown = page.locator("select").first();

  console.log("Configuring filters to trigger active-chips row...");
  
  // Set PER 최대 = 25
  await perMaxInput.focus();
  await perMaxInput.fill("25");
  await perMaxInput.blur();
  
  // Set ROE 최소 = 15
  await roeMinInput.focus();
  await roeMinInput.fill("15");
  await roeMinInput.blur();

  // Select "반도체" & "소프트웨어"
  await sectorDropdown.selectOption("반도체");
  await page.waitForTimeout(1000);
  await sectorDropdown.selectOption("소프트웨어");
  
  await page.waitForTimeout(3000); // Allow filters to propagate

  // Inspect generated chips above results
  const chipFacts = await page.evaluate(() => {
    // Fetch all elements containing multiplication sign U+00D7 or cross '×'
    const chipElements = Array.from(document.querySelectorAll("span"))
      .filter(el => el.innerText.includes("×") || el.innerText.includes("≤") || el.innerText.includes("≥"))
      .map(el => el.innerText.trim().replace(/\n/g, " "));

    return {
      chipElements,
      totalCount: document.querySelector("strong.orbitron")?.innerHTML.trim() ?? "none"
    };
  });
  console.log("Active Filter Chips Facts:", JSON.stringify(chipFacts, null, 2));
  await page.screenshot({ path: desktopSavePath });

  // ==============================================
  // [3] Click close '×' (U+00D7) on a chip to remove it and verify count changes
  // ==============================================
  const removeButtons = page.locator("span button:has-text('×'), button:has-text('×'), span:has-text('×') button");
  const initialButtonsCount = await removeButtons.count();
  console.log(`Active close '×' buttons count: ${initialButtonsCount}`);

  if (initialButtonsCount > 0) {
    console.log("Removing the first active filter chip...");
    await removeButtons.first().click();
    await page.waitForTimeout(3000);

    const afterRemoveFacts = await page.evaluate(() => {
      const chipElements = Array.from(document.querySelectorAll("span"))
        .filter(el => el.innerText.includes("×") || el.innerText.includes("≤") || el.innerText.includes("≥"))
        .map(el => el.innerText.trim().replace(/\n/g, " "));
      const totalCount = document.querySelector("strong.orbitron")?.innerHTML.trim() ?? "none";
      return { chipElements, totalCount };
    });
    console.log("State after first chip removal:", JSON.stringify(afterRemoveFacts, null, 2));
    await page.screenshot({ path: chipRemoveSavePath });
  }

  await page.close();
  await browser.close();
  console.log("=== COMPLETED VERIFY ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
