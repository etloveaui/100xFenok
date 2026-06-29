import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const desktopSuperPath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/ux_recon_superinvestors.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });

  console.log("Visiting /superinvestors on Desktop...");
  await page.goto(`${baseUrl}/superinvestors`, { waitUntil: "networkidle" });
  await page.waitForSelector("body");
  await page.waitForTimeout(3000); // Allow graph/treemap to render

  const superFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    
    // Check main elements
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(h => (h as HTMLElement).innerText.trim());
    const tabs = Array.from(document.querySelectorAll("button[role='tab'], [class*='tab'] button")).map(t => (t as HTMLElement).innerText.trim());
    
    // Scan for chart/treemap canvas or SVG containers
    const svgsCount = document.querySelectorAll("svg").length;
    const canvasesCount = document.querySelectorAll("canvas").length;
    
    // Scan for KPIs
    const kpis = Array.from(document.querySelectorAll("[class*='kpi'], [class*='card'], [class*='stat']"))
      .map(k => (k as HTMLElement).innerText.trim().replace(/\n/g, " "))
      .filter(Boolean)
      .slice(0, 10);

    return {
      title: document.title,
      headings: headings.slice(0, 15),
      tabs: tabs.slice(0, 10),
      svgsCount,
      canvasesCount,
      kpis,
      snippet: text.slice(0, 1000).replace(/\n/g, " ")
    };
  });
  console.log("Superinvestors UX Facts:", JSON.stringify(superFacts, null, 2));

  // Take screenshot focusing on the main layout
  await page.screenshot({ path: desktopSuperPath });

  await page.close();
  await browser.close();
  console.log("=== SUPERINVESTORS RECON COMPLETED ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
