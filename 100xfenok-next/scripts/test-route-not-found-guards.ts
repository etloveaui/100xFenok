import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import {
  ADMIN_LEGACY_HTML_FILES,
  POST_HTML_FILES,
} from "../src/generated/static-route-manifest";
import {
  ADMIN_LEGACY_ALIAS_BY_SLUG,
  decodeSlugSegments,
  isSafeSlugSegments,
  resolveAdminLegacyCandidates,
} from "../src/lib/admin-legacy-candidates";
import { resolvePostCandidates } from "../src/lib/post-candidates";
import { resolvePostPublicPathBySlug } from "../src/lib/server/posts";
import {
  ADMIN_CONCRETE_ROUTES,
  getAdminNotFoundRewrite,
  getPostsNotFoundRewrite,
  shouldRewritePostsNotFound,
} from "../middleware";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const middlewarePath = path.join(appRoot, "middleware.ts");
const postCandidatesPath = path.join(appRoot, "src/lib/post-candidates.ts");
const middlewareSource = fs.readFileSync(middlewarePath, "utf8");
const postCandidatesSource = fs.readFileSync(postCandidatesPath, "utf8");
const origin = "https://example.test";

function request(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, origin));
}

function assertNotFoundRewrite(response: Response | null, label: string): void {
  assert(response, `${label} must emit a middleware rewrite`);
  assert.equal(response.status, 404, `${label} must carry status 404`);
  assert.equal(
    new URL(response.headers.get("x-middleware-rewrite") ?? origin).pathname.replace(/\/$/, ""),
    "/_not-found",
    `${label} must target /_not-found`,
  );
}

function walkPageFiles(root: string): string[] {
  const pages: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) pages.push(...walkPageFiles(absolute));
    if (entry.isFile() && entry.name === "page.tsx") pages.push(absolute);
  }
  return pages;
}

function walkTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkTypeScriptFiles(absolute));
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function expectedConcreteAdminRoutes(): string[] {
  const adminRoot = path.join(appRoot, "src/app/admin");
  return walkPageFiles(adminRoot)
    .map((pagePath) => path.relative(adminRoot, path.dirname(pagePath)).replaceAll(path.sep, "/"))
    .filter((relative) => !relative.split("/").some((segment) => segment.startsWith("[")))
    .map((relative) => (relative ? `/admin/${relative}` : "/admin"))
    .sort();
}

function sourceAdminRoutes(source: string): string[] {
  const block = source.match(
    /export const ADMIN_CONCRETE_ROUTES = new Set<string>\(\[([\s\S]*?)\]\);/,
  )?.[1];
  assert(block, "middleware must expose the concrete admin route set");
  return [...block.matchAll(/"(\/admin(?:\/[^"]*)?)"/g)].map((match) => match[1]).sort();
}

function assertCandidateSourceContracts(source: string): void {
  assert.match(
    source,
    /: \[`\$\{joined\}\.html`, `\$\{joined\}\/index\.html`\]/,
    "post candidates must keep .html before /index.html",
  );
  assert.doesNotMatch(
    source,
    /^import .*node:fs.*$/m,
    "post candidate expansion must stay edge-safe",
  );
}

function assertMiddlewareSourceContracts(source: string): void {
  assert.match(
    source,
    /if \(pathname === "\/posts" \|\| pathname === "\/posts\/"\) return false;/,
    "posts landing and query bridge must stay exempt",
  );
  assert.match(
    source,
    /const encodedSegments = rawSegments\.filter\(Boolean\);/,
    "posts terminal slash must discard the empty segment",
  );
  assert.match(
    source,
    /const decodedAdminPath = decodeAdminRequestPath\(pathname\);/,
    "admin not-found guard must compare a decoded request path",
  );
  assert.match(
    source,
    /resolvePostCandidates\(slug\)\.some\(\(candidate\) => postHtmlFileSet\.has\(candidate\)\)/,
    "posts 404 decision must use candidate membership",
  );
}

