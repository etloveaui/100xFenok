// Shared, EDGE-SAFE admin legacy-bridge path logic.
//
// This module is deliberately free of `node:fs` (and of any import that reaches
// it) so that both the Node-runtime page and the edge middleware can consume one
// implementation and cannot drift. `@/lib/server/legacy-bridge` imports
// `publicAssetExists`, which imports `node:fs`; importing that module from
// middleware would pull the Node built-in into the edge bundle. Import the
// candidate/safety helpers from HERE in middleware.
//
// Existence checking is intentionally NOT done here: the page resolves a
// candidate against the filesystem/ASSETS binding via `publicAssetExists`, while
// middleware resolves it against the build-time ADMIN_LEGACY_HTML_FILES
// manifest. Only the candidate ORDER is shared, which is the part that must
// never diverge.

const LEGACY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Slugs that resolve outside `public/admin/`. Mirrored by the manifest roots. */
export const ADMIN_LEGACY_ALIAS_BY_SLUG: Record<string, string> = {
  "ib-helper": "ib/ib-helper/index.html",
};

export function isSafeSlugSegments(slug: string[]): boolean {
  return slug.every(
    (segment) =>
      !!segment &&
      !segment.includes("/") &&
      !segment.includes("\\") &&
      !segment.includes("..") &&
      !segment.startsWith(".") &&
      LEGACY_SEGMENT_PATTERN.test(segment),
  );
}

/**
 * Ordered public-root-relative candidates for an `/admin/<slug...>` request.
 *
 * Order is contractual and reproduces the original `resolveLegacyIframeSrc`:
 *   1. the `legacyAliasBySlug` target, when the joined slug has one
 *   2. `admin/<joined>.html`      (or `admin/<joined>` when it already ends .html)
 *   3. `admin/<joined>/index.html`
 *
 * Returned paths have no leading slash; callers prefix `/` when building a URL.
 */
export function resolveAdminLegacyCandidates(slug: string[]): string[] {
  const joined = slug.join("/");
  const candidates: string[] = [];

  const alias = ADMIN_LEGACY_ALIAS_BY_SLUG[joined];
  if (alias) candidates.push(alias);

  const relatives = joined.endsWith(".html")
    ? [joined]
    : [`${joined}.html`, `${joined}/index.html`];

  for (const relative of relatives) {
    candidates.push(`admin/${relative}`.replaceAll("\\", "/"));
  }

  return candidates;
}

export { LEGACY_SEGMENT_PATTERN };
