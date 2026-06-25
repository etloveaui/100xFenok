import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

const errors = [];
const nextConfig = read("next.config.ts");
const middleware = read("middleware.ts");
const publicRobots = read("public/robots.txt");
const appRobots = read("src/app/robots.ts");
const sitemap = read("src/app/sitemap.ts");
const siteUrl = read("src/lib/site-url.ts");
const stockPage = read("src/app/stock/[ticker]/page.tsx");
const etfPage = read("src/app/etfs/[ticker]/page.tsx");
const routes = read("src/lib/routes.ts");

assert(
  !nextConfig.includes('source: "/travel/:path*"'),
  "next.config.ts must not expose a permanent /travel -> admin redirect",
  errors,
);
assert(
  !nextConfig.includes('"X-Robots-Tag"') && !nextConfig.includes("X-Robots-Tag"),
  "next.config.ts must not set a global Cloudflare noindex header for public product routes",
  errors,
);
assert(
  middleware.includes('pathname !== "/travel"') &&
    middleware.includes("NOINDEX_HEADER_VALUE") &&
    middleware.includes("withNoindexHeader"),
  "middleware must treat /travel as a noindex legacy admin alias",
  errors,
);
assert(
  siteUrl.includes("https://100xfenok.etloveaui.workers.dev"),
  "site URL fallback must use the live Worker product origin",
  errors,
);
for (const required of [
  "Disallow: /admin/",
  "Disallow: /api/admin/",
  "Disallow: /live-bench/",
  "Disallow: /travel/",
  "Sitemap: https://100xfenok.etloveaui.workers.dev/sitemap.xml",
]) {
  assert(publicRobots.includes(required), `public robots.txt missing ${required}`, errors);
}
for (const required of ["/admin/", "/api/admin/", "/live-bench/", "/travel/"]) {
  assert(appRobots.includes(required), `app robots route missing ${required}`, errors);
}
// sitemap.ts is generated from the lib/routes.ts SSOT (SITEMAP_PRODUCT_ROUTES + ROUTES),
// so validate the route source of truth rather than inline literals in sitemap.ts.
assert(
  sitemap.includes("SITEMAP_PRODUCT_ROUTES") && sitemap.includes("canonicalUrl"),
  "sitemap.ts must build from SITEMAP_PRODUCT_ROUTES via canonicalUrl",
  errors,
);
const sitemapStart = routes.indexOf("SITEMAP_PRODUCT_ROUTES");
const sitemapBlock =
  sitemapStart >= 0 ? routes.slice(sitemapStart, routes.indexOf("]", sitemapStart)) : "";
assert(sitemapBlock.length > 0, "lib/routes.ts must define SITEMAP_PRODUCT_ROUTES", errors);
for (const forbidden of [
  "admin",
  "api/admin",
  "live-bench",
  "liveBench",
  "travel",
  "winddown",
  "filings",
]) {
  assert(
    !sitemapBlock.includes(forbidden),
    `SITEMAP_PRODUCT_ROUTES must not include ${forbidden}`,
    errors,
  );
}
for (const key of [
  "ROUTES.home",
  "ROUTES.explore",
  "ROUTES.market",
  "ROUTES.etfs",
  "ROUTES.screener",
  "ROUTES.superinvestors",
]) {
  assert(sitemapBlock.includes(key), `SITEMAP_PRODUCT_ROUTES missing ${key}`, errors);
}
for (const required of [
  'home: "/"',
  'explore: "/explore"',
  'market: "/market-valuation"',
  'etfs: "/etfs"',
  'screener: "/screener"',
  'superinvestors: "/superinvestors"',
]) {
  assert(routes.includes(required), `ROUTES SSOT missing ${required}`, errors);
}
assert(stockPage.includes("canonicalPath(ROUTES.stock(symbol))"), "stock detail metadata must set canonical URL", errors);
assert(etfPage.includes("canonicalPath(ROUTES.etf(symbol))"), "ETF detail metadata must set canonical URL", errors);

if (errors.length) {
  console.error("SEO surface guard failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("SEO surface guard passed");