const canonicalPost = POST_HTML_FILES[0];
const extensionlessPost = canonicalPost.replace(/\.html$/, "");

assert.deepEqual(resolvePostCandidates(["nested"]), ["nested.html", "nested/index.html"]);
assert.deepEqual(resolvePostCandidates(["already.html"]), ["already.html"]);
assert.deepEqual(decodeSlugSegments(["data%2Dlab"]), ["data-lab"]);
assert.equal(decodeSlugSegments(["%252D"]), null);
assert.equal(decodeSlugSegments(["%E0%A4%A"]), null);
assert.equal(resolvePostPublicPathBySlug([canonicalPost]), `/posts-raw/${canonicalPost}`);
assert.equal(resolvePostPublicPathBySlug([extensionlessPost]), `/posts-raw/${canonicalPost}`);
assert.equal(resolvePostPublicPathBySlug(["unknown-report"]), null);
assert.equal(getPostsNotFoundRewrite(request(`/posts/${canonicalPost}`)), null);
assert.equal(getPostsNotFoundRewrite(request(`/posts/${extensionlessPost}`)), null);
assert.equal(getPostsNotFoundRewrite(request(`/posts/${extensionlessPost}/`)), null);
assert.equal(getPostsNotFoundRewrite(request("/posts")), null);
assert.equal(getPostsNotFoundRewrite(request("/posts/")), null);
assert.equal(
  getPostsNotFoundRewrite(request(`/posts/?path=posts/${canonicalPost}`)),
  null,
  "the posts query bridge must remain owned by the landing page",
);
assertNotFoundRewrite(getPostsNotFoundRewrite(request("/posts/unknown-report")), "unknown post");
assertNotFoundRewrite(getPostsNotFoundRewrite(request("/posts/unknown-report.html")), "unknown .html post");

const nestedIndexFixture = new Set<string>(["nested/index.html"]);
assert.equal(
  shouldRewritePostsNotFound("/posts/nested/", nestedIndexFixture),
  false,
  "nested /index.html alias must resolve through the middleware decision",
);
assert.equal(
  shouldRewritePostsNotFound("/posts/missing/", nestedIndexFixture),
  true,
  "a safe missing nested post must 404",
);
assert.equal(shouldRewritePostsNotFound("/posts/%2e%2e/secret"), false);
assert.equal(shouldRewritePostsNotFound("/posts/%252e%252e/secret"), false);
assert.equal(shouldRewritePostsNotFound("/posts/%E0%A4%A"), false);
assert.equal(shouldRewritePostsNotFound("/posts////"), false);
assert.equal(shouldRewritePostsNotFound("/posts/foo//missing"), false);
assert.equal(shouldRewritePostsNotFound("/posts//missing"), false);
assert.equal(shouldRewritePostsNotFound("/posts/missing//"), false);

for (const postFile of POST_HTML_FILES) {
  assert(
    isSafeSlugSegments(postFile.split("/")),
    `POST_HTML_FILES contains a segment rejected by the middleware: ${postFile}`,
  );
}

