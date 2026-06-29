import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const screenerSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/screener_label_verify.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // ==============================================
  // [1] Desktop (1280x800) GNB Label Verification
  // ==============================================
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  console.log("Visiting /screener on Desktop...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("body", { timeout: 15_000 });

  // Gather text content of nav rails to see if new labels exist
  const desktopLabels = await page.evaluate(() => {
    const railItems = Array.from(document.querySelectorAll(".rail-nav a, [class*='menu'] a, [class*='rail'] a"))
      .map(el => (el as HTMLElement).innerText.trim());
    
    const bodyText = document.body.innerText;
    const hasAlphaScout = bodyText.includes("Alpha Scout (미리보기)");
    const hasStockAnalyzer = bodyText.includes("종목분석 (레거시)");

    return {
      railItems: railItems.filter(Boolean).slice(0, 30),
      hasAlphaScout,
      hasStockAnalyzer
    };
  });
  console.log("Desktop GNB Label Verification:", JSON.stringify(desktopLabels, null, 2));

  // ==============================================
  // [2] Mobile (390x844) Drawer verification
  // ==============================================
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  console.log("Visiting /screener on Mobile...");
  await mobilePage.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await mobilePage.waitForSelector("body", { timeout: 15_000 });

  try {
    // Target the visible tabbar link specifically to avoid hidden rail items
    const moreTab = mobilePage.locator(".tabbar a, .tabbar button, [class*='tabbar'] a").filter({ hasText: "더보기" });
    if (await moreTab.count() > 0) {
      console.log("Found mobile '더보기' button. Clicking it...");
      await moreTab.first().click({ timeout: 5000 });
      await mobilePage.waitForTimeout(2000); // Give slide transition time
    } else {
      console.log("Fallback: searching any visible text=더보기");
      await mobilePage.click("text=더보기", { timeout: 5000 });
      await mobilePage.waitForTimeout(2000);
    }
  } catch (clickErr) {
    console.warn("Mobile click '더보기' failed or timed out. Proceeding to inspect text content anyway.", clickErr);
  }

  const mobileLabels = await mobilePage.evaluate(() => {
    const text = document.body.innerText;
    const hasAlphaScout = text.includes("Alpha Scout (미리보기)");
    const hasStockAnalyzer = text.includes("종목분석 (레거시)");
    return { hasAlphaScout, hasStockAnalyzer };
  });
  console.log("Mobile Drawer Label Verification:", mobileLabels);
  await mobilePage.screenshot({ path: screenerSavePath });
  await mobilePage.close();

  // ==============================================
  // [3] Regression Check: /ib default still V1 frame without leaked GNB
  // ==============================================
  console.log("Performing regression check on /ib...");
  await page.goto(`${baseUrl}/ib`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const regressionFacts = await page.evaluate(() => {
    const navbar = document.querySelector("[data-v1-chrome='navbar']") as HTMLElement;
    const footer = document.querySelector("[data-v1-chrome='footer']") as HTMLElement;
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    
    const isNavbarHidden = navbar ? window.getComputedStyle(navbar).display === "none" : true;
    const isFooterHidden = footer ? window.getComputedStyle(footer).display === "none" : true;
    const text = document.body.innerText;
    const hasLegacyText = text.includes("DASHBOARD") || text.includes("MARKET") || text.includes("ANALYTICS") || text.includes("STRATEGIES");

    return {
      isNavbarHidden,
      isFooterHidden,
      iframeExists: !!iframe,
      iframeSrc: iframe ? iframe.src : null,
      hasLegacyText
    };
  });
  console.log("Regression Test /ib Facts:", JSON.stringify(regressionFacts, null, 2));

  await page.close();
  await browser.close();
  console.log("=== COMPLETED VERIFY ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
