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

assert(
  !nextConfig.includes('source: "/travel/:path*"'),
  "next.config.ts must not expose a permanent /travel -> admin redirect",
  errors,
);
assert(
  middleware.includes('pathname !== "/travel"') &&
    middleware.includes('"X-Robots-Tag", "noindex, nofollow, noarchive"'),
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
for (const forbidden of [
  'path: "/admin',
  'path: "/api/admin',
  'path: "/live-bench',
  'path: "/travel',
  'path: "/market"',
  'path: "/filings/nvda-10k',
  'path: "/winddown',
]) {
  assert(!sitemap.includes(forbidden), `sitemap must not include ${forbidden}`, errors);
}
for (const required of [
  'path: "/"',
  'path: "/explore"',
  'path: "/market-valuation"',
  'path: "/etfs"',
  'path: "/screener"',
  'path: "/superinvestors"',
]) {
  assert(sitemap.includes(required), `sitemap missing ${required}`, errors);
}
assert(stockPage.includes("canonicalPath(`/stock/${symbol}`)"), "stock detail metadata must set canonical URL", errors);
assert(etfPage.includes("canonicalPath(`/etfs/${symbol}`)"), "ETF detail metadata must set canonical URL", errors);

if (errors.length) {
  console.error("SEO surface guard failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("SEO surface guard passed");