assert.deepEqual(
  [...ADMIN_CONCRETE_ROUTES].sort(),
  expectedConcreteAdminRoutes(),
  "ADMIN_CONCRETE_ROUTES must equal the app/admin page tree minus catch-all routes",
);
assert.deepEqual(sourceAdminRoutes(middlewareSource), expectedConcreteAdminRoutes());
assert.equal(getAdminNotFoundRewrite(request("/admin/live/")), null);
assert.equal(getAdminNotFoundRewrite(request("/admin/data%2Dlab")), null);
assert.equal(getAdminNotFoundRewrite(request("/admin/design%2Dgallery")), null);
assert.equal(getAdminNotFoundRewrite(request("/admin/design-lab/alpha-scout/")), null);
assert.equal(getAdminNotFoundRewrite(request("/admin/design-lab/alpha%2Dscout")), null);
assert.equal(getAdminNotFoundRewrite(request("/admin/ib-helper/")), null);
assert.equal(getAdminNotFoundRewrite(request("/admin/%E0%A4%A")), null);
assertNotFoundRewrite(getAdminNotFoundRewrite(request("/admin/unknown-route/")), "unknown admin route");
assert.equal(resolveAdminLegacyCandidates(["ib-helper"])[0], ADMIN_LEGACY_ALIAS_BY_SLUG["ib-helper"]);
assert(
  resolveAdminLegacyCandidates(["design-lab", "alpha-scout"]).some((candidate) =>
    new Set<string>(ADMIN_LEGACY_HTML_FILES).has(candidate),
  ),
  "admin legacy resolver candidates must retain a manifest-backed nested-index path",
);

const applicationSources = [middlewarePath, ...walkTypeScriptFiles(path.join(appRoot, "src"))].map(
  (entry) => fs.readFileSync(entry, "utf8"),
);
assert.equal(
  applicationSources.reduce(
    (count, source) => count + (source.match(/function isSafeSlugSegments\s*\(/g)?.length ?? 0),
    0,
  ),
  1,
  "isSafeSlugSegments must have exactly one definition",
);

assertCandidateSourceContracts(postCandidatesSource);
assertMiddlewareSourceContracts(middlewareSource);

const reversedCandidates = postCandidatesSource.replace(
  '[`${joined}.html`, `${joined}/index.html`]',
  '[`${joined}/index.html`, `${joined}.html`]',
);
assert.throws(
  () => assertCandidateSourceContracts(reversedCandidates),
  /must keep .html before \/index.html/,
  "reversing candidate order must fail the guard",
);
const missingIndexCandidate = postCandidatesSource.replace(
  '[`${joined}.html`, `${joined}/index.html`]',
  '[`${joined}.html`]',
);
assert.throws(
  () => assertCandidateSourceContracts(missingIndexCandidate),
  /must keep .html before \/index.html/,
  "dropping /index.html must fail the guard",
);
const exactPathMembership = middlewareSource.replace(
  "resolvePostCandidates(slug).some((candidate) => postHtmlFileSet.has(candidate))",
  'postHtmlFileSet.has(pathname.replace("/posts/", ""))',
);
assert.throws(
  () => assertMiddlewareSourceContracts(exactPathMembership),
  /must use candidate membership/,
  "replacing candidate membership with raw-path membership must fail the guard",
);
const missingFilter = middlewareSource.replace(
  "const encodedSegments = rawSegments.filter(Boolean);",
  "const encodedSegments = rawSegments;",
);
assert.throws(
  () => assertMiddlewareSourceContracts(missingFilter),
  /must discard the empty segment/,
  "removing filter(Boolean) must fail the guard",
);
const missingAdminDecode = middlewareSource.replace(
  "const decodedAdminPath = decodeAdminRequestPath(pathname);",
  'const decodedAdminPath = { pathname, slug: pathname.slice("/admin/".length).split("/") };',
);
assert.throws(
  () => assertMiddlewareSourceContracts(missingAdminDecode),
  /must compare a decoded request path/,
  "removing admin path decoding must fail the guard",
);
const missingLandingExemption = middlewareSource.replace(
  'if (pathname === "/posts" || pathname === "/posts/") return false;',
  "",
);
assert.throws(
  () => assertMiddlewareSourceContracts(missingLandingExemption),
  /must stay exempt/,
  "removing the posts landing exemption must fail the guard",
);
const missingAdminRoute = middlewareSource.replace('  "/admin/live",\n', "");
assert.notDeepEqual(
  sourceAdminRoutes(missingAdminRoute),
  expectedConcreteAdminRoutes(),
  "deleting one concrete admin route must fail set parity",
);

console.log("test-route-not-found-guards: ok");
