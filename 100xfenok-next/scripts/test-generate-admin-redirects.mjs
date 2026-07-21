#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  ADMIN_REDIRECTS_END,
  ADMIN_REDIRECTS_START,
  renderAdminRedirectBlock,
  updateAdminRedirectBlock,
  validateAdminCanonicalRoutes,
} from "./generate-admin-redirects.mjs";
import { ADMIN_CANONICAL_REDIRECT_ROUTES } from "./qa-route-catalog.mjs";

assert.deepEqual(ADMIN_CANONICAL_REDIRECT_ROUTES, [
  "/admin",
  "/admin/data-lab",
  "/admin/design-gallery",
  "/admin/design-lab",
  "/admin/design-lab/cp-kit",
  "/admin/live",
  "/admin/macro-monitor",
  "/admin/market-radar",
  "/admin/valuation-lab",
  "/admin/stark-lab",
  "/admin/personal",
  "/admin/personal/travel",
  "/admin/ib-helper",
]);

const routes = [
  "/admin",
  "/admin/data-lab",
  "/admin/design-lab/cp-kit",
];

const rendered = renderAdminRedirectBlock(routes);
assert.equal(
  rendered,
  [
    ADMIN_REDIRECTS_START,
    "/admin /admin/ 308",
    "/admin/data-lab /admin/data-lab/ 308",
    "/admin/design-lab/cp-kit /admin/design-lab/cp-kit/ 308",
    ADMIN_REDIRECTS_END,
  ].join("\n"),
);

const existing = [
  "# header",
  ADMIN_REDIRECTS_START,
  "/admin /admin/ 308",
  ADMIN_REDIRECTS_END,
  "# manual legacy redirect",
  "/100x/100x-main.html /100x/daily-wrap 308",
  "",
].join("\n");
const updated = updateAdminRedirectBlock(existing, routes);
assert.match(updated, /\/admin\/design-lab\/cp-kit \/admin\/design-lab\/cp-kit\/ 308/);
assert.match(updated, /# manual legacy redirect\n\/100x\/100x-main\.html \/100x\/daily-wrap 308/);

for (const invalid of [
  ["/market"],
  ["/admin/"],
  ["/admin?mode=test"],
  ["/admin#fragment"],
  ["/admin", "/admin"],
]) {
  assert.throws(() => validateAdminCanonicalRoutes(invalid));
}

assert.throws(() => updateAdminRedirectBlock("/admin /admin/ 308\n", routes));
assert.throws(() => updateAdminRedirectBlock(`${ADMIN_REDIRECTS_START}\n${ADMIN_REDIRECTS_START}\n${ADMIN_REDIRECTS_END}`, routes));
assert.throws(() => updateAdminRedirectBlock(`# prefix ${ADMIN_REDIRECTS_START}\n${ADMIN_REDIRECTS_END}\n`, routes));
assert.throws(() => updateAdminRedirectBlock(`${ADMIN_REDIRECTS_START}\n${ADMIN_REDIRECTS_END} suffix\n`, routes));

console.log("PASS test-generate-admin-redirects");
