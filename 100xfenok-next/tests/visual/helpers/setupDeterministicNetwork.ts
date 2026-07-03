import type { BrowserContext } from "@playwright/test";

export interface DeterministicNetworkOptions {
  fixedNowISO?: string;
  harPath?: string;
  harUrlGlob?: string;
}

export async function setupDeterministicNetwork(
  context: BrowserContext,
  options: DeterministicNetworkOptions = {},
): Promise<void> {
  const { fixedNowISO = "2026-01-15T09:00:00.000Z", harPath, harUrlGlob = "**/api/**" } = options;

  if (harPath) {
    await context.routeFromHAR(harPath, { url: harUrlGlob, update: false });
  }

  await context.route("**/api/**/server-time", async (route) => {
    await route.fulfill({ json: { now: fixedNowISO } });
  });

  await context.route("**/analytics/**", (route) => route.abort());
  await context.route("**/*vitals*", (route) => route.abort());
  await context.route("**/ws/**", (route) => route.abort());
}
