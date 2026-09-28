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

// Obsolete expectations: explicit not-applicable
// reasons, deliberately NOT reported as pass=true. Rechecked with raw recursive
// greps (ignore rules bypassed): 'Admin Access Control' 0, button "Admin" 0,
// altKey listener 0 in scoped src.
const NOT_APPLICABLE = {
  footerAuth:
    "not_applicable: footer button 'Admin' and dialog 'Admin Access Control' never existed in product source (raw recursive grep 0 hits; git -S hits only harness commit ae2318a686)",
  fastEntry:
    "not_applicable: depends on never-shipped 'Admin Access Control' dialog; Alt+A listener absent (raw altKey 0 hits in scoped src; CommandPalette keys are Cmd/Ctrl+K, ?, g-s/g-h)",
  authenticatedShortcutAuth:
    "not_applicable: Alt+A has no product listener in scoped src (raw altKey 0 hits); no authenticated navigation binding",
};

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

async function loginViaGate(page) {
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByText("관리자 인증").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("heading", { name: "Admin Hub" }).waitFor({ state: "visible", timeout: 10000 });
}

// 1) Direct gate valid login.
async function runGateFlow(page) {
  await clearAdminSession(page);
  await loginViaGate(page);
  return page.evaluate(() => sessionStorage.getItem("adminAuth"));
}

// 2) Session persistence / re-entry: after a real gate login, a fresh
// navigation to /admin must land on Admin Hub without the gate prompt.
async function runPersistenceFlow(page) {
  await clearAdminSession(page);
  await loginViaGate(page);
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Admin Hub" }).waitFor({ state: "visible", timeout: 10000 });
  const reentryGateCount = await page.getByText("관리자 인증").count();
  const reentryHubCount = await page.getByRole("heading", { name: "Admin Hub" }).count();
  return {
    adminAuth: await page.evaluate(() => sessionStorage.getItem("adminAuth")),
    reentrySawHub: reentryHubCount > 0,
    reentrySawGate: reentryGateCount > 0,
  };
}

// 3) Real authenticated-hub logout (AdminSessionControl rendered by
// admin/layout for authenticated users): 세션 종료 -> logoutAdminSession ->
// router.push("/") -> fresh /admin must gate again.
async function runLogoutFlow(page) {
  await clearAdminSession(page);
  await loginViaGate(page);

  await page.getByText("Admin Session Active").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "세션 종료" }).click();
  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 10000 });
  const pathnameAfterLogout = new URL(page.url()).pathname;
  const authAfterLogout = await page.evaluate(() => sessionStorage.getItem("adminAuth"));

  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByText("관리자 인증").waitFor({ state: "visible", timeout: 10000 });
  const hubAfterReentry = await page.getByRole("heading", { name: "Admin Hub" }).count();
  return {
    sawSessionControl: true,
    pathnameAfterLogout,
    navigatedHome: pathnameAfterLogout === "/",
    authAfterLogout,
    gateOnReentry: true,
    hubAfterReentry: hubAfterReentry > 0,
  };
}

// 4) Wrong-password lock AND Reset in ONE context (throttle-aware): server
// admin-login-throttle locks at 5 failures/5min and a successful login calls
// clearAdminLoginFailures, so all success flows run FIRST and this combined
// flow spends only the 3 allowed failures per viewport. Reset is proven as
// the UNAUTHENTICATED gate action (AdminAccessGate renders it only when
// !authenticated) - distinct from 세션 종료 above.
async function runLockResetFlow(page) {
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
  const lock = {
    helperText: await page.getByText("보호 모드 활성화", { exact: false }).textContent(),
    confirmDisabled: await page.getByRole("button", { name: "Confirm" }).isDisabled(),
    passwordDisabled: await passwordInput.isDisabled(),
  };

  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByText("관리자 비밀번호를 입력해야 대시보드를 볼 수 있습니다.", {
    exact: false,
  }).waitFor({ state: "visible", timeout: 10000 });

  const inputValue = await passwordInput.inputValue();
  // Confirm is disabled while the password is empty by design
  // (isVerifying || lockRemainingMs > 0 || password.trim().length === 0).
  // Prove the LOCK itself cleared by typing after Reset and observing Confirm
  // become enabled (typing only - no submit, no login attempt).
  const confirmDisabledWhileEmpty = await confirmButton.isDisabled();
  await passwordInput.fill("proof-typing-only");
  const confirmEnabledAfterFill = (await confirmButton.isDisabled()) === false;
  const reset = {
    inputCleared: inputValue === "",
    lockCleared: (await page.getByText("보호 모드 활성화", { exact: false }).count()) === 0,
    confirmDisabledWhileEmpty,
    confirmEnabledAfterFill,
    stillAtGate:
      (await page.getByText("관리자 인증").count()) > 0 &&
      (await page.getByRole("heading", { name: "Admin Hub" }).count()) === 0,
  };
  return { lock, reset };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const viewport of viewports) {
    const check = {
      viewport: viewport.name,
      gateAuth: null,
      persistence: null,
      logout: null,
      gateLock: null,
      reset: null,
      footerAuth: NOT_APPLICABLE.footerAuth,
      fastEntry: NOT_APPLICABLE.fastEntry,
      authenticatedShortcutAuth: NOT_APPLICABLE.authenticatedShortcutAuth,
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
        check.persistence = await runPersistenceFlow(page);
        await context.close();
      }

      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        check.logout = await runLogoutFlow(page);
        await context.close();
      }

      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        const combined = await runLockResetFlow(page);
        check.gateLock = combined.lock;
        check.reset = combined.reset;
        await context.close();
      }

      check.pass =
        check.gateAuth === "true" &&
        check.persistence?.adminAuth === "true" &&
        check.persistence?.reentrySawHub === true &&
        check.persistence?.reentrySawGate === false &&
        check.logout?.sawSessionControl === true &&
        check.logout?.navigatedHome === true &&
        check.logout?.authAfterLogout === null &&
        check.logout?.gateOnReentry === true &&
        check.logout?.hubAfterReentry === false &&
        typeof check.gateLock?.helperText === "string" &&
        check.gateLock.helperText.includes("보호 모드 활성화") &&
        check.gateLock?.confirmDisabled === true &&
        check.gateLock?.passwordDisabled === true &&
        check.reset?.inputCleared === true &&
        check.reset?.lockCleared === true &&
        check.reset?.confirmDisabledWhileEmpty === true &&
        check.reset?.confirmEnabledAfterFill === true &&
        check.reset?.stillAtGate === true &&
        String(check.footerAuth).startsWith("not_applicable:") &&
        String(check.fastEntry).startsWith("not_applicable:") &&
        String(check.authenticatedShortcutAuth).startsWith("not_applicable:");
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
