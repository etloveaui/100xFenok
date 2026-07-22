#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADMIN_REDIRECTS_END,
  ADMIN_REDIRECTS_START,
  checkAdminRedirects,
  renderAdminRedirectBlock,
  updateAdminRedirectBlock,
  validateAdminCanonicalRoutes,
} from "./generate-admin-redirects.mjs";
import { ADMIN_CANONICAL_REDIRECT_ROUTES } from "./qa-route-catalog.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assertAdminRedirectWiring(packageScripts, deployWorkflow) {
  const routeCommands = (packageScripts["qa:routes"] ?? "")
    .split("&&")
    .map((command) => command.trim());
  const testIndex = routeCommands.indexOf("npm run test:admin-redirects");
  const checkIndex = routeCommands.indexOf("npm run check:admin-redirects");
  assert.ok(testIndex >= 0, "qa:routes must execute the admin redirect unit contract");
  assert.ok(checkIndex > testIndex, "qa:routes must check the generated block after the unit contract");
  assert.equal(
    packageScripts["cf:build"],
    "bash scripts/load-guard.sh npm run cf:build:steps",
    "the guarded Cloudflare entrypoint must delegate to cf:build:steps",
  );
  assert.match(
    packageScripts["cf:build:steps"] ?? "",
    /(?:^|&& )npm run qa:routes(?: &&|$)/,
    "the Cloudflare build must execute qa:routes",
  );
  assert.match(
    deployWorkflow,
    /- name: Build \(OpenNext Cloudflare\)\r?\n\s+working-directory: 100xfenok-next\r?\n\s+run: npm run cf:build(?:\r?\n|$)/,
    "the deploy workflow must enter the guarded Cloudflare build",
  );
}

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
checkAdminRedirects(updated, routes);

for (const mutate of [
  (source) => source.replace("/admin /admin/ 308", "/admin /admin/wrong/ 308"),
  (source) => source.replace("/admin/data-lab /admin/data-lab/ 308", "/admin/data-lab /admin/data-lab/ 307"),
  (source) => source.replace("/admin/design-lab/cp-kit /admin/design-lab/cp-kit/ 308\n", ""),
]) {
  const mutant = mutate(updated);
  assert.notEqual(mutant, updated, "redirect mutation anchor must exist");
  assert.throws(
    () => checkAdminRedirects(mutant, routes),
    /admin block is stale/,
    "destination, status, or deletion drift must fail the generated-block check",
  );
}

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

const packageJson = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
const deployWorkflow = fs.readFileSync(path.join(APP_ROOT, "..", ".github", "workflows", "deploy-worker.yml"), "utf8");
assertAdminRedirectWiring(packageJson.scripts, deployWorkflow);

for (const mutant of [
  {
    scripts: { ...packageJson.scripts, "qa:routes": packageJson.scripts["qa:routes"].replace("npm run test:admin-redirects && ", "") },
    workflow: deployWorkflow,
  },
  {
    scripts: {
      ...packageJson.scripts,
      "qa:routes": packageJson.scripts["qa:routes"].replace(
        "npm run test:admin-redirects",
        "npm run test:admin-redirects:noop",
      ),
    },
    workflow: deployWorkflow,
  },
  {
    scripts: { ...packageJson.scripts, "qa:routes": packageJson.scripts["qa:routes"].replace("npm run check:admin-redirects && ", "") },
    workflow: deployWorkflow,
  },
  {
    scripts: { ...packageJson.scripts, "cf:build:steps": packageJson.scripts["cf:build:steps"].replace("npm run qa:routes", "npm run qa:tokens") },
    workflow: deployWorkflow,
  },
  {
    scripts: { ...packageJson.scripts, "cf:build": "bash scripts/load-guard.sh npm run cf:build:next" },
    workflow: deployWorkflow,
  },
  {
    scripts: packageJson.scripts,
    workflow: deployWorkflow.replace("run: npm run cf:build", "run: npm run cf:build:next"),
  },
]) {
  assert.throws(
    () => assertAdminRedirectWiring(mutant.scripts, mutant.workflow),
    "removing any hop in test/check -> qa:routes -> cf:build -> deploy must fail",
  );
}

console.log("PASS test-generate-admin-redirects");
