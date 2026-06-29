import { chromium } from "playwright";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const bentoDesktop = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/bento_desktop.png";
const bentoMobile = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/bento_mobile.png";
const briefingDesktop = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/briefing_desktop.png";
const briefingMobile = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/briefing_mobile.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // ==============================================
  // [1] Desktop (1280x800) Bento Home Check
  // ==============================================
  const desktopPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  console.log("Visiting Bento Home (/) on Desktop...");
  await desktopPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(3000);
  
  const bentoDesktopFacts = await desktopPage.evaluate(() => {
    const text = document.body.innerText;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(h => (h as HTMLElement).innerText.trim());
    const links = Array.from(document.querySelectorAll("a")).map(a => (a as HTMLElement).innerText.trim()).filter(Boolean);
    
    return {
      title: document.title,
      headings: headings.slice(0, 15),
      linksCount: links.length,
      textLength: text.length,
      snippet: text.slice(0, 400).replace(/\n/g, " ")
    };
  });
  console.log("Bento Desktop Facts:", bentoDesktopFacts);
  await desktopPage.screenshot({ path: bentoDesktop });

  // ==============================================
  // [2] Desktop (1280x800) Briefing Check
  // ==============================================
  console.log("Visiting Briefing (/briefing) on Desktop...");
  await desktopPage.goto(`${baseUrl}/briefing`, { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(3000);
  
  const briefingDesktopFacts = await desktopPage.evaluate(() => {
    const text = document.body.innerText;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(h => (h as HTMLElement).innerText.trim());
    const cards = Array.from(document.querySelectorAll("[class*='card'], [class*='section']"));
    
    return {
      title: document.title,
      headings: headings.slice(0, 15),
      cardsCount: cards.length,
      textLength: text.length,
      snippet: text.slice(0, 400).replace(/\n/g, " ")
    };
  });
  console.log("Briefing Desktop Facts:", briefingDesktopFacts);
  await desktopPage.screenshot({ path: briefingDesktop });
  await desktopPage.close();

  // ==============================================
  // [3] Mobile (390x844) Bento Home Check
  // ==============================================
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  console.log("Visiting Bento Home (/) on Mobile...");
  await mobilePage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(3000);
  await mobilePage.screenshot({ path: bentoMobile });

  // ==============================================
  // [4] Mobile (390x844) Briefing Check
  // ==============================================
  console.log("Visiting Briefing (/briefing) on Mobile...");
  await mobilePage.goto(`${baseUrl}/briefing`, { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(3000);
  await mobilePage.screenshot({ path: briefingMobile });
  
  await mobilePage.close();
  await browser.close();
  console.log("=== COMPLETED VERIFY ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
