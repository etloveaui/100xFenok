/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");

const pageUrl = process.env.QA_IB_HELPER_URL || "file:///Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomono/00_Project/100xFenok-platform/source/100xFenok/ib/ib-helper/index.html";

const viewports = [
  { name: "fold", width: 280, height: 653 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();

    try {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 45000 });
      await page.evaluate(() => {
        const main = document.getElementById("main-content");
        const emptyState = document.getElementById("empty-state");
        const section = document.getElementById("multi-results-section");
        const accordion = document.getElementById("results-accordion");
        if (main instanceof HTMLElement) {
          main.style.display = "block";
        }
        if (emptyState instanceof HTMLElement) {
          emptyState.classList.add("hidden");
        }
        if (!(section instanceof HTMLElement) || !(accordion instanceof HTMLElement)) {
          throw new Error("results_dom_missing");
        }
        section.classList.remove("hidden");
        accordion.innerHTML = `
          <div class="accordion-item open" data-ticker="TQQQ">
            <div class="accordion-header">
              <div class="flex items-center gap-2">
                <span class="font-bold text-lg">TQQQ</span>
                <span class="accordion-badge accordion-badge-first">초반전</span>
              </div>
              <div class="flex items-center gap-4">
                <span class="text-sm text-slate-300">T=12.3</span>
                <i class="fas fa-chevron-down accordion-chevron"></i>
              </div>
            </div>
            <div class="accordion-content" style="display:block;">
              <div class="grid grid-cols-3 gap-2 mb-3 text-center">
                <div class="bg-white rounded-lg p-2 shadow-sm">
                  <div class="text-xs text-gray-500">별%</div>
                  <div class="font-semibold">12.4%</div>
                </div>
                <div class="bg-white rounded-lg p-2 shadow-sm">
                  <div class="text-xs text-gray-500">1회매수</div>
                  <div class="font-semibold">$1,234</div>
                </div>
                <div class="bg-white rounded-lg p-2 shadow-sm">
                  <div class="text-xs text-gray-500">LOC가</div>
                  <div class="font-semibold">$62.33</div>
                </div>
              </div>
              <div class="order-section">
                <div class="space-y-1 text-sm">
                  <div class="flex justify-between bg-white rounded px-2 py-1 items-center">
                    <span class="text-gray-600">기본-평단LOC</span>
                    <div class="flex items-center gap-2">
                      <button class="order-copy-btn qty-copy-btn touch-target">123주</button>
                      <span class="text-gray-400 text-xs">x</span>
                      <button class="order-copy-btn touch-target">62.33</button>
                    </div>
                  </div>
                  <div class="flex justify-between bg-white rounded px-2 py-1 items-center">
                    <span class="text-gray-600">지정가 매도</span>
                    <div class="flex items-center gap-2">
                      <button class="order-copy-btn qty-copy-btn touch-target">61주</button>
                      <span class="text-gray-400 text-xs">x</span>
                      <button class="order-copy-btn touch-target">66.10</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        const section = document.getElementById("multi-results-section");
        const accordion = document.querySelector(".accordion-item");
        const header = document.querySelector(".accordion-header");
        const headerLeft = header?.children?.[0];
        const headerRight = header?.children?.[1];
        const summaryGrid = document.querySelector(".accordion-content > .grid.grid-cols-3");
        const orderRows = Array.from(document.querySelectorAll(".accordion-content .flex.justify-between.bg-white.rounded.px-2.py-1.items-center"));

        const dims = (node) => {
          if (!(node instanceof HTMLElement)) return null;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            width: rect.width,
            height: rect.height,
            display: style.display,
            flexDirection: style.flexDirection,
            gridTemplateColumns: style.gridTemplateColumns,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          };
        };

        return {
          bodyScrollWidth: document.documentElement.scrollWidth,
          bodyClientWidth: document.documentElement.clientWidth,
          section: dims(section),
          accordion: dims(accordion),
          header: dims(header),
          headerLeft: dims(headerLeft),
          headerRight: dims(headerRight),
          summaryGrid: dims(summaryGrid),
          orderRows: orderRows.map((row) => dims(row)),
        };
      });

      const screenshotPath = `/tmp/ib-helper-fold-${viewport.name}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const hasHorizontalOverflow = metrics.bodyScrollWidth > metrics.bodyClientWidth + 1;
      const summaryColumnCount = (metrics.summaryGrid?.gridTemplateColumns || "").split(" ").filter(Boolean).length;
      const orderRowDirections = metrics.orderRows.map((row) => row?.flexDirection || null);
      const orderRowsStacked = orderRowDirections.every((direction) => direction === "column");
      const foldHeaderWrapped = (metrics.headerLeft?.width || 0) >= ((metrics.header?.width || 0) - 1);

      const pass = viewport.name === "fold"
        ? !hasHorizontalOverflow && summaryColumnCount === 1 && orderRowsStacked && (metrics.header?.flexDirection === "column" || foldHeaderWrapped)
        : !hasHorizontalOverflow && summaryColumnCount === 3 && orderRowDirections.every((direction) => direction === "row");

      results.push({
        viewport: viewport.name,
        screenshotPath,
        pass,
        hasHorizontalOverflow,
        summaryColumnCount,
        orderRowDirections,
        headerFlexDirection: metrics.header?.flexDirection || null,
        headerLeftWidth: metrics.headerLeft?.width || null,
        headerWidth: metrics.header?.width || null,
        bodyScrollWidth: metrics.bodyScrollWidth,
        bodyClientWidth: metrics.bodyClientWidth,
      });
    } catch (error) {
      results.push({ viewport: viewport.name, pass: false, error: String(error) });
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log(JSON.stringify({ results, failures: results.filter((item) => !item.pass) }, null, 2));
  if (results.some((item) => !item.pass)) {
    process.exit(1);
  }
})();
