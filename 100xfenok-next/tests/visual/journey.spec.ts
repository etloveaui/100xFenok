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
  await attachJourneyScreenshot(page, testInfo, "stock-investor-pivot.png");
});

test("journey: screener stock return keeps the exact filter URL and selected ticker", async ({ page }, testInfo) => {
  const source = "/screener?ticker=NVDA&sector=Technology";
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
    await card.getByRole("button", { name: /NVDA 상세 펼치기/ }).click();
    await expect(card.locator('[id^="screener-mobile-detail-NVDA"]')).toBeVisible();
  }
  const detailLink = mobile
    ? card.getByRole("link", { name: "종목 상세" })
    : card.getByRole("link", { name: "상세" }).first();
  await expect(detailLink).toHaveAttribute("href", /returnTo=/);
  await detailLink.click();
  await expect(page).toHaveURL(/\/stock\/NVDA\?.*returnTo=/);
  const explicitBack = page.locator('a[aria-label="뒤로"]:visible, a[aria-label$="돌아가기"]:visible').first();
  await expect(explicitBack).toBeVisible();
  await expect(explicitBack).toHaveAttribute("aria-label", "스크리너로 돌아가기");
  await explicitBack.click();
  await expect(page).toHaveURL(/\/screener\?ticker=NVDA&sector=Technology/);
  const restoredCardMode = page.locator('[data-screener-view-mode-option="card"]:visible').first();
  await expect(restoredCardMode).toBeVisible();
  await restoredCardMode.click();
  const restoredCard = page.locator('[data-screener-stock-card]:visible').filter({ hasText: "NVDA" }).first();
  await expect(restoredCard.locator('input[type="checkbox"]').first()).toBeChecked();
  if (mobile) {
    await restoredCard.getByRole("button", { name: /NVDA 상세 펼치기/ }).click();
    await expect(restoredCard.locator('[id^="screener-mobile-detail-NVDA"]')).toBeVisible();
  }
  const restoredDetailLink = mobile
    ? restoredCard.getByRole("link", { name: "종목 상세" })
    : restoredCard.getByRole("link", { name: "상세" }).first();
  await restoredDetailLink.click();
  await expect(page).toHaveURL(/\/stock\/NVDA\?.*returnTo=/);
  await page.goBack();
  await expect(page).toHaveURL(/\/screener\?ticker=NVDA&sector=Technology/);
  const backCardMode = page.locator('[data-screener-view-mode-option="card"]:visible').first();
  await expect(backCardMode).toBeVisible();
  await backCardMode.click();
  const backCard = page.locator('[data-screener-stock-card]:visible').filter({ hasText: "NVDA" }).first();
  await expect(backCard.locator('input[type="checkbox"]').first()).toBeChecked();
  await attachJourneyScreenshot(page, testInfo, "screener-return.png");
});

test("journey: guru stock detail returns to the guru context", async ({ page }, testInfo) => {
  const response = await page.goto("/superinvestors?tab=investors", { waitUntil: "domcontentloaded" });
  expect(response?.status(), "superinvestor response").toBeLessThan(400);
  const holder = page.locator("[data-superinvestors-holder-row]:visible").first();
  await expect(holder).toBeVisible();
  await holder.click();
  await expect(page.locator("[data-superinvestors-guru-detail-view]:visible")).toBeVisible();
  const stockLink = page.locator('[data-superinvestors-guru-detail-view] a[href^="/stock/"]:visible').first();
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
  await attachJourneyScreenshot(page, testInfo, "guru-return.png");
});
