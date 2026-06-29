import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  console.log("=== START VISUAL VERIFICATION ===");

  // 1. Verify /screener
  console.log("Visiting /screener...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("table", { timeout: 15_000 });

  const screenerFacts = await page.evaluate(() => {
    const table = document.querySelector("table");
    const headers = table ? Array.from(table.querySelectorAll("th")).map(th => th.innerText.trim()) : [];
    
    // Check PER-band column
    const hasPerBand = headers.some(h => h.includes("PER") || h.includes("밴드") || h.includes("Band"));
    
    // Check presets
    const presets = Array.from(document.querySelectorAll("[class*='preset'], button")).map(el => (el as HTMLElement).innerText.trim()).filter(Boolean);
    const hasFourPresets = presets.some(p => p.includes("Preset") || p.includes("필터") || p.includes("조건") || presets.length >= 4);

    // Check 13F badges
    const badges = Array.from(document.querySelectorAll(".badge, [class*='badge']")).map(el => (el as HTMLElement).innerText.trim());
    const has13FBadges = document.body.innerText.includes("13F") || badges.some(b => b.includes("13F"));

    // Check inline drilldown elements
    const hasInlineDrill = document.querySelector("[class*='drill'], td a, tr[class*='detail']") !== null;

    return {
      headersCount: headers.length,
      headers: headers,
      hasPerBand,
      presetsFoundCount: presets.length,
      has13FBadges,
      hasInlineDrill
    };
  });
  console.log("/screener verification result:", JSON.stringify(screenerFacts, null, 2));

  // 2. Verify /superinvestors
  console.log("Visiting /superinvestors...");
  await page.goto(`${baseUrl}/superinvestors`, { waitUntil: "networkidle" });
  const superinvestorsFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasGurus = text.includes("13F") || text.includes("기관") || text.includes("포트폴리오") || text.includes("버핏") || text.includes("Buffett") || text.includes("Burry");
    return {
      hasGurus,
      bodySnippet: text.slice(0, 300).replace(/\n/g, " ")
    };
  });
  console.log("/superinvestors verification result:", JSON.stringify(superinvestorsFacts, null, 2));

  // 3. Verify /regime
  console.log("Visiting /regime...");
  await page.goto(`${baseUrl}/regime`, { waitUntil: "networkidle" });
  const regimeFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasRegimeContent = text.includes("국면") || text.includes("Regime") || text.includes("유동성") || text.includes("금리") || text.includes("인플레이션");
    return {
      hasRegimeContent,
      bodySnippet: text.slice(0, 300).replace(/\n/g, " ")
    };
  });
  console.log("/regime verification result:", JSON.stringify(regimeFacts, null, 2));

  // 4. Verify /market-valuation
  console.log("Visiting /market-valuation...");
  await page.goto(`${baseUrl}/market-valuation`, { waitUntil: "networkidle" });
  const marketValuationFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasValuationContent = text.includes("밸류에이션") || text.includes("Valuation") || text.includes("지수") || text.includes("PER") || text.includes("PBR") || text.includes("FED 모델");
    return {
      hasValuationContent,
      bodySnippet: text.slice(0, 300).replace(/\n/g, " ")
    };
  });
  console.log("/market-valuation verification result:", JSON.stringify(marketValuationFacts, null, 2));

  await browser.close();
  console.log("=== VISUAL VERIFICATION COMPLETED ===");
}

main().catch((err) => {
  console.error("FAIL during live verification:", err);
  process.exit(1);
});
