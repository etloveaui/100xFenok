/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");

const base = process.env.QA_BASE_URL || "http://127.0.0.1:4173";
const adminPassword = process.env.QA_ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error("QA_ADMIN_PASSWORD is required.");
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function clearAdminSession(page) {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    try {
      await fetch("/api/admin/session", {
        method: "DELETE",
        cache: "no-store",
      });
    } catch {
      // ignore
    }
    sessionStorage.removeItem("adminAuth");
    sessionStorage.removeItem("adminVerifyFailCount");
    sessionStorage.removeItem("adminVerifyLockUntil");
  });
}

async function createAdminSession(page) {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async (password) => {
    await fetch("/api/admin/session", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ password }),
    });
  }, adminPassword);
}

async function runGateFlow(page) {
  await clearAdminSession(page);
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByText("관리자 인증").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("heading", { name: "Admin Hub" }).waitFor({ state: "visible", timeout: 10000 });
  return page.evaluate(() => sessionStorage.getItem("adminAuth"));
}

async function runFooterFlow(page) {
  await clearAdminSession(page);
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
  await createAdminSession(page);
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Admin Hub" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "세션 종료" }).click();
  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 10000 });
  const adminButton = page.getByRole("button", { name: /Admin/ });
  await adminButton.waitFor({ state: "visible", timeout: 10000 });
  const buttonAriaLabel = await adminButton.getAttribute("aria-label");

  await adminButton.click();
  await page.getByRole("dialog", { name: "Admin Access Control" }).waitFor({ state: "visible", timeout: 10000 });
  const dialogOpenedByButton = await page.getByRole("dialog", { name: "Admin Access Control" }).isVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog", { name: "Admin Access Control" }).waitFor({ state: "hidden", timeout: 10000 });

  await page.keyboard.press("Alt+A");
  await page.getByRole("dialog", { name: "Admin Access Control" }).waitFor({ state: "visible", timeout: 10000 });
  const dialogOpenedByShortcut = await page.getByRole("dialog", { name: "Admin Access Control" }).isVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog", { name: "Admin Access Control" }).waitFor({ state: "hidden", timeout: 10000 });

  return {
    authAfterLogout: await page.evaluate(() => sessionStorage.getItem("adminAuth")),
    buttonAriaLabel,
    dialogOpenedByButton,
    dialogOpenedByShortcut,
  };
}

async function runAuthenticatedShortcutFlow(page) {
  await createAdminSession(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await page.mouse.click(16, 16);
  await page.keyboard.press("Alt+A");
  await page.waitForURL((url) => new URL(url).pathname === "/admin/", { timeout: 10000 });
  await page.getByRole("heading", { name: "Admin Hub" }).waitFor({ state: "visible", timeout: 10000 });
  return page.evaluate(() => sessionStorage.getItem("adminAuth"));
}

async function runGateLockFlow(page) {
  await clearAdminSession(page);
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByText("관리자 인증").waitFor({ state: "visible", timeout: 10000 });
  const passwordInput = page.getByLabel("Password");
  const confirmButton = page.getByRole("button", { name: "Confirm" });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await passwordInput.fill("wrong-password");
    await confirmButton.click();
    if (attempt < 2) {
      await page.waitForFunction(
        () => {
          const input = document.getElementById("admin-auth-input");
          return input instanceof HTMLInputElement && input.value === "";
        },
        { timeout: 3000 },
      );
    }
  }

  await page.getByText("보호 모드 활성화", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  return {
    helperText: await page.getByText("보호 모드 활성화", { exact: false }).textContent(),
    confirmDisabled: await page.getByRole("button", { name: "Confirm" }).isDisabled(),
    passwordDisabled: await page.getByLabel("Password").isDisabled(),
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const viewport of viewports) {
    const check = {
      viewport: viewport.name,
      gateAuth: null,
      footerAuth: null,
      fastEntry: null,
      authenticatedShortcutAuth: null,
      gateLock: null,
      pass: false,
      error: null,
    };

    try {
      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        check.gateAuth = await runGateFlow(page);
        await context.close();
      }

      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        check.footerAuth = await runFooterFlow(page);
        await context.close();
      }

      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        check.fastEntry = await runFastEntryFlow(page);
        await context.close();
      }

      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        check.authenticatedShortcutAuth = await runAuthenticatedShortcutFlow(page);
        await context.close();
      }

      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        check.gateLock = await runGateLockFlow(page);
        await context.close();
      }

      check.pass =
        check.gateAuth === "true" &&
        check.footerAuth === "true" &&
        check.fastEntry?.authAfterLogout === null &&
        check.fastEntry?.buttonAriaLabel === "Admin" &&
        check.fastEntry?.dialogOpenedByButton === true &&
        check.fastEntry?.dialogOpenedByShortcut === true &&
        check.authenticatedShortcutAuth === "true" &&
        check.gateLock?.confirmDisabled === true &&
        check.gateLock?.passwordDisabled === true;
    } catch (error) {
      check.error = String(error);
      check.pass = false;
    }

    results.push(check);
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
