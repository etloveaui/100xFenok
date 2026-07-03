import { test as base, expect } from "@playwright/test";
import { seedRng } from "./helpers/seedRng";
import { setupDeterministicNetwork } from "./helpers/setupDeterministicNetwork";

export const FIXED_INSTANT = "2026-01-15T09:00:00.000Z";

export const test = base.extend({
  page: async ({ page, context }, use) => {
    await context.addInitScript(() => {
      (window as unknown as { __DISABLE_ANIMATIONS__: boolean }).__DISABLE_ANIMATIONS__ = true;
    });

    await seedRng(context);
    await setupDeterministicNetwork(context, {
      fixedNowISO: FIXED_INSTANT,
      harPath: process.env.VRT_HAR_PATH,
      harUrlGlob: process.env.VRT_HAR_URL_GLOB,
    });

    await page.clock.setFixedTime(new Date(FIXED_INSTANT));
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    page.setDefaultTimeout(10_000);

    await use(page);
  },
});

export { expect };
