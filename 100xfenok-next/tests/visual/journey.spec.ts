import { test, expect } from "./fixtures";
import type { Page, TestInfo } from "@playwright/test";

async function attachJourneyScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
}

test("journey: stock investor pivot keeps the canonical tab and ticker", async ({ page }, testInfo) => {
  const response = await page.goto("/superinvestors?tab=stocks&ticker=NVDA", { waitUntil: "domcontentloaded" });
  expect(response?.status(), "stock pivot response").toBeLessThan(400);
  await expect(page.locator('[data-superinvestors-tab="stocks"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-superinvestors-whoholds-input]')).toHaveValue("NVDA");
  await expect(page.locator('[data-superinvestors-whoholds-result="NVDA"]')).toBeVisible();
  const input = page.locator('[data-superinvestors-whoholds-input]');
  await input.fill("MSFT");
  await input.press("Enter");
  await expect(page).toHaveURL(/ticker=MSFT/);
  await expect(page.locator('[data-superinvestors-whoholds-result="MSFT"]')).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(input).toHaveValue("MSFT");
  await expect(page.locator('[data-superinvestors-whoholds-result="MSFT"]')).toBeVisible();
  await attachJourneyScreenshot(page, testInfo, "stock-investor-pivot.png");
});

test("journey: screener stock return keeps the exact filter URL and selected ticker", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const source = "/screener?ticker=NVDA&sector=Technology&mode=analyze";
  const response = await page.goto(source, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "screener response").toBeLessThan(400);

  const cardMode = page.locator('[data-screener-view-mode-option="card"]:visible').first();
  await expect(cardMode).toBeVisible();
  await cardMode.click();
  const card = page.locator('[data-screener-stock-card]:visible').filter({ hasText: "NVDA" }).first();
  const mobile = (page.viewportSize()?.width ?? 1440) <= 920;
  const checkbox = card.locator('input[type="checkbox"]').first();
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  if (mobile) {
    const expand = card.getByRole("button", { name: /NVDA 상세/ });
    if (await expand.getAttribute("aria-expanded") !== "true") await expand.click();
    await expect(card.locator('[id^="screener-mobile-detail-NVDA"]')).toBeVisible();
  }
  const detailLink = mobile
    ? card.getByRole("link", { name: "종목 상세" })
    : card.getByRole("link", { name: "상세" }).first();
  const expectedSource = new URL(page.url());
  await expect(detailLink).toHaveAttribute("href", /returnTo=/);
  if (mobile) {
    const target = await detailLink.boundingBox();
    expect(target?.height ?? 0, "mobile detail touch target").toBeGreaterThanOrEqual(44);
  }
  expect(new URL(await detailLink.getAttribute("href") ?? "", page.url()).searchParams.get("returnTo"))
    .toBe(`${expectedSource.pathname}${expectedSource.search}${expectedSource.hash}`);
  await detailLink.click();
  await expect(page).toHaveURL(/\/stock\/NVDA\?.*returnTo=/);
  const explicitBack = page.locator('a[aria-label="뒤로"]:visible, a[aria-label$="돌아가기"]:visible').first();
  await expect(explicitBack).toBeVisible();
  await expect(explicitBack).toHaveAttribute("aria-label", "스크리너로 돌아가기");
  await explicitBack.click();
  await expect(page).toHaveURL(expectedSource.href);
  const restoredCardMode = page.locator('[data-screener-view-mode-option="card"]:visible').first();
  await expect(restoredCardMode).toBeVisible();
  await restoredCardMode.click();
  const restoredCard = page.locator('[data-screener-stock-card]:visible').filter({ hasText: "NVDA" }).first();
  await expect(restoredCard.locator('input[type="checkbox"]').first()).toBeChecked();
  if (mobile) {
    const expand = restoredCard.getByRole("button", { name: /NVDA 상세/ });
    if (await expand.getAttribute("aria-expanded") !== "true") await expand.click();
    await expect(restoredCard.locator('[id^="screener-mobile-detail-NVDA"]')).toBeVisible();
  }
  const restoredDetailLink = mobile
    ? restoredCard.getByRole("link", { name: "종목 상세" })
    : restoredCard.getByRole("link", { name: "상세" }).first();
  await restoredDetailLink.click();
  await expect(page).toHaveURL(/\/stock\/NVDA\?.*returnTo=/);
  await page.goBack();
  await expect(page).toHaveURL(expectedSource.href);
  const backCardMode = page.locator('[data-screener-view-mode-option="card"]:visible').first();
  await expect(backCardMode).toBeVisible();
  await backCardMode.click();
  const backCard = page.locator('[data-screener-stock-card]:visible').filter({ hasText: "NVDA" }).first();
  await expect(backCard.locator('input[type="checkbox"]').first()).toBeChecked();
  await page.goForward();
  await expect(page).toHaveURL(/\/stock\/NVDA\?.*returnTo=/);
  await page.goBack();
  await expect(backCard.locator('input[type="checkbox"]').first()).toBeChecked();
  await backCard.locator('input[type="checkbox"]').first().uncheck();
  if (mobile) {
    const expand = backCard.getByRole("button", { name: /NVDA 상세/ });
    if (await expand.getAttribute("aria-expanded") !== "true") await expand.click();
  }
  await backCard.getByRole("link", { name: mobile ? "종목 상세" : "상세", exact: true }).first().click();
  await expect(page).toHaveURL(/\/stock\/NVDA\?.*returnTo=/);
  await page.getByRole("link", { name: "스크리너로 돌아가기", exact: true }).filter({ visible: true }).click();
  await expect(backCard.locator('input[type="checkbox"]').first()).not.toBeChecked();
  await attachJourneyScreenshot(page, testInfo, "screener-return.png");
});

