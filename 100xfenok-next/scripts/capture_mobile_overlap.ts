import { chromium } from "playwright";
import {
  DAILY_MULTI_SOXL,
  DAILY_MULTI_TQQQ,
  PROFILE_MULTI,
} from "../src/components/ib/v2/lib/__fixtures__/ib-v2-fixtures";

const baseUrl = "https://100xfenok.etloveaui.workers.dev";
const savePath = "/Users/fenomenokim/.gemini/antigravity-cli/brain/f7f2455c-0833-4350-8ae3-d6d203944050/mobile_nav_overlap_fixed.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Mock GAS response
  await page.route("https://script.google.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "jsonp_callback_data()",
    });
  });

  // Inject fixtures
  await page.addInitScript(
    ({ profile, dailyTqqq, dailySoxl }) => {
      localStorage.setItem("ib_profiles", JSON.stringify(profile));
      localStorage.setItem(dailyTqqq.storageKey, JSON.stringify(dailyTqqq.payload));
      localStorage.setItem(dailySoxl.storageKey, JSON.stringify(dailySoxl.payload));
    },
    {
      profile: PROFILE_MULTI,
      dailyTqqq: DAILY_MULTI_TQQQ,
      dailySoxl: DAILY_MULTI_SOXL,
    },
  );

  await page.goto(`${baseUrl}/ib?v2=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=멀티 티커", { timeout: 15_000 });

  // Measure DOM state and scroll behaviour
  const metricsBeforeScroll = await page.evaluate(() => {
    const scrollEl = document.querySelector(".ib-scroll") as HTMLElement;
    const docScroll = document.scrollingElement;
    
    return {
      ibScrollBefore: {
        scrollTop: scrollEl ? scrollEl.scrollTop : -1,
        scrollHeight: scrollEl ? scrollEl.scrollHeight : -1,
        clientHeight: scrollEl ? scrollEl.clientHeight : -1,
      },
      docScrollBefore: {
        scrollTop: docScroll ? docScroll.scrollTop : -1,
        scrollHeight: docScroll ? docScroll.scrollHeight : -1,
        innerHeight: window.innerHeight,
      }
    };
  });

  // Execute scroll action
  const metricsAfterScroll = await page.evaluate(() => {
    const scrollEl = document.querySelector(".ib-scroll") as HTMLElement;
    const docScroll = document.scrollingElement;
    
    // Attempt internal scroll on .ib-scroll
    if (scrollEl) {
      scrollEl.scrollTop = 250;
    }

    // Attempt document level scroll
    if (docScroll) {
      docScroll.scrollTop = 300;
    }

    return {
      ibScrollAfter: {
        scrollTop: scrollEl ? scrollEl.scrollTop : -1,
        scrollHeight: scrollEl ? scrollEl.scrollHeight : -1,
        clientHeight: scrollEl ? scrollEl.clientHeight : -1,
      },
      docScrollAfter: {
        scrollTop: docScroll ? docScroll.scrollTop : -1,
        scrollHeight: docScroll ? docScroll.scrollHeight : -1,
        innerHeight: window.innerHeight,
      }
    };
  });

  // Capture final screenshot at scroll state
  await page.screenshot({ path: savePath });
  
  console.log("=== VERIFY METRICS ===");
  console.log(JSON.stringify({ metricsBeforeScroll, metricsAfterScroll }, null, 2));
  console.log(`[CAPTURE] Fixed screenshot saved at: ${savePath}`);

  await browser.close();
}

main().catch((error) => {
  console.error("[METRICS] FAIL", error);
  process.exit(1);
});
