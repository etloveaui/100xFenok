import type { Page } from "@playwright/test";

export async function waitForStableFonts(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (!fonts?.ready) return true;
    await fonts.ready;
    return fonts.status === "loaded";
  });
}
