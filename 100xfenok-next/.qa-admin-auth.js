/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");

const base = process.env.QA_BASE_URL || "http://127.0.0.1:4173";
const adminPassword = process.env.QA_ADMIN_PASSWORD || "Rladmsxo1!";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function runGateFlow(page) {
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByText("관리자 인증").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("heading", { name: "Admin Hub" }).waitFor({ state: "visible", timeout: 10000 });
  return page.evaluate(() => sessionStorage.getItem("adminAuth"));
}

async function runFooterFlow(page) {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => sessionStorage.removeItem("adminAuth"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Admin" }).click();
  await page.getByRole("dialog", { name: "Admin Access Control" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByPlaceholder("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL("**/admin**", { timeout: 10000 });
  await page.getByRole("heading", { name: "Admin Hub" }).waitFor({ state: "visible", timeout: 10000 });
  return page.evaluate(() => sessionStorage.getItem("adminAuth"));
}

async function runFastEntryFlow(page) {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => sessionStorage.setItem("adminAuth", "true"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Admin/ }).click();
  await page.waitForURL("**/admin**", { timeout: 10000 });
  await page.getByRole("button", { name: "세션 종료" }).click();
  await page.waitForURL("**/", { timeout: 10000 });
  return page.evaluate(() => sessionStorage.getItem("adminAuth"));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    const check = {
      viewport: viewport.name,
      gateAuth: null,
      footerAuth: null,
      fastEntryAuthAfterLogout: null,
      pass: false,
      error: null,
    };

    try {
      check.gateAuth = await runGateFlow(page);
      check.footerAuth = await runFooterFlow(page);
      check.fastEntryAuthAfterLogout = await runFastEntryFlow(page);
      check.pass =
        check.gateAuth === "true" &&
        check.footerAuth === "true" &&
        check.fastEntryAuthAfterLogout === null;
    } catch (error) {
      check.error = String(error);
      check.pass = false;
    }

    results.push(check);
    await context.close();
  }

  await browser.close();

  const failures = results.filter((item) => !item.pass);
  console.log(
    JSON.stringify(
      {
        base,
        total: results.length,
        failures: failures.length,
        results,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
})();