test("journey: guru stock detail returns to the guru context", async ({ page }, testInfo) => {
  const response = await page.goto("/superinvestors?tab=investors", { waitUntil: "domcontentloaded" });
  expect(response?.status(), "superinvestor response").toBeLessThan(400);
  const holder = page.locator("[data-superinvestors-holder-row]:visible").first();
  await expect(holder).toBeVisible();
  await holder.click();
  await expect(page.locator("[data-superinvestors-guru-detail-view]:visible")).toBeVisible();
  const desktop = (page.viewportSize()?.width ?? 1440) > 920;
  const holdingsScroll = page.locator('[data-journey-holdings-scroll]:visible');
  const holdingLinks = page.locator('[data-superinvestors-guru-detail-view] a[href^="/stock/"]:visible');
  await expect(holdingLinks.first()).toBeVisible();
  if (desktop) {
    await expect.poll(() => holdingLinks.count()).toBeGreaterThan(12);
    await holdingsScroll.evaluate((node) => { node.scrollTop = 240; });
  }
  const stockLink = desktop ? holdingLinks.nth(12) : holdingLinks.first();
  await stockLink.scrollIntoViewIfNeeded();
  const expectedInnerTop = desktop ? await holdingsScroll.evaluate((node) => node.scrollTop) : 0;
  if (desktop) expect(expectedInnerTop).toBeGreaterThan(0);
  await expect(stockLink).toHaveAttribute("href", /returnTo=/);
  const returnHref = await stockLink.getAttribute("href");
  expect(returnHref).toContain("returnTo=%2Fsuperinvestors");
  await stockLink.click();
  await expect(page).toHaveURL(/\/stock\/[^/?]+\?.*returnTo=/);
  const explicitBack = page.locator('a[aria-label="뒤로"]:visible, a[aria-label$="돌아가기"]:visible').first();
  await expect(explicitBack).toBeVisible();
  await expect(explicitBack).toHaveAttribute("aria-label", "투자자 화면으로 돌아가기");
  await explicitBack.click();
  await expect(page).toHaveURL(/\/superinvestors\?.*tab=investors.*guru=/);
  await expect(page.locator("[data-superinvestors-guru-detail-view]:visible")).toBeVisible();
  if (desktop) {
    await expect.poll(() => holdingsScroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(expectedInnerTop - 50);
  }
  await attachJourneyScreenshot(page, testInfo, "guru-return.png");
});


test("journey: default discovery retains its comparison selection", async ({ page }, testInfo) => {
  await page.goto("/screener", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-screener-mode="discover"]')).toBeVisible();
  const result = page.locator('[data-discover-results] > li').first();
  await expect(result).toBeVisible();
  const compare = result.getByRole("button", { name: "비교", exact: true });
  await compare.click();
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  const open = result.getByRole("link", { name: "열기", exact: true });
  await expect(open).toHaveAttribute("href", /returnTo=/);
  await open.click();
  await expect(page).toHaveURL(/\/stock\/[^/?]+\?.*returnTo=/);
  await page.getByRole("link", { name: "스크리너로 돌아가기", exact: true }).filter({ visible: true }).click();
  await expect(page.locator('[data-screener-mode="discover"]')).toBeVisible();
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await attachJourneyScreenshot(page, testInfo, "discovery-return.png");
});


test("journey: late enrichment respects a changed selection", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/screener?mode=analyze&ticker=NVDA", { waitUntil: "domcontentloaded" });
  await page.locator('[data-screener-view-mode-option="card"]:visible').first().click();
  const card = page.locator('[data-screener-stock-card]:visible').filter({ hasText: "NVDA" }).first();
  const checkbox = card.locator('input[type="checkbox"]').first();
  await checkbox.check();
  const mobile = (page.viewportSize()?.width ?? 1440) <= 920;
  if (mobile) {
    const expand = card.getByRole("button", { name: /NVDA 상세/ });
    if (await expand.getAttribute("aria-expanded") !== "true") await expand.click();
  }
  await card.getByRole("link", { name: mobile ? "종목 상세" : "상세", exact: true }).first().click();
  await expect(page).toHaveURL(/\/stock\/NVDA\?.*returnTo=/);
  let release: (() => void) | undefined;
  let intercepted = false;
  await page.route("**/data/sec-13f/analytics/guru_holders_index.json", async (route) => {
    intercepted = true;
    await new Promise<void>((resolve) => { release = resolve; });
    await route.continue();
  });
  try {
    await page.getByRole("link", { name: "스크리너로 돌아가기", exact: true }).filter({ visible: true }).click();
    await expect.poll(() => intercepted).toBe(true);
    await expect(checkbox).toBeVisible();
    await checkbox.check();
    await checkbox.uncheck();
    const responsePromise = page.waitForResponse((response) => response.url().includes("guru_holders_index.json"));
    release?.();
    const response = await responsePromise;
    await response.finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(checkbox).not.toBeChecked();
  } finally {
    release?.();
  }
});
