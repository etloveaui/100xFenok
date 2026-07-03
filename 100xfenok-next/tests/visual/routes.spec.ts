import { test, expect } from "./fixtures";
import { waitForStableFonts } from "./helpers/waitForStableFonts";

interface VisualRoute {
  name: string;
  path: string;
  extraMask?: string[];
}

const ROUTES: VisualRoute[] = [
  { name: "home", path: "/" },
  { name: "screener", path: "/screener" },
  { name: "stock-nvda", path: "/stock/NVDA" },
  { name: "market-valuation", path: "/market-valuation" },
  { name: "regime", path: "/regime" },
  { name: "sectors", path: "/sectors" },
  { name: "etfs", path: "/etfs" },
  { name: "superinvestors", path: "/superinvestors" },
  { name: "macro-chart", path: "/macro-chart" },
];

const skipRoutes = new Set(
  (process.env.VRT_SKIP_ROUTES ?? "")
    .split(",")
    .map((routeName) => routeName.trim())
    .filter(Boolean),
);

for (const route of ROUTES) {
  test(`visual: ${route.name}`, async ({ page }) => {
    test.skip(skipRoutes.has(route.name), `Skipped by VRT_SKIP_ROUTES=${process.env.VRT_SKIP_ROUTES}`);

    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `HTTP status for ${route.path}`).toBeLessThan(400);

    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await waitForStableFonts(page);

    const mask = [
      page.locator("[data-vrt-mask]"),
      ...(route.extraMask ?? []).map((selector) => page.locator(selector)),
    ];

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: true,
      mask,
    });
  });
}
