import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const homeSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/final_home_verify.png";
const screenerSavePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/final_screener_back_verify.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // ==============================================
  // [1] Verify Root / is Home (V5 Briefing) and check first Nav tab label
  // ==============================================
  console.log("Visiting root / on Desktop...");
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("body", { timeout: 15_000 });

  const rootFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasBriefingContent = text.includes("선별 장세입니다") || text.includes("시장 펄스");
    
    // Find the first tab inside GNB / rails
    const firstTab = document.querySelector(".rail-nav a, [class*='menu'] a") as HTMLAnchorElement;
    
    return {
      title: document.title,
      hasBriefingContent,
      firstTabLabel: firstTab ? firstTab.innerText.trim() : null,
      firstTabHref: firstTab ? firstTab.getAttribute("href") : null,
      snippet: text.slice(0, 300).replace(/\n/g, " ")
    };
  });
  console.log("Root / Verification:", JSON.stringify(rootFacts, null, 2));
  await page.screenshot({ path: homeSavePath });

  // ==============================================
  // [2] Verify /screener Back Button URL (Using 'attached' state to audit hidden/visible anchors)
  // ==============================================
  console.log("Visiting /screener to check Back link...");
  await page.goto(`${baseUrl}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector(".back, .topbar-back, a[class*='back']", { state: "attached", timeout: 15_000 });

  const backLinkFacts = await page.evaluate(() => {
    // Find back button links inside AppShell top bar or back wrappers
    const backBtn = document.querySelector(".topbar-back, a.back, a[class*='back']") as HTMLAnchorElement;
    return {
      backBtnExists: !!backBtn,
      backBtnHref: backBtn ? backBtn.getAttribute("href") : null,
      backBtnClass: backBtn ? backBtn.className : null
    };
  });
  console.log("Screener Back Link Facts:", JSON.stringify(backLinkFacts, null, 2));
  await page.screenshot({ path: screenerSavePath });

  // ==============================================
  // [3] Verify /workbench (Renders Bento layout with title '워크벤치')
  // ==============================================
  console.log("Visiting /workbench on Desktop...");
  await page.goto(`${baseUrl}/workbench`, { waitUntil: "networkidle" });
  await page.waitForSelector("body", { timeout: 15_000 });

  const workbenchFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(h => (h as HTMLElement).innerText.trim());
    const hasBentoContent = text.includes("시장 체온계") || text.includes("매크로 플레이북");

    return {
      title: document.title,
      headings: headings.slice(0, 10),
      hasBentoContent
    };
  });
  console.log("Workbench Facts:", JSON.stringify(workbenchFacts, null, 2));

  // ==============================================
  // [4] Verify Backdoor /?v1=1 (Resolves V1)
  // ==============================================
  console.log("Visiting /?v1=1 on Desktop...");
  await page.goto(`${baseUrl}/?v1=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const backdoorFacts = await page.evaluate(() => {
    const navbar = document.querySelector("[data-v1-chrome='navbar']") as HTMLElement;
    const isNavbarHidden = navbar ? window.getComputedStyle(navbar).display === "none" : false;
    return {
      navbarExists: !!navbar,
      isNavbarHidden
    };
  });
  console.log("Backdoor /?v1=1 Facts:", JSON.stringify(backdoorFacts, null, 2));

  await page.close();
  await browser.close();
  console.log("=== COMPLETED VERIFY ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
