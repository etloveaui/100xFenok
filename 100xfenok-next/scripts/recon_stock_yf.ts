import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const nvdaSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/ux_recon_stock_nvda.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });

  console.log("Visiting /stock/NVDA on Desktop...");
  await page.goto(`${baseUrl}/stock/NVDA`, { waitUntil: "networkidle" });
  await page.waitForSelector("body");
  await page.waitForTimeout(3000); // Wait for async charts/tables to load

  const stockFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    
    // Check main headings
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(h => (h as HTMLElement).innerText.trim());
    
    // Audit financial tables or indicators
    const tables = Array.from(document.querySelectorAll("table")).map(t => {
      const rows = Array.from(t.querySelectorAll("tr")).slice(0, 5).map(r => r.innerText.trim().replace(/\n/g, " | "));
      return { rowsCount: t.querySelectorAll("tr").length, firstRows: rows };
    });

    // Detect tags/keys relating to YF
    const hasFinancials = text.includes("손익계산서") || text.includes("재무") || text.includes("Income Statement") || text.includes("Balance Sheet");
    const hasRatios = text.includes("P/E") || text.includes("Forward P/E") || text.includes("PEG") || text.includes("ROE") || text.includes("OPM");

    return {
      title: document.title,
      headings: headings.slice(0, 15),
      hasFinancials,
      hasRatios,
      tablesCount: tables.length,
      firstTable: tables[0],
      secondTable: tables[1],
      snippet: text.slice(0, 1200).replace(/\n/g, " ")
    };
  });
  console.log("NVDA Stock Details Facts:", JSON.stringify(stockFacts, null, 2));

  await page.screenshot({ path: nvdaSavePath });
  await page.close();
  await browser.close();
  console.log("=== STOCK RECON COMPLETED ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
